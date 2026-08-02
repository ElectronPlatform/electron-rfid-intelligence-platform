/*
 * Electron Card Profile Engine
 *
 * Builds a readable profile from the loaded Knowledge Engine result.
 * This keeps reports and UI cards on the same central interpretation layer.
 */
(function(){
  function text(value){ return String(value ?? ""); }
  function clean(value){ return text(value).trim(); }
  function html(value){ return text(value).replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c])); }
  function list(value){
    if(Array.isArray(value)) return value.filter(item=>clean(item));
    if(clean(value)) return [value];
    return [];
  }
  function first(){
    for(const value of arguments){
      if(Array.isArray(value) && value.length) return value;
      if(clean(value)) return value;
    }
    return "";
  }
  function percent(value){
    const n=Number(value);
    return Number.isFinite(n) ? `${Math.round(n)}%` : clean(value);
  }
  function scoreLabel(confidence){
    const n=Number(confidence || 0);
    if(n>=85) return "Very high";
    if(n>=65) return "High";
    if(n>=35) return "Medium";
    if(n>0) return "Low";
    return "Unknown";
  }
  function calculateScores(result, profile){
    const known=[
      profile.description,
      profile.technology,
      profile.protocol,
      profile.frequency,
      profile.chipFamily,
      list(profile.typicalApplications).length,
      list(profile.publicReadable).length,
      list(profile.compatibleHardware).length,
      list(profile.safeCommands).length,
      list(profile.recommendedNextSteps).length
    ].filter(Boolean).length;
    const readableBase=list(profile.publicReadable).length || (result?.parsed?.uid ? 1 : 0);
    const authNeeded=list(profile.authenticatedReadable).length || list(profile.notVisibleReasons).length;
    return {
      knowledgeCompleteness:Math.min(100, Math.round((known / 10) * 100)),
      readableInformation:Math.min(100, Math.round((readableBase / 6) * 100)),
      detectionConfidence:Number(result?.confidence || 0),
      electronConfidence:scoreLabel(result?.confidence),
      authenticationRequired:authNeeded ? "Yes" : "No"
    };
  }
  function foundFields(result){
    const extracted=window.ReadableDataExtractor?.extract?.(result || {})?.fields || [];
    const lf=result?.parsed?.lf || {};
    const primary=lf.primary || {};
    const technical=[
      {key:"uid",label:"UID",value:result?.parsed?.uid},
      {key:"facilityCode",label:"Facility Code",value:primary.facilityCode || lf.facilityCode},
      {key:"cardNumber",label:"Card Number",value:primary.cardNumber || lf.cardNumber},
      {key:"rawId",label:"Raw ID",value:primary.rawId || lf.rawId}
    ].filter(item=>clean(item.value)).map(item=>({...item,value:clean(item.value),source:"parsed scan"}));
    const seen=new Set();
    return [...technical,...extracted].filter(item=>{
      const id=clean(item.key || item.label).toLowerCase();
      if(!id || seen.has(id)) return false;
      seen.add(id);
      return true;
    });
  }
  function profileFromResult(result){
    const module=result?.module || {};
    const profile=module.cardProfile || {};
    const output={
      name:first(profile.name, module.displayName, "Unknown card"),
      description:first(profile.description, module.summary, module.beginnerExplanation),
      meaning:first(profile.meaning, module.beginnerExplanation, module.summary),
      beginnerExplanation:first(module.beginnerExplanation, profile.description, module.summary),
      band:/\bLF\b|125|134\.2/i.test(module.technology || module.frequency || "") ? "LF" : /\bHF\b|13\.56|NFC/i.test(module.technology || module.frequency || "") ? "HF" : "Unknown",
      frequency:module.frequency,
      technology:module.technology,
      protocol:module.protocol,
      chipFamily:first(profile.chipFamily, module.family, module.displayName),
      manufacturers:list(profile.manufacturers || module.manufacturer),
      typicalApplications:list(profile.typicalApplications || module.typicalApplications || module.application),
      publicReadable:list(profile.publicReadableData || module.publicReadableData),
      authenticatedReadable:list(profile.authenticatedReadableData || module.authenticatedReadableData),
      normallyAbsent:list(profile.normallyAbsentData || module.normallyAbsentData),
      notVisibleReasons:list(profile.notVisibleReasons),
      relatedKnowledgeRecords:list(profile.relatedKnowledgeRecords || module.relatedKnowledgeRecords),
      similarCards:list(profile.similarCards || module.similarCards),
      faqs:list(profile.faqs || module.faqs),
      compatibleHardware:list(profile.compatibleHardware || module.compatibleHardware),
      recommendedNextSteps:list(profile.recommendedNextSteps || module.safeRecommendedActions),
      safeCommands:list(profile.safePm3Commands || module.safePm3Commands),
      confidenceLevel:first(result?.confidenceLevel, scoreLabel(result?.confidence))
    };
    output.found=foundFields(result);
    output.scores=calculateScores(result, output);
    return output;
  }
  function renderList(items){
    const values=list(items);
    if(!values.length) return `<p class="small">No profile records loaded yet.</p>`;
    return `<ul>${values.map(item=>`<li>${html(item)}</li>`).join("")}</ul>`;
  }
  function renderCommandList(items, moduleId){
    const values=list(items);
    if(!values.length) return `<p class="small">No safe commands recorded yet.</p>`;
    return `<div class="electronKnowledgeChipRow">${values.map(command=>`<button type="button" class="electronKnowledgeChip" data-safe-command="${html(command)}" data-module-id="${html(moduleId || "")}">${html(command)}</button>`).join("")}</div>`;
  }
  function renderProfileHtml(result){
    const profile=profileFromResult(result);
    const scores=profile.scores || {};
    const moduleId=result?.module?.id || "";
    const found=profile.found || [];
    return `<div class="electronCardProfile">
      <div class="atlasKicker">Card Profile</div>
      <div class="atlasGrid atlasIntelligenceGrid">
        <div class="atlasCard atlasWideCard"><b>${html(profile.name)}</b><p>${html(profile.beginnerExplanation || profile.description || profile.meaning || "")}</p></div>
        <div class="atlasCard"><b>Knowledge Score</b><p>${html(percent(scores.knowledgeCompleteness))}</p><small>Profile fields available in Electron.</small></div>
        <div class="atlasCard"><b>Readable Information</b><p>${html(percent(scores.readableInformation))}</p><small>Public data likely available from safe scans.</small></div>
        <div class="atlasCard"><b>Authentication required</b><p>${html(scores.authenticationRequired)}</p><small>Protected data needs authorized access.</small></div>
        <div class="atlasCard"><b>Typical applications</b>${renderList(profile.typicalApplications)}</div>
        <div class="atlasCard atlasWideCard"><b>Found in this read</b>${found.length?`<div class="electronReadableGrid">${found.map(item=>`<div class="electronReadableField"><span>${html(item.label)}</span><b>${html(item.value)}</b></div>`).join("")}</div>`:`<p class="small">No human-readable fields were exposed.</p>`}</div>
        <div class="atlasCard"><b>Normally not on card</b>${renderList(profile.normallyAbsent)}</div>
        <div class="atlasCard"><b>Why information is not visible</b>${renderList(profile.notVisibleReasons)}</div>
        <div class="atlasCard atlasWideCard"><b>Frequently asked questions</b>${profile.faqs.length?profile.faqs.map(item=>`<details><summary>${html(item.question || "Question")}</summary><p>${html(item.answer || "No answer recorded.")}</p></details>`).join(""):`<p class="small">No questions recorded yet.</p>`}</div>
      </div>
    </div>`;
  }
  window.CardProfileEngine={profileFromResult,renderProfileHtml};
})();
