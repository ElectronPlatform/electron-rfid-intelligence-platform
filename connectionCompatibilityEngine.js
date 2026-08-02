/*
 * Connection Compatibility Engine lightweight orchestration.
 *
 * Main-process service boundary only. Runtime dependencies are injected so the
 * app can reuse its existing PM3 transport and serial owner. This module never
 * launches a process itself, parses PM3 text, uses IPC, stores files or runs RF
 * diagnostics.
 */
'use strict';

const {
  stageResult,
  adaptExecutableResolution,
  adaptClientListResult,
  adaptUsbDiscovery,
  adaptPortPreflight
}=require('./connectionCompatibilityEvidenceAdapter');
const {reduceConnectionSnapshot}=require('./connectionCompatibilityStateReducer');

const ALLOWED_DEPTHS=Object.freeze(['presence','handshake']);
const ALLOWED_OPERATIONS=Object.freeze([
  'resolve_client',
  'inspect_usb_descriptors',
  'list_devices',
  'inspect_port_owner',
  'inspect_session_state',
  'reuse_existing_session',
  'read_version_metadata',
  'cleanup'
]);
const DEFAULT_STAGE_TIMEOUTS=Object.freeze({
  resolve_client:1000,
  inspect_usb_descriptors:2500,
  list_devices:4000,
  inspect_port_owner:3000,
  inspect_session_state:500,
  reuse_existing_session:2500,
  read_version_metadata:5000,
  cleanup:1000
});
const RESOURCE_OWNERSHIP=Object.freeze(['none','borrowed','engine-created']);

class StageBoundaryError extends Error{
  constructor(kind,operation){
    super(`${operation} ${kind}`);
    this.name='StageBoundaryError';
    this.kind=kind;
    this.operation=operation;
  }
}

function failedStage(stage,status,code,message){
  return stageResult(stage,status,{
    failure:{code,message,recoverable:true}
  });
}

function adaptHandshakeResult(result={}){
  if(result&&result.ok===true){
    return stageResult('firmware-handshake','supported',{
      ok:true,
      source:result.source||'direct-probe',
      evidence:{
        protocol:String(result.protocol||'').slice(0,80),
        contract:String(result.contract||'').slice(0,120),
        reusedExistingSession:result.reusedExistingSession===true
      }
    });
  }
  const status=['timeout','cancelled','blocked','no-response','protocol-mismatch','disconnected'].includes(result?.status)
    ? result.status
    : 'failed';
  const details={
    timeout:['firmware-handshake-timeout','Firmware handshake timed out.'],
    cancelled:['firmware-handshake-cancelled','Firmware handshake was cancelled.'],
    blocked:['firmware-handshake-blocked','An active Electron operation temporarily blocks the firmware handshake.'],
    'no-response':['firmware-no-response','The device did not return a usable firmware response.'],
    'protocol-mismatch':['firmware-protocol-mismatch','The returned firmware response did not match the accepted handshake contract.'],
    disconnected:['device-disconnected','The device disconnected during the firmware handshake.'],
    failed:['firmware-handshake-failed','Firmware handshake did not complete.']
  }[status];
  return failedStage('firmware-handshake',status,details[0],details[1]);
}

function pendingStage(stage){
  return stageResult(stage,'not-attempted');
}

function stageBoundaryFailure(stage,error){
  const kind=error instanceof StageBoundaryError?error.kind:'failed';
  const name=stage==='helper-discovery'?'client resolution':
    stage==='client-launch'?'PM3 discovery':
    stage==='usb-discovery'?'USB descriptor check':
    stage==='port-ownership'?'port ownership check':
    'firmware handshake';
  return failedStage(
    stage,
    kind,
    `${stage}-${kind}`,
    `${name} ${kind==='cancelled'?'was cancelled':kind==='timeout'?'timed out':'did not complete'}.`
  );
}

function requestKey(options={}){
  const required=Array.isArray(options.scope?.requiredCapabilities)
    ? [...options.scope.requiredCapabilities].map(String).sort()
    : [];
  return JSON.stringify({
    trigger:String(options.trigger||'manual'),
    probeDepth:ALLOWED_DEPTHS.includes(options.probeDepth)?options.probeDepth:'presence',
    selectedPort:String(options.selectedPort||''),
    workflow:String(options.scope?.workflow||''),
    required
  });
}

function normaliseResourceOwnership(value={}){
  return {
    sessionOwnership:RESOURCE_OWNERSHIP.includes(value.sessionOwnership)?value.sessionOwnership:'none',
    portLeaseOwnership:RESOURCE_OWNERSHIP.includes(value.portLeaseOwnership)?value.portLeaseOwnership:'none',
    cleanupToken:String(value.cleanupToken||'').slice(0,120)
  };
}

function ownsEngineResource(value={}){
  return value.sessionOwnership==='engine-created'||value.portLeaseOwnership==='engine-created';
}

function cacheableSnapshot(snapshot){
  if(!snapshot||snapshot.failures?.length) return false;
  if(['MULTIPLE_PM3_DEVICES','BUSY_DEVICE','ELECTRON_BUSY','CLIENT_LAUNCH_FAILED','CONNECTION_FAILED','FIRMWARE_COMMUNICATION_FAILED','UNKNOWN_STATE'].includes(snapshot.primaryState)) return false;
  return !Object.values(snapshot.capabilities||{}).some(capability=>['blocked','error'].includes(capability?.status));
}

function callerAbortError(){
  const error=new Error('Connection check cancelled by caller.');
  error.name='AbortError';
  return error;
}

function createConnectionCompatibilityEngine(dependencies={}){
  const now=typeof dependencies.now==='function'?dependencies.now:()=>new Date().toISOString();
  const nowMs=typeof dependencies.nowMs==='function'?dependencies.nowMs:()=>Date.now();
  const cacheTtlMs=Math.max(250,Math.min(30000,Number(dependencies.cacheTtlMs)||5000));
  const timeouts={...DEFAULT_STAGE_TIMEOUTS,...(dependencies.stageTimeouts||{})};
  let cacheEntry=null;
  let queue=Promise.resolve();
  const pendingByKey=new Map();

  async function callOperation(operation,fn,args,signal,lifecycle){
    if(!ALLOWED_OPERATIONS.includes(operation)) throw new StageBoundaryError('blocked',operation);
    if(typeof fn!=='function') throw new StageBoundaryError('unavailable',operation);
    if(signal?.aborted) throw new StageBoundaryError('cancelled',operation);
    const timeoutMs=Math.max(1,Number(timeouts[operation])||1000);
    let timer=null;
    let abortHandler=null;
    const boundary=new Promise((_,reject)=>{
      timer=setTimeout(()=>reject(new StageBoundaryError('timeout',operation)),timeoutMs);
      if(signal){
        abortHandler=()=>reject(new StageBoundaryError('cancelled',operation));
        signal.addEventListener('abort',abortHandler,{once:true});
      }
    });
    try{
      return await Promise.race([Promise.resolve().then(()=>fn(args)),boundary]);
    }catch(error){
      if(error instanceof StageBoundaryError&&typeof dependencies.cancelStage==='function'){
        await Promise.resolve(dependencies.cancelStage({
          operation,
          reason:error.kind,
          resourceOwnership:normaliseResourceOwnership(lifecycle)
        })).catch(()=>{});
      }
      throw error;
    }finally{
      if(timer) clearTimeout(timer);
      if(signal&&abortHandler) signal.removeEventListener('abort',abortHandler);
    }
  }

  function finish(input){
    const snapshot=reduceConnectionSnapshot({
      capturedAt:now(),
      trigger:input.trigger,
      probeDepth:input.probeDepth,
      scope:input.scope,
      stages:input.stages,
      selection:input.selection,
      connection:input.connection,
      versions:input.versions,
      firmware:input.firmware,
      capabilities:input.capabilities,
      recommendedAction:input.recommendedAction
    });
    cacheEntry=cacheableSnapshot(snapshot)?{
      snapshot,
      expiresAt:nowMs()+cacheTtlMs,
      probeDepth:snapshot.probeDepth,
      selectionPort:String(input.selection?.port||snapshot.connection?.port||'')
    }:null;
    return snapshot;
  }

  async function execute(options={}){
    const trigger=String(options.trigger||'manual');
    const probeDepth=ALLOWED_DEPTHS.includes(options.probeDepth)?options.probeDepth:'presence';
    const scope=options.scope;
    const signal=options.signal;
    const stages={
      helper:pendingStage('helper-discovery'),
      client:pendingStage('client-launch'),
      usb:pendingStage('usb-discovery'),
      port:pendingStage('port-ownership'),
      handshake:pendingStage('firmware-handshake')
    };
    let descriptors=[];
    let usbDescriptorFailure=null;
    let selectedPort=String(options.selectedPort||'');
    let preflightResult=null;
    let handshakeResult=null;
    const lifecycle=normaliseResourceOwnership();

    try{
      if(typeof dependencies.readUsbDescriptors==='function'){
        try{
          const value=await callOperation(
            'inspect_usb_descriptors',
            dependencies.readUsbDescriptors,
            {},
            signal,
            lifecycle
          );
          descriptors=Array.isArray(value)?value:value&&typeof value==='object'?[value]:[];
        }catch(error){
          usbDescriptorFailure=stageBoundaryFailure('usb-discovery',error).failure;
          stages.usb=stageBoundaryFailure('usb-discovery',error);
          if(error instanceof StageBoundaryError&&error.kind==='cancelled'){
            return finish({trigger,probeDepth,scope,stages});
          }
        }
      }

      let resolution;
      try{
        resolution=await callOperation(
          'resolve_client',
          dependencies.resolveExecutable,
          {},
          signal,
          lifecycle
        );
        stages.helper=adaptExecutableResolution(resolution);
      }catch(error){
        stages.helper=stageBoundaryFailure('helper-discovery',error);
      }
      if(!stages.helper.ok){
        if(descriptors.length) stages.usb=adaptUsbDiscovery({listResult:{ports:[]},descriptors});
        return finish({trigger,probeDepth,scope,stages});
      }

      let listResult;
      try{
        listResult=await callOperation(
          'list_devices',
          dependencies.listDevices,
          {resolution},
          signal,
          lifecycle
        );
        stages.client=adaptClientListResult(listResult);
      }catch(error){
        listResult={ports:[],error:'PM3 discovery failed.'};
        stages.client=stageBoundaryFailure('client-launch',error);
      }
      stages.usb=adaptUsbDiscovery({listResult,descriptors});
      if(usbDescriptorFailure) stages.usb={...stages.usb,failure:usbDescriptorFailure};
      if(!stages.client.ok) return finish({trigger,probeDepth,scope,stages});

      const knownPorts=(stages.usb.evidence?.devices||[]).map(device=>device.port).filter(Boolean);
      const explicitSelection=Boolean(selectedPort&&knownPorts.includes(selectedPort));
      if(stages.usb.status==='no-device'||(stages.usb.status==='multiple-devices'&&!explicitSelection)){
        return finish({
          trigger,
          probeDepth,
          scope,
          stages,
          selection:{explicit:explicitSelection,port:selectedPort}
        });
      }

      try{
        preflightResult=await callOperation(
          'inspect_port_owner',
          dependencies.preflight,
          {
            ports:listResult?.ports||[],
            selectedPort:explicitSelection?selectedPort:'',
            resolution
          },
          signal,
          lifecycle
        );
        stages.port=adaptPortPreflight({
          ...preflightResult,
          explicitSelection
        });
      }catch(error){
        stages.port=stageBoundaryFailure('port-ownership',error);
      }
      if(!selectedPort) selectedPort=String(preflightResult?.port||stages.port.evidence?.selectedPort||'');
      if(!stages.port.ok){
        const externalBusy=stages.port.status==='external-busy';
        return finish({
          trigger,
          probeDepth,
          scope,
          stages,
          selection:{explicit:explicitSelection,port:selectedPort},
          connection:externalBusy?{
            status:'busy',
            port:selectedPort,
            owner:stages.port.evidence?.owner,
            ownerType:'external',
            source:'electron-observed'
          }:undefined
        });
      }
      if(probeDepth==='presence'){
        return finish({
          trigger,
          probeDepth,
          scope,
          stages,
          selection:{explicit:explicitSelection,port:selectedPort}
        });
      }

      const owner=stages.port.evidence?.owner||'unknown';
      let sessionState={owned:stages.port.status==='electron-owned',active:false};
      if(sessionState.owned){
        lifecycle.sessionOwnership='borrowed';
        lifecycle.portLeaseOwnership='borrowed';
      }
      if(sessionState.owned&&typeof dependencies.inspectSessionState==='function'){
        try{
          sessionState=await callOperation(
            'inspect_session_state',
            dependencies.inspectSessionState,
            {port:selectedPort,owner},
            signal,
            lifecycle
          )||sessionState;
        }catch(error){
          stages.handshake=stageBoundaryFailure('firmware-handshake',error);
          return finish({
            trigger,
            probeDepth,
            scope,
            stages,
            selection:{explicit:explicitSelection,port:selectedPort},
            connection:{status:'connected',port:selectedPort,owner,ownerType:'electron',source:'electron-observed'}
          });
        }
      }
      if(sessionState.active===true){
        stages.handshake=adaptHandshakeResult({ok:false,status:'blocked'});
        return finish({
          trigger,
          probeDepth,
          scope,
          stages,
          selection:{explicit:explicitSelection,port:selectedPort},
          connection:{
            status:'connected',
            port:selectedPort,
            owner,
            ownerType:'electron',
            operationActive:true,
            source:'electron-observed'
          },
          capabilities:{
            firmwareHandshake:{
              status:'blocked',
              source:'electron-observed',
              reason:'An active Electron operation owns the shared PM3 session.'
            }
          },
          recommendedAction:{
            id:'wait-for-active-operation',
            label:'Wait for the current Electron operation'
          }
        });
      }

      const operation=sessionState.owned?'reuse_existing_session':'read_version_metadata';
      try{
        handshakeResult=await callOperation(
          operation,
          dependencies.handshake,
          {
            port:selectedPort,
            owner,
            reuseExistingSession:sessionState.owned===true,
            registerResourceOwnership:value=>{
              Object.assign(lifecycle,normaliseResourceOwnership(value));
            }
          },
          signal,
          lifecycle
        );
        if(handshakeResult?.resourceOwnership){
          Object.assign(lifecycle,normaliseResourceOwnership(handshakeResult.resourceOwnership));
        }
        stages.handshake=adaptHandshakeResult(handshakeResult);
      }catch(error){
        stages.handshake=stageBoundaryFailure('firmware-handshake',error);
      }
      return finish({
        trigger,
        probeDepth,
        scope,
        stages,
        selection:{explicit:explicitSelection,port:selectedPort},
        connection:{
          status:stages.handshake.ok?'connected':'available',
          port:selectedPort,
          owner,
          ownerType:sessionState.owned?'electron':'free',
          source:'electron-observed'
        },
        versions:handshakeResult?.versions,
        capabilities:{
          firmwareHandshake:{
            status:stages.handshake.ok?'supported':
              stages.handshake.status==='cancelled'?'error':
              stages.handshake.status==='blocked'?'blocked':
              stages.handshake.status==='timeout'?'error':'error',
            source:stages.handshake.source||'unknown',
            reason:stages.handshake.failure?.message||''
          }
        }
      });
    }finally{
      if(ownsEngineResource(lifecycle)&&typeof dependencies.cleanup==='function'){
        try{
          await callOperation(
            'cleanup',
            dependencies.cleanup,
            {
              probeDepth,
              selectedPort,
              resourceOwnership:normaliseResourceOwnership(lifecycle)
            },
            null,
            lifecycle
          );
        }catch{
          if(typeof dependencies.onLifecycleFailure==='function'){
            await Promise.resolve(dependencies.onLifecycleFailure({
              code:'connection-cleanup-failed',
              resourceOwnership:normaliseResourceOwnership(lifecycle)
            })).catch(()=>{});
          }
        }
      }
    }
  }

  function subscribe(job,signal){
    job.consumers++;
    return new Promise((resolve,reject)=>{
      let active=true;
      const finish=()=>{
        if(!active) return false;
        active=false;
        job.consumers=Math.max(0,job.consumers-1);
        if(signal) signal.removeEventListener('abort',abort);
        return true;
      };
      const abort=()=>{
        if(!finish()) return;
        reject(callerAbortError());
        if(job.consumers===0&&!job.settled) job.controller.abort();
      };
      if(signal?.aborted) return abort();
      if(signal) signal.addEventListener('abort',abort,{once:true});
      job.promise.then(
        value=>{if(finish()) resolve(value);},
        error=>{if(finish()) reject(error);}
      );
    });
  }

  function run(options={}){
    const selectedPort=String(options.selectedPort||'');
    if(cacheEntry&&selectedPort&&cacheEntry.selectionPort!==selectedPort) cacheEntry=null;
    const key=requestKey(options);
    let job=pendingByKey.get(key);
    if(!job){
      job={
        controller:new AbortController(),
        consumers:0,
        settled:false,
        promise:null
      };
      const executionOptions={...options,signal:job.controller.signal};
      job.promise=queue.catch(()=>{}).then(()=>execute(executionOptions));
      job.promise.then(
        ()=>{job.settled=true;pendingByKey.delete(key);},
        ()=>{job.settled=true;pendingByKey.delete(key);}
      );
      pendingByKey.set(key,job);
      queue=job.promise.catch(()=>{});
    }
    return subscribe(job,options.signal);
  }

  function getLastSnapshot(options={}){
    if(!cacheEntry||cacheEntry.expiresAt<=nowMs()) return null;
    if(options.probeDepth&&cacheEntry.probeDepth!==options.probeDepth) return null;
    return cacheEntry.snapshot;
  }

  function disconnect(){
    cacheEntry=null;
    return reduceConnectionSnapshot({
      capturedAt:now(),
      trigger:'post-disconnect',
      probeDepth:'presence',
      connection:{status:'disconnected'}
    });
  }

  function invalidateSelection(){
    cacheEntry=null;
  }

  return {
    run,
    getLastSnapshot,
    disconnect,
    invalidateSelection,
    allowedOperations:()=>[...ALLOWED_OPERATIONS]
  };
}

module.exports={
  ALLOWED_DEPTHS,
  ALLOWED_OPERATIONS,
  DEFAULT_STAGE_TIMEOUTS,
  RESOURCE_OWNERSHIP,
  adaptHandshakeResult,
  createConnectionCompatibilityEngine
};
