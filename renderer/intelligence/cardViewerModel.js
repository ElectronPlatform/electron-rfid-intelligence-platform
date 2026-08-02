/*
 * Card Viewer Model
 *
 * Normalises an existing successful Card Lab/database record for Card Viewer.
 * This layer never runs a PM3 command. Protected fields, key values and sector
 * results are surfaced only after an existing authorized read reports success.
 */
(function(){
  function text(value){ return String(value ?? ""); }
  function clean(value){ return text(value).trim(); }
  function list(value){ return Array.isArray(value) ? value : []; }
  function cleanUid(value){
    const hex=text(value).toUpperCase().replace(/[^0-9A-F]/g,"");
    if(!hex || hex.length%2) return clean(value) || "Not reported";
    return hex.match(/.{2}/g).join(":");
  }
  const FIELD_GROUPS=[
    {id:"technical",label:"Technical read details"},
    {id:"personal",label:"Personal information"},
    {id:"employment",label:"Employment"},
    {id:"validity",label:"Validity"},
    {id:"stored-value",label:"Stored value"},
    {id:"application",label:"Application data"},
    {id:"access",label:"Access"},
    {id:"other",label:"Other data"}
  ];
  const CATEGORY_BY_KEY={
    atqa:"technical",sak:"technical",ats:"technical",
    name:"personal",firstname:"personal",lastname:"personal",email:"personal",dateofbirth:"personal",
    department:"employment",role:"employment",employeenumber:"employment",
    issuedate:"validity",validfrom:"validity",expirydate:"validity",status:"validity",
    balance:"stored-value",currency:"stored-value",
    issuer:"application",cardnumber:"application",application:"application",ndeftext:"application",ndefurl:"application",
    paymentnetwork:"application",applicationlabel:"application",applicationpreferredname:"application",applicationaid:"application",applicationcount:"application",applicationaidlist:"application",applicationlist:"application",applicationpriority:"application",accountreference:"application",expirymonthyear:"validity",effectivedate:"validity",emvlanguage:"application",emvcurrency:"application",issuercountry:"application",applicationversion:"application",aipcapabilities:"application",track2presence:"application",panpresence:"application",transactionlogpresence:"application",
    room:"access",checkin:"access",checkout:"access",access:"access"
  };
  function categoryFor(field){
    const supplied=clean(field?.category).toLowerCase();
    if(FIELD_GROUPS.some(group=>group.id===supplied)) return supplied;
    const id=clean(field?.key || field?.label).toLowerCase().replace(/[^a-z0-9]/g,"");
    return CATEGORY_BY_KEY[id] || "other";
  }
  function normalisedFieldValue(field){
    const id=clean(field?.key || field?.label).toLowerCase().replace(/[^a-z0-9]/g,"");
    return ["atqa","sak","ats"].includes(id) ? technicalHex(field?.value) : clean(field?.value);
  }
  function uniqueFields(fields){
    const seen=new Set();
    return list(fields).filter(field=>{
      if(!field || field.exposed===false || !normalisedFieldValue(field)) return false;
      const id=clean(field.key || field.label).toLowerCase();
      if(!id || seen.has(id) || ["uid","type","cardtype"].includes(id.replace(/[^a-z]/g,""))) return false;
      seen.add(id);
      return true;
    }).map(field=>({
      key:clean(field.key || field.label),
      label:clean(field.label || field.key || "Field"),
      value:normalisedFieldValue(field),
      category:categoryFor(field),
      source:clean(field.source || "read-data"),
      authentication:clean(field.authentication || "not-reported")
    }));
  }
  function groupFields(fields){
    return FIELD_GROUPS.map(group=>({
      id:group.id,
      label:group.label,
      fields:list(fields).filter(field=>categoryFor(field)===group.id)
    })).filter(group=>group.fields.length);
  }
  function fieldValue(fields,keys){
    const wanted=new Set(keys.map(value=>clean(value).toLowerCase().replace(/[^a-z0-9]/g,"")));
    const match=list(fields).find(field=>wanted.has(clean(field?.key || field?.label).toLowerCase().replace(/[^a-z0-9]/g,"")) && clean(field?.value));
    return clean(match?.value);
  }
  function technicalHex(value){
    if(typeof value==="boolean" || value===null || value===undefined) return "";
    const candidate=clean(value);
    return candidate && /^(?:0x)?[0-9a-f]+(?:[ :.-]+(?:0x)?[0-9a-f]+)*$/i.test(candidate) ? candidate.toUpperCase() : "";
  }
  function signatureTechnicalFields(signature,result){
    const parsed=result?.parsed || {};
    return [
      {key:"atqa",label:"ATQA",value:technicalHex(signature?.atqa || parsed.atqa),category:"technical"},
      {key:"sak",label:"SAK",value:technicalHex(signature?.sak || parsed.sak),category:"technical"},
      {key:"ats",label:"ATS",value:technicalHex(signature?.ats || parsed.ats),category:"technical"}
    ].filter(field=>field.value).map(field=>({...field,exposed:true,source:"stored card signature",authentication:"not-required-or-not-reported"}));
  }
  function sectorNumber(command){
    const match=clean(command).match(/(?:^|\s)-s\s+(\d+)(?:\s|$)/i);
    return match ? Number(match[1]) : null;
  }
  function groupSectors(commands){
    const rows=list(commands).map(item=>({sector:sectorNumber(item?.command),ok:item?.ok===true})).filter(item=>Number.isInteger(item.sector)).sort((a,b)=>a.sector-b.sector);
    const groups=[];
    for(const row of rows){
      const last=groups[groups.length-1];
      if(last && last.ok===row.ok && row.sector===last.end+1) last.end=row.sector;
      else groups.push({start:row.sector,end:row.sector,ok:row.ok});
    }
    return groups.map(group=>({
      label:`Sector ${group.start}${group.end===group.start?"":`–${group.end}`}`,
      status:group.ok?"readable":"not-confirmed",
      detail:group.ok?"Authenticated read succeeded":"Authentication was not confirmed; no sector data is shown"
    }));
  }
  function explicitAccessRows(access){
    return list(access).map(item=>({
      label:clean(item?.label || "Authenticated access"),
      status:clean(item?.status || "authenticated"),
      detail:clean(item?.detail || "Authentication evidence was stored by the completed read")
    })).filter(item=>item.label && item.detail);
  }
  function cleanKeyMaterial(value){
    const material=clean(value).replace(/[^0-9A-F]/gi,"").toUpperCase();
    return /^(?:[0-9A-F]{12}|[0-9A-F]{16}|[0-9A-F]{32}|[0-9A-F]{48})$/.test(material) ? material : "";
  }
  function sectorValue(value){
    if(value === null || value === undefined || clean(value) === "") return null;
    return Number.isInteger(Number(value)) ? Number(value) : null;
  }
  function explicitKeyLines(output){
    const found=[];
    const pattern=/(?:^|\n)\s*(?:\[.\]\s*)?Sector\s+(\d+)\s+Key\s*([AB])\s*[:=]\s*([0-9A-Fa-f]{12}|[0-9A-Fa-f]{16}|[0-9A-Fa-f]{32}|[0-9A-Fa-f]{48})(?:\s*\(([^\r\n)]+)\))?/gim;
    for(const match of text(output).matchAll(pattern)){
      found.push({sector:Number(match[1]),keySlot:match[2].toUpperCase(),keyMaterial:match[3],note:clean(match[4]),source:"successful authorized-read output"});
    }
    return found;
  }
  function keyLabel(item){
    const sector=sectorValue(item?.sector);
    if(sector !== null && /^[AB]$/i.test(clean(item?.keySlot))) return `Sector ${sector} Key ${clean(item.keySlot).toUpperCase()}`;
    if(Array.isArray(item?.sectors) && item.sectors.length) return `Sectors ${item.sectors.join(", ")} · authorized key`;
    return clean(item?.label || item?.keyType || "Authorized key");
  }
  function successfulKeys(keys,authorizedRead,readableData){
    if(authorizedRead?.status!=="success") return [];
    const explicit=[...list(authorizedRead.keys),...list(readableData?.keys),...explicitKeyLines(authorizedRead.output)];
    const matching=list(keys).filter(item=>item?.hasKeyMaterial && (!authorizedRead.keyId || item.id===authorizedRead.keyId));
    const candidates=[...explicit,...matching.map(item=>({...item,source:"stored authorized key + successful read"}))];
    const seen=new Set();
    return candidates.map(item=>{
      const material=cleanKeyMaterial(item.keyMaterial || item.value || item.key);
      const sector=sectorValue(item.sector);
      const keySlot=/^[AB]$/i.test(clean(item.keySlot || item.slot)) ? clean(item.keySlot || item.slot).toUpperCase() : "";
      const noteParts=[];
      if(/^F{12}$/.test(material) || /\bdefault\b/i.test(clean(item.note))) noteParts.push("default key");
      noteParts.push("authentication confirmed");
      return {
        label:keyLabel({...item,sector,keySlot}),
        type:keySlot ? `Key ${keySlot}` : clean(item.keyType || "Authorized key"),
        value:material,
        note:noteParts.join(" · "),
        source:clean(item.source || "structured successful authorized read"),
        sector,
        keySlot
      };
    }).filter(item=>{
      if(!item.value) return false;
      const id=`${item.sector ?? ""}:${item.keySlot}:${item.value}`;
      if(seen.has(id)) return false;
      seen.add(id);
      return true;
    });
  }
  function sourceParts(source){
    const intelligence=source?.cardIntelligence || source?.intelligence || {};
    const signature=source?.cardSignature || source?.signature || intelligence.signature || {};
    const result=source?.result || {};
    const scan=source?.scan || source?.scanRecord || {};
    const readableData=source?.readableData || intelligence.readableData || scan.readableData || {};
    const authorizedRead=source?.authorizedRead || intelligence.authorizedRead || null;
    const authorizedKeys=source?.authorizedKeys || intelligence.authorizedKeys || [];
    const familyAnalyses=source?.familyAnalyses || intelligence.familyAnalyses || [];
    return {intelligence,signature,result,scan,readableData,authorizedRead,authorizedKeys,familyAnalyses};
  }
  function emvReadCoverage(familyAnalyses){
    const analysis=list(familyAnalyses).find(item=>
      item?.status==="completed" &&
      item?.rawOutputStored===false &&
      clean(item?.profile?.id).toLowerCase()==="emv"
    );
    if(!analysis) return null;
    const diagnosticFields=list(analysis.emvDiagnostics?.fields);
    const metadataFields=list(analysis.metadataFields);
    const metadata=analysis.metadata || {};
    const fieldPresent=key=>metadataFields.some(item=>clean(item?.key)===key && clean(item?.value));
    const fallbackDetected={
      pan:metadata.panPresent===true || fieldPresent("accountReference") || fieldPresent("panPresence"),
      track2:metadata.track2Present===true || fieldPresent("track2Presence"),
      expiry:fieldPresent("expiryMonthYear"),
      issuerCountry:fieldPresent("issuerCountry")
    };
    const definitions=[
      {key:"pan",label:"Card number (PAN)",found:"Detected; only the last four digits are retained.",missing:"Not reported by this read. An IBAN is a bank-account identifier, not the EMV card PAN."},
      {key:"expiry",label:"Expiry",found:"Detected; only the month and year are retained.",missing:"Not reported by this read."},
      {key:"issuerCountry",label:"Issuer country",found:"Detected as EMV issuer-country metadata.",missing:"Not reported by this read. Electron does not infer issuer country from a payment network or IBAN."},
      {key:"track2",label:"Track 2 data",found:"Detected; the full value is never stored.",missing:"Not reported by this read."}
    ];
    const safeCommand=value=>{
      const command=clean(value);
      return /^emv\s+(?:pse|search|reader)\b/i.test(command) ? command.slice(0,80) : "";
    };
    const commandsChecked=list(analysis.emvDiagnostics?.commandsChecked).map(safeCommand).filter(Boolean);
    const fallbackCommands=list(analysis.commands).map(item=>safeCommand(item?.command)).filter(Boolean);
    return {
      detailed:diagnosticFields.length>0,
      parserVersion:clean(analysis.emvDiagnostics?.parserVersion),
      commandsChecked:commandsChecked.length ? commandsChecked : fallbackCommands,
      fields:definitions.map(definition=>{
        const diagnostic=diagnosticFields.find(item=>clean(item?.key)===definition.key);
        const detected=diagnostic ? diagnostic.detected===true : fallbackDetected[definition.key]===true;
        return {
          key:definition.key,
          label:definition.label,
          detected,
          detail:detected ? definition.found : definition.missing,
          commands:list(diagnostic?.commands).map(safeCommand).filter(Boolean)
        };
      })
    };
  }
  function build(source){
    if(!source) return {available:false,reason:"No successful card read is stored yet."};
    const {intelligence,signature,result,scan,readableData,authorizedRead,authorizedKeys,familyAnalyses}=sourceParts(source);
    const identified=source.status==="ready" || result.status==="identified" || !!scan.createdAt || !!source.capturedAt || !!signature.signatureId;
    if(!identified) return {available:false,reason:"The available card data has not been confirmed as a successful read."};
    const authSuccess=authorizedRead?.status==="success";
    const analysisFields=list(familyAnalyses).filter(item=>item?.status==="completed" && item?.rawOutputStored===false).flatMap(item=>list(item?.metadataFields));
    const fields=uniqueFields([...list(readableData.fields),...analysisFields,...signatureTechnicalFields(signature,result)]).filter(field=>!["authenticated","authentication-required"].includes(field.authentication) || authSuccess);
    const storedAccess=explicitAccessRows(authorizedRead?.access);
    const access=authSuccess ? (storedAccess.length ? storedAccess : groupSectors(authorizedRead.commands)) : [];
    if(authSuccess && !access.length && Number(authorizedRead.stats?.totalSectors)>0){
      access.push({
        label:"Authenticated sectors",
        status:"summary",
        detail:`${Number(authorizedRead.stats?.readableSectors || 0)} of ${Number(authorizedRead.stats.totalSectors)} sectors were read successfully`
      });
    }
    const explicitType=fieldValue(readableData.fields,["cardType","credentialType","cardSubtype"]);
    const type=clean(explicitType || signature.displayName || result.module?.displayName || source.displayName || "Unknown card type");
    const uid=cleanUid(signature.uid || result.parsed?.uid || scan.uid || "");
    const capturedAt=clean(source.updatedAt || source.scanAt || scan.createdAt || source.capturedAt || authorizedRead?.createdAt || "");
    const sourceLabel=clean(source.sourceLabel || scan.sourceLabel || scan.source || source.source || "Stored successful read");
    return {
      available:true,
      type,
      uid,
      capturedAt,
      sourceLabel,
      readStatus:authSuccess?"Authenticated read successful":"Read successful",
      authentication:{
        confirmed:authSuccess,
        label:authSuccess?"Valid authentication confirmed":"No successful protected-data authentication is attached",
        detail:authSuccess?clean(authorizedRead.message || "Protected data was accepted only after the stored read succeeded."):"Publicly exposed data may still be shown. Protected fields and keys remain hidden."
      },
      fields,
      fieldGroups:groupFields(fields),
      emvReadCoverage:emvReadCoverage(familyAnalyses),
      keys:successfulKeys(authorizedKeys,authorizedRead,readableData),
      access,
      knownByYou:intelligence.knownByYou || source.knownByYou || null,
      notice:"Card Viewer normalises stored read results. Separately started test workflows are kept outside this stored-data model."
    };
  }

  window.CardViewerModel={build,cleanUid,groupFields,groupSectors,explicitAccessRows,signatureTechnicalFields,successfulKeys,technicalHex,emvReadCoverage};
})();
