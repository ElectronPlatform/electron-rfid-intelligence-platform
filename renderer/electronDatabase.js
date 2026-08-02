/*
 * Electron v0.8.0 Patch 01 - Electron Database Foundation
 *
 * This is the central browser-local database facade for Electron Memory.
 * Storage is still localStorage for now, but the rest of the app should talk
 * to ElectronDatabase instead of knowing where records live internally.
 */
(function(){
  const DB_VERSION = "0.8.0";
  const STORAGE_PREFIX = window.ElectronBuildConfig?.IS_PREVIEW_BUILD ? `electronPreview.${window.ElectronBuildConfig.PREVIEW_BUILD_VERSION || "dev"}.` : "";
  function storageKey(name){ return `${STORAGE_PREFIX}${name}`; }
  const KEYS = {
    research: storageKey("electronResearchCollection.v1"),
    known: storageKey("electronKnownByYou.v1"),
    signatures: storageKey("electronCardSignatures.v1"),
    scanHistory: storageKey("electronScanHistory.v1"),
    authorizedKeys: storageKey("electronAuthorizedKeys.v1"),
    authorizedReads: storageKey("electronAuthorizedReads.v1"),
    commandSets: storageKey("electronPm3CommandSets.v1"),
    lfCardIntelligence: storageKey("electronLfCardIntelligence.v1"),
    familyAnalyses: storageKey("electronFamilyAnalyses.v1"),
    domainObservations: storageKey("electronDomainObservations.v1"),
    domainHistoryEvents: storageKey("electronDomainHistoryEvents.v1")
  };
  const KNOWLEDGE_INDEX = {
    cardFamilies: "knowledge/cardFamilies/index.json",
    manufacturers: "knowledge/manufacturers/index.json",
    protocols: "knowledge/protocols/index.json",
    devices: "knowledge/devices/index.json",
    capabilities: "knowledge/capabilities/index.json"
  };
  const knowledgeState = {loaded:false, error:null, catalog:null};

  function text(value){ return String(value ?? ""); }
  function now(){ return new Date().toISOString(); }
  function readArray(key){
    try{
      const value = JSON.parse(localStorage.getItem(key) || "[]");
      return Array.isArray(value) ? value : [];
    }catch{
      return [];
    }
  }
  function writeArray(key, items){
    localStorage.setItem(key, JSON.stringify(Array.isArray(items) ? items : [], null, 2));
    document.dispatchEvent(new CustomEvent("electron-database-changed", {detail:{key}}));
  }
  function escapeHtml(value){
    return text(value).replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
  }
  function compact(value){
    return text(value).trim().replace(/\s+/g, " ");
  }
  function cleanUid(uid){
    return text(uid).toUpperCase().replace(/[^0-9A-F]/g, "");
  }
  function keyFingerprint(value){
    const input = text(value).trim();
    let hash = 5381;
    for(let i = 0; i < input.length; i += 1){
      hash = ((hash << 5) + hash) ^ input.charCodeAt(i);
    }
    return `key-${(hash >>> 0).toString(16).padStart(8, "0")}`;
  }
  function keyPreview(value){
    const cleaned = text(value).trim().replace(/\s+/g, "");
    if(!cleaned) return "";
    return cleaned.length <= 4 ? "••••" : `••••${cleaned.slice(-4)}`;
  }
  function safeIdPart(value){
    return text(value).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80) || "unknown";
  }
  async function loadJson(path){
    const res = await fetch(path, {cache:"no-store"});
    if(!res.ok) throw new Error(`Could not load ${path}: ${res.status}`);
    return await res.json();
  }
  async function loadKnowledgeCollection(name, indexPath){
    const index = await loadJson(indexPath);
    const base = indexPath.replace(/[^/]+$/, "");
    const records = [];
    for(const item of index.items || []){
      const record = await loadJson(base + item.file);
      records.push(normaliseKnowledgeRecord(name, record));
    }
    return {name, version:index.version || "0.1.0", records};
  }
  function arrayValue(value){
    if(Array.isArray(value)) return value.filter(v => v !== null && v !== undefined && text(v).trim() !== "");
    if(value === null || value === undefined || value === "") return [];
    return [value];
  }
  function normaliseKnowledgeRecord(collection, record){
    const item = Object.assign({}, record || {});
    item.id = compact(item.id || item.displayName || "unknown") || "unknown";
    item.kind = item.kind || collection.replace(/s$/, "");
    item.displayName = item.displayName || item.id;
    item.aliases = arrayValue(item.aliases);
    item.category = item.category || "";
    item.manufacturer = item.manufacturer || "";
    item.manufacturerIds = arrayValue(item.manufacturerIds);
    item.protocol = item.protocol || "";
    item.protocolIds = arrayValue(item.protocolIds);
    item.frequency = item.frequency || "";
    item.memory = item.memory || {};
    item.security = item.security || {};
    item.commonApplications = arrayValue(item.commonApplications);
    item.readableFields = arrayValue(item.readableFields);
    item.protectedFields = arrayValue(item.protectedFields);
    item.supportedDevices = arrayValue(item.supportedDevices || item.deviceIds);
    item.deviceIds = arrayValue(item.deviceIds || item.supportedDevices);
    item.capabilityIds = arrayValue(item.capabilityIds);
    item.proxmarkCommands = arrayValue(item.proxmarkCommands);
    item.references = arrayValue(item.references);
    item.notes = item.notes || "";
    item.summary = item.summary || "";
    return item;
  }
  function indexKnowledgeCatalog(catalog){
    const byId = {};
    const byAlias = {};
    for(const collection of Object.keys(KNOWLEDGE_INDEX)){
      byId[collection] = {};
      byAlias[collection] = {};
      for(const record of catalog[collection] || []){
        byId[collection][record.id] = record;
        [record.id, record.displayName, ...(record.aliases || [])].forEach(value => {
          const key = safeIdPart(value);
          if(key) byAlias[collection][key] = record;
        });
      }
    }
    catalog.index = {byId, byAlias};
    return catalog;
  }
  async function loadKnowledgeCatalog(){
    if(knowledgeState.loaded) return knowledgeState.catalog;
    try{
      const entries = await Promise.all(Object.entries(KNOWLEDGE_INDEX).map(([name,path]) => loadKnowledgeCollection(name, path)));
      const catalog = {version:"0.1.0", loadedAt:now()};
      entries.forEach(entry => { catalog[entry.name] = entry.records; });
      indexKnowledgeCatalog(catalog);
      knowledgeState.loaded = true;
      knowledgeState.catalog = catalog;
      knowledgeState.error = null;
      document.dispatchEvent(new CustomEvent("electron-knowledge-catalog-loaded", {detail:{version:catalog.version}}));
      return catalog;
    }catch(err){
      knowledgeState.error = err;
      console.warn("Electron Knowledge Catalog load failed", err);
      return {version:"0.1.0", cardFamilies:[], manufacturers:[], protocols:[], devices:[], capabilities:[]};
    }
  }
  function getKnowledgeCatalog(){
    return knowledgeState.catalog || {version:"0.1.0", cardFamilies:[], manufacturers:[], protocols:[], devices:[], capabilities:[]};
  }
  function getKnowledgeRecord(collection, id){
    const catalog = getKnowledgeCatalog();
    const key = safeIdPart(id);
    return catalog.index?.byId?.[collection]?.[key] || catalog.index?.byAlias?.[collection]?.[key] || (catalog[collection] || []).find(x => x.id === id) || null;
  }
  function loadKnowledge(){ return loadKnowledgeCatalog(); }
  function findKnowledgeRecords(collection, predicate){
    const items = getKnowledgeCatalog()[collection] || [];
    if(typeof predicate !== "function") return items;
    return items.filter(predicate);
  }
  function getCardFamily(id){ return getKnowledgeRecord("cardFamilies", id); }
  function getProtocol(id){ return getKnowledgeRecord("protocols", id); }
  function getDevice(id){ return getKnowledgeRecord("devices", id); }
  function getCapability(id){ return getKnowledgeRecord("capabilities", id); }

  function cleanReadableValue(value){
    if(value === null || value === undefined) return "";
    if(Array.isArray(value)) return value.map(cleanReadableValue).filter(Boolean).join(", ");
    if(typeof value === "object") return "";
    return text(value).trim();
  }
  function firstReadable(source, aliases){
    if(!source || typeof source !== "object") return "";
    for(const key of aliases){
      if(Object.prototype.hasOwnProperty.call(source, key)){
        const value = cleanReadableValue(source[key]);
        if(value) return value;
      }
    }
    const lower = Object.fromEntries(Object.keys(source).map(k => [k.toLowerCase(), k]));
    for(const key of aliases){
      const real = lower[text(key).toLowerCase()];
      if(real){
        const value = cleanReadableValue(source[real]);
        if(value) return value;
      }
    }
    return "";
  }
  function extractReadableCardData(result){
    if(window.ReadableDataExtractor?.extract){
      const module = result?.module || {};
      return window.ReadableDataExtractor.extract(result || {}, {
        catalog:getKnowledgeCatalog(),
        family:getCardFamily(module.id)
      });
    }
    const parsed = result?.parsed || {};
    const module = result?.module || {};
    const ndef = parsed.ndef || result?.ndef || {};
    const app = parsed.application || result?.applicationData || {};
    const sources = [parsed, ndef, app, result || {}];
    const definitions = [
      {key:"name", label:"Name", aliases:["name","fullName","cardholderName","holderName","displayNameOnCard"]},
      {key:"firstName", label:"First name", aliases:["firstName","givenName","forename"]},
      {key:"lastName", label:"Last name", aliases:["lastName","surname","familyName"]},
      {key:"dateOfBirth", label:"Date of birth", aliases:["dateOfBirth","dob","birthDate"]},
      {key:"issueDate", label:"Issue date", aliases:["issueDate","dateOfIssue","issued","issuedAt","validFrom"]},
      {key:"expiryDate", label:"Expiry date", aliases:["expiryDate","expirationDate","expires","expiresAt","validUntil"]},
      {key:"issuer", label:"Issuer", aliases:["issuer","issuingAuthority","authority","issuerName"]},
      {key:"cardNumber", label:"Card number", aliases:["cardNumber","documentNumber","licenceNumber","licenseNumber","idNumber"]},
      {key:"application", label:"Application", aliases:["application","applicationLabel","aidLabel","appName"]},
      {key:"ndefText", label:"NDEF text", aliases:["text","ndefText","payloadText"]},
      {key:"ndefUrl", label:"NDEF URL", aliases:["url","uri","ndefUrl"]}
    ];
    const fields = [];
    for(const def of definitions){
      let value = "";
      for(const source of sources){
        value = firstReadable(source, def.aliases);
        if(value) break;
      }
      if(value) fields.push({key:def.key, label:def.label, value, exposed:true});
    }
    return {
      fields,
      availableCount: fields.length,
      unavailableExpected:["Name","Issue date","Expiry date","Issuer","Card number"],
      notice:"Only information exposed by the card or decoded from safe scan output is shown. Protected or encrypted fields are not bypassed."
    };
  }

  function signatureFromAnalysis(result){
    const module = result?.module || {};
    const parsed = result?.parsed || {};
    const lf = parseLfSearchOutput(parsed.raw || result?.raw || "");
    const uid = compact(parsed.uid || result?.uid || lf.rawId || "");
    return {
      signatureId: "",
      moduleId: module.id || "unknown",
      displayName: module.displayName || result?.displayName || "Unknown card",
      technology: module.technology || "",
      frequency: module.frequency || "",
      protocol: module.protocol || "",
      family: module.family || "",
      application: module.application || "",
      confidence: Number(result?.confidence || 0),
      confidenceLevel: result?.confidenceLevel || "",
      uid,
      uidNormalized: cleanUid(uid),
      uidLength: uid ? cleanUid(uid).length / 2 : null,
      atqa: compact(parsed.atqa || ""),
      sak: compact(parsed.sak || ""),
      ats: compact(parsed.ats || ""),
      hasAts: !!parsed.ats,
      typeHints: Array.isArray(parsed.typeHints) ? parsed.typeHints : [],
      lf
    };
  }
  function normaliseSignature(signature){
    const sig = Object.assign({
      moduleId:"unknown", displayName:"Unknown card", technology:"", frequency:"", protocol:"", family:"", application:"",
      confidence:0, confidenceLevel:"", uid:"", uidNormalized:"", uidLength:null, atqa:"", sak:"", ats:"", hasAts:false, typeHints:[]
    }, signature || {});
    sig.uid = compact(sig.uid);
    sig.uidNormalized = sig.uidNormalized || cleanUid(sig.uid);
    sig.uidLength = sig.uidLength ?? (sig.uidNormalized ? sig.uidNormalized.length / 2 : null);
    sig.signatureId = sig.signatureId || createSignatureId(sig);
    return sig;
  }
  function createSignatureId(signature){
    const sig = signature || {};
    const uid = cleanUid(sig.uidNormalized || sig.uid);
    if(uid) return ["sig", safeIdPart(sig.moduleId), uid].join("-");
    const technical = [sig.moduleId, sig.technology, sig.protocol, sig.family, sig.atqa, sig.sak].map(safeIdPart).filter(Boolean).join("-");
    return `sig-${technical || "unknown"}`;
  }
  function scoreSignatures(a, b){
    if(!a || !b) return 0;
    const left = normaliseSignature(a);
    const right = normaliseSignature(b);
    let score = 0;
    if(left.signatureId && right.signatureId && left.signatureId === right.signatureId) score += 100;
    if(left.uidNormalized && right.uidNormalized && left.uidNormalized === right.uidNormalized) score += 70;
    if(left.lf?.rawId && right.lf?.rawId && left.lf.rawId === right.lf.rawId) score += 70;
    if(left.moduleId && right.moduleId && left.moduleId === right.moduleId) score += 20;
    if(left.atqa && right.atqa && left.atqa === right.atqa) score += 8;
    if(left.sak && right.sak && left.sak === right.sak) score += 8;
    if(left.protocol && right.protocol && left.protocol === right.protocol) score += 6;
    if(left.family && right.family && left.family === right.family) score += 5;
    if(left.technology && right.technology && left.technology === right.technology) score += 3;
    return Math.min(100, score);
  }
  function upsertSignature(signature){
    const sig = normaliseSignature(signature);
    const signatures = readArray(KEYS.signatures);
    const idx = signatures.findIndex(s => s.signatureId === sig.signatureId);
    const stamped = Object.assign({}, sig, {
      firstSeenAt: idx >= 0 ? signatures[idx].firstSeenAt : now(),
      lastSeenAt: now(),
      seenCount: idx >= 0 ? Number(signatures[idx].seenCount || 0) + 1 : 1
    });
    if(idx >= 0) signatures[idx] = Object.assign({}, signatures[idx], stamped);
    else signatures.unshift(stamped);
    writeArray(KEYS.signatures, signatures);
    return stamped;
  }
  function addScanHistory(signature, source){
    const sig = normaliseSignature(signature);
    const history = readArray(KEYS.scanHistory);
    const item = {id:`scan-${Date.now()}`, createdAt:now(), signatureId:sig.signatureId, displayName:sig.displayName, moduleId:sig.moduleId, technology:sig.technology, protocol:sig.protocol, uid:sig.uid, source:source || "", readableData:extractReadableCardData({parsed:signature?.parsed||{}, module:signature||{}})};
    history.unshift(item);
    writeArray(KEYS.scanHistory, history.slice(0, 500));
    return item;
  }
  function safeDomainReadableData(value){
    const fields=arrayValue(value?.fields).map(item=>{
      const key=compact(item?.key).slice(0,80);
      const label=compact(item?.label || key).slice(0,120);
      const fieldValue=cleanReadableValue(item?.value).slice(0,500);
      if(!key || !fieldValue) return null;
      return {
        key,
        label,
        value:fieldValue,
        category:compact(item?.category || "other").slice(0,80),
        source:compact(item?.source || "parsed scan").slice(0,120),
        authentication:compact(item?.authentication || "public").slice(0,40)
      };
    }).filter(Boolean);
    return {
      fields,
      availableCount:fields.length,
      notice:compact(value?.notice || "").slice(0,500)
    };
  }
  function saveDomainObservation(data){
    const id=compact(data?.id);
    if(!id) throw new Error("Domain Observation requires an id.");
    const items=readArray(KEYS.domainObservations);
    const existing=items.find(item=>item.id===id);
    if(existing) return existing;
    const identification=data?.identification || {};
    const provenance=data?.provenance || {};
    const record={
      schemaVersion:compact(data?.schemaVersion || "1.0.0"),
      id,
      entityType:"observation",
      status:"accepted",
      collectionRecordId:compact(data?.collectionRecordId || ""),
      recordLinkStatus:compact(data?.recordLinkStatus || (data?.collectionRecordId ? "confirmed" : "unresolved")),
      legacySignatureId:compact(data?.legacySignatureId || ""),
      source:compact(data?.source || "live-scan").slice(0,120),
      observedAt:compact(data?.observedAt || now()),
      acceptedAt:compact(data?.acceptedAt || now()),
      identification:{
        status:compact(identification.status || "identified"),
        moduleId:compact(identification.moduleId || ""),
        displayName:compact(identification.displayName || "Unknown card").slice(0,160),
        technology:compact(identification.technology || "").slice(0,120),
        protocol:compact(identification.protocol || "").slice(0,120),
        confidence:Math.max(0,Math.min(100,Number(identification.confidence || 0))),
        confidenceLevel:compact(identification.confidenceLevel || "").slice(0,40),
        uid:compact(identification.uid || "").slice(0,120)
      },
      readableData:safeDomainReadableData(data?.readableData || {}),
      provenance:{
        proposalId:compact(provenance.proposalId || ""),
        scanSessionId:compact(provenance.scanSessionId || ""),
        acceptanceMode:compact(provenance.acceptanceMode || "explicit"),
        acceptedBy:compact(provenance.acceptedBy || "Electron").slice(0,120),
        sourceService:"ObservationService"
      }
    };
    items.unshift(record);
    writeArray(KEYS.domainObservations,items.slice(0,500));
    return record;
  }
  function getDomainObservations(){
    return readArray(KEYS.domainObservations);
  }
  function saveDomainHistoryEvent(data){
    const id=compact(data?.id);
    const subjectId=compact(data?.subjectId);
    if(!id || !subjectId) throw new Error("Domain History Event requires id and subjectId.");
    const items=readArray(KEYS.domainHistoryEvents);
    const existing=items.find(item=>item.id===id);
    if(existing) return existing;
    const details=data?.details || {};
    const record={
      schemaVersion:compact(data?.schemaVersion || "1.0.0"),
      id,
      entityType:"history-event",
      eventType:compact(data?.eventType || "domain.changed").slice(0,120),
      subjectType:compact(data?.subjectType || "unknown").slice(0,80),
      subjectId,
      collectionRecordId:compact(data?.collectionRecordId || ""),
      occurredAt:compact(data?.occurredAt || now()),
      actor:compact(data?.actor || "Electron").slice(0,120),
      sourceService:compact(data?.sourceService || "HistoryService").slice(0,120),
      details:{
        proposalId:compact(details.proposalId || ""),
        scanSessionId:compact(details.scanSessionId || ""),
        acceptanceMode:compact(details.acceptanceMode || ""),
        legacySignatureId:compact(details.legacySignatureId || "")
      }
    };
    items.unshift(record);
    writeArray(KEYS.domainHistoryEvents,items.slice(0,1000));
    return record;
  }
  function getDomainHistoryEvents(){
    return readArray(KEYS.domainHistoryEvents);
  }
  function commandOutput(raw, command){
    const value=text(raw);
    const marker=new RegExp(`\\[Electron\\s+${command.replace(/[.*+?^${}()|[\]\\]/g,"\\$&")}\\]`,"ig");
    const matches=[...value.matchAll(marker)];
    if(!matches.length) return /\[Electron\s+[^\]]+\]/i.test(value) ? "" : value;
    const start=matches[matches.length-1].index + matches[matches.length-1][0].length;
    const next=value.slice(start).search(/\[Electron\s+[^\]]+\]/i);
    return value.slice(start,next>=0?start+next:undefined);
  }
  function positiveLfEvidence(raw){
    return text(raw).split(/[\r\n]+/).filter(line=>{
      const value=line.replace(/^\s*\[[=+?!-]\]\s*/,"").trim();
      if(!value) return false;
      if(/(?:Searching for|Checking for known tags|Searching for auth LF|False Positives ARE possible)/i.test(value)) return false;
      if(/(?:command execution time out|timed?\s*out|Couldn't identify a chipset|No known\/supported|No tag found|not detected|no card)/i.test(value)) return false;
      if(/^(?:Session log|loaded\b|execute command|Using UART|Communicating with PM3|pm3\s*-->)/i.test(value)) return false;
      if(/^Hint:\s*(?:try|use)\b/i.test(value)) return false;
      return true;
    }).join("\n");
  }
  function parseLfSearchOutput(raw){
    const t = commandOutput(raw,"LF search");
    const hasLfContext=/\bLF\b|125\s*kHz|134(?:\.2)?\s*kHz|HID\s+Prox|H10301|Hitag|PCF\s*79|EM\s*410|Indala|AWID|IoProx|T55(?:77|xx)|Temic|Cotag|Pyramid|FDX-B/i.test(t);
    const evidence = hasLfContext ? positiveLfEvidence(t) : "";
    const hidFound = /Valid\s+HID\s+Prox\s+ID\s+found/i.test(evidence);
    const hitagFound = /(?:Chipset[.\s:=]+Hitag\s*2|TYPE[.\s:=]+PCF\s*79(?:52|4\d)|Hitag\s*2[^\r\n]*(?:found|detected))/i.test(evidence);
    let rawId = (evidence.match(/HID\s+Prox\s+ID\s*[:=]?\s*([0-9A-Fa-fx ]{4,})/i)
      || evidence.match(/\braw\s*(?:ID|id)?\s*[:=]\s*([0-9A-Fa-fx ]{4,})/i)
      || evidence.match(/\bUID[.\s:=]+([0-9A-Fa-fx ]{4,})/i)
      || evidence.match(/\bID\s*[:=]\s*([0-9A-Fa-fx ]{4,})/i))?.[1]?.trim().replace(/\s+/g, " ").toUpperCase() || "";
    if(hitagFound){
      const uidMatches = [...evidence.matchAll(/\bUID[.\s:=]+([0-9A-Fa-fx ]{4,})/ig)];
      const hitagUid = uidMatches[uidMatches.length - 1]?.[1]?.trim().replace(/\s+/g, " ").toUpperCase();
      if(hitagUid) rawId = hitagUid;
    }
    const lfType = compact((evidence.match(/\bTYPE[.\s:=]+([^\r\n]+)/i) || [])[1] || "");
    const facilityCode = (evidence.match(/\b(?:Facility\s*Code|FC)\s*[:=]\s*(\d{1,5})/i) || [])[1] || "";
    const cardNumber = (evidence.match(/\b(?:Card\s*(?:Number|No\.?)|CN)\s*[:=]\s*(\d{1,10})/i) || [])[1] || "";
    const h10301 = /H10301|26[-\s]*bit/i.test(evidence) || (hidFound && facilityCode && cardNumber);
    const alternatives = [];
    const altPatterns = [
      [/EM\s*410x[^\r\n]*/ig, "EM410x"],
      [/Indala[^\r\n]*/ig, "Indala"],
      [/AWID[^\r\n]*/ig, "AWID"],
      [/IoProx[^\r\n]*/ig, "ioProx"],
      [/NexWatch[^\r\n]*/ig, "NexWatch"],
      [/HID\s+Prox[^\r\n]*/ig, "HID Prox"]
    ];
    for(const [pattern, type] of altPatterns){
      for(const match of evidence.matchAll(pattern)){
        const value = compact(match[0]);
        if(value && !(type === "HID Prox" && hidFound) && !alternatives.some(x => x.value === value)) alternatives.push({type, value});
      }
    }
    const t55xxHint = /T55(?:77|xx)|T5(?:5|7)|Atmel|Temic/i.test(evidence)
      ? compact((evidence.match(/[^\r\n]*(?:T55(?:77|xx)|T5(?:5|7)|Atmel|Temic)[^\r\n]*/i) || [])[0] || "Possible T55xx-compatible chipset")
      : "";
    let primary = null;
    if(hidFound){
      primary = {
        format:h10301 ? "HID H10301 26-bit" : "HID Prox",
        facilityCode,
        cardNumber,
        rawId
      };
    }else if(hitagFound){
      primary = {
        format:/Hitag\s*2/i.test(t) ? "Hitag 2" : "Hitag",
        type:lfType,
        rawId
      };
    }
    return {
      detected:!!(hidFound || hitagFound || rawId || facilityCode || cardNumber || alternatives.length || t55xxHint),
      primary,
      facilityCode,
      cardNumber,
      rawId,
      type:lfType,
      alternatives,
      t55xxHint,
      source:"lf search",
      raw:t
    };
  }
  function saveLfCardIntelligence(signature, raw){
    const sig = normaliseSignature(signature);
    const parsed = parseLfSearchOutput(raw);
    if(!parsed.detected) return null;
    const record = {
      id:`lfintel_${safeIdPart(sig.signatureId)}_${Date.now()}`,
      signatureId:sig.signatureId,
      moduleId:sig.moduleId,
      displayName:sig.displayName,
      createdAt:now(),
      updatedAt:now(),
      parsed,
      safeActions:[
        {label:"Explore T55xx", commands:["lf t55xx detect","lf t55xx info","lf t55xx p1detect","lf t55xx config"]},
        {label:"Read HID", commands:["lf hid reader"]},
        {label:"Save Raw", commands:[]}
      ]
    };
    const items = readArray(KEYS.lfCardIntelligence).filter(item => item.signatureId !== sig.signatureId);
    items.unshift(record);
    writeArray(KEYS.lfCardIntelligence, items.slice(0, 250));
    return record;
  }
  function getLfCardIntelligence(signature){
    const sig = normaliseSignature(signature);
    return readArray(KEYS.lfCardIntelligence).find(item => item.signatureId === sig.signatureId) || null;
  }
  function saveResearch(record){
    const items = readArray(KEYS.research);
    const sig = normaliseSignature(record?.signature || {});
    upsertSignature(sig);
    const id = record?.id || `research-${Date.now()}`;
    const existingIndex = items.findIndex(x => x.id === id);
    const existing = existingIndex >= 0 ? items[existingIndex] : {};
    const item = Object.assign({}, existing, record || {}, {
      id,
      signature: sig,
      signatureId: sig.signatureId,
      createdAt: existing.createdAt || record?.createdAt || now(),
      updatedAt: now(),
      storage: {label:"Electron Database → Research Library", localOnly:true}
    });
    if(existingIndex >= 0) items[existingIndex] = item;
    else items.unshift(item);
    writeArray(KEYS.research, items);
    return item;
  }
  function deleteResearch(id){
    const before = readArray(KEYS.research);
    const after = before.filter(x => x.id !== id);
    writeArray(KEYS.research, after);
    return before.length !== after.length;
  }
  function getResearch(){ return readArray(KEYS.research); }
  function getResearchById(id){ return getResearch().find(x => x.id === id) || null; }
  function getResearchBySignature(signature, minScore=45){
    const sig = normaliseSignature(signature);
    return getResearch()
      .map(record => ({record, score:scoreSignatures(sig, record.signature || {signatureId:record.signatureId})}))
      .filter(match => match.score >= minScore)
      .sort((a,b) => b.score - a.score);
  }
  function saveKnownByYou(data){
    const sig = normaliseSignature(data?.signature || {});
    upsertSignature(sig);
    const items = readArray(KEYS.known);
    const id = data?.id || `known-${sig.signatureId}`;
    const existingIndex = items.findIndex(x => x.id === id || x.signatureId === sig.signatureId);
    const existing = existingIndex >= 0 ? items[existingIndex] : {};
    const item = Object.assign({}, existing, data || {}, {
      id: existing.id || id,
      signature: sig,
      signatureId: sig.signatureId,
      createdAt: existing.createdAt || data?.createdAt || now(),
      updatedAt: now(),
      storage: {label:"Electron Database → Known by You", localOnly:true}
    });
    if(existingIndex >= 0) items[existingIndex] = item;
    else items.unshift(item);
    writeArray(KEYS.known, items);
    return item;
  }
  function deleteKnownByYou(signatureOrId){
    const key = text(signatureOrId);
    const before = readArray(KEYS.known);
    const after = before.filter(x => x.id !== key && x.signatureId !== key);
    writeArray(KEYS.known, after);
    return before.length !== after.length;
  }
  function getKnownByYou(signature){
    const sig = normaliseSignature(signature);
    return readArray(KEYS.known).find(x => x.signatureId === sig.signatureId || scoreSignatures(sig, x.signature) >= 70) || null;
  }
  function getKnownByYouList(){ return readArray(KEYS.known); }
  function getScanHistoryBySignature(signature){
    const sig = normaliseSignature(signature);
    return readArray(KEYS.scanHistory).filter(x => x.signatureId === sig.signatureId || (x.uid && cleanUid(x.uid) === sig.uidNormalized));
  }
  function supportedDevicesForSignature(signature){
    const sig = normaliseSignature(signature);
    const id = sig.moduleId || "unknown";
    const tech = sig.technology || "";
    const family = getCardFamily(id);
    if(family?.supportedDevices?.length){
      return family.supportedDevices.map(deviceId => {
        const device = getDevice(deviceId);
        const limited = family.capabilityIds?.includes("safe_metadata_only");
        return {
          name:device?.displayName || deviceId,
          support:limited && deviceId !== "proxmark3" ? "limited" : "possible",
          note:device?.notes || "Compatibility is defined by the Electron Knowledge Database."
        };
      });
    }
    const devices = [];
    function add(name, support, note){ devices.push({name, support, note}); }

    add("Proxmark3", "supported", "Primary scan and research device for the current Electron build.");
    if(/HF|13\.56/i.test(tech) || ["mifare_classic","mifare_mini","mifare_desfire","mifare_desfire_light","mifare_duox","mifare_plus","mifare_smartmx","ntag21x","ntag_dna","ntag_424_dna","ntag_i2c","mifare_ultralight","topaz_jewel","iso14443a","iso14443b","iso15693","icode_slix","icode_dna","felica","felica_lite_s","st25dv","sri512_srix4k","legic_prime","legic_advant","calypso","cipurse","cepas","icao_mrtd","german_eid","suica","octopus","oyster","apple_wallet_credential","google_wallet_credential","seos","piv_cac","javacard_globalplatform","emv_payment","nfc_type2","nfc_type4","nfc_type5"].includes(id)){
      add("Flipper Zero", id === "emv_payment" ? "limited" : "possible", id === "emv_payment" ? "Safe identification only. No payment or protected data workflow." : "Useful for many NFC identification and tag workflows, depending on card family.");
      add("Chameleon Ultra", ["mifare_classic","ntag21x","mifare_ultralight"].includes(id) ? "possible" : "limited", "Compatibility depends on exact protocol, firmware and authorised test use.");
    }
    if(/LF|125|134\.2/i.test(tech) || ["em410x","em4200","em4305","hid_prox","t5577","indala","hitag1","hitag2","hitag_s","hitag_u","megamos","texas_dst","temic","pcf793x","pcf794x","pcf796x","awid","ioprox","pyramid","cotag","nedap","gallagher","paxton_net2","deister","securakey","keri","rosslare","motorola_casi_rusco","guardall","visa2000","viking","presco","jablotron","nexwatch","paradox","pac_stanley","fdx_b","hdx"].includes(id)){
      add("Flipper Zero", "possible", "Can work with several LF ID formats when supported by firmware.");
      add("Chameleon Ultra", "limited", "Mostly HF/NFC oriented; check exact device capabilities before using.");
    }
    return devices;
  }
  function protectedDataSummary(signature, readableData){
    const sig = normaliseSignature(signature);
    const protectedLabels = readableData?.unavailableExpected || ["Name","Issue date","Expiry date","Issuer","Card number"];
    const protectedAccess = readableData?.protectedAccess || null;
    if(protectedAccess?.detected){
      return {
        title:"Protected / encrypted data",
        summary:protectedAccess.summary,
        fields:protectedAccess.items.map(item => item.label),
        access:protectedAccess
      };
    }
    if(sig.moduleId === "emv_payment"){
      return {
        title:"Protected application data",
        summary:"Payment and identity-style smartcards expose only limited public metadata. Electron does not try to read, store or infer protected payment data.",
        fields:["Payment credentials","Cryptographic keys","Private application data"],
        access:protectedAccess
      };
    }
    if(sig.moduleId === "mifare_classic"){
      return {
        title:"Protected sectors may exist",
        summary:"MIFARE Classic memory may require authorised keys before sectors can be read. Unknown sectors are treated as protected.",
        fields:["Sector keys","Access bits","Unread sectors"],
        access:protectedAccess
      };
    }
    return {
      title:"Not readable from this scan",
      summary:"Electron only shows data exposed by the scan. Missing identity fields are not guessed or bypassed.",
      fields:protectedLabels,
      access:protectedAccess
    };
  }
  function getAuthorizedKeys(signature){
    const sig = normaliseSignature(signature);
    return readArray(KEYS.authorizedKeys).filter(item => item.signatureId === sig.signatureId);
  }
  function saveAuthorizedKey(data){
    const sig = normaliseSignature(data?.signature || {});
    const material = text(data?.keyMaterial).trim();
    const suppliedSector = data?.sector;
    const hasSuppliedSector = suppliedSector !== null && suppliedSector !== undefined && text(suppliedSector).trim() !== "" && Number.isInteger(Number(suppliedSector));
    const items = readArray(KEYS.authorizedKeys);
    const record = {
      id: data?.id || `authkey_${safeIdPart(sig.signatureId)}_${Date.now()}`,
      signatureId: sig.signatureId,
      moduleId: sig.moduleId,
      displayName: sig.displayName,
      keyType: compact(data?.keyType || "authorised-card-key"),
      label: compact(data?.label || "Authorized key"),
      sector:hasSuppliedSector ? Number(suppliedSector) : null,
      sectors:Array.isArray(data?.sectors) ? data.sectors.map(Number).filter(Number.isInteger) : [],
      keySlot:/^[AB]$/i.test(text(data?.keySlot)) ? text(data.keySlot).toUpperCase() : "",
      family:compact(data?.family || data?.profileId || ""),
      algorithm:compact(data?.algorithm || data?.keyAlgorithm || "").toUpperCase(),
      keyNumber:data?.keyNumber !== null && data?.keyNumber !== undefined && text(data.keyNumber).trim() !== "" && Number.isInteger(Number(data.keyNumber)) ? Number(data.keyNumber) : null,
      aid:compact(data?.aid || data?.applicationId || "").replace(/[^0-9A-F]/gi, "").toUpperCase(),
      fileId:compact(data?.fileId || data?.fid || "").replace(/[^0-9A-F]/gi, "").toUpperCase(),
      readLength:data?.readLength !== null && data?.readLength !== undefined && text(data.readLength).trim() !== "" && Number.isInteger(Number(data.readLength)) ? Number(data.readLength) : null,
      fingerprint: material ? keyFingerprint(material) : compact(data?.fingerprint || ""),
      preview: material ? keyPreview(material) : compact(data?.preview || ""),
      keyLength: material ? material.replace(/\s+/g, "").length : Number(data?.keyLength || 0),
      keyMaterial: material || text(data?.keyMaterial || ""),
      hasKeyMaterial: !!(material || data?.keyMaterial),
      storage: material ? "local-authorized-key" : "local-reference",
      createdAt: data?.createdAt || now(),
      updatedAt: now()
    };
    const idx = items.findIndex(item => item.id === record.id);
    if(idx >= 0) items[idx] = Object.assign({}, items[idx], record);
    else items.unshift(record);
    writeArray(KEYS.authorizedKeys, items);
    return record;
  }
  function getLatestAuthorizedRead(signature){
    const sig = normaliseSignature(signature);
    return readArray(KEYS.authorizedReads).find(item => item.signatureId === sig.signatureId) || null;
  }
  function saveAuthorizedReadResult(data){
    const sig = normaliseSignature(data?.signature || {});
    const readableData = data?.readableData || extractReadableCardData({parsed:{raw:data?.output || ""}, module:sig});
    const record = {
      id:data?.id || `authread_${safeIdPart(sig.signatureId)}_${Date.now()}`,
      signatureId:sig.signatureId,
      moduleId:sig.moduleId,
      displayName:sig.displayName,
      keyId:data?.keyId || "",
      status:data?.status || "unknown",
      message:data?.message || "",
      stats:data?.stats || {},
      commands:Array.isArray(data?.commands) ? data.commands : [],
      keys:Array.isArray(data?.keys) ? data.keys : [],
      access:Array.isArray(data?.access) ? data.access : [],
      recovery:data?.recovery || null,
      output:text(data?.output || ""),
      debug:data?.debug || {},
      readableData,
      createdAt:data?.createdAt || now()
    };
    const items = readArray(KEYS.authorizedReads).filter(item => item.signatureId !== sig.signatureId);
    items.unshift(record);
    writeArray(KEYS.authorizedReads, items.slice(0, 250));
    return record;
  }
  function getFamilyAnalyses(signature){
    if(!signature) return readArray(KEYS.familyAnalyses);
    const sig=normaliseSignature(signature);
    return readArray(KEYS.familyAnalyses).filter(item=>item.signatureId===sig.signatureId);
  }
  function safeFamilyMetadataFields(value){
    const allowed=new Set(["paymentNetwork","applicationLabel","applicationPreferredName","applicationAid","applicationCount","applicationAidList","applicationList","applicationPriority","accountReference","expiryMonthYear","effectiveDate","emvLanguage","emvCurrency","issuerCountry","applicationVersion","aipCapabilities","serviceCode","applicationUsage","kernelIdentifier","track2Presence","panPresence","transactionLogPresence"]);
    const labels={paymentNetwork:"Payment network",applicationLabel:"Application label",applicationPreferredName:"Preferred name",applicationAid:"Application AID",applicationCount:"Applications found",applicationAidList:"Application AIDs",applicationList:"Available applications",applicationPriority:"Application priority",accountReference:"Account reference",expiryMonthYear:"Expiry",effectiveDate:"Effective date",emvLanguage:"Language",emvCurrency:"Currency",issuerCountry:"Issuer country",applicationVersion:"Application version",aipCapabilities:"Public capabilities",serviceCode:"Service code",applicationUsage:"Application usage",kernelIdentifier:"Kernel identifier",track2Presence:"Track 2 data",panPresence:"PAN",transactionLogPresence:"Transaction log"};
    const validAid=value=>/^[0-9A-F]{10,32}$/i.test(value) && value.length%2===0 && /[A-F]/i.test(value);
    return arrayValue(value).map(item=>{
      const key=compact(item?.key);
      let fieldValue=compact(item?.value);
      if(!allowed.has(key)) return null;
      if(key==="applicationAid") fieldValue=validAid(fieldValue) ? fieldValue.toUpperCase() : "";
      else if(key==="applicationCount") fieldValue=/^\d{1,2}$/.test(fieldValue) ? fieldValue : "";
      else if(key==="applicationAidList") fieldValue=fieldValue.split("·").map(value=>value.trim().toUpperCase()).filter(validAid).slice(0,6).join(" · ");
      else if(key==="applicationPriority"){
        const priorities=[...new Set(fieldValue.split("·").map(value=>value.trim()).filter(value=>/^(?:[1-9]|1[0-5])$/.test(value)))];
        fieldValue=priorities.length && priorities.length===fieldValue.split("·").length ? priorities.slice(0,16).join(" · ") : "";
      }
      else if(key==="accountReference") fieldValue=/^•••• \d{4}$/.test(fieldValue) ? fieldValue : "";
      else if(key==="expiryMonthYear") fieldValue=/^(?:0[1-9]|1[0-2])\/\d{2}$/.test(fieldValue) ? fieldValue : "";
      else if(key==="effectiveDate") fieldValue=/^20\d{2}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01])$/.test(fieldValue) ? fieldValue : "";
      else if(key==="applicationVersion") fieldValue=/^0x[0-9A-F]{2,8}$/i.test(fieldValue) ? fieldValue.toUpperCase().replace(/^0X/,"0x") : "";
      else if(key==="issuerCountry") fieldValue=/^(?:[A-Za-z][A-Za-z .'-]{1,48} \(\d{3}\)|\d{3}|[A-Z]{2,3})$/.test(fieldValue) ? fieldValue : "";
      else if(key==="aipCapabilities"){
        const allowedCapabilities=new Set(["SDA","DDA","Cardholder verification","Terminal risk management","Issuer authentication","CDA","MSD"]);
        const capabilities=[...new Set(fieldValue.split("·").map(value=>value.trim()).filter(value=>allowedCapabilities.has(value)))];
        fieldValue=capabilities.length && capabilities.length===fieldValue.split("·").length ? capabilities.join(" · ") : "";
      }
      else if(key==="serviceCode") fieldValue=/^\d{3}$/.test(fieldValue) ? fieldValue : "";
      else if(key==="applicationUsage"){
        const allowedUsage=new Set(["Domestic cash","International cash","Domestic goods","International goods","Domestic services","International services","ATMs","Terminals other than ATMs","Domestic cashback","International cashback"]);
        const usage=[...new Set(fieldValue.split("·").map(value=>value.trim()).filter(value=>allowedUsage.has(value)))];
        fieldValue=usage.length && usage.length===fieldValue.split("·").length ? usage.join(" · ") : "";
      }
      else if(key==="kernelIdentifier") fieldValue=/^[0-9A-F]{2}$/i.test(fieldValue) ? fieldValue.toUpperCase() : "";
      else fieldValue=fieldValue.replace(/\b\d(?:[\s-]*\d){11,18}\b/g,"[redacted]").slice(0,120);
      if(!fieldValue) return null;
      const label=key==="applicationPriority" && fieldValue.includes("·") ? "Application priorities" : (labels[key] || compact(item?.label || key));
      return {key,label,value:fieldValue,category:"application",source:"EMV Extended Analysis",authentication:"public"};
    }).filter(Boolean);
  }
  function safeEmvDiagnostics(value,commands){
    if(!value || typeof value!=="object") return null;
    const definitions={
      pan:{label:"Card number (PAN)",retained:new Set(["none","last-four-only"])},
      track2:{label:"Track 2 data",retained:new Set(["none","presence-only"])},
      expiry:{label:"Expiry",retained:new Set(["none","month-year"])},
      issuerCountry:{label:"Issuer country",retained:new Set(["none","country-only"])}
    };
    const allowedCommands=new Set(arrayValue(commands).map(item=>compact(item?.command)).filter(command=>/^emv\s+(?:pse|search|reader)\b/i.test(command)));
    const fields=arrayValue(value.fields).map(item=>{
      const key=compact(item?.key);
      const definition=definitions[key];
      if(!definition) return null;
      const detected=item?.detected===true;
      const retained=detected && definition.retained.has(compact(item?.retained)) ? compact(item.retained) : "none";
      const sourceCommands=[...new Set(arrayValue(item?.commands).map(compact).filter(command=>allowedCommands.has(command)))].slice(0,6);
      return {key,label:definition.label,detected,retained,commands:sourceCommands};
    }).filter(Boolean);
    if(!fields.length) return null;
    const commandsChecked=[...new Set(arrayValue(value.commandsChecked).map(compact).filter(command=>allowedCommands.has(command)))].slice(0,8);
    return {
      schemaVersion:/^\d+\.\d+\.\d+$/.test(compact(value.schemaVersion)) ? compact(value.schemaVersion) : "1.0.0",
      parserVersion:/^\d+\.\d+\.\d+$/.test(compact(value.parserVersion)) ? compact(value.parserVersion) : "",
      commandsChecked,
      fields
    };
  }
  function saveFamilyAnalysisResult(data){
    const sig=normaliseSignature(data?.signature || {});
    const metadataFields=safeFamilyMetadataFields(data?.metadataFields);
    const commands=arrayValue(data?.commands).map(item=>({
      command:compact(item?.command || ""),
      phase:compact(item?.phase || "read"),
      ok:item?.ok===true,
      status:compact(item?.status || (item?.ok?"completed":"failed")),
      outputLength:Math.max(0,Number(item?.outputLength || 0))
    }));
    const record={
      id:data?.id || `familyanalysis_${safeIdPart(sig.signatureId)}_${Date.now()}`,
      signatureId:sig.signatureId,
      moduleId:sig.moduleId,
      displayName:sig.displayName,
      schemaVersion:compact(data?.schemaVersion || "1.0.0"),
      profile:{id:compact(data?.profile?.id),label:compact(data?.profile?.label),band:compact(data?.profile?.band)},
      workflowType:compact(data?.workflowType || "extended-analysis"),
      workflowTitle:compact(data?.workflowTitle || "Extended Analysis"),
      strategy:{id:compact(data?.strategy?.id),label:compact(data?.strategy?.label),riskLevel:compact(data?.strategy?.riskLevel)},
      status:compact(data?.status || "unknown"),
      privacyClass:compact(data?.privacyClass || "sensitive"),
      persistPolicy:"metadata-only",
      commands,
      rawOutputStored:false,
      metadataFields,
      emvDiagnostics:safeEmvDiagnostics(data?.emvDiagnostics,commands),
      metadata:{
        panPresent:data?.metadata?.panPresent===true,
        track2Present:data?.metadata?.track2Present===true,
        cardholderNamePresent:data?.metadata?.cardholderNamePresent===true,
        transactionLogPresent:data?.metadata?.transactionLogPresent===true,
        rawOutputStored:false
      },
      summary:`${compact(data?.workflowTitle || "Extended Analysis")} ${compact(data?.status || "unknown")} with ${metadataFields.length} redacted metadata field${metadataFields.length===1?"":"s"}. Sensitive raw card output was not stored.`,
      createdAt:data?.createdAt || now()
    };
    const items=readArray(KEYS.familyAnalyses);
    items.unshift(record);
    writeArray(KEYS.familyAnalyses,items.slice(0,250));
    return record;
  }
  function applyAuthorizedKeyStatus(access, signature){
    if(!access?.detected) return access || null;
    const keys = getAuthorizedKeys(signature);
    if(!keys.length) return access;
    const latestRead = getLatestAuthorizedRead(signature);
    const keyUsed = latestRead?.status === "success";
    return Object.assign({}, access, {
      keyAvailable:true,
      keyUsed,
      lastRead:latestRead,
      keyReference:keys[0],
      items:(access.items || []).map(item => Object.assign({}, item, {
        keyAvailable:true,
        keyUsed,
        status:keyUsed ? "authorised key used successfully" : "authorised key reference available"
      }))
    });
  }
  function getCardActionState(intelligence){
    const summary = intelligence?.summary || {};
    const researchMatches = intelligence?.researchMatches || [];
    const known = intelligence?.knownByYou || null;
    const knownByElectron = !!(summary.hasResearch || summary.hasKnownByYou);
    return {
      knownByElectron,
      primary:"open-card-intelligence",
      showTeach:!knownByElectron,
      showKnownByYou:true,
      knownByYouLabel:known ? "Edit Known by You" : "Add Known by You",
      researchLabel:researchMatches.length ? "Edit Research" : "Add Research",
      bestResearchId:researchMatches[0]?.record?.id || "",
      teachLabel:knownByElectron ? "Add another research record" : "Teach Electron",
      status:knownByElectron ? "Electron already knows this card" : "Electron is ready to learn this card"
    };
  }
  function getCardIntelligence(signature, result){
    const sig = normaliseSignature(signature);
    const researchMatches = getResearchBySignature(sig);
    const knownByYou = getKnownByYou(sig);
    const scanHistory = getScanHistoryBySignature(sig);
    const authorizedRead = getLatestAuthorizedRead(sig);
    const lfCardIntelligence = getLfCardIntelligence(sig) || (sig.lf?.detected ? {parsed:sig.lf, signatureId:sig.signatureId, source:"signature"} : null);
    const baseReadableData = extractReadableCardData(result || {parsed:{}, module:sig});
    const readableData = authorizedRead?.status === "success" ? authorizedRead.readableData : baseReadableData;
    const authorizedKeys = getAuthorizedKeys(sig);
    const familyAnalyses = getFamilyAnalyses(sig);
    const authorizedDecryption = applyAuthorizedKeyStatus(readableData.protectedAccess || {detected:false,keyAvailable:false,items:[]}, sig);
    const protectedData = protectedDataSummary(sig, Object.assign({}, readableData, {protectedAccess:authorizedDecryption}));
    const draft = {
      summary:{
        hasResearch: researchMatches.length > 0,
        hasKnownByYou: !!knownByYou
      },
      researchMatches,
      knownByYou
    };
    return {
      signature:sig,
      knownByElectron: {
        displayName:sig.displayName,
        technology:sig.technology,
        protocol:sig.protocol,
        family:sig.family,
        confidence:sig.confidence,
        confidenceLevel:sig.confidenceLevel
      },
      researchMatches,
      knownByYou,
      scanHistory,
      readableData,
      baseReadableData,
      authorizedRead,
      lfCardIntelligence,
      protectedData,
      authorizedDecryption,
      authorizedKeys,
      familyAnalyses,
      supportedDevices: supportedDevicesForSignature(sig),
      lastSeenAt: scanHistory[0]?.createdAt || null,
      summary: {
        hasResearch: researchMatches.length > 0,
        hasKnownByYou: !!knownByYou,
        seenCount: scanHistory.length,
        confidence:sig.confidence,
        confidenceLevel:sig.confidenceLevel
      },
      actions:getCardActionState(draft)
    };
  }
  function getLatestCardViewerSource(){
    const scans=readArray(KEYS.scanHistory);
    const signatures=readArray(KEYS.signatures);
    const authorizedReads=readArray(KEYS.authorizedReads);
    const latestScan=scans[0] || null;
    const latestSuccessfulRead=authorizedReads.find(item=>item?.status==="success") || null;
    const signatureId=latestScan?.signatureId || latestSuccessfulRead?.signatureId || "";
    if(!signatureId) return null;
    const signature=normaliseSignature(signatures.find(item=>item.signatureId===signatureId) || {
      signatureId,
      moduleId:latestScan?.moduleId || latestSuccessfulRead?.moduleId || "unknown",
      displayName:latestScan?.displayName || latestSuccessfulRead?.displayName || "Unknown card",
      technology:latestScan?.technology || "",
      protocol:latestScan?.protocol || "",
      uid:latestScan?.uid || ""
    });
    const scanRecord=latestScan?.signatureId===signatureId ? latestScan : null;
    const authorizedRead=authorizedReads.find(item=>item.signatureId===signatureId) || null;
    const authorizedKeys=readArray(KEYS.authorizedKeys).filter(item=>item.signatureId===signatureId);
    const familyAnalyses=getFamilyAnalyses(signature);
    const knownByYou=getKnownByYou(signature);
    return {
      status:"ready",
      source:"stored-card-read",
      sourceLabel:scanRecord?.source ? `Stored ${scanRecord.source}` : "Stored successful read",
      capturedAt:scanRecord?.createdAt || authorizedRead?.createdAt || "",
      signature,
      scanRecord,
      readableData:authorizedRead?.status==="success" ? authorizedRead.readableData : (scanRecord?.readableData || {fields:[]}),
      authorizedRead,
      authorizedKeys,
      familyAnalyses,
      knownByYou
    };
  }
  function rememberScanFromAnalysis(result, source, options={}){
    const sig = signatureFromAnalysis(result);
    const stored = upsertSignature(sig);
    if(sig.lf?.detected) saveLfCardIntelligence(stored, result?.parsed?.raw || result?.raw || "");
    const dedupeMs = Number(options.dedupeMs ?? 1500);
    const latest = readArray(KEYS.scanHistory)[0];
    if(latest && latest.signatureId === stored.signatureId && latest.source === (source || "") && Date.now() - Date.parse(latest.createdAt || 0) < dedupeMs){
      return stored;
    }
    const historyItem = addScanHistory(stored, source || "");
    const history = readArray(KEYS.scanHistory);
    if(history[0] && history[0].id === historyItem.id){ history[0].readableData = extractReadableCardData(result); writeArray(KEYS.scanHistory, history); }
    return stored;
  }
  function getCommandSets(){
    return readArray(KEYS.commandSets);
  }
  function saveCommandSet(data){
    const commands = arrayValue(data?.commands).map(compact).filter(Boolean);
    const items = getCommandSets();
    const record = {
      id:data?.id || `cmdset_${Date.now()}`,
      name:compact(data?.name || "Untitled command set"),
      commands,
      continueOnError:!!data?.continueOnError,
      createdAt:data?.createdAt || now(),
      updatedAt:now()
    };
    const idx = items.findIndex(item => item.id === record.id);
    if(idx >= 0) items[idx] = Object.assign({}, items[idx], record);
    else items.unshift(record);
    writeArray(KEYS.commandSets, items);
    return record;
  }
  function deleteCommandSet(id){
    const before = getCommandSets();
    writeArray(KEYS.commandSets, before.filter(item => item.id !== id));
  }
  function statistics(){
    const research = getResearch();
    const known = getKnownByYouList();
    const signatures = readArray(KEYS.signatures);
    const scanHistory = readArray(KEYS.scanHistory);
    const authorizedKeys = readArray(KEYS.authorizedKeys);
    const authorizedReads = readArray(KEYS.authorizedReads);
    const commandSets = readArray(KEYS.commandSets);
    const lfCardIntelligence = readArray(KEYS.lfCardIntelligence);
    const familyAnalyses = readArray(KEYS.familyAnalyses);
    const domainObservations = readArray(KEYS.domainObservations);
    const domainHistoryEvents = readArray(KEYS.domainHistoryEvents);
    return {
      version:DB_VERSION,
      researchRecords:research.length,
      knownByYou:known.length,
      cardSignatures:signatures.length,
      scanHistory:scanHistory.length,
      authorizedKeys:authorizedKeys.length,
      authorizedReads:authorizedReads.length,
      commandSets:commandSets.length,
      lfCardIntelligence:lfCardIntelligence.length,
      familyAnalyses:familyAnalyses.length,
      domainObservations:domainObservations.length,
      domainHistoryEvents:domainHistoryEvents.length,
      health:"OK"
    };
  }
  function exportAll(){
    const keyExports = readArray(KEYS.authorizedKeys).map(item => {
      const copy = Object.assign({}, item);
      delete copy.keyMaterial;
      return copy;
    });
    return {version:DB_VERSION, exportedAt:now(), research:getResearch(), knownByYou:getKnownByYouList(), signatures:readArray(KEYS.signatures), scanHistory:readArray(KEYS.scanHistory), authorizedKeys:keyExports, authorizedReads:readArray(KEYS.authorizedReads), commandSets:getCommandSets(), lfCardIntelligence:readArray(KEYS.lfCardIntelligence), familyAnalyses:readArray(KEYS.familyAnalyses), domainObservations:getDomainObservations(), domainHistoryEvents:getDomainHistoryEvents()};
  }

  window.ElectronDatabase = {
    version:DB_VERSION,
    keys:KEYS,
    escapeHtml,
    createSignatureId,
    loadKnowledge,
    loadKnowledgeCatalog,
    getKnowledgeCatalog,
    getKnowledgeRecord,
    findKnowledgeRecords,
    getCardFamily,
    getProtocol,
    getDevice,
    getCapability,
    signatureFromAnalysis,
    extractReadableCardData,
    normaliseSignature,
    scoreSignatures,
    upsertSignature,
    rememberScanFromAnalysis,
    addScanHistory,
    saveDomainObservation,
    getDomainObservations,
    saveDomainHistoryEvent,
    getDomainHistoryEvents,
    saveResearch,
    deleteResearch,
    getResearch,
    getResearchById,
    getResearchBySignature,
    saveKnownByYou,
    deleteKnownByYou,
    getKnownByYou,
    getKnownByYouList,
    getScanHistoryBySignature,
    getAuthorizedKeys,
    saveAuthorizedKey,
    getLatestAuthorizedRead,
    saveAuthorizedReadResult,
    getFamilyAnalyses,
    saveFamilyAnalysisResult,
    parseLfSearchOutput,
    saveLfCardIntelligence,
    getLfCardIntelligence,
    getCommandSets,
    saveCommandSet,
    deleteCommandSet,
    supportedDevicesForSignature,
    protectedDataSummary,
    getCardActionState,
    getCardIntelligence,
    getLatestCardViewerSource,
    statistics,
    exportAll
  };
})();
