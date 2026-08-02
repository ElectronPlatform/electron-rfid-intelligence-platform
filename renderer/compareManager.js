/*
 * Compare Manager
 * Handles loose dump comparison and managed stored dump comparison.
 */

/* PM3_COMPARE_DUMPS_V534 */
async function readCompareFile(inputId){
  const file=document.getElementById(inputId).files[0];
  if(!file) throw new Error("Missing file: "+inputId);
  const buf=await file.arrayBuffer();
  return {name:file.name, bytes:new Uint8Array(buf)};
}

async function compareDumpFiles(){
  const box=document.getElementById("compareResult");
  try{
    const a=await readCompareFile("compareFileA");
    const b=await readCompareFile("compareFileB");

    if(a.bytes.length!==b.bytes.length){
      box.className="matchPanel warn";
      box.innerHTML=`⚠️ Different file sizes<br>${a.name}: ${a.bytes.length} bytes<br>${b.name}: ${b.bytes.length} bytes`;
      return;
    }

    const diffBlocks=[];
    let diffBytes=0;
    for(let i=0;i<a.bytes.length;i++){
      if(a.bytes[i]!==b.bytes[i]){
        diffBytes++;
        const block=Math.floor(i/16);
        if(!diffBlocks.includes(block)) diffBlocks.push(block);
      }
    }

    if(diffBytes===0){
      box.className="matchPanel good";
      box.innerHTML=`✅ Dumps are identical<br>${a.name}<br>${b.name}<br><br>${a.bytes.length} bytes compared.`;
    }else{
      box.className="matchPanel warn";
      box.innerHTML=`⚠️ Dumps are different<br>${diffBytes} byte difference(s).<br>Different block(s): ${diffBlocks.join(", ")}`;
    }
  }catch(err){
    box.className="matchPanel warn";
    box.innerHTML="⚠️ "+err.message;
  }
}


/* PM3_MANAGED_COMPARE_V533 */
function bytesToBase64(bytes){
  let binary="";
  const chunk=0x8000;
  for(let i=0;i<bytes.length;i+=chunk){
    binary += String.fromCharCode.apply(null, bytes.subarray(i,i+chunk));
  }
  return btoa(binary);
}

function base64ToBytes(b64){
  const binary=atob(b64);
  const bytes=new Uint8Array(binary.length);
  for(let i=0;i<binary.length;i++) bytes[i]=binary.charCodeAt(i);
  return bytes;
}

function renderCompareSelects(){
  const ids=["compareStoreAsset","compareAssetA","compareAssetB"];
  ids.forEach(id=>{
    const el=document.getElementById(id);
    if(!el) return;
    const old=el.value;
    el.innerHTML=`<option value="">Select RFID tag...</option>`+db.assets.map(a=>{
      const dumps=(a.backupFiles||[]).filter(f=>f && f.dataB64 && /\.bin$/i.test(f.name||""));
      const uid=a.currentUid ? ` (${a.currentUid})` : "";
      const b=dumps.length ? ` — ${dumps.length} stored dump${dumps.length>1?"s":""}` : " — no stored dump";
      return `<option value="${a.assetId}">${a.assetId} — ${a.alias||""}${uid}${b}</option>`;
    }).join("");
    el.value=old && getAsset(old) ? old : "";
  });

  const source=renderWorkspaceAssetSelection("compareAssetA","compareAssetAStatus");
  const destination=renderWorkspaceAssetSelection("compareAssetB","compareAssetBStatus");
  const storeAsset=renderWorkspaceAssetSelection("compareStoreAsset","compareStoreAssetStatus");
  const compareButton=document.getElementById("compareManagedBtn");
  const storeButton=document.getElementById("storeManagedDumpBtn");
  if(compareButton) compareButton.disabled=!(source && destination && source.assetId!==destination.assetId);
  if(storeButton) storeButton.disabled=!storeAsset;

  const result=document.getElementById("compareManagedResult");
  if(result && (!source || !destination)) result.textContent="No RFID tag selected.";
  else if(result && source.assetId===destination.assetId) result.textContent="Select a different destination RFID tag.";
  else if(result) result.textContent="Ready to compare the selected RFID tags.";
}

function latestManagedDump(asset){
  const dumps=(asset?.backupFiles||[]).filter(f =>
    f && f.dataB64 && /\.bin$/i.test(f.name||"")
  );
  return dumps.length ? dumps[dumps.length-1] : null;
}

async function storeManagedDump(){
  const asset=getAsset(document.getElementById("compareStoreAsset").value);
  const file=document.getElementById("compareStoreFile").files[0];
  const box=document.getElementById("compareManagedResult");

  if(!asset || !file){
    box.className="matchPanel warn";
    box.innerHTML="⚠️ Select an asset and a .bin dump file first.";
    return;
  }

  const buf=await file.arrayBuffer();
  const bytes=new Uint8Array(buf);

  const backupFiles=Array.isArray(asset.backupFiles) ? JSON.parse(JSON.stringify(asset.backupFiles)) : [];
  backupFiles.push({
    name:file.name,
    date:today(),
    type:"dump.bin",
    size:bytes.length,
    storedInDb:true,
    dataB64:bytesToBase64(bytes)
  });

  const result=await mutateCollection("edit",{
    targetAssetId:asset.assetId,
    changes:{
      backupFiles,
      backupStatus:"Backup available",
      lastBackup:today()
    },
    audit:{
      action:"Managed dump stored",
      field:"backupFiles",
      oldValue:"",
      newValue:file.name,
      notes:"Dump stored inside database"
    }
  });
  if(!result) return;
  render();

  box.className="matchPanel good";
  box.innerHTML=`✅ Dump stored in database<br>${result.record.assetId} — ${result.record.alias||""}<br>${file.name}<br>${bytes.length} bytes`;
}

function compareBytes(aBytes,bBytes){
  if(aBytes.length!==bBytes.length){
    return {same:false, sizeDifferent:true, diffBytes:Math.abs(aBytes.length-bBytes.length), blocks:[]};
  }
  const blocks=[];
  let diffBytes=0;
  for(let i=0;i<aBytes.length;i++){
    if(aBytes[i]!==bBytes[i]){
      diffBytes++;
      const block=Math.floor(i/16);
      if(!blocks.includes(block)) blocks.push(block);
    }
  }
  return {same:diffBytes===0, sizeDifferent:false, diffBytes, blocks};
}

function compareManagedDumps(){
  const a=getAsset(document.getElementById("compareAssetA").value);
  const b=getAsset(document.getElementById("compareAssetB").value);
  const box=document.getElementById("compareManagedResult");

  const da=latestManagedDump(a);
  const dbu=latestManagedDump(b);

  if(!da || !dbu){
    box.className="matchPanel warn";
    box.innerHTML="⚠️ One or both selected RFID tags do not have a dump stored in the database yet.<br><br>Use <b>Store dump in database</b> first, or create a backup later from the Backup workflow.";
    return;
  }

  const aBytes=base64ToBytes(da.dataB64);
  const bBytes=base64ToBytes(dbu.dataB64);
  const r=compareBytes(aBytes,bBytes);

  if(r.same){
    box.className="matchPanel good";
    box.innerHTML=
      `✅ Verification successful<br><br>`+
      `<b>Source:</b><br>${a.assetId} — ${a.alias||""}<br>${da.name}<br><br>`+
      `<b>Destination:</b><br>${b.assetId} — ${b.alias||""}<br>${dbu.name}<br><br>`+
      `Compared bytes: ${aBytes.length}<br>Different bytes: 0<br><br>`+
      `<b>Status:</b> Byte-for-byte identical`;
  }else if(r.sizeDifferent){
    box.className="matchPanel warn";
    box.innerHTML=
      `⚠️ Verification failed<br><br>`+
      `Different file sizes:<br>`+
      `${da.name}: ${aBytes.length} bytes<br>`+
      `${dbu.name}: ${bBytes.length} bytes`;
  }else{
    box.className="matchPanel warn";
    box.innerHTML=
      `⚠️ Verification failed<br><br>`+
      `Different bytes: ${r.diffBytes}<br>`+
      `Different blocks: ${r.blocks.join(", ")}`;
  }
}
