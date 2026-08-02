/*
 * Card Viewer Manager
 *
 * Card Lab presentation for card data Electron already captured. Deep Scan is
 * an explicitly user-triggered test workflow and is kept separate from the
 * stored-data interpretation performed by CardViewerModel.
 */
(function(){
  const profileRegistry=window.DeepScanProfileRegistry;
  const workflowResultBuilder=window.AdvancedWorkflowResultBuilder;
  const emvRedactor=window.EmvDataRedactor;
  const workflowProgress=window.WorkflowProgressPanel;
  const DEEP_SCAN_COMMANDS=profileRegistry?.allCommands?.() || ["hf search","hf 14a info","lf search"];
  const state={open:false,databaseListenerReady:false,keyboardReady:false,viewportListenerReady:false,deepScanRunning:false,deepScanStatus:"",recoveryOpen:false,recoveryRunning:false,recoveryCancelling:false,recoveryStatus:"",activeRecoveryId:"",workflowProgress:null,viewerBounds:null,viewerMaximized:false,viewerRestoreBounds:null};

  function text(value){ return String(value ?? ""); }
  function plain(value){ return text(value).replace(/\x1b\[[0-9;]*m/g,""); }
  function escapeHtml(value){
    return text(value).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"}[c]));
  }
  function cardLabSourceLabel(value){
    if(value==="explore-card") return "Explore Card";
    if(value==="atlas-scan-hf-lf") return "Quick Scan";
    if(value==="pasted-output") return "Pasted PM3 output";
    if(value==="console-output") return "Console output";
    return value || "Current Card Lab analysis";
  }
  function enrichSource(raw){
    if(!raw) return null;
    const signature=raw.cardSignature || raw.signature || raw.cardIntelligence?.signature || raw.intelligence?.signature || {};
    const familyAnalyses=window.ElectronDatabase?.getFamilyAnalyses?.(signature) || raw.familyAnalyses || [];
    return {...raw,familyAnalyses};
  }
  function currentCardLabAnalysis(){
    const lab=window.CardLabManager;
    const labState=lab?.state || {};
    const result=labState.lastAnalysis;
    if(result?.status!=="identified") return null;
    const signature=window.ElectronDatabase?.normaliseSignature?.(
      window.ElectronDatabase?.signatureFromAnalysis?.(result) || {}
    ) || {
      uid:result?.parsed?.uid || result?.uid || "",
      displayName:result?.module?.displayName || result?.displayName || "Unknown card type"
    };
    const readableData=window.ElectronDatabase?.extractReadableCardData?.(result) || {fields:[]};
    const intelligence=window.ElectronDatabase?.getCardIntelligence?.(signature,result) || {
      signature,
      readableData
    };
    return {
      status:"ready",
      source:labState.lastSource || "card-lab-analysis",
      sourceLabel:cardLabSourceLabel(labState.lastSource),
      capturedAt:labState.analysisOrigin?.createdAt || "",
      signature,
      result,
      readableData,
      intelligence,
      cardIntelligence:intelligence,
      scan:{
        createdAt:labState.analysisOrigin?.createdAt || "",
        source:labState.lastSource || "card-lab-analysis",
        sourceLabel:cardLabSourceLabel(labState.lastSource)
      }
    };
  }
  function sourceCandidates(){
    const report=window.CardLabManager?.getReportModel?.();
    return [
      report?.status==="ready" ? enrichSource(report) : null,
      enrichSource(currentCardLabAnalysis()),
      enrichSource(window.ElectronDatabase?.getLatestCardViewerSource?.()),
      enrichSource(window.currentCardReport),
      enrichSource(window.lastScanResult),
      enrichSource(window.exploreCardData)
    ].filter(Boolean);
  }
  function modelFromSource(raw){
    const model=window.CardViewerModel?.build?.(raw);
    if(model?.available) return {...model,uid:model.uid || "Not reported",raw};

    const signature=raw.cardSignature || raw.signature || raw.cardIntelligence?.signature || raw.intelligence?.signature || {};
    const scan=raw.scanRecord || raw.scan || {};
    const uid=raw.uid || signature.uid || raw.result?.parsed?.uid || raw.result?.uid || raw.parsed?.uid || scan.uid || scan.signature?.uid || "";
    if(!uid) return null;
    return {
      available:true,
      uid,
      type:signature.displayName || raw.result?.module?.displayName || raw.displayName || "Unknown card type",
      fields:[],
      fieldGroups:[],
      keys:[],
      access:[],
      sourceLabel:raw.sourceLabel || scan.sourceLabel || scan.source || raw.source || "Stored successful read",
      capturedAt:raw.updatedAt || raw.scanAt || scan.createdAt || raw.capturedAt || "",
      readStatus:"Read successful",
      authentication:{confirmed:false,label:"No successful protected-data authentication is attached",detail:"Publicly exposed data may still be shown. Protected fields and keys remain hidden."},
      notice:"Card Viewer interprets stored read results. Deep Scan runs only after separate user confirmation.",
      raw
    };
  }
  function getCurrentCardData(){
    for(const raw of sourceCandidates()){
      const model=modelFromSource(raw);
      if(model) return model;
    }
    return null;
  }
  function hasReportedUid(data){
    const uid=text(data?.uid).trim();
    return !!uid && uid!=="Not reported";
  }
  function displayTime(value){
    if(!value) return "Time not recorded";
    const date=new Date(value);
    if(Number.isNaN(date.getTime())) return text(value);
    try{ return new Intl.DateTimeFormat(undefined,{dateStyle:"medium",timeStyle:"short"}).format(date); }
    catch{ return date.toLocaleString(); }
  }
  function clampViewerBounds(bounds,viewport={}){
    const viewportWidth=Math.max(320,Number(viewport.width || 0));
    const viewportHeight=Math.max(320,Number(viewport.height || 0));
    const margin=8;
    const maxWidth=Math.max(304,viewportWidth-(margin*2));
    const maxHeight=Math.max(304,viewportHeight-(margin*2));
    const minWidth=Math.min(620,maxWidth);
    const minHeight=Math.min(420,maxHeight);
    const width=Math.max(minWidth,Math.min(maxWidth,Number(bounds?.width || minWidth)));
    const height=Math.max(minHeight,Math.min(maxHeight,Number(bounds?.height || minHeight)));
    const left=Math.max(margin,Math.min(viewportWidth-width-margin,Number(bounds?.left || margin)));
    const top=Math.max(margin,Math.min(viewportHeight-height-margin,Number(bounds?.top || margin)));
    return {left,top,width,height};
  }
  function currentViewport(){
    return {width:Number(window.innerWidth || document.documentElement?.clientWidth || 1280),height:Number(window.innerHeight || document.documentElement?.clientHeight || 800)};
  }
  function applyViewerBounds(overlay){
    if(!overlay) return;
    if(state.viewerMaximized){
      overlay.classList.add("maximized");
      overlay.style.left="0";
      overlay.style.top="0";
      overlay.style.width="100vw";
      overlay.style.height="100vh";
      overlay.style.transform="none";
      return;
    }
    overlay.classList.remove("maximized");
    if(!state.viewerBounds) return;
    state.viewerBounds=clampViewerBounds(state.viewerBounds,currentViewport());
    overlay.style.left=`${state.viewerBounds.left}px`;
    overlay.style.top=`${state.viewerBounds.top}px`;
    overlay.style.width=`${state.viewerBounds.width}px`;
    overlay.style.height=`${state.viewerBounds.height}px`;
    overlay.style.transform="none";
  }
  function rectBounds(rect){
    if(!rect) return null;
    return {
      left:Number(rect.left || 0),
      top:Number(rect.top || 0),
      width:Number(rect.width || 0),
      height:Number(rect.height || 0)
    };
  }
  function toggleViewerMaximized(){
    const overlay=document.getElementById("cardViewerOverlayHost")?.querySelector?.(".cardViewerOverlay");
    if(state.viewerMaximized){
      state.viewerMaximized=false;
      state.viewerBounds=state.viewerRestoreBounds ? clampViewerBounds(state.viewerRestoreBounds,currentViewport()) : null;
      state.viewerRestoreBounds=null;
    }else{
      state.viewerRestoreBounds=rectBounds(overlay?.getBoundingClientRect?.()) || (state.viewerBounds ? {...state.viewerBounds} : null);
      state.viewerMaximized=true;
    }
    render();
  }
  function resetViewerGeometry(){
    state.viewerBounds=null;
    state.viewerRestoreBounds=null;
    state.viewerMaximized=false;
    render();
  }
  function installViewerDrag(host){
    const overlay=host?.querySelector?.(".cardViewerOverlay");
    const header=host?.querySelector?.("[data-card-viewer-drag]");
    if(!overlay || !header) return;
    let dragging=false;
    let startX=0;
    let startY=0;
    let startBounds=null;
    const stop=()=>{
      dragging=false;
      overlay.classList.remove("dragging");
      window.removeEventListener?.("pointermove",move);
      window.removeEventListener?.("pointerup",stop);
      window.removeEventListener?.("pointercancel",stop);
    };
    const move=event=>{
      if(!dragging || !startBounds) return;
      state.viewerBounds=clampViewerBounds({
        left:startBounds.left+(event.clientX-startX),
        top:startBounds.top+(event.clientY-startY),
        width:startBounds.width,
        height:startBounds.height
      },currentViewport());
      applyViewerBounds(overlay);
      event.preventDefault();
    };
    header.addEventListener("pointerdown",event=>{
      if(event.button!==0 || state.viewerMaximized || event.target.closest?.("button")) return;
      startBounds=rectBounds(overlay.getBoundingClientRect());
      state.viewerBounds={...startBounds};
      startX=event.clientX;
      startY=event.clientY;
      dragging=true;
      overlay.classList.add("dragging");
      header.setPointerCapture?.(event.pointerId);
      event.preventDefault();
      window.addEventListener?.("pointermove",move);
      window.addEventListener?.("pointerup",stop,{once:true});
      window.addEventListener?.("pointercancel",stop,{once:true});
    });
    header.addEventListener("dblclick",event=>{
      if(event.target.closest?.("button")) return;
      event.preventDefault();
      toggleViewerMaximized();
    });
  }
  function installViewerResize(host){
    const overlay=host?.querySelector?.(".cardViewerOverlay");
    if(!overlay) return;
    applyViewerBounds(overlay);
    if(state.viewerMaximized) return;
    const handle=document.createElement("button");
    handle.type="button";
    handle.className="cardViewerResizeHandle";
    handle.setAttribute("aria-label","Resize Card Viewer");
    handle.title="Drag to resize Card Viewer. Double-click to reset.";
    handle.innerHTML="<span aria-hidden=\"true\">↘</span>";
    overlay.appendChild(handle);
    handle.addEventListener("dblclick",event=>{
      event.preventDefault();
      resetViewerGeometry();
    });
    handle.addEventListener("pointerdown",event=>{
      if(event.button!==0 || state.deepScanRunning || state.recoveryRunning) return;
      const rect=overlay.getBoundingClientRect();
      const startX=event.clientX;
      const startY=event.clientY;
      state.viewerBounds={left:rect.left,top:rect.top,width:rect.width,height:rect.height};
      applyViewerBounds(overlay);
      overlay.classList.add("resizing");
      handle.setPointerCapture?.(event.pointerId);
      event.preventDefault();
      const move=moveEvent=>{
        state.viewerBounds=clampViewerBounds({
          left:state.viewerBounds.left,
          top:state.viewerBounds.top,
          width:rect.width+(moveEvent.clientX-startX),
          height:rect.height+(moveEvent.clientY-startY)
        },currentViewport());
        applyViewerBounds(overlay);
        moveEvent.preventDefault();
      };
      const stop=()=>{
        overlay.classList.remove("resizing");
        window.removeEventListener("pointermove",move);
        window.removeEventListener("pointerup",stop);
        window.removeEventListener("pointercancel",stop);
      };
      window.addEventListener("pointermove",move);
      window.addEventListener("pointerup",stop,{once:true});
      window.addEventListener("pointercancel",stop,{once:true});
    });
  }
  function resultOutput(item){
    return plain(`${item?.result?.stdout || ""}${item?.result?.stderr || ""}`);
  }
  function storedCardEvidence(data){
    const raw=data?.raw || {};
    const signature=raw.cardSignature || raw.signature || raw.cardIntelligence?.signature || raw.intelligence?.signature || {};
    return [
      data?.type,data?.sourceLabel,signature.displayName,signature.family,signature.protocol,signature.technology,
      raw.result?.module?.displayName,raw.result?.module?.family,raw.result?.module?.protocol,raw.result?.module?.technology,
      ...(Array.isArray(data?.fields)?data.fields.map(field=>`${field?.key || field?.label || ""}: ${field?.value || ""}`):[])
    ].filter(Boolean).join("\n");
  }
  function classicSizeFlag(evidence){
    return profileRegistry?.classicSizeFlag?.(evidence) || "--1k";
  }
  function detectDeepScanProfile(data,results=[]){
    const evidence=storedCardEvidence(data);
    return profileRegistry?.detect?.({evidence,results}) || {id:"unknown",label:"Unknown card type",band:"unknown",confidence:0,commands:[],classificationSteps:[],executionSteps:[],evidence,sak:""};
  }
  function commandReturnedCardData(result){
    const output=resultOutput({result});
    return !!result?.ok && !/no[^\r\n]{0,80}(?:tag|card)s? (?:found|detected)|(?:tag|card) not found|no response from (?:tag|card)|timeout|timed out/i.test(output);
  }
  function currentReadableData(data){
    const raw=data?.raw || {};
    return raw.readableData || raw.cardIntelligence?.readableData || raw.intelligence?.readableData || raw.scanRecord?.readableData || raw.scan?.readableData || {fields:[]};
  }
  function currentSignature(data){
    const raw=data?.raw || {};
    return raw.cardSignature || raw.signature || raw.cardIntelligence?.signature || raw.intelligence?.signature || {
      uid:data?.uid || "",
      displayName:data?.type || "Unknown card type"
    };
  }
  function uniqueBy(items,identity){
    const seen=new Set();
    return items.filter(item=>{
      const id=identity(item);
      if(!id || seen.has(id)) return false;
      seen.add(id);
      return true;
    });
  }
  function parseDeepScanKeys(output,results=[]){
    const keys=[];
    const source=plain(output);
    const table=/(?:^|\n)\s*(?:\[[^\]]+\]\s*)?(\d{1,3})\s*\|\s*\d+\s*\|\s*([0-9A-F]{12}|-+)\s*\|\s*([01])\s*\|\s*([0-9A-F]{12}|-+)\s*\|\s*([01])/gim;
    for(const match of source.matchAll(table)){
      const sector=Number(match[1]);
      if(match[3]==="1" && /^[0-9A-F]{12}$/i.test(match[2])) keys.push({sector,keySlot:"A",keyMaterial:match[2].toUpperCase(),source:"successful hf mf chk",note:/^F{12}$/i.test(match[2])?"default":"read"});
      if(match[5]==="1" && /^[0-9A-F]{12}$/i.test(match[4])) keys.push({sector,keySlot:"B",keyMaterial:match[4].toUpperCase(),source:"successful hf mf chk",note:/^F{12}$/i.test(match[4])?"default":"read"});
    }
    const info=/(?:^|\n)\s*(?:\[[^\]]+\]\s*)?Sector\s+(\d+)\s+key\s+([AB])\.*\s*([0-9A-F]{12})(?:\s|$)/gim;
    for(const match of source.matchAll(info)){
      keys.push({sector:Number(match[1]),keySlot:match[2].toUpperCase(),keyMaterial:match[3].toUpperCase(),source:"successful PM3 key check",note:/^F{12}$/i.test(match[3])?"default":"read"});
    }
    for(const item of Array.isArray(results)?results:[]){
      const context=item?.keyContext;
      if(!Number.isInteger(Number(context?.sector)) || !/^[AB]$/i.test(text(context?.keySlot))) continue;
      const recovered=resultOutput(item).match(/(?:Found valid key|found key)[^0-9A-F]*\[?\s*([0-9A-F]{12})\s*\]?/i)?.[1];
      if(recovered) keys.push({sector:Number(context.sector),keySlot:text(context.keySlot).toUpperCase(),keyMaterial:recovered.toUpperCase(),source:`successful ${item.strategyId || "advanced recovery"}`,note:/^F{12}$/i.test(recovered)?"default":"recovered"});
    }
    return uniqueBy(keys,item=>`${item.sector}:${item.keySlot}:${item.keyMaterial}`);
  }
  function parseDumpBlocks(output){
    const blocks=[];
    const pattern=/(?:^|\n)\s*(?:\[[^\]]+\]\s*)?(?:(\d+)\s*)?\|\s*(\d+)\s*\|\s*((?:[0-9A-F]{2}\s+){15}[0-9A-F]{2})\s*\|/gim;
    for(const match of plain(output).matchAll(pattern)){
      blocks.push({sector:match[1]==null?null:Number(match[1]),block:Number(match[2]),hex:match[3].trim().toUpperCase()});
    }
    return uniqueBy(blocks,item=>String(item.block)).sort((a,b)=>a.block-b.block);
  }
  function decodedDumpText(blocks){
    const bytes=[];
    for(const block of blocks){
      if(block.block===0 || block.block%4===3) continue;
      bytes.push(...block.hex.split(/\s+/).map(value=>Number.parseInt(value,16)));
    }
    return bytes.map(value=>value>=32 && value<=126 ? String.fromCharCode(value) : "\n").join("").split(/\n+/).map(value=>value.trim()).filter(value=>value.length>=4).join("\n");
  }
  function deepScanField(key,label,value,source="deep-scan-output"){
    return value ? {key,label,value:text(value).trim(),category:"technical",exposed:true,source,authentication:"authenticated"} : null;
  }
  function mergeReadableFields(...groups){
    return uniqueBy(groups.flatMap(group=>Array.isArray(group)?group:[]).filter(Boolean),field=>text(field.key || field.label).toLowerCase().replace(/[^a-z0-9]/g,""));
  }
  function sectorRanges(sectors){
    const values=[...new Set(sectors.filter(Number.isInteger))].sort((a,b)=>a-b);
    const ranges=[];
    for(const sector of values){
      const last=ranges[ranges.length-1];
      if(last && sector===last.end+1) last.end=sector;
      else ranges.push({start:sector,end:sector});
    }
    return ranges;
  }
  function buildDeepScanRecord(data,results){
    const output=results.map(item=>`\n[Card Viewer Deep Scan]\n${item.displayCommand || item.command}\n${resultOutput(item)}`).join("\n");
    const scanProfile=detectDeepScanProfile(data,results);
    const recoveredKeys=parseDeepScanKeys(output,results);
    const storedKeys=(Array.isArray(data?.keys)?data.keys:[]).map(item=>({
      sector:Number(item?.sector),
      keySlot:text(item?.keySlot || item?.type).match(/\b([AB])\b/i)?.[1]?.toUpperCase() || "",
      keyMaterial:text(item?.keyMaterial || item?.value).replace(/[^0-9A-F]/gi,"").toUpperCase(),
      source:item?.source || "stored authenticated read",
      note:item?.note || "read"
    })).filter(item=>Number.isInteger(item.sector) && /^[AB]$/.test(item.keySlot) && /^[0-9A-F]{12}$/.test(item.keyMaterial));
    const keys=uniqueBy([...recoveredKeys,...storedKeys],item=>`${item.sector}:${item.keySlot}:${item.keyMaterial}`);
    const blocks=parseDumpBlocks(output);
    const dumpComplete=/Succeeded in dumping all blocks/i.test(output);
    const dumpSectors=[...new Set(blocks.map(item=>item.sector).filter(Number.isInteger))].sort((a,b)=>a-b);
    const keySectors=[...new Set(keys.map(item=>item.sector).filter(Number.isInteger))].sort((a,b)=>a-b);
    const authenticated=dumpComplete || keys.length>0;
    const decoded=decodedDumpText(blocks);
    const extractorInput=`${authenticated?"[Electron authorized read]\n":""}${output}${decoded?`\n[Decoded card data]\n${decoded}`:""}`;
    const extracted=window.ElectronDatabase?.extractReadableCardData?.({parsed:{raw:extractorInput},module:currentSignature(data)}) || window.ReadableDataExtractor?.extract?.({parsed:{raw:extractorInput}}) || {fields:[]};
    const fingerprint=output.match(/(?:^|\n)\s*(?:\[[^\]]+\]\s*)?([^\r\n]*based card)\s*$/im)?.[1]?.trim() || "";
    const magic=output.match(/Magic capabilities\.*\s*([^\r\n]+)/i)?.[1]?.trim() || "";
    const prng=output.match(/Prng(?: detection)?\.*\s*([^\r\n]+)/i)?.[1]?.trim() || "";
    const binaryDump=output.match(/Saved\s+(\d+)\s+bytes\s+to binary file\s+[`']?([^`'\r\n]+)[`']?/i);
    const jsonDump=output.match(/Saved to json file\s+[`']?([^`'\r\n]+)[`']?/i);
    const extraFields=[
      deepScanField("fingerprint","Card fingerprint",fingerprint),
      deepScanField("magicCapability","Magic capability",magic),
      deepScanField("prng","PRNG",prng),
      deepScanField("dumpStatus","Dump status",dumpComplete?"Complete":""),
      deepScanField("readableSectors","Readable sectors",dumpSectors.length?`${dumpSectors.length} sector${dumpSectors.length===1?"":"s"}`:""),
      deepScanField("dumpSize","Dump size",binaryDump?.[1]?`${binaryDump[1]} bytes`:""),
      deepScanField("binaryDump","Binary dump",binaryDump?.[2]?.trim() || ""),
      deepScanField("jsonDump","JSON dump",jsonDump?.[1]?.trim() || "")
    ].filter(Boolean);
    const existing=currentReadableData(data);
    const fields=mergeReadableFields(extracted.fields,extraFields,existing.fields);
    const access=[];
    if(dumpComplete && dumpSectors.length){
      for(const range of sectorRanges(dumpSectors)) access.push({
        label:`Sector ${range.start}${range.end===range.start?"":`–${range.end}`}`,
        status:"readable",
        detail:"Successfully included in the authenticated card dump"
      });
    }else if(keySectors.length){
      for(const range of sectorRanges(keySectors)) access.push({
        label:`Sector ${range.start}${range.end===range.start?"":`–${range.end}`}`,
        status:"authenticated",
        detail:"A valid sector key was confirmed; a readable dump was not confirmed"
      });
    }
    if(!access.length && Array.isArray(data?.access)) access.push(...data.access);
    const commands=results.map(item=>({
      command:item.displayCommand || item.command,
      ok:!!item.result?.ok,
      pm3Ok:!!item.result?.ok,
      message:item.result?.message || "",
      outputLength:resultOutput(item).length
    }));
    return {
      signature:currentSignature(data),
      scanProfile:{id:scanProfile.id,label:scanProfile.label,band:scanProfile.band,sak:scanProfile.sak || ""},
      status:authenticated?"success":"failed",
      message:authenticated
        ? dumpComplete?`Authentication success. Complete dump captured from ${dumpSectors.length || "the available"} sectors.`:`Authentication success. ${keys.length} valid sector key result${keys.length===1?"":"s"} captured.`
        :"Deep Scan completed, but no successful authentication evidence was found.",
      stats:{
        detectedProfile:scanProfile.id,
        readableSectors:dumpComplete?dumpSectors.length:0,
        authenticatedSectors:keySectors.length,
        totalSectors:Math.max(dumpSectors.length,keySectors.length),
        keyResults:keys.length,
        additionalReadableFields:fields.length
      },
      commands,
      keys,
      access,
      output,
      readableData:{...extracted,fields,availableCount:fields.length,decodedText:decoded},
      debug:{pm3Invoked:results.length>0,pm3Calls:results.length,outputLength:output.length,dumpComplete,blockCount:blocks.length,scanProfile:scanProfile.id}
    };
  }
  function persistDeepScanRecord(data,results,metadata={}){
    const record=buildDeepScanRecord(data,results);
    if(metadata.recovery) record.recovery=metadata.recovery;
    const saved=window.ElectronDatabase?.saveAuthorizedReadResult?.(record) || record;
    window.CardLabManager?.rebuildReportModel?.("card-viewer-deep-scan");
    return saved;
  }
  function parseCompletedDeepScanConsole(value){
    const consoleText=plain(value).replace(/\r/g,"");
    const completionIndex=consoleText.lastIndexOf("[Card Viewer Deep Scan complete]");
    if(completionIndex<0) return [];
    const beforeCompletion=consoleText.slice(0,completionIndex);
    const startIndex=Math.max(
      beforeCompletion.lastIndexOf("[Card Viewer Deep Scan]\nhf search"),
      beforeCompletion.lastIndexOf("[Card Viewer Deep Scan]\nlf search")
    );
    if(startIndex<0) return [];
    const segment=beforeCompletion.slice(startIndex);
    const results=[];
    const pattern=/\[Card Viewer Deep Scan\]\s*\n([^\n]+)\n([\s\S]*?)(?=\n\[Card Viewer Deep Scan\]\s*\n|$)/g;
    for(const match of segment.matchAll(pattern)){
      const command=match[1].trim();
      if(!DEEP_SCAN_COMMANDS.includes(command)) continue;
      const stdout=match[2].trim();
      results.push({command,result:{ok:!!stdout && !/command (?:execution )?timed out|command exited with code/i.test(stdout),message:"Recovered from Device Console",stdout,stderr:""}});
    }
    return results.length>=1 ? results : [];
  }
  function compactUid(value){ return text(value).toUpperCase().replace(/[^0-9A-F]/g,""); }
  function uidFromOutput(value){ return plain(value).match(/\bUID:\s*([0-9A-F]{2}(?:[ :.-]+[0-9A-F]{2}){3,9})/i)?.[1] || ""; }
  function recoverLatestDeepScan(){
    const data=getCurrentCardData();
    if(!hasReportedUid(data) || data.authentication?.confirmed || !window.electronGetPm3Terminal) return null;
    const results=parseCompletedDeepScanConsole(window.electronGetPm3Terminal());
    if(!results.length) return null;
    const output=results.map(resultOutput).join("\n");
    const scannedUid=uidFromOutput(output);
    if(!scannedUid || compactUid(scannedUid)!==compactUid(data.uid)) return null;
    const preview=buildDeepScanRecord(data,results);
    if(preview.status!=="success") return null;
    const saved=persistDeepScanRecord(data,results);
    state.deepScanStatus=`Recovered the completed Deep Scan from Device Console: ${saved.stats?.keyResults || 0} key results and ${saved.stats?.readableSectors || 0} readable sectors.`;
    return saved;
  }
  function fieldCard(field){
    return `<div class="cardViewerField"><span>${escapeHtml(field.label)}</span><b>${escapeHtml(field.value)}</b><small>Source: ${escapeHtml(field.source || "stored read data")}${field.authentication==="authenticated"?" · authentication confirmed":""}</small></div>`;
  }
  function groupedFields(model){
    const groups=Array.isArray(model.fieldGroups) ? model.fieldGroups.filter(group=>Array.isArray(group?.fields) && group.fields.length) : [];
    if(!groups.length && model.fields?.length) return `<div class="cardViewerFields">${model.fields.map(fieldCard).join("")}</div>`;
    if(!groups.length) return `<p class="cardViewerEmptyText">No additional human-readable application fields were exposed by this read.</p>`;
    return `<div class="cardViewerGroups">${groups.map(group=>`<section class="cardViewerGroup"><h4>${escapeHtml(group.label)}</h4><div class="cardViewerFields">${group.fields.map(fieldCard).join("")}</div></section>`).join("")}</div>`;
  }
  function emvCoverageSection(model){
    const coverage=model?.emvReadCoverage;
    if(!coverage?.fields?.length) return "";
    const checked=coverage.commandsChecked?.length ? coverage.commandsChecked.join(" · ") : "stored EMV Extended Analysis";
    const rows=coverage.fields.map(field=>{
      const source=field.commands?.length ? `Detected by: ${field.commands.join(" · ")}` : `Checked by: ${checked}`;
      return `<div class="cardViewerEmvCoverageRow ${field.detected?"detected":"missing"}"><div><span>${escapeHtml(field.label)}</span><b>${field.detected?"Detected":"Not reported by this read"}</b></div><p>${escapeHtml(field.detail)}</p><small>${escapeHtml(source)}</small></div>`;
    }).join("");
    const footer=coverage.detailed
      ? `Parser ${coverage.parserVersion || "version not reported"} · Full PAN and Track 2 values are never stored.`
      : "This stored analysis predates per-command field diagnostics. Run EMV Extended Analysis again to capture a privacy-safe command-by-command result.";
    return `<section class="cardViewerSection cardViewerEmvCoverage"><div class="cardViewerSectionTitle"><div><span>EMV field check</span><h3>What this read did and did not report</h3></div><small>Presence only · privacy-safe</small></div><div class="cardViewerEmvCoverageGrid">${rows}</div><p class="cardViewerEmvCoverageFooter">${escapeHtml(footer)}</p></section>`;
  }
  function workflowRunning(){ return state.deepScanRunning || state.recoveryRunning; }
  function captureViewerScroll(host){
    const body=host?.querySelector?.(".deviceStudioOverlayBody");
    if(!body) return null;
    return {top:Number(body.scrollTop || 0),left:Number(body.scrollLeft || 0)};
  }
  function restoreViewerScroll(host,snapshot){
    if(!snapshot) return;
    const body=host?.querySelector?.(".deviceStudioOverlayBody");
    if(!body) return;
    const apply=()=>{
      body.scrollTop=snapshot.top;
      body.scrollLeft=snapshot.left;
    };
    apply();
    window.requestAnimationFrame?.(()=>{
      apply();
      window.requestAnimationFrame?.(apply);
    });
    window.setTimeout?.(apply,50);
  }
  function installViewerScrollTracking(host){
    const body=host?.querySelector?.(".deviceStudioOverlayBody");
    if(!body) return;
    body.addEventListener?.("scroll",()=>{
      state.viewerScrollPosition={top:Number(body.scrollTop || 0),left:Number(body.scrollLeft || 0)};
    },{passive:true});
  }
  function beginWorkflowProgress({id,title,status,cancellable=false}){
    state.workflowProgress=workflowProgress?.create?.({
      id,
      title,
      status,
      cancellable,
      unitSingular:"PM3 command",
      unitPlural:"PM3 commands"
    }) || null;
  }
  function setWorkflowProgressStatus(status,currentCommand=""){
    if(!state.workflowProgress) return;
    workflowProgress?.setStatus?.(state.workflowProgress,status,currentCommand);
    updateWorkflowProgressDom();
  }
  function startWorkflowProgressStep(label,command){
    if(!state.workflowProgress) return;
    workflowProgress?.startStep?.(state.workflowProgress,{label,command});
    updateWorkflowProgressDom();
  }
  function finishWorkflowProgressStep(command,result){
    if(!state.workflowProgress) return;
    workflowProgress?.finishStep?.(state.workflowProgress,command,result);
    updateWorkflowProgressDom();
  }
  function renderWorkflowProgressPanel(){
    return workflowProgress?.render?.(state.workflowProgress,{
      visible:workflowRunning(),
      cancelAvailable:state.recoveryRunning,
      cancelling:state.recoveryCancelling
    }) || "";
  }
  function bindWorkflowProgressActions(host){
    workflowProgress?.bind?.(host,cancelAdvancedRecovery);
  }
  function updateWorkflowProgressDom(){
    const host=document.getElementById("cardViewerOverlayHost");
    workflowProgress?.replace?.(host,state.workflowProgress,{
      visible:workflowRunning(),
      cancelAvailable:state.recoveryRunning,
      cancelling:state.recoveryCancelling,
      onCancel:cancelAdvancedRecovery
    });
  }
  function close(){
    if(workflowRunning()) return;
    state.open=false;
    render();
  }
  async function runDeepScanCommand(command,options={}){
    if(!window.pm3api?.runPm3LiveCommand) return {ok:false,message:"PM3 live command runner is not available.",stdout:"",stderr:""};
    const workflow=options.workflow || "Deep Scan";
    window.electronAppendPm3Terminal?.(`\n[Card Viewer ${workflow}]\n${options.displayCommand || command}\n`,{forceScroll:true});
    return window.pm3api.runPm3LiveCommand(command,{timeoutMs:options.timeoutMs});
  }
  async function runPrivateWorkflowCommand(step,plan){
    if(!window.pm3api?.runPm3Command) return {ok:false,message:"Private PM3 command runner is not available.",stdout:"",stderr:""};
    const displayCommand=step.displayCommand || step.command;
    window.electronAppendPm3Terminal?.(`\n[Card Viewer ${plan.title}]\n${displayCommand}\n`,{forceScroll:true});
    const result=await window.pm3api.runPm3Command(step.command,{timeoutMs:step.timeoutMs});
    const raw=resultOutput({result});
    const summary=plan.profileId==="emv"
      ? emvRedactor?.consoleSummary?.(emvRedactor.extract(raw))
      : "Sensitive raw card output was not shown or stored. Execution metadata only.";
    window.electronAppendPm3Terminal?.(`${summary || "No redacted metadata was exposed."}\n`,{forceScroll:true});
    return result;
  }
  async function deepScan(){
    if(workflowRunning()) return;
    const data=getCurrentCardData();
    if(!hasReportedUid(data)){
      alert("Card data is available, but this read did not report a UID.\nRun Quick Scan or Explore Card again before starting a live workflow.");
      return;
    }
    if(!confirm(`Run Deep Scan on card UID ${data.uid}?\n\nAuto-detects card type.`)) return;
    if(!window.pm3api?.runPm3LiveCommand){
      alert("PM3 live command runner is not available.");
      return;
    }

    state.deepScanRunning=true;
    beginWorkflowProgress({id:"deep-scan",title:"Deep Scan",status:"Preparing live card detection..."});
    render();
    const results=[];
    try{
      const execute=async(command,label="")=>{
        const existing=results.find(item=>item.command===command);
        if(existing) return existing.result;
        state.deepScanStatus=label || `Running: ${command}`;
        startWorkflowProgressStep(state.deepScanStatus,command);
        let result;
        try{ result=await runDeepScanCommand(command); }
        catch(error){ result={ok:false,message:String(error?.message || error),stdout:"",stderr:""}; }
        results.push({command,result});
        finishWorkflowProgressStep(command,result);
        return result;
      };
      const executeStep=step=>execute(step.command,`Running ${step.phase}: ${step.command}`);

      let profile=detectDeepScanProfile(data,results);
      let discoveryCommand=profile.band==="lf" ? "lf search" : "hf search";
      let discoveryResult=await execute(discoveryCommand,`Detecting card type with ${discoveryCommand}...`);

      if(discoveryCommand==="hf search" && profile.band==="unknown" && !commandReturnedCardData(discoveryResult)){
        discoveryCommand="lf search";
        discoveryResult=await execute(discoveryCommand,"No HF card answered; checking LF / 125 kHz...");
      }

      profile=detectDeepScanProfile(data,results);
      if(profile.band==="hf-14a" || (discoveryCommand==="hf search" && /ISO\s*14443-?A|MIFARE|NTAG|Ultralight|DESFire|\bEMV\b|ATQA|\bSAK\b/i.test(resultOutput({result:discoveryResult})))){
        const infoResult=await execute("hf 14a info","Reading ISO14443-A identification data...");
        const liveUid=uidFromOutput(resultOutput({result:infoResult}));
        if(!infoResult?.ok || !liveUid){
          throw new Error("The live ISO14443-A card UID could not be confirmed.");
        }
        if(compactUid(liveUid)!==compactUid(data.uid)){
          throw new Error(`Live card UID ${liveUid.trim()} does not match stored UID ${data.uid}.`);
        }
        profile=detectDeepScanProfile(data,results);
      }

      if(profile.classificationSteps?.length){
        for(const step of profile.classificationSteps){
          state.deepScanStatus=`Classifying SAK ${profile.sak || "20"}: ${step.command}`;
          setWorkflowProgressStatus(state.deepScanStatus);
          await executeStep(step);
          const candidate=detectDeepScanProfile(data,results);
          if(!["iso14443a","unknown"].includes(candidate.id) && candidate.confidence>=90){
            profile=candidate;
            break;
          }
          profile=candidate;
        }
      }

      state.deepScanStatus=`${profile.label} detected - selecting matching read commands`;
      setWorkflowProgressStatus(state.deepScanStatus);
      for(const step of profile.executionSteps || profile.commands.map(command=>({command,phase:"read"}))){
        await execute(step.command,`Running ${profile.label}: ${step.command}`);
      }
      profile=detectDeepScanProfile(data,results);

      const saved=persistDeepScanRecord(data,results);
      const succeeded=results.filter(item=>item.result?.ok).length;
      state.deepScanStatus=saved.status==="success"
        ? `${profile.label} Deep Scan saved: ${saved.stats?.keyResults || 0} key result${saved.stats?.keyResults===1?"":"s"}, ${saved.stats?.readableSectors || 0} readable sector${saved.stats?.readableSectors===1?"":"s"}, ${saved.readableData?.availableCount || 0} displayed field${saved.readableData?.availableCount===1?"":"s"}.`
        : `${profile.label} Deep Scan saved: ${succeeded} of ${results.length} commands completed; no authenticated protected data was added.`;
      setWorkflowProgressStatus(state.deepScanStatus);
      window.electronAppendPm3Terminal?.(`\n[Card Viewer Deep Scan complete]\n${state.deepScanStatus}\n`,{forceScroll:true});
    }catch(error){
      state.deepScanStatus=`Deep Scan stopped: ${error?.message || "scan error"}`;
      setWorkflowProgressStatus(state.deepScanStatus);
      window.electronAppendPm3Terminal?.(`\n[Card Viewer Deep Scan stopped]\n${state.deepScanStatus}\n`,{forceScroll:true});
      console.error(error);
    }finally{
      state.deepScanRunning=false;
      state.workflowProgress=null;
      render();
    }
  }
  function recoveryPlan(data){
    const profile=detectDeepScanProfile(data);
    const raw=data?.raw || {};
    const credentials=[
      ...(Array.isArray(data?.keys)?data.keys:[]),
      ...(Array.isArray(raw?.authorizedKeys)?raw.authorizedKeys:[]),
      ...(Array.isArray(raw?.cardIntelligence?.authorizedKeys)?raw.cardIntelligence.authorizedKeys:[]),
      ...(Array.isArray(raw?.intelligence?.authorizedKeys)?raw.intelligence.authorizedKeys:[])
    ];
    return profileRegistry?.advancedWorkflowPlan?.(profile,{keys:credentials,credentials}) || profileRegistry?.advancedRecoveryPlan?.(profile,{keys:credentials}) || {supported:false,reason:"Family workflow planning is unavailable.",strategies:[]};
  }
  function advancedWorkflowPlan(data){ return recoveryPlan(data); }
  function hasConfirmedRecoveryKey(data,results=[]){
    return (Array.isArray(data?.keys) && data.keys.some(item=>/^[0-9A-F]{12}$/i.test(text(item?.value || item?.keyMaterial).replace(/[^0-9A-F]/gi,"")))) || parseDeepScanKeys(results.map(resultOutput).join("\n"),results).length>0;
  }
  async function cancelAdvancedRecovery(){
    if(!state.recoveryRunning || state.recoveryCancelling) return;
    state.recoveryCancelling=true;
    state.recoveryStatus="Cancelling the active PM3 command and releasing the device port...";
    setWorkflowProgressStatus(state.recoveryStatus);
    try{
      const result=await window.pm3api?.cancelPm3LiveCommand?.();
      state.recoveryStatus=result?.message || "Cancel requested.";
      setWorkflowProgressStatus(state.recoveryStatus);
    }catch(error){
      state.recoveryStatus=`Cancel failed: ${error?.message || error}`;
      setWorkflowProgressStatus(state.recoveryStatus);
    }
  }
  function stepHasSuccessEvidence(step,result){
    if(!result?.ok) return false;
    const evidence=Array.isArray(step?.successEvidence)?step.successEvidence.filter(Boolean):[];
    if(!evidence.length) return true;
    const output=resultOutput({result});
    if(/(?:not available|not found|not detected|failed|failure|timeout|timed out|wrong card|no response|application directory not found)/i.test(output)) return false;
    return evidence.some(value=>output.toLowerCase().includes(text(value).toLowerCase()));
  }
  function persistAdvancedWorkflow(data,profile,plan,strategy,results,cancelled){
    if(plan.workflowType==="recovery"){
      return persistDeepScanRecord(data,results,{recovery:{strategyId:strategy.id,label:strategy.label,riskLevel:strategy.riskLevel,cancelled,completedAt:new Date().toISOString()}});
    }
    const context={signature:currentSignature(data),profile,plan,strategy,results,cancelled};
    if(plan.persistPolicy==="metadata-only"){
      const record=workflowResultBuilder?.buildMetadataRecord?.(context) || {signature:context.signature,profile:{id:profile.id,label:profile.label,band:profile.band},workflowType:plan.workflowType,workflowTitle:plan.title,strategy:{id:strategy.id,label:strategy.label,riskLevel:strategy.riskLevel},status:cancelled?"cancelled":"completed",privacyClass:plan.privacyClass,persistPolicy:"metadata-only",commands:results.map(item=>({command:item.displayCommand || item.command,phase:item.phase,ok:!!item.result?.ok,status:item.result?.status || (item.result?.ok?"completed":"failed"),outputLength:resultOutput(item).length})),rawOutputStored:false,summary:"Sensitive raw card output was not stored."};
      return window.ElectronDatabase?.saveFamilyAnalysisResult?.(record) || record;
    }
    const record=workflowResultBuilder?.buildAuthenticatedReadRecord?.(context);
    const saved=record ? (window.ElectronDatabase?.saveAuthorizedReadResult?.(record) || record) : null;
    if(saved?.status==="success") window.CardLabManager?.rebuildReportModel?.("card-viewer-family-authenticated-read");
    return saved;
  }
  async function advancedRecovery(strategyId){
    if(workflowRunning()) return;
    const data=getCurrentCardData();
    if(!hasReportedUid(data)){ alert("No real card UID is available for this workflow."); return; }
    const plan=recoveryPlan(data);
    const strategy=plan.strategies?.find(item=>item.id===strategyId);
    if(!plan.supported || !strategy){ alert(plan.reason || "This family workflow is unavailable."); return; }
    if(!strategy.available){ alert(strategy.unavailableReason || "This family workflow is not currently applicable."); return; }
    const allSteps=[...(plan.familyCheckSteps || []),...(strategy.steps || [])];
    const commands=allSteps.map(item=>item.displayCommand || item.command).filter((value,index,items)=>items.indexOf(value)===index).join("\n");
    if(!confirm(`${plan.title}: ${strategy.label}\n\n${strategy.description}\n\nCard UID: ${data.uid}\nDetected family: ${plan.profileLabel || plan.profileId}\nRisk: ${strategy.riskLevel.toUpperCase()}\nPrivacy: ${plan.persistPolicy==="metadata-only"?"raw card output will not be stored":"successful authenticated data may be stored locally"}\n\nContinue to the final confirmation?`)) return;
    if(!confirm(`FINAL CONFIRMATION\n\nConfirm the live UID and family, then run these read-only PM3 commands?\n\n${commands}\n\nThe workflow can be cancelled, but an active command may need a few seconds to release the PM3 port.`)) return;
    const privateWorkflow=plan.persistPolicy==="metadata-only";
    const runnerAvailable=privateWorkflow ? window.pm3api?.runPm3Command : window.pm3api?.runPm3LiveCommand;
    if(!runnerAvailable || !window.pm3api?.cancelPm3LiveCommand){ alert("The cancellable PM3 workflow runner is not available."); return; }

    state.recoveryRunning=true;
    state.recoveryCancelling=false;
    state.activeRecoveryId=strategy.id;
    state.recoveryStatus=`Starting ${strategy.label}...`;
    beginWorkflowProgress({id:"advanced-workflow",title:plan.title,status:state.recoveryStatus,cancellable:true});
    render();
    const results=[];
    let cancelled=false;
    try{
      const execute=async step=>{
        state.recoveryStatus=`${strategy.label}: ${step.label || step.command}`;
        startWorkflowProgressStep(state.recoveryStatus,step.displayCommand || step.command);
        let result;
        try{
          result=privateWorkflow
            ? await runPrivateWorkflowCommand(step,plan)
            : await runDeepScanCommand(step.command,{workflow:plan.title,timeoutMs:step.timeoutMs,displayCommand:step.displayCommand || step.command});
        }
        catch(error){ result={ok:false,status:"failed",message:String(error?.message || error),stdout:"",stderr:""}; }
        results.push({command:step.command,displayCommand:step.displayCommand || step.command,result,keyContext:step.keyContext || null,strategyId:strategy.id,phase:step.phase,timeoutMs:step.timeoutMs,step});
        finishWorkflowProgressStep(step.displayCommand || step.command,result);
        if(result?.status==="cancelled") cancelled=true;
        return result;
      };

      const infoResult=await execute({command:"hf 14a info",displayCommand:"hf 14a info",label:"Confirm live card UID",phase:"identification",timeoutMs:45000});
      const liveUid=uidFromOutput(resultOutput({result:infoResult}));
      if(cancelled) throw new Error(`${plan.title} cancelled.`);
      if(!infoResult?.ok || !liveUid) throw new Error("The live ISO14443-A card UID could not be confirmed.");
      if(compactUid(liveUid)!==compactUid(data.uid)) throw new Error(`Live card UID ${liveUid.trim()} does not match stored UID ${data.uid}.`);

      for(const step of plan.familyCheckSteps || []){
        if(cancelled || state.recoveryCancelling) break;
        const existing=results.find(item=>item.command===step.command);
        const result=existing?.result || await execute(step);
        if(!stepHasSuccessEvidence(step,result)) throw new Error(`Live card family could not be confirmed as ${plan.profileLabel || plan.profileId}.`);
      }

      for(const step of strategy.steps){
        if(cancelled || state.recoveryCancelling) break;
        if(results.some(item=>item.command===step.command)) continue;
        if(step.phase==="authenticated-read"){
          if(plan.workflowType==="recovery" && !hasConfirmedRecoveryKey(data,results)){
            state.recoveryStatus="No valid key was confirmed, so the authenticated dump was skipped.";
            setWorkflowProgressStatus(state.recoveryStatus);
            break;
          }
        }
        let activeStep=step;
        if(step.phase==="verification"){
          const found=parseDeepScanKeys(results.map(resultOutput).join("\n"),results);
          const recoveredMaterials=[...new Set(found.filter(item=>/recovered|advanced recovery|darkside|nested|hardnested|brute|autopwn/i.test(`${item.note} ${item.source}`)).map(item=>item.keyMaterial))];
          if(recoveredMaterials.length) activeStep={...step,command:`${step.command} ${recoveredMaterials.map(value=>`-k ${value}`).join(" ")}`};
        }
        const result=await execute(activeStep);
        if(cancelled) break;
        if(!result?.ok && step.phase==="recovery" && !parseDeepScanKeys(resultOutput({result}),results).length){
          state.recoveryStatus=`${strategy.label} did not return a valid key; later recovery steps were skipped.`;
          break;
        }
      }

      if(results.length){
        const saved=persistAdvancedWorkflow(data,detectDeepScanProfile(data,results),plan,strategy,results,cancelled);
        const newKeys=parseDeepScanKeys(results.map(resultOutput).join("\n"),results).length;
        state.recoveryStatus=cancelled
          ? `${plan.title} cancelled.${plan.workflowType==="recovery"?` ${newKeys} recovered key result${newKeys===1?"":"s"} were preserved.`:""}`
          : plan.persistPolicy==="metadata-only"
            ? `${strategy.label} completed. Sensitive raw output was not stored.`
          : plan.workflowType==="authenticated-read" && saved?.status==="success"
            ? `${strategy.label} completed. The bounded authenticated result was stored.`
          : saved?.status==="success"
            ? `${strategy.label} completed: ${saved.stats?.keyResults || 0} stored key result${saved.stats?.keyResults===1?"":"s"}, ${saved.stats?.readableSectors || 0} readable sector${saved.stats?.readableSectors===1?"":"s"}.`
            : `${strategy.label} finished without confirmed authenticated card data.`;
        setWorkflowProgressStatus(state.recoveryStatus);
        window.electronAppendPm3Terminal?.(`\n[Card Viewer ${plan.title} complete]\n${state.recoveryStatus}\n`,{forceScroll:true});
      }
    }catch(error){
      state.recoveryStatus=error?.message || `${plan.title} stopped.`;
      setWorkflowProgressStatus(state.recoveryStatus);
      window.electronAppendPm3Terminal?.(`\n[Card Viewer ${plan.title} stopped]\n${state.recoveryStatus}\n`,{forceScroll:true});
    }finally{
      state.recoveryRunning=false;
      state.recoveryCancelling=false;
      state.activeRecoveryId="";
      state.workflowProgress=null;
      render();
    }
  }
  function viewerHeader(eyebrow,description,closeDisabled=false){
    const windowLabel=state.viewerMaximized ? "Restore" : "Full screen";
    const windowIcon=state.viewerMaximized ? "❐" : "⛶";
    return `<header data-card-viewer-drag title="Drag to move Card Viewer. Double-click to toggle full screen."><div><span>${escapeHtml(eyebrow)}</span><h2>Card Viewer</h2><p>${escapeHtml(description)}</p></div><div class="cardViewerHeaderActions"><button type="button" class="cardViewerWindowControl" data-card-viewer-maximize aria-label="${windowLabel} Card Viewer" aria-pressed="${state.viewerMaximized?"true":"false"}" title="${windowLabel} Card Viewer"><span aria-hidden="true">${windowIcon}</span><b>${windowLabel}</b></button><button type="button" class="deviceStudioOverlayClose" data-card-viewer-close aria-label="Close Card Viewer" ${closeDisabled?"disabled":""}>×<span>Close</span></button></div></header>`;
  }
  function render(){
    const host=document.getElementById("cardViewerOverlayHost");
    if(!host) return;
    const scrollSnapshot=captureViewerScroll(host);
    if(!state.open){ host.innerHTML=""; return; }
    const model=getCurrentCardData();
    if(!model){
      host.innerHTML=`<div class="deviceStudioOverlayBackdrop" data-card-viewer-close></div><section class="deviceStudioOverlay cardViewerOverlay" role="dialog" aria-modal="true" aria-label="Card Viewer">${viewerHeader("Card Lab · stored read data","A human-friendly view of card data Electron has already read.")}<div class="deviceStudioOverlayBody"><div class="cardViewerEmpty"><span>No card data to show</span><h3>No successful card read is stored yet.</h3><p>Use Quick Scan or Explore Card first, then reopen Card Viewer.</p></div></div></section>`;
    }else{
      const fields=groupedFields(model);
      const emvCoverage=emvCoverageSection(model);
      const keys=model.keys?.length ? model.keys.map(item=>`<div class="cardViewerKey"><div><span>${escapeHtml(item.label)}</span><b>${escapeHtml(item.type)}</b></div><code>${escapeHtml(item.value)}</code><small>${escapeHtml(item.note)} · Source: ${escapeHtml(item.source)}</small></div>`).join("") : `<p class="cardViewerEmptyText">${model.authentication?.confirmed?"Authentication succeeded, but no matching key value is stored for display.":"No key values are shown because successful protected-data authentication is not attached to this card read."}</p>`;
      const access=model.access?.length ? model.access.map(item=>`<div class="cardViewerAccess ${item.status}"><b>${escapeHtml(item.label)}</b><span>${escapeHtml(item.detail)}</span></div>`).join("") : `<p class="cardViewerEmptyText">No authenticated sector or file access results are available.</p>`;
      const known=model.knownByYou ? `<section class="cardViewerSection"><div class="cardViewerSectionTitle"><div><span>Local context</span><h3>Known by You</h3></div><small>User-supplied · not claimed as card-read data</small></div><div class="cardViewerFields"><div class="cardViewerField"><span>Nickname / owner</span><b>${escapeHtml(model.knownByYou.nickname || model.knownByYou.owner || "Not named")}</b><small>${escapeHtml([model.knownByYou.category,model.knownByYou.location].filter(Boolean).join(" · ") || "Stored locally")}</small></div>${model.knownByYou.notes?`<div class="cardViewerField wide"><span>Notes</span><b>${escapeHtml(model.knownByYou.notes)}</b><small>Source: Known by You</small></div>`:""}</div></section>` : "";
      const identityReady=hasReportedUid(model);
      const deepStatus=state.deepScanStatus
        ? `<p class="cardViewerDeepScanStatus">${escapeHtml(state.deepScanStatus)}</p>`
        : (!identityReady ? `<p class="cardViewerDeepScanStatus">Card data is available, but this read did not report a UID. UID-dependent live workflows are unavailable.</p>` : "");
      const detectedProfile=detectDeepScanProfile(model);
      const plan=recoveryPlan(model);
      const recoveryStatus=state.recoveryStatus ? `<p class="cardViewerRecoveryStatus">${escapeHtml(state.recoveryStatus)}</p>` : "";
      const workflowSummary=plan.workflowType==="recovery"
        ? `<div class="cardViewerRecoverySummary"><span>Card size <b>${escapeHtml(text(plan.size).replace("--","").toUpperCase())}</b></span><span>Known keys <b>${Number(plan.knownKeyCount || 0)}</b></span><span>Missing key slots <b>${Number(plan.missingKeySlots || 0)}</b></span></div>`
        : `<div class="cardViewerRecoverySummary"><span>Card family <b>${escapeHtml(plan.profileLabel || detectedProfile.label)}</b></span><span>Storage <b>${plan.persistPolicy==="metadata-only"?"Redacted metadata":"Authenticated data"}</b></span><span>Confirmations <b>${Number(plan.confirmationCount || 2)}</b></span></div>`;
      const recoveryDetails=plan.supported && (state.recoveryOpen || state.recoveryRunning) ? `<div class="cardViewerRecoveryDetails">${workflowSummary}<div class="cardViewerRecoveryStrategies">${plan.strategies.map(strategy=>`<article class="cardViewerRecoveryStrategy ${strategy.available?"available":"unavailable"}"><div><strong>${escapeHtml(strategy.label)}</strong><span>${escapeHtml(strategy.riskLevel)} risk · timeout ${Math.max(1,Math.round(strategy.timeoutMs/60000))} min</span></div><p>${escapeHtml(strategy.available?strategy.description:strategy.unavailableReason)}</p>${strategy.target?`<small>Target: ${escapeHtml(strategy.target)}</small>`:""}<button type="button" data-recovery-strategy="${escapeHtml(strategy.id)}" ${strategy.available&&!workflowRunning()&&identityReady?"":"disabled"}>Run ${escapeHtml(strategy.label)}</button></article>`).join("")}</div>${state.recoveryRunning?`<button id="cancelRecoveryBtn" type="button" class="cardViewerRecoveryCancel" ${state.recoveryCancelling?"disabled":""}>${state.recoveryCancelling?"Cancelling…":`Cancel active ${escapeHtml(plan.title.toLowerCase())}`}</button>`:""}${!identityReady?`<p class="cardViewerRecoveryStatus">A reported UID is required before a live family workflow can start.</p>`:""}${recoveryStatus}</div>` : recoveryStatus;
      const recovery=plan.supported
        ? `<section class="cardViewerSection cardViewerRecovery"><div class="cardViewerSectionTitle"><div><span>${escapeHtml(plan.eyebrow || "Family-specific workflow")}</span><h3>${escapeHtml(plan.title || "Advanced Workflow")}</h3></div><small>Read-only · two confirmations · cancellable</small></div><p>${escapeHtml(plan.description || "Runs a separately confirmed workflow for this card family.")}</p><button id="advancedRecoveryToggle" type="button" ${workflowRunning()?"disabled":""}>${state.recoveryOpen?"Hide workflow options":"Show workflow options"}</button>${recoveryDetails}</section>`
        : `<section class="cardViewerSection cardViewerRecoveryUnavailable"><div class="cardViewerSectionTitle"><div><span>Family-specific workflow</span><h3>Advanced Workflow</h3></div><small>Not available for ${escapeHtml(detectedProfile.label)}</small></div><p>${escapeHtml(plan.reason || "No separate workflow is available for this card family.")} The family-specific Deep Scan above remains available.</p></section>`;
      const workflowNotice=plan.supported
        ? `<p>Card Viewer displays stored read results. Deep Scan and ${escapeHtml(plan.title)} must each be started explicitly.</p><small>${escapeHtml(plan.title)} requires a strategy selection followed by two confirmations.</small>`
        : `<p>Card Viewer displays stored read results. Deep Scan must be started explicitly.</p><small>No separate advanced workflow is available for ${escapeHtml(detectedProfile.label)}.</small>`;
      host.innerHTML=`<div class="deviceStudioOverlayBackdrop" data-card-viewer-close></div><section class="deviceStudioOverlay cardViewerOverlay" role="dialog" aria-modal="true" aria-label="Card Viewer">${viewerHeader(`Card Lab · ${model.sourceLabel}`,"Stored card data, Deep Scan and family-specific workflows are kept separate.",workflowRunning())}${renderWorkflowProgressPanel()}<div class="deviceStudioOverlayBody"><section class="cardViewerHero"><div><span>Card type</span><h3>${escapeHtml(model.type)}</h3><p>${escapeHtml(model.uid)}</p></div><div class="cardViewerStatus ${model.authentication?.confirmed?"authenticated":"public"}"><span>${escapeHtml(model.readStatus || "Read successful")}</span><b>${escapeHtml(model.authentication?.label || "Authentication not reported")}</b><small>${escapeHtml(model.authentication?.detail || "")}</small></div></section><div class="cardViewerMeta"><span>UID <b>${escapeHtml(model.uid)}</b></span><span>Read source <b>${escapeHtml(model.sourceLabel)}</b></span><span>Captured <b>${escapeHtml(displayTime(model.capturedAt))}</b></span></div><section class="cardViewerSection"><div class="cardViewerSectionTitle"><div><span>Readable data</span><h3>Human-friendly summary</h3></div><small>Values exposed by the stored read</small></div>${fields}</section>${emvCoverage}<div class="cardViewerColumns"><section class="cardViewerSection"><div class="cardViewerSectionTitle"><div><span>Authentication</span><h3>Keys</h3></div><small>Shown only after success</small></div>${keys}</section><section class="cardViewerSection"><div class="cardViewerSectionTitle"><div><span>Authentication information</span><h3>Readable access</h3></div><small>No inferred permissions</small></div>${access}</section></div>${known}<section class="cardViewerSection cardViewerDeepScan"><div class="cardViewerSectionTitle"><div><span>Read workflow</span><h3>Deep Scan</h3></div><small>Runs only after confirmation</small></div><p>Detects the live card family, then runs the matching PM3 read sequence. Output is mirrored to Device Console.</p><button id="deepScanBtn" type="button" ${workflowRunning()||!identityReady?"disabled":""}>${state.deepScanRunning?"Deep Scan running…":"Run Deep Scan"}</button>${deepStatus}</section>${recovery}<div class="cardViewerNotice"><b>Current workflow status</b>${workflowNotice}</div></div></section>`;
    }
    installViewerResize(host);
    installViewerDrag(host);
    host.querySelector("[data-card-viewer-maximize]")?.addEventListener("click",toggleViewerMaximized);
    host.querySelectorAll("[data-card-viewer-close]").forEach(button=>button.addEventListener("click",close));
    host.querySelector("#deepScanBtn")?.addEventListener("click",deepScan);
    host.querySelector("#advancedRecoveryToggle")?.addEventListener("click",()=>{state.recoveryOpen=!state.recoveryOpen;render();});
    host.querySelectorAll("[data-recovery-strategy]").forEach(button=>button.addEventListener("click",()=>advancedRecovery(button.dataset.recoveryStrategy)));
    host.querySelector("#cancelRecoveryBtn")?.addEventListener("click",cancelAdvancedRecovery);
    bindWorkflowProgressActions(host);
    installViewerScrollTracking(host);
    restoreViewerScroll(host,scrollSnapshot);
  }
  function open(){ state.open=true; recoverLatestDeepScan(); render(); }
  function init(){
    const button=document.getElementById("atlasCardViewerBtn");
    if(button) button.onclick=open;
    if(!state.databaseListenerReady){
      state.databaseListenerReady=true;
      document.addEventListener("electron-database-changed",()=>{if(state.open && !workflowRunning()) render();});
    }
    if(!state.keyboardReady){
      state.keyboardReady=true;
      document.addEventListener("keydown",event=>{
        if(event.key!=="Escape" || !state.open || workflowRunning()) return;
        event.preventDefault();
        if(state.viewerMaximized) toggleViewerMaximized();
        else close();
      });
    }
    if(!state.viewportListenerReady){
      state.viewportListenerReady=true;
      window.addEventListener?.("resize",()=>{
        if(!state.open) return;
        const overlay=document.getElementById("cardViewerOverlayHost")?.querySelector?.(".cardViewerOverlay");
        applyViewerBounds(overlay);
      });
    }
  }

  window.CardViewerManager={init,open,close,state,getCurrentCardData,hasReportedUid,deepScan,advancedRecovery,advancedWorkflow:advancedRecovery,cancelAdvancedRecovery,cancelAdvancedWorkflow:cancelAdvancedRecovery,recoveryPlan,advancedWorkflowPlan,hasConfirmedRecoveryKey,runPrivateWorkflowCommand,deepScanCommands:[...DEEP_SCAN_COMMANDS],detectDeepScanProfile,classicSizeFlag,parseDeepScanKeys,parseDumpBlocks,buildDeepScanRecord,persistDeepScanRecord,persistAdvancedWorkflow,parseCompletedDeepScanConsole,recoverLatestDeepScan,uidFromOutput,clampViewerBounds,toggleViewerMaximized,resetViewerGeometry,captureViewerScroll,restoreViewerScroll,installViewerScrollTracking,workflowProgressPanel:renderWorkflowProgressPanel,render};
  if(document.readyState==="loading") document.addEventListener("DOMContentLoaded",init);
  else init();
})();
