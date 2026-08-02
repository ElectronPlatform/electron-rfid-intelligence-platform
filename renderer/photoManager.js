
function validateQualityField(inputId,msgId){
const el=document.getElementById(inputId),msg=document.getElementById(msgId);if(!el||!msg)return true;const v=Number(el.value);el.style.borderColor='';msg.style.color='';
if(v>100){el.style.borderColor='red';msg.style.color='red';
if(inputId==="photoFullQuality"){
  msg.textContent="😄 Nice try! I'm a photo storage optimizer, not a photo quality improver. If you want a larger preview image, change the \"Full preview max side\" value instead. Please choose a quality value between 1% and 100%.";
}else{
  msg.textContent="😄 Nice try! I'm a photo storage optimizer, not a photo quality improver. If you want a larger thumbnail, change the \"Thumbnail max side\" value instead. Please choose a quality value between 1% and 100%.";
}
return false;}
if(v<=0){el.style.borderColor='red';msg.style.color='red';msg.textContent="😅 0%? I admire your commitment to saving space, but at this point the photo probably isn't very useful anymore. You might as well delete it instead. Please choose a value between 1% and 100%.";return false;}
if(v<20){el.style.borderColor='orange';msg.style.color='orange';msg.textContent="⚠️ Values below 20% usually produce very poor image quality. Deleting the photo may be a better option.";return true;}
msg.textContent='';return true;}
/*
 * Photo Manager
 * Handles RFID tag photo compression, storage metadata, preview, modal display,
 * removal, and advanced photo storage settings.
 *
 * This file is loaded before renderer.js and sends durable changes through the
 * main-process Collection Service helpers exposed by renderer.js.
 */

const defaultPhotoStorageConfig = {
  thumbnailMaxSide: 220,
  thumbnailQuality: 0.68,
  fullMaxSide: 1600,
  fullQuality: 0.74,
  outputMime: "image/jpeg"
};

function ensurePhotoStorageSettings(){
  return {...defaultPhotoStorageConfig, ...(db?.settings?.photoStorage||{})};
}

function getPhotoStorageConfig(){
  return {...defaultPhotoStorageConfig, ...(db?.settings?.photoStorage||{})};
}

function formatBytes(bytes){
  const n=Number(bytes||0);
  if(!n) return "0 KB";
  if(n < 1024*1024) return `${Math.round(n/1024)} KB`;
  return `${(n/(1024*1024)).toFixed(1)} MB`;
}

function base64SizeBytes(b64){
  const clean=String(b64||"").replace(/\s/g,"");
  if(!clean) return 0;
  const padding=(clean.match(/=+$/)||[""])[0].length;
  return Math.max(0, Math.floor(clean.length*3/4)-padding);
}

function photoVariant(photo, variant="full"){
  if(!photo) return null;
  if(variant==="thumb" && photo.thumb?.dataB64) return photo.thumb;
  if(photo.full?.dataB64) return photo.full;
  if(photo.dataB64) return {
    mime:photo.mime||"image/jpeg",
    dataB64:photo.dataB64,
    size:photo.size||base64SizeBytes(photo.dataB64)
  };
  return null;
}

function photoDataUrl(photo, variant="full"){
  const selected=photoVariant(photo, variant);
  if(!selected || !selected.dataB64) return "";
  return `data:${selected.mime || photo?.mime || "image/jpeg"};base64,${selected.dataB64}`;
}

function loadImageFromDataUrl(src){
  return new Promise((resolve,reject)=>{
    const img=new Image();
    img.onload=()=>resolve(img);
    img.onerror=()=>reject(new Error("Could not load selected image."));
    img.src=src;
  });
}

async function makeResizedPhotoVariant(img, maxSide, quality, mime){
  const scale=Math.min(1, maxSide/Math.max(img.naturalWidth, img.naturalHeight));
  const width=Math.max(1, Math.round(img.naturalWidth*scale));
  const height=Math.max(1, Math.round(img.naturalHeight*scale));

  const canvas=document.createElement("canvas");
  canvas.width=width;
  canvas.height=height;
  const ctx=canvas.getContext("2d");

  if(mime==="image/jpeg"){
    ctx.fillStyle="#ffffff";
    ctx.fillRect(0,0,width,height);
  }

  ctx.drawImage(img,0,0,width,height);
  const dataUrl=canvas.toDataURL(mime, quality);
  const dataB64=dataUrl.split(",")[1] || "";

  return {mime, width, height, size:base64SizeBytes(dataB64), dataB64};
}

async function optimizeSelectedPhoto(photo){
  const config=ensurePhotoStorageSettings();
  const sourceUrl=`data:${photo.mime || "image/jpeg"};base64,${photo.dataB64}`;
  const img=await loadImageFromDataUrl(sourceUrl);
  const outputMime=config.outputMime || "image/jpeg";

  const thumb=await makeResizedPhotoVariant(
    img,
    Number(config.thumbnailMaxSide)||defaultPhotoStorageConfig.thumbnailMaxSide,
    Number(config.thumbnailQuality)||defaultPhotoStorageConfig.thumbnailQuality,
    outputMime
  );

  const full=await makeResizedPhotoVariant(
    img,
    Number(config.fullMaxSide)||defaultPhotoStorageConfig.fullMaxSide,
    Number(config.fullQuality)||defaultPhotoStorageConfig.fullQuality,
    outputMime
  );

  return {
    storageVersion:2,
    name:photo.name || "Stored photo",
    mime:outputMime,
    originalMime:photo.mime || "",
    originalSize:photo.size || base64SizeBytes(photo.dataB64),
    originalWidth:img.naturalWidth,
    originalHeight:img.naturalHeight,
    thumb,
    full,
    settings:{
      thumbnailMaxSide:Number(config.thumbnailMaxSide)||defaultPhotoStorageConfig.thumbnailMaxSide,
      thumbnailQuality:Number(config.thumbnailQuality)||defaultPhotoStorageConfig.thumbnailQuality,
      fullMaxSide:Number(config.fullMaxSide)||defaultPhotoStorageConfig.fullMaxSide,
      fullQuality:Number(config.fullQuality)||defaultPhotoStorageConfig.fullQuality,
      outputMime
    }
  };
}

function photoMetadataText(photo){
  if(!photo) return "No photo selected";
  if(photo.full?.dataB64){
    const saved=(photo.thumb?.size||0)+(photo.full?.size||0);
    const original=photo.originalSize||0;
    const pct=original ? Math.max(0, Math.round((1-(saved/original))*100)) : 0;
    const dims=photo.full?.width && photo.full?.height ? `Full ${photo.full.width}×${photo.full.height}` : "Full preview";
    const thumb=photo.thumb?.width && photo.thumb?.height ? `Thumb ${photo.thumb.width}×${photo.thumb.height}` : "Thumbnail";
    return `Stored in database: ${photo.name || "Stored photo"}\n${dims} • ${thumb}\nStored size: ${formatBytes(saved)}${original ? `\nOriginal size: ${formatBytes(original)}\nReduction: ${pct}%` : ""}`;
  }
  if(photo.dataB64){
    return `Stored in database: ${photo.name || "Stored photo"}\nStored size: ${formatBytes(photo.size || base64SizeBytes(photo.dataB64))} — legacy full-size photo`;
  }
  return "No photo selected";
}


function clearPhotoSettingsValidation(){
  ["photoThumbQuality","photoFullQuality"].forEach(id=>{
    const el=document.getElementById(id);
    const msg=document.getElementById(id+"Msg");
    if(el) el.style.borderColor="";
    if(msg){
      msg.textContent="";
      msg.style.color="";
    }
  });
}

function revertPhotoSettingField(id){
  const cfg=ensurePhotoStorageSettings();
  const el=document.getElementById(id);
  if(!el) return;

  const values={
    photoThumbMaxSide: cfg.thumbnailMaxSide,
    photoThumbQuality: Math.round(cfg.thumbnailQuality*100),
    photoFullMaxSide: cfg.fullMaxSide,
    photoFullQuality: Math.round(cfg.fullQuality*100)
  };

  if(values[id] !== undefined) el.value=values[id];

  if(id==="photoThumbQuality") validateQualityField("photoThumbQuality","photoThumbQualityMsg");
  if(id==="photoFullQuality") validateQualityField("photoFullQuality","photoFullQualityMsg");
}

function renderPhotoSettingsPanel(){
  clearPhotoSettingsValidation();
  const cfg=ensurePhotoStorageSettings();
  const mapping=[
    ["photoThumbMaxSide","thumbnailMaxSide"],
    ["photoFullMaxSide","fullMaxSide"]
  ];

  mapping.forEach(([id,key])=>{
    const el=document.getElementById(id);
    if(el) el.value=cfg[key];
  });

  const thumbQuality=document.getElementById("photoThumbQuality");
  if(thumbQuality) thumbQuality.value=Math.round((cfg.thumbnailQuality || 0) * 100);

  const fullQuality=document.getElementById("photoFullQuality");
  if(fullQuality) fullQuality.value=Math.round((cfg.fullQuality || 0) * 100);

  const status=document.getElementById("photoSettingsStatus");
  if(status){
    status.textContent=`Current: thumb ${cfg.thumbnailMaxSide}px / ${Math.round(cfg.thumbnailQuality*100)}%, full ${cfg.fullMaxSide}px / ${Math.round(cfg.fullQuality*100)}%. Changes only affect photos added after saving these settings. Existing stored photos remain unchanged.`;
  }
}

async function savePhotoSettings(){
if(!validateQualityField('photoThumbQuality','photoThumbQualityMsg'))return;
if(!validateQualityField('photoFullQuality','photoFullQualityMsg'))return;
  const cfg=ensurePhotoStorageSettings();
  const readNumber=(id,fallback)=>{
    const n=Number(document.getElementById(id)?.value);
    return Number.isFinite(n) ? n : fallback;
  };

  const thumbQualityPercent=readNumber("photoThumbQuality", Math.round(cfg.thumbnailQuality*100));
  const fullQualityPercent=readNumber("photoFullQuality", Math.round(cfg.fullQuality*100));

  if(!Number.isFinite(thumbQualityPercent) || thumbQualityPercent < 1 || thumbQualityPercent > 100){
    alert("Thumbnail quality must be between 1% and 100%.");
    return;
  }

  if(!Number.isFinite(fullQualityPercent) || fullQualityPercent < 1 || fullQualityPercent > 100){
    alert("Full preview quality must be between 1% and 100%.");
    return;
  }

  cfg.thumbnailMaxSide=Math.min(800, Math.max(80, Math.round(readNumber("photoThumbMaxSide", cfg.thumbnailMaxSide))));
  cfg.thumbnailQuality=thumbQualityPercent/100;
  cfg.fullMaxSide=Math.min(3000, Math.max(400, Math.round(readNumber("photoFullMaxSide", cfg.fullMaxSide))));
  cfg.fullQuality=fullQualityPercent/100;
  cfg.outputMime="image/jpeg";

  const result=await updateCollectionSettings({photoStorage:cfg});
  if(!result) return;
  renderPhotoSettingsPanel();

  const status=document.getElementById("photoSettingsStatus");
  if(status) status.textContent="Photo settings saved. Changes only affect photos added after saving these settings. Existing stored photos remain unchanged.";
}

async function resetPhotoSettings(){
  const result=await updateCollectionSettings({photoStorage:{...defaultPhotoStorageConfig}});
  if(!result) return;
  renderPhotoSettingsPanel();

  const status=document.getElementById("photoSettingsStatus");
  if(status) status.textContent="Photo settings reset to default values.";
}

function updatePhotoPanel(asset){
  const img=document.getElementById("photoPreviewImg");
  const placeholder=document.getElementById("photoPlaceholder");
  const text=document.getElementById("photoPathText");
  const removeBtn=document.getElementById("removePhotoBtn");
  if(!img || !placeholder || !text) return;

  const photo=asset?.photo;
  const src=photoDataUrl(photo,"thumb");
  if(src){
    img.src=src;
    img.classList.remove("hidden");
    placeholder.classList.add("hidden");
    text.textContent=photoMetadataText(photo);
    if(removeBtn) removeBtn.disabled=false;
  }else{
    img.removeAttribute("src");
    img.classList.add("hidden");
    placeholder.classList.remove("hidden");
    text.textContent=asset?.photoPath ? `Legacy path: ${asset.photoPath}` : "No photo selected";
    if(removeBtn) removeBtn.disabled=true;
  }
}

function ensurePhotoModal(){
  let modal=document.getElementById("photoDetailModal");
  if(modal) return modal;
  modal=document.createElement("div");
  modal.id="photoDetailModal";
  modal.className="photoDetailModal hidden";
  modal.innerHTML=`
    <div class="photoDetailCard">
      <div class="photoDetailHeader">
        <h3>RFID Tag Photo</h3>
        <button id="closePhotoDetailBtn">Close</button>
      </div>
      <div class="photoDetailBody"><img id="photoDetailImg" alt="RFID Tag photo"></div>
    </div>`;
  document.body.appendChild(modal);
  modal.addEventListener("click", e=>{ if(e.target===modal) modal.classList.add("hidden"); });
  document.getElementById("closePhotoDetailBtn").onclick=()=>modal.classList.add("hidden");
  return modal;
}

function showPhotoDetail(){
  const id=document.getElementById("f_assetId")?.value.trim();
  const asset=getAsset(id);
  const src=photoDataUrl(asset?.photo,"full");
  if(!src) return;
  const modal=ensurePhotoModal();
  document.getElementById("photoDetailImg").src=src;
  modal.classList.remove("hidden");
}

function showPhotoDetailForAsset(assetId){
  const asset=getAsset(assetId);
  const src=photoDataUrl(asset?.photo,"full");
  if(!src) return;
  const modal=ensurePhotoModal();
  document.getElementById("photoDetailImg").src=src;
  modal.classList.remove("hidden");
}

async function removePhoto(){
  const id=document.getElementById("f_assetId")?.value.trim();
  if(!id) return alert("Select or create an asset first.");
  const asset=getAsset(id);
  if(!asset || !asset.photo) return;
  if(!confirm("Remove the stored photo from this RFID tag record?")) return;
  const oldName=asset.photo?.name || "Stored photo";
  const result=await mutateCollection("edit",{
    targetAssetId:id,
    changes:{photoPath:""},
    unsetFields:["photo"],
    audit:{
      action:"Photo removed",
      field:"photo",
      oldValue:oldName,
      newValue:"",
      notes:"Stored photo removed from record"
    }
  });
  if(!result) return;
  updatePhotoPanel(result.record);
  renderDashboard();
  renderLog();
  renderSelects();
}

function photoLogSnapshot(photo){
  if(!photo) return null;
  const snap={
    name: photo.name || "Stored photo",
    mime: photo.mime || photo.full?.mime || photo.thumb?.mime || "",
    storageVersion: photo.storageVersion || (photo.full ? 2 : 1),
    storedInDb: true
  };
  if(photo.originalSize) snap.originalSize=photo.originalSize;
  if(photo.originalWidth && photo.originalHeight) snap.originalDimensions=`${photo.originalWidth}x${photo.originalHeight}`;
  if(photo.thumb) snap.thumb={width:photo.thumb.width||0,height:photo.thumb.height||0,size:photo.thumb.size||0,dataB64:"[thumbnail image omitted from Change Log]"};
  if(photo.full) snap.full={width:photo.full.width||0,height:photo.full.height||0,size:photo.full.size||0,dataB64:"[full image omitted from Change Log]"};
  if(photo.dataB64) snap.legacy={size:photo.size||base64SizeBytes(photo.dataB64),dataB64:"[embedded legacy image omitted from Change Log]"};
  return snap;
}

async function selectPhoto(){
  const id=document.getElementById("f_assetId").value.trim();
  if(!id) return alert("Select or create an asset first.");

  let asset=getAsset(id);
  if(!asset){
    alert("Save the RFID tag first, then add the photo.");
    return;
  }

  const selected=await window.pm3api.selectPhoto();
  if(!selected) return;

  const oldMeta=asset.photo ? JSON.stringify(photoLogSnapshot(asset.photo)) : (asset.photoPath || "");
  let optimized;
  try{
    optimized=await optimizeSelectedPhoto(selected);
  }catch(err){
    alert("Could not process this photo: " + err.message);
    return;
  }

  const result=await mutateCollection("edit",{
    targetAssetId:id,
    changes:{
      photo:optimized,
      photoPath:optimized.name || "Stored photo"
    },
    audit:{
      action:"Photo stored",
      field:"photo",
      oldValue:oldMeta,
      newValue:JSON.stringify(photoLogSnapshot(optimized)),
      notes:"Optimized thumbnail and preview stored inside database record"
    }
  });
  if(!result) return;
  updatePhotoPanel(result.record);
  renderDashboard();
  renderLog();
  renderSelects();
}

document.addEventListener('DOMContentLoaded',()=>{['photoThumbQuality','photoFullQuality'].forEach(id=>{const m=id==='photoThumbQuality'?'photoThumbQualityMsg':'photoFullQualityMsg';const e=document.getElementById(id);if(e)e.addEventListener('input',()=>validateQualityField(id,m));});});
