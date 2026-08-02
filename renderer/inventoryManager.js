/*
 * Inventory Manager
 * Handles Inventory table rendering, photo indicators, row opening, and truncated-cell hints.
 */

const inventoryCharWidths = {
  assetId: 8,
  alias: 25,
  form: 9,
  color: 10,
  band: 5,
  frequency: 11,
  type: 20,
  magic: 7,
  currentUid: 13,
  originalUid: 13,
  cloneOf: 8,
  prng: 7,
  status: 10,
  backupStatus: 15,
  lastBackup: 12,
  source: 20,
  storage: 20,
  notes: 25
};

function assetHasStoredPhoto(asset){
  return !!(asset?.photo && (asset.photo.full?.dataB64 || asset.photo.thumb?.dataB64 || asset.photo.dataB64));
}

function renderInventoryPhotoCell(asset){
  const hasPhoto=assetHasStoredPhoto(asset);
  const id=tableEscape(asset.assetId || "");
  if(!hasPhoto){
    return `<td class="photoIndicatorCell emptyPhotoCell" data-id="${id}" title="No photo stored"></td>`;
  }

  const src=photoDataUrl(asset.photo, "thumb");
  return `<td class="photoIndicatorCell" data-id="${id}" title="Click to view photo">
    <img class="inventoryPhotoThumb" src="${src}" alt="RFID Tag photo">
  </td>`;
}

function openInventoryAsset(id, showPhoto=false){
  const asset=getAsset(id);
  if(!asset) return;
  fillForm(asset);
  showTab("edit");
  if(showPhoto && assetHasStoredPhoto(asset)){
    requestAnimationFrame(()=>showPhotoDetail());
  }
}

function renderInventoryCell(field, value){
  const raw=String(value ?? "");
  const w=inventoryCharWidths[field] || 14;
  const safe=tableEscape(raw);

  if(field==="assetId"){
    return `<td class="openTagCell" data-id="${safe}" title="Open RFID Tag"><span class="clipText" style="width:${w}ch;max-width:${w}ch">${safe}</span></td>`;
  }

  return `<td class="clipCell" data-full="${safe}"><span class="clipText" style="width:${w}ch;max-width:${w}ch">${safe}</span></td>`;
}

function markTruncatedCells(){
  document.querySelectorAll("#assetTable .clipCell").forEach(td=>{
    const span = td.querySelector(".clipText");
    if(!span) return;
    td.classList.toggle("isTruncated", span.scrollWidth > span.clientWidth + 1);
  });
}
function renderInventory(){
  const q=(document.getElementById("search")?.value||"").toLowerCase();
  const rows=db.assets.filter(a=>{
    const matchesDashboard=typeof assetMatchesDashboardFilter==="function" ? assetMatchesDashboardFilter(a) : true;
    const matchesText=!q || JSON.stringify(a).toLowerCase().includes(q);
    return matchesDashboard && matchesText;
  });
  document.getElementById("assetTable").innerHTML=
    "<thead><tr>"+
    `<th class="selectHead">Select</th>`+`<th class="photoIndicatorHead">Photo</th>`+
    fields.map(f=>`<th><span class="clipText" style="width:${inventoryCharWidths[f]||14}ch;max-width:${inventoryCharWidths[f]||14}ch">${tableEscape(labels[f]||f)}</span></th>`).join("")+
    "</tr></thead><tbody>"+
    rows.map(a=>`<tr data-id="${tableEscape(a.assetId)}">`+
      `<td class="selectCell"><input type="checkbox" class="assetSelectBox" data-id="${tableEscape(a.assetId)}" ${typeof selectedAssetIds!=="undefined" && selectedAssetIds.has(a.assetId) ? "checked" : ""}></td>`+
      renderInventoryPhotoCell(a)+
      fields.map(f=>renderInventoryCell(f, a[f]||"")).join("")+
    "</tr>").join("")+
    "</tbody>";

  markTruncatedCells();

  document.querySelectorAll("#assetTable .assetSelectBox").forEach(box=>{
    box.onchange=(e)=>{
      e.stopPropagation();
      if(typeof toggleInventorySelection==="function") toggleInventorySelection(box.dataset.id, box.checked);
    };
    box.onclick=e=>e.stopPropagation();
  });

  if(typeof updateSelectionStatus==="function") updateSelectionStatus();

  document.querySelectorAll("#assetTable tbody tr").forEach(row=>{
    row.onclick=(e)=>{
      const id=row.dataset.id;

      if(e.target.closest(".assetSelectBox") || e.target.closest(".selectCell")){
        return;
      }

      const photoCell=e.target.closest(".photoIndicatorCell");
      if(photoCell && photoCell.querySelector(".inventoryPhotoThumb")){
        showPhotoDetailForAsset(id);
        return;
      }

      const tagCell=e.target.closest(".openTagCell");
      if(tagCell){
        openInventoryAsset(id, false);
        return;
      }

      // Other cells stay passive so text can be selected and copied.
    };
  });
}
