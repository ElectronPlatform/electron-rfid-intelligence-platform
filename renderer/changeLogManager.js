/*
 * Change Log Manager
 * Handles compact log rendering and the full diff-viewer modal.
 */

function tryParseLogJson(value){
  const raw=String(value || "");
  if(!raw) return null;
  try{
    return JSON.parse(raw);
  }catch(_){
    return null;
  }
}

function formatLogDiffValue(value){
  if(value === undefined) return "";
  if(value === null) return "null";
  if(typeof value === "object") return JSON.stringify(value, null, 2);
  return String(value);
}

function sameLogValue(a, b){
  return JSON.stringify(a) === JSON.stringify(b);
}

function buildLogDiffHtml(oldValue, newValue){
  const oldObj=tryParseLogJson(oldValue);
  const newObj=tryParseLogJson(newValue);

  if(oldObj && newObj && !Array.isArray(oldObj) && !Array.isArray(newObj) && typeof oldObj === "object" && typeof newObj === "object"){
    const keys=[...new Set([...Object.keys(oldObj), ...Object.keys(newObj)])];

    let changedCount=0;
    const rows=keys.map(key=>{
      const oldHas=Object.prototype.hasOwnProperty.call(oldObj, key);
      const newHas=Object.prototype.hasOwnProperty.call(newObj, key);
      const changed=(!oldHas || !newHas || !sameLogValue(oldObj[key], newObj[key]));
      if(changed) changedCount++;

      const label=(typeof labels!=="undefined" && labels[key]) ? labels[key] : key;
      const oldText=oldHas ? formatLogDiffValue(oldObj[key]) : "";
      const newText=newHas ? formatLogDiffValue(newObj[key]) : "";
      const oldClass=changed ? "diffOldChanged" : "diffSame";
      const newClass=changed ? "diffNewChanged" : "diffSame";

      return `<div class="logDiffRow ${changed ? "diffChangedRow" : "diffUnchangedRow"}">
        <div class="logDiffKey">${tableEscape(label)}</div>
        <pre class="logDiffValue ${oldClass}">${tableEscape(oldText)}</pre>
        <pre class="logDiffValue ${newClass}">${tableEscape(newText)}</pre>
      </div>`;
    }).join("");

    return `<div class="logDiffSummary" style="display:flex;gap:12px;align-items:center;justify-content:space-between;flex-wrap:wrap;">
        <span>${changedCount} changed field${changedCount===1?"":"s"}</span>
        <span>
          <button id="showAllDeltaFieldsBtn" class="deltaToggleBtn" disabled>Showing all fields</button>
          <button id="showOnlyDeltaChangesBtn" class="deltaToggleBtn">Show only changes</button>
        </span>
      </div>
      <div class="logDiffGrid deltaShowAll">
        <div class="logDiffHead logDiffKeyHead">Field</div>
        <div class="logDiffHead previousLabel">Previous</div>
        <div class="logDiffHead newLabel">New</div>
        ${rows}
      </div>`;
  }

  return `<div class="logDiffSummary">Raw value comparison</div>
    <div class="logDiffRawGrid">
      <div class="logDiffHead previousLabel">Previous</div>
      <div class="logDiffHead newLabel">New</div>
      <pre class="logDiffRaw diffOldChanged">${tableEscape(formatLogDiffValue(oldObj ?? oldValue))}</pre>
      <pre class="logDiffRaw diffNewChanged">${tableEscape(formatLogDiffValue(newObj ?? newValue))}</pre>
    </div>`;
}

function ensureLogDetailModal(){
  let modal=document.getElementById("logDetailModal");
  if(modal) return modal;

  modal=document.createElement("div");
  modal.id="logDetailModal";
  modal.className="logDetailModal hidden";
  modal.innerHTML=`
    <div class="logDetailCard">
      <div class="logDetailHeader">
        <h3>Change details</h3>
        <button id="closeLogDetailBtn">Close</button>
      </div>
      <div class="logDetailBody" id="logDetailBody"></div>
    </div>`;
  document.body.appendChild(modal);

  modal.addEventListener("click", e=>{
    if(e.target===modal) modal.classList.add("hidden");
  });
  document.getElementById("closeLogDetailBtn").onclick=()=>modal.classList.add("hidden");

  return modal;
}

function showLogDetail(oldValue, newValue){
  const modal=ensureLogDetailModal();
  const header=modal.querySelector(".logDetailHeader h3");
  if(header) header.textContent="Change details";
  document.getElementById("logDetailBody").innerHTML=buildLogDiffHtml(oldValue, newValue);
  modal.classList.remove("hidden");
  setupDeltaFieldToggle();
}

function showDeltaDetail(title, subtitle, oldValue, newValue){
  const modal=ensureLogDetailModal();
  const header=modal.querySelector(".logDetailHeader h3");
  if(header) header.textContent=title || "Change details";

  const body=document.getElementById("logDetailBody");
  body.innerHTML=
    (subtitle ? `<div class="logDiffSummary">${tableEscape(subtitle)}</div>` : "") +
    buildLogDiffHtml(oldValue, newValue);

  modal.classList.remove("hidden");
  setupDeltaFieldToggle();
}

function parseLogSummaryValue(value){
  const raw=String(value || "").trim();
  if(!raw) return null;
  try{
    const parsed=JSON.parse(raw);
    return parsed && typeof parsed==="object" ? parsed : null;
  }catch{
    return null;
  }
}

function logSummaryLabel(key){
  const known={
    assetId:"RFID Tag ID",
    alias:"Alias / Name",
    currentUid:"Current UID",
    originalUid:"Original UID",
    type:"Type",
    status:"Status",
    backupStatus:"Backup status",
    backupFiles:"Backup files",
    photo:"Photo"
  };
  return known[key] || String(key || "").replace(/([a-z])([A-Z])/g,"$1 $2");
}

function shortLogValue(value){
  const raw=String(value || "").trim();
  const parsed=parseLogSummaryValue(raw);
  if(parsed && !Array.isArray(parsed)){
    if(parsed.name && parsed.mime){
      const dimensions=parsed.originalDimensions ? ` · ${parsed.originalDimensions}` : "";
      return `${parsed.name}${dimensions}`;
    }
    const identity=[parsed.assetId,parsed.alias].filter(Boolean).join(" · ");
    if(identity) return identity;
    return `${Object.keys(parsed).length} fields`;
  }
  if(Array.isArray(parsed)) return `${parsed.length} items`;
  return raw.length>72 ? `${raw.slice(0,69)}…` : raw;
}

function logChangeSummary(oldValue,newValue){
  const oldRaw=String(oldValue || "").trim();
  const newRaw=String(newValue || "").trim();
  const oldParsed=parseLogSummaryValue(oldRaw);
  const newParsed=parseLogSummaryValue(newRaw);

  if(oldParsed && newParsed && !Array.isArray(oldParsed) && !Array.isArray(newParsed)){
    const keys=[...new Set([...Object.keys(oldParsed),...Object.keys(newParsed)])];
    const changed=keys.filter(key=>JSON.stringify(oldParsed[key])!==JSON.stringify(newParsed[key]));
    if(changed.length){
      const shown=changed.slice(0,3).map(logSummaryLabel).join(", ");
      const remaining=changed.length>3 ? ` +${changed.length-3} more` : "";
      return `${changed.length} field${changed.length===1?"":"s"} changed: ${shown}${remaining}`;
    }
  }

  if(oldRaw && newRaw) return `${shortLogValue(oldRaw)} → ${shortLogValue(newRaw)}`;
  if(newRaw) return `Added: ${shortLogValue(newRaw)}`;
  if(oldRaw) return `Removed: ${shortLogValue(oldRaw)}`;
  return "No value details";
}

function renderLogChangeCell(oldValue, newValue){
  const oldRaw=String(oldValue || "");
  const newRaw=String(newValue || "");
  const oldSafe=tableEscape(oldRaw);
  const newSafe=tableEscape(newRaw);
  const summary=tableEscape(logChangeSummary(oldRaw,newRaw));
  return `<td class="logChangeCell" data-old="${oldSafe}" data-new="${newSafe}" title="Click to open full change details" role="button" tabindex="0" aria-label="Open full change details: ${summary}">
    <div class="logChangeSummary"><b>${summary}</b><span>View full details</span></div>
  </td>`;
}

function setupLogDetailCells(){
  document.querySelectorAll("#logTable .logChangeCell").forEach(td=>{
    const openDetails=()=>showLogDetail(td.dataset.old || "", td.dataset.new || "");
    td.onclick=openDetails;
    td.onkeydown=event=>{
      if(event.key==="Enter" || event.key===" "){
        event.preventDefault();
        openDetails();
      }
    };
  });
}

function renderLog(){
  document.getElementById("logTable").innerHTML=
    "<thead><tr>"+
      "<th class='log-date'>Date</th>"+
      "<th class='log-tagid'>RFID Tag ID</th>"+
      "<th class='log-action'>Action</th>"+
      "<th class='log-field'>Field</th>"+
      "<th class='log-changes'>Changes</th>"+
      "<th class='log-notes'>Notes</th>"+
    "</tr></thead><tbody>"+
    db.log.map(l=>"<tr>"+
      `<td class="log-date"><div>${tableEscape(l.date||"")}</div><div class="log-time">${tableEscape(l.time||"")}</div></td>`+
      `<td class="log-tagid">${tableEscape(l.assetId||"")}</td>`+
      `<td class="log-action">${tableEscape(l.action||"")}</td>`+
      `<td class="log-field">${tableEscape(l.field||"")}</td>`+
      renderLogChangeCell(l.oldValue||"", l.newValue||"")+
      `<td class="log-notes">${tableEscape(l.notes||"")}</td>`+
    "</tr>").join("")+
    "</tbody>";

  setupLogDetailCells();
}


function setupDeltaFieldToggle(){
  const grid=document.querySelector("#logDetailBody .logDiffGrid");
  const showAll=document.getElementById("showAllDeltaFieldsBtn");
  const showOnly=document.getElementById("showOnlyDeltaChangesBtn");
  if(!grid || !showAll || !showOnly) return;

  showAll.onclick=()=>{
    grid.querySelectorAll(".diffUnchangedRow").forEach(row=>row.classList.remove("hidden"));
    showAll.disabled=true;
    showOnly.disabled=false;
  };

  showOnly.onclick=()=>{
    grid.querySelectorAll(".diffUnchangedRow").forEach(row=>row.classList.add("hidden"));
    showAll.disabled=false;
    showOnly.disabled=true;
  };
}
