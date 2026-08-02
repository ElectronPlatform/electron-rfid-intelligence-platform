/*
 * Electron App Configuration
 *
 * Central place for user-facing product names and default storage folders.
 * Change APP_NAME / APP_FOLDER here when the product name changes later.
 *
 * Folder layout under Documents/APP_FOLDER:
 * Database, Backups, Reports, Research, Photos, Logs, Templates, Labels,
 * Knowledge, Preview, Settings.
 */
(function(root, factory){
  const config=factory();
  if(typeof module !== "undefined" && module.exports) module.exports=config;
  if(root) root.ElectronAppConfig=config;
})(typeof window !== "undefined" ? window : globalThis, function(){
  const BUILD_CONFIG=(typeof window !== "undefined" ? window.ElectronBuildConfig : null) || (typeof require !== "undefined" ? require("./buildConfig") : {}) || {};
  const APP_NAME="Electron";
  const APP_SUBTITLE="RFID Intelligence Platform";
  const APP_DISPLAY_NAME=BUILD_CONFIG.IS_PREVIEW_BUILD ? `${APP_NAME} Preview ${APP_SUBTITLE}` : `${APP_NAME} ${APP_SUBTITLE}`;
  const APP_PREVIEW_NAME=`${APP_NAME} Preview`;
  const APP_FOLDER=BUILD_CONFIG.IS_PREVIEW_BUILD ? APP_PREVIEW_NAME : APP_NAME;
  const APP_VERSION=BUILD_CONFIG.PREVIEW_BUILD_VERSION || "0.8.0";
  const LEGACY_APP_FOLDERS=["Proxmark3 RFID Manager"];

  const STORAGE_FOLDERS={
    database:"Database",
    backups:"Backups",
    reports:"Reports",
    research:"Research",
    photos:"Photos",
    logs:"Logs",
    templates:"Templates",
    labels:"Labels",
    knowledge:"Knowledge",
    preview:"Preview",
    settings:"Settings"
  };

  function storageFolder(key){
    return STORAGE_FOLDERS[key] || key;
  }

  return {
    APP_NAME,
    APP_SUBTITLE,
    APP_DISPLAY_NAME,
    APP_FOLDER,
    APP_VERSION,
    APP_PREVIEW_NAME,
    BUILD_CONFIG,
    LEGACY_APP_FOLDERS,
    STORAGE_FOLDERS,
    storageFolder
  };
});
