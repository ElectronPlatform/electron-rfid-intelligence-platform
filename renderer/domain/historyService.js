/*
 * Electron Domain Architecture - History Service
 *
 * Phase 1 proof of concept. This service is the only new-domain entry point
 * used to create an Observation acceptance event.
 */
(function(){
  let sequence=0;

  function text(value){ return String(value ?? ""); }
  function now(){ return new Date().toISOString(); }
  function id(prefix){
    sequence+=1;
    const uuid=globalThis.crypto?.randomUUID?.();
    return uuid ? `${prefix}_${uuid}` : `${prefix}_${Date.now()}_${sequence}`;
  }
  function recordObservationAccepted(input={}){
    const observation=input.observation || {};
    if(!observation.id) throw new Error("HistoryService requires an accepted Observation.");
    const event={
      schemaVersion:"1.0.0",
      id:id("history_event"),
      entityType:"history-event",
      eventType:"observation.accepted",
      subjectType:"observation",
      subjectId:text(observation.id),
      collectionRecordId:text(observation.collectionRecordId || ""),
      occurredAt:text(input.occurredAt || now()),
      actor:text(input.actor || "Electron compatibility workflow"),
      sourceService:"ObservationService",
      details:{
        proposalId:text(input.proposalId || observation.provenance?.proposalId || ""),
        scanSessionId:text(observation.provenance?.scanSessionId || ""),
        acceptanceMode:text(input.acceptanceMode || observation.provenance?.acceptanceMode || "explicit"),
        legacySignatureId:text(observation.legacySignatureId || "")
      }
    };
    const saved=window.ElectronDatabase?.saveDomainHistoryEvent?.(event);
    if(!saved) throw new Error("Domain History persistence adapter is unavailable.");
    return saved;
  }
  function all(){
    return window.ElectronDatabase?.getDomainHistoryEvents?.() || [];
  }

  window.HistoryService={
    version:"1.0.0",
    recordObservationAccepted,
    all
  };
})();
