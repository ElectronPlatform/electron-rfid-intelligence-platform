
const { contextBridge, ipcRenderer } = require('electron');
// Sandboxed Electron preloads cannot import local CommonJS modules. Keep this
// renderer-facing channel list explicit and limited to Task 6's read-only IPC.
const CONNECTION_COMPATIBILITY_CHANNELS=Object.freeze({
  requestSnapshot:'connection-compatibility:request-snapshot',
  getLastSnapshot:'connection-compatibility:get-last-snapshot',
  describe:'connection-compatibility:describe'
});
const MAINTAINER_CAPABILITY=Object.freeze(
  ipcRenderer.sendSync('maintainer:get-capability-sync') || {enabled:false,mode:'public-preview'}
);
const MAINTAINER_PRELOAD_API=MAINTAINER_CAPABILITY.enabled ? Object.freeze({
  saveDeviceStudioHotspots:(payload)=>ipcRenderer.invoke('device-studio:save-hotspots',payload || {}),
  addDeviceStudioComponent:(payload)=>ipcRenderer.invoke('device-studio:add-component',payload || {}),
  runPreviewChecklist:()=>ipcRenderer.invoke('preview:run-checklist')
}) : Object.freeze({});

contextBridge.exposeInMainWorld('splashApi',{
  onProgress:(cb)=>ipcRenderer.on('splash:progress',(_event,progress)=>cb(progress))
});
contextBridge.exposeInMainWorld('pm3api',{
  maintainerCapability:MAINTAINER_CAPABILITY,
  getMaintainerCapability:()=>ipcRenderer.invoke('maintainer:get-capability'),
  connectionCompatibility:Object.freeze({
    requestSnapshot:(request={})=>ipcRenderer.invoke(CONNECTION_COMPATIBILITY_CHANNELS.requestSnapshot,request),
    getLastSnapshot:(options={})=>ipcRenderer.invoke(CONNECTION_COMPATIBILITY_CHANNELS.getLastSnapshot,options),
    describe:()=>ipcRenderer.invoke(CONNECTION_COMPATIBILITY_CHANNELS.describe)
  }),
  ...MAINTAINER_PRELOAD_API,
  loadDb:()=>ipcRenderer.invoke('db:load'),
  lookupCollectionRecord:(reference)=>ipcRenderer.invoke('collection:lookup',reference || {}),
  mutateCollection:(operation,payload={})=>ipcRenderer.invoke('collection:mutate',{operation,payload}),
  exportJson:(db)=>ipcRenderer.invoke('db:export-json',db),
  importTags:()=>ipcRenderer.invoke('db:import-tags'),
  chooseExportFileForUpdate:()=>ipcRenderer.invoke('db:choose-export-file-for-update'),
  getLastExportFileForUpdate:()=>ipcRenderer.invoke('db:get-last-export-file-for-update'),
  updateExistingExportFile:(args)=>ipcRenderer.invoke('db:update-existing-export-file',args),
  restoreDatabase:()=>ipcRenderer.invoke('db:restore-database'),
  clearDatabase:()=>ipcRenderer.invoke('db:clear'),
  exportCsv:(csv)=>ipcRenderer.invoke('db:export-csv',csv),
  getBackupFolder:()=>ipcRenderer.invoke('settings:get-backup-folder'),
  chooseBackupFolder:()=>ipcRenderer.invoke('settings:choose-backup-folder'),
  resetBackupFolder:()=>ipcRenderer.invoke('settings:reset-backup-folder'),
  chooseBackupReferenceFile:(type,currentPath)=>ipcRenderer.invoke('backup:choose-reference-file', {type,currentPath}),
  importDeviceCommandLibrary:()=>ipcRenderer.invoke('device:import-command-library'),
  exportDeviceCommandLibrary:(payload)=>ipcRenderer.invoke('device:export-command-library', payload || {}),
  selectPhoto:()=>ipcRenderer.invoke('photo:select'),
  listPm3:()=>ipcRenderer.invoke('pm3:list'),
  devicePreflight:(options)=>ipcRenderer.invoke('device:preflight', options || {}),
  getDeviceStudioSnapshot:()=>ipcRenderer.invoke('device-studio:snapshot'),
  getDeviceStudioQuickRefresh:()=>ipcRenderer.invoke('device-studio:quick-refresh'),
  getDeviceStudioFullCheck:()=>ipcRenderer.invoke('device-studio:full-check'),
  setDeviceStudioSafeMode:(enabled)=>ipcRenderer.invoke('device-studio:set-safe-mode',{enabled:enabled===true}),
  getDeviceStudioHotspotEditorStatus:()=>ipcRenderer.invoke('device-studio:hotspot-editor-status'),
  readDeviceStudioSource:(file)=>ipcRenderer.invoke('device-studio:source-file',file),
  openDeviceStudioAntennaPlot:()=>ipcRenderer.invoke('device-studio:open-antenna-plot'),
  stopDeviceStudioAntennaPlot:()=>ipcRenderer.invoke('device-studio:stop-antenna-plot'),
  getDeviceStudioLedStatus:()=>ipcRenderer.invoke('device-studio:led-status'),
  getDeviceStudioScopeSnapshot:(band,samples)=>ipcRenderer.invoke('device-studio:scope-snapshot',{band,samples}),
  getDeviceStudioTuneSnapshot:()=>ipcRenderer.invoke('device-studio:tune-snapshot'),
  stopDeviceStudioTune:()=>ipcRenderer.invoke('device-studio:stop-tune'),
  testDeviceStudioLed:(led,durationMs,displayLed)=>ipcRenderer.invoke('device-studio:led-test',{led,durationMs,displayLed}),
  startPm3:()=>ipcRenderer.invoke('pm3:start'),
  pm3State:()=>ipcRenderer.invoke('pm3:state'),
  getHeaderPm3LedStatus:()=>ipcRenderer.invoke('pm3:header-led-status'),
  sendPm3:(cmd)=>ipcRenderer.invoke('pm3:send',cmd),
  runPm3Command:(cmd,options={})=>ipcRenderer.invoke('pm3:run-command',{command:cmd,timeoutMs:options.timeoutMs}),
  runPm3LiveCommand:(cmd,options={})=>ipcRenderer.invoke('pm3:run-live-command',{command:cmd,timeoutMs:options.timeoutMs}),
  cancelPm3LiveCommand:()=>ipcRenderer.invoke('pm3:cancel-live-command'),
  stopPm3:()=>ipcRenderer.invoke('pm3:stop'),
  createAssistantReviewPack:(payload)=>ipcRenderer.invoke('assistant:create-review-pack', payload),
  getPreviewBuildInfo:()=>ipcRenderer.invoke('preview:get-build-info'),
  getPreviewLicenseStatus:()=>ipcRenderer.invoke('preview-license:get-status'),
  shouldShowPreviewFeedbackPrompt:()=>ipcRenderer.invoke('preview-license:should-show-feedback-prompt'),
  applyPreviewExtensionKey:(key)=>ipcRenderer.invoke('preview-license:apply-extension-key', key || ""),
  markPreviewFeedbackPromptShown:()=>ipcRenderer.invoke('preview-license:mark-feedback-prompt-shown'),
  submitPreviewFeedback:(payload)=>ipcRenderer.invoke('preview:submit-feedback', payload || {}),
  revealPreviewFeedbackPackage:(filePath)=>ipcRenderer.invoke('preview:reveal-feedback-package', filePath || ""),
  openPreviewFeedbackPreview:(filePath)=>ipcRenderer.invoke('preview:open-feedback-preview', filePath || ""),
  getPortalState:()=>ipcRenderer.invoke('portal:get-state'),
  openElectronPortalWebsite:()=>ipcRenderer.invoke('portal:open-website'),
  openElectronPortalDocumentation:()=>ipcRenderer.invoke('portal:open-documentation'),
  openElectronPortalContact:()=>ipcRenderer.invoke('portal:open-contact'),
  requestPreviewExtension:(payload)=>ipcRenderer.invoke('portal:request-preview-extension', payload || {}),
  openFeedbackPackagesFolder:()=>ipcRenderer.invoke('portal:open-feedback-packages-folder'),
  exportCardReport:(payload)=>ipcRenderer.invoke('card-report:export', payload),
  openSettingsWindow:(target)=>ipcRenderer.invoke('app:open-settings-window', target || ""),
  closeCurrentWindow:()=>ipcRenderer.invoke('app:close-current-window'),
  getCurrentWindowState:()=>ipcRenderer.invoke('app:get-current-window-state'),
  exitFullScreen:()=>ipcRenderer.invoke('app:exit-full-screen'),
  notifySettingsUpdated:(payload)=>ipcRenderer.send('app:settings-updated', payload || {}),
  onSettingsUpdated:(cb)=>ipcRenderer.on('app:settings-updated',(_e,payload)=>cb(payload || {})),
  onFullScreenState:(cb)=>ipcRenderer.on('app:full-screen-state',(_e,state)=>cb(state || {})),
  onSettingsFocusSection:(cb)=>ipcRenderer.on('settings:focus-section',(_e,target)=>cb(target || "")),
  onPreviewShowWelcome:(cb)=>ipcRenderer.on('preview:show-welcome',()=>cb()),
  onPreviewShowTestingInstructions:(cb)=>ipcRenderer.on('preview:show-testing-instructions',()=>cb()),
  onPreviewOpenFeedback:(cb)=>ipcRenderer.on('preview:open-feedback',()=>cb()),
  onPreviewLicenseStatus:(cb)=>ipcRenderer.on('preview-license:status',(_e,status)=>cb(status || {})),
  onPm3Output:(cb)=>ipcRenderer.on('pm3:output',(_e,text)=>cb(text)),
  onPm3LiveOutput:(cb)=>ipcRenderer.on('pm3:live-output',(_e,text)=>cb(text)),
  onPm3Status:(cb)=>ipcRenderer.on('pm3:status',(_e,status)=>cb(status)),
  onDeviceStudioProgress:(cb)=>ipcRenderer.on('device-studio:progress',(_e,progress)=>cb(progress))
});
