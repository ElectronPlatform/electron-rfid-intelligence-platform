const crypto = require('crypto');

const TOKEN_PREFIX='EPST1';
const TOKEN_SCHEMA_VERSION=1;
const TOKEN_PURPOSE='electron-preview-extension';
const DEFAULT_KEY_ID='electron-preview-2026-01';
const MAX_TOKEN_LENGTH=8192;
const CLOCK_SKEW_MS=5*60*1000;

const PUBLIC_KEYS=Object.freeze({
  [DEFAULT_KEY_ID]:`-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEAoA5qku5KBnnLGZ4hzzFbuZmj11hCSaKCLP8Hsrzw8DU=
-----END PUBLIC KEY-----`
});

function fail(code,message){
  return {ok:false,code,message};
}

function parseTime(value){
  const ms=Date.parse(String(value || ''));
  return Number.isFinite(ms) ? ms : 0;
}

function verifyPreviewExtensionToken(input, installationId, options={}){
  const token=String(input || '').trim();
  if(!token) return fail('TOKEN_REQUIRED','Enter a signed Preview Extension Token.');
  if(token.length>MAX_TOKEN_LENGTH) return fail('TOKEN_TOO_LONG','The Preview Extension Token is not valid.');

  const parts=token.split('.');
  if(parts.length!==3 || parts[0]!==TOKEN_PREFIX){
    return fail('TOKEN_FORMAT','The Preview Extension Token format is not valid.');
  }
  const [,payloadSegment,signatureSegment]=parts;
  if(!/^[A-Za-z0-9_-]+$/.test(payloadSegment) || !/^[A-Za-z0-9_-]+$/.test(signatureSegment)){
    return fail('TOKEN_FORMAT','The Preview Extension Token format is not valid.');
  }

  let payload;
  let signature;
  try{
    payload=JSON.parse(Buffer.from(payloadSegment,'base64url').toString('utf8'));
    signature=Buffer.from(signatureSegment,'base64url');
  }catch{
    return fail('TOKEN_PAYLOAD','The Preview Extension Token payload could not be read.');
  }
  if(!payload || typeof payload!=='object' || Array.isArray(payload)){
    return fail('TOKEN_PAYLOAD','The Preview Extension Token payload is not valid.');
  }
  if(payload.schemaVersion!==TOKEN_SCHEMA_VERSION || payload.purpose!==TOKEN_PURPOSE){
    return fail('TOKEN_PURPOSE','This token is not a supported Electron Preview Extension Token.');
  }
  if(!String(payload.tokenId || '').trim()){
    return fail('TOKEN_ID','The Preview Extension Token identifier is missing.');
  }

  const keyId=String(payload.keyId || '');
  const publicKeys=options.publicKeys || PUBLIC_KEYS;
  const publicKey=publicKeys[keyId];
  if(!publicKey) return fail('TOKEN_KEY','This Preview Extension Token uses an unknown signing key.');

  let signatureValid=false;
  try{
    signatureValid=crypto.verify(
      null,
      Buffer.from(payloadSegment,'utf8'),
      crypto.createPublicKey(publicKey),
      signature
    );
  }catch{
    signatureValid=false;
  }
  if(signature.length!==64 || !signatureValid){
    return fail('TOKEN_SIGNATURE','The Preview Extension Token signature is not valid.');
  }

  const expectedInstallationId=String(installationId || '').trim();
  if(!expectedInstallationId || String(payload.installationId || '').trim()!==expectedInstallationId){
    return fail('TOKEN_INSTALLATION','This Preview Extension Token belongs to a different Electron installation.');
  }

  const nowMs=Number.isFinite(options.nowMs) ? options.nowMs : Date.now();
  const issuedAtMs=parseTime(payload.issuedAt);
  if(!issuedAtMs || issuedAtMs>nowMs+CLOCK_SKEW_MS){
    return fail('TOKEN_ISSUED_AT','The Preview Extension Token issue date is not valid.');
  }

  const access=String(payload.access || '');
  const testerLevel=String(payload.testerLevel || 'Preview Tester');
  let expiresAt='';
  let type='days';
  if(access==='internal-unlimited'){
    if(testerLevel!=='Internal'){
      return fail('TOKEN_ACCESS','The internal Preview Extension Token is not valid.');
    }
    type='unlimited';
  }else if(access==='extension' || access==='device-rebind'){
    const expiresAtMs=parseTime(payload.expiresAt);
    if(!expiresAtMs || expiresAtMs<=issuedAtMs || expiresAtMs<=nowMs){
      return fail('TOKEN_EXPIRED','This Preview Extension Token has expired.');
    }
    expiresAt=new Date(expiresAtMs).toISOString();
    if(access==='device-rebind') type='device-rebind';
  }else{
    return fail('TOKEN_ACCESS','This token does not grant Electron Preview access.');
  }

  return {
    ok:true,
    payload,
    extension:{
      token,
      type,
      access,
      tokenId:String(payload.tokenId || ''),
      keyId,
      testerLevel,
      issuedAt:new Date(issuedAtMs).toISOString(),
      expiresAt
    }
  };
}

module.exports={
  TOKEN_PREFIX,
  TOKEN_SCHEMA_VERSION,
  TOKEN_PURPOSE,
  DEFAULT_KEY_ID,
  PUBLIC_KEYS,
  verifyPreviewExtensionToken
};
