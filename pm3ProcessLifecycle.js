/*
 * Process-tree lifecycle helpers for short-lived PM3 commands.
 *
 * The Iceman `pm3` entry point is a shell script which starts the actual
 * `client/proxmark3` binary. Killing only the shell can therefore leave the
 * serial-port-owning client behind. One-shot commands are started in their
 * own POSIX process group and this module terminates that entire group.
 */
'use strict';

function delay(ms){
  return new Promise(resolve=>setTimeout(resolve,Math.max(0,Number(ms)||0)));
}

function childExited(child){
  return !child || child.exitCode!==null || child.signalCode!==null || child.__pm3Closed===true;
}

function normaliseOneShotRequest(payload,options={}){
  const source=payload && typeof payload==='object' ? payload : {command:payload};
  const defaultTimeoutMs=Math.max(1000,Number(options.defaultTimeoutMs)||45000);
  const minTimeoutMs=Math.max(1000,Number(options.minTimeoutMs)||5000);
  const maxTimeoutMs=Math.max(minTimeoutMs,Number(options.maxTimeoutMs)||900000);
  const requested=Number(source.timeoutMs);
  const timeoutMs=Number.isFinite(requested)
    ? Math.max(minTimeoutMs,Math.min(maxTimeoutMs,Math.round(requested)))
    : defaultTimeoutMs;
  return {command:String(source.command||'').trim(),timeoutMs};
}

function processTreeRunning(child,{platform=process.platform,killFn=process.kill}={}){
  if(!child || !Number.isInteger(child.pid) || child.pid<=0) return false;
  if(platform==='win32') return !childExited(child);
  try{
    killFn(-child.pid,0);
    return true;
  }catch(error){
    return error?.code==='EPERM';
  }
}

function signalProcessTree(child,signal,{platform=process.platform,killFn=process.kill}={}){
  if(!child || !Number.isInteger(child.pid) || child.pid<=0) return false;
  if(platform!=='win32'){
    try{
      killFn(-child.pid,signal);
      return true;
    }catch(error){
      if(error?.code!=='ESRCH'){
        try{ return child.kill(signal); }catch{}
      }
      return false;
    }
  }
  try{ return child.kill(signal); }catch{ return false; }
}

async function waitForProcessTreeExit(child,timeoutMs,{platform=process.platform,killFn=process.kill,delayFn=delay}={}){
  const deadline=Date.now()+Math.max(0,Number(timeoutMs)||0);
  do{
    if(!processTreeRunning(child,{platform,killFn})) return true;
    if(Date.now()>=deadline) return false;
    await delayFn(Math.min(50,Math.max(1,deadline-Date.now())));
  }while(Date.now()<=deadline);
  return !processTreeRunning(child,{platform,killFn});
}

async function terminateProcessTree(child,options={}){
  const platform=options.platform||process.platform;
  const killFn=options.killFn||process.kill;
  const delayFn=options.delayFn||delay;
  const graceMs=Math.max(0,Number(options.graceMs??350));
  const forceWaitMs=Math.max(0,Number(options.forceWaitMs??900));
  const context={platform,killFn,delayFn};
  if(!processTreeRunning(child,context)) return {terminated:true,signal:null};

  for(const signal of ['SIGINT','SIGTERM']){
    signalProcessTree(child,signal,context);
    if(await waitForProcessTreeExit(child,graceMs,context)) return {terminated:true,signal};
  }

  signalProcessTree(child,'SIGKILL',context);
  const terminated=await waitForProcessTreeExit(child,forceWaitMs,context);
  return {terminated,signal:'SIGKILL'};
}

module.exports={childExited,normaliseOneShotRequest,processTreeRunning,signalProcessTree,waitForProcessTreeExit,terminateProcessTree};
