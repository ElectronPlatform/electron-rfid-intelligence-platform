/*
 * Connection Compatibility Engine evidence adapters.
 *
 * Converts existing transport result shapes into structured stage evidence.
 * Pure mapping only: this module never launches a client or touches USB.
 */
'use strict';

const path=require('path');

function text(value,maximum=500){
  return String(value??'').trim().slice(0,maximum);
}

function uniqueStrings(values,maximum=16){
  return [...new Set((Array.isArray(values)?values:[]).map(value=>text(value,240)).filter(Boolean))].slice(0,maximum);
}

function stageResult(stage,status,overrides={}){
  return {
    stage,
    status,
    ok:overrides.ok===true,
    source:overrides.source||'electron-observed',
    evidence:overrides.evidence||{},
    failure:overrides.failure||null
  };
}

function failure(code,message,recoverable=true){
  return {
    code:text(code,100)||'unknown-failure',
    message:text(message,500)||'No failure explanation was reported.',
    recoverable:recoverable===true
  };
}

function adaptExecutableResolution(resolution={}){
  const status=text(resolution.status,80)||'unknown';
  const candidate=text(resolution.path,500);
  const evidence={
    pathSource:text(resolution.source,80)||'unknown',
    explicit:resolution.explicit===true,
    executableName:candidate?path.basename(candidate):''
  };
  if(resolution.ok===true){
    const readyStatus=status==='path-fallback'?'path-unverified':'ready';
    return stageResult('helper-discovery',readyStatus,{ok:true,evidence});
  }
  const code={
    empty:'client-path-empty',
    'not-found':'client-not-found',
    'not-file':'client-path-not-file',
    'not-executable':'client-not-executable',
    unavailable:'client-unavailable'
  }[status]||'client-resolution-failed';
  const message={
    empty:'No PM3 executable is configured.',
    'not-found':'The configured PM3 executable was not found.',
    'not-file':'The configured PM3 executable is not a file.',
    'not-executable':'The configured PM3 executable cannot be launched.',
    unavailable:'The configured PM3 executable is unavailable.'
  }[status]||'Electron could not resolve the PM3 executable.';
  return stageResult('helper-discovery',status,{
    evidence,
    failure:failure(code,message)
  });
}

function adaptClientListResult(result={}){
  const ports=uniqueStrings(result.ports);
  const error=text(result.error,500);
  const evidence={
    executableName:result.binary?path.basename(text(result.binary,500)):'',
    portCount:ports.length
  };
  if(error&&ports.length===0){
    const timeout=/timed?\s*out|timeout/i.test(error);
    return stageResult('client-launch',timeout?'timeout':'failed',{
      evidence,
      failure:failure(
        timeout?'client-launch-timeout':'client-launch-failed',
        timeout?'PM3 client discovery timed out.':'The PM3 client discovery check did not complete.'
      )
    });
  }
  return stageResult('client-launch','ready',{ok:true,evidence});
}

function descriptorCandidate(descriptor={},index=0){
  const port=text(descriptor.port,240);
  const serialNumber=text(descriptor.serialNumber,160);
  const product=text(descriptor.product,160);
  return {
    id:text(descriptor.id,120)||serialNumber||port||`pm3-candidate-${index+1}`,
    port,
    product,
    serialNumber,
    vendorId:text(descriptor.vendorId,40),
    productId:text(descriptor.productId,40),
    source:'electron-observed'
  };
}

function adaptUsbDiscovery({listResult={},descriptors=[]}={}){
  const ports=uniqueStrings(listResult.ports);
  const descriptorList=Array.isArray(descriptors)?descriptors:(descriptors&&Object.keys(descriptors).length?[descriptors]:[]);
  const byPort=new Map(descriptorList.map((descriptor,index)=>[text(descriptor.port,240),descriptorCandidate(descriptor,index)]).filter(([port])=>port));
  const unassigned=descriptorList.map(descriptorCandidate).filter(candidate=>!candidate.port);
  const devices=ports.map((port,index)=>{
    const direct=byPort.get(port);
    const descriptor=direct||(ports.length===1?unassigned[0]:null);
    return {
      id:descriptor?.id||port,
      port,
      product:descriptor?.product||'',
      serialNumber:descriptor?.serialNumber||'',
      vendorId:descriptor?.vendorId||'',
      productId:descriptor?.productId||'',
      source:'electron-observed'
    };
  });
  for(const candidate of descriptorList.map(descriptorCandidate)){
    if(!candidate.port&&!ports.length) devices.push(candidate);
    else if(candidate.port&&!devices.some(device=>device.port===candidate.port)) devices.push(candidate);
  }
  const status=devices.length>1?'multiple-devices':devices.length===1?'single-device':descriptorList.length?'usb-only-candidate':'no-device';
  return stageResult('usb-discovery',status,{
    ok:devices.length===1,
    evidence:{
      devices:devices.slice(0,16),
      clientVisiblePortCount:ports.length,
      descriptorCount:descriptorList.length
    }
  });
}

function safeOwners(users=[]){
  return (Array.isArray(users)?users:[]).slice(0,16).map(user=>({
    command:text(user.command,120),
    port:text(user.port,240)
  }));
}

function adaptPortPreflight(preflight={}){
  const ports=uniqueStrings(preflight.ports);
  const selectedPort=text(preflight.port,240);
  const evidence={
    selectedPort,
    ports,
    explicitSelection:preflight.explicitSelection===true,
    owner:text(preflight.owner,120)||'unknown',
    owners:safeOwners(preflight.users)
  };
  if(ports.length>1&&preflight.explicitSelection!==true){
    return stageResult('port-ownership','selection-required',{evidence});
  }
  if(preflight.ok===true){
    const electronOwned=/device-studio|electron|pm3-session/i.test(evidence.owner);
    return stageResult('port-ownership',electronOwned?'electron-owned':'available',{ok:true,evidence});
  }
  const status=text(preflight.status,80)||'unknown';
  if(status==='busy'){
    return stageResult('port-ownership','external-busy',{
      evidence,
      failure:failure('port-busy','The PM3 serial port is owned by another process.')
    });
  }
  if(status==='no-device'){
    return stageResult('port-ownership','no-device',{
      evidence,
      failure:failure('device-not-found','No usable PM3 serial port is currently available.')
    });
  }
  if(status==='invalid-client'){
    return stageResult('port-ownership','blocked-by-client',{
      evidence,
      failure:failure('invalid-client','Port inspection is blocked because the PM3 client is unavailable.')
    });
  }
  return stageResult('port-ownership','failed',{
    evidence,
    failure:failure('port-preflight-failed','Electron could not inspect PM3 serial-port ownership.')
  });
}

module.exports={
  stageResult,
  adaptExecutableResolution,
  adaptClientListResult,
  adaptUsbDiscovery,
  adaptPortPreflight
};
