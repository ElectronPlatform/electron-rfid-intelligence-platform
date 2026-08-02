/*
 * Electron Engineering Mode
 *
 * A versioned, renderer-wide context signal for optional engineering features.
 * Enabling the signal does not itself change parser, viewer, storage or device
 * behaviour. Individual modules must opt in explicitly in a future change.
 */
(function(root, factory){
  const isCommonJs=typeof module === "object" && module.exports;
  const maintainerEnabled=root?.pm3api?.maintainerCapability?.enabled === true;
  const api=isCommonJs || maintainerEnabled ? factory(root) : null;
  if(typeof module === "object" && module.exports) module.exports=api;
  if(root && api) root.EngineeringMode=api;
})(typeof window !== "undefined" ? window : globalThis, function(root){
  "use strict";

  const API_VERSION="1.0.0";
  const SCHEMA_VERSION=1;
  const ACKNOWLEDGEMENT_VERSION="engineering-mode-information-v1";
  const STORAGE_KEY="electron.engineeringMode.state.v1";
  const EVENT_NAME="electron:engineering-mode-changed";
  const listeners=new Set();

  function nowIso(){
    return new Date().toISOString();
  }

  function safeStorage(){
    try{ return root?.localStorage || null; }
    catch{ return null; }
  }

  function defaultState(){
    return {
      schemaVersion:SCHEMA_VERSION,
      enabled:false,
      mode:"standard",
      localOnly:true,
      acknowledgementVersion:null,
      acknowledgedAt:null,
      changedAt:null,
      source:"default"
    };
  }

  function normaliseState(value){
    const source=value && typeof value === "object" ? value : {};
    const enabled=source.enabled === true;
    return {
      schemaVersion:SCHEMA_VERSION,
      enabled,
      mode:enabled ? "engineering" : "standard",
      localOnly:true,
      acknowledgementVersion:typeof source.acknowledgementVersion === "string" ? source.acknowledgementVersion : null,
      acknowledgedAt:typeof source.acknowledgedAt === "string" ? source.acknowledgedAt : null,
      changedAt:typeof source.changedAt === "string" ? source.changedAt : null,
      source:typeof source.source === "string" && source.source ? source.source : "stored"
    };
  }

  function readStoredState(){
    const storage=safeStorage();
    if(!storage) return defaultState();
    try{
      const raw=storage.getItem(STORAGE_KEY);
      if(!raw) return defaultState();
      return normaliseState(JSON.parse(raw));
    }catch{
      return defaultState();
    }
  }

  function publicState(state){
    return Object.freeze({...normaliseState(state), apiVersion:API_VERSION});
  }

  function comparable(state){
    return JSON.stringify(normaliseState(state));
  }

  function applyDocumentState(state){
    const rootElement=root?.document?.documentElement;
    if(rootElement?.dataset){
      rootElement.dataset.engineeringMode=state.enabled ? "enabled" : "disabled";
    }
  }

  let currentState=readStoredState();
  applyDocumentState(currentState);

  function emitChange(source){
    const state=publicState({...currentState, source:source || currentState.source});
    listeners.forEach(listener=>{
      try{ listener(state); }catch(error){ root?.console?.error?.("[EngineeringMode] listener failed", error); }
    });
    try{
      if(root?.document?.dispatchEvent && typeof root.CustomEvent === "function"){
        root.document.dispatchEvent(new root.CustomEvent(EVENT_NAME, {detail:state}));
      }
    }catch{}
    return state;
  }

  function persist(state){
    const storage=safeStorage();
    if(!storage) return false;
    try{
      storage.setItem(STORAGE_KEY, JSON.stringify(normaliseState(state)));
      return true;
    }catch{
      return false;
    }
  }

  function isEnabled(){
    return currentState.enabled === true;
  }

  function isEnabledFor(){
    return isEnabled();
  }

  function getState(){
    return publicState(currentState);
  }

  function getContext(componentId, metadata){
    const state=getState();
    return Object.freeze({
      ...state,
      componentId:String(componentId || "anonymous-component"),
      metadata:metadata && typeof metadata === "object" ? Object.freeze({...metadata}) : Object.freeze({})
    });
  }

  function whenEnabled(componentId, callback, metadata){
    const context=getContext(componentId, metadata);
    if(!context.enabled || typeof callback !== "function") return undefined;
    return callback(context);
  }

  function setEnabled(enabled, options){
    const requested=enabled === true;
    const opts=options && typeof options === "object" ? options : {};

    if(requested && opts.acknowledged !== true){
      return {
        ok:false,
        reason:"acknowledgement-required",
        state:getState()
      };
    }

    const changedAt=nowIso();
    const next=normaliseState({
      ...currentState,
      enabled:requested,
      acknowledgementVersion:requested ? ACKNOWLEDGEMENT_VERSION : currentState.acknowledgementVersion,
      acknowledgedAt:requested ? changedAt : currentState.acknowledgedAt,
      changedAt,
      source:String(opts.source || "api")
    });

    if(!persist(next)){
      return {
        ok:false,
        reason:"storage-unavailable",
        state:getState()
      };
    }

    currentState=next;
    applyDocumentState(currentState);
    return {ok:true, state:emitChange(next.source)};
  }

  function refreshFromStorage(options){
    const next=readStoredState();
    if(comparable(next) === comparable(currentState)) return getState();
    currentState=next;
    applyDocumentState(currentState);
    return emitChange(options?.source || "storage-sync");
  }

  function subscribe(listener, options){
    if(typeof listener !== "function") return ()=>{};
    listeners.add(listener);
    if(options?.immediate === true) listener(getState());
    return ()=>listeners.delete(listener);
  }

  function installSynchronization(){
    if(root?.addEventListener){
      root.addEventListener("storage", event=>{
        if(event?.key === STORAGE_KEY) refreshFromStorage({source:"storage-event"});
      });
    }
    root?.pm3api?.onSettingsUpdated?.(payload=>{
      if(payload?.type === "engineering-mode") refreshFromStorage({source:"settings-window"});
    });
  }

  const api=Object.freeze({
    version:API_VERSION,
    constants:Object.freeze({
      storageKey:STORAGE_KEY,
      eventName:EVENT_NAME,
      acknowledgementVersion:ACKNOWLEDGEMENT_VERSION
    }),
    isEnabled,
    isEnabledFor,
    getState,
    getContext,
    whenEnabled,
    setEnabled,
    refreshFromStorage,
    subscribe
  });

  installSynchronization();
  return api;
});
