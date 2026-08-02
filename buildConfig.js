/*
 * Electron Build Configuration
 *
 * Central build-mode configuration for Internal, Preview and Public Release
 * builds. Keep preview flags, visible build labels, feedback settings and
 * future expiration architecture here instead of scattering build checks
 * through the app.
 */
(function(root, factory){
  const config=factory();
  if(typeof module !== "undefined" && module.exports) module.exports=config;
  if(root) root.ElectronBuildConfig=config;
})(typeof window !== "undefined" ? window : globalThis, function(){
  const BUILD_TYPES={
    INTERNAL:"internal",
    PREVIEW:"preview",
    RELEASE:"release"
  };

  const BUILD_TYPE=BUILD_TYPES.PREVIEW;
  const PREVIEW_BUILD_VERSION="0.8.0";

  return {
    BUILD_TYPES,
    BUILD_TYPE,
    IS_INTERNAL_BUILD:BUILD_TYPE===BUILD_TYPES.INTERNAL,
    IS_PREVIEW_BUILD:BUILD_TYPE===BUILD_TYPES.PREVIEW,
    IS_RELEASE_BUILD:BUILD_TYPE===BUILD_TYPES.RELEASE,
    PREVIEW_BUILD_VERSION,
    PREVIEW_DATA_REVISION:"r5",
    PREVIEW_LABEL:`Preview Release Candidate ${PREVIEW_BUILD_VERSION}`,
    WELCOME_STORAGE_KEY:`electron.preview.welcomeAccepted.${PREVIEW_BUILD_VERSION}.r5`,
    HIDE_INTERNAL_TOOLS:true,
    HIDE_EXPERIMENTAL_TOOLS:false,
    SUPPORT_EMAIL:"electron.platform@gmail.com",
    PORTAL_URL:"https://electronplatform.github.io",
    PORTAL_DOCUMENTATION_URL:"https://electronplatform.github.io/documentation.html",
    PORTAL_CONTACT_URL:"https://electronplatform.github.io/contact.html",
    SUPPORT_OPTIONS:{
      enabled:false,
      provider:"paypal",
      buttonLabel:"Support Electron",
      supportUrl:"",
      expectationText:"Support helps Electron Platform continue to grow. It is voluntary appreciation, not a purchase of guaranteed features or individual support."
    },
    FEEDBACK_EMAIL:"",
    FEEDBACK_PACKAGE_PREFIX:"electron-preview-feedback",
    SPLASH_SCREEN:{
      enabled:true,
      minDurationMs:1200,
      maxDurationMs:12000,
      modules:[
        "Knowledge Engine",
        "Research Library",
        "Report Engine",
        "Device Manager",
        "Device Guard",
        "Card Intelligence",
        "Feedback Engine"
      ],
      loadingSteps:[
        "Initializing Electron...",
        "Loading Knowledge Engine...",
        "Loading Device Profiles...",
        "Preparing Intelligence...",
        "Ready."
      ]
    },
    PREVIEW_FULL_DAYS:30,
    PREVIEW_TRIAL:{
      enabled:true,
      trialType:"days",
      days:30,
      launchCount:100,
      warningDays:5,
      lockOnExpire:true,
      extensionKeysEnabled:true,
      testerLevel:"Preview Tester"
    },
    PREVIEW_DEVICE_BINDING:{
      enabled:true,
      mismatchLimit:3,
      recoveryTokenEnabled:true
    },
    PREVIEW_EXPIRATION:{
      enabled:true,
      expiresAt:"",
      maxDays:30,
      extensionKeyRequired:false,
      testerLevel:"Preview Tester"
    }
  };
});
