'use strict';

const {validateCollectionDatabase}=require('./collectionValidation');
const {
  generateRecordId,
  isValidRecordId,
  validateRecordIdTransition
}=require('./collectionRecordId');

const EDITABLE_RECORD_FIELDS=Object.freeze([
  'assetId',
  'alias',
  'form',
  'color',
  'band',
  'frequency',
  'type',
  'magic',
  'currentUid',
  'originalUid',
  'cloneOf',
  'prng',
  'status',
  'backupStatus',
  'lastBackup',
  'source',
  'storage',
  'notes'
]);

const SERVICE_MUTABLE_RECORD_FIELDS=Object.freeze([
  ...EDITABLE_RECORD_FIELDS,
  'photo',
  'photoPath',
  'uidHistory',
  'backupFiles',
  'backupValidation',
  'archived'
]);

const LEGACY_IMPORT_FIELDS=Object.freeze([
  ...SERVICE_MUTABLE_RECORD_FIELDS,
  'dateAdded',
  'lastUpdated'
]);

const INTERNAL_RECORD_FIELDS=Object.freeze([
  'recordId',
  'identitySchemaVersion',
  'previousAssetIds'
]);

const MUTATION_OPERATIONS=Object.freeze([
  'reserveAssetId',
  'create',
  'edit',
  'rename',
  'duplicate',
  'archive',
  'restore',
  'delete',
  'legacyImport',
  'updateSettings',
  'replaceDatabase',
  'clear'
]);

function clone(value){
  if(value===undefined) return undefined;
  return JSON.parse(JSON.stringify(value));
}

function isObject(value){
  return !!value && typeof value==='object' && !Array.isArray(value);
}

function nonEmpty(value){
  return typeof value==='string' && value.trim().length>0;
}

function diagnostic(code,severity,path,message,details={}){
  return {code,severity,path,message,details};
}

function resultFailure(operation,diagnostics,database=null){
  return {
    ok:false,
    operation,
    record:null,
    database:database ? clone(database) : null,
    diagnostics
  };
}

function formatDate(date){
  return `${String(date.getDate()).padStart(2,'0')}-${String(date.getMonth()+1).padStart(2,'0')}-${date.getFullYear()}`;
}

function formatTime(date){
  return `${String(date.getHours()).padStart(2,'0')}:${String(date.getMinutes()).padStart(2,'0')}:${String(date.getSeconds()).padStart(2,'0')}`;
}

function photoLogSnapshot(photo){
  if(!photo) return null;
  const snapshot={
    name:photo.name || 'Stored photo',
    mime:photo.mime || photo.full?.mime || photo.thumb?.mime || '',
    storageVersion:photo.storageVersion || (photo.full ? 2 : 1),
    storedInDb:true
  };
  if(photo.originalSize) snapshot.originalSize=photo.originalSize;
  if(photo.originalWidth && photo.originalHeight){
    snapshot.originalDimensions=`${photo.originalWidth}x${photo.originalHeight}`;
  }
  if(photo.thumb){
    snapshot.thumb={
      width:photo.thumb.width || 0,
      height:photo.thumb.height || 0,
      size:photo.thumb.size || 0,
      dataB64:'[thumbnail image omitted from Change Log]'
    };
  }
  if(photo.full){
    snapshot.full={
      width:photo.full.width || 0,
      height:photo.full.height || 0,
      size:photo.full.size || 0,
      dataB64:'[full image omitted from Change Log]'
    };
  }
  if(photo.dataB64){
    snapshot.legacy={
      size:photo.size || 0,
      dataB64:'[embedded legacy image omitted from Change Log]'
    };
  }
  return snapshot;
}

function recordLogSnapshot(record){
  if(!record) return null;
  const snapshot=clone(record);
  if(snapshot.photo) snapshot.photo=photoLogSnapshot(snapshot.photo);
  return snapshot;
}

function recordLogString(record){
  return JSON.stringify(recordLogSnapshot(record));
}

function cleanAuditValue(value,maxLength=12000){
  return String(value ?? '').slice(0,maxLength);
}

function createCollectionService({
  load,
  persist,
  now=()=>new Date(),
  recordIdGenerator=generateRecordId,
  migration=null
}={}){
  if(typeof load!=='function') throw new TypeError('Collection Service requires a load function.');
  if(typeof persist!=='function') throw new TypeError('Collection Service requires a persist function.');
  if(typeof recordIdGenerator!=='function') throw new TypeError('Collection Service requires a recordId generator.');

  function databaseSnapshot(){
    const database=clone(load());
    if(!isObject(database)) return database;
    if(!isObject(database.settings)) database.settings={lastAssignedNumber:0};
    if(!Array.isArray(database.assets)) database.assets=[];
    if(!Array.isArray(database.log)) database.log=[];
    return database;
  }

  function inspection(database){
    return validateCollectionDatabase(database);
  }

  function assetIndex(database,assetId){
    return database.assets.findIndex(record=>String(record?.assetId || '')===String(assetId || ''));
  }

  function findRecord(database,{assetId='',recordId=''}={}){
    if(recordId){
      return database.assets.find(record=>record?.recordId===recordId) || null;
    }
    if(assetId){
      return database.assets.find(record=>record?.assetId===assetId) || null;
    }
    return null;
  }

  function addLog(database,record,action,field='',oldValue='',newValue='',notes=''){
    const timestamp=now();
    database.log.unshift({
      date:formatDate(timestamp),
      time:formatTime(timestamp),
      assetId:String(record?.assetId || ''),
      action:cleanAuditValue(action,120),
      field:cleanAuditValue(field,120),
      oldValue:cleanAuditValue(oldValue),
      newValue:cleanAuditValue(newValue),
      notes:cleanAuditValue(notes,1000)
    });
  }

  function normalizeAssetNumber(database){
    const current=Number(database.settings?.lastAssignedNumber || 0);
    const max=database.assets.reduce((value,record)=>{
      const number=parseInt(String(record?.assetId || '').replace(/[^0-9]/g,''),10);
      return Number.isFinite(number) ? Math.max(value,number) : value;
    },Number.isFinite(current) ? current : 0);
    database.settings.lastAssignedNumber=max;
    return max;
  }

  function allocateAssetId(database){
    const current=normalizeAssetNumber(database);
    const next=current+1;
    database.settings.lastAssignedNumber=next;
    return `#${String(next).padStart(2,'0')}`;
  }

  function allocateRecordId(database){
    const existing=new Set(database.assets.map(record=>record?.recordId).filter(Boolean));
    for(let attempt=0;attempt<32;attempt+=1){
      const recordId=recordIdGenerator();
      if(isValidRecordId(recordId) && !existing.has(recordId)) return recordId;
    }
    return '';
  }

  function sortAssets(database){
    const number=record=>{
      const parsed=parseInt(String(record?.assetId || '').replace(/[^0-9]/g,''),10);
      return Number.isFinite(parsed) ? parsed : Number.MAX_SAFE_INTEGER;
    };
    database.assets.sort((left,right)=>{
      const difference=number(left)-number(right);
      return difference || String(left?.assetId || '').localeCompare(String(right?.assetId || ''));
    });
  }

  function requestDiagnostics(request){
    if(!isObject(request)){
      return [diagnostic(
        'collection-request-invalid',
        'error',
        '$',
        'Collection mutation request must be an object.'
      )];
    }
    if(!MUTATION_OPERATIONS.includes(request.operation)){
      return [diagnostic(
        'collection-operation-unsupported',
        'error',
        '$.operation',
        'Collection mutation operation is not supported.',
        {operation:request.operation}
      )];
    }
    return [];
  }

  function targetDiagnostics(database,payload){
    const record=findRecord(database,payload);
    if(record) return {record,diagnostics:[]};
    return {
      record:null,
      diagnostics:[diagnostic(
        'collection-record-not-found',
        'error',
        '$.payload',
        'The requested Collection Record does not exist.',
        {assetId:payload?.assetId || payload?.targetAssetId || '',recordId:payload?.recordId || ''}
      )]
    };
  }

  function uniqueAssetIdDiagnostics(database,assetId,{exceptRecord=null,path='$.payload.assetId'}={}){
    if(!nonEmpty(assetId)){
      return [diagnostic(
        'asset-id-required',
        'error',
        path,
        'A non-empty RFID Tag ID is required.'
      )];
    }
    const conflict=database.assets.find(record=>record!==exceptRecord && record?.assetId===assetId && record?.archived!==true && !/^archived$/i.test(String(record?.status || '')));
    return conflict ? [diagnostic(
      'duplicate-active-asset-id',
      'error',
      path,
      `RFID Tag ID "${assetId}" is already used by another active Collection Record.`,
      {assetId}
    )] : [];
  }

  function pickFields(source,allowed){
    const output={};
    if(!isObject(source)) return output;
    allowed.forEach(field=>{
      if(Object.prototype.hasOwnProperty.call(source,field)) output[field]=clone(source[field]);
    });
    return output;
  }

  function ignoredInternalDiagnostics(source,path='$.payload.changes'){
    if(!isObject(source)) return [];
    return INTERNAL_RECORD_FIELDS
      .filter(field=>Object.prototype.hasOwnProperty.call(source,field))
      .map(field=>diagnostic(
        'internal-field-ignored',
        'info',
        `${path}.${field}`,
        `Renderer input cannot replace service-owned field "${field}".`,
        {field}
      ));
  }

  function applyUnset(record,unsetFields){
    if(!Array.isArray(unsetFields)) return;
    const allowed=new Set(SERVICE_MUTABLE_RECORD_FIELDS);
    unsetFields.forEach(field=>{
      if(allowed.has(field)) delete record[field];
    });
  }

  function finalize(operation,database,record=null,diagnostics=[],summary={}){
    sortAssets(database);
    const validation=inspection(database);
    const allDiagnostics=[...diagnostics,...validation.diagnostics];
    if(!validation.valid){
      return resultFailure(operation,allDiagnostics,database);
    }
    persist(database);
    return {
      ok:true,
      operation,
      record:record ? clone(record) : null,
      database:clone(database),
      diagnostics:allDiagnostics,
      summary:clone(summary)
    };
  }

  function reserveAssetId(database){
    const assetId=allocateAssetId(database);
    return finalize('reserveAssetId',database,null,[],{assetId});
  }

  function createRecord(database,payload={}){
    const fields=pickFields(payload.fields,EDITABLE_RECORD_FIELDS);
    fields.assetId=nonEmpty(fields.assetId) ? fields.assetId.trim() : allocateAssetId(database);
    const uniqueness=uniqueAssetIdDiagnostics(database,fields.assetId);
    if(uniqueness.length) return resultFailure('create',uniqueness,database);
    const date=formatDate(now());
    const record={
      ...fields,
      dateAdded:date,
      lastUpdated:date,
      uidHistory:[],
      backupFiles:[]
    };
    if(database.version===6){
      record.recordId=allocateRecordId(database);
      if(!record.recordId){
        return resultFailure('create',[diagnostic(
          'record-id-generation-failed',
          'error',
          '$.payload',
          'Collection Service could not generate a new unique recordId.'
        )],database);
      }
      record.identitySchemaVersion=1;
      record.previousAssetIds=[];
    }
    if(record.currentUid){
      record.uidHistory.push({date,uid:record.currentUid,reason:'Initial scan'});
    }
    database.assets.push(record);
    addLog(database,record,'Added','Record','',record.currentUid || '','New asset added');
    return finalize('create',database,record,ignoredInternalDiagnostics(payload.fields),{created:true});
  }

  function editRecord(database,payload={}){
    const target=findRecord(database,{
      assetId:payload.targetAssetId || payload.assetId,
      recordId:payload.recordId
    });
    if(!target){
      return resultFailure('edit',[diagnostic(
        'collection-record-not-found',
        'error',
        '$.payload.targetAssetId',
        'The Collection Record to edit does not exist.'
      )],database);
    }
    const before=clone(target);
    const changes=pickFields(payload.changes,SERVICE_MUTABLE_RECORD_FIELDS);
    const nextAssetId=Object.prototype.hasOwnProperty.call(changes,'assetId')
      ? String(changes.assetId || '').trim()
      : target.assetId;
    const uniqueness=uniqueAssetIdDiagnostics(database,nextAssetId,{exceptRecord:target,path:'$.payload.changes.assetId'});
    if(uniqueness.length) return resultFailure('edit',uniqueness,database);

    const oldUid=target.currentUid || '';
    Object.assign(target,changes,{assetId:nextAssetId});
    applyUnset(target,payload.unsetFields);
    if(nextAssetId!==before.assetId && Array.isArray(target.previousAssetIds) && !target.previousAssetIds.includes(before.assetId)){
      target.previousAssetIds.push(before.assetId);
    }
    if(target.currentUid && target.currentUid!==oldUid){
      target.uidHistory=Array.isArray(target.uidHistory) ? clone(target.uidHistory) : [];
      target.uidHistory.push({
        date:formatDate(now()),
        uid:target.currentUid,
        reason:`Updated from ${oldUid}`
      });
    }
    target.dateAdded=before.dateAdded || formatDate(now());
    target.lastUpdated=formatDate(now());

    const identityDiagnostics=validateRecordIdTransition(before.recordId,target.recordId);
    if(identityDiagnostics.some(item=>item.severity==='error')){
      return resultFailure('edit',identityDiagnostics,database);
    }
    const audit=isObject(payload.audit) ? payload.audit : {};
    addLog(
      database,
      target,
      audit.action || (nextAssetId!==before.assetId ? 'Renamed' : 'Edited'),
      audit.field || 'Record',
      Object.prototype.hasOwnProperty.call(audit,'oldValue') ? audit.oldValue : recordLogString(before),
      Object.prototype.hasOwnProperty.call(audit,'newValue') ? audit.newValue : recordLogString(target),
      audit.notes || (nextAssetId!==before.assetId ? `RFID Tag ID renamed from ${before.assetId}` : 'Asset updated')
    );
    return finalize(
      'edit',
      database,
      target,
      [...ignoredInternalDiagnostics(payload.changes),...identityDiagnostics],
      {updated:true,renamed:nextAssetId!==before.assetId,previousAssetId:before.assetId}
    );
  }

  function renameRecord(database,payload={}){
    const target=findRecord(database,payload);
    if(!target){
      return resultFailure('rename',[diagnostic(
        'collection-record-not-found',
        'error',
        '$.payload',
        'The Collection Record to rename does not exist.'
      )],database);
    }
    const newAssetId=String(payload.newAssetId || '').trim();
    const result=editRecord(database,{
      targetAssetId:target.assetId,
      recordId:target.recordId,
      changes:{assetId:newAssetId},
      audit:{
        action:'Renamed',
        field:'assetId',
        oldValue:target.assetId,
        newValue:newAssetId,
        notes:'RFID Tag ID renamed through Collection Service'
      }
    });
    if(result.operation==='edit') result.operation='rename';
    return result;
  }

  function duplicateRecord(database,payload={}){
    const source=findRecord(database,{
      assetId:payload.assetId || payload.sourceAssetId,
      recordId:payload.recordId
    });
    const formFields=pickFields(payload.changes,EDITABLE_RECORD_FIELDS);
    const base=source ? {...clone(source),...formFields} : formFields;
    INTERNAL_RECORD_FIELDS.forEach(field=>delete base[field]);
    const assetId=nonEmpty(payload.newAssetId)
      ? String(payload.newAssetId).trim()
      : allocateAssetId(database);
    const uniqueness=uniqueAssetIdDiagnostics(database,assetId,{path:'$.payload.newAssetId'});
    if(uniqueness.length) return resultFailure('duplicate',uniqueness,database);
    const date=formatDate(now());
    const record={
      ...pickFields(base,EDITABLE_RECORD_FIELDS),
      assetId,
      alias:`${base.alias || 'Duplicate'} copy`,
      dateAdded:date,
      lastUpdated:date,
      backupFiles:[],
      uidHistory:base.currentUid ? [{date,uid:base.currentUid,reason:'Duplicated record'}] : []
    };
    if(database.version===6){
      record.recordId=allocateRecordId(database);
      if(!record.recordId){
        return resultFailure('duplicate',[diagnostic(
          'record-id-generation-failed',
          'error',
          '$.payload',
          'Collection Service could not generate a new unique recordId for the duplicate.'
        )],database);
      }
      record.identitySchemaVersion=1;
      record.previousAssetIds=[];
    }
    database.assets.push(record);
    addLog(database,record,'Duplicated','Record','',record.currentUid || '','Duplicated from current form');
    return finalize('duplicate',database,record,ignoredInternalDiagnostics(payload.changes),{
      duplicated:true,
      sourceAssetId:source?.assetId || ''
    });
  }

  function archiveRecord(database,payload={}){
    const target=findRecord(database,payload);
    if(!target) return resultFailure('archive',targetDiagnostics(database,payload).diagnostics,database);
    const before=clone(target);
    target.archived=true;
    target.status='Archived';
    target.lastUpdated=formatDate(now());
    addLog(database,target,'Archived','status',before.status || '','Archived','Collection Record archived');
    return finalize('archive',database,target,validateRecordIdTransition(before.recordId,target.recordId),{archived:true});
  }

  function restoreRecord(database,payload={}){
    const target=findRecord(database,payload);
    if(!target) return resultFailure('restore',targetDiagnostics(database,payload).diagnostics,database);
    const before=clone(target);
    target.archived=false;
    target.status=payload.status && payload.status!=='Archived' ? String(payload.status) : 'Active';
    target.lastUpdated=formatDate(now());
    addLog(database,target,'Restored','status',before.status || 'Archived',target.status,'Collection Record restored');
    return finalize('restore',database,target,validateRecordIdTransition(before.recordId,target.recordId),{restored:true});
  }

  function deleteRecord(database,payload={}){
    const target=findRecord(database,payload);
    if(!target) return resultFailure('delete',targetDiagnostics(database,payload).diagnostics,database);
    const index=database.assets.indexOf(target);
    database.assets.splice(index,1);
    addLog(database,target,'Deleted','Record',recordLogString(target),'','Record deleted');
    return finalize('delete',database,null,[],{deleted:true,assetId:target.assetId,recordId:target.recordId || ''});
  }

  function legacyImport(database,payload={}){
    const candidates=Array.isArray(payload.candidates) ? payload.candidates : [];
    if(!candidates.length){
      return resultFailure('legacyImport',[diagnostic(
        'legacy-import-empty',
        'error',
        '$.payload.candidates',
        'At least one imported Collection Record is required.'
      )],database);
    }
    const counts=new Map();
    candidates.forEach(candidate=>{
      const assetId=String(candidate?.assetId || '');
      counts.set(assetId,(counts.get(assetId) || 0)+1);
    });
    const duplicates=[...counts.entries()].filter(([,count])=>count>1);
    if(duplicates.length){
      return resultFailure('legacyImport',[diagnostic(
        'legacy-import-duplicate-asset-id',
        'error',
        '$.payload.candidates',
        'Selected import records contain duplicate RFID Tag IDs.',
        {duplicates}
      )],database);
    }

    let added=0;
    let updated=0;
    const diagnostics=[];
    candidates.forEach((candidate,index)=>{
      const clean=pickFields(candidate,LEGACY_IMPORT_FIELDS);
      clean.assetId=String(clean.assetId || '').trim();
      diagnostics.push(...ignoredInternalDiagnostics(candidate,`$.payload.candidates[${index}]`));
      const uniqueness=uniqueAssetIdDiagnostics(database,clean.assetId,{
        exceptRecord:findRecord(database,{assetId:clean.assetId}),
        path:`$.payload.candidates[${index}].assetId`
      });
      if(uniqueness.length){
        diagnostics.push(...uniqueness);
        return;
      }
      const existing=findRecord(database,{assetId:clean.assetId});
      if(existing){
        const before=clone(existing);
        Object.assign(existing,clean);
        INTERNAL_RECORD_FIELDS.forEach(field=>{
          if(Object.prototype.hasOwnProperty.call(before,field)) existing[field]=clone(before[field]);
          else delete existing[field];
        });
        addLog(database,existing,'Imported','Record',recordLogString(before),recordLogString(existing),'Updated from Import Preview');
        updated+=1;
      }else{
        database.assets.push(clean);
        addLog(database,clean,'Imported','Record','',recordLogString(clean),'Added from Import Preview');
        added+=1;
      }
    });
    if(diagnostics.some(item=>item.severity==='error')){
      return resultFailure('legacyImport',diagnostics,database);
    }
    normalizeAssetNumber(database);
    return finalize('legacyImport',database,null,diagnostics,{added,updated});
  }

  function updateSettings(database,payload={}){
    if(!isObject(payload.changes)){
      return resultFailure('updateSettings',[diagnostic(
        'collection-settings-request-invalid',
        'error',
        '$.payload.changes',
        'Settings changes must be a JSON object.'
      )],database);
    }
    database.settings={...database.settings,...clone(payload.changes)};
    return finalize('updateSettings',database,null,[],{updated:true});
  }

  function replaceDatabase(_database,payload={}){
    const replacement=clone(payload.database);
    const validation=inspection(replacement);
    if(!validation.valid){
      return resultFailure('replaceDatabase',validation.diagnostics,replacement);
    }
    persist(replacement);
    return {
      ok:true,
      operation:'replaceDatabase',
      record:null,
      database:clone(replacement),
      diagnostics:validation.diagnostics,
      summary:{replaced:true}
    };
  }

  function clearDatabase(database){
    const cleared={version:5,settings:{lastAssignedNumber:0},assets:[],log:[]};
    return finalize('clear',cleared,null,[],{
      cleared:true,
      previousAssetCount:Array.isArray(database.assets) ? database.assets.length : 0,
      previousLogCount:Array.isArray(database.log) ? database.log.length : 0
    });
  }

  function mutate(request){
    const diagnostics=requestDiagnostics(request);
    if(diagnostics.length) return resultFailure(request?.operation || 'unknown',diagnostics);
    const database=databaseSnapshot();
    const currentValidation=inspection(database);
    if(!currentValidation.valid && request.operation!=='replaceDatabase' && request.operation!=='clear'){
      return resultFailure(request.operation,currentValidation.diagnostics,database);
    }
    const payload=isObject(request.payload) ? request.payload : {};
    switch(request.operation){
      case 'reserveAssetId': return reserveAssetId(database);
      case 'create': return createRecord(database,payload);
      case 'edit': return editRecord(database,payload);
      case 'rename': return renameRecord(database,payload);
      case 'duplicate': return duplicateRecord(database,payload);
      case 'archive': return archiveRecord(database,payload);
      case 'restore': return restoreRecord(database,payload);
      case 'delete': return deleteRecord(database,payload);
      case 'legacyImport': return legacyImport(database,payload);
      case 'updateSettings': return updateSettings(database,payload);
      case 'replaceDatabase': return replaceDatabase(database,payload);
      case 'clear': return clearDatabase(database);
      default: return resultFailure(request.operation,[diagnostic(
        'collection-operation-unsupported',
        'error',
        '$.operation',
        'Collection mutation operation is not supported.'
      )],database);
    }
  }

  function snapshot(){
    return databaseSnapshot();
  }

  function lookup(reference={}){
    const database=databaseSnapshot();
    const record=findRecord(database,reference);
    return {
      ok:!!record,
      record:record ? clone(record) : null,
      diagnostics:record ? [] : targetDiagnostics(database,reference).diagnostics
    };
  }

  function migrationUnavailable(operation){
    return {
      ok:false,
      status:'unavailable',
      operation,
      diagnostics:[diagnostic(
        'collection-migration-unavailable',
        'error',
        '$',
        'The controlled Collection migration component is not configured.'
      )]
    };
  }

  function migrationPreflight(){
    return typeof migration?.preflight==='function'
      ? migration.preflight()
      : migrationUnavailable('migration-preflight');
  }

  function migrationExecute(){
    return typeof migration?.execute==='function'
      ? migration.execute()
      : migrationUnavailable('migration-execute');
  }

  function migrationStatus(options={}){
    return typeof migration?.status==='function'
      ? migration.status(options)
      : migrationUnavailable('migration-status');
  }

  function migrationRecoverySource(options={}){
    return typeof migration?.readRecoverySource==='function'
      ? migration.readRecoverySource(options)
      : migrationUnavailable('migration-recovery-source');
  }

  return {
    snapshot,
    lookup,
    mutate,
    migrationPreflight,
    migrationExecute,
    migrationStatus,
    migrationRecoverySource,
    operations:[...MUTATION_OPERATIONS]
  };
}

module.exports={
  EDITABLE_RECORD_FIELDS,
  SERVICE_MUTABLE_RECORD_FIELDS,
  LEGACY_IMPORT_FIELDS,
  INTERNAL_RECORD_FIELDS,
  MUTATION_OPERATIONS,
  createCollectionService
};
