/*
 * Connection Compatibility Engine state reducer.
 *
 * Pure composition only. It consumes structured stage evidence and returns the
 * versioned renderer-facing contract without running probes or changing state.
 */
'use strict';

const {
  createConnectionSnapshot,
  validateConnectionSnapshot
}=require('./connectionCompatibilityContract');

const STAGE_ORDER=Object.freeze([
  'helper',
  'client',
  'usb',
  'port',
  'handshake'
]);

function stage(value){
  return value&&typeof value==='object'?value:{stage:'unknown',status:'unknown',ok:false,source:'unknown',evidence:{},failure:null};
}

function capabilityStatus(capabilities,id){
  return capabilities?.[id]?.status||'unknown';
}

function requiredCapabilityState(scope={},capabilities={}){
  const required=Array.isArray(scope.requiredCapabilities)?scope.requiredCapabilities.filter(Boolean):[];
  if(!required.length) return 'not-scoped';
  return required.every(id=>capabilityStatus(capabilities,id)==='supported')?'full':'limited';
}

function hasContradictoryEvidence(input={}){
  const stages=input.stages||{};
  const usb=stage(stages.usb);
  const port=stage(stages.port);
  const handshake=stage(stages.handshake);
  const usbDevices=Array.isArray(usb.evidence?.devices)?usb.evidence.devices:[];
  const portList=Array.isArray(port.evidence?.ports)?port.evidence.ports:[];
  const connectionStatus=String(input.connection?.status||'');
  const connected=['supported','connected','ready'].includes(handshake.status)||connectionStatus==='connected';
  const portPresent=['available','electron-owned'].includes(port.status)||Boolean(port.evidence?.selectedPort);
  const noDevice=usb.status==='no-device'||port.status==='no-device';
  const multiple=usb.status==='multiple-devices'||port.status==='selection-required';

  if(usb.status==='multiple-devices'&&usbDevices.length<2) return true;
  if(port.status==='selection-required'&&Math.max(portList.length,usbDevices.length)<2) return true;
  if(noDevice&&(multiple||portPresent||connected)) return true;
  if(port.status==='external-busy'&&(usb.status==='no-device'||connected)) return true;
  if(connected&&['failed','permission-denied','disappeared','blocked-by-client'].includes(port.status)) return true;
  return false;
}

function derivePrimaryState(input={}){
  const stages=input.stages||{};
  const helper=stage(stages.helper);
  const client=stage(stages.client);
  const usb=stage(stages.usb);
  const port=stage(stages.port);
  const handshake=stage(stages.handshake);
  const firmware=input.firmware||{};
  const connectionStatus=String(input.connection?.status||'');
  const electronOperationActive=input.connection?.ownerType==='electron'&&input.connection?.operationActive===true;
  const selectedPort=String(input.selection?.port||'');
  const explicitSelection=input.selection?.explicit===true&&selectedPort&&(
    (Array.isArray(usb.evidence?.devices)?usb.evidence.devices:[]).some(device=>device?.port===selectedPort)||
    (Array.isArray(port.evidence?.ports)?port.evidence.ports:[]).includes(selectedPort)
  );

  if(input.trigger==='post-disconnect'||connectionStatus==='disconnected') return 'DISCONNECTED';

  if(helper.status==='cancelled'||client.status==='cancelled') return 'UNKNOWN_STATE';
  if(!helper.ok&&!['unknown','not-attempted'].includes(helper.status)) return 'NO_CLIENT';
  if(['failed','timeout','permission-denied','crashed'].includes(client.status)) return 'CLIENT_LAUNCH_FAILED';

  if(hasContradictoryEvidence(input)) return 'UNKNOWN_STATE';

  if(electronOperationActive) return 'ELECTRON_BUSY';
  if(usb.status==='no-device'||port.status==='no-device') return 'NO_PM3_DETECTED';
  if((usb.status==='multiple-devices'||port.status==='selection-required')&&!explicitSelection) return 'MULTIPLE_PM3_DEVICES';
  if(port.status==='external-busy') return 'BUSY_DEVICE';
  if(port.status==='blocked-by-client') return 'NO_CLIENT';
  if(['failed','permission-denied','disappeared'].includes(port.status)) return 'CONNECTION_FAILED';

  const devicePresent=['single-device','multiple-devices','usb-only-candidate'].includes(usb.status)||!!port.evidence?.selectedPort;
  if(['failed','timeout','no-response','protocol-mismatch','disconnected'].includes(handshake.status)){
    return devicePresent?'FIRMWARE_COMMUNICATION_FAILED':'CONNECTION_FAILED';
  }

  const connected=['supported','connected','ready'].includes(handshake.status)||connectionStatus==='connected';
  if(!connected){
    if(devicePresent) return 'PM3_DETECTED';
    return 'UNKNOWN_STATE';
  }

  if(firmware.classification==='unsupported') return 'UNSUPPORTED_FIRMWARE';

  const scoped=requiredCapabilityState(input.scope,input.capabilities);
  if(scoped==='full') return 'FULL_CAPABILITY';
  if(scoped==='limited') return 'LIMITED_CAPABILITY';

  if(firmware.classification==='device-studio') return 'DEVICE_STUDIO_FIRMWARE';
  if(firmware.classification==='standard-compatible') return 'STOCK_FIRMWARE';

  if(handshake.status==='supported') return 'PM3_CONNECTED';
  return 'UNKNOWN_STATE';
}

function failureFromStage(result){
  const value=stage(result);
  if(!value.failure) return null;
  return {
    code:value.failure.code||'unknown-failure',
    stage:value.stage||'unknown',
    message:value.failure.message||'No failure explanation was reported.',
    recoverable:value.failure.recoverable===true,
    source:value.source||'electron-observed'
  };
}

function reduceConnectionSnapshot(input={}){
  const stages=input.stages||{};
  const helper=stage(stages.helper);
  const client=stage(stages.client);
  const usb=stage(stages.usb);
  const port=stage(stages.port);
  const handshake=stage(stages.handshake);
  const primaryState=derivePrimaryState(input);
  const orderedStageKeys=[
    ...STAGE_ORDER.filter(key=>Object.prototype.hasOwnProperty.call(stages,key)),
    ...Object.keys(stages).filter(key=>!STAGE_ORDER.includes(key)).sort()
  ];
  const failures=orderedStageKeys.map(key=>failureFromStage(stages[key])).filter(Boolean);
  const devices=Array.isArray(usb.evidence?.devices)?usb.evidence.devices:[];
  const ports=Array.isArray(port.evidence?.ports)?port.evidence.ports:devices.map(device=>device.port).filter(Boolean);
  const handshakeConnected=['supported','connected','ready'].includes(handshake.status);
  const connectionStatus=input.connection?.status||(
    primaryState==='DISCONNECTED'?'disconnected':
    handshakeConnected||['PM3_CONNECTED','ELECTRON_BUSY','FULL_CAPABILITY','LIMITED_CAPABILITY','STOCK_FIRMWARE','DEVICE_STUDIO_FIRMWARE','UNSUPPORTED_FIRMWARE'].includes(primaryState)?'connected':
    port.status==='external-busy'?'busy':
    port.ok?'available':
    'unknown'
  );
  const snapshot=createConnectionSnapshot({
    capturedAt:input.capturedAt,
    trigger:input.trigger,
    probeDepth:input.probeDepth,
    primaryState,
    scope:input.scope,
    client:{
      status:client.status==='unknown'?helper.status:client.status,
      pathSource:helper.evidence?.pathSource,
      version:input.versions?.client,
      source:client.source||helper.source
    },
    usb:{
      status:usb.status,
      devices,
      source:usb.source
    },
    connection:{
      status:connectionStatus,
      port:input.connection?.port||port.evidence?.selectedPort,
      ports,
      owner:input.connection?.owner||port.evidence?.owner,
      ownerType:input.connection?.ownerType,
      operationActive:input.connection?.operationActive,
      source:input.connection?.source||port.source
    },
    versions:input.versions,
    firmware:input.firmware,
    capabilities:input.capabilities,
    recommendedAction:input.recommendedAction,
    failures
  });
  const validation=validateConnectionSnapshot(snapshot);
  if(!validation.ok){
    const error=new Error(`Connection snapshot contract violation: ${validation.errors.join(' | ')}`);
    error.validationErrors=validation.errors;
    throw error;
  }
  return snapshot;
}

module.exports={
  derivePrimaryState,
  hasContradictoryEvidence,
  reduceConnectionSnapshot,
  requiredCapabilityState
};
