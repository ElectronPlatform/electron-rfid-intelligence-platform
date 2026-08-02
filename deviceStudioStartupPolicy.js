/*
 * Device Studio startup presence policy.
 *
 * Startup may report passive client/USB/ownership evidence only. It must never
 * select one of several devices or trigger firmware/RF diagnostics.
 */
'use strict';

function clean(value,maximum=240){
  return String(value??'').trim().slice(0,maximum);
}

function uniquePorts(values){
  return [...new Set((Array.isArray(values)?values:[]).map(value=>clean(value)).filter(Boolean))].slice(0,16);
}

function createStartupPresencePreflight(preflight={}){
  const ports=uniquePorts(preflight.ports);
  const base={
    ok:preflight.ok===true,
    status:clean(preflight.status,80)||'unknown',
    port:clean(preflight.port)||null,
    ports,
    owner:clean(preflight.owner,120)||'unknown',
    message:clean(preflight.message,300)||null,
    startupDepth:'presence'
  };
  if(ports.length>1){
    return {
      ...base,
      ok:false,
      status:'multiple-devices',
      port:null,
      message:'More than one Proxmark3 is present. Electron will not select one during startup.'
    };
  }
  if(!base.ok) return base;
  if(!base.port&&ports.length===1) base.port=ports[0];
  return base;
}

module.exports={createStartupPresencePreflight};
