/*
 * Device Studio PM3 communication layer.
 *
 * Owns short-lived diagnostic commands and the optional warmed PM3 session.
 * It deliberately exposes structured results, never renderer-facing PM3 text.
 */
'use strict';

const fs=require('fs');
const os=require('os');
const path=require('path');
const {spawn,execFile}=require('child_process');
const {parseStructuredJsonOutput,parseTuneOutput}=require('./deviceStudioService');

function delay(ms){ return new Promise(resolve=>setTimeout(resolve,ms)); }

function inspectPM3Executable(candidate,{fsModule=fs}={}){
  const executablePath=String(candidate||'').trim();
  if(!executablePath) return {ok:false,status:'empty',path:'',message:'No PM3 executable path was supplied.'};
  try{
    if(!fsModule.existsSync(executablePath)){
      return {ok:false,status:'not-found',path:executablePath,message:`PM3 executable not found: ${executablePath}`};
    }
    if(!fsModule.statSync(executablePath).isFile()){
      return {ok:false,status:'not-file',path:executablePath,message:`PM3 executable path is not a file: ${executablePath}`};
    }
    fsModule.accessSync(executablePath,fs.constants.X_OK);
    return {ok:true,status:'ready',path:executablePath,message:''};
  }catch(error){
    return {
      ok:false,
      status:error?.code==='EACCES'?'not-executable':'unavailable',
      path:executablePath,
      message:error?.code==='EACCES'
        ? `PM3 executable is not executable: ${executablePath}`
        : `PM3 executable is unavailable: ${executablePath} (${error?.message||error})`
    };
  }
}

function resolvePM3Executable({override='',candidates=[],fsModule=fs,allowPathFallback=true}={}){
  const explicit=String(override||'').trim();
  if(explicit){
    const inspected=inspectPM3Executable(explicit,{fsModule});
    return {...inspected,source:'PM3_PATH',explicit:true};
  }
  for(const candidate of candidates){
    const inspected=inspectPM3Executable(candidate,{fsModule});
    if(inspected.ok) return {...inspected,source:'candidate',explicit:false};
  }
  if(!allowPathFallback){
    const expectedPath=String(candidates[0]||'');
    return {
      ok:false,
      status:'not-found',
      path:expectedPath,
      message:expectedPath
        ? `Bundled PM3 executable not found: ${expectedPath}`
        : 'Bundled PM3 executable was not configured.',
      source:'bundle',
      explicit:false
    };
  }
  return {ok:true,status:'path-fallback',path:'pm3',message:'',source:'PATH',explicit:false};
}

function createPM3CommunicationLayer({rootDir,environment=process.env,resolveExecutable=null}={}){
  let binaryResolutionCache=null;
  let persistent=null;
  let persistentPort='';
  let persistentBuffer='';
  let tuneProcess=null;

  function run(command,args=[],timeoutMs=8000,options={}){
    return new Promise(resolve=>execFile(command,args,{timeout:timeoutMs,env:options.env||environment},(error,stdout,stderr)=>resolve({error:error?String(error):'',stdout:stdout||'',stderr:stderr||''})));
  }
  function binaryResolution(){
    if(binaryResolutionCache) return binaryResolutionCache;
    if(typeof resolveExecutable==='function'){
      binaryResolutionCache=resolveExecutable();
      return binaryResolutionCache;
    }
    const home=os.homedir();
    const candidates=[path.join(rootDir,'..','proxmark3-iceman-device-studio','pm3'),'/opt/homebrew/bin/pm3','/usr/local/bin/pm3','/opt/local/bin/pm3',path.join(home,'.local','bin','pm3'),path.join(home,'bin','pm3')].filter(Boolean);
    binaryResolutionCache=resolvePM3Executable({override:environment.PM3_PATH,candidates});
    return binaryResolutionCache;
  }
  function binary(){ return binaryResolution().path; }
  function runPm3(args=[],timeoutMs=8000,options={}){
    const resolution=binaryResolution();
    if(!resolution.ok) return Promise.resolve({error:resolution.message,stdout:'',stderr:''});
    return run(resolution.path,args,timeoutMs,options);
  }
  function parsePorts(text=''){
    const ports=[]; const re=/^\s*\d+:\s+(.+)\s*$/gm; let match;
    while((match=re.exec(text))!==null) ports.push(match[1].trim());
    return [...new Set(ports)];
  }
  async function lsofPort(port,timeoutMs=8000){
    const candidates=[port,String(port||'').replace('/dev/tty.','/dev/cu.')].filter(Boolean);
    const users=[];
    for(const candidate of candidates){
      const result=await run('lsof',[candidate],timeoutMs);
      if(!result.stdout.trim()) continue;
      for(const line of result.stdout.trim().split(/\r?\n/).slice(1)){
        const parts=line.trim().split(/\s+/);
        users.push({command:parts[0]||'',pid:parts[1]||'',port:candidate,raw:line});
      }
    }
    return users;
  }
  async function waitForPortRelease(port,timeoutMs=5000){
    const started=Date.now();
    while(Date.now()-started<timeoutMs){
      const probe=await run('lsof',['-t',port]);
      if(!String(probe.stdout||'').trim()) return true;
      await delay(150);
    }
    return false;
  }
  async function preflight({ownedPid=null,selectedPort='',timeoutMs=8000,executableResolution=null}={}){
    const resolution=executableResolution&&typeof executableResolution==='object'
      ? executableResolution
      : binaryResolution();
    if(!resolution.ok){
      return {ok:false,status:'invalid-client',message:resolution.message,raw:'',binary:resolution.path};
    }
    const list=await run(resolution.path,['--list'],timeoutMs);
    const raw=`${list.stdout||''}${list.stderr||''}`;
    const ports=parsePorts(raw);
    if(!ports.length) return {ok:false,status:'no-device',message:'No Proxmark3 found by pm3 --list.',raw,binary:resolution.path};
    const requestedPort=String(selectedPort||'');
    if(requestedPort&&!ports.includes(requestedPort)){
      return {ok:false,status:'no-device',port:requestedPort,ports,message:'The selected Proxmark3 port is no longer available.',raw,binary:resolution.path};
    }
    const inspectedPorts=requestedPort?[requestedPort]:ports;
    for(const port of inspectedPorts){
      const users=await lsofPort(port,timeoutMs);
      const blockers=users.filter(user=>![String(ownedPid||''),String(persistent?.pid||'')].includes(String(user.pid||'')));
      // On macOS the pm3 helper is a shell wrapper, so lsof may report its
      // proxmark3 child PID instead of the persistent wrapper PID we own.
      // Treat that child as our own session; one-shot workflows will stop it
      // and wait for the USB-CDC handle to be released before reconnecting.
      const persistentChild=!!persistent && persistentPort===port && blockers.length>0 && blockers.every(user=>/proxmark3/i.test(user.command||''));
      if(persistentChild) return {ok:true,status:'ready',port,ports,owner:'device-studio-persistent',raw,binary:resolution.path};
      if(blockers.length) return {ok:false,status:'busy',port,ports,message:`Port is in use by ${blockers.map(user=>`${user.command} (${user.pid})`).join(', ')}`,users:blockers,raw,binary:resolution.path};
    }
    return {ok:true,status:'ready',port:inspectedPorts[0],ports,raw,binary:resolution.path};
  }
  async function status(port){
    let last={error:'status command not attempted',stdout:'',stderr:''};
    // Prefer the richer Device Studio status contract when the firmware
    // supports it. Snapshot v1 remains the compatibility fallback.
    for(let attempt=0;attempt<3;attempt++){
      if(attempt) await delay(450);
      last=await runPm3(['-p',port,'-c','hw ds-status --json']);
      if(parseStructuredJsonOutput(`${last.stdout}\n${last.stderr}`)?.contract==='device-studio-status') return last;
    }
    for(let attempt=0;attempt<3;attempt++){
      if(attempt) await delay(450);
      last=await runPm3(['-p',port,'-c','hw ds-snapshot --json']);
      if(parseStructuredJsonOutput(`${last.stdout}\n${last.stderr}`)?.contract==='device-studio-snapshot') return last;
    }
    // Firmware predating both Device Studio contracts remains usable through
    // the original structured status command.
    if(!parseStructuredJsonOutput(`${last.stdout}\n${last.stderr}`)){
      last=await runPm3(['-p',port,'-c','hw status --json']);
    }
    return last;
  }
  function fullRfSnapshotCommands(port){
    return run(binary(),['-p',port,'-c','hw version; hw tune'],30000,{env:{...environment,QT_QPA_PLATFORM:'offscreen'}});
  }
  async function openPersistent(port){
    if(persistent&&!persistent.killed&&persistentPort===port) return true;
    stopPersistent();
    persistentPort=port; persistentBuffer='';
    persistent=spawn(binary(),['-p',port],{shell:false});
    persistent.stdout?.on('data',data=>{persistentBuffer+=data.toString();});
    persistent.stderr?.on('data',data=>{persistentBuffer+=data.toString();});
    persistent.on('exit',()=>{persistent=null;persistentPort='';persistentBuffer='';});
    await delay(500);
    return !!persistent&&!persistent.killed;
  }
  function stopPersistent(){
    if(persistent){try{persistent.stdin?.write('quit\r\n');}catch{}try{persistent.kill();}catch{}}
    persistent=null;persistentPort='';persistentBuffer='';
  }
  async function persistentCommand(command,timeoutMs=5000){
    if(!persistent||persistent.killed||!persistent.stdin||persistent.stdin.destroyed) return null;
    const marker=persistentBuffer.length;
    persistent.stdin.write(`${command}\r\n`);
    const started=Date.now();
    return new Promise(resolve=>{
      const poll=setInterval(()=>{
        const raw=persistentBuffer.slice(marker);
        const data=parseStructuredJsonOutput(raw);
        if(data){clearInterval(poll);resolve({ok:true,status:'complete',data,raw,port:persistentPort,binary:binary()});}
        else if(Date.now()-started>timeoutMs){clearInterval(poll);resolve({ok:false,status:'timeout',message:'Persistent PM3 command timed out.',raw,port:persistentPort,binary:binary()});}
      },40);
    });
  }
  async function structuredCommand({port,command,timeoutMs=8000}={}){
    const result=await runPm3(['-p',port,'-c',command],timeoutMs);
    const raw=`${result.stdout}\n${result.stderr}`;
    const data=parseStructuredJsonOutput(raw);
    return {ok:!result.error&&!!data,status:result.error?'command-failed':data?'complete':'unsupported',message:result.error||(!data?'Installed PM3 client/firmware does not provide structured output.':'Command complete'),data,raw,port,binary:binary()};
  }
  async function tuneSnapshot(port){
    stopTune();
    const result=await new Promise(resolve=>{
      const proc=spawn(binary(),['-p',port,'-c','hw tune'],{shell:false,env:{...environment,QT_QPA_PLATFORM:'offscreen'}});
      tuneProcess=proc; let stdout='',stderr='',settled=false;
      const finish=(error='')=>{if(settled)return;settled=true;if(tuneProcess===proc)tuneProcess=null;resolve({error,stdout,stderr});};
      proc.stdout?.on('data',data=>{stdout+=data.toString();}); proc.stderr?.on('data',data=>{stderr+=data.toString();});
      proc.on('error',error=>finish(String(error))); proc.on('close',(code,signal)=>finish(signal?`Antenna measurement stopped (${signal}).`:code?`Antenna measurement exited with code ${code}.`:''));
      setTimeout(()=>{if(!settled){try{proc.kill('SIGTERM');}catch{}finish('Antenna measurement timed out.');}},15000);
    });
    const raw=`${result.stdout}\n${result.stderr}`; const data=parseTuneOutput(raw);
    const ok=!result.error&&(data.hf.voltage!==null||data.lf.voltage!==null||data.hf.frequencyMHz!==null||data.lf.frequencyKHz!==null);
    return {ok,status:ok?'tune-snapshot':'failed',data,raw:raw.slice(-6000),message:result.error||(!ok?'No antenna measurements reported.':'')};
  }
  function stopTune(){
    const proc=tuneProcess; tuneProcess=null;
    if(!proc) return false;
    try{proc.kill('SIGTERM');}catch{} setTimeout(()=>{try{if(!proc.killed)proc.kill('SIGKILL');}catch{}},500);
    return true;
  }
  return {run,binary,binaryResolution,runPm3,parsePorts,lsofPort,waitForPortRelease,preflight,status,fullRfSnapshotCommands,openPersistent,stopPersistent,persistentCommand,structuredCommand,tuneSnapshot,stopTune};
}

module.exports={createPM3CommunicationLayer,inspectPM3Executable,resolvePM3Executable};
