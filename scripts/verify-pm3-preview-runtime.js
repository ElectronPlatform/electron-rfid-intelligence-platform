'use strict';

const fs=require('fs');
const os=require('os');
const path=require('path');
const {execFileSync}=require('child_process');

const projectRoot=path.resolve(__dirname,'..');
const sourceRoot=path.resolve(projectRoot,'..','proxmark3-iceman-device-studio');
const runtimeRoot=path.resolve(
  sourceRoot,
  'client',
  'build-electron-public-preview-1'
);
const helperSourcePath=path.join(sourceRoot,'pm3');
const clientPath=path.join(runtimeRoot,'proxmark3');

function fail(message){
  console.error(`PM3 Preview runtime verification failed: ${message}`);
  process.exit(1);
}

function requireExecutable(filePath,label){
  if(!fs.existsSync(filePath)) fail(`${label} is missing: ${filePath}`);
  if(!fs.statSync(filePath).isFile()) fail(`${label} is not a file: ${filePath}`);
  try{ fs.accessSync(filePath,fs.constants.X_OK); }
  catch{ fail(`${label} is not executable: ${filePath}`); }
}

requireExecutable(helperSourcePath,'Preview helper source');
requireExecutable(clientPath,'Preview client');

if(process.platform==='darwin'){
  const fileDescription=execFileSync('file',[clientPath],{encoding:'utf8'});
  if(!/Mach-O 64-bit executable arm64/.test(fileDescription)){
    fail(`Preview client is not a macOS Apple Silicon executable: ${fileDescription.trim()}`);
  }

  const linkedOutput=execFileSync('otool',['-L',clientPath],{encoding:'utf8'});
  const linkedLibraries=linkedOutput
    .split(/\r?\n/)
    .slice(1)
    .map(line=>line.trim().split(/\s+\(/)[0])
    .filter(Boolean);
  const nonSystemLibraries=linkedLibraries.filter(library=>{
    if(library.startsWith('@')) return false;
    return !library.startsWith('/usr/lib/')&&!library.startsWith('/System/Library/');
  });
  if(nonSystemLibraries.length){
    fail(`Preview client has non-system dynamic dependencies: ${nonSystemLibraries.join(', ')}`);
  }
}

const verificationRoot=fs.mkdtempSync(path.join(os.tmpdir(),'electron-pm3-preview-runtime-'));
const helperPath=path.join(verificationRoot,'pm3-electron-public-preview-1');
const pairedClientPath=path.join(verificationRoot,'proxmark3');
fs.copyFileSync(helperSourcePath,helperPath);
fs.copyFileSync(clientPath,pairedClientPath);
fs.chmodSync(helperPath,0o755);
fs.chmodSync(pairedClientPath,0o755);

let versionOutput='';
try{
  execFileSync(helperPath,['--list'],{encoding:'utf8',stdio:['ignore','pipe','pipe']});
  versionOutput=execFileSync(
    helperPath,
    ['--incognito','--version'],
    {encoding:'utf8',stdio:['ignore','pipe','pipe']}
  );
}catch(error){
  fail(`Preview helper discovery or matching client launch failed: ${String(error.stderr||error.message||error).trim()}`);
}finally{
  fs.rmSync(verificationRoot,{recursive:true,force:true});
}
if(!/Client:\s+Iceman\//.test(versionOutput)){
  fail('Preview helper returned no recognisable Iceman client identity.');
}

console.log('PM3 Preview runtime verification passed.');
console.log(`Helper source: ${helperSourcePath}`);
console.log(`Client: ${clientPath}`);
