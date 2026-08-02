'use strict';

const {
  COLLECTION_SCHEMA_VERSION_5,
  COLLECTION_SCHEMA_VERSION_6,
  detectCollectionVersion
}=require('./collectionSchema');
const {
  validateRecordId
}=require('./collectionRecordId');

const V5_REQUIRED_TOP_LEVEL=Object.freeze(['version','settings','assets','log']);
const V6_REQUIRED_TOP_LEVEL=Object.freeze([
  'version',
  'settings',
  'assets',
  'log',
  'relationships',
  'identityDecisions',
  'migration'
]);
const V6_REQUIRED_ASSET_FIELDS=Object.freeze([
  'recordId',
  'assetId',
  'identitySchemaVersion',
  'previousAssetIds'
]);
const V6_REQUIRED_MIGRATION_FIELDS=Object.freeze([
  'migrationId',
  'sourceVersion',
  'completedVersion',
  'completedAt'
]);

function makeDiagnostic(code,severity,path,message,details={}){
  return {code,severity,path,message,details};
}

function hasOwn(value,key){
  return Object.prototype.hasOwnProperty.call(value,key);
}

function isObject(value){
  return !!value && typeof value==='object' && !Array.isArray(value);
}

function isNonEmptyString(value){
  return typeof value==='string' && value.trim().length>0;
}

function isIsoTimestamp(value){
  if(!isNonEmptyString(value)) return false;
  const time=Date.parse(value);
  return Number.isFinite(time) && new Date(time).toISOString()===value;
}

function isArchivedAsset(asset){
  return asset?.archived===true || /^archived$/i.test(String(asset?.status || '').trim());
}

function addMissingFields(value,required,path,diagnostics){
  required.forEach(field=>{
    if(!isObject(value) || !hasOwn(value,field)){
      diagnostics.push(makeDiagnostic(
        'required-field-missing',
        'error',
        `${path}.${field}`,
        `Required field "${field}" is missing.`
      ));
    }
  });
}

function validateTopLevel(database,version,diagnostics){
  const required=version===COLLECTION_SCHEMA_VERSION_6
    ? V6_REQUIRED_TOP_LEVEL
    : V5_REQUIRED_TOP_LEVEL;
  addMissingFields(database,required,'$',diagnostics);

  if(hasOwn(database,'settings') && !isObject(database.settings)){
    diagnostics.push(makeDiagnostic(
      'collection-settings-type',
      'error',
      '$.settings',
      'settings must be a JSON object.'
    ));
  }
  ['assets','log'].forEach(field=>{
    if(hasOwn(database,field) && !Array.isArray(database[field])){
      diagnostics.push(makeDiagnostic(
        `collection-${field}-type`,
        'error',
        `$.${field}`,
        `${field} must be an array.`
      ));
    }
  });
  if(version===COLLECTION_SCHEMA_VERSION_6){
    ['relationships','identityDecisions'].forEach(field=>{
      if(hasOwn(database,field) && !Array.isArray(database[field])){
        diagnostics.push(makeDiagnostic(
          `collection-${field}-type`,
          'error',
          `$.${field}`,
          `${field} must be an array.`
        ));
      }
    });
  }
}

function validateMigrationMetadata(database,diagnostics){
  if(!hasOwn(database,'migration')) return;
  if(!isObject(database.migration)){
    diagnostics.push(makeDiagnostic(
      'migration-metadata-type',
      'error',
      '$.migration',
      'Version 6 migration metadata must be a JSON object.'
    ));
    return;
  }
  addMissingFields(database.migration,V6_REQUIRED_MIGRATION_FIELDS,'$.migration',diagnostics);
  const migration=database.migration;
  if(hasOwn(migration,'migrationId') && !isNonEmptyString(migration.migrationId)){
    diagnostics.push(makeDiagnostic(
      'migration-id-invalid',
      'error',
      '$.migration.migrationId',
      'migrationId must be a non-empty string.'
    ));
  }
  if(hasOwn(migration,'sourceVersion') && migration.sourceVersion!==COLLECTION_SCHEMA_VERSION_5){
    diagnostics.push(makeDiagnostic(
      'migration-source-version-invalid',
      'error',
      '$.migration.sourceVersion',
      'The Version 6 identity migration contract requires sourceVersion 5.',
      {value:migration.sourceVersion}
    ));
  }
  if(hasOwn(migration,'completedVersion') && migration.completedVersion!==COLLECTION_SCHEMA_VERSION_6){
    diagnostics.push(makeDiagnostic(
      'migration-completed-version-invalid',
      'error',
      '$.migration.completedVersion',
      'Version 6 migration metadata must report completedVersion 6.',
      {value:migration.completedVersion}
    ));
  }
  if(hasOwn(migration,'completedAt') && !isIsoTimestamp(migration.completedAt)){
    diagnostics.push(makeDiagnostic(
      'migration-completed-at-invalid',
      'error',
      '$.migration.completedAt',
      'completedAt must be a canonical ISO 8601 UTC timestamp.',
      {value:migration.completedAt}
    ));
  }
}

function validateAsset(asset,index,version,diagnostics){
  const path=`$.assets[${index}]`;
  if(!isObject(asset)){
    diagnostics.push(makeDiagnostic(
      'collection-asset-type',
      'error',
      path,
      'Each Collection asset must be a JSON object.'
    ));
    return;
  }
  if(!isNonEmptyString(asset.assetId)){
    diagnostics.push(makeDiagnostic(
      'asset-id-required',
      'error',
      `${path}.assetId`,
      'Every Collection Record requires a non-empty user-visible assetId.'
    ));
  }
  if(version===COLLECTION_SCHEMA_VERSION_5){
    if(hasOwn(asset,'recordId')){
      diagnostics.push(makeDiagnostic(
        'record-id-in-version-5',
        'warning',
        `${path}.recordId`,
        'Version 5 does not own recordId; preserve the value but require review before migration.'
      ));
    }
    return;
  }

  addMissingFields(asset,V6_REQUIRED_ASSET_FIELDS,path,diagnostics);
  diagnostics.push(...validateRecordId(asset.recordId,{path:`${path}.recordId`}));
  if(hasOwn(asset,'identitySchemaVersion') && asset.identitySchemaVersion!==1){
    diagnostics.push(makeDiagnostic(
      'identity-schema-version-invalid',
      'error',
      `${path}.identitySchemaVersion`,
      'identitySchemaVersion must be 1 for the Version 6 identity contract.',
      {value:asset.identitySchemaVersion}
    ));
  }
  if(hasOwn(asset,'previousAssetIds')){
    if(!Array.isArray(asset.previousAssetIds)){
      diagnostics.push(makeDiagnostic(
        'previous-asset-ids-type',
        'error',
        `${path}.previousAssetIds`,
        'previousAssetIds must be an array of unique non-empty strings.'
      ));
    }else{
      const seen=new Set();
      asset.previousAssetIds.forEach((value,previousIndex)=>{
        const valuePath=`${path}.previousAssetIds[${previousIndex}]`;
        if(!isNonEmptyString(value)){
          diagnostics.push(makeDiagnostic(
            'previous-asset-id-invalid',
            'error',
            valuePath,
            'A previous assetId must be a non-empty string.'
          ));
          return;
        }
        if(value===asset.assetId){
          diagnostics.push(makeDiagnostic(
            'previous-asset-id-current',
            'error',
            valuePath,
            'The current assetId must not also appear in previousAssetIds.'
          ));
        }
        if(seen.has(value)){
          diagnostics.push(makeDiagnostic(
            'previous-asset-id-duplicate',
            'error',
            valuePath,
            'previousAssetIds must not contain duplicates.',
            {value}
          ));
        }
        seen.add(value);
      });
    }
  }
}

function normalizedIdentityValue(value){
  return String(value ?? '').trim();
}

function normalizedUid(asset){
  return normalizedIdentityValue(
    asset?.currentUid || asset?.uid || asset?.originalUid || ''
  ).toUpperCase().replace(/[^0-9A-F]/g,'');
}

function validateDuplicates(assets,version,diagnostics){
  const activeAssetIds=new Map();
  const archivedAssetIds=new Map();
  const recordIds=new Map();
  const uids=new Map();

  assets.forEach((asset,index)=>{
    if(!isObject(asset)) return;
    const assetId=normalizedIdentityValue(asset.assetId);
    if(assetId){
      const map=isArchivedAsset(asset) ? archivedAssetIds : activeAssetIds;
      if(!map.has(assetId)) map.set(assetId,[]);
      map.get(assetId).push(index);
    }
    const recordId=normalizedIdentityValue(asset.recordId);
    if(version===COLLECTION_SCHEMA_VERSION_6 && recordId){
      if(!recordIds.has(recordId)) recordIds.set(recordId,[]);
      recordIds.get(recordId).push(index);
    }
    const uid=normalizedUid(asset);
    if(uid){
      if(!uids.has(uid)) uids.set(uid,[]);
      uids.get(uid).push(index);
    }
  });

  activeAssetIds.forEach((indices,assetId)=>{
    if(indices.length>1){
      diagnostics.push(makeDiagnostic(
        'duplicate-active-asset-id',
        'error',
        '$.assets',
        `Active Collection Records share assetId "${assetId}".`,
        {assetId,indices}
      ));
    }
    const archivedIndices=archivedAssetIds.get(assetId) || [];
    if(archivedIndices.length){
      diagnostics.push(makeDiagnostic(
        'asset-id-reused-from-archive',
        'warning',
        '$.assets',
        `Active assetId "${assetId}" is also present on an archived record.`,
        {assetId,activeIndices:indices,archivedIndices}
      ));
    }
  });
  archivedAssetIds.forEach((indices,assetId)=>{
    if(indices.length>1){
      diagnostics.push(makeDiagnostic(
        'duplicate-archived-asset-id',
        'warning',
        '$.assets',
        `Archived Collection Records share historical assetId "${assetId}".`,
        {assetId,indices}
      ));
    }
  });
  recordIds.forEach((indices,recordId)=>{
    if(indices.length>1){
      diagnostics.push(makeDiagnostic(
        'duplicate-record-id',
        'error',
        '$.assets',
        `recordId "${recordId}" is assigned to more than one Collection Record.`,
        {recordId,indices}
      ));
    }
  });
  uids.forEach((indices,uid)=>{
    if(indices.length>1){
      diagnostics.push(makeDiagnostic(
        'duplicate-uid-evidence',
        'info',
        '$.assets',
        'Multiple Collection Records report the same UID. They remain distinct records and require no automatic merge.',
        {uid,indices}
      ));
    }
  });
}

function validateLegacyIdentityContext(context,diagnostics){
  if(!context) return;
  const signatures=Array.isArray(context.signatures) ? context.signatures : [];
  const links=Array.isArray(context.links) ? context.links : [];
  const linkedSignatureIds=new Set(
    links.map(link=>normalizedIdentityValue(link?.signatureId)).filter(Boolean)
  );
  signatures.forEach((signature,index)=>{
    const signatureId=normalizedIdentityValue(signature?.signatureId);
    if(!signatureId){
      diagnostics.push(makeDiagnostic(
        'legacy-signature-id-missing',
        'warning',
        `legacyIdentity.signatures[${index}].signatureId`,
        'Legacy signature is missing its signatureId and requires manual review.'
      ));
    }else if(!linkedSignatureIds.has(signatureId)){
      diagnostics.push(makeDiagnostic(
        'orphaned-legacy-signature',
        'info',
        `legacyIdentity.signatures[${index}]`,
        'Legacy signature has no accepted Collection link. It remains preserved and unfiled.',
        {signatureId}
      ));
    }
  });
}

function migrationReadiness(version,diagnostics){
  const blockers=diagnostics.filter(item=>item.severity==='error');
  const warnings=diagnostics.filter(item=>item.severity==='warning');
  if(blockers.length){
    return {
      status:'blocked',
      ready:false,
      blockers:blockers.map(item=>item.code),
      warnings:warnings.map(item=>item.code)
    };
  }
  if(version===COLLECTION_SCHEMA_VERSION_6){
    return {
      status:'not-required',
      ready:true,
      blockers:[],
      warnings:warnings.map(item=>item.code)
    };
  }
  return {
    status:'ready',
    ready:true,
    blockers:[],
    warnings:warnings.map(item=>item.code)
  };
}

function validateCollectionDatabase(database,{legacyIdentity=null}={}){
  const detection=detectCollectionVersion(database);
  const diagnostics=[...detection.diagnostics];
  if(!detection.supported){
    return {
      valid:false,
      version:detection.version,
      kind:detection.kind,
      diagnostics,
      counts:{assets:0,activeAssets:0,archivedAssets:0,errors:diagnostics.length,warnings:0,info:0},
      migrationReadiness:migrationReadiness(detection.version,diagnostics)
    };
  }

  validateTopLevel(database,detection.version,diagnostics);
  const assets=Array.isArray(database.assets) ? database.assets : [];
  assets.forEach((asset,index)=>validateAsset(asset,index,detection.version,diagnostics));
  validateDuplicates(assets,detection.version,diagnostics);
  if(detection.version===COLLECTION_SCHEMA_VERSION_6){
    validateMigrationMetadata(database,diagnostics);
  }
  validateLegacyIdentityContext(legacyIdentity,diagnostics);

  const errors=diagnostics.filter(item=>item.severity==='error').length;
  const warnings=diagnostics.filter(item=>item.severity==='warning').length;
  const info=diagnostics.filter(item=>item.severity==='info').length;
  return {
    valid:errors===0,
    version:detection.version,
    kind:detection.kind,
    diagnostics,
    counts:{
      assets:assets.length,
      activeAssets:assets.filter(asset=>!isArchivedAsset(asset)).length,
      archivedAssets:assets.filter(isArchivedAsset).length,
      errors,
      warnings,
      info
    },
    migrationReadiness:migrationReadiness(detection.version,diagnostics)
  };
}

module.exports={
  V5_REQUIRED_TOP_LEVEL,
  V6_REQUIRED_TOP_LEVEL,
  V6_REQUIRED_ASSET_FIELDS,
  V6_REQUIRED_MIGRATION_FIELDS,
  isArchivedAsset,
  validateCollectionDatabase
};
