/*
 * Electron Domain Architecture - Observation Service
 *
 * Phase 1 proof of concept. Proposed Observations remain in memory. Acceptance
 * writes a bounded durable Observation, invokes the legacy scan persistence
 * path for compatibility, and records one History Event.
 */
(function(){
  const proposals=new Map();
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
  function identificationFrom(result={}){
    return {
      status:text(result?.status || "unknown"),
      moduleId:text(result?.module?.id || ""),
      displayName:text(result?.module?.displayName || result?.displayName || "Unknown card"),
      technology:text(result?.module?.technology || ""),
      protocol:text(result?.module?.protocol || ""),
      confidence:Number(result?.confidence || 0),
      confidenceLevel:text(result?.confidenceLevel || ""),
      uid:text(result?.parsed?.uid || result?.uid || "")
    };
  }
  function publicProposal(proposal){
    if(!proposal) return null;
    return clone({
      schemaVersion:proposal.schemaVersion,
      id:proposal.id,
      entityType:proposal.entityType,
      persistence:proposal.persistence,
      state:proposal.state,
      scanSessionId:proposal.scanSessionId,
      source:proposal.source,
      observedAt:proposal.observedAt,
      proposedAt:proposal.proposedAt,
      identification:proposal.identification,
      collectionRecordId:proposal.collectionRecordId,
      recordLinkStatus:proposal.recordLinkStatus,
      durableObservationId:proposal.durableObservationId,
      rejectedAt:proposal.rejectedAt,
      rejectionReason:proposal.rejectionReason
    });
  }
  function propose(input={}){
    const result=input.result || {};
    if(result.status!=="identified"){
      throw new Error("ObservationService only proposes identified scan results in Phase 1.");
    }
    const sessionId=text(input.scanSessionId);
    if(sessionId && window.ScanSessionService?.get && !window.ScanSessionService.get(sessionId)){
      throw new Error("ObservationService received an unknown Scan Session.");
    }
    const proposal={
      schemaVersion:"1.0.0",
      id:id("observation_proposal"),
      entityType:"observation",
      persistence:"temporary",
      state:"proposed",
      scanSessionId:sessionId,
      source:text(input.source || "live-scan"),
      observedAt:text(input.observedAt || now()),
      proposedAt:now(),
      identification:identificationFrom(result),
      collectionRecordId:text(input.collectionRecordId || ""),
      recordLinkStatus:input.collectionRecordId ? "provided" : "unresolved",
      durableObservationId:"",
      rejectedAt:"",
      rejectionReason:"",
      result
    };
    proposals.set(proposal.id,proposal);
    return publicProposal(proposal);
  }
  function accept(proposalId,options={}){
    const proposal=proposals.get(text(proposalId));
    if(!proposal || proposal.state!=="proposed"){
      throw new Error("ObservationService requires an active Proposed Observation.");
    }
    const db=window.ElectronDatabase;
    if(!db?.rememberScanFromAnalysis || !db?.saveDomainObservation){
      throw new Error("Observation persistence adapters are unavailable.");
    }

    const acceptanceMode=text(options.acceptanceMode || "explicit");
    const legacySignature=db.rememberScanFromAnalysis(
      proposal.result,
      proposal.source,
      {domainObservationProposalId:proposal.id}
    );
    const readableData=db.extractReadableCardData?.(proposal.result) || {fields:[],availableCount:0};
    const acceptedAt=now();
    const observation=db.saveDomainObservation({
      schemaVersion:"1.0.0",
      id:id("observation"),
      entityType:"observation",
      status:"accepted",
      collectionRecordId:text(options.collectionRecordId || proposal.collectionRecordId || ""),
      recordLinkStatus:(options.collectionRecordId || proposal.collectionRecordId) ? "confirmed" : "unresolved",
      legacySignatureId:text(legacySignature?.signatureId || ""),
      source:proposal.source,
      observedAt:proposal.observedAt,
      acceptedAt,
      identification:proposal.identification,
      readableData,
      provenance:{
        proposalId:proposal.id,
        scanSessionId:proposal.scanSessionId,
        acceptanceMode,
        acceptedBy:text(options.acceptedBy || "Electron compatibility workflow"),
        sourceService:"ObservationService"
      }
    });

    const historyEvent=window.HistoryService?.recordObservationAccepted?.({
      observation,
      proposalId:proposal.id,
      acceptanceMode,
      actor:text(options.acceptedBy || "Electron compatibility workflow"),
      occurredAt:acceptedAt
    });
    if(!historyEvent) throw new Error("HistoryService did not create an acceptance event.");

    proposal.state="accepted";
    proposal.persistence="durable-via-service";
    proposal.collectionRecordId=observation.collectionRecordId;
    proposal.recordLinkStatus=observation.recordLinkStatus;
    proposal.durableObservationId=observation.id;
    proposal.result=null;

    return {
      proposal:publicProposal(proposal),
      observation:clone(observation),
      historyEvent:clone(historyEvent),
      legacySignature:clone(legacySignature)
    };
  }
  function reject(proposalId,options={}){
    const proposal=proposals.get(text(proposalId));
    if(!proposal || proposal.state!=="proposed") return null;
    proposal.state="rejected";
    proposal.persistence="not-persisted";
    proposal.rejectedAt=now();
    proposal.rejectionReason=text(options.reason || "Rejected").slice(0,240);
    proposal.result=null;
    return publicProposal(proposal);
  }
  function get(proposalId){ return publicProposal(proposals.get(text(proposalId))); }
  function list(){ return [...proposals.values()].map(publicProposal); }
  function clear(proposalId){
    if(proposalId) return proposals.delete(text(proposalId));
    proposals.clear();
    return true;
  }

  window.ObservationService={
    version:"1.0.0",
    propose,
    accept,
    reject,
    get,
    list,
    clear
  };
})();
