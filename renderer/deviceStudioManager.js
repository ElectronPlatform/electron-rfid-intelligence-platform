/*
 * Device Studio Manager
 *
 * Static hardware catalogue plus live, read-only Device Studio v2 telemetry.
 * PM3 output parsing lives in the main-process Device Studio service; this UI
 * only consumes its structured JSON snapshot.
 */
(function(){
  const DEVICE_BASE="../assets/devices/proxmark3-easy/";
  const state={
    loaded:false,
    device:null,
    components:[],
    learning:{},
    hotspots:[],
    images:[],
    activeImageId:"",
    activeComponentId:"",
    snapshot:null,
    refreshing:false,
    refreshKind:"full",
    refreshProgress:0,
    refreshProgressLabel:"",
    refreshProgressTimer:null,
    refreshProgressHideTimer:null,
    lastRefreshKind:"full",
    refreshError:"",
    explanationLevel:"simple",
    overlayOpen:false,
    overlayTab:"overview",
    overlayPosition:null,
    simulationComponentId:"",
    diagnosticProgress:null,
    lastDiagnosticOutcome:null,
    diagnosticHistory:[],
    scopeTimer:null,
    scopeBusy:false,
    scopeData:null,
    scopeBaseline:null,
    scopeNoiseHistory:[],
    tuneTimer:null,
    tuneBusy:false,
    tuneData:null,
    tuneBaseline:null,
    tuneBaselineCapturedAt:null,
    tuneBaselinePending:false,
    ledTestActiveId:"",
    ledTestMessage:"",
    safeMode:{available:null,enabled:true,requested:true,busy:false,message:""},
    progressListenerReady:false,
    selectionListenerReady:false,
    overlayKeyboardReady:false,
    imageFitObserver:null,
    imageMetrics:{},
    calloutLineFrame:null,
    hotspotEditor:{available:false,enabled:false,selectedIndex:-1,menu:null,saving:false,status:"",showGuides:true,panelOffsets:{toolbar:{x:0,y:0},picker:{x:0,y:0}}}
  };

  function text(value){ return String(value ?? ""); }
  function escapeHtml(value){
    return text(value).replace(/[&<>"']/g, c=>({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"}[c]));
  }
  function loadDiagnosticHistory(){
    try{ const value=JSON.parse(localStorage.getItem("deviceStudioDiagnosticHistory")||"[]"); state.diagnosticHistory=Array.isArray(value)?value.slice(-20):[]; }catch{ state.diagnosticHistory=[]; }
  }
  function recordDiagnostic(snapshot){
    if(!snapshot) return;
    const entry={capturedAt:snapshot.capturedAt||new Date().toISOString(),connected:!!snapshot.connection?.connected,port:snapshot.connection?.port||null,firmware:snapshot.device?.firmware||null,status:snapshot.connection?.status||"unknown",capabilities:snapshot.capabilityNegotiation?.effective||[]};
    state.diagnosticHistory=[...state.diagnosticHistory.filter(item=>item.capturedAt!==entry.capturedAt),entry].slice(-20);
    try{ localStorage.setItem("deviceStudioDiagnosticHistory",JSON.stringify(state.diagnosticHistory)); }catch{}
  }
  function syncDeviceStudioSafeModeControl(){
    const toggle=document.getElementById('deviceStudioSafeModeToggle');
    const reported=state.snapshot?.deviceStudioSafeMode;
    const available=reported?.available===true || state.safeMode.available===true;
    const enabled=reported?.available===true ? reported.enabled===true : state.safeMode.enabled===true;
    // Device Console has its own capability summary.  Publish the current
    // firmware guard state so that summary never implies the same protection
    // while Safe Mode has explicitly been turned off.
    window.deviceStudioSafeMode={available,enabled};
    window.dispatchEvent(new CustomEvent('device-studio-safe-mode-changed',{detail:{available,enabled}}));
    if(!toggle) return;
    toggle.checked=enabled;
    toggle.disabled=!available || state.safeMode.busy;
    toggle.title=!available?'This firmware does not yet provide the Device Studio Safe Mode contract.':enabled?'Selected write, clone, simulation and standalone commands are blocked for this Device Studio session.':'Safe Mode is off: supported advanced commands are no longer blocked by the firmware workflow guard.';
  }
  function renderRefreshProgress(){
    const panel=document.getElementById('deviceStudioRefreshProgress');
    const text=document.getElementById('deviceStudioRefreshProgressText');
    const value=document.getElementById('deviceStudioRefreshProgressValue');
    const bar=document.getElementById('deviceStudioRefreshProgressBar');
    const track=panel?.querySelector('.deviceStudioRefreshProgressTrack');
    if(!panel || !text || !value || !bar || !track) return;
    const progress=Math.max(0,Math.min(100,Number(state.refreshProgress)||0));
    panel.hidden=!(state.refreshing || progress===100);
    panel.classList.toggle('isRunning',state.refreshing);
    panel.classList.toggle('isComplete',!state.refreshing && progress===100);
    text.textContent=state.refreshProgressLabel || (state.refreshing?'Refreshing diagnostics':'Diagnostics complete');
    value.textContent=`${Math.round(progress)}%`;
    bar.style.width=`${progress}%`;
    track.setAttribute('aria-valuenow',String(Math.round(progress)));
  }
  function stopRefreshProgress({complete=false,label=''}={}){
    if(state.refreshProgressTimer){ clearInterval(state.refreshProgressTimer); state.refreshProgressTimer=null; }
    if(state.refreshProgressHideTimer){ clearTimeout(state.refreshProgressHideTimer); state.refreshProgressHideTimer=null; }
    if(!complete){
      state.refreshProgress=0;
      state.refreshProgressLabel='';
      renderRefreshProgress();
      return;
    }
    state.refreshProgress=100;
    state.refreshProgressLabel=label || (state.refreshKind==='quick'?'Current device status refreshed':'Full RF check complete');
    renderRefreshProgress();
    state.refreshProgressHideTimer=setTimeout(()=>{
      state.refreshProgress=0;
      state.refreshProgressLabel='';
      renderRefreshProgress();
    },1300);
  }
  function startRefreshProgress(kind){
    stopRefreshProgress();
    state.refreshProgress=kind==='quick'?38:8;
    state.refreshProgressLabel=kind==='quick'?'Getting current device status':'Preparing full RF check';
    const cap=kind==='quick'?88:94;
    const step=kind==='quick'?12:3;
    state.refreshProgressTimer=setInterval(()=>{
      state.refreshProgress=Math.max(state.refreshProgress,Math.min(cap,state.refreshProgress+step));
      renderRefreshProgress();
    },kind==='quick'?130:420);
    renderRefreshProgress();
  }
  function updateRefreshProgressFromFirmware(progress){
    if(!state.refreshing || state.refreshKind!=='full') return;
    const byPhase={detecting:18,version:38,tuning:74,complete:100,error:100};
    if(byPhase[progress?.phase]!==undefined) state.refreshProgress=Math.max(state.refreshProgress,byPhase[progress.phase]);
    if(progress?.label) state.refreshProgressLabel=progress.label;
    renderRefreshProgress();
  }
  async function setDeviceStudioSafeMode(enabled){
    if(state.safeMode.busy || !window.pm3api?.setDeviceStudioSafeMode) return;
    if(!enabled && !window.confirm('Turn off Device Studio Safe Mode? This temporarily allows supported write, clone, simulation and standalone commands from a PM3 client. Device Studio itself still exposes diagnostic tools only.')){
      syncDeviceStudioSafeModeControl();
      return;
    }
    state.safeMode.busy=true;
    syncDeviceStudioSafeModeControl();
    try{
      const result=await window.pm3api.setDeviceStudioSafeMode(enabled);
      if(!result?.ok) throw new Error(result?.message||'Safe Mode command was not accepted by the connected firmware.');
      state.safeMode={available:result.data?.available===true,enabled:result.data?.enabled===true,requested:enabled===true,busy:false,message:''};
      // A mode switch changes only the guard state.  Refresh that current
      // status immediately without starting the slower RF tuning check.
      await refreshDiagnostics({kind:"quick"});
    }catch(error){
      state.safeMode={...state.safeMode,busy:false,message:String(error?.message||error)};
      window.alert(`Device Studio Safe Mode was not changed.\n\n${state.safeMode.message}`);
    }finally{
      state.safeMode.busy=false;
      syncDeviceStudioSafeModeControl();
    }
  }
  function capabilityActions(snapshot){
    if(Array.isArray(snapshot?.actionDescriptors) && snapshot.actionDescriptors.length) return snapshot.actionDescriptors;
    const caps=new Set(snapshot?.capabilityNegotiation?.effective||[]);
    const actions=[{id:"diagnostics",label:"Run diagnostics",purpose:"Read hardware and antenna information",hardware:"MCU, FPGA and HF/LF paths",firmware:"hw version + hw tune",expectedResult:"Structured diagnostic snapshot",duration:"temporary",risk:"read-only"}];
    if(caps.has("led-control")||snapshot?.capabilities?.ledState) actions.push({id:"led-control",label:"Test LED",purpose:"Identify one physical LED",hardware:"LED controller",firmware:"hw leds --test",expectedResult:"LED returns to its previous state",duration:"600 ms",risk:"temporary and reversible"});
    if(caps.has("button-status")||snapshot?.capabilities?.buttonState) actions.push({id:"button-information",label:"Button information",purpose:"Explain the reported state and firmware-defined role",hardware:"Physical button",firmware:"hw status --json",expectedResult:"Reported state and source-labelled explanation",duration:"included in diagnostics",risk:"informational only"});
    if(caps.has("self-test")) actions.push({id:"self-test",label:"Run self-test",purpose:"Check reported board health",hardware:"Board subsystems",firmware:"hw diagnostics --json",expectedResult:"Pass/fail health report",duration:"temporary",risk:"read-only"});
    return actions;
  }
  async function loadJson(path){
    const res=await fetch(path, {cache:"no-store"});
    if(!res.ok) throw new Error(`Could not load ${path}`);
    return await res.json();
  }
  function componentById(id){
    return state.components.find(item=>item.id===id) || state.components[0] || null;
  }
  function imageById(id){
    return state.images.find(item=>item.id===id) || state.images[0] || null;
  }
  function hotspotsForImage(imageId){
    return state.hotspots.filter(item=>item.imageId===imageId);
  }
  function categories(){
    const order=["Overview","Component","PCB","Profile","Macro"];
    const names=[...new Set(state.images.map(item=>item.category || "Other"))];
    return names.sort((a,b)=>{
      const ai=order.indexOf(a);
      const bi=order.indexOf(b);
      if(ai>=0 || bi>=0) return (ai<0?99:ai) - (bi<0?99:bi);
      return a.localeCompare(b);
    });
  }
  function selectedImageHotspot(){
    return state.hotspots.find(item=>item.imageId===state.activeImageId && item.componentId===state.activeComponentId);
  }
  function diagnosticLedState(id){
    const progress=state.diagnosticProgress;
    if(!progress || !/^led-[a-d]$/.test(id)) return null;
    const terminalPhase=progress.phase==="complete" || progress.phase==="error" || progress.phase==="idle";
    const isActive=!terminalPhase && progress.componentId===id;
    return {
      status:isActive?'diagnostic-active':'diagnostic-idle',
      telemetry:{phase:progress.phase,label:progress.label,source:'electron-observed'},
      detail:isActive ? `${progress.label}. This visualises Electron diagnostic activity; it is not a firmware report of the physical LED pin.` : 'No current Electron diagnostic phase is assigned to this LED.',
      source:'electron-observed',
      lastUpdated:progress.timestamp
    };
  }
  function componentLiveState(id){
    const reported=state.snapshot?.components?.[id] || null;
    if(/^led-[a-d]$/.test(id) && state.diagnosticProgress?.source==='firmware-commanded-test' && state.diagnosticProgress?.componentId===id){
      return diagnosticLedState(id);
    }
    if(reported?.source==='firmware-reported') return reported;
    if(state.ledTestActiveId===id){
      return {status:'diagnostic-active',source:'electron-observed',telemetry:{test:'bounded-led-identification'},detail:'A bounded physical LED identification test is running. Firmware restores the previous LED outputs automatically.',lastUpdated:new Date().toISOString()};
    }
    // Electron knows its own workflow phase, but Iceman may drive a different
    // physical LED pattern internally. Keep photographed A-D LEDs off/unknown
    // until the firmware reports their GPIO output state.
    if(/^led-[a-d]$/.test(id)) return reported;
    return diagnosticLedState(id) || reported;
  }
  function learningFor(id){ return state.learning?.[id] || {}; }
  function relatedComponents(component){
    const ids=learningFor(component?.id).related || [];
    return ids.map(componentById).filter(Boolean);
  }
  function statusClass(status){
    if(["connected","alive","configured","measured","powered","reported","inferred-on","diagnostic-active","on"].includes(status)) return "live";
    if(["disconnected","fault"].includes(status)) return "fault";
    return "unknown";
  }
  function formatValue(value, suffix=""){
    if(value===null || value===undefined || value==="") return "Unknown";
    return `${value}${suffix}`;
  }
  function hotspotStyle(hotspot){
    const common=`left:${Number(hotspot.x)||0}%;top:${Number(hotspot.y)||0}%;${hotspotColor(hotspot)?`--device-hotspot-color:${hotspotColor(hotspot)};`:""}--device-hotspot-stroke-width:${hotspotStrokeWidth(hotspot)}px;`;
    if(hotspot.shape==="rect"){
      return `${common}width:${Number(hotspot.w)||8}%;height:${Number(hotspot.h)||8}%;`;
    }
    if(hotspot.shape==="ellipse"){
      const rx=Number(hotspot.rx)||5, ry=Number(hotspot.ry)||5;
      return `${common}left:${(Number(hotspot.x)||0)-rx}%;top:${(Number(hotspot.y)||0)-ry}%;width:${rx*2}%;height:${ry*2}%;border-radius:999px;`;
    }
    const r=Number(hotspot.r)||5;
    return `${common}width:${r*2}%;height:auto;min-height:0;aspect-ratio:1 / 1;transform:translate(-50%,-50%);border-radius:999px;`;
  }
  function clamp(value,minimum=0,maximum=100){ return Math.max(minimum,Math.min(maximum,Number(value)||0)); }
  function hotspotColor(hotspot){
    const color=String(hotspot?.color || hotspot?.markerColor || "");
    return /^#[0-9a-f]{6}$/i.test(color) ? color : "";
  }
  function hotspotLineColor(hotspot){
    const color=String(hotspot?.lineColor || hotspotColor(hotspot) || "");
    return /^#[0-9a-f]{6}$/i.test(color) ? color : "#38bdf8";
  }
  function hotspotMarkerColor(hotspot){
    const color=String(hotspot?.markerColor || hotspotColor(hotspot) || "");
    return /^#[0-9a-f]{6}$/i.test(color) ? color : "#38bdf8";
  }
  function hotspotStrokeWidth(hotspot){
    const width=Number(hotspot?.strokeWidth);
    return Number.isFinite(width) ? clamp(width,.5,12) : 3;
  }
  function editorHotspot(){
    const index=state.hotspotEditor.selectedIndex;
    const hotspot=state.hotspots[index];
    return hotspot && hotspot.imageId===state.activeImageId && ["point","rect","circle","ellipse"].includes(hotspot.shape) ? hotspot : null;
  }
  function syncHotspotEditorSelection(){
    if(!state.hotspotEditor.enabled) return;
    state.hotspotEditor.selectedIndex=state.hotspots.findIndex(item=>item.imageId===state.activeImageId && item.componentId===state.activeComponentId && ["point","rect","circle","ellipse"].includes(item.shape));
  }
  function editorShapeStyle(hotspot){
    const color=hotspotColor(hotspot) || "#facc15";
    const common=`--editor-shape-color:${color};--editor-shape-stroke-width:${hotspotStrokeWidth(hotspot)}px;`;
    if(hotspot.shape==="rect") return `${common}left:${hotspot.x}%;top:${hotspot.y}%;width:${hotspot.w}%;height:${hotspot.h}%;`;
    if(hotspot.shape==="ellipse") return `${common}left:${hotspot.x-hotspot.rx}%;top:${hotspot.y-hotspot.ry}%;width:${hotspot.rx*2}%;height:${hotspot.ry*2}%;border-radius:999px;`;
    return `${common}left:${hotspot.x}%;top:${hotspot.y}%;width:${hotspot.r*2}%;height:auto;aspect-ratio:1 / 1;transform:translate(-50%,-50%);border-radius:999px;`;
  }
  function shapeCalloutAnchor(hotspot){
    const customX=Number(hotspot.calloutAnchorX);
    const customY=Number(hotspot.calloutAnchorY);
    if(Number.isFinite(customX) && Number.isFinite(customY)) return {x:customX,y:customY};
    if(hotspot.shape==="rect") return {x:(Number(hotspot.x)||0)+((Number(hotspot.w)||0)/2),y:(Number(hotspot.y)||0)+((Number(hotspot.h)||0)/2)};
    return {x:Number(hotspot.x)||0,y:Number(hotspot.y)||0};
  }
  function snapShapeCalloutAnchor(hotspot, candidate, board){
    const x=clamp(candidate.x);
    const y=clamp(candidate.y);
    const boardRect=board?.getBoundingClientRect();
    const thresholdX=clamp((10/Math.max(boardRect?.width || 1,1))*100,.4,3);
    const thresholdY=clamp((10/Math.max(boardRect?.height || 1,1))*100,.4,3);
    if(hotspot.shape==="rect"){
      const left=Number(hotspot.x)||0;
      const top=Number(hotspot.y)||0;
      const right=left+(Number(hotspot.w)||0);
      const bottom=top+(Number(hotspot.h)||0);
      return {
        x:Math.abs(x-left)<=thresholdX ? left : Math.abs(x-right)<=thresholdX ? right : x,
        y:Math.abs(y-top)<=thresholdY ? top : Math.abs(y-bottom)<=thresholdY ? bottom : y
      };
    }
    const centerX=Number(hotspot.x)||0;
    const centerY=Number(hotspot.y)||0;
    const radiusX=hotspot.shape==="circle" ? Number(hotspot.r)||0 : Number(hotspot.rx)||0;
    const aspect=Number(boardRect?.width)/Math.max(Number(boardRect?.height),1);
    const radiusY=hotspot.shape==="circle" ? radiusX*aspect : Number(hotspot.ry)||0;
    if(!radiusX || !radiusY) return {x,y};
    const dx=x-centerX;
    const dy=y-centerY;
    const distance=Math.hypot(dx/radiusX,dy/radiusY);
    if(distance<.0001) return {x,y};
    const edgeX=centerX+(dx/distance);
    const edgeY=centerY+(dy/distance);
    const distanceToEdge=Math.hypot(((edgeX-x)/100)*(boardRect?.width || 0),((edgeY-y)/100)*(boardRect?.height || 0));
    return distanceToEdge<=10 ? {x:edgeX,y:edgeY} : {x,y};
  }
  function editorHandleMarkup(shape){
    return "";
  }
  function editorCalloutMarkup(hotspot){
    const layout=getSmartCalloutLayout(hotspot);
    const markerSize=Number(hotspot.markerSize) || 2;
    const markerColor=hotspotMarkerColor(hotspot);
    const isLed=/^(power-led|led-[a-d])$/.test(hotspot.componentId);
    const component=componentById(hotspot.componentId);
    const live=componentLiveState(hotspot.componentId);
    const label=escapeHtml(component?.displayName || hotspot.componentId);
    const detail=isLed ? "" : `<i>${escapeHtml(live?.status || "unknown")}</i>`;
    const labelPreview=`<button type="button" class="deviceStudioCalloutLabel ${escapeHtml(hotspot.side || "right")} deviceStudioEditorLabelPreview" style="${calloutLabelStyle(hotspot)}" data-hotspot-editor-callout-drag="label" title="Drag the real label preview">${label}${detail}<span class="deviceStudioEditorLabelMoveHandle">+</span></button>`;
    const linePreview=`<span class="deviceStudioEditorCalloutPreviewLine" style="${calloutLineStyle(hotspot)}"></span>`;
    if(isLed){
      const width=Number(hotspot.markerWidth) || 3.2;
      const height=Number(hotspot.markerHeight) || 2.4;
      return `<div class="deviceStudioEditorLedShape" style="left:${layout.markerX}%;top:${layout.markerY}%;--editor-led-width:${width}%;--editor-led-height:${height}%;--editor-marker-color:${markerColor};" data-hotspot-editor-callout-drag="marker" title="Drag inside to move; drag an edge to resize"></div>${linePreview}${labelPreview}`;
    }
    return `<div class="deviceStudioEditorCalloutMarker ${hotspot.markerShape==="rect"?"rect":""}" style="left:${layout.markerX}%;top:${layout.markerY}%;--editor-marker-size:${markerSize}%;--editor-marker-color:${markerColor};--editor-marker-stroke-width:${hotspotStrokeWidth(hotspot)}px;" data-hotspot-editor-callout-drag="marker" title="Drag marker"><button type="button" class="deviceStudioEditorCalloutResize" data-hotspot-editor-callout-drag="resize" aria-label="Resize marker"></button></div>${linePreview}${labelPreview}`;
  }
  function editorShapeCalloutMarkup(hotspot){
    const component=componentById(hotspot.componentId);
    const live=componentLiveState(hotspot.componentId);
    const label=escapeHtml(component?.displayName || hotspot.componentId);
    const detail=`<i>${escapeHtml(live?.status || "unknown")}</i>`;
    const layout=getSmartCalloutLayout(hotspot);
    return `<button type="button" class="deviceStudioEditorShapeCalloutAnchor" style="left:${layout.markerX}%;top:${layout.markerY}%;--editor-callout-anchor-color:${hotspotLineColor(hotspot)};" data-hotspot-editor-callout-drag="anchor" title="Drag this cross to choose where the line starts"></button><span class="deviceStudioEditorCalloutPreviewLine" style="${calloutLineStyle(hotspot)}"></span><button type="button" class="deviceStudioCalloutLabel ${escapeHtml(hotspot.side || "right")} deviceStudioEditorLabelPreview" style="${calloutLabelStyle(hotspot)}" data-hotspot-editor-callout-drag="label" title="Drag the final text label">${label}${detail}<span class="deviceStudioEditorLabelMoveHandle">+</span></button>`;
  }
  function editorPanelStyle(name){
    const offset=state.hotspotEditor.panelOffsets?.[name] || {x:0,y:0};
    return `--editor-panel-x:${Number(offset.x)||0}px;--editor-panel-y:${Number(offset.y)||0}px;`;
  }
  function renderHotspotEditor(){
    if(!state.hotspotEditor.enabled) return "";
    const component=componentById(state.activeComponentId);
    const hotspot=editorHotspot();
    const menu=state.hotspotEditor.menu;
    const pointer=hotspot?.shape==="point";
    const shapeCallout=!!hotspot?.showCallout;
    const colour=hotspotColor(hotspot) || "#38bdf8";
    const markerColour=hotspotMarkerColor(hotspot);
    const lineColour=hotspotLineColor(hotspot);
    const strokeWidth=hotspotStrokeWidth(hotspot);
    const componentOptions=state.components.map(item=>`<option value="${escapeHtml(item.id)}" ${item.id===state.activeComponentId?"selected":""}>${escapeHtml(item.displayName || item.id)}</option>`).join("");
    return `<div class="deviceStudioHotspotEditor" aria-label="Developer hotspot editor">
      <div class="deviceStudioEditorToolbar" data-hotspot-editor-panel="toolbar" style="${editorPanelStyle("toolbar")}"><span class="deviceStudioEditorPanelGrip" data-hotspot-editor-panel-drag="toolbar" title="Drag this panel">⠿</span><div class="deviceStudioEditorToolbarContent"><b>Developer calibration</b><span>${escapeHtml(component?.displayName || "Select a component")}</span><small>${escapeHtml(state.hotspotEditor.status || "Right-click to add a shape, or a callout pointer (dot + line + label).")}</small><p class="deviceStudioEditorSaveHint">All changes stay local while you work. Adjust any shapes, lines and text labels, then click <strong>Save layout</strong> once when the whole photo is correct.</p><label class="deviceStudioEditorGuideToggle"><input type="checkbox" data-hotspot-editor-show-guides ${state.hotspotEditor.showGuides?"checked":""}> Show all annotations</label><div class="deviceStudioEditorToolbarActions">${hotspot?`<button type="button" class="deviceStudioEditorDelete" data-hotspot-editor-delete>Delete shape</button>`:""}<button type="button" data-hotspot-editor-save ${state.hotspotEditor.saving?"disabled":""}>${state.hotspotEditor.saving?"Saving…":"Save layout"}</button></div></div></div>
      <aside class="deviceStudioEditorComponentPicker" data-hotspot-editor-panel="picker" style="${editorPanelStyle("picker")}" aria-label="Choose component to calibrate"><span class="deviceStudioEditorPanelGrip" data-hotspot-editor-panel-drag="picker" title="Drag this panel">⠿</span><label for="deviceStudioEditorComponentSelect">Component</label><select id="deviceStudioEditorComponentSelect" data-hotspot-editor-component size="7">${componentOptions}</select><form class="deviceStudioEditorAddComponent" data-hotspot-editor-add-component><input type="text" maxlength="96" placeholder="New component name" data-hotspot-editor-new-component-name aria-label="New component name"><input type="text" maxlength="48" placeholder="Category (optional)" data-hotspot-editor-new-component-category aria-label="Component category"><button type="submit">Add to list</button></form>${hotspot?`<div class="deviceStudioEditorMarkerControls">${pointer?`<label>Dot colour<input type="color" value="${markerColour}" data-hotspot-editor-marker-color aria-label="Dot colour"></label><label>Line colour<input type="color" value="${lineColour}" data-hotspot-editor-line-color aria-label="Line colour"></label>`:`<label>Shape colour<input type="color" value="${colour}" data-hotspot-editor-shape-color aria-label="Shape colour"></label><label class="deviceStudioEditorGuideToggle"><input type="checkbox" data-hotspot-editor-shape-callout ${shapeCallout?"checked":""}> Label + line</label>${shapeCallout?`<label>Line colour<input type="color" value="${lineColour}" data-hotspot-editor-line-color aria-label="Line colour"></label>`:""}`}<label class="deviceStudioEditorStrokeControl">${pointer?"Line thickness":shapeCallout?"Outline & line thickness":"Outline thickness"}<input type="range" min="0.5" max="12" step="0.5" value="${strokeWidth}" data-hotspot-editor-stroke-width aria-label="Line thickness"><output>${strokeWidth}px</output></label>${pointer?`<label>Pointer<select data-hotspot-editor-marker-shape><option value="dot" ${hotspot.markerShape==="rect"?"":"selected"}>Dot</option><option value="rect" ${hotspot.markerShape==="rect"?"selected":""}>Rectangle</option></select></label>`:""}</div>`:""}<small>${pointer?"Dot, line colour and thickness are stored separately with this pointer.":shapeCallout?"The shape stays on the component. Drag its text label independently; the line follows the shape.":"Shape colour and thickness are stored with this hotspot."}</small></aside>
      ${pointer?editorCalloutMarkup(hotspot):hotspot?`<div class="deviceStudioEditorShape ${hotspot.shape}" style="${editorShapeStyle(hotspot)}" data-hotspot-editor-drag="move" title="Drag to move">${editorHandleMarkup(hotspot.shape)}</div>${shapeCallout?editorShapeCalloutMarkup(hotspot):""}`:""}
      ${menu?`<div class="deviceStudioEditorMenu" style="left:${menu.x}%;top:${menu.y}%;"><b>Add ${escapeHtml(component?.displayName || "component")}</b><button type="button" data-hotspot-editor-create="rect">Rectangle</button><button type="button" data-hotspot-editor-create="circle">Circle</button><button type="button" data-hotspot-editor-create="ellipse">Ellipse</button><button type="button" data-hotspot-editor-create="point">Callout pointer (dot + line + label)</button><button type="button" data-hotspot-editor-menu-close>Cancel</button></div>`:""}
    </div>`;
  }
  function getSmartCalloutLayout(hotspot){
    const side=hotspot.side || "right";
    const order=Number(hotspot.order || 1);
    const anchor=hotspot.showCallout && hotspot.shape!=="point" ? shapeCalloutAnchor(hotspot) : {x:hotspot.markerX ?? hotspot.x,y:hotspot.markerY ?? hotspot.y};
    const x=Number(anchor.x) || 0;
    const y=Number(anchor.y) || 0;
    const customLabelX=Number(hotspot.labelX);
    const customLabelY=Number(hotspot.labelY);
    if(Number.isFinite(customLabelX) && Number.isFinite(customLabelY)) return {labelX:customLabelX,labelY:customLabelY,side:hotspot.side || "right",markerX:x,markerY:y,customLabel:true};

    const leftY={1:54,2:78,3:95};
    const rightY={1:53,2:59,3:78,4:86,5:94};
    const bottomX={1:31,2:51,3:60,4:72,5:82};

    if(side==="top") return {labelX:50,labelY:4,side:"top",markerX:x,markerY:y};
    if(side==="left") return {labelX:-8,labelY:leftY[order] ?? y,side:"left",markerX:x,markerY:y};
    if(side==="right") return {labelX:108,labelY:rightY[order] ?? y,side:"right",markerX:x,markerY:y};
    if(side==="bottom"){
      const bottomY={1:103,2:103,3:110,4:103,5:110};
      return {labelX:bottomX[order] ?? x,labelY:bottomY[order] ?? 106,side:"bottom",markerX:x,markerY:y};
    }
    return {labelX:108,labelY:y,side:"right",markerX:x,markerY:y};
  }
  function calloutMarkerStyle(hotspot){
    const layout=getSmartCalloutLayout(hotspot);
    const size=Number(hotspot.markerSize);
    const color=hotspotMarkerColor(hotspot);
    const width=Number(hotspot.markerWidth);
    const height=Number(hotspot.markerHeight);
    return `left:${layout.markerX}%;top:${layout.markerY}%;${Number.isFinite(size)?`--device-callout-marker-size:${size}%;`:""}${Number.isFinite(width)?`--device-led-w:${width}%;`:""}${Number.isFinite(height)?`--device-led-h:${height}%;`:""}${color?`--device-callout-marker-color:${color};`:""}--device-callout-stroke-width:${hotspotStrokeWidth(hotspot)}px;`;
  }
    function calloutLabelStyle(hotspot){
      const layout=getSmartCalloutLayout(hotspot);
      if(layout.customLabel) return `left:${layout.labelX}%;top:${layout.labelY}%;transform:translate(-50%,-50%);`;
      const offset=hotspot.labelOffset || {};
      const offsetX=Number(offset.x || 0);
      const offsetY=Number(offset.y || 0);
      return `left:calc(${layout.labelX}% + ${offsetX}px);top:calc(${layout.labelY}% + ${offsetY}px);`;

    }
    function imageMetricsFor(imageId){
      const image=imageById(imageId);
      const measured=state.imageMetrics[imageId] || {};
      const width=Number(image?.width) || Number(measured.width) || 976;
      const height=Number(image?.height) || Number(measured.height) || 1536;
      return {width,height,verticalScale:height/width};
    }
    function calloutLineStyle(hotspot){
      const layout = getSmartCalloutLayout(hotspot);
      const offset = hotspot.labelOffset || {};
      const offsetX = Number(offset.x || 0);
      const offsetY = Number(offset.y || 0);
      const metrics=imageMetricsFor(hotspot.imageId);
      const labelX = layout.labelX + ((offsetX / metrics.width) * 100);
      const labelY = layout.labelY + ((offsetY / metrics.height) * 100);
      let targetX = layout.customLabel ? layout.labelX : labelX + 4.5;
      let targetY = layout.customLabel ? layout.labelY : labelY + 1.2;
      // Kleine correctie voor LED B zodat de lijn
      // precies in het midden van de textbox uitkomt.
      if (hotspot.componentId === "led-b") {
        targetX = labelX + 3.7;
      }

      const dx = targetX - layout.markerX;
      const dy = (targetY - layout.markerY) * metrics.verticalScale;
      const length = Math.sqrt((dx * dx) + (dy * dy));
      const angle = Math.atan2(dy, dx) * 180 / Math.PI;

      const color=`background:${hotspotLineColor(hotspot)};`;
      return `left:${layout.markerX}%;top:${layout.markerY}%;width:${length}%;height:${hotspotStrokeWidth(hotspot)}px;transform:rotate(${angle}deg);${color}`;

    }
    function calloutLabelEdge(markerCenter,labelRect){
      const centerX=labelRect.left+(labelRect.width/2);
      const centerY=labelRect.top+(labelRect.height/2);
      const dx=centerX-markerCenter.x;
      const dy=centerY-markerCenter.y;
      if(!dx && !dy) return {x:centerX,y:centerY};
      const scale=Math.min(
        dx ? (labelRect.width/2)/Math.abs(dx) : Infinity,
        dy ? (labelRect.height/2)/Math.abs(dy) : Infinity
      );
      return {x:centerX-(dx*scale),y:centerY-(dy*scale)};
    }
    function snapCalloutLineToLabel(marker,line,label,boardWrap){
      const boardRect=boardWrap.getBoundingClientRect();
      if(!boardRect.width || !boardRect.height) return;
      const markerRect=marker.getBoundingClientRect();
      const labelRect=label.getBoundingClientRect();
      const markerCenter={
        x:markerRect.left+(markerRect.width/2)-boardRect.left,
        y:markerRect.top+(markerRect.height/2)-boardRect.top
      };
      // A line that starts on a shape edge needs a tiny inward overlap. It
      // avoids a visible anti-aliasing gap without changing the saved anchor.
      if(marker.classList.contains('deviceStudioShapeCalloutAnchor')){
        const componentId=marker.closest('.deviceStudioCallout')?.dataset.deviceStudioComponent || "";
        const shape=componentId ? boardWrap.querySelector(`.deviceStudioHotspot[data-device-studio-component="${CSS.escape(componentId)}"]`) : null;
        const shapeRect=shape?.getBoundingClientRect();
        if(shapeRect){
          const centerX=shapeRect.left+(shapeRect.width/2)-boardRect.left;
          const centerY=shapeRect.top+(shapeRect.height/2)-boardRect.top;
          const inwardX=centerX-markerCenter.x;
          const inwardY=centerY-markerCenter.y;
          const inwardLength=Math.hypot(inwardX,inwardY);
          if(inwardLength>0){
            const overlap=Math.min(1.5,inwardLength);
            markerCenter.x+=(inwardX/inwardLength)*overlap;
            markerCenter.y+=(inwardY/inwardLength)*overlap;
          }
        }
      }
      const localLabel={
        left:labelRect.left-boardRect.left,
        top:labelRect.top-boardRect.top,
        width:labelRect.width,
        height:labelRect.height
      };
      const edge=calloutLabelEdge(markerCenter,localLabel);
      const dx=edge.x-markerCenter.x;
      const dy=edge.y-markerCenter.y;
      line.style.left=`${markerCenter.x}px`;
      // transform-origin is on the line's vertical centre, not its top edge.
      line.style.top=`${markerCenter.y-(line.offsetHeight/2)}px`;
      line.style.width=`${Math.hypot(dx,dy)}px`;
      line.style.transform=`rotate(${Math.atan2(dy,dx)*180/Math.PI}deg)`;
      line.style.transformOrigin="0 50%";
    }
    function refreshCalloutVisualLines(boardWrap){
      if(!boardWrap?.isConnected) return;
      boardWrap.querySelectorAll('.deviceStudioCallout').forEach(callout=>{
        const marker=callout.querySelector('.deviceStudioPhotoLed, .deviceStudioCalloutDot, .deviceStudioShapeCalloutAnchor');
        const line=callout.querySelector('.deviceStudioCalloutLine');
        const label=callout.querySelector('.deviceStudioCalloutLabel');
        if(marker && line && label) snapCalloutLineToLabel(marker,line,label,boardWrap);
      });
      const layer=boardWrap.querySelector('.deviceStudioHotspotLayer');
      const marker=layer?.querySelector('.deviceStudioEditorLedShape, .deviceStudioEditorCalloutMarker, .deviceStudioEditorShapeCalloutAnchor');
      const line=layer?.querySelector('.deviceStudioEditorCalloutPreviewLine');
      const label=layer?.querySelector('.deviceStudioEditorLabelPreview');
      if(marker && line && label) snapCalloutLineToLabel(marker,line,label,boardWrap);
    }
    function scheduleCalloutLineRefresh(boardWrap){
      if(state.calloutLineFrame) cancelAnimationFrame(state.calloutLineFrame);
      state.calloutLineFrame=requestAnimationFrame(()=>{
        state.calloutLineFrame=null;
        refreshCalloutVisualLines(boardWrap);
      });
    }
  function labelOffset(position){
    if(position==="left") return "left";
    if(position==="right") return "right";
    if(position==="bottom") return "bottom";
    return "top";
  }
  function renderImageCategories(){
    const wrap=document.getElementById("deviceStudioCategories");
    if(!wrap) return;
    wrap.innerHTML=categories().map(category=>`
      <button type="button" class="deviceStudioCategoryBtn" data-device-studio-category="${escapeHtml(category)}">${escapeHtml(category)}</button>
    `).join("");
    wrap.querySelectorAll("[data-device-studio-category]").forEach(btn=>{
      btn.onclick=()=>{
        const image=state.images.find(item=>(item.category || "Other")===btn.dataset.deviceStudioCategory);
        if(image) selectImage(image.id);
      };
    });
  }
  function renderImageGallery(){
    const wrap=document.getElementById("deviceStudioGallery");
    if(!wrap) return;
    wrap.innerHTML=state.images.map(image=>`
      <button type="button" class="deviceStudioThumb ${image.id===state.activeImageId ? "active" : ""}" data-device-studio-image="${escapeHtml(image.id)}">
        <img src="${DEVICE_BASE}${escapeHtml(image.file)}" alt="${escapeHtml(image.title)}">
        <span>${escapeHtml(image.title)}</span>
      </button>
    `).join("");
    wrap.querySelectorAll("[data-device-studio-image]").forEach(btn=>{
      btn.onclick=()=>selectImage(btn.dataset.deviceStudioImage);
    });
  }
  function renderComponentList(){
    const wrap=document.getElementById("deviceStudioComponentList");
    if(!wrap) return;
    const grouped=state.components.reduce((acc,item)=>{
      const key=item.category || "Other";
      if(!acc[key]) acc[key]=[];
      acc[key].push(item);
      return acc;
    }, {});
    wrap.innerHTML=Object.entries(grouped).map(([category, items])=>`
      <div class="deviceStudioComponentGroup">
        <h4>${escapeHtml(category)}</h4>
        ${items.map(item=>`
          <button type="button" class="deviceStudioComponentBtn ${item.id===state.activeComponentId ? "active" : ""}" data-device-studio-component="${escapeHtml(item.id)}" aria-pressed="${item.id===state.activeComponentId ? "true" : "false"}">
            <span>${escapeHtml(item.displayName)}</span>
            <small>${escapeHtml(item.identificationConfidence || "unknown")} confidence</small>
          </button>
        `).join("")}
      </div>
    `).join("");
  }
  function renderStage(){
    const stage=document.getElementById("deviceStudioStage");
    if(!stage) return;
    if(state.calloutLineFrame){
      cancelAnimationFrame(state.calloutLineFrame);
      state.calloutLineFrame=null;
    }
    state.imageFitObserver?.disconnect();
    state.imageFitObserver=null;
    const image=imageById(state.activeImageId);
    if(!image){
      stage.innerHTML=`<div class="deviceStudioEmpty">No Device Studio images loaded.</div>`;
      return;
    }
    const hotspots=hotspotsForImage(image.id);
    stage.innerHTML=`
      <div class="deviceStudioImageFrame">
        <div class="deviceStudioBoardWrap ${state.hotspotEditor.enabled ? "deviceStudioBoardWrap-calibrating" : ""} ${state.hotspotEditor.showGuides ? "deviceStudioBoardWrap-show-guides" : ""}">
          <img src="${DEVICE_BASE}${escapeHtml(image.file)}" alt="${escapeHtml(image.title)}">
          <div class="deviceStudioHotspotLayer">
            ${hotspots.map(hotspot=>{
              const component=componentById(hotspot.componentId);
              const live=componentLiveState(hotspot.componentId);
              const simulated=state.simulationComponentId===hotspot.componentId;
              const active=hotspot.componentId===state.activeComponentId;
              const name=component?.displayName || hotspot.componentId;
              const liveClass=simulated ? "deviceStudioState-simulated" : live ? `deviceStudioState-${statusClass(live.status)}` : "deviceStudioState-unknown";
              const liveTitle=simulated ? `${name}: simulated behaviour. No hardware control.` : live ? `${name}: ${live.status}. ${live.detail||""}` : `${name}: live status unknown`;
              const isLed=["power-led","led-a","led-b","led-c","led-d"].includes(hotspot.componentId);
              if(hotspot.display==="smart-callout" || hotspot.display==="auto-callout" || hotspot.display==="callout" || hotspot.shape==="point"){
                return `<div class="deviceStudioCallout ${active ? "active" : ""} ${liveClass} ${state.hotspotEditor.enabled && active ? "deviceStudioEditorSelectedSource" : ""}" data-device-studio-component="${escapeHtml(hotspot.componentId)}" title="${escapeHtml(liveTitle)}">
                  ${isLed?`<span class="deviceStudioPhotoLed" style="${calloutMarkerStyle(hotspot)}" aria-label="${escapeHtml(liveTitle)}" role="button"></span>`:`<button type="button" class="deviceStudioCalloutDot ${hotspot.markerShape==="rect"?"rect":""}" style="${calloutMarkerStyle(hotspot)}" aria-label="${escapeHtml(liveTitle)}"></button>`}
                  <span class="deviceStudioCalloutLine" style="${calloutLineStyle(hotspot)}"></span>
                  <button type="button" class="deviceStudioCalloutLabel ${escapeHtml(hotspot.side || "right")}" style="${calloutLabelStyle(hotspot)}">${escapeHtml(name)}${isLed?"":`<i>${escapeHtml(simulated?"simulation":live?.status || "unknown")}</i>`}</button>
                </div>`;
              }
              const shape=`<button type="button" class="deviceStudioHotspot ${active ? "active" : ""} ${liveClass} ${state.hotspotEditor.enabled && active ? "deviceStudioEditorSelectedSource" : ""} ${escapeHtml(labelOffset(hotspot.labelPosition))}" style="${hotspotStyle(hotspot)}" data-device-studio-component="${escapeHtml(hotspot.componentId)}" aria-label="${escapeHtml(liveTitle)}" title="${escapeHtml(liveTitle)}">
                ${hotspot.showCallout ? "" : `<span>${escapeHtml(name)} · ${escapeHtml(simulated?"simulation":live?.status || "unknown")}</span>`}
              </button>`;
              if(!hotspot.showCallout) return shape;
              const calloutLayout=getSmartCalloutLayout(hotspot);
              return `${shape}<div class="deviceStudioCallout deviceStudioShapeCallout ${active ? "active" : ""} ${liveClass}" data-device-studio-component="${escapeHtml(hotspot.componentId)}" title="${escapeHtml(liveTitle)}">
                <span class="deviceStudioShapeCalloutAnchor" style="left:${calloutLayout.markerX}%;top:${calloutLayout.markerY}%;"></span>
                <span class="deviceStudioCalloutLine" style="${calloutLineStyle(hotspot)}"></span>
                <button type="button" class="deviceStudioCalloutLabel ${escapeHtml(hotspot.side || "right")}" style="${calloutLabelStyle(hotspot)}">${escapeHtml(name)}<i>${escapeHtml(simulated?"simulation":live?.status || "unknown")}</i></button>
              </div>`;
            }).join("")}
            ${renderHotspotEditor()}
          </div>
        </div>
      </div>
      <div class="deviceStudioImageCaption">
        <b>${escapeHtml(image.title)}</b>
        <span>${escapeHtml(image.description || "")}</span>
      </div>
    `;
    bindHotspotEditor(stage);
    fitStageImage(stage);
  }
  function fitStageImage(stage){
    const frame=stage.querySelector('.deviceStudioImageFrame');
    const board=stage.querySelector('.deviceStudioBoardWrap');
    const image=board?.querySelector('img');
    if(!frame || !board || !image) return;
    const fit=()=>{
      const naturalWidth=image.naturalWidth;
      const naturalHeight=image.naturalHeight;
      if(!naturalWidth || !naturalHeight) return;
      const previousMetrics=state.imageMetrics[image.id];
      if(!previousMetrics || previousMetrics.width!==naturalWidth || previousMetrics.height!==naturalHeight){
        state.imageMetrics[image.id]={width:naturalWidth,height:naturalHeight};
        renderStage();
        return;
      }
      // Keep the deliberately compact Studio photo scale while making the
      // board wrapper exactly match the rendered image at every window size.
      const availableWidth=Math.min(760,Math.max(1,frame.clientWidth-36));
      const availableHeight=Math.min(590,Math.max(1,frame.clientHeight-36));
      const scale=Math.min(availableWidth/naturalWidth,availableHeight/naturalHeight);
      board.style.width=`${Math.max(1,Math.floor(naturalWidth*scale))}px`;
      board.style.height=`${Math.max(1,Math.floor(naturalHeight*scale))}px`;
      scheduleCalloutLineRefresh(board);
    };
    if(image.complete) fit();
    else image.addEventListener('load',fit,{once:true});
    if(window.ResizeObserver){
      state.imageFitObserver=new ResizeObserver(fit);
      state.imageFitObserver.observe(frame);
    }else window.addEventListener('resize',fit,{once:true});
  }
  function editorPointerPosition(event, board){
    const rect=board.getBoundingClientRect();
    return {x:((event.clientX-rect.left)/rect.width)*100,y:((event.clientY-rect.top)/rect.height)*100,aspect:rect.width/rect.height};
  }
  function createEditorHotspot(shape, position){
    const index=state.hotspots.findIndex(item=>item.imageId===state.activeImageId && item.componentId===state.activeComponentId && ["point","rect","circle","ellipse"].includes(item.shape));
    const hotspot=shape==="circle"
      ? {componentId:state.activeComponentId,imageId:state.activeImageId,shape:"circle",x:clamp(position.x,6,94),y:clamp(position.y,6*position.aspect,100-(6*position.aspect)),r:6,aspect:position.aspect,labelPosition:"bottom",color:"#38bdf8",strokeWidth:3}
      : shape==="ellipse"
        ? {componentId:state.activeComponentId,imageId:state.activeImageId,shape:"ellipse",x:clamp(position.x,8,92),y:clamp(position.y,6,94),rx:8,ry:6,labelPosition:"bottom",color:"#38bdf8",strokeWidth:3}
        : shape==="point"
          ? {componentId:state.activeComponentId,imageId:state.activeImageId,shape:"point",display:"smart-callout",markerX:clamp(position.x),markerY:clamp(position.y),labelX:clamp(position.x+14,-40,140),labelY:clamp(position.y,-30,130),markerShape:"dot",markerSize:2,markerColor:"#38bdf8",color:"#38bdf8",lineColor:"#38bdf8",strokeWidth:3}
          : {componentId:state.activeComponentId,imageId:state.activeImageId,shape:"rect",x:clamp(position.x,0,88),y:clamp(position.y,0,88),w:12,h:12,labelPosition:"bottom",color:"#38bdf8",strokeWidth:3};
    if(index>=0){ state.hotspots[index]=hotspot; state.hotspotEditor.selectedIndex=index; }
    else { state.hotspots.push(hotspot); state.hotspotEditor.selectedIndex=state.hotspots.length-1; }
    state.hotspotEditor.menu=null;
    state.hotspotEditor.status=`${({rect:"Rectangle",circle:"Circle",ellipse:"Ellipse",point:"Pointer"}[shape] || "Shape")} added. Drag it or use the handles, then save.`;
    renderStage();
  }
  function resizeEditorHotspot(start, handle, point){
    if(start.shape==="circle"){
      const verticalRadius=start.r*point.aspect;
      if(handle==="move"){
        const dx=point.x-start.pointer.x;
        const dy=point.y-start.pointer.y;
        return {...start,x:clamp(start.x+dx,start.r,100-start.r),y:clamp(start.y+dy,verticalRadius,100-verticalRadius),aspect:point.aspect};
      }
      const radius=Math.max(.25,Math.max(Math.abs(point.x-start.x),Math.abs(point.y-start.y)/point.aspect));
      const maxRadius=Math.min(start.x,100-start.x,start.y/point.aspect,(100-start.y)/point.aspect);
      return {...start,r:clamp(radius,.25,maxRadius),aspect:point.aspect};
    }
    if(start.shape==="ellipse"){
      if(handle==="move"){
        const dx=point.x-start.pointer.x, dy=point.y-start.pointer.y;
        return {...start,x:clamp(start.x+dx,start.rx,100-start.rx),y:clamp(start.y+dy,start.ry,100-start.ry)};
      }
      let left=start.x-start.rx, top=start.y-start.ry, right=start.x+start.rx, bottom=start.y+start.ry;
      if(handle.includes("w")) left=clamp(point.x,0,right-.25);
      if(handle.includes("e")) right=clamp(point.x,left+.25,100);
      if(handle.includes("n")) top=clamp(point.y,0,bottom-.25);
      if(handle.includes("s")) bottom=clamp(point.y,top+.25,100);
      return {...start,x:(left+right)/2,y:(top+bottom)/2,rx:(right-left)/2,ry:(bottom-top)/2};
    }
    if(handle==="move"){
      const dx=point.x-start.pointer.x;
      const dy=point.y-start.pointer.y;
      return {...start,x:clamp(start.x+dx,0,100-start.w),y:clamp(start.y+dy,0,100-start.h)};
    }
    let left=start.x, top=start.y, right=start.x+start.w, bottom=start.y+start.h;
    if(handle.includes("w")) left=clamp(point.x,0,right-.25);
    if(handle.includes("e")) right=clamp(point.x,left+.25,100);
    if(handle.includes("n")) top=clamp(point.y,0,bottom-.25);
    if(handle.includes("s")) bottom=clamp(point.y,top+.25,100);
    return {...start,x:left,y:top,w:right-left,h:bottom-top};
  }
  function editorResizeMode(event, element, shape){
    const rect=element.getBoundingClientRect();
    const x=event.clientX-rect.left, y=event.clientY-rect.top;
    const edge=Math.max(3,Math.min(8,Math.min(rect.width,rect.height)*.22));
    if(shape==="circle"){
      const dx=x-(rect.width/2), dy=y-(rect.height/2);
      const radius=Math.min(rect.width,rect.height)/2;
      return Math.abs(Math.hypot(dx,dy)-radius)<=edge ? "radius" : "move";
    }
    const horizontal=x<=edge ? "w" : x>=rect.width-edge ? "e" : "";
    const vertical=y<=edge ? "n" : y>=rect.height-edge ? "s" : "";
    return `${vertical}${horizontal}` || "move";
  }
  function editorCursor(mode){
    if(mode==="move") return "move";
    if(mode==="radius" || mode==="e" || mode==="w") return "ew-resize";
    if(mode==="n" || mode==="s") return "ns-resize";
    return mode==="ne" || mode==="sw" ? "nesw-resize" : "nwse-resize";
  }
  function resizeEditorLedMarker(start, edges, point){
    const width=Number(start.markerWidth)||3.2, height=Number(start.markerHeight)||2.4;
    let left=start.markerX-(width/2), top=start.markerY-(height/2), right=start.markerX+(width/2), bottom=start.markerY+(height/2);
    if(edges.includes("w")) left=clamp(point.x,0,right-.5);
    if(edges.includes("e")) right=clamp(point.x,left+.5,100);
    if(edges.includes("n")) top=clamp(point.y,0,bottom-.5);
    if(edges.includes("s")) bottom=clamp(point.y,top+.5,100);
    return {...start,markerX:(left+right)/2,markerY:(top+bottom)/2,markerWidth:right-left,markerHeight:bottom-top};
  }
  function bindHotspotEditor(stage){
    if(!state.hotspotEditor.enabled) return;
    const board=stage.querySelector('.deviceStudioBoardWrap');
    if(!board) return;
    stage.querySelectorAll('[data-hotspot-editor-panel-drag]').forEach(grip=>grip.addEventListener('pointerdown',event=>{
      if(event.button!==0) return;
      const name=grip.dataset.hotspotEditorPanelDrag;
      const panel=grip.closest('[data-hotspot-editor-panel]');
      if(!name || !panel) return;
      const startOffset=state.hotspotEditor.panelOffsets[name] || {x:0,y:0};
      const startX=event.clientX;
      const startY=event.clientY;
      const move=moveEvent=>{
        const next={x:startOffset.x+(moveEvent.clientX-startX),y:startOffset.y+(moveEvent.clientY-startY)};
        state.hotspotEditor.panelOffsets[name]=next;
        panel.style.setProperty('--editor-panel-x',`${next.x}px`);
        panel.style.setProperty('--editor-panel-y',`${next.y}px`);
        moveEvent.preventDefault();
      };
      const stop=()=>{window.removeEventListener('pointermove',move);window.removeEventListener('pointerup',stop);window.removeEventListener('pointercancel',stop);};
      window.addEventListener('pointermove',move);
      window.addEventListener('pointerup',stop,{once:true});
      window.addEventListener('pointercancel',stop,{once:true});
      event.preventDefault();
      event.stopPropagation();
    }));
    board.addEventListener('contextmenu',event=>{
      if(event.target.closest('.deviceStudioEditorToolbar,.deviceStudioEditorComponentPicker,.deviceStudioEditorMenu')) return;
      event.preventDefault();
      state.hotspotEditor.menu=editorPointerPosition(event,board);
      state.hotspotEditor.status='Choose a shape for the selected component.';
      renderStage();
    });
    stage.querySelector('[data-hotspot-editor-save]')?.addEventListener('click',saveHotspotLayout);
    stage.querySelector('[data-hotspot-editor-delete]')?.addEventListener('click',deleteEditorHotspot);
    stage.querySelector('[data-hotspot-editor-show-guides]')?.addEventListener('change',event=>{
      state.hotspotEditor.showGuides=!!event.target.checked;
      state.hotspotEditor.status=state.hotspotEditor.showGuides?'All other annotations are visible. Drag the label preview to reposition the selected label.':'Other annotations are hidden for precise shape placement.';
      renderStage();
    });
    stage.querySelector('[data-hotspot-editor-component]')?.addEventListener('change',event=>{
      const selectedId=event.target.value;
      if(!componentById(selectedId)) return;
      state.activeComponentId=selectedId;
      state.hotspotEditor.menu=null;
      syncHotspotEditorSelection();
      state.hotspotEditor.status=`Selected ${componentById(selectedId)?.displayName || selectedId} on the current photo.`;
      render();
    });
    stage.querySelector('[data-hotspot-editor-menu-close]')?.addEventListener('click',()=>{state.hotspotEditor.menu=null;renderStage();});
    stage.querySelectorAll('[data-hotspot-editor-create]').forEach(button=>button.addEventListener('click',()=>createEditorHotspot(button.dataset.hotspotEditorCreate,state.hotspotEditor.menu || {x:50,y:50})));
    stage.querySelector('[data-hotspot-editor-marker-shape]')?.addEventListener('change',event=>{
      const current=editorHotspot();
      if(!current || current.shape!=="point") return;
      current.markerShape=event.target.value==="rect"?"rect":"dot";
      state.hotspotEditor.status='Marker shape changed. Save layout to keep it.';
      renderStage();
    });
    stage.querySelector('[data-hotspot-editor-shape-color]')?.addEventListener('input',event=>{
      const current=editorHotspot();
      if(!current || current.shape==="point") return;
      current.color=event.target.value;
      state.hotspotEditor.status='Shape colour changed. Save layout to keep it.';
      renderStage();
    });
    stage.querySelector('[data-hotspot-editor-shape-callout]')?.addEventListener('change',event=>{
      const current=editorHotspot();
      if(!current || current.shape==="point") return;
      current.showCallout=!!event.target.checked;
      if(current.showCallout){
        const anchor=shapeCalloutAnchor(current);
        if(!Number.isFinite(Number(current.labelX))) current.labelX=clamp(anchor.x+14,-40,140);
        if(!Number.isFinite(Number(current.labelY))) current.labelY=clamp(anchor.y,-30,130);
        if(!/^#[0-9a-f]{6}$/i.test(String(current.lineColor || ""))) current.lineColor=hotspotColor(current) || '#38bdf8';
        state.hotspotEditor.status='Label and line added. Drag the label preview to place it.';
      }else state.hotspotEditor.status='Label and line hidden for this shape.';
      renderStage();
    });
    stage.querySelector('[data-hotspot-editor-marker-color]')?.addEventListener('input',event=>{
      const current=editorHotspot();
      if(!current || current.shape!=="point") return;
      current.markerColor=event.target.value;
      state.hotspotEditor.status='Dot colour changed. Save layout to keep it.';
      renderStage();
    });
    stage.querySelector('[data-hotspot-editor-line-color]')?.addEventListener('input',event=>{
      const current=editorHotspot();
      if(!current || (current.shape!=="point" && !current.showCallout)) return;
      current.lineColor=event.target.value;
      state.hotspotEditor.status='Line colour changed. Save layout to keep it.';
      renderStage();
    });
    stage.querySelector('[data-hotspot-editor-add-component]')?.addEventListener('submit',async event=>{
      event.preventDefault();
      const form=event.currentTarget;
      const displayName=String(form.querySelector('[data-hotspot-editor-new-component-name]')?.value || "").trim();
      const category=String(form.querySelector('[data-hotspot-editor-new-component-category]')?.value || "").trim();
      if(!displayName){ state.hotspotEditor.status='Enter a component name first.'; renderStage(); return; }
      if(!window.pm3api?.addDeviceStudioComponent){ state.hotspotEditor.status='This local build cannot add components yet.'; renderStage(); return; }
      state.hotspotEditor.status='Adding local component…';
      renderStage();
      try{
        const result=await window.pm3api.addDeviceStudioComponent({displayName,category});
        if(!result?.ok || !result.component) throw new Error(result?.message || 'Could not add component.');
        state.components=[...state.components.filter(item=>item.id!==result.component.id),result.component];
        state.activeComponentId=result.component.id;
        state.hotspotEditor.status=`Added ${result.component.displayName}. Right-click the photo to add its first shape.`;
      }catch(error){ state.hotspotEditor.status=String(error?.message || error); }
      syncHotspotEditorSelection();
      render();
    });
    stage.querySelector('[data-hotspot-editor-stroke-width]')?.addEventListener('input',event=>{
      const current=editorHotspot();
      if(!current) return;
      current.strokeWidth=clamp(event.target.value,.5,12);
      state.hotspotEditor.status='Line thickness changed. Save layout to keep it.';
      renderStage();
    });
    stage.querySelectorAll('[data-hotspot-editor-callout-drag]').forEach(element=>element.addEventListener('pointerdown',event=>{
      if(event.button!==0) return;
      const source=event.target.closest?.('[data-hotspot-editor-callout-drag]');
      if(source!==element) return;
      const current=editorHotspot();
      if(!current || (current.shape!=="point" && !current.showCallout)) return;
      let action=element.dataset.hotspotEditorCalloutDrag;
      const ledShape=element.classList.contains('deviceStudioEditorLedShape');
      const edge=ledShape ? editorResizeMode(event,element,"rect") : "move";
      if(ledShape && edge!=="move") action="resize-led";
      const start={...current,pointer:editorPointerPosition(event,board),resizeEdges:edge};
      const move=moveEvent=>{
        const point=editorPointerPosition(moveEvent,board);
        if(action==="marker"){
          current.markerX=clamp(start.markerX+(point.x-start.pointer.x));
          current.markerY=clamp(start.markerY+(point.y-start.pointer.y));
        }else if(action==="anchor"){
          const anchor=shapeCalloutAnchor(start);
          const snapped=snapShapeCalloutAnchor(current,{x:anchor.x+(point.x-start.pointer.x),y:anchor.y+(point.y-start.pointer.y)},board);
          current.calloutAnchorX=snapped.x;
          current.calloutAnchorY=snapped.y;
        }else if(action==="label"){
          const layout=getSmartCalloutLayout(start);
          current.labelX=clamp(layout.labelX+(point.x-start.pointer.x),-40,140);
          current.labelY=clamp(layout.labelY+(point.y-start.pointer.y),-30,130);
        }else if(action==="resize"){
          current.markerSize=clamp(Math.abs(point.x-start.markerX)*2,.25,20);
        }else if(action==="resize-led"){
          const next=resizeEditorLedMarker(start,start.resizeEdges,point);
          delete next.pointer;
          delete next.resizeEdges;
          Object.assign(current,next);
        }
        const marker=stage.querySelector('.deviceStudioEditorCalloutMarker');
        const ledShape=stage.querySelector('.deviceStudioEditorLedShape');
        const anchor=stage.querySelector('.deviceStudioEditorShapeCalloutAnchor');
        const label=stage.querySelector('.deviceStudioEditorLabelPreview');
        const previewLine=stage.querySelector('.deviceStudioEditorCalloutPreviewLine');
        if(marker){ marker.style.left=`${current.markerX}%`; marker.style.top=`${current.markerY}%`; marker.style.setProperty('--editor-marker-size',`${current.markerSize || 2}%`); }
        if(ledShape){ ledShape.style.left=`${current.markerX}%`; ledShape.style.top=`${current.markerY}%`; ledShape.style.setProperty('--editor-led-width',`${current.markerWidth || 3.2}%`); ledShape.style.setProperty('--editor-led-height',`${current.markerHeight || 2.4}%`); }
        if(anchor){ const layout=getSmartCalloutLayout(current); anchor.style.left=`${layout.markerX}%`; anchor.style.top=`${layout.markerY}%`; }
        if(label){ const layout=getSmartCalloutLayout(current); label.style.left=`${layout.labelX}%`; label.style.top=`${layout.labelY}%`; }
        if(previewLine) previewLine.style.cssText=calloutLineStyle(current);
        scheduleCalloutLineRefresh(board);
        moveEvent.preventDefault();
      };
      const stop=()=>{window.removeEventListener('pointermove',move);window.removeEventListener('pointerup',stop);window.removeEventListener('pointercancel',stop);state.hotspotEditor.status='Callout adjusted locally. Save layout to keep it.';renderStage();};
      window.addEventListener('pointermove',move);
      window.addEventListener('pointerup',stop,{once:true});
      window.addEventListener('pointercancel',stop,{once:true});
      event.preventDefault();
      event.stopPropagation();
    }));
    stage.querySelectorAll('.deviceStudioEditorLedShape').forEach(element=>element.addEventListener('pointermove',event=>{
      element.style.cursor=editorCursor(editorResizeMode(event,element,"rect"));
    }));
    stage.querySelectorAll('[data-hotspot-editor-drag]').forEach(element=>{
      element.addEventListener('pointermove',event=>{
        const current=editorHotspot();
        if(current) element.style.cursor=editorCursor(editorResizeMode(event,element,current.shape));
      });
      element.addEventListener('pointerdown',event=>{
      if(event.button!==0) return;
      const source=event.target.closest?.('[data-hotspot-editor-drag]');
      if(source!==element) return;
      const current=editorHotspot();
      if(!current) return;
      const handle=editorResizeMode(event,element,current.shape);
      const start={...current,pointer:editorPointerPosition(event,board)};
        const shape=stage.querySelector('.deviceStudioEditorShape');
        const label=stage.querySelector('.deviceStudioEditorLabelPreview');
        const previewLine=stage.querySelector('.deviceStudioEditorCalloutPreviewLine');
        const move=moveEvent=>{
          const next=resizeEditorHotspot(start,handle,editorPointerPosition(moveEvent,board));
          delete next.pointer;
          Object.assign(current,next);
          if(current.showCallout && handle==="move"){
            const anchor=shapeCalloutAnchor(start);
            current.calloutAnchorX=clamp(anchor.x+(next.x-start.x));
            current.calloutAnchorY=clamp(anchor.y+(next.y-start.y));
          }
          if(shape) shape.style.cssText=editorShapeStyle(current);
          const anchor=stage.querySelector('.deviceStudioEditorShapeCalloutAnchor');
          if(current.showCallout && anchor){ const layout=getSmartCalloutLayout(current); anchor.style.left=`${layout.markerX}%`; anchor.style.top=`${layout.markerY}%`; }
          if(current.showCallout && previewLine) previewLine.style.cssText=calloutLineStyle(current);
          if(current.showCallout && label){ const layout=getSmartCalloutLayout(current); label.style.left=`${layout.labelX}%`; label.style.top=`${layout.labelY}%`; }
          if(current.showCallout) scheduleCalloutLineRefresh(board);
          moveEvent.preventDefault();
        };
      const stop=()=>{window.removeEventListener('pointermove',move);window.removeEventListener('pointerup',stop);window.removeEventListener('pointercancel',stop);state.hotspotEditor.status='Adjusted locally. Save layout to keep this placement.';renderStage();};
      window.addEventListener('pointermove',move);
      window.addEventListener('pointerup',stop,{once:true});
      window.addEventListener('pointercancel',stop,{once:true});
      event.preventDefault();
      event.stopPropagation();
      });
    });
  }
  async function saveHotspotLayout(){
    if(state.hotspotEditor.saving || !window.pm3api?.saveDeviceStudioHotspots) return;
    const activeCircle=editorHotspot();
    const board=document.querySelector('#deviceStudioStage .deviceStudioBoardWrap');
    if(activeCircle?.shape==="circle" && board){
      const rect=board.getBoundingClientRect();
      if(rect.width && rect.height) activeCircle.aspect=rect.width/rect.height;
    }
    state.hotspotEditor.saving=true;
    state.hotspotEditor.status='Saving local developer layout…';
    renderStage();
    try{
      const result=await window.pm3api.saveDeviceStudioHotspots({hotspots:state.hotspots});
      if(result?.ok){
        state.hotspots=Array.isArray(result.hotspots) ? result.hotspots : state.hotspots;
        syncHotspotEditorSelection();
        state.hotspotEditor.status='The complete photo layout has been saved locally.';
      }else state.hotspotEditor.status=result?.message || 'Could not save the hotspot layout.';
    }catch(error){ state.hotspotEditor.status=String(error?.message || error); }
    finally{ state.hotspotEditor.saving=false; renderStage(); }
  }
  function deleteEditorHotspot(){
    const index=state.hotspotEditor.selectedIndex;
    if(index<0 || !editorHotspot()) return;
    state.hotspots.splice(index,1);
    state.hotspotEditor.selectedIndex=-1;
    state.hotspotEditor.menu=null;
    state.hotspotEditor.status='Shape removed locally. Choose a new shape with a right-click, then save.';
    renderStage();
  }
  function toggleHotspotEditor(){
    if(!state.hotspotEditor.available) return;
    state.hotspotEditor.enabled=!state.hotspotEditor.enabled;
    state.hotspotEditor.menu=null;
    if(state.hotspotEditor.enabled) state.hotspotEditor.showGuides=true;
    state.hotspotEditor.status=state.hotspotEditor.enabled?'Right-click the photo to add a rectangle, circle or ellipse.':'Developer calibration closed.';
    syncHotspotEditorSelection();
    const button=document.getElementById('deviceStudioHotspotEditorBtn');
    if(button) button.textContent=state.hotspotEditor.enabled?'Close calibration':'Calibrate hotspots';
    renderStage();
  }
  function handleHotspotClick(id){
    selectComponent(id);
    if(/^led-[a-d]$/.test(id)) runPhysicalLedTest(id);
  }
  function physicalLedForLogical(logical,mapping){
    const mapped=String(mapping?.logicalToSilkscreen?.[logical]||logical).toLowerCase();
    return /^[a-d]$/.test(mapped) ? mapped : logical;
  }
  function firmwareLedCommandForDisplay(displayLed){
    const physical=String(displayLed||'').toLowerCase();
    const mapping=state.snapshot?.device?.ledMapping;
    if(mapping?.logicalToSilkscreen){
      const logical=['a','b','c','d'].find(letter=>physicalLedForLogical(letter,mapping)===physical);
      if(logical) return logical;
    }
    return String(state.device?.ledTestCommandMap?.[physical]||physical).toLowerCase();
  }
  function applyFirmwareLedStatus(data){
    if(!data?.leds) return;
    if(!state.snapshot) state.snapshot={components:{}};
    if(!state.snapshot.components) state.snapshot.components={};
    if(data.ledMapping?.logicalToSilkscreen){
      state.snapshot.device={...(state.snapshot.device||{}),ledMapping:{logicalToSilkscreen:data.ledMapping.logicalToSilkscreen,source:data.mappingSource||'firmware-reported'}};
    }
    const mapping=state.snapshot?.device?.ledMapping;
    ["a","b","c","d"].forEach(letter=>{
      const on=!!data.leds[letter];
      const physical=physicalLedForLogical(letter,mapping);
      state.snapshot.components[`led-${physical}`]={status:on?'on':'off',source:'firmware-reported',telemetry:{on,logicalLed:letter,ledOrderPm3Easy:!!data.ledOrderPm3Easy,ledMapping:mapping||null},detail:`Firmware reports logical LED ${letter.toUpperCase()} (${physical.toUpperCase()} on the board) ${on?'on':'off'}.`,lastUpdated:new Date().toISOString()};
    });
    const physicalLeds={a:false,b:false,c:false,d:false};
    ["a","b","c","d"].forEach(letter=>{ physicalLeds[physicalLedForLogical(letter,mapping)]=!!data.leds[letter]; });
    const connection=state.snapshot?.connection;
    const detail={leds:physicalLeds};
    if(typeof connection?.detected==='boolean') detail.usbPresent=connection.detected;
    else if(typeof connection?.connected==='boolean') detail.usbPresent=connection.connected;
    window.dispatchEvent(new CustomEvent('device-studio-led-state-changed',{detail}));
  }
  async function runPhysicalLedTest(id){
    if(state.ledTestActiveId || !window.pm3api?.testDeviceStudioLed) return;
    const displayLed=id.slice(-1);
    const led=firmwareLedCommandForDisplay(displayLed);
    state.ledTestActiveId=id;
    state.ledTestMessage=`Testing physical LED ${displayLed.toUpperCase()} for 600 ms...`;
    window.dispatchEvent(new CustomEvent('device-studio-led-state-changed',{detail:{leds:{[displayLed]:true}}}));
    renderStage();
    renderInfoPanel();
    try{
      // The Easy board needs B/D command compensation. Tell the main process
      // which logical LED was selected so its progress event lights the same
      // letter in the UI, while `led` still remains the hardware command.
      const result=await window.pm3api.testDeviceStudioLed(led,600,displayLed);
      state.ledTestMessage=result?.message||'';
      if(result?.data) applyFirmwareLedStatus(result.data);
      if(!result?.ok) state.refreshError=result?.message||'Firmware LED test unavailable';
    }catch(error){
      state.ledTestMessage=String(error?.message||error);
    }finally{
      state.ledTestActiveId="";
      if(!state.snapshot?.components?.[id]?.telemetry?.on) window.dispatchEvent(new CustomEvent('device-studio-led-state-changed',{detail:{leds:{[displayLed]:false}}}));
      renderStage();
      renderInfoPanel();
      renderStatus();
    }
  }
  function buttonProfileMarkup(){
    const profile=state.snapshot?.buttonProfile || {};
    const control=profile.control || {};
    const gestures=Array.isArray(profile.gestures) ? profile.gestures : [];
    const buttonState=state.snapshot?.components?.button?.status || 'unknown';
    const sourceMatch=state.snapshot?.device?.sourceBuildMatch || {};
    const reportedDescription=profile.description || 'The firmware did not provide an additional description for this profile.';
    const sourceFallback=`The connected firmware reports the button state, but not its active role. In the reviewed Iceman firmware source, a hold of about one second while the device is idle enters the compiled standalone module. A normal short press has no global action; individual running firmware tools may give the button their own temporary role. ${sourceMatch.state==='candidate-match'?'The local source is a candidate match, not an exact build proof.':'This source observation is not treated as a firmware-reported setting.'}`;
    const gestureRows=gestures.length ? `<ul class="deviceStudioButtonGestureList">${gestures.map(gesture=>`<li><b>${escapeHtml(gesture.label)}</b>${gesture.durationMs!==null?` (${escapeHtml(String(gesture.durationMs))} ms)`:''}${gesture.effect?` — ${escapeHtml(gesture.effect)}`:''}<small>Risk: ${escapeHtml(gesture.risk || 'firmware-defined')}</small></li>`).join('')}</ul>` : `<ul class="deviceStudioButtonGestureList"><li><b>Short press</b> — no general device-wide action is confirmed; an active firmware tool may temporarily use it.<small>Risk: firmware-mode-dependent</small></li><li><b>Hold for about one second while idle</b> — starts the compiled standalone module when one is installed.<small>Risk: source-derived, not a Device Studio command</small></li></ul>`;
    const controlNote=control.available ? 'This firmware reports a configurable profile contract. Device Studio deliberately keeps configuration disabled in diagnostic mode; it only explains what the firmware has offered.' : (control.reason || 'This firmware has not reported a safe configurable button profile.');
    const readerFieldContext=`<div class="deviceStudioButtonRole"><b>When “Detect external reader field” is running</b><p>This is a separate, source-confirmed firmware function (<code>ListenReaderField()</code>), started by the PM3 client command <code>hw detectreader</code>. It is not the normal idle-button behaviour and Device Studio does not start it from this panel.</p><ol class="deviceStudioButtonGestureList"><li><b>Mode 1 — passive external-field detection.</b> The PM3 turns its own FPGA radio output off so it does not measure itself. A button press switches to Mode 2.</li><li><b>Mode 2 — relative field-strength display.</b> The four LEDs are pulse-driven in software to show the current external-field level relative to the strongest level seen during that run. A second press exits the function and switches the LEDs off.</li></ol><p class="small">The source code uses LED B for HF changes and LED D for LF changes in Mode 1. Its old comment mentions colours that do not match every board revision, so Device Studio will show the physical LED labels rather than claiming a universal colour meaning. This detects an external RF field; it does not identify a card or reader.</p><small>Source: <code>armsrc/appmain.c</code> · <code>ListenReaderField()</code>; client entry: <code>client/src/cmdhw.c</code> · <code>hw detectreader</code>. This mode owns the PM3 until it is stopped, so no card scan can run at the same time.</small></div>`;
    return `<div class="deviceStudioButtonControls"><h4>What the physical button can do</h4><p><b>Last firmware-reported state:</b> ${escapeHtml(buttonState)}. This value is refreshed by normal diagnostics; this panel does not poll, press, or operate the button.</p><div class="deviceStudioButtonRole"><b>${escapeHtml(profile.reported ? (profile.label || 'Firmware button profile') : 'Function not reported by firmware')}</b><p>${escapeHtml(profile.reported ? reportedDescription : sourceFallback)}</p>${gestureRows}</div>${readerFieldContext}<div class="deviceStudioButtonConfiguration unavailable"><b>Information only</b><p>${escapeHtml(controlNote)}</p></div><p class="small">Firmware-reported profiles always take priority. If a newer firmware reports a different profile, this panel changes after Refresh diagnostics — it is not a fixed Electron list.</p><small>This screen intentionally does not run a button test or change any button setting.</small></div>`;
  }
  function humanSource(source){
    const labels={"firmware-reported":"Firmware reported","source-derived":"Source-derived","electron-observed":"Electron observed","calculated":"Calculated","inferred":"Inferred","unknown":"Unknown"};
    return labels[source] || text(source).replace(/[-_]/g," ") || "Unknown";
  }
  const previewableSourceFiles=new Set(['armsrc/appmain.c','client/src/cmdhw.c','client/src/comms.c','include/pm3_cmd.h','common_arm/usb_cdc.c','armsrc/iso14443a.c','armsrc/iso14443b.c','armsrc/iso15693.c','armsrc/lfops.c','armsrc/lfsampling.c','armsrc/fpgaloader.c','armsrc/util.c','armsrc/util.h','armsrc/spiffs.c','client/src/cmdflashmem.c','armsrc/Standalone/readme.md','armsrc/Standalone/lf_samyrun.c']);
  function sourceFilesForPreview(sourceHints){ return (sourceHints || []).filter(item=>previewableSourceFiles.has(item)); }
  function compactStatus(component, live, simulated){
    if(simulated) return "Simulation active";
    if(!live?.status || live.status==="unknown") return "State not reported";
    return live.status.replace(/[-_]/g," ");
  }
  function overlayTabs(active){
    const helpKeys={
      overview:"deviceStudioOverlayOverviewTab",
      technical:"deviceStudioOverlayTechnicalTab",
      firmware:"deviceStudioOverlayFirmwareTab",
      source:"deviceStudioOverlaySourceTab",
      diagnostics:"deviceStudioOverlayDiagnosticsTab",
      history:"deviceStudioOverlayHistoryTab"
    };
    return [
      ["overview","Overview"],["technical","Technical"],["firmware","Firmware"],
      ["source","Source"],["diagnostics","Diagnostics"],["history","History"]
    ].map(([id,label])=>`<span class="deviceStudioOverlayTabGroup"><button type="button" class="${active===id?"active":""}" data-device-studio-overlay-tab="${id}" aria-selected="${active===id}">${label}</button><button type="button" class="sectionHelpIcon deviceStudioOverlayTabHelp" data-help-key="${helpKeys[id]}" title="What does ${label} show?" aria-label="${label} help">i</button></span>`).join("");
  }
  function renderComponentOverlay(){
    const host=document.getElementById("deviceStudioOverlayHost");
    if(!host) return;
    if(!state.overlayOpen){ host.innerHTML=""; return; }
    const component=componentById(state.activeComponentId);
    if(!component){ host.innerHTML=""; return; }
    const image=imageById(state.activeImageId);
    const hotspot=selectedImageHotspot();
    const live=componentLiveState(component.id);
    const learning=learningFor(component.id);
    const related=relatedComponents(component);
    const simulated=state.simulationComponentId===component.id;
    const sourceHints=learning.sourceHints || [];
    const history=state.diagnosticHistory.slice().reverse().slice(0,12);
    const actions=capabilityActions(state.snapshot);
    const diagnostics=state.snapshot?.diagnostics || {};
    // These are populated by the existing data renderers. Reusing their rendered
    // content here keeps the compact view calm without discarding any detail.
    const firmwareExplorer=document.getElementById('deviceStudioFirmwareLearning')?.innerHTML || '<p>No firmware detail has been loaded yet.</p>';
    const liveSnapshot=document.getElementById('deviceStudioStatus')?.innerHTML || '<p>No live snapshot has been loaded yet.</p>';
    const simpleView=`<div class="deviceStudioQuestionGrid">
      <div><span>What does this mean?</span><p>${escapeHtml(component.plainExplanation)}</p></div>
      <div><span>Why is it here?</span><p>${escapeHtml(learning.whyExists || component.technicalExplanation)}</p></div>
      <div><span>What is it doing now?</span><p>${escapeHtml(simulated ? "Simulation active — no hardware is being controlled." : `${live?.status || "Unknown"}. ${live?.detail || "The current firmware does not report this state."}`)}</p><small>Reported by: ${escapeHtml(humanSource(live?.source || live?.telemetry?.source || "unknown"))}.</small></div>
      <div><span>What can I safely do?</span><p>${escapeHtml(component.safeNow)}</p></div>
    </div>`;
    const technicalView=`<div class="deviceStudioOverlayGrid">
      <div class="deviceStudioInfoBlock"><h4>Technical explanation</h4><p>${escapeHtml(component.technicalExplanation)}</p></div>
      <div class="deviceStudioInfoBlock"><h4>If it were missing</h4><p>${escapeHtml(learning.missingImpact || "The effect has not yet been documented for this component.")}</p></div>
      <div class="deviceStudioInfoBlock"><h4>RFID technologies and systems</h4><p>${escapeHtml((learning.technologies || []).join(" · ") || "No direct RFID dependency documented.")}</p></div>
      <div class="deviceStudioInfoBlock"><h4>Related components</h4><div class="deviceStudioRelated">${related.map(item=>`<button type="button" data-device-studio-overlay-related="${escapeHtml(item.id)}">${escapeHtml(item.displayName)}</button>`).join("") || "No relationships documented."}</div></div>
      <div class="deviceStudioInfoBlock"><h4>Current state</h4><p><b>${escapeHtml(compactStatus(component,live,simulated))}</b> · ${escapeHtml(live?.detail || "No current telemetry was exposed.")}</p><small>Reported by: ${escapeHtml(humanSource(live?.source || live?.telemetry?.source || "unknown"))} · updated ${escapeHtml(live?.lastUpdated || "never")}.</small></div>
      <div class="deviceStudioInfoBlock"><h4>Hardware location</h4><p>Active image: ${escapeHtml(image?.title || "not available")}. Hotspot: ${hotspot?"available":"not available on this image"}.</p></div>
    </div>`;
    const firmwareView=`<div class="deviceStudioOverlayGrid">
      <div class="deviceStudioInfoBlock"><h4>Firmware role</h4><p>${escapeHtml(component.pm3Use || "No firmware use mapping documented.")}</p></div>
      <div class="deviceStudioInfoBlock"><h4>Firmware modules</h4><p>${escapeHtml((learning.firmwareModules || []).join(" · ") || "No verified module mapping available yet.")}</p><small>Info from: local source mapping; this is not proof of an exact installed build.</small></div>
      <div class="deviceStudioInfoBlock"><h4>Future control</h4><p>${escapeHtml(component.futureControlNotes || "No future control note documented.")}</p></div>
      <div class="deviceStudioInfoBlock warning"><h4>Safety</h4><p>${escapeHtml(component.safetyNotes || "No component-specific safety note documented.")}</p></div>
    </div>${component.id==="button"?buttonProfileMarkup():""}<section class="deviceStudioOverlayFullDetail"><h3>Firmware Explorer</h3><p>The installed firmware, its capabilities and locally available source references.</p><small>Info from: firmware status response and local source catalogue.</small><div class="deviceStudioFirmwareLearning">${firmwareExplorer}</div></section>`;
    const sourceFiles=sourceFilesForPreview(sourceHints);
    const sourceView=`<div class="deviceStudioInfoBlock source"><h4>Relevant source locations</h4><p>Source hints need a matching build before they are treated as exact implementation proof.</p><ul>${sourceHints.map(item=>`<li><code>${escapeHtml(item)}</code>${previewableSourceFiles.has(item)?'':' <small>(reference only — not a previewable source file)</small>'}</li>`).join("") || "<li>No source mapping available yet.</li>"}</ul></div>
      <div class="deviceStudioInfoBlock source"><h4>Open local source</h4><p>Read-only preview from the local Iceman checkout. Folders and hardware-documentation references are shown above but deliberately cannot be opened as a single source file.</p><div class="deviceStudioSourceButtons">${sourceFiles.map(item=>`<button type="button" data-device-studio-overlay-source="${escapeHtml(item)}">Open ${escapeHtml(item)}</button>`).join("") || "No previewable local source file mapped."}</div><div class="deviceStudioSourcePreviewHeader"><span>Source preview</span><button type="button" data-device-studio-overlay-source-close>Close source preview</button></div><pre class="deviceStudioSourcePreview" id="deviceStudioOverlaySourcePreview">Select a source file to inspect it here.</pre></div>
      <div class="deviceStudioInfoBlock warning"><h4>Build-match boundary</h4><p>Compiled firmware on the board is not editable source. This preview is documentation unless the installed build and local source have been verified as an exact match.</p></div>`;
    const diagnosticsView=`<div class="deviceStudioOverlayGrid">
      <aside class="deviceStudioSafeNow"><span>Safe now</span><p>${escapeHtml(component.safeNow)}</p></aside>
      <div class="deviceStudioInfoBlock deviceStudioOverlayActions"><h4>Available firmware-safe actions</h4><div class="deviceStudioActionSummary">${actions.map(action=>`<div><b>${escapeHtml(action.label)}</b><span>${escapeHtml(action.purpose)}</span><small>Hardware: ${escapeHtml(action.hardware)} · Duration: ${escapeHtml(action.duration)} · Risk: ${escapeHtml(action.risk)}</small></div>`).join("") || "No safe action reported."}</div></div>
      <div class="deviceStudioInfoBlock"><h4>Latest diagnostic transport</h4><p>${escapeHtml(diagnostics.status?.ok?"Structured firmware status received.":"Structured firmware status was not received.")}</p><small>Command: ${escapeHtml(diagnostics.status?.command || "hw status --json")} · ${escapeHtml(diagnostics.status?.binary || "client not reported")}.</small></div>
    </div><section class="deviceStudioOverlayFullDetail"><h3>Full live snapshot</h3><p>All latest safe diagnostics received from the connected PM3.</p><small>Source: latest structured firmware/client diagnostic snapshot.</small><div class="deviceStudioStatusGrid">${liveSnapshot}</div></section>`;
    const historyView=`<div class="deviceStudioInfoBlock"><h4>Component observation</h4><p>Current state: <b>${escapeHtml(compactStatus(component,live,simulated))}</b>.</p><small>Reported by: ${escapeHtml(humanSource(live?.source || live?.telemetry?.source || "unknown"))} · last update ${escapeHtml(live?.lastUpdated || "never")}.</small></div><div class="deviceStudioHistoryList">${history.map(item=>`<div><b>${escapeHtml(item.connected?"Connected":"Disconnected")}</b><span>${escapeHtml(item.capturedAt || "Unknown time")}</span></div>`).join("") || "No diagnostic history recorded yet."}</div>`;
    const contents={overview:simpleView,technical:technicalView,firmware:firmwareView,source:sourceView,diagnostics:diagnosticsView,history:historyView};
    const overlayStyle=state.overlayPosition ? ` style="left:${state.overlayPosition.left}px;top:${state.overlayPosition.top}px;transform:none"` : "";
    host.innerHTML=`<div class="deviceStudioOverlayBackdrop" data-device-studio-overlay-close></div><section class="deviceStudioOverlay"${overlayStyle} role="dialog" aria-modal="true" aria-label="${escapeHtml(component.displayName)} details"><header data-device-studio-overlay-drag><div><span>${escapeHtml(component.category || "Component")} · ${escapeHtml(humanSource(live?.source || live?.telemetry?.source || "unknown"))}</span><h2>${escapeHtml(component.displayName)}</h2><p>${escapeHtml(component.plainExplanation)}</p></div><button type="button" class="deviceStudioOverlayClose" data-device-studio-overlay-close aria-label="Close details">×<span>Close</span></button></header><nav class="deviceStudioOverlayTabs" role="tablist">${overlayTabs(state.overlayTab)}</nav><div class="deviceStudioOverlayBody" tabindex="0">${contents[state.overlayTab] || simpleView}</div></section>`;
    host.querySelectorAll('[data-device-studio-overlay-close]').forEach(button=>button.addEventListener('click',()=>{state.overlayOpen=false;renderComponentOverlay();}));
    host.querySelectorAll('[data-device-studio-overlay-tab]').forEach(button=>button.addEventListener('click',()=>{state.overlayTab=button.dataset.deviceStudioOverlayTab;renderComponentOverlay();}));
    host.querySelectorAll('[data-device-studio-overlay-related]').forEach(button=>button.addEventListener('click',()=>selectComponent(button.dataset.deviceStudioOverlayRelated,{followImage:true})));
    host.querySelectorAll('[data-device-studio-overlay-source]').forEach(button=>button.addEventListener('click',async()=>{const preview=host.querySelector('#deviceStudioOverlaySourcePreview');if(preview)preview.textContent=`Loading ${button.dataset.deviceStudioOverlaySource}...`;const result=await window.pm3api?.readDeviceStudioSource?.(button.dataset.deviceStudioOverlaySource);if(preview)preview.textContent=result?.ok?result.content:(result?.message||'Source unavailable.');}));
    host.querySelectorAll('[data-device-studio-overlay-source-close]').forEach(button=>button.addEventListener('click',()=>{const preview=host.querySelector('#deviceStudioOverlaySourcePreview');if(preview)preview.textContent='Select a source file to inspect it here.';}));
    host.querySelectorAll('[data-firmware-source]').forEach(button=>button.addEventListener('click',async()=>{const preview=host.querySelector('#deviceStudioFirmwareSourcePreview');if(preview)preview.textContent=`Loading ${button.dataset.firmwareSource}...`;const result=await window.pm3api?.readDeviceStudioSource?.(button.dataset.firmwareSource);if(preview)preview.textContent=result?.ok?result.content:(result?.message||'Source unavailable.');}));
    host.querySelectorAll('[data-firmware-source-close]').forEach(button=>button.addEventListener('click',()=>{const preview=host.querySelector('#deviceStudioFirmwareSourcePreview');if(preview)preview.textContent='Select a verified source file to inspect it here.';}));
    bindOverlayDrag(host);
    bindMetricGridDrag();
  }
  function renderInfoPanel(){
    const panel=document.getElementById("deviceStudioInfo");
    if(!panel) return;
    const component=componentById(state.activeComponentId);
    const image=imageById(state.activeImageId);
    const hotspot=selectedImageHotspot();
    const live=componentLiveState(component?.id);
    const learning=learningFor(component?.id);
    const related=relatedComponents(component);
    const simulated=state.simulationComponentId===component?.id;
    if(!component){
      panel.innerHTML=`<div class="deviceStudioEmpty">Select a component to view details.</div>`;
      return;
    }
    const simpleView=`
      <div class="deviceStudioQuestionGrid">
        <div><span>What am I looking at?</span><p>${escapeHtml(component.plainExplanation)}</p></div>
        <div><span>Why is it here?</span><p>${escapeHtml(learning.whyExists || component.technicalExplanation)}</p></div>
        <div><span>What is it doing now?</span><p>${escapeHtml(simulated ? "Simulation active — no hardware is being controlled." : `${live?.status || "Unknown"}. ${live?.detail || "The current firmware does not report this state."}`)}</p></div>
        <div><span>What can I safely do?</span><p>${escapeHtml(component.safeNow)}</p></div>
      </div>`;
    const technicalView=`
      <div class="deviceStudioInfoBlock"><h4>If it were missing</h4><p>${escapeHtml(learning.missingImpact || "The effect has not yet been documented for this component.")}</p></div>
      <div class="deviceStudioInfoBlock"><h4>RFID technologies and systems</h4><p>${escapeHtml((learning.technologies || []).join(" · ") || "No direct RFID dependency documented.")}</p></div>
      <div class="deviceStudioInfoBlock"><h4>Firmware modules</h4><p>${escapeHtml((learning.firmwareModules || []).join(" · ") || "No verified module mapping available yet.")}</p></div>
      <div class="deviceStudioInfoBlock"><h4>Related components</h4><div class="deviceStudioRelated">${related.map(item=>`<button type="button" data-learning-related="${escapeHtml(item.id)}">${escapeHtml(item.displayName)}</button>`).join("") || "No relationships documented."}</div></div>`;
  const sourceView=`
      <div class="deviceStudioInfoBlock source"><h4>Relevant source locations</h4><p class="small">Source hints must be matched to the installed firmware version before they are treated as exact.</p><ul>${(learning.sourceHints || []).map(item=>`<li><code>${escapeHtml(item)}</code></li>`).join("") || "<li>No source mapping available yet.</li>"}</ul></div>
      <div class="deviceStudioInfoBlock source"><h4>Open local source</h4><p class="small">Read-only browser for matching source files in the local Iceman checkout.</p><div class="deviceStudioSourceButtons">${sourceFilesForPreview(learning.sourceHints).map(item=>`<button type="button" data-source-file="${escapeHtml(item)}">Open ${escapeHtml(item)}</button>`).join("") || "No previewable local source file mapped."}</div><div class="deviceStudioSourcePreviewHeader"><span>Source preview</span><button type="button" data-source-file-close>Close source preview</button></div><pre class="deviceStudioSourcePreview" id="deviceStudioSourcePreview">Select a source file to inspect it here.</pre></div>
      <div class="deviceStudioInfoBlock warning"><h4>Important distinction</h4><p>The firmware installed on the device is compiled machine code. These paths refer to human-readable source code that may correspond to it; an exact match still requires build/version verification.</p></div>`;
    const auditLed=/^led-[a-d]$/.test(component.id) ? component.id.slice(-1) : "";
    const auditCommand=auditLed
      ? `hw leds --test ${firmwareLedCommandForDisplay(auditLed)} --ms 600 --json`
      : component.id.includes("antenna") ? "hw tune" : "hw version";
    panel.innerHTML=`<div class="deviceStudioCompactSummary"><span>${escapeHtml(component.category || "Component")}</span><h3>${escapeHtml(component.displayName)}</h3><div class="deviceStudioCompactFact"><b>Status</b><p>${escapeHtml(compactStatus(component,live,simulated))}</p><small>Reported by: ${escapeHtml(humanSource(live?.source || live?.telemetry?.source || "unknown"))}.</small></div><div class="deviceStudioCompactFact"><b>Purpose</b><p>${escapeHtml(component.plainExplanation)}</p></div><div class="deviceStudioCompactFact"><b>Current role</b><p>${escapeHtml(simulated?"Simulation only — no hardware is controlled.":live?.detail || component.pm3Use || "Not reported.")}</p><small>Reported by: ${escapeHtml(humanSource(live?.source || live?.telemetry?.source || "unknown"))}.</small></div><div class="deviceStudioCompactActions"><button type="button" data-device-studio-open-overlay="overview" data-device-studio-action="explain">Explain</button><button type="button" data-device-studio-open-overlay="firmware" data-device-studio-action="firmware">Firmware</button><button type="button" data-device-studio-open-overlay="overview" data-device-studio-action="more">More…</button></div></div>`;
    panel.querySelectorAll('[data-device-studio-open-overlay]').forEach(button=>button.onclick=()=>{state.overlayTab=button.dataset.deviceStudioOpenOverlay||'overview';state.overlayOpen=true;renderComponentOverlay();});
    renderComponentOverlay();
  }
  function handleLearningAction(action,component){
    if(action==="explain") state.explanationLevel="simple";
    if(action==="related") state.explanationLevel="technical";
    if(action==="firmware") state.explanationLevel="technical";
    if(action==="diagnostic") refreshDiagnostics();
    if(action==="simulate") state.simulationComponentId=state.simulationComponentId===component.id?"":component.id;
    renderInfoPanel();
    renderStage();
  }
  function renderFirmwareLearning(){
    const panel=document.getElementById("deviceStudioFirmwareLearning");
    if(!panel) return;
    const device=state.snapshot?.device || {};
    const status=state.snapshot?.hardwareStatus || {};
    const sourceCatalog=[
      ['Firmware entry and command dispatcher','armsrc/appmain.c','SendDeviceStudioSnapshot(), HandleDeviceStudioMode(), SendHardwareStatus()'],
      ['Hardware command client','client/src/cmdhw.c','CmdDeviceStudioSnapshot(), CmdDeviceStudioMode(), CmdLeds()'],
      ['Protocol contracts','include/pm3_cmd.h','hw_ds_snapshot_t, hw_ds_mode_request_t, hw_ds_mode_status_t'],
      ['USB communication','common_arm/usb_cdc.c','USB CDC transport'],
      ['Button gesture helpers','armsrc/util.c','BUTTON_PRESS(), BUTTON_HELD(), BUTTON_CLICKED()'],
      ['HF/LF radio modules','armsrc/iso14443a.c','HF/LF command paths · armsrc/lfops.c']
    ];
    const capabilityDescriptions={
      'hardware-status':['Hardware status','Reads structured board telemetry.','Only values reported by firmware are shown; unsupported sensors remain unknown.'],
      'led-status':['LED status','Reports current A-D LED outputs and mapping.','It does not change RFID data and is safe to query.'],
      'button-status':['Button status','Reports whether the physical button was pressed or released when diagnostics last ran.','Device Studio presents this as information only and does not run a button test.'],
      'button-profile':['Button profile','Describes firmware-defined button gestures and their roles.','Device Studio displays reported roles and never assumes a fixed mapping.'],
      'button-control':['Button control','Optional firmware-defined button profile capability.','Device Studio documents reported choices but keeps button configuration out of diagnostic mode.'],
      'basic-self-test':['Basic self-test','Reports the firmware health checks for USB, MCU and FPGA.','It is a bounded read-only check; unavailable sensors are not treated as failures.'],
      'memory-statistics':['Memory statistics','Reports working-buffer capacity and free space.','Device Studio reads these values only; it never clears memory.'],
      'clock-status':['Clock status','Reports the board master clock when firmware exposes it.','The value is displayed, never changed by Device Studio.'],
      'fpga-status':['FPGA status','Reports whether the firmware considers the FPGA loaded.','Device Studio never reconfigures the FPGA.'],
      'led-brightness':['LED brightness','Optional PWM/current-controlled LED brightness.','Unavailable until firmware reports safe brightness limits; current Easy firmware supports on/off only.'],
      fpga:['FPGA radio processor','Provides precise HF/LF timing and signal processing for the board.','Device Studio only reads its reported image/state; it never reconfigures the FPGA.'],
      'external-flash':['External flash','Stores firmware-related resources or persistent device data.','Device Studio reports capacity only; it never erases or writes flash.'],
      'module-detection':['Hardware modules','Describes optional HF/LF or board modules exposed by firmware.','Only firmware-reported modules are shown; unknown modules remain unconfirmed.'],
      hf:['HF radio','Supports high-frequency RFID/NFC operations exposed by firmware.','Read-only discovery is safe; writing, emulation and attacks remain outside Device Studio.'],
      lf:['LF radio','Supports low-frequency RFID operations exposed by firmware.','Read-only discovery is safe; writing and cloning remain outside Device Studio.']
    };
    const caps=state.snapshot?.capabilityNegotiation?.effective || [];
    const adapters=state.snapshot?.capabilityAdapters || {};
    const sourceMatch=device.sourceBuildMatch||{};
    const actions=state.snapshot?.actionDescriptors||[];
    const usb=device.usbDescriptor||{};
    panel.innerHTML=`
      <div><span>Firmware in human language</span><h4>${escapeHtml(device.firmwareFamily || "Firmware not confirmed")}</h4><p>${device.firmware ? `The connected device reports ${escapeHtml(device.firmware)}. This software runs on the board and coordinates USB, the MCU, FPGA and radio operations.` : "Device Studio has not yet received a confirmed firmware identity from the hardware."}</p></div>
      <div><span>Build and compatibility</span><h4>${escapeHtml(sourceMatch.label || device.buildDate || "Build date not reported")}</h4><p>${escapeHtml(sourceMatch.detail || `Board: ${device.model || "Unknown"} · Revision: ${device.boardRevision || "Unknown"}.`)}</p><small>Build date: ${escapeHtml(device.buildDate || 'not reported')} · Board identity source: ${escapeHtml(device.modelConfidence || 'unknown')}</small></div>
      <div><span>USB identity</span><h4>${escapeHtml(device.serialNumber || 'Stable serial not reported')}</h4><p>${usb.product?`${escapeHtml(usb.product)} · ${escapeHtml(usb.vendorId||'vendor unknown')} · ${escapeHtml(usb.productId||'product ID unknown')}`:'The firmware and operating system did not expose a stable USB serial/descriptor for this device.'}</p><small>${usb.source?`Source: ${escapeHtml(usb.source)}`:'No fabricated serial number is shown.'}</small></div>
      <div><span>Firmware parts</span><h4>BootROM · full image · FPGA image · client</h4><p>BootROM starts the board, the full image contains the main firmware, the FPGA image handles precise radio work, and the client is the computer-side interface. They cooperate but are separate software pieces.</p></div>
      <div class="deviceStudioExplorerWide"><span>Local source browser</span><h4>Verified source locations</h4><p>These are read-only links to the matching Device Studio/Iceman source tree. Compiled firmware is never presented as editable source.</p><div class="deviceStudioSourceList">${sourceCatalog.map(([label,file,functions])=>`<details><summary>${escapeHtml(label)} · <code>${escapeHtml(file)}</code></summary><p>Functions/modules: <code>${escapeHtml(functions)}</code></p><button type="button" data-firmware-source="${escapeHtml(file)}">Open read-only source</button></details>`).join('')}</div><div class="deviceStudioSourcePreviewHeader"><span>Source preview</span><button type="button" data-firmware-source-close>Close source preview</button></div><pre class="deviceStudioSourcePreview" id="deviceStudioFirmwareSourcePreview">Select a verified source file to inspect it here.</pre></div>
      <div class="deviceStudioExplorerWide"><span>Firmware capabilities</span><h4>${caps.length ? `${caps.length} reported or inferred capabilities` : 'No capabilities confirmed'}</h4><div class="deviceStudioCapabilityCards">${(caps.length?caps:['hardware-status','led-status','button-status']).map(cap=>{const item=capabilityDescriptions[cap]||[cap,'Future firmware capability','Device Studio preserves unknown capabilities but will not invent an action until an adapter defines its safe contract.']; const adapter=adapters[cap]; const related=actions.filter(action=>adapter?.actions?.includes(action.id)||action.id===cap); return `<div><b>${escapeHtml(item[0])}</b><p>${escapeHtml(item[1])}</p><small>${escapeHtml(item[2])}</small>${adapter?.components?.length?`<small class="deviceStudioAdapterMap">Components: ${escapeHtml(adapter.components.join(', '))}<br>Safe actions: ${escapeHtml(related.map(action=>action.label).join(', ')||'none')}</small>`:''}</div>`;}).join('')}</div></div>
      <div><span>How to learn</span><h4>Interface first, commands second</h4><p>Select a component and use Simple, Technical or Source. Terminal commands remain available for advanced work, but are not required to discover what the hardware can do.</p></div>
      <div class="deviceStudioSourceLegend"><span>Status sources</span><p><b>Firmware Reported</b> direct from firmware · <b>Electron Observed</b> seen in the workflow · <b>Inferred</b> derived from verified observations · <b>Unknown</b> unavailable.</p></div>
    `;
    panel.querySelectorAll('[data-firmware-source]').forEach(button=>button.onclick=async()=>{
      const preview=panel.querySelector('#deviceStudioFirmwareSourcePreview');
      if(preview) preview.textContent=`Loading ${button.dataset.firmwareSource}...`;
      const result=await window.pm3api?.readDeviceStudioSource?.(button.dataset.firmwareSource);
      if(preview) preview.textContent=result?.ok?result.content:(result?.message||'Source unavailable.');
    });
    panel.querySelectorAll('[data-firmware-source-close]').forEach(button=>button.onclick=()=>{const preview=panel.querySelector('#deviceStudioFirmwareSourcePreview'); if(preview) preview.textContent='Select a verified source file to inspect it here.';});
  }
  function renderStatus(){
    const panel=document.getElementById("deviceStudioStatus");
    if(!panel) return;
    const snapshot=state.snapshot;
    const summary=document.getElementById("deviceStudioStatusSummary");
    if(summary){
      summary.textContent=state.refreshing
        ? (state.refreshKind==="quick" ? "Refreshing current firmware status; RF antennas are not being measured..." : "Running the full safe RF check; HF and LF antennas are being measured...")
        : state.refreshError ? `Diagnostics unavailable: ${state.refreshError}`
        : snapshot?.connection?.connected ? `Connected on ${snapshot.connection.port || "detected port"}. Last ${state.lastRefreshKind==="quick" ? "quick status refresh" : "full RF check"} ${snapshot.capturedAt}.`
        : snapshot?.connection?.detected ? `A device port was detected at ${snapshot.connection.port || "an unknown port"}, but PM3 communication failed.`
        : "No Proxmark3 detected. Connect the device and run Full RF Check.";
    }
    const device=snapshot?.device || {};
    const hf=snapshot?.hf?.tune || {};
    const lf=snapshot?.lf?.tune || {};
    const outcome=state.lastDiagnosticOutcome;
    const actions=capabilityActions(snapshot);
    const history=state.diagnosticHistory.slice().reverse().slice(0,5);
    const hs=snapshot?.hardwareStatus || {};
    const metric=(value,unit="")=>value===null||value===undefined||value===""?"Not reported":`${value}${unit}`;
    const fpgaLabel=hs.fpgaState===1?'Loaded':hs.fpgaState===0?'Not loaded':device.fpga||'Unknown';
    const memory=hs.memory || null;
    const kib=(bytes)=>Number.isFinite(Number(bytes)) ? `${(Number(bytes)/1024).toFixed(1)} KB` : 'Not reported';
    const bigbufHasMeasurement=memory && Number.isFinite(Number(memory.bigbufBytes)) && Number.isFinite(Number(memory.bigbufFreeBytes));
    const bigbufLowWater=Number(memory?.bigbufLowWaterBytes);
    const bigbufHasLowWater=bigbufHasMeasurement && Number.isFinite(bigbufLowWater);
    const bigbufPeakUsed=bigbufHasLowWater ? Math.max(0,Number(memory.bigbufBytes)-bigbufLowWater) : null;
    const memoryLabel=!bigbufHasMeasurement ? 'Not reported' : bigbufHasLowWater
      ? `${kib(memory.bigbufFreeBytes)} free now · worst observed free ${kib(bigbufLowWater)}`
      : `${kib(memory.bigbufFreeBytes)} free now`;
    const memoryDetail=!bigbufHasMeasurement ? 'This firmware does not report BigBuf working-memory measurements.'
      : bigbufHasLowWater
        ? `Since this firmware boot, the smallest free margin was ${kib(bigbufLowWater)}. The largest observed temporary use was ${kib(bigbufPeakUsed)}. This is a measurement, not a memory reservation.`
        : `Current free working memory: ${kib(memory.bigbufFreeBytes)}.`;
    const diagnosticComplete=outcome?.phase==='complete' || (!!snapshot?.diagnostics?.version?.ok && !!snapshot?.diagnostics?.tune?.ok && !!snapshot?.diagnostics?.status?.ok);
    if(state.refreshing){
      window.DeviceConnectionStatusCard?.update?.({checking:true,diagnostics:"running"});
    }else if(snapshot){
      const shared=window.DeviceConnectionStatusCard?.getState?.() || {};
      const blockedByConsole=snapshot.connection?.status==="busy" && shared.connected===true && shared.sessionOwner==="console";
      window.DeviceConnectionStatusCard?.update?.(blockedByConsole
        ? {diagnostics:"not-measured",checking:false}
        : {
          detected:snapshot.connection?.detected===true || snapshot.connection?.connected===true,
          connected:snapshot.connection?.connected===true,
          diagnostics:diagnosticComplete ? "available" : "not-measured",
          checking:false,
          port:snapshot.connection?.connected ? (snapshot.connection.port || "PM3") : "",
          sessionOwner:snapshot.connection?.connected ? "studio" : "none"
        });
    }
    const unavailable=(label)=>label;
    const telemetryText=(value,fallback='Not available from firmware')=>{
      if(value===null||value===undefined||value==='') return fallback;
      if(typeof value==='object') return value.status ? `${value.status}${value.reason?` · ${value.reason}`:''}` : Object.entries(value).map(([key,val])=>`${key}: ${val}`).join(' · ');
      return String(value);
    };
    const rfHealth=telemetryText(hs.rfHealth,hf.measured&&lf.measured?'HF/LF tune passed (inferred)':'Not available from firmware');
    panel.innerHTML=`
      <div class="${snapshot?.connection?.connected ? "live" : "fault"}"><span>Connection</span><b>${state.refreshing ? "Checking..." : snapshot?.connection?.connected ? `Connected · ${escapeHtml(snapshot.connection.port || "PM3")}` : snapshot?.connection?.detected ? "Port found · communication failed" : "Disconnected"}</b></div>
      <div><span>Firmware</span><b>${escapeHtml(device.firmware || device.firmwareFamily || "Unknown")}</b></div>
      <div><span>Hardware type</span><b>${escapeHtml(device.model || state.device?.name || "Proxmark3 Easy")}</b></div>
      <div class="${hf.measured ? "live" : "unknown"}"><span>HF antenna</span><b>${hf.measured ? `${formatValue(hf.voltage," V")} · ${formatValue(hf.frequencyMHz," MHz")}` : "Not measured"}</b></div>
      <div class="${lf.measured ? "live" : "unknown"}"><span>LF antenna</span><b>${lf.measured ? `${formatValue(lf.voltage," V")} · ${formatValue(lf.frequencyKHz," kHz")}` : "Not measured"}</b></div>
      <div><span>FPGA</span><b>${escapeHtml(fpgaLabel)}</b></div>
      <div><span>BootROM</span><b>${escapeHtml(device.bootrom || "Unknown")}</b></div>
      <div><span>MCU</span><b>${escapeHtml(device.mcu || "Unknown")}</b></div>
      <div><span>Serial number</span><b>${escapeHtml(device.serialNumber || "Not reported")}</b></div>
      <div><span>Board revision</span><b>${escapeHtml(device.boardRevision || "Not reported")}</b></div>
      <div><span>Flash</span><b>${device.flashBytes ? `${Math.round(device.flashBytes/1024)} KB${device.flashUsedPercent ? ` · ${device.flashUsedPercent}% used` : ""}` : "Unknown"}</b></div>
      <div class="${outcome?.phase==='error'?'fault':diagnosticComplete?'live':'unknown'}"><span>Last diagnostic</span><b>${escapeHtml(outcome?.label || (diagnosticComplete?'Diagnostics complete':'Not run'))}</b></div>
      <div class="deviceStudioStatusWide"><span>Available safe actions</span><b>${actions.map(action=>escapeHtml(action.label)).join(" · ")}</b><small>${actions.map(action=>`${escapeHtml(action.purpose)} (${escapeHtml(action.duration)}; ${escapeHtml(action.risk)})`).join(" · ")}</small></div>
      <div class="deviceStudioStatusWide"><span>Recent diagnostic history</span><b>${history.length ? history.map(item=>`${escapeHtml(item.connected?'Connected':'Disconnected')} · ${escapeHtml(item.capturedAt)}`).join("<br>") : "No history yet"}</b></div>
      <div class="deviceStudioStatusWide"><span>Extended hardware measurements</span><div class="deviceStudioMetricGrid"><span>FPGA <b>${escapeHtml(fpgaLabel)}</b></span><span>Temperature <b>${escapeHtml(telemetryText(hs.temperature))}</b></span><span>Power <b>${escapeHtml(telemetryText(hs.power))}</b></span><span>ADC / clock <b>${escapeHtml(hs.adc || hs.masterClockHz ? `${telemetryText(hs.adc,'ADC used by antenna tune')} · ${hs.masterClockHz||''} Hz` : 'Clock not reported · ADC not available')}</b></span><span>BigBuf working memory <b>${escapeHtml(memoryLabel)}</b><small>${escapeHtml(memoryDetail)}</small></span><span>RF health <b>${escapeHtml(rfHealth)}</b></span><span>Self-test <b>${escapeHtml(telemetryText(hs.selfTest))}</b></span><span>MCU runtime <b>${escapeHtml(snapshot?.runtime?.state || "Not reported")}</b></span></div></div>
      <div class="deviceStudioStatusWide"><span>Firmware status transport</span><b>${escapeHtml(snapshot?.diagnostics?.status?.ok ? "Structured status received" : "Structured status not received")}</b><small>Command: <code>${escapeHtml(snapshot?.diagnostics?.status?.command || "hw status --json")}</code><br>Client: <code>${escapeHtml(snapshot?.diagnostics?.status?.binary || "Unknown")}</code>${snapshot?.diagnostics?.status?.error?`<br>Error: ${escapeHtml(snapshot.diagnostics.status.error)}`:""}</small><details><summary>Raw response</summary><pre class="deviceStudioSourcePreview">${escapeHtml(snapshot?.diagnostics?.status?.raw || "No response captured")}</pre></details></div>
    `;
  }
  function render(){
    renderImageCategories();
    renderImageGallery();
    renderComponentList();
    renderStage();
    renderInfoPanel();
    renderStatus();
    renderFirmwareLearning();
    renderDisclosureDetails();
    bindMetricGridDrag();
    renderComponentOverlay();
  }
  function renderDisclosureDetails(){
    const snapshot=state.snapshot||{};
    const device=snapshot.device||{};
    const hs=snapshot.hardwareStatus||{};
    const memory=hs.memory||null;
    const kib=(bytes)=>Number.isFinite(Number(bytes)) ? `${(Number(bytes)/1024).toFixed(1)} KB` : 'Not reported';
    const bigbufHasMeasurement=memory && Number.isFinite(Number(memory.bigbufBytes)) && Number.isFinite(Number(memory.bigbufFreeBytes));
    const lowWater=Number(memory?.bigbufLowWaterBytes);
    const bigbufHasLowWater=bigbufHasMeasurement && Number.isFinite(lowWater);
    const history=state.diagnosticHistory.slice().reverse().slice(0,12);
    const caps=snapshot.capabilityNegotiation?.effective||[];
    const panel=(id,html)=>{const el=document.getElementById(id); if(el) el.innerHTML=`<summary>${el.querySelector('summary')?.textContent||''}</summary>${html}`;};
    panel('deviceStudioHardwareDetails',`<div class="deviceStudioDisclosureGrid">
      <div><span>Board</span><b>${escapeHtml(device.model||'Not reported')}</b></div><div><span>MCU</span><b>${escapeHtml(device.mcu||'Not reported')}</b></div>
      <div><span>FPGA</span><b>${escapeHtml(hs.fpgaState===1?'Loaded':hs.fpgaState===0?'Not loaded':'Not reported')}</b></div><div><span>Clock</span><b>${hs.masterClockHz?`${hs.masterClockHz} Hz`:'Not reported'}</b></div>
      <div><span>Flash</span><b>${device.flashBytes?`${Math.round(device.flashBytes/1024)} KB · ${device.flashUsedPercent||'?'}% used`:'Not reported'}</b></div><div><span>BigBuf working memory</span><b>${bigbufHasMeasurement?`${kib(memory.bigbufFreeBytes)} free now${bigbufHasLowWater?` · ${kib(lowWater)} lowest free since boot`:''}`:'Not reported'}</b></div>
      <div><span>MCU runtime</span><b>${escapeHtml(snapshot.runtime?.state||'Not reported')}</b></div><div><span>Button</span><b>${hs.buttonPressed===true?'Pressed':hs.buttonPressed===false?'Released':'Not reported'}</b></div>
      <div><span>LED outputs</span><b>${hs.leds?Object.entries(hs.leds).map(([name,on])=>`${name.toUpperCase()} ${on?'on':'off'}`).join(' · '):'Not reported'}</b></div><div><span>USB identity</span><b>${escapeHtml(device.serialNumber||device.usbDescriptor?.product||'Not reported')}</b></div>
    </div><p class="deviceStudioDisclosureHint">Firmware-reported state is preferred. Unsupported sensors, board identifiers and LED brightness control remain explicit; Device Studio does not invent measurements.</p>`);
    panel('deviceStudioHistoryDetails',history.length?`<div class="deviceStudioHistoryList">${history.map(item=>`<div><b>${escapeHtml(item.connected?'Connected':'Disconnected')}</b><span>${escapeHtml(item.capturedAt||'Unknown time')}</span></div>`).join('')}</div>`:`<p class="deviceStudioDisclosureHint">No diagnostic history recorded yet.</p>`);
    const actions=snapshot.actionDescriptors||[];
    const recipes=snapshot.diagnosticRecipes||[];
    panel('deviceStudioCapabilitiesDetails',`<div class="deviceStudioCapabilitySummary">${(caps.length?caps:['No capabilities confirmed']).map(cap=>`<span>${escapeHtml(cap)}</span>`).join('')}</div><div class="deviceStudioActionSummary">${actions.map(action=>`<div class="${action.available===false?'unavailable':''}"><b>${escapeHtml(action.label)}</b><span>${escapeHtml(action.purpose)}</span><small>${escapeHtml(action.hardware)} · ${escapeHtml(action.duration)} · ${escapeHtml(action.risk)}</small></div>`).join('')||'<p class="deviceStudioDisclosureHint">No safe actions confirmed.</p>'}</div><div class="deviceStudioRecipeList"><h4>Guided diagnostic recipes</h4>${recipes.map(recipe=>`<details><summary>${escapeHtml(recipe.title)}${recipe.available?'':' · unavailable'}</summary><ol>${recipe.steps.map(step=>`<li>${escapeHtml(step)}</li>`).join('')}</ol><small>${escapeHtml(recipe.safety)} ${recipe.simulation?'A simulation can explain these steps without hardware.':''}</small></details>`).join('')||'<p class="deviceStudioDisclosureHint">No recipes are available for this firmware.</p>'}</div><p class="deviceStudioDisclosureHint">Capabilities are negotiated from firmware where available and inferred only from verified legacy output. Unavailable controls are explained instead of simulated as hardware features.</p>`);
    const transport=snapshot.diagnostics?.status||{};
    panel('deviceStudioAdvancedDetails',`<div class="deviceStudioAdvancedStack"><div><span>Firmware status transport</span><b>${transport.ok?'Structured status received':'Structured status not received'}</b></div><div><span>Client</span><code>${escapeHtml(transport.binary||'Not reported')}</code></div><div><span>Source</span><b>${escapeHtml(snapshot.source||'Unknown')}</b></div><details><summary>Raw response</summary><pre class="deviceStudioSourcePreview">${escapeHtml(transport.raw||'No response captured')}</pre></details></div>`);
    const advanced=document.getElementById('deviceStudioAdvancedDetails');
    if(advanced && !advanced.querySelector('[data-device-studio-tune-panel]')){
      advanced.insertAdjacentHTML('afterbegin','<section class="deviceStudioTuneExplorer" data-device-studio-tune-panel><h4>Explained antenna measurement</h4><p class="deviceStudioDisclosureHint">Uses repeated read-only <code>hw tune</code> measurements. This is the primary user-facing signal view; the raw ADC waveform below is diagnostic only.</p><p class="deviceStudioDisclosureHint"><b>Start with an empty antenna:</b> no tag and your hand away from the board. Device Studio first measures this normal state, then later readings can be compared with it. This changes nothing on the Proxmark3.</p><div data-device-studio-tune-guide></div><div data-device-studio-tune-result>No antenna measurement yet.</div><button type="button" data-device-studio-tune-start>Start antenna measurement</button><button type="button" data-device-studio-tune-stop>Stop antenna measurement</button><button type="button" data-device-studio-tune-baseline>Measure empty antenna and save reference</button></section>');
    }
    const tunePanel=advanced?.querySelector('[data-device-studio-tune-panel]');
    if(tunePanel && !tunePanel.querySelector('[data-device-studio-tune-lf]')) tunePanel.insertAdjacentHTML('beforeend','<div data-device-studio-tune-lf class="deviceStudioTuneBand"></div>');
    const renderTuneBands=()=>{const el=tunePanel?.querySelector('[data-device-studio-tune-lf]');if(!el)return;const t=state.tuneData,b=state.tuneBaseline;const lv=t?.lf?.voltage,lb=b?.lf?.voltage;const d=lv!==null&&lv!==undefined&&lb!==null&&lb!==undefined?Number(lv)-Number(lb):null;const deltaText=d===null?'':` · reference ${d>=0?'+':''}${d.toFixed(2)} V`;const title=b?'LF comparison':'LF measurement';const current=lv===null||lv===undefined?'Not measured yet':Number(lv).toFixed(2)+' V';const detail=b?'LF is evaluated separately from HF.':'Create the empty-antenna reference first; LF results will then be compared with it.';el.innerHTML=`<b>${title}</b><br>Current: ${current}${deltaText}<small>${detail}</small>`;};
    const renderTuneGuide=()=>{const guide=tunePanel?.querySelector('[data-device-studio-tune-guide]');if(!guide)return;const running=!!state.tuneTimer,hasReference=!!state.tuneBaseline;if(running){guide.innerHTML='<div class="deviceStudioTuneGuide active"><b>Measurement is running</b><ol><li>You do not need to press Stop before testing a tag.</li><li>Place one HF or LF tag on the marked antenna area and wait for the next reading.</li><li>Remove the tag and watch the HF/LF values return towards the reference.</li><li>Press <b>Stop antenna measurement</b> when you are done, or before starting a card scan. That releases the USB port.</li></ol></div>';return;}if(!hasReference){guide.innerHTML='<div class="deviceStudioTuneGuide"><b>Step 1 — make a normal reference</b><ol><li>Keep tags away and move your hand away from the board.</li><li>Click <b>Measure empty antenna and save reference</b>.</li><li>Wait until the app says that the empty-antenna reference was saved.</li><li>Then start the antenna measurement and place one tag at a time to compare it.</li></ol></div>';return;}guide.innerHTML='<div class="deviceStudioTuneGuide"><b>Reference ready — test a tag</b><ol><li>Click <b>Start antenna measurement</b>.</li><li>Place one tag on the antenna and wait for a new reading.</li><li>Compare HF and LF with the saved reference; only the matching band should change noticeably.</li><li>Click <b>Stop antenna measurement</b> when finished or before using card-scan functions.</li></ol><small>Use “Replace empty-antenna reference” only when the antenna is empty again and you deliberately want a new normal reference.</small></div>';};
    const renderTune=()=>{if(!tunePanel)return; const t=state.tuneData,b=state.tuneBaseline; const hv=t?.hf?.voltage, bv=b?.hf?.voltage; const delta=hv!==null&&hv!==undefined&&bv!==null&&bv!==undefined?Number(hv)-Number(bv):null; const text=!t?'No antenna measurement yet. Start by measuring the empty antenna to create a normal reference.':!b?'Normal reading measured. If the antenna is empty, save this as your reference.':delta===null?'Waiting for a comparable measurement.':Math.abs(delta)<0.5?'No clear HF voltage change detected.':Math.abs(delta)<2?'Small HF voltage change detected; repeat with fixed placement.':'Clear HF voltage change detected; repeat to confirm.'; const reference=b?'<small>Empty-antenna reference saved. Later readings show their HF/LF voltage difference from this normal state.</small>':''; const result=t?`<b>${escapeHtml(text)}</b><br>HF ${hv===null||hv===undefined?'Unknown':Number(hv).toFixed(2)+' V'} · LF ${t.lf?.voltage===null||t.lf?.voltage===undefined?'Unknown':Number(t.lf.voltage).toFixed(2)+' V'}${delta===null?'':` · reference ${delta>=0?'+':''}${delta.toFixed(2)} V HF`}<small>Voltage changes show antenna loading/coupling, not tag identification.</small>${reference}`:text; const el=tunePanel.querySelector('[data-device-studio-tune-result]'); if(el)el.innerHTML=result; const button=tunePanel.querySelector('[data-device-studio-tune-baseline]'); if(button)button.textContent=!t?'Measure empty antenna and save reference':!b?'Save this reading as empty-antenna reference':'Replace empty-antenna reference with current reading';renderTuneGuide();};
    renderTune(); renderTuneBands();
    tunePanel?.querySelector('[data-device-studio-tune-start]')?.addEventListener('click',()=>{if(state.tuneTimer)return; const result=tunePanel.querySelector('[data-device-studio-tune-result]'); if(result)result.innerHTML='<b>Measuring HF and LF antenna response…</b><small>Read-only measurement in progress. Stop remains available.</small>'; const poll=async()=>{if(!state.tuneTimer||state.tuneBusy)return; state.tuneBusy=true; const r=await window.pm3api?.getDeviceStudioTuneSnapshot?.(); state.tuneBusy=false; if(r?.ok&&r.data){state.tuneData=r.data;if(state.tuneBaselinePending){state.tuneBaseline=r.data;state.tuneBaselineCapturedAt=new Date().toISOString();state.tuneBaselinePending=false;}renderTune();renderTuneBands();} else if(r?.message&&result) result.innerHTML=`<b>Antenna measurement did not complete.</b><small>${escapeHtml(r.message)}</small>`; if(state.tuneTimer)state.tuneTimer=setTimeout(poll,350);}; state.tuneTimer=setTimeout(poll,0);renderTuneGuide();});
    tunePanel?.querySelector('[data-device-studio-tune-stop]')?.addEventListener('click',async()=>{if(state.tuneTimer){clearTimeout(state.tuneTimer);state.tuneTimer=null;} state.tuneBusy=false; renderTuneGuide(); const result=tunePanel.querySelector('[data-device-studio-tune-result]'); if(result)result.innerHTML='<b>Stopping antenna measurement…</b><small>Releasing the Proxmark3 USB port.</small>'; const r=await window.pm3api?.stopDeviceStudioTune?.(); if(result)result.innerHTML=`<b>Antenna measurement stopped.</b><small>${escapeHtml(r?.message||'USB port release requested.')}</small>`;});
    tunePanel?.querySelector('[data-device-studio-tune-baseline]')?.addEventListener('click',()=>{const result=tunePanel.querySelector('[data-device-studio-tune-result]'); if(state.tuneBusy){state.tuneBaselinePending=true;if(result)result.innerHTML='<b>Empty-antenna reference will be saved from the measurement now running.</b><small>Keep the antenna empty and your hand away until this measurement completes.</small>';return;} if(state.tuneData){state.tuneBaseline=state.tuneData;state.tuneBaselineCapturedAt=new Date().toISOString();renderTune();renderTuneBands();return;} state.tuneBaselinePending=true;if(result)result.innerHTML='<b>Starting a measurement for the empty-antenna reference…</b><small>Keep the antenna empty and your hand away until it completes.</small>';tunePanel.querySelector('[data-device-studio-tune-start]')?.click();});
  }
  function bindMetricGridDrag(){
    document.querySelectorAll('.deviceStudioMetricGrid').forEach(grid=>{
      if(grid.dataset.dragBound) return;
      grid.dataset.dragBound='1';
      let startX=0,startScroll=0,dragging=false;
      grid.addEventListener('pointerdown',event=>{if(event.button!==0)return;startX=event.clientX;startScroll=grid.scrollLeft;dragging=true;grid.classList.add('dragging');grid.setPointerCapture?.(event.pointerId);event.preventDefault();});
      grid.addEventListener('pointermove',event=>{if(!dragging)return;grid.scrollLeft=startScroll-(event.clientX-startX);event.preventDefault();});
      const stop=()=>{dragging=false;grid.classList.remove('dragging');};
      grid.addEventListener('pointerup',stop);
      grid.addEventListener('pointercancel',stop);
    });
  }
  function bindOverlayDrag(host){
    const overlay=host.querySelector('.deviceStudioOverlay');
    const handle=host.querySelector('[data-device-studio-overlay-drag]');
    if(!overlay || !handle) return;
    let dragging=false, offsetX=0, offsetY=0;
    const stop=()=>{dragging=false;overlay.classList.remove('dragging');};
    handle.addEventListener('pointerdown',event=>{
      if(event.button!==0 || event.target.closest('button')) return;
      const rect=overlay.getBoundingClientRect();
      offsetX=event.clientX-rect.left;
      offsetY=event.clientY-rect.top;
      state.overlayPosition={left:rect.left,top:rect.top};
      dragging=true;
      overlay.classList.add('dragging');
      handle.setPointerCapture?.(event.pointerId);
      event.preventDefault();
    });
    handle.addEventListener('pointermove',event=>{
      if(!dragging || !state.overlayPosition) return;
      const padding=8;
      state.overlayPosition.left=Math.max(padding,Math.min(window.innerWidth-overlay.offsetWidth-padding,event.clientX-offsetX));
      state.overlayPosition.top=Math.max(padding,Math.min(window.innerHeight-overlay.offsetHeight-padding,event.clientY-offsetY));
      overlay.style.left=`${state.overlayPosition.left}px`;
      overlay.style.top=`${state.overlayPosition.top}px`;
      overlay.style.transform='none';
      event.preventDefault();
    });
    handle.addEventListener('pointerup',stop);
    handle.addEventListener('pointercancel',stop);
  }
  function selectImage(id){
    state.activeImageId=id;
    const imageHotspots=hotspotsForImage(id);
    if(!imageHotspots.some(item=>item.componentId===state.activeComponentId) && imageHotspots[0]){
      state.activeComponentId=imageHotspots[0].componentId;
    }
    syncHotspotEditorSelection();
    render();
  }
  function selectComponent(id, options={}){
    const selected=componentById(id);
    if(!selected || selected.id!==id) return false;
    state.activeComponentId=id;
    if(options.followImage){
      const matching=state.hotspots.find(item=>item.componentId===id);
      if(matching) state.activeImageId=matching.imageId;
    }
    syncHotspotEditorSelection();
    render();
    return true;
  }
  function bindSelectionDelegation(){
    const root=document.getElementById("tab-device-studio");
    if(!root || state.selectionListenerReady) return;
    state.selectionListenerReady=true;
    root.addEventListener("click",event=>{
      const disclosure=event.target.closest?.('[data-device-studio-disclosure]');
      if(disclosure && root.contains(disclosure)){
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation?.();
        const target=document.getElementById(disclosure.dataset.deviceStudioDisclosure);
        if(target){
          target.open=true;
          window.requestAnimationFrame?.(()=>target.scrollIntoView({behavior:'smooth',block:'nearest'}));
        }
        return;
      }
      const plot=event.target.closest?.('[data-device-studio-plot]');
      if(plot && root.contains(plot)){ event.preventDefault(); window.pm3api?.openDeviceStudioAntennaPlot?.(); return; }
      const stopPlot=event.target.closest?.('[data-device-studio-stop-plot]');
      if(stopPlot && root.contains(stopPlot)){ event.preventDefault(); window.pm3api?.stopDeviceStudioAntennaPlot?.(); return; }
      const target=event.target.closest?.("[data-device-studio-component]");
      if(!target || !root.contains(target)) return;
      const id=target.dataset.deviceStudioComponent;
      if(!id) return;
      event.preventDefault();
      event.stopPropagation();
      if(target.closest("#deviceStudioStage")) handleHotspotClick(id);
      else selectComponent(id,{followImage:true});
    },true);
  }
  function bindOverlayKeyboard(){
    if(state.overlayKeyboardReady) return;
    state.overlayKeyboardReady=true;
    document.addEventListener('keydown',event=>{
      if(event.key!=="Escape" || !state.overlayOpen) return;
      event.preventDefault();
      state.overlayOpen=false;
      renderComponentOverlay();
    });
  }
  async function init(){
    const root=document.getElementById("tab-device-studio");
    if(!root || state.loaded) return;
    const [device, componentsData, hotspotsData, learningData]=await Promise.all([
      loadJson(`${DEVICE_BASE}device.json`),
      loadJson(`${DEVICE_BASE}components.json`),
      loadJson(`${DEVICE_BASE}hotspots.json`),
      loadJson(`${DEVICE_BASE}learning.json`)
    ]);
    state.device=device;
    state.components=Array.isArray(componentsData.components) ? componentsData.components : [];
    state.hotspots=Array.isArray(hotspotsData.hotspots) ? hotspotsData.hotspots : [];
    state.images=Array.isArray(hotspotsData.images) ? hotspotsData.images : [];
    state.learning=learningData?.components || {};
    loadDiagnosticHistory();
    state.explanationLevel=learningData?.defaultLevel || "simple";
    state.activeImageId=hotspotsData.defaultImage || state.images[0]?.id || "";
    state.activeComponentId=state.hotspots.find(item=>item.imageId===state.activeImageId)?.componentId || state.components[0]?.id || "";
    try{
      const editor=await window.pm3api?.getDeviceStudioHotspotEditorStatus?.();
      state.hotspotEditor.available=!!editor?.enabled;
    }catch{ state.hotspotEditor.available=false; }
    state.loaded=true;
    bindSelectionDelegation();
    bindOverlayKeyboard();
    render();
    const editorButton=document.getElementById("deviceStudioHotspotEditorBtn");
    if(editorButton){
      editorButton.hidden=!state.hotspotEditor.available;
      editorButton.onclick=toggleHotspotEditor;
    }
    const quickRefreshBtn=document.getElementById("deviceStudioQuickRefreshBtn");
    if(quickRefreshBtn) quickRefreshBtn.onclick=()=>refreshDiagnostics({kind:"quick"});
    const fullCheckBtn=document.getElementById("deviceStudioFullCheckBtn");
    if(fullCheckBtn) fullCheckBtn.onclick=()=>refreshDiagnostics({kind:"full"});
    const safeModeToggle=document.getElementById('deviceStudioSafeModeToggle');
    if(safeModeToggle){
      safeModeToggle.onchange=()=>setDeviceStudioSafeMode(safeModeToggle.checked);
      // Safe Mode is a session guard, so Device Studio enables it once when
      // this workspace opens.  A later explicit user toggle is respected.
      const initial=await window.pm3api?.setDeviceStudioSafeMode?.(true);
      state.safeMode.available=initial?.data?.available===true;
      state.safeMode.enabled=initial?.data?.enabled===true;
      state.safeMode.message=initial?.ok?'':(initial?.message||'Device Studio Safe Mode is not available from this firmware.');
      syncDeviceStudioSafeModeControl();
    }
    if(!state.progressListenerReady && window.pm3api?.onDeviceStudioProgress){
      state.progressListenerReady=true;
      window.pm3api.onDeviceStudioProgress(progress=>{
        state.diagnosticProgress=progress;
        updateRefreshProgressFromFirmware(progress);
        if(progress?.phase==="complete" || progress?.phase==="error"){
          state.lastDiagnosticOutcome={...progress};
          const finishedProgress=progress;
          setTimeout(()=>{
            if(state.diagnosticProgress===finishedProgress){
              state.diagnosticProgress={phase:'idle',componentId:null,label:'Idle',timestamp:new Date().toISOString(),source:'electron-observed'};
              renderStage();
              renderInfoPanel();
              renderStatus();
            }
          },900);
        }
        renderStage();
        renderInfoPanel();
        renderStatus();
      });
    }
    // Opening Device Studio is informational. Antenna measurement starts only
    // after the user explicitly chooses Full RF Check.
    render();
  }
  async function refreshDiagnostics({kind="full"}={}){
    const api=kind==="quick" ? window.pm3api?.getDeviceStudioQuickRefresh : (window.pm3api?.getDeviceStudioFullCheck || window.pm3api?.getDeviceStudioSnapshot);
    if(state.refreshing || !api) return;
    const sharedConnection=window.DeviceConnectionStatusCard?.getState?.() || {};
    if(kind==="full" && sharedConnection.connected===true && sharedConnection.sessionOwner==="console"){
      state.refreshError="Device Console is using the PM3 port. Disconnect that session before running Full RF Check.";
      renderStatus();
      window.alert(state.refreshError);
      return;
    }
    state.refreshing=true;
    state.refreshKind=kind;
    state.refreshError="";
    startRefreshProgress(kind);
    renderStatus();
    const quickButton=document.getElementById("deviceStudioQuickRefreshBtn");
    const fullButton=document.getElementById("deviceStudioFullCheckBtn");
    if(quickButton) quickButton.disabled=true;
    if(fullButton) fullButton.disabled=true;
    if(kind==="quick" && quickButton) quickButton.textContent="Refreshing...";
    if(kind==="full" && fullButton) fullButton.textContent="Checking RF...";
    try{
      // If Device Studio was opened before the board was connected, retry the
      // requested default once a later refresh can reach the firmware.
      if(state.safeMode.requested && state.safeMode.available!==true && window.pm3api?.setDeviceStudioSafeMode){
        const enabled=await window.pm3api.setDeviceStudioSafeMode(true);
        if(enabled?.ok){
          state.safeMode.available=enabled.data?.available===true;
          state.safeMode.enabled=enabled.data?.enabled===true;
          state.safeMode.message='';
        }
      }
      const result=await api();
      if(kind==="quick"){
        if(!result?.ok || !result?.snapshot) throw new Error(result?.message || "Quick Refresh was unavailable.");
        state.snapshot=result.snapshot;
      }else state.snapshot=result;
      state.lastRefreshKind=kind;
      if(state.snapshot?.deviceStudioSafeMode?.available===true){
        state.safeMode.available=true;
        state.safeMode.enabled=state.snapshot.deviceStudioSafeMode.enabled===true;
      }
      recordDiagnostic(state.snapshot);
      if(state.snapshot?.connection?.connected && window.pm3api?.getDeviceStudioLedStatus){
        const ledStatus=await window.pm3api.getDeviceStudioLedStatus();
        if(ledStatus?.data) applyFirmwareLedStatus(ledStatus.data);
      }
    }catch(error){
      state.refreshError=String(error?.message || error);
    }finally{
      state.refreshing=false;
      stopRefreshProgress({complete:!state.refreshError});
      if(quickButton){ quickButton.disabled=false; quickButton.textContent="Quick Refresh"; }
      if(fullButton){ fullButton.disabled=false; fullButton.textContent="Full RF Check"; }
      render();
      syncDeviceStudioSafeModeControl();
    }
  }
  async function refresh(){
    state.loaded=false;
    await init();
  }

  window.DeviceStudioManager={init, refresh, refreshDiagnostics, selectComponent, state};
})();
