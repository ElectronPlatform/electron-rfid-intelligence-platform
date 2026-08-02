(function(){
  let portalState=null;
  let activePage="overview";

  function html(value){
    return String(value ?? "").replace(/[&<>"']/g, c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
  }
  function daysText(value){
    const n=Number(value || 0);
    return `${n} day${n===1?"":"s"}`;
  }
  function statePill(state){
    const name=state?.preview?.state || "Preview";
    const cls=name==="Free Mode" ? "free" : name==="Preview Ending Soon" ? "ending" : "full";
    return `<span class="portalStatePill ${cls}">${html(name)}</span>`;
  }
  function supportInfoText(state=portalState){
    return [
      "Electron Platform Support Information",
      "",
      `Installation ID: ${state?.installationId || "Unknown"}`,
      `Preview State: ${state?.preview?.state || "Unknown"}`,
      `Preview Remaining: ${daysText(state?.preview?.daysRemaining || 0)}`,
      `Version: ${state?.build?.previewBuildVersion || state?.build?.appVersion || "Unknown"}`,
      `Build: ${state?.build?.previewLabel || state?.build?.buildType || "Unknown"}`,
      `Electron: ${state?.build?.electronVersion || "Unknown"}`,
      `Platform: ${state?.build?.platform || "Unknown"} ${state?.build?.arch || ""}`,
      `Support: ${state?.supportEmail || "electron.platform@gmail.com"}`
    ].join("\n");
  }
  function portalShell(title, subtitle, body){
    return `<div class="portalPage">
      <div class="portalPageTitle"><h3>${html(title)}</h3><p>${html(subtitle)}</p></div>
      ${body}
    </div>`;
  }
  function overviewPage(){
    const state=portalState || {};
    return portalShell("Overview", "Public Preview of the Electron RFID Intelligence Platform.", `
      <div class="portalHero">
        <div>
          <div class="atlasKicker">Electron Platform</div>
          <h3>Local First. Privacy First. User Always In Control.</h3>
          <p>Electron helps testers explore RFID workflows while keeping card data, reports, logs and feedback packages local unless the user chooses to share them.</p>
        </div>
        <div class="portalPreviewCard">
          ${statePill(state)}
          <b>${html(state.build?.previewLabel || "Preview Build")}</b>
          <span>${daysText(state.preview?.daysRemaining || 0)} remaining in Full Preview</span>
        </div>
      </div>
      <div class="portalCards">
        <div class="portalCard"><span>Installation ID</span><b>${html(state.installationId || "Not generated")}</b><button type="button" data-portal-copy-installation>Copy</button></div>
        <div class="portalCard"><span>Preview Model</span><b>30-day Full Preview</b><small>After expiry, a signed Preview Extension Key is required to reopen the full app. Collection data is not deleted.</small></div>
        <div class="portalCard"><span>Support Contact</span><b>${html(state.supportEmail || "electron.platform@gmail.com")}</b><small>No automatic uploads.</small></div>
      </div>
      <div class="portalActionBand">
        <button type="button" data-portal-visit-website>Visit Electron Portal</button>
        <button type="button" data-portal-documentation>Documentation</button>
        <button type="button" data-portal-contact>Contact / Feedback</button>
        <button type="button" data-portal-feedback>Send Feedback</button>
        <button type="button" data-portal-instructions>Preview Testing Instructions</button>
      </div>
    `);
  }
  function supportPage(){
    const state=portalState || {};
    return portalShell("Support", "Create local support material and decide what to share.", `
      <div class="portalSupportGrid">
        <div class="portalCard wide"><span>Official support email</span><b>${html(state.supportEmail || "electron.platform@gmail.com")}</b><small>Use this address for Preview feedback and extension requests.</small></div>
        <div class="portalCard"><span>Installation ID</span><b>${html(state.installationId || "Not generated")}</b><button type="button" data-portal-copy-installation>Copy</button></div>
      </div>
      <div class="portalWorkflow">
        <div><b>Feedback Package</b><p>Uses the existing local feedback package flow. The user chooses screenshots, logs and device output. Nothing is uploaded automatically.</p><button type="button" data-portal-feedback>Create Feedback Package</button></div>
        <div><b>Portal Contact</b><p>Open the public Contact page for the official support route, documentation links and user-controlled sharing instructions.</p><button type="button" data-portal-contact>Open Contact Page</button></div>
        <div><b>Feedback Packages Folder</b><p>Open the local folder where feedback ZIP files are created.</p><button type="button" data-portal-open-feedback-folder>Open Folder</button></div>
        <div><b>Support Info</b><p>Copy basic support information without logs, cards, keys or dumps.</p><button type="button" data-portal-copy-support>Copy Support Info</button></div>
      </div>
    `);
  }
  function licensePage(){
    const state=portalState || {};
    return portalShell("License", "Preview access is managed locally. No online licensing, payment or automatic sending is implemented.", `
      <div class="portalPreviewTimeline">
        <div class="active"><b>30-day Full Preview</b><span>All features remain available during the public Preview period.</span></div>
        <div><b>Expiry after 30 days</b><span>Electron shows an access screen instead of launching the full app. Saved Collection data is retained.</span></div>
        <div><b>Signed Preview Extension Key</b><span>Approved testers can request an installation-bound key through the official support address.</span></div>
      </div>
      <div class="portalCards">
        <div class="portalCard"><span>Current state</span><b>${html(state.trial?.state || state.preview?.state || "Unknown")}</b></div>
        <div class="portalCard"><span>Trial type</span><b>${html(state.trial?.trialType || "days")}</b></div>
        <div class="portalCard"><span>Remaining</span><b>${state.trial?.daysRemaining == null ? "Unlimited" : daysText(state.trial.daysRemaining)}</b></div>
      </div>
      <div class="portalActionBand">
        <button type="button" data-portal-extension>Request Preview Extension</button>
      </div>
    `);
  }
  function updatesPage(){
    const state=portalState || {};
    return portalShell("Updates", "Release information for the current Preview build.", `
      <div class="portalCards">
        <div class="portalCard"><span>Current version</span><b>${html(state.build?.previewBuildVersion || state.build?.appVersion || "Unknown")}</b></div>
        <div class="portalCard"><span>Build type</span><b>${html(state.build?.buildType || "Unknown")}</b></div>
        <div class="portalCard"><span>Update system</span><b>Manual updates</b><small>Automatic updates are not available in this Preview. Check Electron Portal for release information.</small></div>
      </div>
      <p class="small">Future update checks should remain transparent and user-controlled.</p>
    `);
  }
  function aboutPage(){
    return portalShell("About", "Electron Platform product principles.", `
      <div class="portalPrinciples">
        <div><b>Local First</b><p>Card data, reports and support packages stay on the user's machine unless shared intentionally.</p></div>
        <div><b>Privacy First</b><p>No silent uploads, no hidden cloud sync and no automatic sharing of logs, keys, dumps or card data.</p></div>
        <div><b>User Always In Control</b><p>Electron guides and explains, but the user chooses what to scan, save, export, share and delete.</p></div>
      </div>
      <div class="portalCard wide"><span>Long-term direction</span><b>RFID Intelligence Platform</b><small>Electron is being developed through carefully reviewed public Preview releases.</small></div>
    `);
  }
  const pages={overview:overviewPage,support:supportPage,license:licensePage,updates:updatesPage,about:aboutPage};

  async function refresh(){
    if(window.pm3api?.getPortalState){
      portalState=await window.pm3api.getPortalState();
    }
    render();
  }
  function show(page){
    activePage=pages[page] ? page : "overview";
    render();
  }
  function render(){
    const content=document.getElementById("portalContent");
    if(!content) return;
    document.querySelectorAll("[data-portal-page]").forEach(btn=>btn.classList.toggle("active", btn.dataset.portalPage===activePage));
    content.innerHTML=(pages[activePage] || overviewPage)();
    wirePageActions(content);
  }
  function openFeedback(){
    document.getElementById("sendFeedbackBtn")?.click();
  }
  async function visitPortalWebsite(){
    const result=await window.pm3api.openElectronPortalWebsite?.();
    if(result?.ok) window.UIEngine?.toast?.("Electron Portal opened.","success");
    else window.UIEngine?.toast?.(result?.error || "Electron Portal URL is not configured yet.","warning");
  }
  async function visitPortalDocumentation(){
    const result=await window.pm3api.openElectronPortalDocumentation?.();
    if(result?.ok) window.UIEngine?.toast?.("Electron documentation opened.","success");
    else window.UIEngine?.toast?.(result?.error || "Electron documentation URL is not configured yet.","warning");
  }
  async function visitPortalContact(){
    const result=await window.pm3api.openElectronPortalContact?.();
    if(result?.ok) window.UIEngine?.toast?.("Electron contact page opened.","success");
    else window.UIEngine?.toast?.(result?.error || "Electron contact URL is not configured yet.","warning");
  }
  function showTestingInstructions(){
    if(window.showPreviewTestingInstructionsModal){
      window.showPreviewTestingInstructionsModal();
      return;
    }
    if(window.UIEngine?.modal){
      window.UIEngine.modal({
        id:"portalTestingInstructionsFallback",
        title:"Preview Testing Instructions",
        body:"<p>Use the Help menu or Preview badge for full testing instructions. Test core workflows and send feedback packages manually.</p>",
        buttons:[{text:"Close",variant:"secondary"}]
      });
    }
  }
  function requestExtension(){
    const body=`<div class="portalExtensionForm">
      <p class="small">Electron will open your default email app with a draft addressed to the official support contact. Review it before sending.</p>
      <label>Reason (optional)<textarea id="portalExtensionReason" placeholder="Why do you want another Preview period?"></textarea></label>
    </div>`;
    const run=async()=>{
      const reason=document.getElementById("portalExtensionReason")?.value || "";
      const result=await window.pm3api.requestPreviewExtension?.({reason});
      if(result?.ok) window.UIEngine?.toast?.("Preview extension email draft opened.","success");
      return true;
    };
    if(window.UIEngine?.modal){
      window.UIEngine.modal({
        id:"portalExtensionRequestModal",
        title:"Request Preview Extension",
        subtitle:portalState?.supportEmail || "electron.platform@gmail.com",
        body,
        size:"md",
        buttons:[{text:"Cancel",variant:"secondary"},{text:"Open Email Draft",variant:"success",onClick:run}]
      });
    }
  }
  function wirePageActions(root){
    root.querySelectorAll("[data-portal-copy-installation]").forEach(btn=>btn.onclick=async()=>{
      await navigator.clipboard.writeText(portalState?.installationId || "");
      window.UIEngine?.toast?.("Installation ID copied.","success");
    });
    root.querySelectorAll("[data-portal-copy-support]").forEach(btn=>btn.onclick=async()=>{
      await navigator.clipboard.writeText(supportInfoText());
      window.UIEngine?.toast?.("Support info copied.","success");
    });
    root.querySelectorAll("[data-portal-feedback]").forEach(btn=>btn.onclick=openFeedback);
    root.querySelectorAll("[data-portal-visit-website]").forEach(btn=>btn.onclick=visitPortalWebsite);
    root.querySelectorAll("[data-portal-documentation]").forEach(btn=>btn.onclick=visitPortalDocumentation);
    root.querySelectorAll("[data-portal-contact]").forEach(btn=>btn.onclick=visitPortalContact);
    root.querySelectorAll("[data-portal-open-feedback-folder]").forEach(btn=>btn.onclick=()=>window.pm3api.openFeedbackPackagesFolder?.());
    root.querySelectorAll("[data-portal-extension]").forEach(btn=>btn.onclick=requestExtension);
    root.querySelectorAll("[data-portal-instructions]").forEach(btn=>btn.onclick=showTestingInstructions);
  }
  function init(){
    document.querySelectorAll("[data-portal-page]").forEach(btn=>btn.onclick=()=>show(btn.dataset.portalPage));
    const refreshBtn=document.getElementById("portalRefreshBtn");
    if(refreshBtn) refreshBtn.onclick=refresh;
    const feedbackBtn=document.getElementById("portalSendFeedbackBtn");
    if(feedbackBtn) feedbackBtn.onclick=openFeedback;
    const visitBtn=document.getElementById("portalVisitWebsiteBtn");
    if(visitBtn) visitBtn.onclick=visitPortalWebsite;
    refresh();
  }
  window.ElectronPortalManager={init,refresh,show};
})();
