/*
 * Connection Compatibility Engine main-process API.
 *
 * This is the stable internal boundary for future read-only IPC/preload tasks.
 * It wraps the existing connection compatibility engine in structured result envelopes and
 * deliberately contains no Electron IPC, renderer access or PM3 transport.
 */
'use strict';

const {TRIGGERS}=require('./connectionCompatibilityContract');
const {ALLOWED_DEPTHS}=require('./connectionCompatibilityEngine');

const API_VERSION='1.0';
const CAPABILITY_ID=/^[A-Za-z][A-Za-z0-9_-]{0,79}$/;

function text(value,maximum=240){
  return String(value??'').trim().slice(0,maximum);
}

function structuredError(code,message,recoverable=true){
  return {
    code:text(code,100)||'connection-service-error',
    message:text(message,500)||'The connection check did not complete.',
    recoverable:recoverable===true
  };
}

function normaliseRequest(input={}){
  if(!input||typeof input!=='object'||Array.isArray(input)){
    return {
      ok:false,
      error:structuredError('connection-invalid-request','Connection check input must be an object.')
    };
  }
  const trigger=text(input.trigger,40)||'manual';
  const probeDepth=text(input.probeDepth,40)||'presence';
  if(!TRIGGERS.includes(trigger)){
    return {
      ok:false,
      error:structuredError('connection-invalid-trigger',`Unsupported connection check trigger: ${trigger}.`)
    };
  }
  if(!ALLOWED_DEPTHS.includes(probeDepth)){
    return {
      ok:false,
      error:structuredError('connection-invalid-probe-depth',`Unsupported connection check depth: ${probeDepth}.`)
    };
  }
  const requestedCapabilities=Array.isArray(input.scope?.requiredCapabilities)
    ? input.scope.requiredCapabilities
    : [];
  const requiredCapabilities=[...new Set(requestedCapabilities.map(value=>text(value,80)).filter(Boolean))];
  if(requiredCapabilities.length>20||requiredCapabilities.some(id=>!CAPABILITY_ID.test(id))){
    return {
      ok:false,
      error:structuredError('compatibility-invalid-capability-scope','The compatibility check contains an invalid capability identifier.')
    };
  }
  const selectedPort=text(input.selectedPort,240);
  return {
    ok:true,
    value:{
      trigger,
      probeDepth,
      selectedPort,
      scope:{
        workflow:text(input.scope?.workflow,120),
        requiredCapabilities
      },
      signal:input.signal
    },
    publicRequest:{
      trigger,
      probeDepth,
      selectedPort:selectedPort||null,
      scope:{
        workflow:text(input.scope?.workflow,120),
        requiredCapabilities
      }
    }
  };
}

function result({ok,status,request=null,snapshot=null,error=null}){
  return {
    apiVersion:API_VERSION,
    ok:ok===true,
    status:text(status,80)||'unknown',
    request,
    snapshot,
    error
  };
}

function createConnectionCompatibilityService({engine}={}){
  if(!engine||typeof engine.run!=='function'){
    throw new TypeError('A Connection Compatibility Engine service is required.');
  }

  async function requestSnapshot(input={}){
    const request=normaliseRequest(input);
    if(!request.ok){
      return result({
        ok:false,
        status:'invalid-request',
        error:request.error
      });
    }
    try{
      const snapshot=await engine.run(request.value);
      return result({
        ok:true,
        status:'complete',
        request:request.publicRequest,
        snapshot
      });
    }catch(error){
      const cancelled=error?.name==='AbortError';
      return result({
        ok:false,
        status:cancelled?'cancelled':'failed',
        request:request.publicRequest,
        error:structuredError(
          cancelled?'connection-request-cancelled':'connection-request-failed',
          cancelled?'The connection check was cancelled.':'The connection check did not complete.',
          true
        )
      });
    }
  }

  function getLastSnapshot(options={}){
    try{
      const requestOptions=options&&typeof options==='object'&&!Array.isArray(options)?options:{};
      const probeDepth=text(requestOptions.probeDepth,40);
      if(probeDepth&&!ALLOWED_DEPTHS.includes(probeDepth)){
        return result({
          ok:false,
          status:'invalid-request',
          error:structuredError('connection-invalid-probe-depth',`Unsupported connection check depth: ${probeDepth}.`)
        });
      }
      const snapshot=engine.getLastSnapshot(probeDepth?{probeDepth}:{});
      return result({
        ok:true,
        status:snapshot?'available':'empty',
        snapshot
      });
    }catch{
      return result({
        ok:false,
        status:'failed',
        error:structuredError('connection-cache-read-failed','The latest connection status could not be read.')
      });
    }
  }

  function disconnect(){
    try{
      return result({
        ok:true,
        status:'disconnected',
        snapshot:engine.disconnect()
      });
    }catch{
      return result({
        ok:false,
        status:'failed',
        error:structuredError('connection-disconnect-failed','The disconnected device state could not be created.')
      });
    }
  }

  function invalidateSelection(){
    try{
      engine.invalidateSelection();
      return result({ok:true,status:'invalidated'});
    }catch{
      return result({
        ok:false,
        status:'failed',
        error:structuredError('connection-selection-invalidation-failed','The device selection cache could not be cleared.')
      });
    }
  }

  function describe(){
    return {
      apiVersion:API_VERSION,
      triggers:[...TRIGGERS],
      probeDepths:[...ALLOWED_DEPTHS],
      methods:[
        'requestSnapshot',
        'getLastSnapshot',
        'disconnect',
        'invalidateSelection',
        'describe'
      ],
      readOnly:true
    };
  }

  return Object.freeze({
    requestSnapshot,
    getLastSnapshot,
    disconnect,
    invalidateSelection,
    describe
  });
}

module.exports={
  API_VERSION,
  createConnectionCompatibilityService,
  normaliseRequest,
  structuredError
};
