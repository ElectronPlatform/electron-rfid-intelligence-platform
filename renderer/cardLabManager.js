/*
 * Electron - Card Lab Manager v0.4
 * Beginner-first guided workspace powered by PM3 one-shot scans and Knowledge Engine.
 */
(function(){
  const state={
    lastAnalysis:null,
    lastSource:"",
    lastPm3Output:"",
    busy:false,
    currentStep:1,
    scanLog:[],
    exploreReport:null,
    analysisOrigin:null,
    reportModel:null,
    activeScanSessionId:"",
    proposedObservation:null,
    lastDurableObservation:null,
    lastDomainHistoryEvent:null,
    domainArchitectureError:"",
    workflowProgress:null
  };
  const workflowProgressPanel=window.WorkflowProgressPanel;
  let workflowDismissTimer=null;

  function $(id){ return document.getElementById(id); }
  function text(v){ return String(v ?? ""); }
  function html(v){ return text(v).replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c])); }

  function renderWorkflowProgress(){
    const host=$("cardLabWorkflowProgressHost");
    if(!host) return;
    host.innerHTML=workflowProgressPanel?.render?.(state.workflowProgress,{
      visible:!!state.workflowProgress,
      maxVisibleSteps:4,
      cancelAvailable:false
    }) || "";
  }

  function beginWorkflowProgress({id,title,status}){
    if(workflowDismissTimer) clearTimeout(workflowDismissTimer);
    workflowDismissTimer=null;
    state.workflowProgress=workflowProgressPanel?.create?.({
      id,
      title,
      status,
      sourceLabel:"Electron-observed",
      unitSingular:"workflow step",
      unitPlural:"workflow steps"
    }) || null;
    renderWorkflowProgress();
  }

  function setWorkflowProgressStatus(status,currentCommand){
    if(!state.workflowProgress) return;
    const command=currentCommand===undefined ? state.workflowProgress.currentCommand : currentCommand;
    workflowProgressPanel?.setStatus?.(state.workflowProgress,status,command || "");
    renderWorkflowProgress();
  }

  function startWorkflowProgressStep(label,command=""){
    if(!state.workflowProgress) return;
    workflowProgressPanel?.startStep?.(state.workflowProgress,{label,command});
    renderWorkflowProgress();
  }

  function finishWorkflowProgressStep(command,result){
    if(!state.workflowProgress) return;
    workflowProgressPanel?.finishStep?.(state.workflowProgress,command,result);
    renderWorkflowProgress();
  }

  function completeWorkflowProgress(outcome,status){
    if(!state.workflowProgress) return;
    const completedProgress=state.workflowProgress;
    workflowProgressPanel?.finish?.(completedProgress,{outcome,status});
    renderWorkflowProgress();
    if(workflowDismissTimer) clearTimeout(workflowDismissTimer);
    workflowDismissTimer=setTimeout(()=>{
      if(state.workflowProgress!==completedProgress) return;
      state.workflowProgress=null;
      workflowDismissTimer=null;
      renderWorkflowProgress();
    },1400);
  }

  function clearWorkflowProgress(){
    if(workflowDismissTimer) clearTimeout(workflowDismissTimer);
    workflowDismissTimer=null;
    state.workflowProgress=null;
    renderWorkflowProgress();
  }

  function beginScanSession(source,workflow){
    if(!window.ScanSessionService?.create) return null;
    if(state.proposedObservation?.id) window.ObservationService?.clear?.(state.proposedObservation.id);
    const session=window.ScanSessionService.create({source,workflow});
    window.ScanSessionService.start(session.id);
    state.activeScanSessionId=session.id;
    state.proposedObservation=null;
    state.lastDurableObservation=null;
    state.lastDomainHistoryEvent=null;
    state.domainArchitectureError="";
    return window.ScanSessionService.get(session.id);
  }

  function failActiveScanSession(error){
    if(!state.activeScanSessionId || !window.ScanSessionService?.fail) return null;
    return window.ScanSessionService.fail(state.activeScanSessionId,error);
  }

  function acceptLiveObservation(result,source,options={}){
    const legacy=()=>{
      if(window.ElectronResearchManager?.rememberRealScan){
        return window.ElectronResearchManager.rememberRealScan(result,source);
      }
      return null;
    };
    if(result?.status!=="identified") return legacy();
    if(!window.ScanSessionService || !window.ObservationService || !window.HistoryService) return legacy();

    try{
      let sessionId=text(options.scanSessionId || state.activeScanSessionId);
      if(!sessionId || !window.ScanSessionService.get(sessionId)){
        const session=beginScanSession(source,options.workflow || "Scan / Intelligence");
        sessionId=session?.id || "";
      }
      window.ScanSessionService.complete(sessionId,result,{completedAt:state.analysisOrigin?.createdAt || new Date().toISOString()});
      const proposed=window.ObservationService.propose({
        scanSessionId:sessionId,
        source,
        observedAt:state.analysisOrigin?.createdAt || new Date().toISOString(),
        result
      });
      state.proposedObservation=proposed;
      const accepted=window.ObservationService.accept(proposed.id,{
        acceptanceMode:"legacy-compatible-auto-accept",
        acceptedBy:"Scan / Intelligence compatibility layer"
      });
      state.lastDurableObservation=accepted.observation;
      state.lastDomainHistoryEvent=accepted.historyEvent;
      state.domainArchitectureError="";
      return accepted.legacySignature || accepted.observation;
    }catch(error){
      state.domainArchitectureError=text(error?.message || error);
      console.error("Scan domain architecture compatibility path failed",error);
      return legacy();
    }
  }

  async function ensureReady(){
    if(window.KnowledgeEngine) await window.KnowledgeEngine.init();
  }

  function currentConsoleText(){
    if(window.electronGetPm3Terminal) return window.electronGetPm3Terminal() || "";
    return $("console")?.textContent || "";
  }

  function consoleTextSince(startLength){
    const now=currentConsoleText();
    const start=Number(startLength || 0);
    if(!now || now.length <= start) return "";
    return now.slice(start);
  }

  function wait(ms){
    return new Promise(resolve=>setTimeout(resolve, ms));
  }

  async function waitForConsoleOutput(startLength, options={}){
    const timeoutMs=Number(options.timeoutMs || 18000);
    const idleMs=Number(options.idleMs || 1200);
    const started=Date.now();
    let lastLength=currentConsoleText().length;
    let lastChange=Date.now();
    while(Date.now()-started < timeoutMs){
      await wait(250);
      const currentLength=currentConsoleText().length;
      if(currentLength>lastLength){
        lastLength=currentLength;
        lastChange=Date.now();
      }
      if(currentLength>Number(startLength || 0) && Date.now()-lastChange>=idleMs){
        return consoleTextSince(startLength);
      }
    }
    return consoleTextSince(startLength);
  }

  function setStep(step){
    state.currentStep=step;
    document.querySelectorAll(".atlasWizardStep").forEach(el=>{
      const n=Number(el.dataset.step || 0);
      const reportReady=n===4 && state.reportModel?.status==="ready";
      el.classList.toggle("active", n===step);
      el.classList.toggle("done", n<step || reportReady);
      el.classList.toggle("reportReady", reportReady);
    });
  }

  function reportSourceLabel(){
    if(state.lastSource==="explore-card") return "Explore Card";
    if(state.lastSource==="atlas-scan-hf-lf") return "Quick Scan";
    if(state.lastSource==="pasted-output") return "Pasted PM3 output";
    if(state.lastSource==="console-output") return "Console output";
    return state.lastSource || "Current card";
  }

  function reportModelContext(){
    return {
      result:state.lastAnalysis,
      report:state.exploreReport,
      source:state.lastSource,
      sourceLabel:reportSourceLabel(),
      pm3Output:state.lastPm3Output || currentConsoleText(),
      scanLog:state.scanLog,
      analysisOrigin:state.analysisOrigin
    };
  }

  function buildReportModel(reason="refresh"){
    const result=state.lastAnalysis;
    if(!result || result.status!=="identified" || !window.CardReportBuilder?.build) return null;
    const db=window.ElectronDatabase;
    const signature=window.ElectronResearchManager?.currentSignature
      ? window.ElectronResearchManager.currentSignature(result)
      : db?.normaliseSignature?.(db?.signatureFromAnalysis?.(result) || {}) || {};
    const intelligence=db?.getCardIntelligence ? db.getCardIntelligence(signature, result) : {};
    const context=reportModelContext();
    const profile=window.CardProfileEngine?.profileFromResult ? window.CardProfileEngine.profileFromResult(result || {}) : {};
    const exportReport=window.CardReportBuilder.build({result, intelligence, context});
    const updatedAt=new Date().toISOString();
    const model={
      id:`report_${String(signature.signatureId || signature.id || "unknown").replace(/[^a-z0-9._-]+/gi,"-")}`,
      modelVersion:"Report Model v1",
      status:"ready",
      reason,
      createdAt:state.reportModel?.createdAt || updatedAt,
      updatedAt,
      scanAt:context.analysisOrigin?.createdAt || state.scanLog?.[0]?.started || updatedAt,
      source:context.source,
      sourceLabel:context.sourceLabel,
      scan:{
        dateTime:context.analysisOrigin?.createdAt || state.scanLog?.[0]?.started || updatedAt,
        source:context.source,
        sourceLabel:context.sourceLabel,
        origin:context.analysisOrigin || {},
        commands:state.scanLog || []
      },
      cardSignature:signature,
      quickScanResult:context.source==="atlas-scan-hf-lf" ? result : null,
      exploreCardResult:state.exploreReport || null,
      cardIntelligence:intelligence,
      cardProfile:profile,
      signature,
      result,
      context,
      intelligence,
      profile,
      knowledgeScore:profile.scores || {},
      detectionConfidence:profile.scores?.detectionConfidence ?? result.confidence ?? intelligence?.summary?.confidence ?? null,
      electronConfidence:profile.scores?.electronConfidence || result.confidenceLevel || intelligence?.summary?.confidenceLevel || "",
      knownByYou:intelligence?.knownByYou || null,
      researchMatches:intelligence?.researchMatches || [],
      readableData:intelligence?.readableData || null,
      protectedData:intelligence?.protectedData || null,
      compatibleDevices:intelligence?.supportedDevices || [],
      safePm3Commands:profile.safeCommands || [],
      recommendedActions:[...(profile.recommendedNextSteps || []), ...(intelligence?.recommendedActions || [])],
      technicalDetails:{
        module:result?.module || {},
        parsed:result?.parsed || {},
        alternatives:result?.alternatives || []
      },
      rawPm3Output:context.pm3Output || result?.parsed?.raw || "",
      export:exportReport
    };
    state.reportModel=model;
    setStep(4);
    renderReportReadyCard();
    writeRawDetails(result, {exploreReport:state.exploreReport, reportModel:{id:model.id,status:model.status,updatedAt:model.updatedAt,source:model.sourceLabel}});
    return model;
  }

  function clearReportModel(){
    state.reportModel=null;
    setStep(state.currentStep || 1);
  }

  function reportSafeCommands(model){
    const base=["hf search", "hf 14a info", "hf mf info", "lf search"];
    const extra=(model?.safePm3Commands || []).map(item=>typeof item==="string" ? item : item?.command).filter(Boolean);
    return [...new Set([...base, ...extra].map(item=>text(item).trim()).filter(Boolean))];
  }

  function renderSafeCommandCard(model){
    const commands=reportSafeCommands(model);
    const moduleId=model?.result?.module?.id || "";
    return `<div class="atlasCard atlasWideCard electronReportSafeCommandsCard">
      <b>Safe Commands</b>
      <p>Read-only PM3 commands you can inspect before running.</p>
      <div class="electronKnowledgeChipRow">
        ${commands.map(command=>`<button type="button" class="electronKnowledgeChip" data-safe-command="${html(command)}" data-module-id="${html(moduleId)}">${html(command)}</button>`).join("")}
      </div>
    </div>`;
  }

  function renderReportReadyCard(){
    const output=$("atlasIntelligenceOutput");
    const model=state.reportModel;
    if(!output || !model?.status) return;
    const old=output.querySelector(".electronReportReadyCard");
    if(old) old.remove();
    const oldCommands=output.querySelector(".electronReportSafeCommandsCard");
    if(oldCommands) oldCommands.remove();
    output.insertAdjacentHTML("afterbegin", `
      <div class="electronReportReadyCard">
        <div>
          <div class="atlasKicker">Report ready</div>
          <h3>Report ready</h3>
          <div class="electronReportReadyGrid">
            <span>Current card</span><b>${html(model.signature?.displayName || model.result?.module?.displayName || "Unknown card")}</b>
            <span>Signature</span><b>${html(model.signature?.signatureId || "Unknown")}</b>
            <span>Source</span><b>${html(model.sourceLabel || model.source || "Current card")}</b>
            <span>Status</span><b>Ready for export</b>
          </div>
        </div>
        <div class="electronReportReadyActions">
          ${state.analysisOrigin?.liveDetected ? `<button type="button" data-card-lab-save-inventory>Save to Inventory</button>` : ""}
          <button type="button" class="green" data-electron-action="export-report">Export Report</button>
        </div>
      </div>
      ${renderSafeCommandCard(model)}`);
    const saveButton=output.querySelector("[data-card-lab-save-inventory]");
    if(saveButton) saveButton.onclick=async()=>{
      const prepared=await window.electronPrepareScanForInventory?.(state.lastPm3Output || model.rawPm3Output || "");
      if(!prepared) renderStatus("error","Nothing to save","Electron could not find scan output to prepare as an RFID Tag.",4);
    };
  }

  function setBusy(isBusy, label){
    state.busy=!!isBusy;
    ["atlasStartScanBtn","atlasExploreCardBtn","atlasAnalysePasteBtn","atlasLoadLatestBtn","atlasClearBtn"].forEach(id=>{
      const el=$(id);
      if(el) el.disabled=!!isBusy;
    });
    const btn=$("atlasStartScanBtn");
    if(btn) btn.textContent=isBusy ? (label || "Working...") : "Quick Scan";
    const exploreBtn=$("atlasExploreCardBtn");
    if(exploreBtn) exploreBtn.textContent=isBusy ? "Investigating..." : "Explore Card";
  }

  function renderStatus(kind, title, body, step=state.currentStep){
    const box=$("atlasStatusPanel");
    if(!box) return;
    const cls=kind==="error" ? "atlasHeroUnknown" : kind==="success" ? "atlasHeroDetected" : "atlasHeroEmpty";
    const score=kind==="success" ? "✓" : kind==="error" ? "!" : step;
    box.innerHTML=`
      <div class="atlasHero ${cls}">
        <div>
          <div class="atlasKicker">Electron · Guided Card Lab</div>
          <h3>${html(title)}</h3>
          <p>${body}</p>
        </div>
        <div class="atlasScore ${kind==="info" ? "atlasScoreNeutral" : ""}"><span>${html(score)}</span><small>${kind==="error" ? "check" : "step"}</small></div>
      </div>`;
  }

  function renderWelcome(){
    state.lastAnalysis=null;
    state.lastSource="";
    state.exploreReport=null;
    state.analysisOrigin=null;
    state.reportModel=null;
    setStep(1);
    renderStatus(
      "info",
      "Scan your first card",
      "Place one RFID card/tag on the Proxmark3. Use <b>Quick Scan</b> for identification, or <b>Explore Card</b> for a deeper safe investigation.",
      1
    );
    const output=$("atlasIntelligenceOutput");
    if(output){
      output.dataset.ready="true";
      output.innerHTML=`
        <div class="atlasGrid">
          <div class="atlasCard"><b>1. Put down one card</b><p>Place only one card or tag on the Proxmark3 antenna area.</p></div>
          <div class="atlasCard"><b>2. Choose scan depth</b><p><b>Quick Scan</b> identifies the card. <b>Explore Card</b> collects extra safe details and builds a report.</p></div>
          <div class="atlasCard"><b>3. Read the result</b><p>Card Intelligence explains technology, memory, security and recommended next actions.</p></div>
          <div class="atlasCard"><b>4. Read the report</b><p>Electron explains capabilities, safe next actions and what it still does not know.</p></div>
        </div>`;
    }
    const raw=$("atlasRawDetails");
    if(raw) raw.textContent="No analysis yet.";
    closeRawJson();
  }

  function closeRawJson(){
    const raw=document.querySelector(".atlasRawJson");
    if(raw) raw.open=false;
  }

  function openOtherInput(){
    const d=$("atlasOtherInputDetails");
    if(d) d.open=true;
  }

  function renderModuleList(){
    const box=$("atlasModuleList");
    if(!box || !window.KnowledgeEngine) return;
    const modules=window.KnowledgeEngine.availableModules();
    const summary=$("atlasKnowledgeSummary");
    if(summary) summary.textContent=`${modules.length} knowledge records loaded`;
    box.innerHTML = modules.map(m=>`
      <div class="atlasModuleRow" data-module="${html(m.id)}">
        <div class="atlasModuleHeader"><b>${html(m.displayName)}</b><span>${html(m.technology||"")}</span></div>
        <small>${html(m.uiHints?.primaryTool||"")}</small>
      </div>`).join("") || `<p class="small">No knowledge modules loaded.</p>`;
  }

  function writeRawDetails(result, extra={}){
    const details=$("atlasRawDetails");
    if(!details || !window.KnowledgeEngine) return;
    details.textContent = JSON.stringify({
      status: result?.status,
      confidence: result?.confidence,
      source: state.lastSource,
      parsed: result?.parsed,
      module: result?.module ? result.module.id : null,
      alternatives: result?.alternatives,
      recommendations: result ? window.KnowledgeEngine.recommendationCards(result) : [],
      scanLog: state.scanLog,
      domainArchitecture:{
        scanSession:state.activeScanSessionId ? window.ScanSessionService?.get?.(state.activeScanSessionId) || null : null,
        proposedObservation:state.proposedObservation,
        durableObservation:state.lastDurableObservation,
        historyEvent:state.lastDomainHistoryEvent,
        compatibilityError:state.domainArchitectureError || ""
      },
      ...extra
    }, null, 2);
  }

  function appendConsoleFromCardLab(title, output, options={}){
    const consoleEl=$("console");
    const t=`\n[Electron] ${title}\n${output || ""}\n`;
    state.lastPm3Output += t;
    if(options.mirror===false) return;
    if(window.electronAppendPm3Terminal){
      window.electronAppendPm3Terminal(t, {forceScroll:true});
      return;
    }
    if(consoleEl){
      consoleEl.textContent += t;
      consoleEl.scrollTop = consoleEl.scrollHeight;
    }
  }

  function bindActionCards(){
    document.querySelectorAll("[data-atlas-action]").forEach(card=>{
      card.tabIndex=0;
      card.setAttribute("role", "button");
      card.title=card.title || "Open detail";
    });
  }

  function sourceNotice(origin){
    const o=origin || {};
    if(o.liveDetected){
      return `<div class="electronSourceNotice live"><b>Live tag detected</b><p>${html(o.label || "Card Intelligence is based on the current PM3 scan.")}</p></div>`;
    }
    if(o.mode==="pasted-output" || o.mode==="console-output"){
      return `<div class="electronSourceNotice stored"><b>Using previous analysis / stored intelligence</b><p>${html(o.label || "This result is based on pasted or previously captured PM3 output, not a new live tag detection.")}</p></div>`;
    }
    return "";
  }

  function renderNoLiveTagDetected(detail, previousAnalysis=null){
    state.lastAnalysis=null;
    state.lastSource="no-live-tag";
    clearReportModel();
    state.analysisOrigin={mode:"live-scan", liveDetected:false, label:detail || "Live PM3 did not detect a supported tag."};
    setStep(2);
    renderStatus("error", "No live tag detected", `${html(detail || "Live PM3 did not detect a supported tag.")}<br><br>Card Intelligence has not been updated from this scan.`, 2);
    const output=$("atlasIntelligenceOutput");
    if(output){
      const previous=previousAnalysis ? `<details class="electronSecondaryDetails"><summary>Previous Card Intelligence</summary>${sourceNotice({mode:"console-output", liveDetected:false, label:"This is the previous analysis. It was not refreshed by the failed live scan."})}${window.KnowledgeEngine.renderIntelligenceHtml(previousAnalysis)}</details>` : "";
      output.innerHTML=`<div class="electronSourceNotice noLive"><b>No live tag detected</b><p>${html(detail || "No supported card was detected by the latest live PM3 scan.")}</p><small>Electron will not treat stored memory or previous analysis as a fresh live card read.</small></div>${previous}`;
    }
    openOtherInput();
  }

  async function analyseText(sourceText, source="manual", options={}){
    await ensureReady();
    const output=$("atlasIntelligenceOutput");
    if(!output || !window.KnowledgeEngine) return null;
    setStep(3);
    const result=window.KnowledgeEngine.identify(sourceText || "");
    state.lastAnalysis=result;
    state.lastSource=source;
    state.analysisOrigin={
      mode:source,
      liveDetected:!!options.liveDetected,
      label:options.originLabel || "",
      createdAt:new Date().toISOString()
    };
    if(options.storeScan && options.liveDetected) acceptLiveObservation(result,source,options);
    output.innerHTML=sourceNotice(state.analysisOrigin)+window.KnowledgeEngine.renderIntelligenceHtml(result);
    if(window.ElectronResearchManager?.installDirectHandlers) window.ElectronResearchManager.installDirectHandlers();
    writeRawDetails(result);
    bindActionCards();
    closeRawJson();
    if(result.status==="identified"){
      setStep(4);
      const statusTitle=options.liveDetected ? "Live analysis complete" : "Stored analysis loaded";
      const statusBody=options.liveDetected
        ? `Electron identified <b>${html(result.module?.displayName || "a card")}</b> from the current scan.`
        : `Electron identified <b>${html(result.module?.displayName || "a card")}</b> from previous or pasted output.`;
      renderStatus("success", statusTitle, `${statusBody} Review the intelligence cards below and choose the next safe action.`, 4);
      buildReportModel("analysis-complete");
    }else{
      clearReportModel();
      renderStatus("error", "Card not identified yet", "Electron could not match this output to a loaded knowledge module. Try another scan, or use the fallback input options.", 3);
      openOtherInput();
    }
    return result;
  }

  function hasUsefulOutput(t){
    return /UID:|ATQA:|SAK:|MIFARE|ISO14443|EM\s*410x|NTAG|Ultralight|NDEF|Valid\s+HID\s+Prox\s+ID\s+found|HID\s+H10301|HID\s+Prox|Indala|T55(?:77|xx)|AWID|IoProx|Hitag\s*2|PCF\s*7952|lf\s+hitag/i.test(t || "");
  }

  function noTagDetected(t){
    return /No known\/supported|No tag found|Couldn't identify|no card/i.test(t || "");
  }

  function detectLiveTagFromOutput(t){
    const raw=t || "";
    if(!raw.trim()) return {detected:false, reason:"no-output"};
    if(noTagDetected(raw) && !hasUsefulOutput(raw)) return {detected:false, reason:"no-live-tag"};
    if(window.KnowledgeEngine?.identify){
      const result=window.KnowledgeEngine.identify(raw);
      return {
        detected:result?.status==="identified" && Number(result?.confidence || 0) > 0,
        result,
        reason:result?.status || "unknown"
      };
    }
    return {detected:hasUsefulOutput(raw), result:null, reason:"fallback-pattern"};
  }

  function hasLiveTagOutput(t){
    return detectLiveTagFromOutput(t).detected;
  }

  async function runPm3Command(cmd, label){
    if(!window.pm3api?.runPm3LiveCommand){
      throw new Error("PM3 command runner is not available. Check preload.js.");
    }
    const terminalStartLength=currentConsoleText().length;
    state.scanLog.push({command:cmd, label, started:new Date().toISOString()});
    startWorkflowProgressStep(label || `Running ${cmd}`,cmd);
    renderStatus("info", label, `Running a safe read-only identify scan.<br><code>${html(cmd)}</code>`, state.currentStep);
    let result;
    try{
      result=window.DeviceGuard?.runLiveCommand
        ? await window.DeviceGuard.runLiveCommand(cmd, {workflow:label || "Card Lab command", silent:true})
        : await window.pm3api.runPm3LiveCommand(cmd);
      if(result?.blockedByDeviceGuard){
        throw new Error(result.message || "Device is not available.");
      }
      if(result?.sentToActiveSession){
        renderStatus("info", label, `Command sent to the active Device Console session. Waiting for PM3 output...<br><code>${html(cmd)}</code>`, state.currentStep);
        renderExploreProgress("Waiting for PM3 output", [label || cmd, "Device is working", "Electron will continue when output arrives"]);
        await waitForConsoleOutput(terminalStartLength, {timeoutMs:18000, idleMs:1200});
      }
      let output=(result?.stdout || "") + (result?.stderr || "");
      let outputAlreadyInTerminal=false;
      if(!output.trim()){
        const terminalOutput=consoleTextSince(terminalStartLength);
        if(terminalOutput.trim()){
          output=terminalOutput;
          outputAlreadyInTerminal=true;
        }
      }
      if(!output.trim() && result?.message){
        output=`[PM3] ${result.message}`;
      }
      state.scanLog[state.scanLog.length-1].ok=!!result?.ok;
      state.scanLog[state.scanLog.length-1].code=result?.code ?? null;
      state.scanLog[state.scanLog.length-1].message=result?.message || "";
      state.scanLog[state.scanLog.length-1].outputLength=output.length;
      appendConsoleFromCardLab(`Command: ${cmd}`, output, {mirror:!outputAlreadyInTerminal});
      finishWorkflowProgressStep(cmd,result);
      return {result, output};
    }catch(error){
      finishWorkflowProgressStep(cmd,{ok:false,status:error?.status || "failed"});
      throw error;
    }
  }


  function commandLooksUseful(output){
    return output && !/unknown command|invalid command|Usage:/i.test(output);
  }

  function shouldRunClassicInfo(text){
    return /MIFARE\s+Classic|SAK:\s*08|hf\s+mf|PRNG/i.test(text || "");
  }

  function shouldRunUltralightInfo(text){
    return /NTAG|Ultralight|NDEF|SAK:\s*00/i.test(text || "");
  }

  function shouldRunEmvInfo(text){
    return /EMV|PPSE|2PAY|payment|ATS|ISO14443-4|pre-issuing/i.test(text || "");
  }

  function renderExploreProgress(title, lines=[]){
    const detail=lines.find(Boolean);
    setWorkflowProgressStatus(detail ? `${title} — ${detail}` : title);
  }

  async function exploreCard(){
    if(state.busy) return;
    const ready=window.DeviceGuard?.ensure ? await window.DeviceGuard.ensure({workflow:"Explore Card", capabilities:["hf","lf"]}) : {ok:true};
    if(!ready?.ok) return;
    const previousAnalysis=state.lastAnalysis;
    state.lastAnalysis=null;
    state.lastSource="live-scan-pending";
    state.analysisOrigin={mode:"explore-card", liveDetected:false, label:"Explore Card is running."};
    state.scanLog=[];
    state.lastPm3Output="";
    state.exploreReport={started:new Date().toISOString(), commands:[], mode:"explore-card-v3-learn-research"};
    const scanSession=beginScanSession("explore-card","Explore Card");
    clearReportModel();
    beginWorkflowProgress({id:"card-lab-explore",title:"Explore Card",status:"Preparing card investigation..."});
    let workflowOutcome="completed";
    let workflowStatus="Explore Card complete";

    try{
      setBusy(true,"Exploring...");
      await ensureReady();
      setStep(1);
      renderStatus("info", "Explore Card started", "Place one card/tag on the Proxmark3. Electron will collect safe information and build a Card Report.", 1);
      const outputBox=$("atlasIntelligenceOutput");
      if(outputBox) outputBox.innerHTML="";
      renderExploreProgress("Preparing card investigation", ["Checking HF / NFC first", "Trying LF only if needed", "Building a readable report"]);

      setStep(2);
      const outputs=[];
      const add=async(cmd,label)=>{
        const r=await runPm3Command(cmd,label);
        state.exploreReport.commands.push({command:cmd,label,ok:!!r.result?.ok,message:r.result?.message||""});
        if(commandLooksUseful(r.output)) outputs.push(`\n[Electron ${cmd}]\n${r.output}`);
        return r.output || "";
      };

      const hf=await add("hf search", "Step 1: looking for HF / NFC cards");
      let combined=outputs.join("\n");

      if(hasLiveTagOutput(hf)){
        renderExploreProgress("HF card found", ["Collecting ISO14443-A details", "Checking card-family information", "Building capability report"]);
        const extra=[];
        try{ extra.push(await add("hf 14a info", "Step 2: reading ISO14443-A details")); }catch(e){ console.warn(e); }
        combined=outputs.join("\n");
        if(shouldRunClassicInfo(combined)){
          try{ extra.push(await add("hf mf info", "Step 3: checking MIFARE Classic information")); }catch(e){ console.warn(e); }
        }else if(shouldRunUltralightInfo(combined)){
          try{ extra.push(await add("hf mfu info", "Step 3: checking NTAG / Ultralight information")); }catch(e){ console.warn(e); }
        }else if(shouldRunEmvInfo(combined)){
          state.exploreReport.notes="EMV-like card detected. Electron keeps this workflow to safe identification and does not read payment data.";
        }
        combined=outputs.join("\n");
        renderExploreProgress("Checking LF as well", ["HF output was collected", "Running LF search for key fobs / 125 kHz tags", "Using the strongest live decode"]);
        try{ await add("lf search", "Step 4: checking LF / 125 kHz tags"); }catch(e){ console.warn(e); }
        combined=outputs.join("\n");
      }else{
        renderStatus("info", "No HF card found", "Electron did not find a supported HF/NFC card. Trying LF / 125 kHz next.", 2);
        renderExploreProgress("Trying LF / 125 kHz", ["Looking for LF tag ID", "Checking known LF families", "Building report if found"]);
        await add("lf search", "Step 2: looking for LF / 125 kHz tags");
        combined=outputs.join("\n");
      }

      if(!hasLiveTagOutput(combined)){
        workflowOutcome="warning";
        workflowStatus="Explore Card finished — no supported live HF or LF tag was detected.";
        failActiveScanSession("Explore Card did not detect a supported live HF or LF tag.");
        renderNoLiveTagDetected("Explore Card did not detect a supported live HF or LF tag.", previousAnalysis);
        return;
      }

      setStep(3);
      startWorkflowProgressStep("Building Card Intelligence and report");
      let result;
      try{
        result=await analyseText(combined,"explore-card",{liveDetected:true,storeScan:true,scanSessionId:scanSession?.id || "",workflow:"Explore Card",originLabel:"Card Intelligence is based on the current Explore Card PM3 commands."});
        finishWorkflowProgressStep("",{ok:true});
      }catch(error){
        finishWorkflowProgressStep("",{ok:false,status:"failed"});
        throw error;
      }
      state.exploreReport.finished=new Date().toISOString();
      state.exploreReport.resultStatus=result?.status || "unknown";
      state.exploreReport.confidence=result?.confidence || 0;
      if(window.KnowledgeEngine?.renderExploreReportHtml){
        $("atlasIntelligenceOutput").innerHTML = sourceNotice(state.analysisOrigin) + window.KnowledgeEngine.renderExploreReportHtml(result, state.exploreReport) + `<details class="electronSecondaryDetails"><summary>Card Intelligence details</summary>${window.KnowledgeEngine.renderIntelligenceHtml(result)}</details>`;
        bindActionCards();
        if(window.ElectronResearchManager?.installDirectHandlers) window.ElectronResearchManager.installDirectHandlers();
      }
      setStep(4);
      if(result?.status==="identified"){
        renderStatus("success", "Explore Card complete", `Electron investigated <b>${html(result.module?.displayName || "this card")}</b> and created a readable Card Report.`, 4);
      }else{
        workflowOutcome="warning";
        workflowStatus="Explore Card finished — more information is needed for a confident identification.";
        clearReportModel();
        renderStatus("error", "Explore Card needs more information", "Electron collected output but could not confidently identify this card yet. Create an Assistant Review Pack or use Teach Electron to add local context.", 4);
        openOtherInput();
      }
      if(result?.status==="identified") buildReportModel("explore-complete");
      writeRawDetails(result, {exploreReport:state.exploreReport});
    }catch(err){
      workflowOutcome="failed";
      workflowStatus=`Explore Card stopped — ${text(err?.message || err)}`;
      failActiveScanSession(err);
      console.error("Explore Card failed", err);
      state.lastAnalysis=null;
      state.lastSource="scan-error";
      clearReportModel();
      state.analysisOrigin={mode:"explore-card", liveDetected:false, label:"Explore Card failed before a live card was identified."};
      setStep(1);
      renderStatus("error", "Explore Card failed", `${html(err.message || err)}<br><br>Use <b>Other input options</b> if you already have PM3 output.`, 1);
      const outputBox=$("atlasIntelligenceOutput");
      if(outputBox) outputBox.innerHTML=`<div class="matchPanel warn"><b>Explore Card failed</b><br>${html(err.message || err)}</div>`;
      writeRawDetails(null, {error:String(err.message || err), exploreReport:state.exploreReport});
      openOtherInput();
    }finally{
      completeWorkflowProgress(workflowOutcome,workflowStatus);
      setBusy(false);
    }
  }

  async function startScanCard(){
    if(state.busy) return;
    const ready=window.DeviceGuard?.ensure ? await window.DeviceGuard.ensure({workflow:"Quick Scan", capabilities:["hf","lf"]}) : {ok:true};
    if(!ready?.ok) return;
    const previousAnalysis=state.lastAnalysis;
    state.lastAnalysis=null;
    state.lastSource="live-scan-pending";
    state.analysisOrigin={mode:"atlas-scan-hf-lf", liveDetected:false, label:"Quick Scan is running."};
    state.scanLog=[];
    state.lastPm3Output="";
    const scanSession=beginScanSession("atlas-scan-hf-lf","Quick Scan");
    clearReportModel();
    const outputBox=$("atlasIntelligenceOutput");
    beginWorkflowProgress({id:"card-lab-quick-scan",title:"Quick Scan",status:"Preparing safe HF and LF detection..."});
    let workflowOutcome="completed";
    let workflowStatus="Quick Scan complete";
    try{
      setBusy(true,"Scanning...");
      await ensureReady();
      setStep(1);
      renderStatus("info", "Starting scan", "Make sure only one card/tag is on the Proxmark3. Electron will try HF first, then LF if needed.", 1);
      if(outputBox) outputBox.innerHTML="";

      setStep(2);
      const hf=await runPm3Command("hf search", "Checking HF / NFC cards");
      let combined=`\n[Electron HF search]\n${hf.output}`;

      if(hasLiveTagOutput(hf.output)){
        renderStatus("info", "HF output found", "Electron found HF output and will also check LF / 125 kHz before choosing Card Intelligence.", 2);
      }else{
        renderStatus("info", "No HF card found", "Electron did not find a supported HF/NFC card. Trying LF / 125 kHz next.", 2);
      }
      const lf=await runPm3Command("lf search", "Checking LF / 125 kHz tags");
      combined += `\n[Electron LF search]\n${lf.output}`;

      if(!hasLiveTagOutput(combined)){
        workflowOutcome="warning";
        workflowStatus="Quick Scan finished — no supported live HF or LF tag was detected.";
        failActiveScanSession("Quick Scan did not detect a supported live HF or LF tag.");
        renderNoLiveTagDetected("Quick Scan did not detect a supported live HF or LF tag.", previousAnalysis);
        return;
      }

      startWorkflowProgressStep("Analysing the collected scan evidence");
      let result;
      try{
        result=await analyseText(combined,"atlas-scan-hf-lf",{liveDetected:true,storeScan:true,scanSessionId:scanSession?.id || "",workflow:"Quick Scan",originLabel:"Card Intelligence is based on the current PM3 scan."});
        finishWorkflowProgressStep("",{ok:true});
      }catch(error){
        finishWorkflowProgressStep("",{ok:false,status:"failed"});
        throw error;
      }
      if(result?.status!=="identified"){
        workflowOutcome="warning";
        workflowStatus="Quick Scan finished — more information is needed for a confident identification.";
      }
    }catch(err){
      workflowOutcome="failed";
      workflowStatus=`Quick Scan stopped — ${text(err?.message || err)}`;
      failActiveScanSession(err);
      console.error("Electron scan failed", err);
      state.lastAnalysis=null;
      state.lastSource="scan-error";
      clearReportModel();
      state.analysisOrigin={mode:"atlas-scan-hf-lf", liveDetected:false, label:"Quick Scan failed before a live card was identified."};
      setStep(1);
      renderStatus("error", "Scan failed", `${html(err.message || err)}<br><br>Use <b>Other input options</b> if you already have PM3 output.`, 1);
      if(outputBox) outputBox.innerHTML=`<div class="matchPanel warn"><b>Scan failed</b><br>${html(err.message || err)}</div>`;
      writeRawDetails(null, {error:String(err.message || err)});
      openOtherInput();
    }finally{
      completeWorkflowProgress(workflowOutcome,workflowStatus);
      setBusy(false);
    }
  }

  async function analysePasted(){
    const txt=$("atlasPasteInput")?.value || "";
    if(!txt.trim()){
      renderStatus("error", "Nothing to analyse", "Paste raw Proxmark3 output first, or use <b>Start / Scan Card</b> so Electron can collect it automatically.", 1);
      openOtherInput();
      return;
    }
    await analyseText(txt,"pasted-output",{liveDetected:false,storeScan:false,originLabel:"This result is based on pasted PM3 output, not a new live scan."});
  }

  function loadLatestConsoleOutput(){
    const input=$("atlasPasteInput");
    if(!input) return;
    input.value=currentConsoleText();
    input.focus();
    renderStatus("info", "Latest console output loaded", "Click <b>Analyse pasted PM3 output</b> to analyse this text, or clear it and scan directly from Card Lab.", 1);
    openOtherInput();
  }

  function clearCardLab(){
    const input=$("atlasPasteInput");
    if(input) input.value="";
    if(state.activeScanSessionId) window.ScanSessionService?.destroy?.(state.activeScanSessionId,{reason:"card-lab-cleared"});
    if(state.proposedObservation?.id) window.ObservationService?.clear?.(state.proposedObservation.id);
    state.lastPm3Output="";
    state.scanLog=[];
    state.exploreReport=null;
    state.reportModel=null;
    state.activeScanSessionId="";
    state.proposedObservation=null;
    state.lastDurableObservation=null;
    state.lastDomainHistoryEvent=null;
    state.domainArchitectureError="";
    clearWorkflowProgress();
    renderWelcome();
  }

  async function createAssistantReviewPack(){
    const btn=$("atlasAssistantPackBtn");
    const oldText=btn ? btn.textContent : "";
    const notify=(title, body, variant="primary")=>{
      if(window.UIEngine?.alert) return window.UIEngine.alert({title, body:`<p>${html(body)}</p>`, buttonText:"Close", variant});
      if(window.UIEngine?.toast) return window.UIEngine.toast(body, variant==="danger" ? "error" : "info");
      console.info(`${title}: ${body}`);
    };
    try{
      if(btn){ btn.disabled=true; btn.textContent="Creating pack..."; }
      const payload={
        createdFrom:"Card Lab",
        currentTab:"cardlab",
        source:state.lastSource,
        lastAnalysis:state.lastAnalysis,
        pastedOutput:$("atlasPasteInput")?.value || "",
        lastPm3Output:state.lastPm3Output || currentConsoleText(),
        scanLog:state.scanLog,
        exploreReport:state.exploreReport,
        knowledgeModules: window.KnowledgeEngine ? window.KnowledgeEngine.availableModules().map(m=>({id:m.id,displayName:m.displayName,technology:m.technology})) : [],
        researchCollectionCount: window.ElectronResearchManager ? window.ElectronResearchManager.readCollection().length : 0,
        researchCollection: window.ElectronResearchManager ? window.ElectronResearchManager.readCollection() : [],
        notes:"Nothing is sent automatically. User decides whether to upload this Review Pack."
      };
      if(!window.pm3api?.createAssistantReviewPack){
        notify("Assistant Review Pack", "Assistant Review Pack is not available in preload.js yet.");
        return;
      }
      const result=await window.pm3api.createAssistantReviewPack(payload);
      if(result?.ok){
        const where=result.zipped ? result.filePath : result.folderPath;
        notify("Assistant Review Pack created", where, "success");
      }else{
        notify("Assistant Review Pack", "Could not create Assistant Review Pack. Check the console for details.", "danger");
        console.error("Assistant pack failed", result);
      }
    }catch(err){
      console.error(err);
      notify("Assistant Review Pack failed", String(err.message || err), "danger");
    }finally{
      if(btn){ btn.disabled=false; btn.textContent=oldText || "Create Assistant Review Pack"; }
    }
  }

  async function init(){
    await ensureReady();
    renderModuleList();
    const start=$("atlasStartScanBtn"); if(start) start.onclick=startScanCard;
    const explore=$("atlasExploreCardBtn"); if(explore) explore.onclick=exploreCard;
    const paste=$("atlasAnalysePasteBtn"); if(paste) paste.onclick=analysePasted;
    const latest=$("atlasLoadLatestBtn"); if(latest) latest.onclick=loadLatestConsoleOutput;
    const clear=$("atlasClearBtn"); if(clear) clear.onclick=clearCardLab;
    const pack=$("atlasAssistantPackBtn"); if(pack) pack.onclick=createAssistantReviewPack;
    if($("atlasIntelligenceOutput") && !$("atlasIntelligenceOutput").dataset.ready) renderWelcome();
  }

  window.CardLabManager={
    init,
    startScanCard,
    exploreCard,
    analysePasted,
    analyseText,
    acceptLiveObservation,
    detectLiveTagFromOutput,
    renderModuleList,
    createAssistantReviewPack,
    clearCardLab,
    buildReportModel,
    rebuildReportModel:buildReportModel,
    getReportModel:()=>state.reportModel,
    state
  };

  if(document.readyState==="loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
