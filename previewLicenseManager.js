/*
 * Electron Preview License Manager
 *
 * Central manager for Preview / Trial / License state.
 *
 * This is intentionally local-first:
 * - no online activation
 * - no automatic sending
 * - no account
 *
 * Future builds can replace the local key validation or add paid license
 * support here without scattering trial checks through Electron.
 */
const crypto = require('crypto');
const { verifyPreviewExtensionToken } = require('./previewExtensionToken');
const {
  collectDeviceSignals,
  assessDeviceBinding,
  rebindDevice
} = require('./previewDeviceFingerprint');

const TRIAL_TYPES={
  UNLIMITED:'unlimited',
  DAYS:'days',
  LAUNCH_COUNT:'launch-count'
};

const TESTER_LEVELS={
  INTERNAL:'Internal',
  TRUSTED:'Trusted Tester',
  PREVIEW:'Preview Tester',
  PUBLIC_BETA:'Public Beta',
  DEVELOPER:'Developer'
};

function isoNow(){
  return new Date().toISOString();
}

function parseDate(value){
  const ms=Date.parse(value || '');
  return Number.isFinite(ms) ? ms : 0;
}

function daysBetween(startMs, endMs){
  return Math.max(0, Math.floor((endMs-startMs)/86400000));
}

function daysUntil(endMs, nowMs=Date.now()){
  return Math.max(0, Math.ceil((endMs-nowMs)/86400000));
}

function createInstallationId(){
  return `EP-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
}

function normaliseTrialType(value){
  const v=String(value || '').toLowerCase();
  if(v==='days') return TRIAL_TYPES.DAYS;
  if(v==='launch-count' || v==='launchcount' || v==='launch_count') return TRIAL_TYPES.LAUNCH_COUNT;
  if(v==='unlimited') return TRIAL_TYPES.UNLIMITED;
  // Fail closed. An unknown or damaged local setting must never turn a
  // time-limited Preview into unlimited access.
  return TRIAL_TYPES.DAYS;
}

function createManager(options={}){
  const buildConfig=options.buildConfig || {};
  const loadSettings=options.loadSettings;
  const saveSettings=options.saveSettings;
  const now=options.now || Date.now;
  const verifyExtensionToken=options.verifyExtensionToken || verifyPreviewExtensionToken;
  const getDeviceSignals=options.getDeviceSignals || collectDeviceSignals;

  function trialConfig(){
    const cfg=buildConfig.PREVIEW_TRIAL || {};
    return {
      enabled:cfg.enabled !== false && !!buildConfig.IS_PREVIEW_BUILD,
      trialType:normaliseTrialType(cfg.trialType || cfg.type || TRIAL_TYPES.DAYS),
      days:Number(cfg.days || cfg.maxDays || buildConfig.PREVIEW_FULL_DAYS || 30),
      launchCount:Number(cfg.launchCount || cfg.launchLimit || 100),
      warningDays:Number(cfg.warningDays || 5),
      testerLevel:cfg.testerLevel || TESTER_LEVELS.PREVIEW,
      buildVersion:buildConfig.PREVIEW_BUILD_VERSION || 'dev',
      label:buildConfig.PREVIEW_LABEL || 'Preview Build',
      supportEmail:buildConfig.SUPPORT_EMAIL || 'electron.platform@gmail.com',
      lockOnExpire:cfg.lockOnExpire !== false,
      extensionKeysEnabled:cfg.extensionKeysEnabled !== false
    };
  }

  function deviceBindingConfig(){
    const cfg=buildConfig.PREVIEW_DEVICE_BINDING || {};
    return {
      enabled:cfg.enabled !== false && !!buildConfig.IS_PREVIEW_BUILD,
      mismatchLimit:Math.max(1,Number(cfg.mismatchLimit || 3)),
      recoveryTokenEnabled:cfg.recoveryTokenEnabled !== false
    };
  }

  function currentDeviceSignals(){
    try{
      return getDeviceSignals() || {machineIds:[],macAddresses:[]};
    }catch{
      return {machineIds:[],macAddresses:[]};
    }
  }

  function withSettings(mutator){
    const settings=loadSettings ? loadSettings() : {};
    const result=mutator(settings || {});
    if(saveSettings) saveSettings(settings || {});
    return result;
  }

  function ensureState({countLaunch=false}={}){
    return withSettings(settings=>{
      const cfg=trialConfig();
      settings.platform=settings.platform || {};
      if(!settings.platform.installationId){
        settings.platform.installationId=createInstallationId();
        settings.platform.installationCreatedAt=isoNow();
      }
      settings.preview=settings.preview || {};
      if(!settings.preview.startedAt) settings.preview.startedAt=isoNow();

      settings.previewLicense=settings.previewLicense || {};
      const lic=settings.previewLicense;
      if(!lic.installationId) lic.installationId=settings.platform.installationId;
      if(!lic.firstStartedAt) lic.firstStartedAt=settings.preview.startedAt;
      if(!lic.buildVersion) lic.buildVersion=cfg.buildVersion;
      // The current build configuration owns the base trial. Legacy local
      // settings may not silently preserve an unlimited Preview.
      lic.trialType=cfg.trialType;
      lic.testerLevel=cfg.testerLevel;
      if(typeof lic.launchCount!=='number') lic.launchCount=0;
      if(countLaunch) lic.launchCount += 1;
      const bindingCfg=deviceBindingConfig();
      if(bindingCfg.enabled){
        const assessment=assessDeviceBinding(lic.deviceBinding,currentDeviceSignals(),{
          nowMs:now(),
          mismatchLimit:bindingCfg.mismatchLimit,
          observeMismatch:countLaunch
        });
        lic.deviceBinding=assessment.binding;
        lic.deviceBindingStatus=assessment.status;
      }else{
        lic.deviceBindingStatus={
          enabled:false,
          state:'disabled',
          available:false,
          blocked:false,
          mismatchCount:0,
          mismatchLimit:bindingCfg.mismatchLimit,
          attemptsRemaining:bindingCfg.mismatchLimit
        };
      }
      return settings;
    });
  }

  function activeExtension(lic, installationId, nowMs=now()){
    const ext=lic?.extension || null;
    if(!ext?.token) return null;
    const result=verifyExtensionToken(ext.token,installationId,{nowMs});
    return result?.ok ? result.extension : null;
  }

  function evaluate(settings){
    const cfg=trialConfig();
    const lic=settings.previewLicense || {};
    const nowMs=now();
    const firstMs=parseDate(lic.firstStartedAt || settings.preview?.startedAt) || nowMs;
    const installationId=settings.platform?.installationId || lic.installationId || '';
    const ext=activeExtension(lic, installationId, nowMs);
    const type=normaliseTrialType(lic.trialType || cfg.trialType);
    let expired=false;
    let daysRemaining=null;
    let launchesRemaining=null;
    let expiresAt='';
    let state='Full Preview';

    if(!cfg.enabled || type===TRIAL_TYPES.UNLIMITED || ext?.type==='unlimited'){
      state='Unlimited Preview';
      expired=false;
    }else if(type===TRIAL_TYPES.LAUNCH_COUNT){
      launchesRemaining=Math.max(0, Number(cfg.launchCount || 0)-Number(lic.launchCount || 0));
      expired=launchesRemaining<=0;
      state=expired ? 'Expired' : 'Full Preview';
    }else{
      const baseExpiresMs=firstMs + Number(cfg.days || 30)*86400000;
      const extExpiresMs=ext?.expiresAt ? parseDate(ext.expiresAt) : 0;
      const finalExpiresMs=Math.max(baseExpiresMs, extExpiresMs || 0);
      expiresAt=new Date(finalExpiresMs).toISOString();
      daysRemaining=daysUntil(finalExpiresMs, nowMs);
      expired=finalExpiresMs<=nowMs;
      state=expired ? 'Expired' : (daysRemaining<=cfg.warningDays ? 'Preview Ending Soon' : 'Full Preview');
    }

    const deviceBinding=lic.deviceBindingStatus || {
      enabled:false,
      state:'unavailable',
      available:false,
      blocked:false,
      mismatchCount:0,
      mismatchLimit:deviceBindingConfig().mismatchLimit,
      attemptsRemaining:deviceBindingConfig().mismatchLimit
    };
    const previewLockout=expired && cfg.lockOnExpire;
    const deviceLockout=deviceBinding.enabled && deviceBinding.blocked;
    return {
      enabled:cfg.enabled,
      state,
      expired,
      lockout:previewLockout || deviceLockout,
      lockoutReason:deviceLockout ? 'device-verification' : previewLockout ? 'preview-expired' : '',
      trialType:type,
      buildVersion:cfg.buildVersion,
      buildLabel:cfg.label,
      installationId,
      firstStartedAt:lic.firstStartedAt || settings.preview?.startedAt || '',
      installationCreatedAt:settings.platform?.installationCreatedAt || '',
      daysTotal:cfg.days,
      daysElapsed:daysBetween(firstMs, nowMs),
      daysRemaining,
      launchLimit:cfg.launchCount,
      launchCount:Number(lic.launchCount || 0),
      launchesRemaining,
      warningDays:cfg.warningDays,
      testerLevel:ext?.testerLevel || cfg.testerLevel,
      supportEmail:cfg.supportEmail,
      expiresAt,
      extension:ext || null,
      extensionKeysEnabled:cfg.extensionKeysEnabled,
      deviceBinding
    };
  }

  function getStatus(){
    const settings=ensureState();
    return evaluate(settings);
  }

  function recordLaunchAndGetStatus(){
    const settings=ensureState({countLaunch:true});
    return evaluate(settings);
  }

  function requestBody(reason='',options={}){
    const status=getStatus();
    const requestType=String(options.requestType || 'preview-extension');
    return [
      requestType==='device-review'
        ? 'Electron Platform Device Verification Review'
        : 'Electron Platform Signed Preview Extension Token Request',
      '',
      'Installation ID:',
      status.installationId,
      '',
      'Current Version:',
      status.buildVersion,
      '',
      'Preview State:',
      status.state,
      '',
      'Tester Level:',
      status.testerLevel,
      '',
      'Device Verification:',
      status.deviceBinding?.state || 'unavailable',
      '',
      'Reason (optional):',
      reason || '_________________________',
      '',
      'No data is sent automatically. Please review this email before sending.'
    ].join('\n');
  }

  function applyExtensionKey(input){
    const settings=ensureState();
    const status=evaluate(settings);
    const verified=verifyExtensionToken(String(input || '').trim(),status.installationId,{nowMs:now()});
    if(!verified?.ok){
      return {
        ok:false,
        code:verified?.code || 'TOKEN_INVALID',
        message:verified?.message || 'The Preview Extension Token is not valid for this installation.'
      };
    }
    return withSettings(next=>{
      const lic=next.previewLicense || {};
      if(verified.extension.access==='device-rebind'){
        const bindingCfg=deviceBindingConfig();
        if(!bindingCfg.enabled || !bindingCfg.recoveryTokenEnabled){
          return {ok:false,code:'DEVICE_REBIND_DISABLED',message:'Device verification recovery is not available in this build.'};
        }
        const usedIds=Array.isArray(lic.usedDeviceRebindTokenIds) ? lic.usedDeviceRebindTokenIds : [];
        if(usedIds.includes(verified.extension.tokenId)){
          return {ok:false,code:'TOKEN_ALREADY_USED',message:'This device verification token has already been used.'};
        }
        const signals=currentDeviceSignals();
        const available=(signals.machineIds || []).length>0 || (signals.macAddresses || []).length>0;
        if(!available){
          return {ok:false,code:'DEVICE_SIGNALS_UNAVAILABLE',message:'Electron cannot read enough local device information to restore verification.'};
        }
        lic.deviceBinding=rebindDevice(signals,lic.deviceBinding,{nowMs:now()});
        const assessment=assessDeviceBinding(lic.deviceBinding,signals,{
          nowMs:now(),
          mismatchLimit:bindingCfg.mismatchLimit
        });
        lic.deviceBinding=assessment.binding;
        lic.deviceBindingStatus=assessment.status;
        lic.usedDeviceRebindTokenIds=[...usedIds,verified.extension.tokenId].slice(-20);
        next.previewLicense=lic;
        const recoveredStatus=evaluate(next);
        return {
          ok:true,
          action:'device-rebound',
          message:recoveredStatus.lockoutReason==='preview-expired'
            ? 'Device verification restored. The 30-day Preview has also expired, so a separate Preview Extension Token is still required.'
            : 'Device verification restored for this installation.',
          status:recoveredStatus
        };
      }
      lic.extension={
        ...verified.extension,
        appliedAt:isoNow(),
      };
      next.previewLicense=lic;
      return {ok:true,status:evaluate(next),extension:lic.extension};
    });
  }

  function shouldShowFeedbackPrompt(){
    const settings=ensureState();
    const status=evaluate(settings);
    if(status.expired || status.daysRemaining===null || status.daysRemaining>status.warningDays) return {show:false,status};
    const last=parseDate(settings.previewLicense?.feedbackReminderLastShownAt);
    const recentlyShown=last && now()-last<24*60*60*1000;
    return {show:!recentlyShown,status};
  }

  function markFeedbackPromptShown(){
    return withSettings(settings=>{
      settings.previewLicense=settings.previewLicense || {};
      settings.previewLicense.feedbackReminderLastShownAt=isoNow();
      return true;
    });
  }

  return {
    TRIAL_TYPES,
    TESTER_LEVELS,
    trialConfig,
    ensureState,
    getStatus,
    recordLaunchAndGetStatus,
    requestBody,
    applyExtensionKey,
    shouldShowFeedbackPrompt,
    markFeedbackPromptShown
  };
}

module.exports={
  TRIAL_TYPES,
  TESTER_LEVELS,
  createManager
};
