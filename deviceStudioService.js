/*
 * Device Studio v2 service
 *
 * Translates existing, read-only Iceman client output into one stable JSON
 * model. Keep PM3 text parsing here; renderer code consumes structured data.
 */
'use strict';

const SCHEMA_VERSION='2.0';

const KNOWN_CAPABILITIES=new Set([
  'hf','lf','fpga','external-flash','led-control','led-brightness','button-status',
  'board-temperature','board-voltage','power-telemetry','self-test',
  'basic-self-test','diagnostics','hardware-status','module-detection','event-stream',
  'memory-statistics','clock-status','fpga-status','scope-snapshot','button-control','button-profile',
  'usb-descriptors','board-identity','busy-status','rf-health'
  ,'device-studio-snapshot','device-studio-safe-mode'
]);

const CAPABILITY_ADAPTERS={
  hf:{components:['hf-antenna'],actions:['diagnostics'],explanation:'High-frequency RFID/NFC radio support.'},
  lf:{components:['lf-antenna-module'],actions:['diagnostics'],explanation:'Low-frequency RFID support.'},
  'led-control':{components:['led-a','led-b','led-c','led-d'],actions:['led-test'],explanation:'Timed, reversible LED identification.'},
  'led-status':{components:['power-led','led-a','led-b','led-c','led-d'],actions:['led-status'],explanation:'Firmware-reported LED state and mapping.'},
  'button-status':{components:['button'],actions:['button-information'],explanation:'Firmware-reported physical button state.'},
  'button-profile':{components:['button'],actions:['button-information'],explanation:'Firmware-reported button gestures and their current roles.'},
  'button-control':{components:['button'],actions:['button-information'],explanation:'Optional firmware-defined button configuration capability; shown as information in diagnostic mode.'},
  'hardware-status':{components:['main-usb-port','atmel-mcu','xilinx-spartan-fpga','power-section'],actions:['diagnostics'],explanation:'Structured hardware telemetry.'},
  fpga:{components:['xilinx-spartan-fpga'],actions:['diagnostics'],explanation:'FPGA radio timing and signal processing.'},
  'external-flash':{components:['flash-memory'],actions:['diagnostics'],explanation:'Firmware/resource flash storage.'},
  diagnostics:{components:['main-usb-port','hf-antenna','lf-antenna-module'],actions:['diagnostics'],explanation:'Read-only Device Studio diagnostics.'},
  'self-test':{components:['atmel-mcu','xilinx-spartan-fpga','power-section'],actions:['self-test'],explanation:'Firmware-reported board health test.'},
  'basic-self-test':{components:['atmel-mcu','xilinx-spartan-fpga','main-usb-port'],actions:['self-test'],explanation:'Basic firmware self-test of USB, MCU and FPGA.'},
  'memory-statistics':{components:['flash-memory','atmel-mcu'],actions:['diagnostics'],explanation:'Firmware-reported working-buffer statistics.'},
  'clock-status':{components:['atmel-mcu','xilinx-spartan-fpga'],actions:['diagnostics'],explanation:'Firmware-reported clock information.'},
  'fpga-status':{components:['xilinx-spartan-fpga'],actions:['diagnostics'],explanation:'Firmware-reported FPGA loaded or fault state.'},
  'busy-status':{components:['atmel-mcu'],actions:['diagnostics'],explanation:'Firmware-reported runtime busy or idle state.'},
  'usb-descriptors':{components:['main-usb-port'],actions:['diagnostics'],explanation:'Operating-system USB identity reported for this connected device.'},
  'board-identity':{components:['atmel-mcu','power-section'],actions:['diagnostics'],explanation:'Firmware or USB-reported board family and revision.'}
  ,'device-studio-snapshot':{components:['atmel-mcu','xilinx-spartan-fpga'],actions:['diagnostics'],explanation:'Versioned firmware telemetry contract for Device Studio.'}
  ,'device-studio-safe-mode':{components:['atmel-mcu'],actions:['diagnostics'],explanation:'Runtime workflow guard for selected write, clone, simulation and standalone commands.'}
  ,'device-studio-status':{components:['atmel-mcu','flash-memory'],actions:['diagnostics'],explanation:'Extended versioned firmware telemetry with measured BigBuf and trace state.'}
};
const ACTION_DESCRIPTORS={
  diagnostics:{id:'diagnostics',label:'Run diagnostics',purpose:'Read hardware and antenna information',hardware:'MCU, FPGA and HF/LF paths',firmware:'hw version + hw tune + hw status --json',expectedResult:'Structured diagnostic snapshot',duration:'temporary',risk:'read-only',persistent:false},
  'led-control':{id:'led-control',label:'Test LED',purpose:'Identify one physical LED',hardware:'LED controller',firmware:'hw leds --test',expectedResult:'LED returns to its previous state',duration:'600 ms',risk:'temporary and reversible',persistent:false},
  'button-information':{id:'button-information',label:'Button information',purpose:'Explain the physical button state and firmware-defined role',hardware:'Physical button',firmware:'hw status --json and local firmware source when available',expectedResult:'Reported state plus clearly labelled firmware/source explanation',duration:'included in diagnostics',risk:'informational only',persistent:false},
  'self-test':{id:'self-test',label:'Run self-test',purpose:'Check reported board health',hardware:'Board subsystems',firmware:'hw diagnostics --json',expectedResult:'Pass/fail health report',duration:'temporary',risk:'read-only',persistent:false},
  'antenna-measurement':{id:'antenna-measurement',label:'Measure antenna response',purpose:'Compare HF/LF antenna loading with a normal empty-antenna reading',hardware:'HF and LF antenna paths',firmware:'hw tune',expectedResult:'HF/LF voltage measurements',duration:'temporary',risk:'read-only diagnostic field',persistent:false},
  'led-brightness-unavailable':{id:'led-brightness-unavailable',label:'LED brightness unavailable',purpose:'Explain why the current board cannot safely dim LEDs',hardware:'Proxmark3 Easy LED GPIO path',firmware:'No PWM/current-control capability reported',expectedResult:'No hardware state is changed',duration:'not available',risk:'not supported by this hardware',persistent:false,available:false}
};

function buildCapabilityAdapterRegistry(capabilities=[]){
  const result={};
  for(const capability of normaliseCapabilityList(capabilities)){
    result[capability]=CAPABILITY_ADAPTERS[capability] || {components:[],actions:[],explanation:'Future firmware capability; no Device Studio adapter is registered yet.'};
  }
  return result;
}

function clean(value){
  return String(value ?? '').replace(/\x1b\[[0-?]*[ -\/]*[@-~]/g,'').replace(/\r/g,'').trim();
}

function first(text, patterns){
  for(const pattern of patterns){
    const match=text.match(pattern);
    if(match?.[1]) return clean(match[1]);
  }
  return null;
}

function number(text, patterns){
  const value=first(text, patterns);
  if(value===null) return null;
  const parsed=Number(String(value).replace(',','.'));
  return Number.isFinite(parsed) ? parsed : null;
}

function parseVersionOutput(raw=''){
  const text=clean(raw);
  const lower=text.toLowerCase();
  const model=first(text,[
    /^\s*firmware\s*\.*\s*(PM3\s+(?:GENERIC|EASY|RDV4))\s*$/im,
    /^\s*(?:device|hardware)\s*(?:model|type)?\s*[.:=-]+\s*(.+)$/im,
    /((?:Proxmark3|PM3)\s+(?:Easy|RDV4)[^\n]*)/i
  ]);
  const flashBytes=number(text,[
    /flash(?:\s+(?:memory|size))?\s*[.:=-]+\s*(\d+)\s*(?:bytes?)?/i,
    /(?:external\s+)?flash[^\n]*?\b(\d+)\s*(KB|MB)\b/i
  ]);
  const embeddedFlash=text.match(/embedded\s+flash\s+memory\s+(\d+)\s*K(?:B)?\b[^\n]*?\(\s*(\d+(?:[.,]\d+)?)\s*%\s*used\s*\)/i);
  const parsedFlashBytes=embeddedFlash ? Number(embeddedFlash[1])*1024 : flashBytes;
  const flashUsedPercent=embeddedFlash ? Number(String(embeddedFlash[2]).replace(',','.')) : null;
  const buildDate=first(text,[/(?:Iceman|RRG)[^\n]*?\b(20\d{2}-\d{2}-\d{2})\s+(\d{2}:\d{2}:\d{2})/i]);
  return {
    model,
    firmware:first(text,[/^\s*(?:os|firmware)\s*[.:=-]+\s*(.+)$/im,/(Iceman[^\n]*)/i]),
    client:first(text,[/^\s*client\s*[.:=-]+\s*(.+)$/im]),
    bootrom:first(text,[/^\s*bootrom\s*[.:=-]+\s*(.+)$/im]),
    fpga:first(text,[/^\s*fpga(?:\s+(?:image|version))?\s*[.:=-]+\s*(.+)$/im,/(FPGA image[^\n]*)/i]),
    mcu:first(text,[/(AT91SAM7S\w*)/i,/^\s*mcu\s*[.:=-]+\s*(.+)$/im]),
    mcuRevision:first(text,[/AT91SAM7S\w*\s+Rev\s+([A-Z])/i]),
    serialNumber:first(text,[/^\s*(?:serial(?:\s+number)?|device id)\s*[.:=-]+\s*(.+)$/im]),
    buildDate,
    flashBytes:parsedFlashBytes,
    flashUsedPercent,
    firmwareFamily:lower.includes('iceman') ? 'Iceman' : null,
    capabilities:{
      hf:/\bhf\b|13\.56\s*mhz/i.test(text),
      lf:/\blf\b|12[45]\s*khz|134\s*khz/i.test(text),
      fpga:/fpga/i.test(text),
      externalFlash:/flash/i.test(text)
    }
  };
}

function parseTuneOutput(raw=''){
  const text=clean(raw);
  const voltage=(label)=>number(text,[
    new RegExp(`${label}[^\\n]*?(\\d+(?:[.,]\\d+)?)\\s*V\\b`,'i'),
    new RegExp(`${label}[^\\n]*?(\\d+(?:[.,]\\d+)?)\\s*mV\\b`,'i')
  ]);
  const frequency=(label)=>number(text,[
    new RegExp(`${label}[^\\n]*?(\\d+(?:[.,]\\d+)?)\\s*(?:kHz|MHz)\\b`,'i')
  ]);
  const result={
    hf:{
      voltage:voltage('HF(?:\\s+antenna)?'),
      frequencyMHz:frequency('HF(?:\\s+antenna)?')
    },
    lf:{
      voltage:voltage('LF(?:\\s+antenna)?'),
      frequencyKHz:frequency('LF(?:\\s+antenna)?'),
      peakKHz:number(text,[/LF[^\n]*(?:optimal|peak)[^\n]*?(\d+(?:[.,]\d+)?)\s*kHz/i])
    }
  };
  // Iceman's current hw tune output prints the measurement on a separate
  // line, e.g. "13.56 MHz ... 14.18 V", without repeating the antenna label.
  const linePrefix='(?:\\[[^\\]]+\\]\\s*)?';
  const hfLine=text.match(new RegExp('(?:^|\\n)\\s*'+linePrefix+'(\\d+(?:[.,]\\d+)?)\\s*MHz[^\\n]*?(\\d+(?:[.,]\\d+)?)\\s*V\\b','im'));
  if(result.hf.frequencyMHz===null && hfLine) result.hf.frequencyMHz=Number(hfLine[1].replace(',','.'));
  if(result.hf.voltage===null && hfLine) result.hf.voltage=Number(hfLine[2].replace(',','.'));
  const lfLines=[...text.matchAll(new RegExp('(?:^|\\n)\\s*'+linePrefix+'(\\d+(?:[.,]\\d+)?)\\s*kHz[^\\n]*?(\\d+(?:[.,]\\d+)?)\\s*V\\b','gim'))];
  if(result.lf.frequencyKHz===null && lfLines[0]) result.lf.frequencyKHz=Number(lfLines[0][1].replace(',','.'));
  if(result.lf.voltage===null && lfLines[0]) result.lf.voltage=Number(lfLines[0][2].replace(',','.'));
  if(result.lf.peakKHz===null){ const optimal=lfLines.find(match=>/optimal/i.test(match[0])); if(optimal) result.lf.peakKHz=Number(optimal[1].replace(',','.')); }
  return result;
}

function normaliseCapabilityList(values=[]){
  return [...new Set((Array.isArray(values)?values:[])
    .map(value=>clean(value).toLowerCase().replace(/[_\s]+/g,'-'))
    .filter(Boolean))];
}

// A future firmware can add this object to `hw status --json` without a
// renderer redesign.  The UI never invents a writable control: configuring a
// profile requires all three explicit firmware promises below.
function normaliseButtonProfile(structured=null){
  const status=structured&&typeof structured==='object' ? structured : {};
  const rawButton=status.button&&typeof status.button==='object' ? status.button : {};
  const rawProfile=rawButton.profile || status.buttonProfile || null;
  const rawControl=rawButton.control || status.buttonControl || null;
  const gestures=Array.isArray(rawProfile?.gestures) ? rawProfile.gestures : [];
  const profiles=Array.isArray(rawControl?.profiles) ? rawControl.profiles : [];
  const configurable=rawControl?.configurable===true && rawControl?.reversible===true && rawControl?.command==='hw button --set --json' && profiles.length>0;
  return {
    reported:!!rawProfile,
    source:rawProfile?.source || (rawProfile?'firmware-reported':'unknown'),
    label:clean(rawProfile?.label || rawProfile?.name || ''),
    description:clean(rawProfile?.description || ''),
    gestures:gestures.map((gesture,index)=>({
      id:clean(gesture?.id || `gesture-${index + 1}`),
      label:clean(gesture?.label || gesture?.gesture || gesture?.id || `Gesture ${index + 1}`),
      effect:clean(gesture?.effect || gesture?.description || ''),
      durationMs:Number.isFinite(Number(gesture?.durationMs)) ? Number(gesture.durationMs) : null,
      risk:clean(gesture?.risk || 'firmware-defined')
    })),
    control:{
      available:configurable,
      configuredProfileId:clean(rawControl?.configuredProfileId || rawProfile?.id || ''),
      profiles:profiles.map((profile,index)=>({
        id:clean(profile?.id || `profile-${index + 1}`),
        label:clean(profile?.label || profile?.name || profile?.id || `Profile ${index + 1}`),
        description:clean(profile?.description || ''),
        risk:clean(profile?.risk || 'firmware-defined'),
        reversible:profile?.reversible!==false
      })),
      reason:clean(rawControl?.reason || (rawControl ? 'Firmware did not provide the complete safe button-control contract.' : 'This firmware does not report a configurable button profile.'))
    }
  };
}

function normaliseLedMapping(structured=null){
  const mapping=structured?.ledMapping?.logicalToSilkscreen;
  const source=structured?.mappingSource;
  if(!mapping || typeof mapping!=='object' || !source) return null;
  const normalised={};
  for(const logical of ['a','b','c','d']){
    const physical=String(mapping[logical]||'').toLowerCase();
    if(!/^[a-d]$/.test(physical)) return null;
    normalised[logical]=physical;
  }
  return {logicalToSilkscreen:normalised,source};
}

function normaliseBoardIdentity({structured=null,version={},usb={}}={}){
  const candidate=clean(structured?.board?.model || structured?.boardModel || version.model || usb.product || '');
  const lower=candidate.toLowerCase();
  let family='unknown';
  let confidence='unknown';
  if(structured?.ledOrderPm3Easy===true || /\b(pm3|proxmark3)\s*easy\b/i.test(candidate)){
    family='Proxmark3 Easy'; confidence='firmware-reported';
  }else if(/\brdv4\b|rdv\s*4/i.test(candidate)){
    family='Proxmark3 RDV4'; confidence='firmware-reported';
  }else if(lower.includes('generic')){
    family='PM3 GENERIC'; confidence='firmware-reported';
  }
  return {family,confidence,reportedModel:candidate||null,revision:structured?.board?.revision || version.mcuRevision ? (structured?.board?.revision || `MCU Rev ${version.mcuRevision} · PCB revision not reported`) : null};
}

function sourceBuildMatch({version={},sourceIdentity={}}={}){
  const installed=clean(version.firmware || version.bootrom || '');
  const local=clean(sourceIdentity.version || sourceIdentity.build || '');
  const installedTokens=installed.match(/v\d+\.\d+|\b[0-9a-f]{7,40}\b/ig) || [];
  const localTokens=local.match(/v\d+\.\d+|\b[0-9a-f]{7,40}\b/ig) || [];
  const overlap=installedTokens.find(token=>localTokens.some(localToken=>localToken.toLowerCase()===token.toLowerCase()));
  if(overlap) return {state:'candidate-match',label:'Candidate source match',detail:`Installed and local source both report ${overlap}. A reproducible build fingerprint is still required for an exact match.`,source:'inferred'};
  if(!installed) return {state:'unknown',label:'Installed firmware not identified',detail:'Connect the device and run diagnostics before comparing source.',source:'unknown'};
  if(!local) return {state:'unavailable',label:'Local source identity unavailable',detail:'The local Iceman source tree could not report a build identity.',source:'unknown'};
  return {state:'mismatch',label:'Source match not confirmed',detail:'The installed firmware and local source identity do not provide a matching version token.',source:'inferred'};
}

function buildActionDescriptors({capabilities=[],structured=null,connected=false}={}){
  const caps=new Set(normaliseCapabilityList(capabilities));
  const result=[ACTION_DESCRIPTORS.diagnostics];
  if(connected && (caps.has('hf') || caps.has('lf') || caps.has('diagnostics'))) result.push(ACTION_DESCRIPTORS['antenna-measurement']);
  if(caps.has('led-control') || structured?.leds) result.push(ACTION_DESCRIPTORS['led-control']);
  if(caps.has('button-status') || structured?.buttonPressed!==undefined || structured?.button?.pressed!==undefined) result.push(ACTION_DESCRIPTORS['button-information']);
  if(caps.has('self-test') || caps.has('basic-self-test') || structured?.selfTest) result.push(ACTION_DESCRIPTORS['self-test']);
  if(!caps.has('led-brightness')) result.push(ACTION_DESCRIPTORS['led-brightness-unavailable']);
  return result;
}

function buildDiagnosticRecipes({capabilities=[],connected=false}={}){
  const caps=new Set(normaliseCapabilityList(capabilities));
  const recipes=[
    {id:'connection-check',title:'Check the connection',available:true,simulation:true,steps:['Connect the Proxmark3 directly by USB.','Run diagnostics.','Confirm that connection, MCU and FPGA are reported.'],action:'diagnostics',safety:'Read-only.'},
    {id:'antenna-loading',title:'Compare antenna loading',available:connected&&(caps.has('hf')||caps.has('lf')||caps.has('diagnostics')),simulation:true,steps:['Keep tags and hands away.','Save an empty-antenna reference.','Start antenna measurement and place one tag at a time.','Stop before starting a card scan.'],action:'antenna-measurement',safety:'Read-only measurement; no RFID data is changed.'}
  ];
  if(caps.has('basic-self-test')||caps.has('self-test')) recipes.push({id:'basic-health',title:'Check basic board health',available:connected,simulation:true,steps:['Run the safe self-test.','Review USB, MCU and FPGA results.','Treat unavailable sensors as unavailable, not failed.'],action:'self-test',safety:'Firmware-reported, temporary diagnostic.'});
  return recipes;
}

function parseStructuredJsonOutput(output=''){
  const cleaned=String(output).replace(/\x1b\[[0-?]*[ -\/]*[@-~]/g,'');
  const lines=cleaned.split(/\r?\n/).map(line=>line.trim()).filter(Boolean).reverse();
  for(const line of lines){
    const start=line.indexOf('{');
    if(start<0) continue;
    try{
      const parsed=JSON.parse(line.slice(start));
      if(parsed?.schemaVersion || parsed?.capabilities || parsed?.status || parsed?.data?.capabilities) return parsed.data && typeof parsed.data==='object' ? {...parsed.data,schemaVersion:parsed.data.schemaVersion||parsed.schemaVersion||1} : parsed;
    }catch{}
  }
  return null;
}

function parseHardwareStatusJson(output=''){
  const parsed=parseStructuredJsonOutput(output);
  if(!parsed || typeof parsed!=='object') return null;
  return parsed.status && typeof parsed.status==='object' ? parsed.status : parsed;
}

function negotiateCapabilities({reported=[],inferred=[]}={}){
  const reportedList=normaliseCapabilityList(reported);
  const inferredList=normaliseCapabilityList(inferred);
  return {
    mode:reportedList.length?'firmware-reported':'legacy-inferred',
    protocolVersion:null,
    reported:reportedList,
    inferred:inferredList,
    effective:normaliseCapabilityList([...reportedList,...inferredList]),
    unknown:reportedList.filter(item=>!KNOWN_CAPABILITIES.has(item))
  };
}

function componentStates(model){
  const connected=!!model.connection.connected;
  const stamp=model.capturedAt;
  const status=model.hardwareStatus||{};
  const fpgaState=status.fpgaState;
  const buttonPressed=status.buttonPressed??status.button?.pressed;
  const buttonProfile=normaliseButtonProfile(status);
  const state=(status,telemetry={},detail='',source='unknown')=>({status,telemetry,detail,source,lastUpdated:stamp});
  return {
    'main-usb-port':state(connected?'connected':'disconnected',{port:model.connection.port},connected?'PM3 client detected the device.':'No PM3 device detected.','electron-observed'),
    'power-led':state(connected?'inferred-on':'unknown',{},connected?'Power is inferred from USB communication; LED state is not firmware-reported.':'Physical LED state is not available.','inferred'),
    'hf-antenna':state(model.hf.tune.measured?'measured':connected?'idle':'unknown',model.hf.tune,'Read-only hw tune telemetry.',model.hf.tune.measured?'firmware-reported':'unknown'),
    'lf-antenna-module':state(model.lf.tune.measured?'measured':connected?'idle':'unknown',model.lf.tune,'Read-only hw tune telemetry.',model.lf.tune.measured?'firmware-reported':'unknown'),
    'xilinx-spartan-fpga':state(fpgaState===1?'loaded':fpgaState===0?'not-loaded':model.device.fpga?'configured':'unknown',{version:model.device.fpga,fpgaState},fpgaState===1?'Firmware reports the FPGA is loaded.':fpgaState===0?'Firmware reports the FPGA is not loaded.':model.device.fpga?'Reported by hw version.':'Firmware did not expose a parseable FPGA value.',fpgaState===0||fpgaState===1?'firmware-reported':model.device.fpga?'firmware-reported':'unknown'),
    'atmel-mcu':state(status.runtime?.state||status.busyState||(connected?'alive':'unknown'),{type:model.device.mcu,runtime:model.runtime.state},model.runtime.source==='firmware-reported'?'Firmware reported the current MCU runtime state.':connected?'Alive is inferred from successful PM3 communication.':'No live MCU state is exposed.',model.runtime.source),
    'flash-memory':state(model.device.flashBytes?'reported':'unknown',{bytes:model.device.flashBytes},model.device.flashBytes?'Flash size reported by hw version.':'Flash usage is not exposed by the current commands.',model.device.flashBytes?'firmware-reported':'unknown'),
    'button':state(buttonPressed===true?'pressed':buttonPressed===false?'released':'unknown',{pressed:buttonPressed,profile:buttonProfile.label||null,configurable:buttonProfile.control.available},buttonPressed===undefined?'Button state requires firmware/client support.':buttonProfile.reported?`Firmware reports the physical button is ${buttonPressed?'pressed':'released'} and provides its current button profile.`:`Firmware reports the physical button is ${buttonPressed?'pressed':'released'}; its active function is not reported.`,buttonPressed===undefined?'unknown':'firmware-reported'),
    'led-a':state('unknown',{},'LED state and role require firmware/client support.'),
    'led-b':state('unknown',{},'LED state and role require firmware/client support.'),
    'led-c':state('unknown',{},'LED state and role require firmware/client support.'),
    'led-d':state('unknown',{},'LED state and role require firmware/client support.'),
    'power-section':state(connected?'powered':'unknown',{},'Power is inferred from communication; voltage and consumption are not exposed.')
  };
}

function buildSnapshot({preflight={},versionResult={},tuneResult={},statusResult={},sourceIdentity={},usbDescriptor={},capturedAt=new Date().toISOString()}={}){
  const detected=!!preflight.ok;
  const commandAttempted=versionResult.ok!==undefined || tuneResult.ok!==undefined;
  const connected=detected && (!commandAttempted || !!versionResult.ok || !!tuneResult.ok);
  const versionRaw=clean(`${versionResult.stdout||''}\n${versionResult.stderr||''}`);
  const tuneRaw=clean(`${tuneResult.stdout||''}\n${tuneResult.stderr||''}`);
  const version=parseVersionOutput(versionRaw);
  const tune=parseTuneOutput(tuneRaw);
  const structured=parseHardwareStatusJson(`${statusResult.stdout||''}\n${statusResult.stderr||''}`);
  const buttonProfile=normaliseButtonProfile(structured);
  const ledMapping=normaliseLedMapping(structured);
  const inferredCapabilities=[
    version.capabilities.hf&&'hf',
    version.capabilities.lf&&'lf',
    version.capabilities.fpga&&'fpga',
    version.capabilities.externalFlash&&'external-flash',
    connected&&'diagnostics'
  ].filter(Boolean);
  const board=normaliseBoardIdentity({structured,version,usb:usbDescriptor});
  const reportedCapabilities=[
    ...(Array.isArray(structured?.capabilities) ? structured.capabilities : Object.keys(structured?.capabilities||{}).filter(key=>structured.capabilities[key])),
    ...(structured?.contract==='device-studio-snapshot' ? ['device-studio-snapshot'] : []),
    ...(structured?.contract==='device-studio-status' ? ['device-studio-status'] : []),
    ...(structured?.deviceStudioSafeMode?.available===true ? ['device-studio-safe-mode'] : [])
  ];
  const capabilityNegotiation=negotiateCapabilities({reported:reportedCapabilities,inferred:inferredCapabilities});
  const model={
    schemaVersion:SCHEMA_VERSION,
    capturedAt,
    source:['device-studio-snapshot','device-studio-status'].includes(structured?.contract) ? 'firmware-device-studio-contract' : 'iceman-cli-text',
    connection:{detected,connected,status:detected&&!connected?'communication-failed':preflight.status||'unknown',port:preflight.port||null,ports:preflight.ports||[],binary:preflight.binary||null,message:detected&&!connected?'Device port was detected, but read-only PM3 communication failed.':preflight.message||null},
    runtime:{state:structured?.runtime?.state || structured?.busyState || (connected?'idle':'disconnected'),currentCommand:structured?.runtime?.currentCommand || null,operatingMode:'diagnostic-read-only',communicationSpeed:structured?.usb?.speed || usbDescriptor.speed || null,source:structured?.runtime?.state||structured?.busyState?'firmware-reported':connected?'inferred':'unknown'},
    device:{model:board.family!=='unknown'?board.family:board.reportedModel,modelConfidence:board.confidence,firmware:version.firmware,firmwareFamily:version.firmwareFamily,client:version.client,bootrom:version.bootrom,fpga:version.fpga,mcu:version.mcu,serialNumber:structured?.board?.serialNumber||usbDescriptor.serialNumber||version.serialNumber||null,usbDescriptor:usbDescriptor&&Object.keys(usbDescriptor).length?usbDescriptor:null,flashBytes:version.flashBytes,flashUsedPercent:version.flashUsedPercent,boardRevision:board.revision,buildDate:structured?.firmware?.buildDate||version.buildDate||null,ledMapping,sourceBuildMatch:sourceBuildMatch({version,sourceIdentity})},
    capabilities:{...version.capabilities,structuredFirmwareApi:!!structured,ledState:!!structured?.leds,buttonState:structured?.buttonPressed!==undefined||structured?.button?.pressed!==undefined,buttonProfile:buttonProfile.reported,buttonControl:buttonProfile.control.available,temperature:structured?.temperature!==undefined,powerTelemetry:!!structured?.power,multipleDevices:(preflight.ports||[]).length>1,reported:reportedCapabilities},
    capabilityNegotiation,
    hf:{tune:{measured:tune.hf.voltage!==null||tune.hf.frequencyMHz!==null,voltage:tune.hf.voltage,frequencyMHz:tune.hf.frequencyMHz}},
    lf:{tune:{measured:tune.lf.voltage!==null||tune.lf.frequencyKHz!==null,voltage:tune.lf.voltage,frequencyKHz:tune.lf.frequencyKHz,peakKHz:tune.lf.peakKHz}},
    diagnostics:{version:{ok:!!versionResult.ok,command:'hw version'},tune:{ok:!!tuneResult.ok,command:'hw tune'},status:{ok:!!structured,command:structured?.contract==='device-studio-status'?'hw ds-status --json':structured?.contract==='device-studio-snapshot'?'hw ds-snapshot --json':'hw status --json',binary:preflight.binary||null,error:statusResult.error||null,format:['device-studio-snapshot','device-studio-status'].includes(structured?.contract)?'device-studio-contract-json':structured?'structured-json':'legacy-text',raw:clean(`${statusResult.stdout||''}\n${statusResult.stderr||''}`).slice(-4000)},limitations:[]},
    hardwareStatus:structured||null,
    deviceStudioSafeMode:structured?.deviceStudioSafeMode || {available:false,enabled:false},
    buttonProfile,
    actionDescriptors:buildActionDescriptors({capabilities:capabilityNegotiation.effective,structured,connected}),
    diagnosticRecipes:buildDiagnosticRecipes({capabilities:capabilityNegotiation.effective,connected})
  };
  model.capabilityAdapters=buildCapabilityAdapterRegistry(model.capabilityNegotiation.effective);
  if(!detected) model.diagnostics.limitations.push('No Proxmark3 serial port was detected.');
  if(detected&&!connected) model.diagnostics.limitations.push('A serial port was detected, but the PM3 client could not communicate with it.');
  if(detected&&!versionResult.ok) model.diagnostics.limitations.push('hw version did not complete successfully.');
  if(detected&&!tuneResult.ok) model.diagnostics.limitations.push('hw tune did not complete successfully.');
  model.components=componentStates(model);
  return model;
}

module.exports={SCHEMA_VERSION,KNOWN_CAPABILITIES,CAPABILITY_ADAPTERS,ACTION_DESCRIPTORS,buildCapabilityAdapterRegistry,normaliseCapabilityList,normaliseButtonProfile,normaliseBoardIdentity,sourceBuildMatch,buildActionDescriptors,buildDiagnosticRecipes,negotiateCapabilities,parseStructuredJsonOutput,parseHardwareStatusJson,parseVersionOutput,parseTuneOutput,buildSnapshot};
