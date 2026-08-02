/*
 * Connection Compatibility Engine contract.
 *
 * Pure data model only: no PM3 process, USB, IPC or renderer access.
 */
'use strict';

const SCHEMA_VERSION='1.0';

const PRIMARY_STATES=Object.freeze([
  'NO_CLIENT',
  'CLIENT_LAUNCH_FAILED',
  'NO_PM3_DETECTED',
  'MULTIPLE_PM3_DEVICES',
  'PM3_DETECTED',
  'PM3_CONNECTED',
  'BUSY_DEVICE',
  'ELECTRON_BUSY',
  'CONNECTION_FAILED',
  'FIRMWARE_COMMUNICATION_FAILED',
  'STOCK_FIRMWARE',
  'DEVICE_STUDIO_FIRMWARE',
  'LIMITED_CAPABILITY',
  'FULL_CAPABILITY',
  'UNSUPPORTED_FIRMWARE',
  'UNKNOWN_STATE',
  'DISCONNECTED'
]);

const CAPABILITY_STATUSES=Object.freeze([
  'supported',
  'unsupported',
  'unknown',
  'blocked',
  'error'
]);

const CAPABILITY_IDS=Object.freeze([
  'clientLaunch',
  'serialEnumeration',
  'firmwareHandshake',
  'persistentSession',
  'structuredHardwareStatus',
  'ledStatus',
  'safeMode',
  'snapshot',
  'boardMapping',
  'textualHwTune',
  'nativeGraphs',
  'hfScan',
  'lfScan',
  'scopeSnapshot',
  'buttonStatus',
  'buttonProfile',
  'selfTest',
  'deviceStudioStatus',
  'deviceStudioSafeMode'
]);

const EVIDENCE_SOURCES=Object.freeze([
  'direct-probe',
  'firmware-reported',
  'electron-observed',
  'inferred',
  'unknown'
]);

const TRIGGERS=Object.freeze([
  'startup',
  'manual',
  'reconnect',
  'background',
  'post-disconnect'
]);

const PROBE_DEPTHS=Object.freeze([
  'presence',
  'handshake',
  'capabilities',
  'full-diagnostics'
]);

const STATE_DEFINITIONS=Object.freeze({
  NO_CLIENT:Object.freeze({
    title:'PM3 client not available',
    explanation:'Electron cannot start the local PM3 helper yet.',
    recommendedAction:Object.freeze({id:'open-client-setup',label:'Open PM3 client setup'}),
    scanPolicy:'no'
  }),
  CLIENT_LAUNCH_FAILED:Object.freeze({
    title:'PM3 client could not start',
    explanation:'The helper was found, but the operating system or client stopped it from starting.',
    recommendedAction:Object.freeze({id:'review-client-launch',label:'Review client launch details'}),
    scanPolicy:'no'
  }),
  NO_PM3_DETECTED:Object.freeze({
    title:'No Proxmark3 detected',
    explanation:'Electron is ready, but it cannot currently see a connected Proxmark3.',
    recommendedAction:Object.freeze({id:'retry-device-discovery',label:'Check USB and try again'}),
    scanPolicy:'no'
  }),
  MULTIPLE_PM3_DEVICES:Object.freeze({
    title:'Choose a Proxmark3',
    explanation:'More than one device is available, so Electron will not guess.',
    recommendedAction:Object.freeze({id:'select-device',label:'Select a Proxmark3'}),
    scanPolicy:'no'
  }),
  PM3_DETECTED:Object.freeze({
    title:'Proxmark3 detected',
    explanation:'The client can see the device. Firmware communication is still being checked.',
    recommendedAction:Object.freeze({id:'check-firmware-handshake',label:'Check firmware communication'}),
    scanPolicy:'no'
  }),
  PM3_CONNECTED:Object.freeze({
    title:'Proxmark3 connected',
    explanation:'Electron completed a lightweight firmware handshake. Compatibility details are still being classified.',
    recommendedAction:Object.freeze({id:'review-connection-capabilities',label:'Review connection capabilities'}),
    scanPolicy:'conditional'
  }),
  BUSY_DEVICE:Object.freeze({
    title:'Proxmark3 is busy',
    explanation:'The device is present, but another application owns its serial port.',
    recommendedAction:Object.freeze({id:'release-external-owner',label:'Release the device and retry'}),
    scanPolicy:'no'
  }),
  ELECTRON_BUSY:Object.freeze({
    title:'Electron is using the Proxmark3',
    explanation:'Another Electron operation currently owns the shared PM3 session.',
    recommendedAction:Object.freeze({id:'wait-for-active-operation',label:'Wait for the current Electron operation'}),
    scanPolicy:'no'
  }),
  CONNECTION_FAILED:Object.freeze({
    title:'Could not open the Proxmark3 connection',
    explanation:'Electron found a candidate but could not establish the serial connection.',
    recommendedAction:Object.freeze({id:'retry-connection',label:'Check the connection and retry'}),
    scanPolicy:'no'
  }),
  FIRMWARE_COMMUNICATION_FAILED:Object.freeze({
    title:'Proxmark3 found, firmware not responding',
    explanation:'USB discovery succeeded, but firmware communication did not complete.',
    recommendedAction:Object.freeze({id:'retry-firmware-handshake',label:'Retry firmware communication'}),
    scanPolicy:'no'
  }),
  STOCK_FIRMWARE:Object.freeze({
    title:'Standard-compatible firmware detected',
    explanation:'Core PM3 workflows may remain available; Device Studio-only features are unavailable.',
    recommendedAction:Object.freeze({id:'continue-supported-workflows',label:'Continue with supported functions'}),
    scanPolicy:'conditional'
  }),
  DEVICE_STUDIO_FIRMWARE:Object.freeze({
    title:'Device Studio firmware detected',
    explanation:'Electron received structured Device Studio capability evidence.',
    recommendedAction:Object.freeze({id:'continue-device-studio',label:'Continue with available functions'}),
    scanPolicy:'conditional'
  }),
  LIMITED_CAPABILITY:Object.freeze({
    title:'Connected with limited capabilities',
    explanation:'The device works, but not every Electron function has been demonstrated.',
    recommendedAction:Object.freeze({id:'review-capabilities',label:'Review available functions'}),
    scanPolicy:'conditional'
  }),
  FULL_CAPABILITY:Object.freeze({
    title:'Connected — full capability available',
    explanation:'Every capability required for the current workflow has been demonstrated.',
    recommendedAction:Object.freeze({id:'continue-workflow',label:'Continue'}),
    scanPolicy:'conditional'
  }),
  UNSUPPORTED_FIRMWARE:Object.freeze({
    title:'Firmware is not compatible with this workflow',
    explanation:'Electron can communicate, but cannot confirm the minimum capability required here.',
    recommendedAction:Object.freeze({id:'review-compatibility',label:'Review compatibility details'}),
    scanPolicy:'conditional'
  }),
  UNKNOWN_STATE:Object.freeze({
    title:'Connection state not confirmed',
    explanation:'Electron does not have enough reliable evidence to describe this setup.',
    recommendedAction:Object.freeze({id:'retry-smallest-stage',label:'Retry the incomplete check'}),
    scanPolicy:'conditional'
  }),
  DISCONNECTED:Object.freeze({
    title:'Proxmark3 disconnected',
    explanation:'The previous connection ended and Electron stopped hardware actions.',
    recommendedAction:Object.freeze({id:'reconnect-device',label:'Reconnect the Proxmark3'}),
    scanPolicy:'no'
  })
});

function text(value,maximum=500){
  return String(value??'').trim().slice(0,maximum);
}

function oneOf(value,allowed,fallback){
  return allowed.includes(value)?value:fallback;
}

function cleanStringList(values,maximum=20){
  return [...new Set((Array.isArray(values)?values:[]).map(value=>text(value,160)).filter(Boolean))].slice(0,maximum);
}

function safeCapabilityId(value){
  const id=text(value,80);
  if(!/^[A-Za-z][A-Za-z0-9-]{0,79}$/.test(id)) return '';
  return ['constructor','prototype','__proto__'].includes(id)?'':id;
}

function capabilityResult(id,input={}){
  const status=oneOf(input.status,CAPABILITY_STATUSES,'unknown');
  const source=oneOf(input.source,EVIDENCE_SOURCES,'unknown');
  return {
    id:safeCapabilityId(id),
    status,
    source,
    probe:text(input.probe,120),
    parserVersion:text(input.parserVersion,40),
    evidence:text(input.evidence,500),
    reason:text(input.reason,500),
    lastProbedAt:text(input.lastProbedAt,80) || null
  };
}

function deviceCandidate(input={}){
  return {
    id:text(input.id,120),
    port:text(input.port,240),
    product:text(input.product,160),
    serialNumber:text(input.serialNumber,160),
    vendorId:text(input.vendorId,40),
    productId:text(input.productId,40),
    source:oneOf(input.source,EVIDENCE_SOURCES,'unknown')
  };
}

function failureResult(input={}){
  return {
    code:text(input.code,100) || 'unknown-failure',
    stage:text(input.stage,100) || 'unknown',
    message:text(input.message,500) || 'No failure explanation was reported.',
    recoverable:input.recoverable===true,
    source:oneOf(input.source,EVIDENCE_SOURCES,'unknown')
  };
}

function versionResult(input={}){
  return {
    value:text(input.value,240) || null,
    source:oneOf(input.source,EVIDENCE_SOURCES,'unknown')
  };
}

function stateDefinition(primaryState){
  return STATE_DEFINITIONS[primaryState] || STATE_DEFINITIONS.UNKNOWN_STATE;
}

function createConnectionSnapshot(input={}){
  const primaryState=oneOf(input.primaryState,PRIMARY_STATES,'UNKNOWN_STATE');
  const definition=stateDefinition(primaryState);
  const suppliedCapabilities=input.capabilities&&typeof input.capabilities==='object' ? input.capabilities : {};
  const capabilityKeys=[...new Set([...CAPABILITY_IDS,...Object.keys(suppliedCapabilities).map(safeCapabilityId).filter(Boolean)])];
  const capabilities={};
  for(const id of capabilityKeys) capabilities[id]=capabilityResult(id,suppliedCapabilities[id]);
  const requiredCapabilities=[...new Set((Array.isArray(input.scope?.requiredCapabilities)?input.scope.requiredCapabilities:[]).map(safeCapabilityId).filter(Boolean))].slice(0,20);
  const hfSupported=capabilities.hfScan.status==='supported';
  const lfSupported=capabilities.lfScan.status==='supported';
  const defaultAction=definition.recommendedAction;
  const action=input.recommendedAction&&typeof input.recommendedAction==='object' ? input.recommendedAction : {};
  return {
    schemaVersion:SCHEMA_VERSION,
    capturedAt:text(input.capturedAt,80) || null,
    trigger:oneOf(input.trigger,TRIGGERS,'manual'),
    probeDepth:oneOf(input.probeDepth,PROBE_DEPTHS,'presence'),
    primaryState,
    state:{
      title:definition.title,
      explanation:definition.explanation,
      scanPolicy:definition.scanPolicy
    },
    scope:{
      workflow:text(input.scope?.workflow,120),
      requiredCapabilities
    },
    client:{
      status:text(input.client?.status,80) || 'unknown',
      pathSource:text(input.client?.pathSource,80) || 'unknown',
      version:versionResult(input.client?.version),
      source:oneOf(input.client?.source,EVIDENCE_SOURCES,'unknown')
    },
    usb:{
      status:text(input.usb?.status,80) || 'unknown',
      devices:(Array.isArray(input.usb?.devices)?input.usb.devices:[]).slice(0,16).map(deviceCandidate),
      source:oneOf(input.usb?.source,EVIDENCE_SOURCES,'unknown')
    },
    connection:{
      status:text(input.connection?.status,80) || 'unknown',
      port:text(input.connection?.port,240) || null,
      ports:cleanStringList(input.connection?.ports,16),
      owner:text(input.connection?.owner,120) || 'unknown',
      ownerType:oneOf(input.connection?.ownerType,['electron','external','free','unknown'],'unknown'),
      operationActive:input.connection?.operationActive===true,
      source:oneOf(input.connection?.source,EVIDENCE_SOURCES,'unknown')
    },
    versions:{
      client:versionResult(input.versions?.client),
      firmware:versionResult(input.versions?.firmware),
      bootrom:versionResult(input.versions?.bootrom),
      fpga:versionResult(input.versions?.fpga)
    },
    firmware:{
      classification:oneOf(input.firmware?.classification,['device-studio','standard-compatible','unsupported','unknown'],'unknown'),
      source:oneOf(input.firmware?.source,EVIDENCE_SOURCES,'unknown'),
      evidence:text(input.firmware?.evidence,500)
    },
    capabilities,
    scanContinuation:{
      hf:hfSupported,
      lf:lfSupported,
      any:hfSupported||lfSupported,
      policy:definition.scanPolicy
    },
    recommendedAction:{
      id:text(action.id,100) || defaultAction.id,
      label:text(action.label,200) || defaultAction.label
    },
    failures:(Array.isArray(input.failures)?input.failures:[]).slice(0,20).map(failureResult)
  };
}

function disallowedRawFields(value,path='snapshot',errors=[]){
  if(!value||typeof value!=='object') return errors;
  for(const [key,item] of Object.entries(value)){
    const itemPath=`${path}.${key}`;
    if(['raw','stdout','stderr'].includes(key)) errors.push(`${itemPath} is not allowed in the renderer-facing connection contract.`);
    else disallowedRawFields(item,itemPath,errors);
  }
  return errors;
}

function validateConnectionSnapshot(snapshot){
  const errors=[];
  if(!snapshot||typeof snapshot!=='object') return {ok:false,errors:['Snapshot must be an object.']};
  if(snapshot.schemaVersion!==SCHEMA_VERSION) errors.push(`schemaVersion must be ${SCHEMA_VERSION}.`);
  if(!PRIMARY_STATES.includes(snapshot.primaryState)) errors.push('primaryState is not recognised.');
  if(!TRIGGERS.includes(snapshot.trigger)) errors.push('trigger is not recognised.');
  if(!PROBE_DEPTHS.includes(snapshot.probeDepth)) errors.push('probeDepth is not recognised.');
  for(const [id,result] of Object.entries(snapshot.capabilities||{})){
    if(!CAPABILITY_STATUSES.includes(result?.status)) errors.push(`Capability ${id} has an invalid status.`);
    if(!EVIDENCE_SOURCES.includes(result?.source)) errors.push(`Capability ${id} has an invalid evidence source.`);
  }
  if(snapshot.primaryState==='MULTIPLE_PM3_DEVICES'&&(snapshot.usb?.devices||[]).length<2) errors.push('MULTIPLE_PM3_DEVICES requires at least two device candidates.');
  if(snapshot.primaryState==='STOCK_FIRMWARE'&&snapshot.firmware?.classification!=='standard-compatible') errors.push('STOCK_FIRMWARE requires standard-compatible firmware evidence.');
  if(snapshot.primaryState==='DEVICE_STUDIO_FIRMWARE'&&snapshot.firmware?.classification!=='device-studio') errors.push('DEVICE_STUDIO_FIRMWARE requires a recognised Device Studio contract.');
  if(snapshot.primaryState==='FULL_CAPABILITY'){
    for(const id of snapshot.scope?.requiredCapabilities||[]){
      if(snapshot.capabilities?.[id]?.status!=='supported') errors.push(`FULL_CAPABILITY requires supported capability ${id}.`);
    }
  }
  disallowedRawFields(snapshot,'snapshot',errors);
  return {ok:errors.length===0,errors};
}

module.exports={
  SCHEMA_VERSION,
  PRIMARY_STATES,
  CAPABILITY_STATUSES,
  CAPABILITY_IDS,
  EVIDENCE_SOURCES,
  TRIGGERS,
  PROBE_DEPTHS,
  STATE_DEFINITIONS,
  capabilityResult,
  createConnectionSnapshot,
  stateDefinition,
  validateConnectionSnapshot
};
