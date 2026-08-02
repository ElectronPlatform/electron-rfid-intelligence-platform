'use strict';

const fs=require('fs');

function sleepSync(delayMs){
  const duration=Math.max(0,Number(delayMs)||0);
  if(!duration) return;
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,duration);
}

function readTextFileSyncWithRetry(filePath,{
  encoding='utf8',
  maxAttempts=3,
  retryDelayMs=0,
  retryableCodes=['EINTR','ECANCELED'],
  onRetry=null,
  sleepImpl=sleepSync,
  fsImpl=fs
}={}){
  const attempts=Math.max(1,Number(maxAttempts)||1);
  const retryable=new Set(retryableCodes);
  for(let attempt=1;attempt<=attempts;attempt+=1){
    try{
      return fsImpl.readFileSync(filePath,encoding);
    }catch(error){
      if(!retryable.has(error?.code) || attempt===attempts) throw error;
      if(typeof onRetry==='function') onRetry({attempt,error,filePath});
      sleepImpl(retryDelayMs,attempt,error);
    }
  }
  throw new Error(`Unable to read ${filePath}`);
}

function readJsonFileSyncWithRetry(filePath,options={}){
  return JSON.parse(readTextFileSyncWithRetry(filePath,options));
}

module.exports={sleepSync,readTextFileSyncWithRetry,readJsonFileSyncWithRetry};
