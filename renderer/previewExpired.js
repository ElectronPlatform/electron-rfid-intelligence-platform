(function(){
  let currentStatus=null;
  function html(v){
    return String(v ?? "").replace(/[&<>"']/g, c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
  }
  function render(status){
    currentStatus=status || currentStatus || {};
    const deviceReview=currentStatus.lockoutReason==="device-verification";
    const heading=document.getElementById("previewAccessHeading");
    const reason=document.getElementById("previewAccessReason");
    const instruction=document.getElementById("previewAccessInstruction");
    const requestButton=document.getElementById("requestExtendedAccessBtn");
    if(heading) heading.textContent=deviceReview ? "This installation needs verification." : "This Preview Build has expired.";
    if(reason) reason.textContent=deviceReview
      ? "Electron could not confirm this as the same Mac after three consecutive launches. Missing signals alone never trigger this screen. Your Collection data has not been deleted."
      : "The standard Preview lasts 30 days from its first launch. Your Collection data has not been deleted.";
    if(instruction) instruction.textContent=deviceReview
      ? "Contact Electron Support to request a signed Device Verification Recovery Token for this Installation ID."
      : "To reopen the full app, contact the Electron team or enter a valid signed Preview Extension Key.";
    if(requestButton) requestButton.textContent=deviceReview ? "Request Device Review" : "Request Extended Access";
    const box=document.getElementById("previewExpiredStatus");
    if(!box) return;
    box.innerHTML=`<div><span>Version</span><b>${html(currentStatus.buildVersion || "Unknown")}</b></div>
      <div><span>Installation ID</span><b>${html(currentStatus.installationId || "Unknown")}</b></div>
      <div><span>Tester Level</span><b>${html(currentStatus.testerLevel || "Preview Tester")}</b></div>
      <div><span>Started</span><b>${html(currentStatus.firstStartedAt || "Unknown")}</b></div>`;
  }
  async function refresh(){
    if(window.pm3api?.getPreviewLicenseStatus){
      render(await window.pm3api.getPreviewLicenseStatus());
    }
  }
  async function requestExtension(){
    const deviceReview=currentStatus?.lockoutReason==="device-verification";
    await window.pm3api?.requestPreviewExtension?.({
      requestType:deviceReview ? "device-review" : "preview-extension",
      reason:deviceReview
        ? "Electron could not verify this installation after a legitimate device or hardware change. I would like to request a Device Verification Recovery Token."
        : "Preview has expired. I would like to continue testing Electron."
    });
  }
  async function applyKey(){
    const input=document.getElementById("previewExtensionKey");
    const status=document.getElementById("previewExtensionStatus");
    const result=await window.pm3api?.applyPreviewExtensionKey?.(input?.value || "");
    if(result?.ok){
      if(status) status.textContent=result?.message
        ? `${result.message} Close and reopen Electron Preview.`
        : "Preview Extension Key accepted. Close and reopen Electron Preview.";
      await refresh();
    }else if(status){
      status.textContent=result?.message || "Preview Extension Key could not be applied.";
    }
  }
  function init(){
    window.pm3api?.onPreviewLicenseStatus?.(render);
    document.getElementById("requestExtendedAccessBtn").onclick=requestExtension;
    document.getElementById("applyExtensionKeyBtn").onclick=applyKey;
    document.getElementById("closeExpiredPreviewBtn").onclick=()=>window.pm3api?.closeCurrentWindow?.();
    refresh();
  }
  init();
})();
