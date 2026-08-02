/*
 * Electron v0.8.0 Patch 01 - Research Intelligence & Known by You foundation
 *
 * Research Manager is now the UI layer on top of ElectronDatabase.
 * It keeps existing Sprint 7.4.x behaviour, but routes memory through one
 * central Electron Database facade.
 */
(function(){
  const ELECTRON_DB_LABEL = "Electron Database → Research Library";
  const KNOWN_DB_LABEL = "Electron Database → Known by You";
  let reportExportInFlight=false;

  function db(){ return window.ElectronDatabase; }
  function text(v){ return String(v ?? ""); }
  function html(v){ return (window.ElectronDatabase?.escapeHtml || ((x)=>text(x).replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]))))(v); }
  function nowLabel(value){ try{ return value ? new Date(value).toLocaleString() : "Never"; }catch{ return "Unknown"; } }
  function latestContext(){
    const mgr=window.CardLabManager;
    return {
      result:mgr?.state?.lastAnalysis||null,
      report:mgr?.state?.exploreReport||null,
      source:mgr?.state?.lastSource||"",
      pm3Output:mgr?.state?.lastPm3Output||"",
      reportModel:mgr?.state?.reportModel||null
    };
  }
  function safeSignature(result){
    if(db()?.signatureFromAnalysis) return db().signatureFromAnalysis(result || {});
    const p=result?.parsed||{}; const m=result?.module||{};
    return {moduleId:m.id||"unknown",displayName:m.displayName||"Unknown card",technology:m.technology||"",protocol:m.protocol||"",family:m.family||"",application:m.application||"",confidence:result?.confidence||0,confidenceLevel:result?.confidenceLevel||"",uid:p.uid||"",atqa:p.atqa||"",sak:p.sak||"",ats:p.ats||"",hasAts:!!p.ats,typeHints:p.typeHints||[]};
  }
  function readCollection(){ return db()?.getResearch ? db().getResearch() : []; }
  function writeCollection(items){
    localStorage.setItem("electronResearchCollection.v1", JSON.stringify(Array.isArray(items)?items:[],null,2));
    refreshAll();
  }
  function findMatches(result){
    const sig=safeSignature(result);
    return db()?.getResearchBySignature ? db().getResearchBySignature(sig) : [];
  }
  function refreshResearchCounter(){
    const stats=db()?.statistics ? db().statistics() : {researchRecords:readCollection().length, knownByYou:0, cardSignatures:0, scanHistory:0};
    const map={electronResearchCountValue:stats.researchRecords,researchCountValue:stats.researchRecords,electronMemoryCountValue:stats.researchRecords,electronKnownByYouCountValue:stats.knownByYou,electronSignatureCountValue:stats.cardSignatures,electronScanHistoryCountValue:stats.scanHistory};
    Object.entries(map).forEach(([id,value])=>{ const el=document.getElementById(id); if(el) el.textContent=String(value); });
  }
  function refreshReportModel(reason="database-refresh"){
    if(window.CardLabManager?.rebuildReportModel) window.CardLabManager.rebuildReportModel(reason);
  }
  function refreshAll(){ refreshResearchCounter(); renderResearchLibrary(); injectKnownByYou(latestContext().result); refreshReportModel(); }

  function categoryFor(module){
    const id=module?.id||""; const app=(module?.application||"").toLowerCase();
    if(id==="emv_payment") return "Payment / identity smartcard";
    if(/access|badge/.test(app)) return "Access credential";
    if(/transport|ticket/.test(app)) return "Transport / ticket";
    if(/library|asset|vicinity/.test(app)) return "Library / asset tag";
    if(/nfc|sticker|url|text/.test(app)) return "NFC tag";
    if((module?.technology||"").includes("LF")) return "Low-frequency ID tag";
    return "RFID / NFC card";
  }
  function learnTopics(result){
    const m=result?.module||{}; const topics=[]; const tech=m.technology||"RFID"; const proto=m.protocol||m.family||"card technology";
    topics.push({title:`What is ${m.displayName||proto}?`, body:m.beginnerExplanation||m.summary||"Electron has loaded a knowledge module for this card family."});
    topics.push({title:`How ${tech} fits in`, body:"This tells Electron which radio family is being used. It helps choose safe tools and avoids running the wrong command family."});
    topics.push({title:"Why confidence matters", body:"Recognition Confidence is how strongly the scan output matches Electron's knowledge. A high result means the card family is likely correct; it does not mean all memory or security details are known."});
    if(m.id==="emv_payment") topics.push({title:"Safe handling", body:"Payment and identity-style smartcards should be treated as protected application cards. Electron keeps this workflow to safe identification and avoids write or clone guidance."});
    return topics;
  }
  function nextSafeQuestion(result){
    const id=result?.module?.id||"";
    if(id==="iso15693") return "What exact chip/block size does this vicinity card exposes?";
    if(id==="mifare_classic") return "Which sectors are readable with authorised keys or a legal dump?";
    if(id==="emv_payment") return "Is this a payment card or another secure identity-style smartcard?";
    if(id==="ntag21x"||id==="mifare_ultralight") return "Does this tag contain an NDEF text, URL, vCard or automation record?";
    if((result?.module?.technology||"").includes("LF")) return "Can Electron decode facility code and card number from the bitstream?";
    return "What safe metadata can identify this card more clearly next time?";
  }

  function readableCardData(result){
    if(db()?.extractReadableCardData) return db().extractReadableCardData(result || {});
    return {fields:[], availableCount:0, unavailableExpected:["Name","Issue date","Expiry date","Issuer","Card number"], notice:"Only information exposed by the card is shown."};
  }
  function renderReadableCardData(data, options={}){
    const fields = Array.isArray(data?.fields) ? data.fields : [];
    const compact = !!options.compact;
    const title = options.title || "Readable Card Data";
    const emptyMessage = data?.emptyMessage || "No readable personal fields were exposed by this card.";
    const empty = `<div class="electronReadableData ${compact?"compact":""}"><div class="electronSectionTitle"><b>${html(title)}</b><span>No exposed identity fields</span></div><p class="small">${html(emptyMessage)}</p><p class="small muted">Only data exposed by the card is shown. Protected or encrypted fields are not bypassed.</p></div>`;
    if(!fields.length) return empty;
    return `<div class="electronReadableData ${compact?"compact":""}"><div class="electronSectionTitle"><b>${html(title)}</b><span>${fields.length} field${fields.length===1?"":"s"} exposed</span></div><div class="electronReadableGrid">${fields.map(f=>`<div class="electronReadableField"><span>${html(f.label)}</span><b>${html(f.value)}</b></div>`).join("")}</div><p class="small muted">${html(data.notice || "Only information exposed by the card or decoded from safe scan output is shown. Protected fields are not bypassed.")}</p></div>`;
  }


  function currentSignature(result){
    const sig=safeSignature(result);
    return db()?.normaliseSignature ? db().normaliseSignature(sig) : sig;
  }
  function rememberRealScan(result, source){
    if(!result || !db()?.rememberScanFromAnalysis) return currentSignature(result);
    return db().rememberScanFromAnalysis(result, source || latestContext().source || "scan");
  }
  function supportLabel(value){
    return ({supported:"Supported",possible:"Possible",limited:"Limited",planned:"Planned",unknown:"Unknown"}[value] || value || "Unknown");
  }
  function renderSupportedDevices(devices=[]){
    if(!devices.length) return `<p class="small">No compatible device guidance has been recorded yet.</p>`;
    return `<div class="electronDeviceList">${devices.map(d=>`<div class="electronDeviceItem"><b>${html(d.name)}</b><span class="electronDevice_${html(d.support)}">${html(supportLabel(d.support))}</span><small>${html(d.note || "")}</small></div>`).join("")}</div>`;
  }
  function renderLfCardIntelligence(lfRecord){
    const lf=lfRecord?.parsed || null;
    if(!lf?.detected) return "";
    const primary=lf.primary || {};
    const alternatives=Array.isArray(lf.alternatives) ? lf.alternatives : [];
    const actions=[
      {key:"explore-t55xx", label:"Explore T55xx", commands:["lf t55xx detect","lf t55xx info","lf t55xx p1detect","lf t55xx config"]},
      {key:"read-hid", label:"Read HID", commands:["lf hid reader"]},
      {key:"save-raw", label:"Save Raw", commands:[]}
    ];
    return `<div class="electronLfIntel">
      <div class="electronSectionTitle"><b>LF Card Intelligence</b><span>${html(primary.format || "LF decode")}</span></div>
      <div class="electronCIGrid">
        <div class="electronCITile"><span>Primary decode</span><b>${html(primary.format || "Unknown LF format")}</b><small>${lf.primary ? "Valid HID Prox ID found" : "Best available LF interpretation"}</small></div>
        <div class="electronCITile"><span>Facility Code</span><b>${html(primary.facilityCode || lf.facilityCode || "Unknown")}</b><small>HID H10301 field</small></div>
        <div class="electronCITile"><span>Card Number</span><b>${html(primary.cardNumber || lf.cardNumber || "Unknown")}</b><small>HID H10301 field</small></div>
      </div>
      <div class="electronSavedBox"><span>Raw ID</span><b>${html(primary.rawId || lf.rawId || "Not available")}</b><small>${html(lf.source || "lf search")}</small></div>
      ${lf.t55xxHint?`<div class="electronSavedBox"><span>T55xx chipset hint</span><b>${html(lf.t55xxHint)}</b><small>Use read-only T55xx exploration commands before any write workflow.</small></div>`:""}
      <h4>Alternative interpretations</h4>
      ${alternatives.length?`<div class="electronAltList">${alternatives.map(a=>`<div><b>${html(a.type)}</b><small>${html(a.value)}</small></div>`).join("")}</div>`:`<p class="small">No alternative LF interpretations were reported by this scan.</p>`}
      <div class="electronLfActions">${actions.map(a=>`<button type="button" data-electron-action="lf-safe-action" data-lf-action="${html(a.key)}">${html(a.label)}</button>`).join("")}</div>
    </div>`;
  }
  function renderProtectedData(data){
    const fields=Array.isArray(data?.fields) ? data.fields : [];
    const access=data?.access || null;
    const rows=Array.isArray(access?.items) ? access.items : [];
    const keyRef=access?.keyReference;
    const lastRead=access?.lastRead || null;
    const readStats=lastRead?.stats || {};
    const readLabel=lastRead?.status==="success"
      ? `Key used successfully${readStats.totalSectors ? ` · ${readStats.readableSectors || 0} of ${readStats.totalSectors} sectors readable` : ""}`
      : lastRead?.status==="failed"
        ? "Key did not authenticate"
        : lastRead?.status==="reading"
          ? "Reading with authorized key..."
        : access.keyAvailable ? "Key available" : "Key required";
    const keyStatus=access?.detected ? `<div class="electronKeyStatus ${access.keyAvailable ? "keyAvailable" : ""} ${lastRead?.status==="success" ? "keyUsed" : ""} ${lastRead?.status==="failed" ? "keyFailed" : ""} ${lastRead?.status==="reading" ? "keyReading" : ""}"><b>Authorized decryption</b><span>${html(readLabel)}</span><small>${html(lastRead?.message || (keyRef ? `${keyRef.label || "Authorized key"} · ${keyRef.preview || keyRef.fingerprint || "local reference"}` : access.policy || "Decryption requires user-provided authorised keys."))}</small></div>` : "";
    const details=rows.length ? `<div class="electronProtectedRows">${rows.map(item=>`<div><b>${html(item.label)}</b><span>${html(item.keyUsed ? "key used" : item.keyAvailable ? "key available" : "locked")}</span><small>${html(item.authorization || "card-specific authorization")}${item.evidence?` · ${html(item.evidence)}`:""}</small></div>`).join("")}</div>` : "";
    return `<div class="electronProtectedData"><div class="electronSectionTitle"><b>${html(data?.title || "Protected / Not Exposed")}</b><span>${fields.length ? `${fields.length} item${fields.length===1?"":"s"}` : "Not exposed"}</span></div><p class="small">${html(data?.summary || "Electron does not bypass protected or encrypted card data.")}</p>${keyStatus}${fields.length?`<div class="electronProtectedPills">${fields.map(f=>`<span>${html(f)}</span>`).join("")}</div>`:""}${details}</div>`;
  }
  function renderAuthorizedReadDebug(read){
    if(!read) return "";
    const stats=read.stats || {};
    const fields=read.readableData?.fields || [];
    const commands=Array.isArray(read.commands) ? read.commands : [];
    const debug=read.debug || {};
    const outputSummary=debug.outputSummary || (read.output ? `${read.output.length} chars captured` : "No PM3 output captured yet");
    const fieldList=fields.length
      ? `<div class="electronDebugFields">${fields.map(f=>`<div><span>${html(f.label)}</span><b>${html(f.value)}</b><small>${html(f.source || "authorized-read")}</small></div>`).join("")}</div>`
      : `<p class="small">Authorized read completed, but no additional readable data was found.</p>`;
    const commandRows=commands.length
      ? commands.map((c,i)=>`<li><code>${html(c.command || `PM3 command ${i+1}`)}</code> — ${html(c.ok ? "authentication success" : "authentication failed / no data")} ${c.outputLength?`· ${html(c.outputLength)} chars`:""}</li>`).join("")
      : `<li>No PM3 command has completed yet.</li>`;
    return `<div class="electronAuthorizedDebug">
      <div class="electronSectionTitle"><b>Authorized read details</b><span>${html(read.status || "unknown")}</span></div>
      <div class="electronCIGrid">
        <div class="electronCITile"><span>Authentication</span><b>${html(read.status==="success" ? "Success" : read.status==="failed" ? "Failed" : "Reading")}</b><small>${html(read.message || "")}</small></div>
        <div class="electronCITile"><span>Sectors read</span><b>${html(stats.readableSectors ?? 0)} / ${html(stats.totalSectors ?? 0)}</b><small>${html(stats.additionalReadableFields ?? 0)} extracted fields</small></div>
        <div class="electronCITile"><span>PM3 calls</span><b>${html(debug.pm3Calls ?? commands.length)}</b><small>${html(outputSummary)}</small></div>
      </div>
      <details open><summary><b>PM3 command log</b></summary><ul>${commandRows}</ul></details>
      <details ${fields.length ? "open" : ""}><summary><b>Extracted readable fields</b></summary>${fieldList}</details>
      ${read.output?`<details><summary><b>Raw output / dump summary</b></summary><pre class="normalPre electronAuthorizedRaw">${html(read.output.slice(0, 6000))}</pre></details>`:""}
    </div>`;
  }
  function renderCardActions(intelligence, options={}){
    const actions=intelligence?.actions || {};
    const bestResearchId=actions.bestResearchId || intelligence?.researchMatches?.[0]?.record?.id || "";
    const compact=!!options.compact;
    const buttons=[`<button type="button" class="electronActionPrimary" data-electron-action="open-card-intelligence">Open Card Intelligence</button>`];
    if(actions.knownByElectron){
      buttons.push(`<button type="button" data-electron-action="known-by-you">${html(actions.knownByYouLabel || "Edit Known by You")}</button>`);
      if(bestResearchId) buttons.push(`<button type="button" data-electron-action="edit-research" data-id="${html(bestResearchId)}">${html(actions.researchLabel || "Edit Research")}</button>`);
    }else{
      buttons.push(`<button type="button" class="green" data-electron-action="teach-electron">${html(actions.teachLabel || "Teach Electron")}</button>`);
      buttons.push(`<button type="button" data-electron-action="known-by-you">${html(actions.knownByYouLabel || "Known by You")}</button>`);
    }
    return `<div class="electronCIActions ${compact?"compact":""}">${buttons.join("")}</div>`;
  }
  function renderCardIntelligence(result){
    if(!result || !db()?.getCardIntelligence) return "";
    const sig=currentSignature(result);
    const intelligence=db().getCardIntelligence(sig, result);
    const known=intelligence.knownByYou;
    const bestResearch=intelligence.researchMatches[0]?.record || null;
    const actions=intelligence.actions || {};
    const status=actions.status || (intelligence.summary.hasResearch || intelligence.summary.hasKnownByYou ? "Electron already knows this card" : "Electron is ready to learn this card");
    return `<div class="electronCardIntelligenceCard">
      <div class="electronCIHeader">
        <div><div class="atlasKicker">Card Intelligence</div><h3>${html(status)}</h3><p>${html(sig.displayName)} · ${html(sig.technology || "Unknown technology")}</p></div>
        <div class="electronCIConfidence"><b>${html(sig.confidenceLevel || "Unknown")}</b><small>confidence</small></div>
      </div>
      <div class="electronCIGrid">
        <div class="electronCITile"><span>Research Library</span><b>${intelligence.researchMatches.length}</b><small>${bestResearch ? html(bestResearch.name) : "No linked research yet"}</small></div>
        <div class="electronCITile"><span>Known by You</span><b>${known ? "Yes" : "No"}</b><small>${known ? html(known.nickname || known.owner || known.category || "Personal notes saved") : "Add personal context"}</small></div>
        <div class="electronCITile"><span>Seen</span><b>${intelligence.summary.seenCount}</b><small>${intelligence.lastSeenAt ? nowLabel(intelligence.lastSeenAt) : "First seen"}</small></div>
      </div>
      ${renderReadableCardData(intelligence.readableData || readableCardData(result), {compact:true})}
      ${renderCardActions(intelligence)}
    </div>`;
  }
  function renderKnownByYou(result){
    if(!result || !db()?.getCardIntelligence) return "";
    const sig=safeSignature(result);
    const intelligence=db().getCardIntelligence(sig);
    if(!intelligence.summary.hasResearch && !intelligence.summary.hasKnownByYou) return "";
    const known=intelligence.knownByYou;
    const research=intelligence.researchMatches[0]?.record;
    return `<div class="electronKnownByYou"><div><b>🧠 Known by Electron</b><p>${html(intelligence.researchMatches.length)} research record${intelligence.researchMatches.length===1?"":"s"}${known?" and your personal notes":""} match this scan.</p><small>${html(known?.nickname || research?.name || sig.displayName)} · ${html(known?.category || research?.use || sig.protocol || "RFID card")}</small></div><button type="button" data-electron-action="open-card-intelligence">Open Intelligence</button></div>`;
  }
  function renderLearnResearchPanel(result, report={}){
    const m=result?.module||{}; const collection=readCollection(); const topics=learnTopics(result).slice(0,3);
    const sig=currentSignature(result);
    const intelligence=db()?.getCardIntelligence ? db().getCardIntelligence(sig, result) : null;
    const actions=intelligence?.actions || {};
    const unknown=result?.status!=="identified" || (result?.confidence||0)<80;
    const researchText=actions.knownByElectron ? "Electron already has local context for this card. Open Card Intelligence or edit the linked record instead of teaching it again." : unknown ? "Electron could learn more from this card. Save a safe signature with your notes." : "Electron recognises this card, but you can still add real-world notes for future matching.";
    const researchButton=actions.knownByElectron && actions.bestResearchId
      ? `<button type="button" data-electron-action="edit-research" data-id="${html(actions.bestResearchId)}">Edit Research</button>`
      : actions.knownByElectron
        ? `<button type="button" data-electron-action="open-card-intelligence">Open Intelligence</button>`
        : `<button type="button" class="green" data-electron-action="teach-electron">Teach Electron</button>`;
    const knownButtonLabel=actions.knownByElectron ? "Edit Known by You" : "Add personal context";
    return `${renderCardIntelligence(result)}<div class="electronLearnResearchPanel">
      <div class="electronLRHero"><div><div class="atlasKicker">Electron Database · v0.8.0</div><h3>Learn about this card</h3><p>${html(m.displayName||"Unknown card")} · ${html(categoryFor(m))}</p></div><div class="electronResearchCount"><b id="electronResearchCountValue">${collection.length}</b><small>research records</small></div></div>
      <div class="electronLRGrid">
        <div class="atlasCard electronLearnCard"><b>Learn Mode</b><p>Electron explains the detected card technology in plain language.</p><div class="electronTopicList">${topics.map((t,i)=>`<button type="button" class="electronTopicBtn" data-electron-action="learn-topic" data-topic-index="${i}">${html(t.title)}</button>`).join("")}</div></div>
        <div class="atlasCard electronLearnCard"><b>Research Mode</b><p>${html(researchText)}</p><div class="electronResearchMini"><span>${html(result?.confidenceLevel||"Unknown")} confidence</span><span>${html(m.family||"Unknown family")}</span><span>${html(m.protocol||"Protocol unknown")}</span></div>${researchButton}</div>
        <div class="atlasCard electronLearnCard"><b>Known by You</b><p>Add or edit your own real-world context, such as owner, nickname, location and notes.</p><button type="button" data-electron-action="known-by-you">${html(knownButtonLabel)}</button><small>Stored locally in the Electron Database.</small></div>
      </div>
    </div>`;
  }
  function showLearnTopic(index){
    const {result}=latestContext(); const topic=learnTopics(result)[Number(index)] || learnTopics(result)[0]; if(!topic) return;
    if(window.UIEngine?.modal) window.UIEngine.modal({id:"electronLearnTopicModal", title:topic.title, body:`<p>${html(topic.body)}</p>`, size:"sm", buttons:[{text:"OK",variant:"primary"}]}); else alert(topic.title+"\n\n"+topic.body);
  }
  function openResearchRecord(id){
    if(typeof window.showTab === "function") window.showTab("research");
    renderResearchLibrary(id);
    setTimeout(()=>{ try{ const el=document.querySelector(`[data-research-record-id="${CSS.escape(id)}"]`); if(el){ el.scrollIntoView({behavior:"smooth",block:"center"}); el.classList.add("electronRecordJustSaved"); }}catch(e){ console.warn(e); } },100);
  }
  function showResearchSaved(item){
    const body=`<div class="electronSavedNotice"><div class="electronSavedHero"><b>Research record saved successfully</b><p>${html(item.name)} is now part of your local Electron knowledge.</p></div><div class="electronSavedBox"><span>Stored in</span><b>${ELECTRON_DB_LABEL}</b></div><p class="small">No separate file was created for you to manage. Electron stores this in its local database layer and will use the linked card signature for future matching. Nothing is uploaded automatically.</p></div>`;
    if(window.UIEngine?.modal) window.UIEngine.modal({id:"electronResearchSavedModal",title:"Saved to Electron Database",subtitle:"Research Library",body,size:"sm",buttons:[{text:"Continue",variant:"secondary"},{text:"Open Research Record",variant:"success",onClick:()=>{openResearchRecord(item.id); return true;}}]}); else alert(`Research record saved successfully.\n\nStored in: ${ELECTRON_DB_LABEL}`);
  }
  function openTeachWizard(){
    const ctx=latestContext(); const signature=safeSignature(ctx.result); const normal=db()?.normaliseSignature ? db().normaliseSignature(signature) : signature;
    const body=`<p class="small">Save a safe research record to the <b>Electron Database</b>. It will appear in your Research Library and can be used when Electron recognises this card again. Nothing is uploaded or shared automatically.</p><div class="electronTeachForm">
      <label>What is this card called?<input id="electronTeachName" placeholder="Example: Australian Driver Licence, Hotel key, Work badge" value="${html(normal.displayName !== "Unknown card" ? normal.displayName : "")}"></label>
      <label>What is it used for?<select id="electronTeachUse"><option>Unknown</option><option>Government ID / licence</option><option>Access</option><option>Payment</option><option>Transport</option><option>Hotel</option><option>Membership</option><option>Library / asset</option><option>NFC sticker</option><option>Other</option></select></label>
      <label>Notes<textarea id="electronTeachNotes" placeholder="Only add safe notes. Do not enter private numbers, payment data, keys or secrets."></textarea></label>
      <details><summary><b>Safe signature preview</b></summary><pre class="normalPre electronSignaturePreview">${html(JSON.stringify(normal,null,2))}</pre></details>
    </div>`;
    const saveRecord=()=>{
      const name=document.getElementById("electronTeachName")?.value.trim() || normal.displayName || "Unknown card";
      const use=document.getElementById("electronTeachUse")?.value || "Unknown";
      const notes=document.getElementById("electronTeachNotes")?.value.trim() || "";
      const item=db().saveResearch({name,use,notes,signature:normal,source:ctx.source,scanSummary:{commands:ctx.report?.commands||[],confidence:normal.confidence},readableCardData:readableCardData(ctx.result)});
      refreshAll(); showResearchSaved(item); return true;
    };
    if(window.UIEngine?.modal) window.UIEngine.modal({id:"electronTeachModal",title:"Teach Electron",subtitle:"Electron Database",body,size:"md",buttons:[{text:"Cancel",variant:"secondary"},{text:"Save research record",variant:"success",onClick:saveRecord}]});
  }
  function openKnownByYouWizard(options={}){
    const returnToCardIntelligence=!!options.returnToCardIntelligence;
    const ctx=latestContext(); const signature=db()?.normaliseSignature ? db().normaliseSignature(safeSignature(ctx.result)) : safeSignature(ctx.result); const existing=db()?.getKnownByYou(signature) || {};
    const body=`<p class="small">Known by You is your personal layer on top of Electron's technical recognition. It is stored locally in the <b>Electron Database</b>.</p><div class="electronTeachForm">
      <label>Nickname<input id="knownNickname" placeholder="Example: Front gate badge, Test keyfob" value="${html(existing.nickname||"")}"></label>
      <label>Owner / person<input id="knownOwner" placeholder="Example: Personal, Family, Work" value="${html(existing.owner||"")}"></label>
      <label>Category<select id="knownCategory"><option>${html(existing.category||"Unknown")}</option><option>Government ID</option><option>Access card</option><option>Membership</option><option>Transport</option><option>Hotel</option><option>Test card</option><option>Personal card</option><option>Other</option></select></label>
      <label>Location<input id="knownLocation" placeholder="Example: Wallet, keyring, office drawer" value="${html(existing.location||"")}"></label>
      <label>Tags<input id="knownTags" placeholder="Comma separated: wallet, licence, test" value="${html(Array.isArray(existing.tags)?existing.tags.join(", "):existing.tags||"")}"></label>
      <label>Personal notes<textarea id="knownNotes" placeholder="Safe personal notes. Do not store secrets, keys or private numbers.">${html(existing.notes||"")}</textarea></label>
    </div>`;
    const save=()=>{
      const tags=text(document.getElementById("knownTags")?.value).split(",").map(x=>x.trim()).filter(Boolean);
      const item=db().saveKnownByYou({
        signature,
        nickname:document.getElementById("knownNickname")?.value.trim()||"",
        owner:document.getElementById("knownOwner")?.value.trim()||"",
        category:document.getElementById("knownCategory")?.value||"Unknown",
        location:document.getElementById("knownLocation")?.value.trim()||"",
        tags,
        notes:document.getElementById("knownNotes")?.value.trim()||""
      });
      refreshAll();
      window.UIEngine?.toast && window.UIEngine.toast("Known by You saved to Electron Database.","success");
      if(returnToCardIntelligence) setTimeout(()=>openCardIntelligence(), 160);
      return true;
    };
    if(window.UIEngine?.modal) window.UIEngine.modal({id:"electronKnownByYouModal",title:"Known by You",subtitle:KNOWN_DB_LABEL,body,size:"md",buttons:[{text:"Cancel",variant:"secondary"},{text:"Save",variant:"success",onClick:save}]});
  }
  function openAuthorizedKeyWizard(options={}){
    const returnToCardIntelligence=!!options.returnToCardIntelligence;
    const ctx=latestContext();
    const signature=db()?.normaliseSignature ? db().normaliseSignature(safeSignature(ctx.result)) : safeSignature(ctx.result);
    const existing=db()?.getAuthorizedKeys ? db().getAuthorizedKeys(signature) : [];
    const familyEvidence=`${signature.moduleId || ""} ${signature.displayName || ""} ${signature.family || ""}`;
    const isDesfire=/desfire/i.test(familyEvidence);
    const isMifarePlus=/mifare[ _-]*plus|\bmfp\b/i.test(familyEvidence);
    const targetFields=isDesfire ? `<div class="electronTeachFormGrid">
      <label>Algorithm<select id="authorizedKeyAlgorithm">${["AES","2TDEA","3TDEA","DES"].map(value=>`<option ${existing[0]?.algorithm===value?"selected":""}>${value}</option>`).join("")}</select></label>
      <label>Key number<input id="authorizedKeyNumber" type="number" min="0" max="13" value="${html(existing[0]?.keyNumber ?? 0)}"></label>
      <label>Application AID<input id="authorizedKeyAid" maxlength="6" placeholder="123456" value="${html(existing[0]?.aid || "")}"></label>
      <label>File ID<input id="authorizedKeyFileId" maxlength="2" placeholder="01" value="${html(existing[0]?.fileId || "")}"></label>
      <label>Maximum bytes<input id="authorizedKeyReadLength" type="number" min="1" max="256" value="${html(existing[0]?.readLength || 256)}"></label>
    </div><p class="small muted">DESFire reads require an exact AID and file ID. Card Viewer will read at most 256 bytes and will not guess missing targets.</p>` : isMifarePlus ? `<div class="electronTeachFormGrid">
      <label>Sector<input id="authorizedKeySector" type="number" min="0" max="39" value="${html(existing[0]?.sector ?? 0)}"></label>
    </div><p class="small muted">MIFARE Plus requires a 16-byte AES key and an exact sector. Card Viewer reads only that selected sector.</p>` : "";
    const body=`<p class="small">Register a key you are authorised to use with this card. Electron does not crack, bypass, recover or guess keys. When requested, Electron can use this authorised key to retry readable sectors and update Card Intelligence.</p><div class="electronTeachForm">
      <label>Label<input id="authorizedKeyLabel" placeholder="Example: My test card sector key" value="${html(existing[0]?.label || "")}"></label>
      <label>Key type<select id="authorizedKeyType"><option>${html(existing[0]?.keyType || "authorised-card-key")}</option><option>MIFARE Classic sector key</option><option>Application key</option><option>Password / lock key</option><option>Issuer-provided key</option><option>Test card key</option><option>Other authorised key</option></select></label>
      <label>Key / reference<input id="authorizedKeyMaterial" autocomplete="off" placeholder="Paste only a key you are legally authorised to use"></label>
      ${targetFields}
      <p class="small muted">Stored locally in Electron. The key is used only for authorised reads; no cracking, guessing or key recovery is attempted.</p>
      <details><summary><b>Linked card signature</b></summary><pre class="normalPre electronSignaturePreview">${html(JSON.stringify(signature,null,2))}</pre></details>
    </div>`;
    const save=(readAfterSave=false)=>{
      const material=document.getElementById("authorizedKeyMaterial")?.value.trim() || "";
      const existingMaterial=existing[0]?.keyMaterial || "";
      if(!material && !existingMaterial){
        window.UIEngine?.toast && window.UIEngine.toast("Enter an authorised key or local key reference first.","warn");
        return false;
      }
      const selectedMaterial=(material || existingMaterial).replace(/[^0-9A-F]/gi,"").toUpperCase();
      if(isDesfire){
        const algorithm=document.getElementById("authorizedKeyAlgorithm")?.value || "AES";
        const expectedLength={DES:16,"2TDEA":32,"3TDEA":48,AES:32}[algorithm];
        const aid=(document.getElementById("authorizedKeyAid")?.value || "").replace(/[^0-9A-F]/gi,"").toUpperCase();
        const fileId=(document.getElementById("authorizedKeyFileId")?.value || "").replace(/[^0-9A-F]/gi,"").toUpperCase();
        if(selectedMaterial.length!==expectedLength || !/^[0-9A-F]{6}$/.test(aid) || !/^[0-9A-F]{2}$/.test(fileId)){
          window.UIEngine?.toast && window.UIEngine.toast("Enter a key matching the selected algorithm, a six-hex AID and a two-hex file ID.","warn");
          return false;
        }
      }
      if(isMifarePlus && !/^[0-9A-F]{32}$/.test(selectedMaterial)){
        window.UIEngine?.toast && window.UIEngine.toast("MIFARE Plus requires a 16-byte AES key (32 hex characters).","warn");
        return false;
      }
      const item=db().saveAuthorizedKey({
        signature,
        label:document.getElementById("authorizedKeyLabel")?.value.trim() || "Authorized key",
        keyType:document.getElementById("authorizedKeyType")?.value || "authorised-card-key",
        keyMaterial:material || existingMaterial,
        family:isDesfire?"desfire":isMifarePlus?"mifare-plus":"",
        algorithm:document.getElementById("authorizedKeyAlgorithm")?.value || "",
        keyNumber:document.getElementById("authorizedKeyNumber")?.value || null,
        aid:document.getElementById("authorizedKeyAid")?.value || "",
        fileId:document.getElementById("authorizedKeyFileId")?.value || "",
        readLength:document.getElementById("authorizedKeyReadLength")?.value || null,
        sector:document.getElementById("authorizedKeySector")?.value || null
      });
      refreshAll();
      window.UIEngine?.toast && window.UIEngine.toast("Authorized key reference saved to Electron Database.","success");
      if(readAfterSave){
        setTimeout(()=>runAuthorizedKeyRead(signature, item), 160);
        return true;
      }
      if(returnToCardIntelligence) setTimeout(()=>openCardIntelligence(), 160);
      return true;
    };
    const buttons=[{text:"Cancel",variant:"secondary"},{text:"Save key",variant:"primary",onClick:()=>save(false)}];
    if(!isDesfire && !isMifarePlus) buttons.push({text:"Save and read card",variant:"success",onClick:()=>save(true)});
    if(window.UIEngine?.modal) window.UIEngine.modal({id:"electronAuthorizedKeyModal",title:"Use Authorized Key",subtitle:"Electron Database → Authorized Keys",body,size:"md",buttons});
  }
  function authorisedReadCommands(signature, key){
    if(signature.moduleId !== "mifare_classic") return [];
    const cleanKey=text(key?.keyMaterial).replace(/[^0-9A-Fa-f]/g, "").toUpperCase();
    if(!/^[0-9A-F]{12}$/.test(cleanKey) && !/^[0-9A-F]{32}$/.test(cleanKey)) return [];
    return Array.from({length:16}, (_, sector)=>`hf mf rdsc -s ${sector} -k ${cleanKey}`);
  }
  function commandAuthenticated(output){
    const t=text(output);
    if(/auth(?:entication)?\s+failed|key did not authenticate|wrong key|permission denied|can't authenticate|cannot authenticate|failed/i.test(t)) return false;
    return /block|data|sector|^\s*[0-9a-f]{2}(?:\s+[0-9a-f]{2}){3,}/im.test(t);
  }
  function maskAuthorizedCommand(command){
    return text(command).replace(/(-k\s+)[0-9A-Fa-f]+/g, "$1••••");
  }
  function maskAuthorizedOutput(output, key){
    const cleanKey=text(key?.keyMaterial).replace(/[^0-9A-Fa-f]/g, "").toUpperCase();
    let masked=text(output);
    if(cleanKey) masked = masked.replace(new RegExp(cleanKey, "ig"), "••••");
    return masked;
  }
  async function runAuthorizedKeyRead(signature, key){
    if(!window.pm3api?.runPm3LiveCommand){
      window.UIEngine?.toast && window.UIEngine.toast("PM3 command runner is not available.","warn");
      return;
    }
    const commands=authorisedReadCommands(signature, key);
    if(!commands.length){
      window.UIEngine?.toast && window.UIEngine.toast("Authorized read currently supports MIFARE Classic hex keys.","warn");
      return;
    }
    const ready=window.DeviceGuard?.ensure ? await window.DeviceGuard.ensure({workflow:"Authorized key read", capabilities:["hf"]}) : {ok:true};
    if(!ready?.ok) return;
    db().saveAuthorizedReadResult({
      signature,
      keyId:key.id,
      status:"reading",
      message:"Reading with authorized key...",
      stats:{readableSectors:0,totalSectors:commands.length,additionalReadableFields:0},
      commands:[],
      output:"",
      debug:{pm3Invoked:false, pm3Calls:0, outputSummary:"Waiting for PM3 output"},
      readableData:db().extractReadableCardData({parsed:{raw:""}, module:signature})
    });
    refreshAll();
    setTimeout(()=>openCardIntelligence(), 120);
    window.UIEngine?.toast && window.UIEngine.toast("Reading card with authorized key...","info");
    const outputs=[];
    const commandLog=[];
    let readableSectors=0;
    let pm3Calls=0;
    for(const [index, command] of commands.entries()){
      const safety=window.Pm3CommandSafety?.validate ? window.Pm3CommandSafety.validate(command, {context:"authorized-read"}) : {allowed:true};
      if(!safety.allowed){
        commandLog.push({command:maskAuthorizedCommand(command), ok:false, pm3Ok:false, message:`Command blocked: ${safety.reason}`, outputLength:0});
        outputs.push(`\n[Electron authorized read]\n${maskAuthorizedCommand(command)}\nCommand blocked: ${safety.reason}`);
        break;
      }
      const maskedCommand=maskAuthorizedCommand(command);
      console.info(`[Electron Authorized Read] running ${index+1}/${commands.length}: ${maskedCommand}`);
      const result=window.DeviceGuard?.runLiveCommand
        ? await window.DeviceGuard.runLiveCommand(command, {workflow:"Authorized key read", silent:true})
        : await window.pm3api.runPm3LiveCommand(command);
      pm3Calls += 1;
      const output=maskAuthorizedOutput((result?.stdout || "") + (result?.stderr || ""), key);
      const ok=!!result?.ok && commandAuthenticated(output);
      if(ok) readableSectors += 1;
      commandLog.push({command:maskedCommand, ok, pm3Ok:!!result?.ok, message:result?.message || "", outputLength:output.length});
      outputs.push(`\n[Electron authorized read]\n${maskedCommand}\n${output}`);
      window.electronAppendPm3Terminal?.(`\n[Electron authorized read]\n${maskedCommand}\n${output}\n`, {forceScroll:true});
    }
    const combined=outputs.join("\n");
    const readableData=db().extractReadableCardData({parsed:{raw:combined}, module:signature});
    const status=readableSectors > 0 ? "success" : "failed";
    const message=status==="success"
      ? readableData.availableCount > 0
        ? `${readableSectors} of ${commands.length} sectors readable. ${readableData.availableCount} readable field${readableData.availableCount===1?"":"s"} extracted.`
        : `${readableSectors} of ${commands.length} sectors readable. No additional readable data found.`
      : "Key did not authenticate.";
    const authLabel=status==="success" ? "Authentication success" : "Authentication failed";
    db().saveAuthorizedReadResult({
      signature,
      keyId:key.id,
      status,
      message:`${authLabel}. ${message}`,
      stats:{readableSectors,totalSectors:commands.length,additionalReadableFields:readableData.availableCount},
      commands:commandLog,
      output:combined,
      debug:{
        pm3Invoked:pm3Calls > 0,
        pm3Calls,
        outputLength:combined.length,
        outputSummary:combined ? `${combined.length} chars captured from ${pm3Calls} PM3 command${pm3Calls===1?"":"s"}` : "No PM3 output captured"
      },
      readableData
    });
    refreshAll();
    window.UIEngine?.toast && window.UIEngine.toast(`${authLabel}. ${message}`, status==="success" ? "success" : "warn");
    setTimeout(()=>openCardIntelligence(), 180);
  }
  async function exportCurrentCardReport(format){
    if(reportExportInFlight){
      window.UIEngine?.toast && window.UIEngine.toast("Report export is already open.", "warn");
      return;
    }
    const ctx=latestContext();
    const sig=currentSignature(ctx.result);
    const intelligence=db()?.getCardIntelligence(sig, ctx.result);
    if(!window.CardReportBuilder?.build){
      window.UIEngine?.toast && window.UIEngine.toast("Report builder is not available.", "warn");
      return;
    }
    if(!window.pm3api?.exportCardReport){
      window.UIEngine?.toast && window.UIEngine.toast("Report export is not available.", "warn");
      return;
    }
    const buttons=Array.from(document.querySelectorAll("[data-report-format]"));
    reportExportInFlight=true;
    buttons.forEach(btn=>{ btn.disabled=true; btn.setAttribute("aria-busy","true"); });
    try{
      const reportModel=window.CardLabManager?.rebuildReportModel?.("export-refresh") || window.CardLabManager?.getReportModel?.() || ctx.reportModel;
      const report=reportModel?.export || window.CardReportBuilder.build({result:ctx.result, intelligence, context:ctx});
      const result=await window.pm3api.exportCardReport({
        format,
        baseName:report.baseName,
        title:report.title,
        text:report.text,
        html:report.html,
        pdfHtml:report.pdfHtml,
        json:report.json,
        reportFormatVersion:report.reportFormatVersion
      });
      if(result?.ok){
        window.UIEngine?.toast && window.UIEngine.toast(`Report exported: ${result.filename}`, "success");
      }else if(!result?.canceled){
        window.UIEngine?.toast && window.UIEngine.toast(result?.message || "Report export failed.", "warn");
      }
    }finally{
      reportExportInFlight=false;
      buttons.forEach(btn=>{ btn.disabled=false; btn.removeAttribute("aria-busy"); });
    }
  }
  function openExportReportWizard(){
    const ctx=latestContext();
    const sig=currentSignature(ctx.result);
    const body=`<div class="electronReportExportChoice">
      <p class="small">Create a complete local report for the current card. The report includes scan results, Card Intelligence, Known by You, readable data, protected-data summary, safe actions, technical details and PM3 output where available.</p>
      <div class="electronReportFormatGrid">
        <button type="button" class="electronReportFormat" data-report-format="txt"><b>TXT</b><span>Plain technical report</span></button>
        <button type="button" class="electronReportFormat" data-report-format="doc"><b>DOC</b><span>Word-compatible editable report</span></button>
        <button type="button" class="electronReportFormat" data-report-format="pdf"><b>PDF</b><span>Clean archive / print report</span></button>
      </div>
      <details><summary><b>Current card</b></summary><pre class="normalPre electronSignaturePreview">${html(JSON.stringify(sig,null,2))}</pre></details>
    </div>`;
    if(window.UIEngine?.modal){
      window.UIEngine.modal({id:"electronExportReportModal",title:"Export Full Card Report",subtitle:"TXT · DOC · PDF",body,size:"md",buttons:[{text:"Close",variant:"secondary"}]});
    }
  }

  function openCardIntelligence(){
    const ctx=latestContext(); const sig=currentSignature(ctx.result); const intelligence=db()?.getCardIntelligence(sig, ctx.result); if(!intelligence) return;
    const known=intelligence.knownByYou; const research=intelligence.researchMatches; const actions=intelligence.actions || {};
    const canUseAuthorizedKey=!!intelligence.protectedData?.access?.detected || sig.moduleId==="mifare_classic";
    const keyWithMaterial=intelligence.authorizedKeys?.find(k=>k.hasKeyMaterial);
    const footer=[{text:"Close",variant:"secondary"}];
    footer.push({text:"Export Report",variant:"primary",onClick:()=>{openExportReportWizard(); return false;}});
    if(canUseAuthorizedKey) footer.push({text:"Use Authorized Key",variant:keyWithMaterial?"success":"primary",onClick:()=>{ if(keyWithMaterial) runAuthorizedKeyRead(sig, keyWithMaterial); else openAuthorizedKeyWizard({returnToCardIntelligence:true}); return false;}});
    footer.push({text:known ? "Edit Known by You" : "Add Known by You",variant:"primary",onClick:()=>{openKnownByYouWizard({returnToCardIntelligence:true}); return false;}});
    if(actions.bestResearchId) footer.push({text:"Edit Research",variant:"success",onClick:()=>{editRecord(actions.bestResearchId,{returnToCardIntelligence:true}); return false;}});
    else if(actions.showTeach) footer.push({text:"Teach Electron",variant:"success",onClick:()=>{openTeachWizard(); return true;}});
    const body=`<div class="electronCardIntelModal">
      <div class="electronCIHumanSummary">
        <div><span>What Electron thinks</span><h3>${html(sig.displayName || "Unknown card")}</h3><p>${html(sig.application || sig.family || sig.protocol || "Electron has a partial card identity from the current scan.")}</p></div>
        <div class="electronCIConfidence"><b>${html(sig.confidenceLevel || "Unknown")}</b><small>confidence</small></div>
      </div>
      <div class="electronCIGrid"><div class="electronCITile"><span>Research Records</span><b>${research.length}</b></div><div class="electronCITile"><span>Known by You</span><b>${known?"Yes":"No"}</b></div><div class="electronCITile"><span>Seen</span><b>${intelligence.summary.seenCount}</b><small>Only real scans are counted</small></div></div>
      ${renderReadableCardData(intelligence.readableData || readableCardData(ctx.result))}
      ${renderLfCardIntelligence(intelligence.lfCardIntelligence)}
      ${renderProtectedData(intelligence.protectedData)}
      ${intelligence.authorizedRead?`<div class="electronSavedBox"><span>Authorized read result</span><b>${html(intelligence.authorizedRead.message || "Authorized read complete")}</b><small>${html(nowLabel(intelligence.authorizedRead.createdAt))}</small></div>`:""}
      ${renderAuthorizedReadDebug(intelligence.authorizedRead)}
      <h4>Known by You</h4>${known?`<p><b>${html(known.nickname||known.owner||"Personal context")}</b><br>${html(known.category||"")} ${known.location?"· "+html(known.location):""}</p>${known.notes?`<p class="small">${html(known.notes)}</p>`:""}`:`<p class="small">No personal context saved yet.</p>`}
      <h4>Research Library</h4>${research.length?research.map(m=>`<div class="electronIntelResearchRow"><b>${html(m.record.name)}</b><small>${html(m.record.use||"Unknown")} · match ${m.score}%</small></div>`).join(""):`<p class="small">No linked research records yet.</p>`}
      <h4>Compatible devices</h4>${renderSupportedDevices(intelligence.supportedDevices)}
      <details class="electronTechnicalDetails"><summary>Technical details</summary><div class="electronSavedBox"><span>Card signature</span><b>${html(sig.signatureId || "Unknown")}</b><small>${html(sig.displayName)} · ${html(sig.technology || "Unknown technology")} · ${html(sig.protocol || "Unknown protocol")}</small></div></details>
    </div>`;
    window.UIEngine?.modal({id:"electronCardIntelligenceModal",title:"Card Intelligence",subtitle:"Electron Database",body,size:"lg",buttons:footer});
  }
  function injectKnownByYou(result){
    const box=document.getElementById("atlasIntelligenceOutput"); if(!box||!result) return;
    const old=box.querySelector(".electronKnownByYou"); if(old) old.remove();
    const block=renderKnownByYou(result); if(!block) return;
    box.insertAdjacentHTML("afterbegin", block);
  }
  function lfActionCommands(action){
    if(action==="explore-t55xx") return {name:"Explore T55xx", commands:["lf t55xx detect","lf t55xx info","lf t55xx p1detect","lf t55xx config"]};
    if(action==="read-hid") return {name:"Read HID", commands:["lf hid reader"]};
    return {name:"Save Raw", commands:[]};
  }
  function putLfCommandsInLivePm3(set){
    if(window.ElectronDatabase?.saveCommandSet){
      window.ElectronDatabase.saveCommandSet({name:set.name,commands:set.commands,continueOnError:true});
    }
    if(typeof window.showTab === "function") window.showTab("live");
    setTimeout(()=>{
      const name=document.getElementById("commandSetName");
      const commands=document.getElementById("commandSetCommands");
      const cont=document.getElementById("commandSetContinue");
      const details=document.querySelector("#tab-live .commandSetPanel");
      if(details) details.open=true;
      if(name) name.value=set.name;
      if(commands) commands.value=set.commands.join("\n");
      if(cont) cont.checked=true;
      const status=document.getElementById("commandSetStatus");
      if(status) status.textContent=`Prepared ${set.name}. Review and click Run Selected Command Set.`;
      window.HelpEngine?.refresh?.();
    }, 80);
  }
  function prepareLfSafeAction(action){
    const ctx=latestContext();
    const sig=currentSignature(ctx.result);
    if(action==="save-raw"){
      const raw=ctx.result?.parsed?.raw || ctx.pm3Output || "";
      const item=db()?.saveLfCardIntelligence ? db().saveLfCardIntelligence(sig, raw) : null;
      window.UIEngine?.toast && window.UIEngine.toast(item ? "LF raw intelligence saved to Electron Database." : "No LF raw output found to save.","success");
      refreshAll();
      setTimeout(()=>openCardIntelligence(), 120);
      return;
    }
    const set=lfActionCommands(action);
    if(!set.commands.length){
      window.UIEngine?.toast && window.UIEngine.toast("No runnable commands are defined for this LF action yet.","warn");
      return;
    }
    const outputId=`lfActionOutput_${Date.now()}`;
    const run=async(button)=>{
      const out=document.getElementById(outputId);
      if(button){ button.disabled=true; button.textContent="Running..."; }
      let all="";
      const ready=window.DeviceGuard?.ensure ? await window.DeviceGuard.ensure({workflow:set.name || "LF action", capabilities:["lf"]}) : {ok:true};
      if(!ready?.ok){
        if(out) out.textContent="Device unavailable. Connect a compatible RFID reader and try again.";
        if(button){ button.disabled=false; button.textContent="Run read-only commands"; }
        return;
      }
      for(const command of set.commands){
        const safety=window.Pm3CommandSafety?.validate ? window.Pm3CommandSafety.validate(command, {context:"lf-action"}) : {allowed:true};
        if(!safety.allowed){
          all+=`\n> ${command}\nCommand blocked: ${safety.reason}\n`;
          window.electronMirrorPm3Command?.(command,`Command blocked: ${safety.reason}`,{ok:false,source:set.name});
          break;
        }
        if(out) out.textContent=all+`\n> ${command}\nRunning...\n`;
        let result;
        try{
          result=window.DeviceGuard?.runLiveCommand
            ? await window.DeviceGuard.runLiveCommand(command, {workflow:set.name || "LF action", silent:true})
            : await window.pm3api.runPm3LiveCommand(command);
        }catch(err){
          result={ok:false,message:String(err),stdout:"",stderr:""};
        }
        const text=(result.stdout||"")+(result.stderr||"")+(result.message&&!result.stdout&&!result.stderr?result.message:"");
        all+=`\n> ${command}\n${text||"No output returned."}\n`;
        window.electronMirrorPm3Command?.(command,text||"No output returned.",{ok:!!result.ok,source:set.name});
        if(!result.ok) break;
      }
      if(out) out.textContent=all.trim()||"No output returned.";
      if(button){ button.disabled=false; button.textContent="Run read-only commands"; }
    };
    const body=`<p class="small">Review the read-only LF commands before running them. Output stays here and is mirrored to Live PM3.</p>
      <div class="electronCommandPreview">
        <b>Commands to run</b>
        <pre class="normalPre">${html(set.commands.join("\n"))}</pre>
      </div>
      <pre id="${outputId}" class="normalPre electronInlineCommandOutput">Ready. Choose Run read-only commands, or send this list to Live PM3 Command Sets for manual review.</pre>`;
    if(window.UIEngine?.modal){
      window.UIEngine.modal({
        id:"electronLfActionRunModal",
        title:set.name,
        subtitle:"LF safe workflow",
        body,
        size:"lg",
        buttons:[
          {text:"Close",variant:"secondary"},
          {text:"Open in Live PM3",variant:"primary",onClick:()=>{putLfCommandsInLivePm3(set); return true;}},
          {text:"Run read-only commands",variant:"success",close:false,onClick:async({button})=>{await run(button); return false;}}
        ]
      });
    }else{
      putLfCommandsInLivePm3(set);
    }
  }
  function editRecord(id, options={}){
    const returnToCardIntelligence=!!options.returnToCardIntelligence;
    const item=db()?.getResearchById(id); if(!item) return;
    const body=`<div class="electronTeachForm"><label>Name<input id="researchEditName" value="${html(item.name)}"></label><label>Use<select id="researchEditUse"><option>${html(item.use||"Unknown")}</option><option>Government ID / licence</option><option>Access</option><option>Payment</option><option>Transport</option><option>Hotel</option><option>Membership</option><option>Library / asset</option><option>NFC sticker</option><option>Other</option></select></label><label>Notes<textarea id="researchEditNotes">${html(item.notes||"")}</textarea></label></div>`;
    const save=()=>{ const updated=Object.assign({},item,{name:document.getElementById("researchEditName").value.trim()||item.name,use:document.getElementById("researchEditUse").value||item.use,notes:document.getElementById("researchEditNotes").value.trim()}); db().saveResearch(updated); refreshAll(); window.UIEngine?.toast && window.UIEngine.toast("Research record updated.","success"); if(returnToCardIntelligence) setTimeout(()=>openCardIntelligence(), 160); return true; };
    window.UIEngine?.modal({id:"researchEditModal",title:"Edit research record",body,size:"md",buttons:[{text:"Cancel",variant:"secondary"},{text:"Save",variant:"success",onClick:save}]});
  }
  function deleteRecord(id){
    const item=db()?.getResearchById(id); if(!item) return;
    const doDelete=()=>{ db().deleteResearch(id); refreshAll(); window.UIEngine?.toast && window.UIEngine.toast("Research record deleted.","success"); };
    if(window.UIEngine?.confirm) window.UIEngine.confirm({title:"Delete research record?",body:`Delete <b>${html(item.name)}</b>?<p class="small">This removes it from the Electron Database → Research Library.</p>`,confirmText:"Delete",danger:true}).then(ok=>{if(ok)doDelete();}); else if(confirm("Delete research record?")) doDelete();
  }
  function renderResearchLibrary(highlightId){
    const panel=document.getElementById("electronResearchLibrary"); if(!panel) return;
    const items=readCollection(); const statsEl=document.getElementById("electronResearchStats"); const stats=db()?.statistics ? db().statistics() : {researchRecords:items.length,knownByYou:0,cardSignatures:0,scanHistory:0,health:"OK"};
    if(statsEl){ statsEl.innerHTML=`<div class="card"><span>Research</span><b>${stats.researchRecords}</b></div><div class="card"><span>Known by You</span><b>${stats.knownByYou}</b></div><div class="card"><span>Signatures</span><b>${stats.cardSignatures}</b></div><div class="card"><span>Scans</span><b>${stats.scanHistory}</b></div>`; }
    if(!items.length){ panel.innerHTML=`<div class="atlasHero atlasHeroEmpty"><div><div class="atlasKicker">Electron Database → Research Library</div><h3>No research records yet</h3><p>Use <b>Teach Electron</b> after scanning a card to build your local knowledge library.</p><p class="small">Research records are stored locally inside Electron and shown as part of the Electron Database.</p></div></div>`; return; }
    panel.innerHTML=`<div class="electronStorageBanner"><b>Stored in:</b> Electron Database <span>Research Library, Known by You, signatures and scan history are all local to this app.</span></div><div class="electronResearchList">${items.map(item=>`<div class="electronResearchRecord ${item.id===highlightId?"electronRecordJustSaved":""}" data-research-record-id="${html(item.id)}"><div><b>${html(item.name)}</b><p>${html(item.use||"Unknown")} · ${html(item.signature?.displayName||"Unknown card")}</p><small>${html(nowLabel(item.createdAt))} · ${html(item.signature?.technology||"")} · ${html(item.signature?.protocol||"")}</small><div class="electronRecordStorage"><b>Stored in:</b> Electron Database → Research Library</div><div class="electronRecordStorage"><b>Signature:</b> ${html(item.signatureId || item.signature?.signatureId || "Not linked")}</div>${item.readableCardData?.availableCount?`<div class="electronRecordStorage"><b>Readable data:</b> ${html(item.readableCardData.availableCount)} exposed field${item.readableCardData.availableCount===1?"":"s"}</div>`:""}${item.notes?`<p class="small">${html(item.notes)}</p>`:""}</div><div class="toolbar compactToolbar"><button data-electron-action="edit-research" data-id="${html(item.id)}">Edit</button><button class="bad" data-electron-action="delete-research" data-id="${html(item.id)}">Delete</button></div></div>`).join("")}</div>`;
  }
  function exportResearchCollection(){
    const data=db()?.exportAll ? db().exportAll() : {version:1,createdAt:new Date().toISOString(),records:readCollection()};
    const blob=new Blob([JSON.stringify(data,null,2)],{type:"application/json"}); const a=document.createElement("a"); a.href=URL.createObjectURL(blob); a.download="electron-database-memory-export.json"; document.body.appendChild(a); a.click(); a.remove(); setTimeout(()=>URL.revokeObjectURL(a.href),1000);
  }
  function installDirectHandlers(){ refreshResearchCounter(); renderResearchLibrary(); injectKnownByYou(latestContext().result); }
  document.addEventListener("click",e=>{
    const reportFormat=e.target.closest("[data-report-format]");
    if(reportFormat){ e.preventDefault(); e.stopPropagation(); exportCurrentCardReport(reportFormat.dataset.reportFormat || "txt"); return; }
    const teachDirect=e.target.closest("button[data-electron-action=\"teach-electron\"], .electronTeachButton");
    if(teachDirect){ e.preventDefault(); e.stopPropagation(); openTeachWizard(); return; }
    const el=e.target.closest("[data-electron-action]"); if(!el) return; const action=el.dataset.electronAction;
    if(action==="learn-topic"){ e.preventDefault(); e.stopPropagation(); showLearnTopic(el.dataset.topicIndex); }
    if(action==="export-research"){ e.preventDefault(); exportResearchCollection(); }
    if(action==="edit-research"){ e.preventDefault(); editRecord(el.dataset.id); }
    if(action==="delete-research"){ e.preventDefault(); deleteRecord(el.dataset.id); }
    if(action==="known-by-you"){ e.preventDefault(); openKnownByYouWizard(); }
    if(action==="open-card-intelligence"){ e.preventDefault(); openCardIntelligence(); }
    if(action==="export-report"){ e.preventDefault(); openExportReportWizard(); }
    if(action==="lf-safe-action"){ e.preventDefault(); prepareLfSafeAction(el.dataset.lfAction); }
  });
  document.addEventListener("electron-database-changed",()=>refreshResearchCounter());
  function init(){ refreshAll(); const exp=document.getElementById("electronResearchExportBtn"); if(exp) exp.onclick=exportResearchCollection; }
  if(document.readyState==="loading") document.addEventListener("DOMContentLoaded", init); else init();
  window.ElectronResearchManager={renderLearnResearchPanel,openTeachWizard,openKnownByYouWizard,openAuthorizedKeyWizard,openCardIntelligence,openExportReportWizard,exportCurrentCardReport,readCollection,writeCollection,exportResearchCollection,safeSignature,currentSignature,rememberRealScan,installDirectHandlers,refreshResearchCounter,renderResearchLibrary,findMatches,renderKnownByYou,injectKnownByYou,readableCardData,renderReadableCardData};
  window.openTeachElectronWizard=openTeachWizard;
})();
