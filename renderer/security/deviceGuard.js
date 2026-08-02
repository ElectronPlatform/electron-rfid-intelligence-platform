/*
 * Electron Device Guard
 *
 * Central preflight layer for hardware-dependent workflows.
 *
 * This is the first step toward Electron's future Device Manager:
 * UI code should ask this guard whether the active device can safely run a
 * workflow, instead of checking for a specific hardware brand everywhere.
 *
 * Current adapter:
 * - Proxmark3 through the pm3 client.
 *
 * Future adapters can extend ACTIVE_DEVICE.capabilities and replace the
 * preflight bridge without changing Card Lab, Device Console or Reports.
 */
(function(){
  const ACTIVE_DEVICE={
    id:"proxmark3",
    displayName:"Proxmark3",
    capabilities:{
      hf:{supported:true, level:"full"},
      lf:{supported:true, level:"full"},
      write:{supported:true, level:"restricted"},
      sniff:{supported:true, level:"full"},
      emulation:{supported:true, level:"full"},
      standalone:{supported:true, level:"full"},
      bluetooth:{supported:false, level:"none"},
      firmwareUpdate:{supported:true, level:"restricted"},
      logging:{supported:true, level:"full"},
      deviceInfo:{supported:true, level:"full"}
    }
  };

  let busy=false;

  function text(value){ return String(value ?? ""); }
  function commandCapabilities(command){
    const cmd=text(command).trim().toLowerCase();
    const caps=[];
    if(/^hf\b/.test(cmd)) caps.push("hf");
    if(/^lf\b/.test(cmd)) caps.push("lf");
    if(/^hw\s+version\b/.test(cmd)) caps.push("deviceInfo");
    if(/\b(write|wrbl|restore|clone|sim|eml|eload|esave|sniff)\b/.test(cmd)){
      if(/\bsniff\b/.test(cmd)) caps.push("sniff");
      if(/\b(sim|eml|eload|esave)\b/.test(cmd)) caps.push("emulation");
      if(/\b(write|wrbl|restore|clone)\b/.test(cmd)) caps.push("write");
    }
    return [...new Set(caps)];
  }

  function activeDevice(){
    return window.DeviceRegistry?.activeProfile?.() || ACTIVE_DEVICE;
  }

  function hasCapability(capability){
    const item=activeDevice().capabilities?.[capability];
    return !!item?.supported;
  }

  function unsupportedCapabilities(capabilities=[]){
    return capabilities.filter(capability=>!hasCapability(capability));
  }

  function failureTitle(result){
    if(result?.status==="busy") return "Device is busy";
    if(result?.status==="timeout") return "Device check timed out";
    if(result?.status==="missing-bridge") return "Device bridge unavailable";
    if(result?.status==="unsupported-device") return "Device profile not runnable yet";
    if(result?.status==="unsupported-capability") return "Device capability unavailable";
    return "No device detected";
  }

  function failureBody(result, workflow){
    const label=workflow || "This workflow";
    if(result?.status==="busy"){
      return `<p>${label} cannot start because the device port is already in use.</p><p class="small">${escapeHtml(result.message || "Close the other app or disconnect the device, then try again.")}</p>`;
    }
    if(result?.status==="timeout"){
      return `<p>${label} cannot start because the device did not respond quickly enough.</p><p class="small">Reconnect the reader, then try again.</p>`;
    }
    if(result?.status==="unsupported-capability"){
      return `<p>${label} needs device capability: <b>${escapeHtml((result.missing || []).join(", "))}</b>.</p><p class="small">The active adapter does not currently provide that capability.</p>`;
    }
    if(result?.status==="missing-bridge"){
      return `<p>${label} cannot start because Electron's device bridge is not available in this window.</p>`;
    }
    if(result?.status==="unsupported-device"){
      return `<p>${escapeHtml(result.message || "This device profile is not runnable yet.")}</p><p class="small">You can still browse its command library and notes.</p>`;
    }
    return `<p>${label} needs a connected RFID device first.</p><p class="small">Connect your Proxmark3, wait a moment, then try again.</p>`;
  }

  function escapeHtml(value){
    return text(value).replace(/[&<>"']/g, c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
  }

  function showFailure(result, options={}){
    if(options.silent) return;
    const title=failureTitle(result);
    const body=failureBody(result, options.workflow);
    if(window.UIEngine?.alert){
      window.UIEngine.alert({title, body, variant:"warning", buttonText:"Close", size:"sm"});
    }else if(typeof alert==="function"){
      alert(`${title}\n\n${body.replace(/<[^>]+>/g, " ")}`);
    }
  }

  async function preflightWithTimeout(capabilities, timeoutMs){
    if(!window.pm3api?.devicePreflight && !window.pm3api?.listPm3){
      return {ok:false,status:"missing-bridge",message:"Device bridge is not available."};
    }
    const profile=activeDevice();
    if(profile.id!=="proxmark3" && !/^proxmark3_/.test(profile.id || "")){
      return {
        ok:false,
        status:"unsupported-device",
        message:`${profile.displayName || profile.id} is prepared as a profile, but command execution is not implemented yet.`
      };
    }
    const work=window.pm3api.devicePreflight
      ? window.pm3api.devicePreflight({capabilities})
      : window.pm3api.listPm3();
    const timeout=new Promise(resolve=>{
      setTimeout(()=>resolve({ok:false,status:"timeout",message:"Device preflight timed out."}), timeoutMs || 9000);
    });
    return Promise.race([work, timeout]);
  }

  async function ensure(options={}){
    const workflow=options.workflow || "This workflow";
    const capabilities=[...(options.capabilities || []), ...commandCapabilities(options.command)].filter(Boolean);
    const missing=unsupportedCapabilities(capabilities);
    if(missing.length){
      const result={ok:false,status:"unsupported-capability",missing,message:`Missing capabilities: ${missing.join(", ")}`};
      showFailure(result, {workflow, silent:options.silent});
      return result;
    }
    if(busy && !options.allowWhileBusy){
      const result={ok:false,status:"busy",message:"Another device command is still running."};
      showFailure(result, {workflow, silent:options.silent});
      return result;
    }
    const state=await window.pm3api?.pm3State?.();
    if(state?.running){
      return {
        ok:true,
        status:"ready",
        activeSession:true,
        pid:state.pid || null,
        capabilities
      };
    }
    const result=await preflightWithTimeout(capabilities, options.timeoutMs);
    if(!result?.ok){
      showFailure(result || {ok:false,status:"no-device"}, {workflow, silent:options.silent});
      return result || {ok:false,status:"no-device"};
    }
    return {...result, capabilities};
  }

  async function runLiveCommand(command, options={}){
    const capabilities=commandCapabilities(command);
    const missing=unsupportedCapabilities(capabilities);
    if(missing.length){
      const result={ok:false,status:"unsupported-capability",missing,message:`Missing capabilities: ${missing.join(", ")}`};
      showFailure(result, {workflow:options.workflow, silent:options.silent});
      return result;
    }
    const state=await window.pm3api?.pm3State?.();
    if(state?.running){
      const sent=await window.pm3api.sendPm3(command);
      return Object.assign({stdout:"",stderr:"", sentToActiveSession:true}, sent);
    }
    const check=await ensure({...options, command});
    if(!check?.ok) return {ok:false, blockedByDeviceGuard:true, message:check?.message || "Device is not available.", status:check?.status};
    busy=true;
    try{
      return await window.pm3api.runPm3LiveCommand(command);
    }finally{
      busy=false;
    }
  }

  window.DeviceGuard={
    activeDevice,
    commandCapabilities,
    hasCapability,
    ensure,
    runLiveCommand,
    isBusy:()=>busy,
    setBusy(value){ busy=!!value; }
  };
})();
