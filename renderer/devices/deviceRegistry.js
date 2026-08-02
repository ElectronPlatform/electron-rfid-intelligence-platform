/*
 * Electron Device Registry
 *
 * Loads device profiles and command libraries from JSON files.
 * Proxmark3 is the first working adapter; other devices are profile-only until
 * their own runners are added.
 *
 * Custom command libraries can be imported from JSON and are stored in local
 * browser storage so they survive app restarts without rebuilding Electron.
 */
(function(){
  const ACTIVE_DEVICE_KEY="electron.activeDeviceId.v1";
  const CUSTOM_LIBRARIES_KEY="electron.deviceCommandLibraries.custom.v1";
  const state={ready:false, profiles:[], commandLibraries:{}, customLibraries:{}, commandCatalog:new Map(), activeDeviceId:"proxmark3"};

  function text(value){ return String(value ?? ""); }
  function cleanId(value){ return text(value).trim() || "proxmark3"; }
  async function loadJson(path){
    const res=await fetch(path, {cache:"no-store"});
    if(!res.ok) throw new Error(`Could not load ${path}`);
    return await res.json();
  }
  function readCustomLibraries(){
    try{
      const raw=JSON.parse(localStorage.getItem(CUSTOM_LIBRARIES_KEY) || "{}");
      return raw && typeof raw==="object" ? raw : {};
    }catch{
      return {};
    }
  }
  function writeCustomLibraries(value){
    localStorage.setItem(CUSTOM_LIBRARIES_KEY, JSON.stringify(value || {}, null, 2));
  }
  function asList(value){
    return Array.isArray(value) ? value.filter(Boolean).map(text) : value ? [text(value)] : [];
  }
  function looksLikeCommand(value){
    return /^(hf|lf|hw|data|trace|mem|script|prefs|help|smart|emv)\b/i.test(text(value).trim());
  }
  function inferCategory(command, fallback){
    const cmd=text(command).trim().toLowerCase();
    if(fallback) return text(fallback);
    if(cmd.startsWith("hf mf")) return "MIFARE";
    if(cmd.startsWith("hf 14a")) return "ISO14443";
    if(cmd.startsWith("hf")) return "HF";
    if(cmd.startsWith("lf t55")) return "T55xx";
    if(cmd.startsWith("lf")) return "LF";
    if(cmd.startsWith("hw")) return "Utility";
    return "Other";
  }
  function inferCapability(command, fallback){
    const cmd=text(command).trim().toLowerCase();
    if(fallback) return text(fallback);
    if(cmd.startsWith("hf")) return "hf";
    if(cmd.startsWith("lf")) return "lf";
    if(cmd.startsWith("hw")) return "deviceInfo";
    return "";
  }
  function titleFromCommand(command){
    return text(command).trim().replace(/\s+/g, " ");
  }
  function isPlaceholderDescription(value){
    return !text(value).trim() || /^(Imported command\. Add a description|No verified explanation is recorded)/i.test(text(value).trim());
  }
  function commandCatalogEntry(command){
    const value=text(command).trim().replace(/\s+/g, " ").toLowerCase();
    if(!value) return null;
    if(state.commandCatalog.has(value)) return state.commandCatalog.get(value);
    let best=null;
    for(const [known, entry] of state.commandCatalog){
      if(value.startsWith(known+" ") && (!best || known.length>best.command.length)) best=entry;
    }
    return best;
  }
  function enrichWithCommandCatalog(entry){
    const source=commandCatalogEntry(entry.command);
    if(!source) return entry;
    return {
      ...entry,
      description:isPlaceholderDescription(entry.description) ? source.description : entry.description,
      safetyLevel:entry.safetyLevel==="unknown" ? source.safetyLevel : entry.safetyLevel,
      documentationSource:source.documentationSource,
      documentationUrl:source.documentationUrl,
      documentationMatchedCommand:source.command
    };
  }
  function normaliseCommandEntry(item, fallbackCommand="", fallbackCategory=""){
    if(typeof item==="string"){
      return looksLikeCommand(item) ? enrichWithCommandCatalog({
        command:text(item).trim(),
        title:titleFromCommand(item),
        category:inferCategory(item, fallbackCategory),
        capability:inferCapability(item),
        safetyLevel:"unknown",
        description:"Imported command. Add a description when you know exactly what this command does.",
        tags:["imported"]
      }) : null;
    }
    if(!item || typeof item!=="object") return null;
    const command=text(item.command || item.cmd || item.pm3Command || item.proxmarkCommand || item.value || fallbackCommand).trim();
    if(!command || !looksLikeCommand(command)) return null;
    return enrichWithCommandCatalog({
      command,
      title:text(item.title || item.name || item.label || titleFromCommand(command)),
      category:inferCategory(command, item.category || item.group || fallbackCategory),
      device:text(item.device || item.deviceId || ""),
      capability:inferCapability(command, item.capability || item.capabilityRequired),
      safetyLevel:text(item.safetyLevel || item.safety || item.risk || "unknown"),
      description:text(item.description || item.help || item.summary || "Imported command. Add a description when you know exactly what this command does."),
      examples:asList(item.examples || item.example),
      expectedOutput:asList(item.expectedOutput || item.output || item.outputs),
      notes:text(item.notes || item.note || ""),
      tags:asList(item.tags).length ? asList(item.tags) : ["imported"]
    });
  }
  function normaliseCatalogEntry(item, catalog={}){
    const command=text(item?.command).trim().replace(/\s+/g, " ");
    if(!command) return null;
    return {
      command,
      title:titleFromCommand(command),
      category:text(item.section || inferCategory(command)),
      device:"proxmark3",
      capability:inferCapability(command),
      safetyLevel:text(item.safetyLevel || "unknown"),
      description:text(item.description || "No verified explanation is recorded for this command."),
      examples:asList(item.examples),
      expectedOutput:asList(item.expectedOutput),
      notes:text(item.notes || ""),
      tags:["bundled", "upstream-documentation"],
      offlineAvailable:item.offlineAvailable === true,
      documentationSource:catalog.source || "RfidResearchGroup/proxmark3 doc/commands.md",
      documentationUrl:catalog.sourceUrl || "https://github.com/RfidResearchGroup/proxmark3/blob/master/doc/commands.md",
      documentationMatchedCommand:command
    };
  }
  function extractCommands(data, fallbackCategory=""){
    const found=[];
    const seen=new Set();
    function add(item, fallbackCommand="", category=fallbackCategory){
      const normalised=normaliseCommandEntry(item, fallbackCommand, category);
      const key=text(normalised?.command).trim().toLowerCase();
      if(key && !seen.has(key)){
        seen.add(key);
        found.push(normalised);
      }
    }
    function walk(value, category=fallbackCategory){
      if(Array.isArray(value)){
        value.forEach(item=>walk(item, category));
        return;
      }
      if(typeof value==="string"){
        add(value, "", category);
        return;
      }
      if(!value || typeof value!=="object") return;
      add(value, "", category);
      for(const [key, child] of Object.entries(value)){
        if(key==="commands" || key==="items" || key==="entries" || key==="data" || key==="commandLibrary"){
          walk(child, category);
        }else if(looksLikeCommand(key)){
          add(child, key, category);
        }else if(Array.isArray(child) || (child && typeof child==="object")){
          walk(child, key);
        }else if(typeof child==="string" && looksLikeCommand(child)){
          add(child, "", category);
        }
      }
    }
    walk(data, fallbackCategory);
    return found;
  }
  function commandsFromLibrary(lib){
    return extractCommands(lib);
  }
  function mergeCommands(base=[], custom=[]){
    const map=new Map();
    [...base, ...custom].forEach(item=>{
      const key=text(item.command).trim().toLowerCase();
      if(key) map.set(key, {...item});
    });
    return [...map.values()];
  }
  function activeProfile(){
    return state.profiles.find(p=>p.id===state.activeDeviceId) || state.profiles[0] || null;
  }
  function commands(deviceId=state.activeDeviceId){
    const id=cleanId(deviceId);
    return mergeCommands(state.commandLibraries[id] || [], state.customLibraries[id]?.commands || []);
  }
  function commandByText(command, deviceId=state.activeDeviceId){
    const cmd=text(command).trim().toLowerCase();
    return commands(deviceId).find(item=>text(item.command).trim().toLowerCase()===cmd) || null;
  }
  function categories(deviceId=state.activeDeviceId){
    return [...new Set(commands(deviceId).map(item=>item.category || "Other"))].sort((a,b)=>a.localeCompare(b));
  }
  function capabilitiesFor(deviceId=state.activeDeviceId){
    return activeProfileFor(deviceId)?.capabilities || {};
  }
  function activeProfileFor(deviceId){
    return state.profiles.find(p=>p.id===cleanId(deviceId)) || null;
  }
  function setActiveDevice(id){
    const next=activeProfileFor(id)?.id || "proxmark3";
    state.activeDeviceId=next;
    try{ localStorage.setItem(ACTIVE_DEVICE_KEY, next); }catch{}
    document.dispatchEvent(new CustomEvent("electron-device-changed", {detail:{deviceId:next, profile:activeProfile()}}));
    return activeProfile();
  }
  function normaliseImportedLibrary(data){
    const deviceId=cleanId(data?.deviceId || data?.device || state.activeDeviceId);
    const commands=commandsFromLibrary(data);
    return {
      version:data?.version || "custom",
      deviceId,
      importedAt:new Date().toISOString(),
      commands
    };
  }
  function importLibrary(data){
    const lib=normaliseImportedLibrary(data);
    if(!lib.commands.length) return {ok:false,message:"No commands found in JSON library."};
    state.customLibraries[lib.deviceId]=lib;
    writeCustomLibraries(state.customLibraries);
    return {ok:true,library:lib};
  }
  function upsertCommand(command, deviceId=state.activeDeviceId){
    const normalised=normaliseCommandEntry(command);
    if(!normalised) return {ok:false,message:"No valid command found."};
    const id=cleanId(deviceId);
    const lib=state.customLibraries[id] || {version:"custom",deviceId:id,importedAt:new Date().toISOString(),commands:[]};
    const key=text(normalised.command).trim().toLowerCase();
    const existing=lib.commands.findIndex(item=>text(item.command).trim().toLowerCase()===key);
    if(existing>=0) lib.commands[existing]={...lib.commands[existing],...normalised};
    else lib.commands.push(normalised);
    lib.updatedAt=new Date().toISOString();
    state.customLibraries[id]=lib;
    writeCustomLibraries(state.customLibraries);
    return {ok:true,command:normalised,library:lib};
  }
  function removeCommand(command, deviceId=state.activeDeviceId){
    const id=cleanId(deviceId);
    const key=text(command).trim().toLowerCase();
    const lib=state.customLibraries[id];
    if(!lib || !key) return {ok:false,message:"This command is part of the bundled library. Edit it first to create a custom override, or remove it from the JSON file."};
    const before=lib.commands.length;
    lib.commands=lib.commands.filter(item=>text(item.command).trim().toLowerCase()!==key);
    lib.updatedAt=new Date().toISOString();
    state.customLibraries[id]=lib;
    writeCustomLibraries(state.customLibraries);
    return {ok:lib.commands.length!==before,library:lib,message:lib.commands.length!==before ? "Command removed." : "Command not found in custom library."};
  }
  function isCustomCommand(command, deviceId=state.activeDeviceId){
    const id=cleanId(deviceId);
    const key=text(command).trim().toLowerCase();
    return !!state.customLibraries[id]?.commands?.some(item=>text(item.command).trim().toLowerCase()===key);
  }
  function exportLibrary(deviceId=state.activeDeviceId){
    const profile=activeProfileFor(deviceId) || activeProfile();
    return {
      version:"1.0",
      exportedAt:new Date().toISOString(),
      deviceId:profile?.id || deviceId,
      deviceName:profile?.displayName || deviceId,
      commands:commands(profile?.id || deviceId)
    };
  }
  async function init(force=false){
    if(state.ready && !force) return state;
    const profileData=await loadJson("devices/profiles.json");
    state.profiles=Array.isArray(profileData.devices) ? profileData.devices : [];
    state.commandLibraries={};
    state.customLibraries=readCustomLibraries();
    state.commandCatalog=new Map();
    let bundledProxmark3Catalog=[];
    try{
      const catalog=await loadJson("devices/proxmark3/iceman-command-catalog.json");
      for(const entry of Array.isArray(catalog.entries) ? catalog.entries : []){
        const command=text(entry?.command).trim().replace(/\s+/g," ");
        if(!command) continue;
        state.commandCatalog.set(command.toLowerCase(), {
          ...entry,
          documentationSource:catalog.source || "RfidResearchGroup/proxmark3 doc/commands.md",
          documentationUrl:catalog.sourceUrl || "https://github.com/RfidResearchGroup/proxmark3/blob/master/doc/commands.md"
        });
        const bundledEntry=normaliseCatalogEntry(entry, catalog);
        if(bundledEntry) bundledProxmark3Catalog.push(bundledEntry);
      }
    }catch(err){
      console.warn("Proxmark3 command catalogue failed", err);
    }
    // Imported libraries are persisted as raw JSON.  Enrich their entries only
    // in memory so a reload can add current official descriptions without
    // overwriting a user's original library file or local custom wording.
    for(const [deviceId, library] of Object.entries(state.customLibraries)){
      state.customLibraries[deviceId]={
        ...library,
        commands:(Array.isArray(library?.commands) ? library.commands : []).map(item=>normaliseCommandEntry(item)).filter(Boolean)
      };
    }
    for(const profile of state.profiles){
      if(!profile.commandLibrary) continue;
      try{
        const lib=await loadJson(profile.commandLibrary);
        const libraryCommands=commandsFromLibrary(lib);
        state.commandLibraries[profile.id]=profile.commandLibrary==="devices/proxmark3/commands.json"
          ? mergeCommands(bundledProxmark3Catalog, libraryCommands)
          : libraryCommands;
      }catch(err){
        console.warn("Device command library failed", profile.id, err);
        state.commandLibraries[profile.id]=[];
      }
    }
    const stored=localStorage.getItem(ACTIVE_DEVICE_KEY);
    state.activeDeviceId=activeProfileFor(stored)?.id || profileData.defaultDeviceId || "proxmark3";
    state.ready=true;
    document.dispatchEvent(new CustomEvent("electron-device-registry-ready", {detail:{profiles:state.profiles}}));
    return state;
  }
  async function reload(){
    return await init(true);
  }

  window.DeviceRegistry={
    init,
    reload,
    profiles:()=>state.profiles.slice(),
    activeProfile,
    activeProfileFor,
    activeDeviceId:()=>state.activeDeviceId,
    setActiveDevice,
    commands,
    categories,
    commandByText,
    capabilitiesFor,
    importLibrary,
    upsertCommand,
    removeCommand,
    isCustomCommand,
    exportLibrary,
    isReady:()=>state.ready
  };
})();
