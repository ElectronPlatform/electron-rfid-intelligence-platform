/*
 * Backup Manager
 * Handles backup file detection, backup hints, and stored backup metadata.
 */

function backupText(value){return String(value||"").trim();}
function backupHtml(value){return backupText(value).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));}
function backupNotice(title, lines, variant="info"){
  const body=`<ul>${lines.map(line=>`<li>${backupHtml(line)}</li>`).join("")}</ul>`;
  if(window.UIEngine?.alert) return window.UIEngine.alert({title,body,variant:variant==="error"?"danger":variant,buttonText:"Close",size:"sm"});
  if(window.UIEngine?.toast) return window.UIEngine.toast(lines[0]||title,variant);
  console.info(title, lines);
}
function detectBackupFiles(t){
  const files=Array.from(backupText(t).matchAll(/`?([^`\s]+\.(?:bin|json|eml|dic|keys|txt))`?/gi)).map(m=>m[1].replace(/^.*\//,""));
  const r={dump:"",json:"",key:"",all:files};
  files.forEach(f=>{
    if(/dump\.bin$/i.test(f) || (!r.dump && /\.bin$/i.test(f) && !/key/i.test(f))) r.dump=f;
    else if(/dump\.json$/i.test(f) || (!r.json && /\.json$/i.test(f))) r.json=f;
    else if(/key\.bin$/i.test(f) || /\.(dic|keys)$/i.test(f) || /key/i.test(f)) r.key=f;
  });
  return r;
}
function backupCardKind(asset){
  const text=[asset?.band, asset?.type, asset?.alias].join(" ");
  if(/EM410x|HID|Indala|AWID|IoProx|T55|Hitag|125\s*kHz|LF/i.test(text)) return "lf";
  if(/MIFARE\s+Classic|MF Classic|S50|S70/i.test(text)) return "mifare-classic";
  return "generic-hf";
}
function backupFieldValue(id){ return backupText(document.getElementById(id)?.value); }
function backupFileName(value){ return backupText(value).replace(/^.*[\\/]/,""); }
function backupCheckMark(ok){ return ok ? "✔" : "○"; }

function validateBackupFields(asset, files){
  const issues=[];
  const warnings=[];
  const dump=backupText(files.dump);
  const json=backupText(files.json);
  const key=backupText(files.key);
  const isLf=asset?.band==="LF" || /EM410x|HID|Hitag|T55/i.test(asset?.type||"");
  if(!asset) issues.push("No RFID tag selected.");
  if(!dump && !json && !key) issues.push("No backup file references entered.");
  if(isLf){
    if(json || key) warnings.push("LF tags usually store an ID/raw decode rather than a MIFARE dump/key set.");
    if(dump && !/\.(bin|txt|json)$/i.test(dump)) warnings.push("LF backup reference should normally be a .bin, .txt or .json record.");
  }else{
    if(dump && !/\.bin$/i.test(dump)) issues.push("Dump reference should be a .bin file.");
    if(json && !/\.json$/i.test(json)) warnings.push("JSON reference does not end in .json.");
    if(key && !/\.bin$/i.test(key)) warnings.push("Key reference does not end in .bin.");
    if(dump && !json) warnings.push("A MIFARE backup is stronger when both dump .bin and dump .json are registered.");
    if(key && !dump) warnings.push("A key file without a dump cannot restore card contents by itself.");
  }
  const uid=backupText(asset?.currentUid).replace(/[^0-9A-Fa-f]/g,"").toLowerCase();
  const combined=[dump,json,key].join(" ").toLowerCase();
  if(uid && combined && !combined.includes(uid.slice(-4)) && !combined.includes(backupText(asset?.assetId).toLowerCase())){
    warnings.push("File names do not visibly include the RFID Tag ID or UID. Double-check this backup belongs to the selected card.");
  }
  return {ok:issues.length===0,issues,warnings};
}

function renderBackupHint(){
  const a=getAsset(document.getElementById("backupAsset")?.value)||db.assets[0];
  if(!a)return;
  const commands=document.getElementById("backupCommands");
  if(!commands) return;
  const kind=backupCardKind(a);
  if(kind==="lf"){
    commands.innerHTML=`${backupWorkflowStep(1,"Detect LF tag","lf search","Identify the low-frequency RFID tag and capture its decoded ID/raw output.")}
${backupWorkflowStep(2,"Save evidence","Use the console output or exported raw file","LF tags usually do not create MIFARE-style dump/key files. Register the raw decode, text note or dump evidence that proves what was read.")}
${backupWorkflowStep(3,"Register backup info","Save Backup Info","Store the backup reference on this RFID Tag record so Restore Helper and reports can see it.")}`;
    return;
  }
  commands.innerHTML=`${backupWorkflowStep(1,"Detect card","hf search","Identify the RFID card and confirm that the reader sees the correct card.")}
${backupWorkflowStep(2,"Read card information","hf mf info","Read public card details such as UID, ATQA, SAK and MIFARE Classic memory layout.")}
${backupWorkflowStep(3,"Create backup files","hf mf autopwn","Only if you own or are authorised to test the card. This can recover known keys and create files such as dump.bin, dump.json and keys.bin.","Expected output: dump.bin, dump.json, keys.bin")}
${backupWorkflowStep(4,"Register files","Use Browse... or Detect Backup Files","Register the created backup files below so Electron knows this card has backup evidence.")}`;
}
function backupWorkflowStep(n,title,command,purpose,expected=""){
  return `<div class="backupWorkflowStep"><div class="backupStepNum">Step ${n}</div><div><b>${backupHtml(title)}</b><code>${backupHtml(command)}</code><p><span>Purpose:</span> ${backupHtml(purpose)}</p>${expected?`<p><span>${backupHtml(expected)}</span></p>`:""}</div></div>`;
}
function renderBackupStatus(asset){
  const box=document.getElementById("backupStatusPanel");
  if(!box) return;
  const a=asset || getAsset(document.getElementById("backupAsset")?.value) || db.assets[0];
  const names=(a?.backupFiles||[]).map(f=>typeof f==="string"?f:(f?.name||""));
  const dump=backupFieldValue("backupDump") || names.find(name=>/\.(bin|eml|txt)$/i.test(name) && !/key/i.test(name)) || "";
  const json=backupFieldValue("backupJson") || names.find(name=>/\.json$/i.test(name)) || "";
  const key=backupFieldValue("backupKey") || names.find(name=>/(key|keys)|\.(dic|keys)$/i.test(name)) || "";
  const kind=backupCardKind(a);
  const complete=kind==="lf" ? !!dump : !!(dump && json && key);
  const partial=!complete && !!(dump || json || key || names.length);
  const status=complete ? "Complete backup" : partial ? "Partial backup" : "No backup registered";
  box.className=`backupStatusPanel ${complete?"backupComplete":partial?"backupPartial":"backupEmpty"}`;
  box.innerHTML=`<div><b>Backup Status</b><span>${backupHtml(status)}</span></div>
    <div><b>Last backup</b><span>${backupHtml(a?.lastBackup || "Not registered yet")}</span></div>
    <div class="backupStatusFiles">
      <span>${backupCheckMark(!!dump)} Dump${kind==="lf"?" / evidence":""}</span>
      <span class="${kind==="lf"?"muted":""}">${backupCheckMark(kind==="lf" || !!json)} JSON${kind==="lf"?" not usually needed":""}</span>
      <span class="${kind==="lf"?"muted":""}">${backupCheckMark(kind==="lf" || !!key)} Keys${kind==="lf"?" not usually needed":""}</span>
    </div>`;
}
function renderBackupContext(asset){
  const a=asset || getAsset(document.getElementById("backupAsset")?.value) || db.assets[0];
  const kind=backupCardKind(a);
  const jsonField=document.getElementById("backupJsonField");
  const keyField=document.getElementById("backupKeyField");
  [jsonField,keyField].forEach(el=>el?.classList.toggle("backupNotApplicable", kind==="lf"));
}
function renderBackupFields(asset){
  const select=document.getElementById("backupAsset");
  if(!select) return;
  const a=asset || getAsset(select.value) || db.assets[0];
  if(a?.assetId) select.value=a.assetId;
  const names=(a?.backupFiles||[]).map(f=>typeof f==="string"?f:(f?.name||""));
  const dump=names.find(name=>/dump\.bin$/i.test(name)) || names.find(name=>/\.bin$/i.test(name) && !/key/i.test(name)) || "";
  const json=names.find(name=>/dump\.json$/i.test(name)) || names.find(name=>/\.json$/i.test(name)) || "";
  const key=names.find(name=>/key\.bin$/i.test(name) || /key/i.test(name)) || "";
  const dumpEl=document.getElementById("backupDump");
  const jsonEl=document.getElementById("backupJson");
  const keyEl=document.getElementById("backupKey");
  if(dumpEl) dumpEl.value=dump;
  if(jsonEl) jsonEl.value=json;
  if(keyEl) keyEl.value=key;
  renderBackupContext(a);
  renderBackupStatus(a);
  renderBackupHint();
}
function applyBackupCandidates(candidates={}){
  if(candidates.dump && document.getElementById("backupDump")) document.getElementById("backupDump").value=candidates.dump;
  if(candidates.json && document.getElementById("backupJson")) document.getElementById("backupJson").value=candidates.json;
  if(candidates.key && document.getElementById("backupKey")) document.getElementById("backupKey").value=candidates.key;
  renderBackupStatus();
}
async function browseBackupReference(type){
  if(!window.pm3api?.chooseBackupReferenceFile) return backupNotice("Browse unavailable", ["Electron file picker is not available in this build."], "warning");
  const current=type==="json" ? backupFieldValue("backupJson") : type==="key" ? backupFieldValue("backupKey") : backupFieldValue("backupDump");
  const picked=await window.pm3api.chooseBackupReferenceFile(type, current);
  if(!picked) return;
  applyBackupCandidates(picked.candidates || {});
  if(type==="json" && picked.filePath) document.getElementById("backupJson").value=picked.filePath;
  else if(type==="key" && picked.filePath) document.getElementById("backupKey").value=picked.filePath;
  else if(picked.filePath) document.getElementById("backupDump").value=picked.filePath;
  renderBackupStatus();
}
async function saveBackupInfo(){
  const a=getAsset(document.getElementById("backupAsset").value);
  if(!a)return;
  const input={
    dump:document.getElementById("backupDump").value,
    json:document.getElementById("backupJson").value,
    key:document.getElementById("backupKey").value
  };
  const validation=validateBackupFields(a,input);
  if(!validation.ok){
    backupNotice("Backup not saved", validation.issues, "error");
    return;
  }
  const files=[input.dump,input.json,input.key].map(backupText).filter(Boolean).map(name=>({name,date:today(),validated:true}));
  const result=await mutateCollection("edit",{
    targetAssetId:a.assetId,
    changes:{
      backupFiles:files,
      lastBackup:today(),
      backupStatus:validation.warnings.length ? "Backup registered with warnings" : (files.length>=2?"Backup available":"Partial backup"),
      backupValidation:{checkedAt:new Date().toISOString(),warnings:validation.warnings,files:files.map(f=>f.name)}
    },
    audit:{
      action:"Backup registered",
      field:"backupFiles",
      oldValue:"",
      newValue:files.map(f=>f.name).join(", "),
      notes:"Backup file references saved with validation"
    }
  });
  if(!result) return;
  render();
  renderBackupFields(result.record);
  backupNotice("Backup saved", validation.warnings.length ? ["Backup references were saved.", ...validation.warnings] : ["Backup references were saved and basic checks passed."], validation.warnings.length ? "warning" : "success");
}
function detectBackup(){
  const files=detectBackupFiles(document.getElementById("backupOutput").value);
  if(files.dump)document.getElementById("backupDump").value=files.dump;
  if(files.json)document.getElementById("backupJson").value=files.json;
  if(files.key)document.getElementById("backupKey").value=files.key;
  renderBackupStatus();
  const found=[files.dump,files.json,files.key].filter(Boolean);
  backupNotice("Backup detection", found.length ? [`Detected ${found.length} backup reference${found.length===1?"":"s"}.`, ...found] : ["No dump/key backup file references were detected in the pasted output."], found.length ? "success" : "warning");
}
