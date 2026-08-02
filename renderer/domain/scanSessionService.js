/*
 * Electron Domain Architecture - Scan Session Service
 *
 * Phase 1 proof of concept. Scan sessions live only in renderer memory and
 * never persist themselves. Durable output must pass through ObservationService.
 */
(function(){
  const sessions=new Map();
  let activeSessionId="";
  let sequence=0;

  function text(value){ return String(value ?? ""); }
  function now(){ return new Date().toISOString(); }
  function id(prefix){
    sequence+=1;
    const uuid=globalThis.crypto?.randomUUID?.();
    return uuid ? `${prefix}_${uuid}` : `${prefix}_${Date.now()}_${sequence}`;
  }
  function clone(value){
    if(!value) return null;
    return JSON.parse(JSON.stringify(value));
  }
  function snapshot(session){
    if(!session) return null;
    return clone({
      schemaVersion:session.schemaVersion,
      id:session.id,
      entityType:session.entityType,
      persistence:session.persistence,
      state:session.state,
      workflow:session.workflow,
      source:session.source,
      startedAt:session.startedAt,
      completedAt:session.completedAt,
      failedAt:session.failedAt,
      destroyedAt:session.destroyedAt,
      resultSummary:session.resultSummary,
      failure:session.failure
    });
  }
  function getInternal(sessionId){
    return sessions.get(text(sessionId)) || null;
  }
  function create(options={}){
    if(activeSessionId && sessions.has(activeSessionId)){
      destroy(activeSessionId,{reason:"superseded-by-new-scan"});
    }
    const session={
      schemaVersion:"1.0.0",
      id:id("scan_session"),
      entityType:"scan-session",
      persistence:"temporary",
      state:"created",
      workflow:text(options.workflow || "Scan / Intelligence"),
      source:text(options.source || "live-scan"),
      startedAt:text(options.startedAt || now()),
      completedAt:"",
      failedAt:"",
      destroyedAt:"",
      resultSummary:null,
      failure:null
    };
    sessions.set(session.id,session);
    activeSessionId=session.id;
    return snapshot(session);
  }
  function start(sessionId){
    const session=getInternal(sessionId);
    if(!session || ["destroyed","completed","failed","cancelled"].includes(session.state)) return null;
    session.state="acquiring";
    return snapshot(session);
  }
  function complete(sessionId,result={},metadata={}){
    const session=getInternal(sessionId);
    if(!session || session.state==="destroyed") return null;
    session.state="completed";
    session.completedAt=text(metadata.completedAt || now());
    session.resultSummary={
      status:text(result?.status || "unknown"),
      moduleId:text(result?.module?.id || ""),
      displayName:text(result?.module?.displayName || result?.displayName || "Unknown card"),
      confidence:Number(result?.confidence || 0),
      confidenceLevel:text(result?.confidenceLevel || ""),
      uid:text(result?.parsed?.uid || result?.uid || "")
    };
    return snapshot(session);
  }
  function fail(sessionId,error){
    const session=getInternal(sessionId);
    if(!session || session.state==="destroyed") return null;
    session.state="failed";
    session.failedAt=now();
    session.failure={message:text(error?.message || error || "Scan failed").slice(0,240)};
    return snapshot(session);
  }
  function cancel(sessionId,reason="cancelled"){
    const session=getInternal(sessionId);
    if(!session || session.state==="destroyed") return null;
    session.state="cancelled";
    session.completedAt=now();
    session.failure={message:text(reason).slice(0,240)};
    return snapshot(session);
  }
  function destroy(sessionId,options={}){
    const session=getInternal(sessionId);
    if(!session) return null;
    session.state="destroyed";
    session.destroyedAt=now();
    if(options.reason) session.failure={message:text(options.reason).slice(0,240)};
    const result=snapshot(session);
    sessions.delete(session.id);
    if(activeSessionId===session.id) activeSessionId="";
    return result;
  }
  function get(sessionId){ return snapshot(getInternal(sessionId)); }
  function current(){ return get(activeSessionId); }
  function list(){ return [...sessions.values()].map(snapshot); }

  window.ScanSessionService={
    version:"1.0.0",
    create,
    start,
    complete,
    fail,
    cancel,
    destroy,
    get,
    current,
    list
  };
})();
