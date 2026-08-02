'use strict';

const fs=require('fs');
const path=require('path');
const {isDeepStrictEqual}=require('util');
const {
  parseCollectionDatabase,
  serializeCollectionDatabase
}=require('./collectionSchema');
const {
  validateCollectionDatabase,
  isArchivedAsset
}=require('./collectionValidation');
const {
  generateRecordId,
  isValidRecordId
}=require('./collectionRecordId');
const {
  sha256,
  jsonBytes,
  ensureDirectory,
  atomicWriteBytes,
  atomicWriteJson,
  readFileDescriptor,
  readJson,
  listDirectories
}=require('./collectionMigrationArtifacts');

const MIGRATION_IMPLEMENTATION_VERSION='collection-stable-id-v1';
const TRANSACTION_STATES=Object.freeze([
  'not-started',
  'preflight-ready',
  'backup-verified',
  'mapping-generated',
  'output-validated',
  'first-copy-written',
  'partial-roll-forward',
  'both-copies-verified',
  'complete',
  'failed-before-write',
  'blocked'
]);
const TERMINAL_STATES=new Set(['complete','blocked']);
const RESERVED_V6_ROOT_FIELDS=Object.freeze(['relationships','identityDecisions','migration']);
const RESERVED_IDENTITY_FIELDS=Object.freeze(['recordId','identitySchemaVersion','previousAssetIds']);

function clone(value){
  return value===undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function diagnostic(code,severity,pathValue,message,details={}){
  return {code,severity,path:pathValue,message,details};
}

function canonicalTimestamp(now){
  const value=now();
  const date=value instanceof Date ? value : new Date(value);
  const timestamp=date.toISOString();
  if(new Date(timestamp).toISOString()!==timestamp){
    throw new Error('Migration clock did not produce a canonical UTC timestamp.');
  }
  return timestamp;
}

function databaseFromBytes(descriptor){
  if(!descriptor) return {...descriptor,ok:false,database:null,validation:null,error:null};
  try{
    const parsed=parseCollectionDatabase(descriptor.bytes.toString('utf8'));
    const validation=parsed.ok ? validateCollectionDatabase(parsed.database) : null;
    return {
      ...descriptor,
      ok:parsed.ok && !!validation?.valid,
      database:parsed.database,
      parsed,
      validation,
      error:null
    };
  }catch(error){
    return {...descriptor,ok:false,database:null,validation:null,error};
  }
}

function chooseAuthoritative(candidates){
  const documents=candidates.find(item=>item.role==='documents') || null;
  const cache=candidates.find(item=>item.role==='cache') || null;
  const usable=candidates.filter(item=>item.parsed?.ok);
  if(!usable.length) return {selected:null,reason:'no-valid-copy',mixedVersions:false};
  if(usable.length===1){
    return {selected:usable[0],reason:`only-readable-${usable[0].role}`,mixedVersions:false};
  }
  const versions=new Set(usable.map(item=>item.validation.version));
  if(versions.size>1){
    const v6=usable.find(item=>item.validation.version===6);
    return {
      selected:v6 || usable[0],
      reason:v6 ? 'identity-capable-copy-preferred' : 'mixed-version-review',
      mixedVersions:true
    };
  }
  if(cache?.parsed?.ok && (!documents?.parsed?.ok || cache.mtimeMs>documents.mtimeMs+1000)){
    return {selected:cache,reason:'newer-cache',mixedVersions:false};
  }
  return {selected:documents?.parsed?.ok ? documents : usable[0],reason:'documents-primary',mixedVersions:false};
}

function fileSummary(candidate){
  if(!candidate){
    return {exists:false,readable:false,path:'',role:'',size:0,sha256:'',version:null,valid:false};
  }
  return {
    exists:true,
    readable:!candidate.error,
    path:candidate.path,
    role:candidate.role,
    size:candidate.size,
    sha256:candidate.sha256,
    mtimeMs:candidate.mtimeMs,
    version:candidate.validation?.version ?? candidate.parsed?.version ?? null,
    valid:candidate.ok
  };
}

function createCollectionMigrationService({
  getLocations,
  recoveryRoot,
  applicationVersion='unknown',
  buildVersion='unknown',
  now=()=>new Date(),
  randomUUID,
  beforeReplace=null
}={}){
  if(typeof getLocations!=='function'){
    throw new TypeError('Collection migration requires a database-location provider.');
  }
  if(typeof recoveryRoot!=='string' || !recoveryRoot.trim()){
    throw new TypeError('Collection migration requires a recovery-bundle root.');
  }

  const uuidSource=typeof randomUUID==='function' ? randomUUID : undefined;
  let running=false;

  function locations(){
    const value=getLocations() || {};
    const output=[
      {role:'documents',path:String(value.documentsPath || '')},
      {role:'cache',path:String(value.cachePath || '')}
    ].filter(item=>item.path);
    if(output.length!==2 || new Set(output.map(item=>path.resolve(item.path))).size!==2){
      throw new Error('Collection migration requires distinct Documents and cache database paths.');
    }
    return output;
  }

  function transactionRoot(){
    return path.join(recoveryRoot,'Collection Identity Migrations');
  }

  function statePath(directory){
    return path.join(directory,'state.json');
  }

  function writeState(directory,state){
    state.updatedAt=canonicalTimestamp(now);
    atomicWriteJson(statePath(directory),state);
    return state;
  }

  function transactionStates(){
    return listDirectories(transactionRoot()).map(directory=>{
      try{
        const state=readJson(statePath(directory));
        return {...state,directory};
      }catch{
        return null;
      }
    }).filter(Boolean);
  }

  function matchingTransaction({sourceChecksum='',includeComplete=false}={}){
    return transactionStates()
      .filter(state=>(includeComplete || !TERMINAL_STATES.has(state.state)) && (!sourceChecksum || state.sourceChecksum===sourceChecksum))
      .sort((left,right)=>String(right.updatedAt || '').localeCompare(String(left.updatedAt || '')))[0] || null;
  }

  function activeResumableTransaction(){
    const currentPaths=new Set(locations().map(item=>path.resolve(item.path)));
    return transactionStates()
      .filter(state=>!TERMINAL_STATES.has(state.state))
      .filter(state=>Array.isArray(state.targets) && state.targets.every(target=>currentPaths.has(path.resolve(target.path))))
      .sort((left,right)=>String(right.updatedAt || '').localeCompare(String(left.updatedAt || '')))[0] || null;
  }

  function inspectCopies(){
    return locations().map(location=>{
      try{
        const descriptor=readFileDescriptor(location.path);
        return descriptor
          ? {...databaseFromBytes(descriptor),role:location.role}
          : {role:location.role,path:location.path,ok:false,missing:true,error:null};
      }catch(error){
        return {role:location.role,path:location.path,ok:false,missing:false,error};
      }
    });
  }

  function preflight({ignoreProcessLock=false}={}){
    const diagnostics=[];
    if(running && !ignoreProcessLock){
      diagnostics.push(diagnostic(
        'migration-already-running',
        'error',
        '$',
        'A Collection identity migration is already running in this process.'
      ));
    }

    let destinationWritable=true;
    try{
      ensureDirectory(transactionRoot());
    }catch(error){
      destinationWritable=false;
      diagnostics.push(diagnostic(
        'migration-backup-destination-unwritable',
        'error',
        '$.recoveryRoot',
        'The Collection migration recovery destination is not writable.',
        {path:transactionRoot(),error:error.message}
      ));
    }

    let copies=[];
    try{
      copies=inspectCopies();
    }catch(error){
      diagnostics.push(diagnostic(
        'migration-location-inspection-failed',
        'error',
        '$.databaseCopies',
        'Collection database locations could not be inspected.',
        {error:error.message}
      ));
    }
    copies.forEach(copy=>{
      if(copy.missing){
        diagnostics.push(diagnostic(
          'migration-database-copy-missing',
          'warning',
          `$.databaseCopies.${copy.role}`,
          `The ${copy.role} Collection database copy does not exist and will be created during activation.`,
          {path:copy.path}
        ));
      }else if(!copy.ok){
        diagnostics.push(diagnostic(
          'migration-database-copy-invalid',
          'error',
          `$.databaseCopies.${copy.role}`,
          `The ${copy.role} Collection database copy is unreadable or invalid.`,
          {path:copy.path,error:copy.error?.message || '',diagnostics:copy.parsed?.diagnostics || copy.validation?.diagnostics || []}
        ));
      }
    });

    const decision=chooseAuthoritative(copies);
    const selected=decision.selected;
    if(!selected){
      diagnostics.push(diagnostic(
        'migration-no-authoritative-source',
        'error',
        '$.databaseCopies',
        'No valid authoritative Collection database copy is available.'
      ));
    }
    if(decision.mixedVersions){
      diagnostics.push(diagnostic(
        'migration-mixed-schema-copies',
        'warning',
        '$.databaseCopies',
        'The active database copies use different schema versions. The valid Version 6 copy remains authoritative and no automatic reconciliation is performed.',
        {copies:copies.map(fileSummary)}
      ));
    }

    const source=selected?.database || null;
    const validation=source ? validateCollectionDatabase(source) : null;
    if(validation) diagnostics.push(...validation.diagnostics);

    if(source?.version===5){
      RESERVED_V6_ROOT_FIELDS.forEach(field=>{
        if(Object.prototype.hasOwnProperty.call(source,field)){
          diagnostics.push(diagnostic(
            'migration-reserved-root-field-in-v5',
            'error',
            `$.${field}`,
            `Version 5 contains reserved Version 6 field "${field}" and requires review before migration.`
          ));
        }
      });
      (Array.isArray(source.assets) ? source.assets : []).forEach((asset,index)=>{
        RESERVED_IDENTITY_FIELDS.forEach(field=>{
          if(Object.prototype.hasOwnProperty.call(asset || {},field)){
            diagnostics.push(diagnostic(
              'migration-reserved-identity-field-in-v5',
              'error',
              `$.assets[${index}].${field}`,
              `Version 5 contains reserved identity field "${field}" and requires review before migration.`
            ));
          }
        });
      });
    }

    if(source){
      const serialized=serializeCollectionDatabase(source,{space:2});
      const reparsed=serialized.ok ? parseCollectionDatabase(serialized.json) : null;
      if(!serialized.ok || !reparsed?.ok || !isDeepStrictEqual(source,reparsed.database)){
        diagnostics.push(diagnostic(
          'migration-source-roundtrip-failed',
          'error',
          '$',
          'The authoritative Collection cannot be serialized and read back without changing data.',
          {serializationDiagnostics:serialized.diagnostics || [],parseDiagnostics:reparsed?.diagnostics || []}
        ));
      }
    }

    const errors=diagnostics.filter(item=>item.severity==='error');
    const duplicateUids=(validation?.diagnostics || [])
      .filter(item=>item.code==='duplicate-uid-evidence')
      .map(item=>item.details);
    const duplicateAssetIds=(validation?.diagnostics || [])
      .filter(item=>item.code==='duplicate-active-asset-id')
      .map(item=>item.details);
    const notRequired=!!source && source.version===6 && validation?.valid;
    const ready=!!source && source.version===5 && validation?.valid && !errors.length && destinationWritable;
    const resumable=activeResumableTransaction();

    return {
      ok:ready || notRequired,
      status:notRequired ? 'not-required' : (ready ? 'ready' : 'blocked'),
      sourceVersion:source?.version ?? null,
      sourceChecksum:selected?.sha256 || '',
      authoritativeRole:selected?.role || '',
      authoritativePath:selected?.path || '',
      authoritativeDecision:decision.reason,
      database:source ? clone(source) : null,
      sourceBytes:selected?.bytes ? Buffer.from(selected.bytes) : null,
      counts:{
        assets:validation?.counts?.assets || 0,
        active:validation?.counts?.activeAssets || 0,
        archived:validation?.counts?.archivedAssets || 0,
        log:Array.isArray(source?.log) ? source.log.length : 0
      },
      duplicateUids,
      duplicateAssetIds,
      databaseCopies:copies.map(fileSummary),
      recoveryRoot:transactionRoot(),
      destinationWritable,
      resumableMigrationId:resumable?.migrationId || '',
      diagnostics,
      blockers:errors.map(item=>item.code),
      warnings:diagnostics.filter(item=>item.severity==='warning').map(item=>item.code),
      informational:diagnostics.filter(item=>item.severity==='info').map(item=>item.code)
    };
  }

  function newMigrationIdentity(){
    const uuid=uuidSource ? uuidSource() : undefined;
    const recordId=generateRecordId(uuidSource ? {randomUUID:()=>uuid} : {});
    return {
      migrationId:`migration_${recordId.slice('rec_'.length)}`,
      uuid
    };
  }

  function nextUniqueRecordId(seen){
    let recordId='';
    do{
      recordId=generateRecordId(uuidSource ? {randomUUID:uuidSource} : {});
    }while(seen.has(recordId));
    seen.add(recordId);
    return recordId;
  }

  function recordFingerprint(record){
    return sha256(jsonBytes(record));
  }

  function buildMapping(database){
    const seen=new Set();
    return database.assets.map((record,index)=>({
      sourceIndex:index,
      assetId:record.assetId,
      sourceRecordSha256:recordFingerprint(record),
      recordId:nextUniqueRecordId(seen)
    }));
  }

  function transform(database,mapping,migrationId,completedAt){
    const candidate=clone(database);
    candidate.version=6;
    candidate.assets=candidate.assets.map((record,index)=>({
      ...record,
      recordId:mapping[index].recordId,
      identitySchemaVersion:1,
      previousAssetIds:[]
    }));
    candidate.relationships=[];
    candidate.identityDecisions=[];
    candidate.migration={
      migrationId,
      sourceVersion:5,
      completedVersion:6,
      completedAt
    };
    return candidate;
  }

  function validateTransformation(source,candidate,mapping){
    const diagnostics=[];
    const validation=validateCollectionDatabase(candidate);
    diagnostics.push(...validation.diagnostics);

    if(candidate.assets.length!==source.assets.length){
      diagnostics.push(diagnostic(
        'migration-asset-count-changed',
        'error',
        '$.assets',
        'Migration changed the number of Collection Records.',
        {before:source.assets.length,after:candidate.assets.length}
      ));
    }
    if(candidate.log.length!==source.log.length || !isDeepStrictEqual(candidate.log,source.log)){
      diagnostics.push(diagnostic(
        'migration-log-changed',
        'error',
        '$.log',
        'Migration changed the legacy Collection log.'
      ));
    }
    if(!isDeepStrictEqual(candidate.settings,source.settings)){
      diagnostics.push(diagnostic(
        'migration-settings-changed',
        'error',
        '$.settings',
        'Migration changed Collection settings.'
      ));
    }

    const sourceRoot=clone(source);
    const candidateRoot=clone(candidate);
    delete sourceRoot.version;
    delete candidateRoot.version;
    delete sourceRoot.assets;
    delete candidateRoot.assets;
    RESERVED_V6_ROOT_FIELDS.forEach(field=>delete candidateRoot[field]);
    if(!isDeepStrictEqual(candidateRoot,sourceRoot)){
      diagnostics.push(diagnostic(
        'migration-root-field-loss',
        'error',
        '$',
        'Migration did not preserve all existing root fields.'
      ));
    }

    source.assets.forEach((record,index)=>{
      const next=clone(candidate.assets[index]);
      RESERVED_IDENTITY_FIELDS.forEach(field=>delete next[field]);
      if(!isDeepStrictEqual(next,record)){
        diagnostics.push(diagnostic(
          'migration-asset-field-loss',
          'error',
          `$.assets[${index}]`,
          'Migration did not preserve every existing Collection Record field.',
          {assetId:record.assetId}
        ));
      }
      const mappingEntry=mapping[index];
      if(
        !mappingEntry ||
        mappingEntry.sourceIndex!==index ||
        mappingEntry.assetId!==record.assetId ||
        mappingEntry.sourceRecordSha256!==recordFingerprint(record) ||
        mappingEntry.recordId!==candidate.assets[index].recordId
      ){
        diagnostics.push(diagnostic(
          'migration-mapping-mismatch',
          'error',
          `$.mapping[${index}]`,
          'The stored migration mapping does not identify exactly one source record.',
          {assetId:record.assetId}
        ));
      }
    });

    const ids=mapping.map(entry=>entry.recordId);
    if(ids.some(value=>!isValidRecordId(value)) || new Set(ids).size!==ids.length){
      diagnostics.push(diagnostic(
        'migration-record-id-set-invalid',
        'error',
        '$.mapping',
        'Migration mapping contains malformed or duplicate recordIds.'
      ));
    }

    const outputBytes=jsonBytes(candidate);
    const reparsed=parseCollectionDatabase(outputBytes.toString('utf8'));
    const roundtripValidation=reparsed.ok ? validateCollectionDatabase(reparsed.database) : null;
    if(
      !reparsed.ok ||
      !roundtripValidation?.valid ||
      !isDeepStrictEqual(candidate,reparsed.database)
    ){
      diagnostics.push(diagnostic(
        'migration-output-roundtrip-failed',
        'error',
        '$',
        'The Version 6 candidate did not survive serialize/read/validate round-trip equality.',
        {parseDiagnostics:reparsed.diagnostics || [],validationDiagnostics:roundtripValidation?.diagnostics || []}
      ));
    }

    return {
      valid:validation.valid && diagnostics.every(item=>item.severity!=='error'),
      diagnostics,
      outputBytes,
      outputChecksum:sha256(outputBytes)
    };
  }

  function manifestFor(state,preflightResult,artifacts){
    return {
      format:'electron-collection-migration-recovery-v1',
      migrationId:state.migrationId,
      migrationImplementationVersion:MIGRATION_IMPLEMENTATION_VERSION,
      applicationVersion,
      buildVersion,
      createdAt:state.createdAt,
      sourceSchemaVersion:5,
      sourceChecksum:state.sourceChecksum,
      sourceFilePaths:preflightResult.databaseCopies.map(copy=>copy.path),
      sourceFiles:artifacts,
      assetCount:preflightResult.counts.assets,
      logCount:preflightResult.counts.log,
      authoritativeRole:preflightResult.authoritativeRole,
      authoritativePath:preflightResult.authoritativePath,
      authoritativeDecision:preflightResult.authoritativeDecision,
      preflightDiagnostics:preflightResult.diagnostics,
      outputChecksum:state.outputChecksum || '',
      state:state.state
    };
  }

  function updateManifest(directory,state){
    const manifestFile=path.join(directory,'manifest.json');
    if(!fs.existsSync(manifestFile)) return;
    const manifest=readJson(manifestFile);
    manifest.outputChecksum=state.outputChecksum || manifest.outputChecksum || '';
    manifest.state=state.state;
    manifest.completedAt=state.state==='complete' ? state.updatedAt : '';
    manifest.mappingFile='record-id-mapping.json';
    manifest.preparedOutputFile='prepared-v6-output.json';
    manifest.migrationReportFile='migration-report.json';
    atomicWriteJson(manifestFile,manifest);
  }

  function prepare(preflightResult){
    const identity=newMigrationIdentity();
    const createdAt=canonicalTimestamp(now);
    const directory=path.join(transactionRoot(),identity.migrationId);
    ensureDirectory(directory);
    const targetList=locations();
    const state={
      format:'electron-collection-migration-state-v1',
      migrationId:identity.migrationId,
      implementationVersion:MIGRATION_IMPLEMENTATION_VERSION,
      state:'preflight-ready',
      createdAt,
      updatedAt:createdAt,
      sourceChecksum:preflightResult.sourceChecksum,
      sourceVersion:5,
      authoritativeRole:preflightResult.authoritativeRole,
      authoritativePath:preflightResult.authoritativePath,
      outputChecksum:'',
      targets:targetList.map((target,index)=>({
        role:target.role,
        path:target.path,
        order:index,
        verified:false,
        checksum:'',
        lastError:''
      })),
      diagnostics:preflightResult.diagnostics
    };
    writeState(directory,state);

    const artifacts=[];
    const authoritativeName='source-authoritative-v5.json';
    const authoritativePath=path.join(directory,authoritativeName);
    atomicWriteBytes(authoritativePath,preflightResult.sourceBytes);
    const authoritativeBackup=readFileDescriptor(authoritativePath);
    if(authoritativeBackup.sha256!==preflightResult.sourceChecksum){
      throw new Error('Authoritative Version 5 recovery backup checksum verification failed.');
    }
    const restored=parseCollectionDatabase(authoritativeBackup.bytes.toString('utf8'));
    if(!restored.ok || !isDeepStrictEqual(restored.database,preflightResult.database)){
      throw new Error('Authoritative Version 5 recovery backup could not be reopened exactly.');
    }
    artifacts.push({
      role:'authoritative-v5',
      originalPath:preflightResult.authoritativePath,
      bundlePath:authoritativeName,
      size:authoritativeBackup.size,
      sha256:authoritativeBackup.sha256
    });

    preflightResult.databaseCopies.forEach(copy=>{
      if(!copy.exists || copy.path===preflightResult.authoritativePath || copy.sha256===preflightResult.sourceChecksum) return;
      const original=readFileDescriptor(copy.path);
      if(!original) return;
      const name=`source-secondary-${copy.role}-v5.json`;
      atomicWriteBytes(path.join(directory,name),original.bytes);
      const saved=readFileDescriptor(path.join(directory,name));
      if(saved.sha256!==copy.sha256) throw new Error(`Secondary ${copy.role} recovery backup checksum verification failed.`);
      artifacts.push({
        role:`secondary-${copy.role}`,
        originalPath:copy.path,
        bundlePath:name,
        size:saved.size,
        sha256:saved.sha256
      });
    });

    state.state='backup-verified';
    writeState(directory,state);
    atomicWriteJson(path.join(directory,'manifest.json'),manifestFor(state,preflightResult,artifacts));
    atomicWriteBytes(path.join(directory,'RECOVERY_README.txt'),Buffer.from(
      [
        'Electron Collection Stable-ID Migration Recovery Bundle',
        '',
        `Migration: ${state.migrationId}`,
        `Created: ${createdAt}`,
        `Source schema: Version 5`,
        `Authoritative source: ${preflightResult.authoritativePath}`,
        `Source SHA-256: ${preflightResult.sourceChecksum}`,
        '',
        'The source-authoritative-v5.json file contains the exact untouched source bytes.',
        'Verify its checksum against manifest.json before any manual recovery.',
        'Restore only through an explicit recovery decision; opening Electron never rolls back or migrates automatically.',
        ''
      ].join('\n'),
      'utf8'
    ));

    const mapping=buildMapping(preflightResult.database);
    atomicWriteJson(path.join(directory,'record-id-mapping.json'),{
      migrationId:state.migrationId,
      sourceChecksum:state.sourceChecksum,
      generatedAt:createdAt,
      entries:mapping
    });
    state.state='mapping-generated';
    writeState(directory,state);

    const candidate=transform(preflightResult.database,mapping,state.migrationId,createdAt);
    const checked=validateTransformation(preflightResult.database,candidate,mapping);
    state.diagnostics=[...state.diagnostics,...checked.diagnostics];
    if(!checked.valid){
      state.state='failed-before-write';
      writeState(directory,state);
      updateManifest(directory,state);
      atomicWriteJson(path.join(directory,'migration-report.json'),{
        migrationId:state.migrationId,
        state:state.state,
        activated:false,
        diagnostics:state.diagnostics
      });
      return {ok:false,status:state.state,state,directory,diagnostics:state.diagnostics};
    }

    atomicWriteBytes(path.join(directory,'prepared-v6-output.json'),checked.outputBytes);
    const prepared=readFileDescriptor(path.join(directory,'prepared-v6-output.json'));
    if(prepared.sha256!==checked.outputChecksum){
      throw new Error('Prepared Version 6 output checksum verification failed.');
    }
    state.outputChecksum=checked.outputChecksum;
    state.state='output-validated';
    writeState(directory,state);
    updateManifest(directory,state);
    atomicWriteJson(path.join(directory,'migration-report.json'),{
      migrationId:state.migrationId,
      state:state.state,
      sourceChecksum:state.sourceChecksum,
      outputChecksum:state.outputChecksum,
      mappingCount:mapping.length,
      assetCount:candidate.assets.length,
      logCount:candidate.log.length,
      activated:false,
      diagnostics:state.diagnostics
    });
    return {ok:true,status:state.state,state,directory,diagnostics:state.diagnostics};
  }

  function validatePreparedBytes(bytes,expectedChecksum){
    if(sha256(bytes)!==expectedChecksum) return false;
    const parsed=parseCollectionDatabase(bytes.toString('utf8'));
    if(!parsed.ok) return false;
    return validateCollectionDatabase(parsed.database).valid;
  }

  function resumePreparation(transaction){
    const directory=transaction.directory;
    const state=readJson(statePath(directory));
    const sourceFile=readFileDescriptor(path.join(directory,'source-authoritative-v5.json'));
    if(!sourceFile || sourceFile.sha256!==state.sourceChecksum){
      state.state='failed-before-write';
      state.diagnostics.push(diagnostic(
        'migration-recovery-source-invalid',
        'error',
        '$.recoverySource',
        'Migration preparation cannot resume because the exact Version 5 recovery source failed checksum verification.'
      ));
      writeState(directory,state);
      updateManifest(directory,state);
      return {ok:false,status:state.state,state,directory,diagnostics:state.diagnostics};
    }
    const parsed=parseCollectionDatabase(sourceFile.bytes.toString('utf8'));
    const validation=parsed.ok ? validateCollectionDatabase(parsed.database) : null;
    if(!parsed.ok || !validation?.valid || parsed.database.version!==5){
      state.state='failed-before-write';
      state.diagnostics.push(diagnostic(
        'migration-recovery-source-invalid',
        'error',
        '$.recoverySource',
        'Migration preparation cannot resume because the recovery source is not a valid Version 5 Collection.'
      ));
      writeState(directory,state);
      updateManifest(directory,state);
      return {ok:false,status:state.state,state,directory,diagnostics:state.diagnostics};
    }

    const mappingPath=path.join(directory,'record-id-mapping.json');
    let mappingEnvelope=null;
    if(fs.existsSync(mappingPath)){
      mappingEnvelope=readJson(mappingPath);
    }else{
      const mapping=buildMapping(parsed.database);
      mappingEnvelope={
        migrationId:state.migrationId,
        sourceChecksum:state.sourceChecksum,
        generatedAt:state.createdAt,
        entries:mapping
      };
      atomicWriteJson(mappingPath,mappingEnvelope);
      state.state='mapping-generated';
      writeState(directory,state);
    }
    if(
      mappingEnvelope.migrationId!==state.migrationId ||
      mappingEnvelope.sourceChecksum!==state.sourceChecksum ||
      !Array.isArray(mappingEnvelope.entries)
    ){
      state.state='failed-before-write';
      state.diagnostics.push(diagnostic(
        'migration-mapping-invalid',
        'error',
        '$.mapping',
        'The persisted recordId mapping does not belong to this migration transaction.'
      ));
      writeState(directory,state);
      updateManifest(directory,state);
      return {ok:false,status:state.state,state,directory,diagnostics:state.diagnostics};
    }

    const candidate=transform(
      parsed.database,
      mappingEnvelope.entries,
      state.migrationId,
      state.createdAt
    );
    const checked=validateTransformation(parsed.database,candidate,mappingEnvelope.entries);
    state.diagnostics=[...state.diagnostics,...checked.diagnostics];
    if(!checked.valid){
      state.state='failed-before-write';
      writeState(directory,state);
      updateManifest(directory,state);
      return {ok:false,status:state.state,state,directory,diagnostics:state.diagnostics};
    }
    atomicWriteBytes(path.join(directory,'prepared-v6-output.json'),checked.outputBytes);
    state.outputChecksum=checked.outputChecksum;
    state.state='output-validated';
    writeState(directory,state);
    updateManifest(directory,state);
    return {ok:true,status:state.state,state,directory,diagnostics:state.diagnostics};
  }

  function activate(transaction){
    const directory=transaction.directory;
    const state=readJson(statePath(directory));
    const preparedPath=path.join(directory,'prepared-v6-output.json');
    const prepared=readFileDescriptor(preparedPath);
    if(!prepared || !validatePreparedBytes(prepared.bytes,state.outputChecksum)){
      state.state='failed-before-write';
      state.diagnostics.push(diagnostic(
        'migration-prepared-output-invalid',
        'error',
        '$.preparedOutput',
        'The stored prepared Version 6 output failed checksum or schema validation.'
      ));
      writeState(directory,state);
      updateManifest(directory,state);
      return {ok:false,status:state.state,migrationId:state.migrationId,diagnostics:state.diagnostics};
    }

    const ordered=[...state.targets].sort((left,right)=>{
      if(left.role===state.authoritativeRole) return -1;
      if(right.role===state.authoritativeRole) return 1;
      return left.order-right.order;
    });
    let verifiedCount=0;
    let writeCount=0;
    for(const target of ordered){
      const existing=readFileDescriptor(target.path);
      if(existing && existing.sha256===state.outputChecksum && validatePreparedBytes(existing.bytes,state.outputChecksum)){
        target.verified=true;
        target.checksum=existing.sha256;
        target.lastError='';
        verifiedCount+=1;
        continue;
      }
      try{
        atomicWriteBytes(target.path,prepared.bytes,{
          beforeReplace:details=>{
            if(typeof beforeReplace==='function'){
              beforeReplace({...details,role:target.role,migrationId:state.migrationId});
            }
            const staged=readFileDescriptor(details.temporary);
            if(!staged || !validatePreparedBytes(staged.bytes,state.outputChecksum)){
              throw new Error('Staged Version 6 output failed checksum or schema validation.');
            }
          }
        });
        const replaced=readFileDescriptor(target.path);
        if(!replaced || !validatePreparedBytes(replaced.bytes,state.outputChecksum)){
          throw new Error('Replaced Version 6 database copy failed checksum or schema validation.');
        }
        target.verified=true;
        target.checksum=replaced.sha256;
        target.lastError='';
        verifiedCount+=1;
        writeCount+=1;
        state.state=verifiedCount===1 ? 'first-copy-written' : 'both-copies-verified';
        writeState(directory,state);
        updateManifest(directory,state);
      }catch(error){
        target.verified=false;
        target.lastError=error.message;
        state.diagnostics.push(diagnostic(
          'migration-target-write-failed',
          'error',
          `$.targets.${target.role}`,
          `The ${target.role} Collection database copy could not be activated.`,
          {path:target.path,error:error.message}
        ));
        state.state=verifiedCount>0 ? 'partial-roll-forward' : 'failed-before-write';
        writeState(directory,state);
        updateManifest(directory,state);
        atomicWriteJson(path.join(directory,'migration-report.json'),{
          migrationId:state.migrationId,
          state:state.state,
          sourceChecksum:state.sourceChecksum,
          outputChecksum:state.outputChecksum,
          activated:false,
          targets:state.targets,
          diagnostics:state.diagnostics
        });
        return {
          ok:false,
          status:state.state,
          migrationId:state.migrationId,
          outputChecksum:state.outputChecksum,
          targets:clone(state.targets),
          diagnostics:clone(state.diagnostics)
        };
      }
    }

    if(verifiedCount===state.targets.length){
      state.state='complete';
      state.completedAt=canonicalTimestamp(now);
      writeState(directory,state);
      updateManifest(directory,state);
      const mapping=readJson(path.join(directory,'record-id-mapping.json'));
      atomicWriteJson(path.join(directory,'migration-report.json'),{
        migrationId:state.migrationId,
        state:state.state,
        sourceChecksum:state.sourceChecksum,
        outputChecksum:state.outputChecksum,
        mappingCount:mapping.entries.length,
        activated:true,
        completedAt:state.completedAt,
        targets:state.targets,
        diagnostics:state.diagnostics
      });
      return {
        ok:true,
        status:'complete',
        migrationId:state.migrationId,
        outputChecksum:state.outputChecksum,
        mapping:clone(mapping.entries),
        targets:clone(state.targets),
        writesPerformed:writeCount,
        diagnostics:clone(state.diagnostics)
      };
    }
    throw new Error('Migration activation ended without a complete or recoverable state.');
  }

  function execute(){
    if(running){
      return {
        ok:false,
        status:'blocked',
        diagnostics:[diagnostic(
          'migration-already-running',
          'error',
          '$',
          'A Collection identity migration is already running in this process.'
        )]
      };
    }
    running=true;
    try{
      const resumable=activeResumableTransaction();
      if(resumable){
        const preparedPath=path.join(resumable.directory,'prepared-v6-output.json');
        const prepared=fs.existsSync(preparedPath)
          ? resumable
          : resumePreparation(resumable);
        if(!prepared.ok && !fs.existsSync(preparedPath)) return prepared;
        return activate(prepared);
      }
      const check=preflight({ignoreProcessLock:true});
      if(check.status==='not-required'){
        const completed=matchingTransaction({sourceChecksum:'',includeComplete:true});
        return {
          ok:true,
          status:completed?.state==='complete' ? 'already-complete' : 'not-required',
          migrationId:completed?.migrationId || check.database?.migration?.migrationId || '',
          diagnostics:check.diagnostics
        };
      }
      if(!check.ok || check.status!=='ready'){
        return {ok:false,status:'blocked',diagnostics:check.diagnostics,preflight:check};
      }
      const matching=matchingTransaction({sourceChecksum:check.sourceChecksum});
      let prepared=matching ? {...matching,ok:true} : prepare(check);
      if(prepared && !fs.existsSync(path.join(prepared.directory,'prepared-v6-output.json'))){
        prepared=resumePreparation(prepared);
      }
      if(!prepared.ok) return prepared;
      return activate(prepared);
    }catch(error){
      return {
        ok:false,
        status:'failed-before-write',
        diagnostics:[diagnostic(
          'migration-unexpected-failure',
          'error',
          '$',
          'Collection identity migration stopped before it could complete.',
          {error:error.message}
        )]
      };
    }finally{
      running=false;
    }
  }

  function status({migrationId=''}={}){
    const states=transactionStates();
    const selected=migrationId
      ? states.find(item=>item.migrationId===migrationId)
      : states.sort((left,right)=>String(right.updatedAt || '').localeCompare(String(left.updatedAt || '')))[0];
    if(!selected){
      return {ok:true,status:'not-started',migration:null,transactions:[]};
    }
    return {
      ok:true,
      status:selected.state,
      migration:clone(selected),
      transactions:states.map(item=>({
        migrationId:item.migrationId,
        state:item.state,
        sourceChecksum:item.sourceChecksum,
        outputChecksum:item.outputChecksum,
        createdAt:item.createdAt,
        updatedAt:item.updatedAt
      }))
    };
  }

  function readRecoverySource({migrationId}={}){
    const state=transactionStates().find(item=>item.migrationId===migrationId);
    if(!state){
      return {ok:false,bytes:null,diagnostics:[diagnostic(
        'migration-transaction-not-found',
        'error',
        '$.migrationId',
        'The requested migration recovery bundle does not exist.',
        {migrationId}
      )]};
    }
    const file=readFileDescriptor(path.join(state.directory,'source-authoritative-v5.json'));
    if(!file || file.sha256!==state.sourceChecksum){
      return {ok:false,bytes:null,diagnostics:[diagnostic(
        'migration-recovery-source-invalid',
        'error',
        '$.recoverySource',
        'The exact Version 5 recovery source failed checksum verification.',
        {migrationId}
      )]};
    }
    return {ok:true,bytes:Buffer.from(file.bytes),sha256:file.sha256,path:file.path,diagnostics:[]};
  }

  return {
    preflight,
    execute,
    status,
    readRecoverySource,
    implementationVersion:MIGRATION_IMPLEMENTATION_VERSION,
    transactionStates:[...TRANSACTION_STATES]
  };
}

module.exports={
  MIGRATION_IMPLEMENTATION_VERSION,
  TRANSACTION_STATES,
  createCollectionMigrationService
};
