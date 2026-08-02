const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const { execFileSync } = require('child_process');

const FINGERPRINT_VERSION=1;
const DEFAULT_MISMATCH_LIMIT=3;
const MAX_KNOWN_SIGNALS=24;

function unique(values){
  return [...new Set((values || []).filter(Boolean))];
}

function normaliseMac(value){
  const compact=String(value || '').toLowerCase().replace(/[^0-9a-f]/g,'');
  if(compact.length!==12 || compact==='000000000000') return '';
  return compact.match(/.{2}/g).join(':');
}

function readPlatformMachineId(){
  try{
    if(process.platform==='darwin'){
      const output=execFileSync('/usr/sbin/ioreg',['-rd1','-c','IOPlatformExpertDevice'],{
        encoding:'utf8',
        timeout:2500,
        stdio:['ignore','pipe','ignore']
      });
      return output.match(/"IOPlatformUUID"\s*=\s*"([^"]+)"/i)?.[1] || '';
    }
    if(process.platform==='linux'){
      for(const file of ['/etc/machine-id','/var/lib/dbus/machine-id']){
        if(fs.existsSync(file)){
          const value=fs.readFileSync(file,'utf8').trim();
          if(value) return value;
        }
      }
    }
    if(process.platform==='win32'){
      const output=execFileSync('reg',[
        'query',
        'HKLM\\SOFTWARE\\Microsoft\\Cryptography',
        '/v',
        'MachineGuid'
      ],{
        encoding:'utf8',
        timeout:2500,
        stdio:['ignore','pipe','ignore']
      });
      return output.match(/MachineGuid\s+REG_SZ\s+([^\r\n]+)/i)?.[1]?.trim() || '';
    }
  }catch{}
  return '';
}

function collectDeviceSignals(){
  const machineId=String(readPlatformMachineId() || '').trim().toLowerCase();
  const macAddresses=[];
  const interfaces=os.networkInterfaces() || {};
  Object.values(interfaces).flat().forEach(entry=>{
    if(!entry || entry.internal) return;
    const mac=normaliseMac(entry.mac);
    if(mac) macAddresses.push(mac);
  });
  return {
    platform:process.platform,
    machineIds:machineId ? [machineId] : [],
    macAddresses:unique(macAddresses)
  };
}

function hashSignal(salt,type,value){
  return crypto.createHmac('sha256',salt).update(`${type}:${value}`).digest('hex');
}

function hashSignals(signals,salt){
  const macAddresses=unique(signals?.macAddresses).map(normaliseMac).filter(Boolean);
  return {
    machineHashes:unique(signals?.machineIds).map(value=>hashSignal(salt,'machine',String(value).toLowerCase())),
    macHashes:macAddresses.map(value=>hashSignal(salt,'mac',value))
  };
}

function createBinding(signals,{salt='',nowMs=Date.now()}={}){
  const bindingSalt=salt || crypto.randomBytes(24).toString('base64url');
  const hashes=hashSignals(signals,bindingSalt);
  return {
    version:FINGERPRINT_VERSION,
    salt:bindingSalt,
    machineHashes:hashes.machineHashes.slice(0,MAX_KNOWN_SIGNALS),
    macHashes:hashes.macHashes.slice(0,MAX_KNOWN_SIGNALS),
    createdAt:new Date(nowMs).toISOString(),
    lastMatchedAt:'',
    mismatchCount:0,
    lastAssessment:'baseline'
  };
}

function overlaps(first,second){
  const known=new Set(first || []);
  return (second || []).some(value=>known.has(value));
}

function safeStatus(binding,state,matchedBy,mismatchLimit){
  const count=Math.max(0,Number(binding?.mismatchCount || 0));
  return {
    enabled:true,
    state,
    matchedBy,
    available:state!=='unavailable',
    blocked:state==='blocked',
    mismatchCount:count,
    mismatchLimit,
    attemptsRemaining:Math.max(0,mismatchLimit-count)
  };
}

function assessDeviceBinding(binding,signals,options={}){
  const nowMs=Number.isFinite(options.nowMs) ? options.nowMs : Date.now();
  const mismatchLimit=Math.max(1,Number(options.mismatchLimit || DEFAULT_MISMATCH_LIMIT));
  const observeMismatch=options.observeMismatch===true;
  let next=binding?.salt ? {...binding} : createBinding(signals,{nowMs});
  const current=hashSignals(signals,next.salt);
  const currentAvailable=current.machineHashes.length>0 || current.macHashes.length>0;
  const storedAvailable=(next.machineHashes || []).length>0 || (next.macHashes || []).length>0;

  if(!currentAvailable){
    next.lastAssessment='unavailable';
    return {binding:next,status:safeStatus(next,'unavailable','',mismatchLimit)};
  }
  if(!storedAvailable){
    next=createBinding(signals,{salt:next.salt,nowMs});
    return {binding:next,status:safeStatus(next,'baseline','baseline',mismatchLimit)};
  }

  const machineMatch=overlaps(next.machineHashes,current.machineHashes);
  const macMatch=overlaps(next.macHashes,current.macHashes);
  if(machineMatch || macMatch){
    next.machineHashes=unique([...(next.machineHashes || []),...current.machineHashes]).slice(-MAX_KNOWN_SIGNALS);
    next.macHashes=unique([...(next.macHashes || []),...current.macHashes]).slice(-MAX_KNOWN_SIGNALS);
    next.mismatchCount=0;
    next.lastMatchedAt=new Date(nowMs).toISOString();
    next.lastAssessment='matched';
    return {
      binding:next,
      status:safeStatus(next,'matched',machineMatch ? 'machine' : 'network',mismatchLimit)
    };
  }

  if(observeMismatch) next.mismatchCount=Math.max(0,Number(next.mismatchCount || 0))+1;
  const blocked=Number(next.mismatchCount || 0)>=mismatchLimit;
  next.lastAssessment=blocked ? 'blocked' : 'mismatch';
  next.lastMismatchAt=new Date(nowMs).toISOString();
  return {
    binding:next,
    status:safeStatus(next,blocked ? 'blocked' : 'mismatch','',mismatchLimit)
  };
}

function rebindDevice(signals,binding,options={}){
  return createBinding(signals,{
    salt:binding?.salt || '',
    nowMs:Number.isFinite(options.nowMs) ? options.nowMs : Date.now()
  });
}

module.exports={
  FINGERPRINT_VERSION,
  DEFAULT_MISMATCH_LIMIT,
  normaliseMac,
  collectDeviceSignals,
  createBinding,
  assessDeviceBinding,
  rebindDevice
};
