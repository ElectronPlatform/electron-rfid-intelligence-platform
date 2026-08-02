/*
 * Electron Workflow Progress Panel
 *
 * Shared renderer-side presentation state for meaningful multi-step
 * operations. Callers provide observed workflow events; this component does
 * not invent steps, percentages, remaining time or cancellation support.
 */
(function(root,factory){
  const api=factory();
  if(typeof module!=="undefined" && module.exports) module.exports=api;
  if(root) root.WorkflowProgressPanel=api;
})(typeof window!=="undefined" ? window : globalThis,function(){
  const VERSION="1.0.0";
  const OUTCOMES=new Set(["running","completed","warning","cancelled","failed"]);

  function text(value){ return String(value ?? ""); }
  function escapeHtml(value){
    return text(value).replace(/[&<>"']/g,character=>({
      "&":"&amp;",
      "<":"&lt;",
      ">":"&gt;",
      "\"":"&quot;",
      "'":"&#39;"
    }[character]));
  }
  function normaliseOutcome(value){
    const outcome=text(value).trim().toLowerCase();
    return OUTCOMES.has(outcome) ? outcome : "running";
  }
  function create(options={}){
    const title=text(options.title).trim() || "Workflow";
    return {
      schemaVersion:VERSION,
      id:text(options.id).trim() || "workflow",
      title,
      status:text(options.status).trim() || `Starting ${title}...`,
      sourceLabel:text(options.sourceLabel).trim() || "Electron-observed",
      cancellable:options.cancellable===true,
      currentCommand:"",
      outcome:"running",
      unitSingular:text(options.unitSingular).trim() || "workflow step",
      unitPlural:text(options.unitPlural).trim() || "workflow steps",
      steps:[],
      startedAt:options.startedAt || new Date().toISOString()
    };
  }
  function setStatus(progress,status,currentCommand=""){
    if(!progress) return progress;
    const nextStatus=text(status).trim();
    if(nextStatus) progress.status=nextStatus;
    progress.currentCommand=text(currentCommand).trim();
    return progress;
  }
  function startStep(progress,step={}){
    if(!progress) return null;
    const command=text(step.command).trim();
    const label=text(step.label).trim() || command || "Workflow step";
    const item={label,command,status:"running"};
    progress.steps.push(item);
    progress.status=label;
    progress.currentCommand=command;
    progress.outcome="running";
    return item;
  }
  function finishStep(progress,command,result={}){
    if(!progress) return null;
    const targetCommand=text(command).trim();
    const item=[...progress.steps].reverse().find(step=>step.status==="running" && step.command===targetCommand);
    if(!item) return null;
    item.status=result?.status==="cancelled" ? "cancelled" : result?.ok ? "completed" : "failed";
    progress.status=item.status==="cancelled"
      ? `Cancelled: ${item.label}`
      : item.status==="completed"
        ? `Finished: ${item.label}`
        : `Command did not complete successfully: ${item.label}`;
    progress.currentCommand="";
    return item;
  }
  function finish(progress,{outcome="completed",status=""}={}){
    if(!progress) return progress;
    progress.outcome=normaliseOutcome(outcome);
    if(progress.outcome==="running") progress.outcome="completed";
    if(text(status).trim()) progress.status=text(status).trim();
    progress.currentCommand="";
    progress.finishedAt=new Date().toISOString();
    return progress;
  }
  function finishedCount(progress){
    return Array.isArray(progress?.steps) ? progress.steps.filter(step=>step.status!=="running").length : 0;
  }
  function render(progress,options={}){
    if(!progress || options.visible===false) return "";
    const outcome=normaliseOutcome(progress.outcome);
    const sourceLabel=text(progress.sourceLabel).trim() || "Electron-observed";
    const unitSingular=text(progress.unitSingular).trim() || "workflow step";
    const unitPlural=text(progress.unitPlural).trim() || "workflow steps";
    const finished=finishedCount(progress);
    const maxVisibleSteps=Math.max(1,Number(options.maxVisibleSteps || 4));
    const recent=(Array.isArray(progress.steps)?progress.steps:[]).slice(-maxVisibleSteps).map(step=>{
      const marker=step.status==="completed" ? "✓" : step.status==="failed" ? "!" : step.status==="cancelled" ? "×" : "•";
      return `<li class="${escapeHtml(step.status)}"><span aria-hidden="true">${marker}</span><div><b>${escapeHtml(step.label)}</b>${step.command?`<code>${escapeHtml(step.command)}</code>`:""}</div></li>`;
    }).join("");
    const technical=progress.currentCommand ? `<code class="electronWorkflowCurrentCommand">${escapeHtml(progress.currentCommand)}</code>` : "";
    const cancel=progress.cancellable && options.cancelAvailable!==false && outcome==="running"
      ? `<button type="button" class="electronWorkflowCancel" data-electron-workflow-cancel ${options.cancelling?"disabled":""}>${options.cancelling?"Cancelling…":"Cancel workflow"}</button>`
      : "";
    const running=outcome==="running";
    const stateIcon=running ? `<span class="electronWorkflowSpinner" aria-hidden="true"></span>` : `<span class="electronWorkflowOutcomeIcon ${escapeHtml(outcome)}" aria-hidden="true">${outcome==="completed"?"✓":outcome==="warning"?"!":outcome==="cancelled"?"×":"!"}</span>`;
    const unit=finished===1 ? unitSingular : unitPlural;
    return `<aside class="electronWorkflowProgress ${escapeHtml(outcome)}" data-electron-workflow-progress="${escapeHtml(progress.id)}" aria-label="${escapeHtml(progress.title)} progress">
      <div class="electronWorkflowProgressHeader">${stateIcon}<div><small>Live workflow · ${escapeHtml(sourceLabel)}</small><strong>${escapeHtml(progress.title)}</strong></div></div>
      <p aria-live="polite" aria-atomic="true">${escapeHtml(progress.status)}</p>
      ${technical}
      ${running?`<div class="electronWorkflowIndeterminate" aria-hidden="true"><span></span></div>`:""}
      <div class="electronWorkflowMeta"><span>${finished} ${escapeHtml(unit)} finished</span><span>No estimated percentage</span></div>
      ${recent?`<ol>${recent}</ol>`:""}
      ${cancel}
    </aside>`;
  }
  function bind(host,onCancel){
    const button=host?.querySelector?.("[data-electron-workflow-cancel]");
    if(button && typeof onCancel==="function") button.addEventListener("click",onCancel);
    return !!button;
  }
  function replace(host,progress,options={}){
    const existing=host?.querySelector?.("[data-electron-workflow-progress]");
    if(!existing) return false;
    existing.outerHTML=render(progress,options);
    bind(host,options.onCancel);
    return true;
  }

  return {VERSION,create,setStatus,startStep,finishStep,finish,finishedCount,render,bind,replace};
});
