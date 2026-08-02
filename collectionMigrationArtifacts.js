'use strict';

const crypto=require('crypto');
const fs=require('fs');
const path=require('path');

function sha256(bytes){
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

function jsonBytes(value){
  return Buffer.from(`${JSON.stringify(value,null,2)}\n`,'utf8');
}

function ensureDirectory(directory){
  fs.mkdirSync(directory,{recursive:true});
  fs.accessSync(directory,fs.constants.R_OK | fs.constants.W_OK);
  return directory;
}

function fsyncDirectory(directory){
  let descriptor=null;
  try{
    descriptor=fs.openSync(directory,'r');
    fs.fsyncSync(descriptor);
  }catch{
    // Directory fsync is not available on every supported filesystem. File
    // fsync plus same-directory rename remains the portable minimum.
  }finally{
    if(descriptor!==null){
      try{ fs.closeSync(descriptor); }catch{}
    }
  }
}

function atomicWriteBytes(filePath,bytes,{beforeReplace=null}={}){
  const data=Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
  const directory=ensureDirectory(path.dirname(filePath));
  const temporary=path.join(
    directory,
    `.${path.basename(filePath)}.${process.pid}.${crypto.randomBytes(6).toString('hex')}.tmp`
  );
  let descriptor=null;
  try{
    descriptor=fs.openSync(temporary,'wx',0o600);
    let offset=0;
    while(offset<data.length){
      offset+=fs.writeSync(descriptor,data,offset,data.length-offset);
    }
    fs.fsyncSync(descriptor);
    fs.closeSync(descriptor);
    descriptor=null;
    if(typeof beforeReplace==='function') beforeReplace({filePath,temporary,bytes:data});
    fs.renameSync(temporary,filePath);
    fsyncDirectory(directory);
  }finally{
    if(descriptor!==null){
      try{ fs.closeSync(descriptor); }catch{}
    }
    try{ if(fs.existsSync(temporary)) fs.unlinkSync(temporary); }catch{}
  }
  return {
    path:filePath,
    size:data.length,
    sha256:sha256(data)
  };
}

function atomicWriteJson(filePath,value,options={}){
  return atomicWriteBytes(filePath,jsonBytes(value),options);
}

function readFileDescriptor(filePath){
  if(!filePath || !fs.existsSync(filePath)) return null;
  const bytes=fs.readFileSync(filePath);
  const stat=fs.statSync(filePath);
  return {
    path:filePath,
    bytes,
    size:bytes.length,
    sha256:sha256(bytes),
    mtimeMs:stat.mtimeMs
  };
}

function readJson(filePath){
  return JSON.parse(fs.readFileSync(filePath,'utf8'));
}

function listDirectories(root){
  if(!fs.existsSync(root)) return [];
  return fs.readdirSync(root,{withFileTypes:true})
    .filter(entry=>entry.isDirectory())
    .map(entry=>path.join(root,entry.name));
}

module.exports={
  sha256,
  jsonBytes,
  ensureDirectory,
  atomicWriteBytes,
  atomicWriteJson,
  readFileDescriptor,
  readJson,
  listDirectories
};
