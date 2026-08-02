'use strict';

const crypto=require('crypto');

const RECORD_ID_PREFIX='rec_';
const UUID_V4_PATTERN=/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const RECORD_ID_PATTERN=new RegExp(`^${RECORD_ID_PREFIX}${UUID_V4_PATTERN.source.slice(1)}`);

function diagnostic(code,message,path='recordId',details={}){
  return {code,severity:'error',path,message,details};
}

function validateRecordId(value,{path='recordId',required=true}={}){
  const diagnostics=[];
  if(value===undefined || value===null || value===''){
    if(required){
      diagnostics.push(diagnostic(
        'record-id-required',
        'A Version 6 Collection Record requires an immutable recordId.',
        path
      ));
    }
    return diagnostics;
  }
  if(typeof value!=='string'){
    diagnostics.push(diagnostic(
      'record-id-type',
      'recordId must be a canonical string.',
      path,
      {actualType:typeof value}
    ));
    return diagnostics;
  }
  if(!value.startsWith(RECORD_ID_PREFIX)){
    diagnostics.push(diagnostic(
      'record-id-prefix',
      `recordId must start with "${RECORD_ID_PREFIX}".`,
      path
    ));
    return diagnostics;
  }
  const uuid=value.slice(RECORD_ID_PREFIX.length);
  if(!UUID_V4_PATTERN.test(uuid)){
    diagnostics.push(diagnostic(
      'record-id-format',
      'recordId must contain a canonical lowercase RFC 4122 UUID version 4.',
      path,
      {value}
    ));
  }
  return diagnostics;
}

function isValidRecordId(value){
  return validateRecordId(value).length===0;
}

function parseRecordId(value,{path='recordId'}={}){
  const diagnostics=validateRecordId(value,{path});
  if(diagnostics.length){
    return {ok:false,value:null,prefix:null,uuid:null,uuidVersion:null,diagnostics};
  }
  return {
    ok:true,
    value,
    prefix:RECORD_ID_PREFIX,
    uuid:value.slice(RECORD_ID_PREFIX.length),
    uuidVersion:4,
    diagnostics:[]
  };
}

function serializeRecordId(value,{path='recordId'}={}){
  const parsed=parseRecordId(value,{path});
  return parsed.ok
    ? {ok:true,value:parsed.value,diagnostics:[]}
    : {ok:false,value:null,diagnostics:parsed.diagnostics};
}

function compareRecordIds(left,right){
  const leftParsed=parseRecordId(left,{path:'leftRecordId'});
  const rightParsed=parseRecordId(right,{path:'rightRecordId'});
  const diagnostics=[...leftParsed.diagnostics,...rightParsed.diagnostics];
  if(diagnostics.length){
    return {ok:false,equal:false,order:null,diagnostics};
  }
  return {
    ok:true,
    equal:left===right,
    order:left===right ? 0 : (left<right ? -1 : 1),
    diagnostics:[]
  };
}

function recordIdsEqual(left,right){
  return isValidRecordId(left) && isValidRecordId(right) && left===right;
}

function generateRecordId({randomUUID=crypto.randomUUID}={}){
  if(typeof randomUUID!=='function'){
    throw new TypeError('recordId generation requires a cryptographically strong UUID source.');
  }
  const recordId=`${RECORD_ID_PREFIX}${String(randomUUID()).toLowerCase()}`;
  const diagnostics=validateRecordId(recordId);
  if(diagnostics.length){
    const error=new Error('The UUID source did not produce a canonical RFC 4122 UUID version 4.');
    error.code='record-id-generation-invalid';
    error.diagnostics=diagnostics;
    throw error;
  }
  return recordId;
}

function validateRecordIdTransition(previousRecordId,nextRecordId,{
  path='recordId',
  allowInitialAssignment=false
}={}){
  const diagnostics=[];
  const previousMissing=previousRecordId===undefined || previousRecordId===null || previousRecordId==='';
  const nextMissing=nextRecordId===undefined || nextRecordId===null || nextRecordId==='';

  if(previousMissing && nextMissing) return diagnostics;

  if(previousMissing){
    diagnostics.push(...validateRecordId(nextRecordId,{path}));
    if(!allowInitialAssignment && diagnostics.length===0){
      diagnostics.push(diagnostic(
        'record-id-assignment-not-authorized',
        'recordId may only be assigned by the controlled identity migration or Collection Service creation path.',
        path
      ));
    }
    return diagnostics;
  }

  diagnostics.push(...validateRecordId(previousRecordId,{path:`previous.${path}`}));
  if(nextMissing){
    diagnostics.push(diagnostic(
      'record-id-removed',
      'An assigned recordId is immutable and cannot be removed.',
      path,
      {previousRecordId}
    ));
    return diagnostics;
  }
  diagnostics.push(...validateRecordId(nextRecordId,{path}));
  if(previousRecordId!==nextRecordId){
    diagnostics.push(diagnostic(
      'record-id-changed',
      'An assigned recordId is immutable and cannot be changed.',
      path,
      {previousRecordId,nextRecordId}
    ));
  }
  return diagnostics;
}

module.exports={
  RECORD_ID_PREFIX,
  UUID_V4_PATTERN,
  RECORD_ID_PATTERN,
  validateRecordId,
  isValidRecordId,
  parseRecordId,
  serializeRecordId,
  compareRecordIds,
  recordIdsEqual,
  generateRecordId,
  validateRecordIdTransition
};
