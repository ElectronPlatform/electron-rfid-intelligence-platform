'use strict';

const COLLECTION_SCHEMA_VERSION_5=5;
const COLLECTION_SCHEMA_VERSION_6=6;
const SUPPORTED_COLLECTION_VERSIONS=Object.freeze([
  COLLECTION_SCHEMA_VERSION_5,
  COLLECTION_SCHEMA_VERSION_6
]);

function diagnostic(code,severity,path,message,details={}){
  return {code,severity,path,message,details};
}

function detectCollectionVersion(database){
  if(!database || typeof database!=='object' || Array.isArray(database)){
    return {
      kind:'invalid',
      version:null,
      supported:false,
      diagnostics:[diagnostic(
        'collection-root-type',
        'error',
        '$',
        'Collection database root must be a JSON object.'
      )]
    };
  }
  if(!Number.isInteger(database.version)){
    return {
      kind:'invalid',
      version:database.version ?? null,
      supported:false,
      diagnostics:[diagnostic(
        'collection-version-invalid',
        'error',
        '$.version',
        'Collection schema version must be an integer.',
        {value:database.version}
      )]
    };
  }
  if(database.version===COLLECTION_SCHEMA_VERSION_5){
    return {kind:'v5',version:5,supported:true,diagnostics:[]};
  }
  if(database.version===COLLECTION_SCHEMA_VERSION_6){
    return {kind:'v6',version:6,supported:true,diagnostics:[]};
  }
  return {
    kind:'unsupported',
    version:database.version,
    supported:false,
    diagnostics:[diagnostic(
      'collection-version-unsupported',
      'error',
      '$.version',
      `Collection schema version ${database.version} is not supported by this build.`,
      {supportedVersions:[...SUPPORTED_COLLECTION_VERSIONS]}
    )]
  };
}

function parseCollectionDatabase(input){
  let database=input;
  if(typeof input==='string'){
    try{
      database=JSON.parse(input);
    }catch(error){
      return {
        ok:false,
        database:null,
        version:null,
        kind:'invalid',
        diagnostics:[diagnostic(
          'collection-json-invalid',
          'error',
          '$',
          'Collection database is not valid JSON.',
          {error:error.message}
        )]
      };
    }
  }
  const detection=detectCollectionVersion(database);
  return {
    ok:detection.supported,
    database:detection.supported ? database : null,
    version:detection.version,
    kind:detection.kind,
    diagnostics:detection.diagnostics
  };
}

function serializeCollectionDatabase(database,{space=2}={}){
  const detection=detectCollectionVersion(database);
  if(!detection.supported){
    return {
      ok:false,
      json:null,
      version:detection.version,
      kind:detection.kind,
      diagnostics:detection.diagnostics
    };
  }
  try{
    return {
      ok:true,
      json:JSON.stringify(database,null,space),
      version:detection.version,
      kind:detection.kind,
      diagnostics:[]
    };
  }catch(error){
    return {
      ok:false,
      json:null,
      version:detection.version,
      kind:detection.kind,
      diagnostics:[diagnostic(
        'collection-serialization-failed',
        'error',
        '$',
        'Collection database could not be serialized as JSON.',
        {error:error.message}
      )]
    };
  }
}

module.exports={
  COLLECTION_SCHEMA_VERSION_5,
  COLLECTION_SCHEMA_VERSION_6,
  SUPPORTED_COLLECTION_VERSIONS,
  detectCollectionVersion,
  parseCollectionDatabase,
  serializeCollectionDatabase
};
