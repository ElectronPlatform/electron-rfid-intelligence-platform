/*
 * Electron Deep Scan Profile Registry
 *
 * Pure card-family detection and command planning for Card Viewer Deep Scan.
 * The registry does not access the DOM, run PM3 commands or persist results.
 */
(function(root,factory){
  const api=factory();
  if(typeof module!=="undefined" && module.exports) module.exports=api;
  if(root) root.DeepScanProfileRegistry=api;
})(typeof window!=="undefined" ? window : globalThis,function(){
  const VERSION="1.5.0";
  const DEFAULT_TIMEOUT_MS=45000;

  function text(value){ return String(value ?? ""); }
  function detectedSak(evidence){
    return text(evidence).match(/\bSAK\s*:\s*(?:0x)?([0-9A-F]{2})\b/i)?.[1]?.toUpperCase() || "";
  }
  function classicSizeFlag(evidence){
    const value=text(evidence);
    const sak=detectedSak(value);
    if(/MIFARE\s+(?:Classic\s+)?Mini|\bS20\b/i.test(value) || sak==="09") return "--mini";
    if(/MIFARE\s+(?:Classic\s+)?4K|\bS70\b/i.test(value) || sak==="18") return "--4k";
    if(/MIFARE\s+(?:Classic\s+)?2K/i.test(value)) return "--2k";
    return "--1k";
  }
  function normalizeStep(value,defaults={}){
    const source=typeof value==="string" ? {command:value} : (value || {});
    const command=text(source.command).trim();
    return {
      id:text(source.id || command).trim().toLowerCase().replace(/[^a-z0-9]+/g,"-").replace(/^-|-$/g,""),
      command,
      displayCommand:text(source.displayCommand || command).trim(),
      phase:source.phase || defaults.phase || "read",
      timeoutMs:Number(source.timeoutMs || defaults.timeoutMs || DEFAULT_TIMEOUT_MS),
      riskLevel:source.riskLevel || defaults.riskLevel || "low",
      parserId:source.parserId || defaults.parserId || "plain-output",
      label:source.label || defaults.label || command,
      prerequisites:[...(source.prerequisites || defaults.prerequisites || [])],
      successEvidence:[...(source.successEvidence || defaults.successEvidence || [])],
      failureEvidence:[...(source.failureEvidence || defaults.failureEvidence || [])],
      continueOnFailure:source.continueOnFailure ?? defaults.continueOnFailure ?? true,
      stopCondition:source.stopCondition || defaults.stopCondition || "",
      keyContext:source.keyContext || defaults.keyContext || null
    };
  }
  function step(id,command,phase,options={}){
    return normalizeStep({id,command,phase,...options});
  }
  function normalizeInput(input){
    if(typeof input==="string" || input==null){
      const evidence=text(input);
      return {evidence,baseEvidence:evidence,resultEvidence:"",sak:detectedSak(evidence),results:[]};
    }
    const results=(Array.isArray(input.results)?input.results:[]).map(item=>({
      command:text(item?.command),
      ok:!!item?.result?.ok,
      output:text(item?.result?.stdout)+text(item?.result?.stderr)
    }));
    const baseEvidence=text(input.evidence || input.text);
    const resultEvidence=results.map(item=>item.output).filter(Boolean).join("\n");
    const evidence=[baseEvidence,resultEvidence].filter(Boolean).join("\n");
    return {evidence,baseEvidence,resultEvidence,sak:detectedSak(evidence),results};
  }
  function commandResult(context,command){
    return [...context.results].reverse().find(item=>item.command===command) || null;
  }
  function positiveResult(context,command,pattern){
    const result=commandResult(context,command);
    if(!result?.ok || !pattern.test(result.output)) return false;
    return !/(?:not available|not found|not detected|failed|failure|timeout|timed out|wrong card|no response)/i.test(result.output);
  }
  function scoreText(context,pattern,score){ return pattern.test(context.baseEvidence || context.evidence) ? score : 0; }
  function scoreSuccessfulSearch(context,pattern,score){
    const positiveLines=context.results.filter(item=>item.ok && /^(?:hf|lf) search$/i.test(item.command)).flatMap(item=>item.output.split(/\r?\n/)).filter(line=>/\[\+\]/.test(line) && !/(?:not found|not detected|failed|failure|no response)/i.test(line));
    return pattern.test(positiveLines.join("\n")) ? score : 0;
  }
  function highest(...values){ return Math.max(0,...values.map(value=>Number(value || 0))); }
  function resolved(value,context){ return typeof value==="function" ? value(context) : value; }
  function discoveryStepsForBand(band){
    if(band==="lf") return [step("lf-search","lf search","discovery",{parserId:"lf-search"})];
    const values=[step("hf-search","hf search","discovery",{parserId:"hf-search"})];
    if(band==="hf-14a") values.push(step("hf-14a-info","hf 14a info","identification",{parserId:"iso14443a"}));
    return values;
  }
  function sak20ClassificationSteps(){
    const options={phase:"classification",riskLevel:"low",continueOnFailure:true,prerequisites:["sak-20-or-iso14443-4"]};
    return [
      step("classify-mifare-plus","hf mfp info",options.phase,{...options,parserId:"mifare-plus",successEvidence:["Result... MIFARE Plus","Tech..... MIFARE Plus"]}),
      step("classify-desfire","hf mfdes info",options.phase,{...options,parserId:"mifare-desfire",successEvidence:["Product type","Hardware Information"]}),
      step("classify-emv","emv pse -s2",options.phase,{...options,parserId:"emv",successEvidence:["2PAY.SYS.DDF01","1PAY.SYS.DDF01","APDU response status: 9000"]}),
      step("classify-seos","hf seos info",options.phase,{...options,parserId:"seos",successEvidence:["Selected ADF","Diversifier"]})
    ];
  }
  function classicSteps(context){
    const size=classicSizeFlag(context.evidence);
    return [
      step("classic-info","hf mf info","public-read",{parserId:"mifare-classic"}),
      step("classic-key-check",`hf mf chk ${size}`,"key-check",{riskLevel:"medium",parserId:"mifare-classic-keys"}),
      step("classic-dump",`hf mf dump ${size}`,"authenticated-read",{riskLevel:"medium",parserId:"mifare-classic-dump",prerequisites:["valid-sector-keys"]})
    ];
  }
  function classicSectorCount(size){
    return size==="--mini"?5:size==="--2k"?32:size==="--4k"?40:16;
  }
  function firstBlockForSector(sector){
    const value=Math.max(0,Number(sector)||0);
    return value<32 ? value*4 : 128+((value-32)*16);
  }
  function normalizedRecoveryKeys(keys){
    const seen=new Set();
    return (Array.isArray(keys)?keys:[]).map(item=>{
      const directSlot=text(item?.keySlot || item?.slot).trim();
      const keySlot=/^[AB]$/i.test(directSlot) ? directSlot.toUpperCase() : (text(item?.type || item?.label).match(/\bKey\s*([AB])\b/i)?.[1]?.toUpperCase() || "");
      return {
        sector:Number(item?.sector),
        keySlot,
        keyMaterial:text(item?.keyMaterial || item?.value || item?.key).replace(/[^0-9A-F]/gi,"").toUpperCase()
      };
    }).filter(item=>Number.isInteger(item.sector) && /^[AB]$/.test(item.keySlot) && /^[0-9A-F]{12}$/.test(item.keyMaterial)).filter(item=>{
      const id=`${item.sector}:${item.keySlot}:${item.keyMaterial}`;
      if(seen.has(id)) return false;
      seen.add(id);
      return true;
    });
  }
  function workflowBase(profile,overrides={}){
    return {
      supported:true,
      profileId:profile.id,
      profileLabel:profile.label,
      workflowType:"extended-analysis",
      eyebrow:"Family-specific workflow",
      title:"Extended Analysis",
      description:"Runs a bounded read-only analysis for the detected card family.",
      privacyClass:profile.privacyClass || "standard",
      persistPolicy:"metadata-only",
      confirmationCount:2,
      familyCheckSteps:[],
      strategies:[],
      ...overrides
    };
  }
  function normalizedCredentials(state={}){
    const candidates=[...(Array.isArray(state.credentials)?state.credentials:[]),...(Array.isArray(state.keys)?state.keys:[])];
    return candidates.map(item=>({
      ...item,
      family:text(item?.family || item?.profileId || item?.cardFamily || item?.keyType).toLowerCase(),
      keyMaterial:text(item?.keyMaterial || item?.value || item?.key).replace(/[^0-9A-F]/gi,"").toUpperCase(),
      algorithm:text(item?.algorithm || item?.algo || item?.keyAlgorithm).trim().toUpperCase(),
      keyNumber:Number(item?.keyNumber ?? item?.keyNo ?? item?.keyno),
      aid:text(item?.aid || item?.applicationId).replace(/[^0-9A-F]/gi,"").toUpperCase(),
      fileId:text(item?.fileId || item?.fid).replace(/[^0-9A-F]/gi,"").toUpperCase(),
      sector:Number(item?.sector),
      length:Number(item?.length || item?.readLength || 256)
    }));
  }
  function desfireCredential(state={}){
    const allowedAlgorithms={DES:16,"2TDEA":32,"3TDEA":48,AES:32};
    return normalizedCredentials(state).find(item=>
      /desfire|application key/i.test(item.family) &&
      allowedAlgorithms[item.algorithm]===item.keyMaterial.length &&
      Number.isInteger(item.keyNumber) && item.keyNumber>=0 && item.keyNumber<=13 &&
      /^[0-9A-F]{6}$/.test(item.aid) && /^[0-9A-F]{2}$/.test(item.fileId)
    ) || null;
  }
  function mifarePlusCredential(state={}){
    return normalizedCredentials(state).find(item=>
      /mifare.?plus|\bmfp\b|application key/i.test(item.family) &&
      /^[0-9A-F]{32}$/.test(item.keyMaterial) && Number.isInteger(item.sector) && item.sector>=0 && item.sector<=39
    ) || null;
  }
  function classicAdvancedWorkflowPlan(profile,state={}){
    const size=classicSizeFlag(`${profile?.evidence || ""}\n${profile?.label || ""}`);
    const totalSectors=classicSectorCount(size);
    const keys=normalizedRecoveryKeys(state.keys);
    const known=keys[0] || null;
    const knownSlots=new Set(keys.map(item=>`${item.sector}:${item.keySlot}`));
    let target=null;
    for(let sector=0;sector<totalSectors && !target;sector++){
      for(const keySlot of ["A","B"]){
        if(!knownSlots.has(`${sector}:${keySlot}`)){ target={sector,keySlot}; break; }
      }
    }
    const missingKeySlots=Math.max(0,(totalSectors*2)-knownSlots.size);
    const keyFlag=known?.keySlot==="B"?"-b":"-a";
    const targetFlag=target?.keySlot==="B"?"--tb":"--ta";
    const verify=()=>step("recovery-key-check",`hf mf chk ${size} --dump`,"verification",{label:"Verify recovered keys and save the confirmed key file",timeoutMs:120000,riskLevel:"medium",parserId:"mifare-classic-keys",successEvidence:["key A","key B"]});
    const dump=()=>step("recovery-authenticated-dump",`hf mf dump ${size}`,"authenticated-read",{label:"Authenticated dump",timeoutMs:120000,riskLevel:"medium",parserId:"mifare-classic-dump",prerequisites:["verified-valid-keys"],successEvidence:["Succeeded in dumping all blocks"]});
    const strategies=[
      {
        id:"dictionary",label:"Dictionary key check",riskLevel:"medium",timeoutMs:120000,available:missingKeySlots>0,
        description:"Checks the PM3 key dictionaries, then attempts an authenticated dump only when valid keys are confirmed.",
        unavailableReason:missingKeySlots?"":"All expected key slots are already represented in the stored read.",
        steps:[verify(),dump()]
      },
      {
        id:"darkside",label:"Darkside recovery",riskLevel:"high",timeoutMs:180000,available:missingKeySlots>0 && !known,
        description:"Attempts to recover the first MIFARE Classic key when no valid key is currently available.",
        unavailableReason:known?"A valid key is already available; Nested is the more appropriate next strategy.":missingKeySlots?"":"No missing key slots were detected.",
        steps:[
          step("recovery-darkside","hf mf darkside","recovery",{label:"Darkside key recovery",timeoutMs:180000,riskLevel:"high",parserId:"mifare-classic-recovery",keyContext:{sector:0,keySlot:"A"},successEvidence:["Found valid key"]}),
          verify(),dump()
        ]
      },
      {
        id:"nested",label:"Nested recovery",riskLevel:"high",timeoutMs:300000,available:missingKeySlots>0 && !!known,
        description:"Uses one already authenticated sector key to recover missing MIFARE Classic keys.",
        unavailableReason:known?missingKeySlots?"":"No missing key slots were detected.":"Nested requires at least one valid known key.",
        steps:known?[
          step("recovery-nested",`hf mf nested ${size} --blk ${firstBlockForSector(known.sector)} ${keyFlag} -k ${known.keyMaterial} --dump`,"recovery",{displayCommand:`hf mf nested ${size} --blk ${firstBlockForSector(known.sector)} ${keyFlag} -k <authorized-key> --dump`,label:"Nested key recovery",timeoutMs:300000,riskLevel:"high",parserId:"mifare-classic-recovery",successEvidence:["found key","key A","key B"]}),
          verify(),dump()
        ]:[]
      },
      {
        id:"hardnested",label:"Hardnested recovery",riskLevel:"high",timeoutMs:600000,available:missingKeySlots>0 && !!known && !!target,
        description:"Targets one missing key using a known key when ordinary Nested recovery is insufficient.",
        unavailableReason:known?target?"":"No missing target key was found.":"Hardnested requires at least one valid known key.",
        steps:known&&target?[
          step("recovery-hardnested",`hf mf hardnested --blk ${firstBlockForSector(known.sector)} ${keyFlag} -k ${known.keyMaterial} --tblk ${firstBlockForSector(target.sector)} ${targetFlag}`,"recovery",{displayCommand:`hf mf hardnested --blk ${firstBlockForSector(known.sector)} ${keyFlag} -k <authorized-key> --tblk ${firstBlockForSector(target.sector)} ${targetFlag}`,label:"Hardnested key recovery",timeoutMs:600000,riskLevel:"high",parserId:"mifare-classic-recovery",keyContext:target,successEvidence:["found key"]}),
          verify(),dump()
        ]:[]
      },
      {
        id:"brute",label:"Smart brute-force",riskLevel:"high",timeoutMs:600000,available:missingKeySlots>0,
        description:"Runs the PM3 smart key-generator brute-force strategy for the detected card size.",
        unavailableReason:missingKeySlots?"":"No missing key slots were detected.",
        steps:[
          step("recovery-brute",`hf mf brute ${size} --dump`,"recovery",{label:"Smart brute-force",timeoutMs:600000,riskLevel:"high",parserId:"mifare-classic-recovery",successEvidence:["found key","key A","key B"]}),
          verify(),dump()
        ]
      },
      {
        id:"autopwn",label:"Automatic key recovery",riskLevel:"high",timeoutMs:600000,available:missingKeySlots>0,
        description:"Lets the PM3 client choose among its MIFARE Classic key-recovery methods and then verifies the result.",
        unavailableReason:missingKeySlots?"":"No missing key slots were detected.",
        steps:[
          step("recovery-autopwn",`hf mf autopwn ${size}${known?` -s ${known.sector} ${keyFlag} -k ${known.keyMaterial}`:""}`,"recovery",{displayCommand:`hf mf autopwn ${size}${known?` -s ${known.sector} ${keyFlag} -k <authorized-key>`:""}`,label:"Automatic key recovery",timeoutMs:600000,riskLevel:"high",parserId:"mifare-classic-recovery",successEvidence:["found key","key A","key B","Succeeded in dumping"]}),
          verify(),dump()
        ]
      }
    ];
    return workflowBase(profile,{workflowType:"recovery",eyebrow:"High-risk workflow",title:"Advanced Recovery",description:"Runs separately selected MIFARE Classic recovery strategies only when their prerequisites are met.",persistPolicy:"authenticated-data",size,totalSectors,knownKeyCount:keys.length,missingKeySlots,target,familyCheckSteps:[step("confirm-classic","hf mf info","family-check",{parserId:"mifare-classic",successEvidence:["MIFARE Classic","Prng","Magic capabilities"]})],strategies});
  }
  function advancedWorkflowPlan(profileValue,state={}){
    const profile=typeof profileValue==="string" ? detect(profileValue) : profileValue;
    if(!profile?.id) return {supported:false,reason:"No detected card family is available for an advanced workflow.",strategies:[]};
    if(profile.id==="mifare-classic") return classicAdvancedWorkflowPlan(profile,state);
    if(profile.id==="emv"){
      return workflowBase(profile,{
        title:"EMV Extended Analysis",description:"Performs a deeper read-only EMV application analysis. Full PAN, Track 1/2, cardholder names, verification values and transaction-log contents are never shown or stored.",privacyClass:"sensitive",persistPolicy:"metadata-only",
        familyCheckSteps:[step("confirm-emv-pse","emv pse -st2","family-check",{label:"Confirm and decode the public PPSE directory",parserId:"emv",successEvidence:["2PAY.SYS.DDF01","1PAY.SYS.DDF01","PPSE","APDU response status: 9000"]})],
        strategies:[{
          id:"emv-analysis",label:"Deep public EMV analysis",riskLevel:"medium",timeoutMs:120000,available:true,
          description:"Discovers public payment applets and performs the client's integrated verbose reader pass. The card is not written, and only redacted metadata is retained.",
          steps:[
            step("emv-search","emv search -st","public-read",{label:"Discover and decode public EMV applets",timeoutMs:60000,parserId:"emv",successEvidence:["Search completed","AID","Application Label"]}),
            step("emv-reader-verbose","emv reader -v","public-read",{label:"Read public EMV application metadata",timeoutMs:120000,riskLevel:"medium",parserId:"emv",successEvidence:["AID","Application","Label","PAN","Track 2"]})
          ]
        }]
      });
    }
    if(profile.id==="seos"){
      return workflowBase(profile,{
        title:"Extended Analysis",description:"Requests only the unauthenticated SEOS information response. Credential output is not stored.",privacyClass:"sensitive",persistPolicy:"metadata-only",
        familyCheckSteps:[step("confirm-seos","hf seos info","family-check",{parserId:"seos",successEvidence:["Selected ADF","Plaintext ADF","Diversifier"]})],
        strategies:[{id:"seos-info",label:"SEOS public information",riskLevel:"low",timeoutMs:45000,available:true,description:"Runs the unauthenticated SEOS information command and retains only redacted execution metadata.",steps:[step("seos-info","hf seos info","public-read",{parserId:"seos",successEvidence:["Selected ADF","Plaintext ADF","Diversifier"]})]}]
      });
    }
    if(profile.id==="desfire"){
      const credential=desfireCredential(state);
      const length=Math.max(1,Math.min(256,Math.floor(credential?.length || 256)));
      const lengthHex=length.toString(16).toUpperCase().padStart(6,"0");
      const read=credential?step("desfire-bounded-read",`hf mfdes read --aid ${credential.aid} --fid ${credential.fileId} -n ${credential.keyNumber} -t ${credential.algorithm} -k ${credential.keyMaterial} --length ${lengthHex}`,"authenticated-read",{displayCommand:`hf mfdes read --aid ${credential.aid} --fid ${credential.fileId} -n ${credential.keyNumber} -t ${credential.algorithm} -k <authorized-key> --length ${lengthHex}`,timeoutMs:90000,riskLevel:"medium",parserId:"mifare-desfire",prerequisites:["authorized-key","exact-aid","exact-file-id"],successEvidence:["Data","File","Read"]}):null;
      return workflowBase(profile,{
        workflowType:"authenticated-read",title:"Authenticated Read",description:"Reads one explicitly targeted DESFire file with an already stored authorized key. Electron never guesses an AID, file ID or key setting.",persistPolicy:"authenticated-data",
        familyCheckSteps:[step("confirm-desfire","hf mfdes info","family-check",{parserId:"mifare-desfire",successEvidence:["Product type","Hardware Information","DESFire EV"]})],
        strategies:[{id:"desfire-bounded-read",label:"Bounded DESFire file read",riskLevel:"medium",timeoutMs:90000,available:!!credential,description:"Reads at most 256 bytes from the exact authorized application and file target.",unavailableReason:"Add an authorized DESFire key with algorithm, key number, six-hex AID and two-hex file ID before this read can run.",target:credential?`AID ${credential.aid} · file ${credential.fileId} · ${length} bytes`:"",steps:read?[read]:[]}]
      });
    }
    if(profile.id==="mifare-plus"){
      const credential=mifarePlusCredential(state);
      const read=credential?step("mfp-bounded-read",`hf mfp rdsc -s ${credential.sector} --key ${credential.keyMaterial}`,"authenticated-read",{displayCommand:`hf mfp rdsc -s ${credential.sector} --key <authorized-key>`,timeoutMs:90000,riskLevel:"medium",parserId:"mifare-plus",prerequisites:["authorized-aes-key","exact-sector"],successEvidence:["Block","Sector","data"]}):null;
      return workflowBase(profile,{
        workflowType:"authenticated-read",title:"Authenticated Read",description:"Reads one explicitly targeted MIFARE Plus sector with an already stored authorized AES key.",persistPolicy:"authenticated-data",
        familyCheckSteps:[step("confirm-mfp","hf mfp info","family-check",{parserId:"mifare-plus",successEvidence:["MIFARE Plus","SL mode"]})],
        strategies:[{id:"mfp-bounded-read",label:"Bounded MIFARE Plus sector read",riskLevel:"medium",timeoutMs:90000,available:!!credential,description:"Reads only the selected sector with the supplied authorized AES key.",unavailableReason:"Add an authorized 16-byte MIFARE Plus AES key and an exact sector number before this read can run.",target:credential?`Sector ${credential.sector}`:"",steps:read?[read]:[]}]
      });
    }
    return {supported:false,profileId:profile.id,profileLabel:profile.label,reason:`No separate advanced read-only workflow is defined for ${profile.label}.`,strategies:[]};
  }
  function advancedRecoveryPlan(profileValue,state={}){
    const plan=advancedWorkflowPlan(profileValue,state);
    return plan.workflowType==="recovery" ? plan : {supported:false,profileId:plan.profileId,profileLabel:plan.profileLabel,reason:"Advanced Recovery is currently available only for MIFARE Classic cards.",strategies:[]};
  }

  const PROFILE_DEFINITIONS=[
    {
      id:"iso15693",label:"ISO15693 / NFC Type 5",band:"hf",protocols:["iso15693","nfc-v"],confidence:90,parserId:"iso15693",
      score:c=>{
        const explicitStoredEvidence=/ISO\s*15693|NFC\s*Type\s*5|Vicinity|ICODE|i-code/i.test(c.baseEvidence) ? 90 : 0;
        const search=commandResult(c,"hf search");
        if(search && positiveResult(c,"hf search",/(?:(?:ISO\s*15693|NFC\s*Type\s*5|ICODE)[^\r\n]{0,80}(?:tag|card)?\s*(?:found|detected)|(?:found|detected)[^\r\n]{0,80}(?:ISO\s*15693|NFC\s*Type\s*5|ICODE))/i)) return 98;
        const probe=["hf 15 info","hf 15 reader","hf 15 dump"].map(command=>commandResult(c,command)).find(Boolean);
        if(probe && probe.ok && /(?:UID|Tag Info|System Info|DSFID|AFI|IC reference|ICODE)/i.test(probe.output) && !/(?:not found|not detected|failed|failure|timeout|timed out|no response)/i.test(probe.output)) return 100;
        if(probe) return 0;
        return explicitStoredEvidence;
      },
      steps:["hf 15 info","hf 15 reader","hf 15 dump"]
    },
    {id:"felica",label:"FeliCa / NFC-F",band:"hf",protocols:["felica","nfc-f","iso18092"],confidence:90,parserId:"felica",score:c=>highest(scoreText(c,/FeliCa|NFC-?F|ISO\s*18092/i,90),scoreSuccessfulSearch(c,/FeliCa|NFC-?F|ISO\s*18092/i,98)),steps:["hf felica info","hf felica reader","hf felica dump"]},
    {id:"iclass",label:"HID iCLASS / PicoPass",band:"hf",protocols:["picopass","iclass"],confidence:90,parserId:"iclass",score:c=>highest(scoreText(c,/iCLASS|PicoPass/i,90),scoreSuccessfulSearch(c,/iCLASS|PicoPass/i,98)),steps:["hf iclass info","hf iclass reader"]},
    {id:"mfu",label:"MIFARE Ultralight / NTAG",band:"hf-14a",protocols:["iso14443a","mifare-ultralight","nfc-a"],confidence:90,parserId:"mifare-ultralight",score:c=>highest(scoreText(c,/NTAG|Ultralight|NFC\s*Type\s*2/i,90),c.sak==="00"?72:0),steps:["hf mfu info","hf mfu ndefread","hf mfu dump"]},
    {
      id:"mifare-plus",label:"MIFARE Plus",band:"hf-14a",protocols:["iso14443a","mifare-plus"],confidence:92,parserId:"mifare-plus",
      score:c=>{
        const desfireProbe=commandResult(c,"hf mfdes info");
        if(desfireProbe && desfireProbe.ok && /Card seems to be MIFARE Plus EV[12]/i.test(desfireProbe.output)) return 100;
        const probe=commandResult(c,"hf mfp info");
        if(probe && positiveResult(c,"hf mfp info",/(?:Result|Tech)\.*\s*MIFARE Plus|SL mode\.*\s*SL[0-3]/i)) return 99;
        if(probe) return 0;
        return scoreText(c,/MIFARE\s+Plus|\bMFP\b/i,92);
      },
      steps:["hf mfp info","hf mfp ndefread"]
    },
    {
      id:"desfire",label:"MIFARE DESFire",band:"hf-14a",protocols:["iso14443a","iso14443-4","mifare-desfire"],confidence:94,parserId:"mifare-desfire",
      score:c=>{
        const probe=commandResult(c,"hf mfdes info");
        if(probe && positiveResult(c,"hf mfdes info",/(?:Product type|Hardware Information|DESFire EV[123]|DESFire Light)/i)) return 100;
        if(probe && /Card seems to be MIFARE Plus/i.test(probe.output)) return 0;
        const mfpProbe=commandResult(c,"hf mfp info");
        if(mfpProbe && positiveResult(c,"hf mfp info",/Result\.*\s*MIFARE DESFire|Card seems to be MIFARE DESFire/i)) return 100;
        if(probe || mfpProbe) return 0;
        return scoreText(c,/MIFARE\s+DESFire|DESFire\s+(?:EV[123]|Light)|MF3ICD(?:40|21|81)?/i,94);
      },
      steps:["hf mfdes info","hf mfdes getuid","hf mfdes lsapp"]
    },
    {
      id:"mifare-classic",label:c=>`MIFARE Classic ${classicSizeFlag(c.evidence).replace("--","").toUpperCase()}`,band:"hf-14a",protocols:["iso14443a","mifare-classic"],confidence:92,parserId:"mifare-classic",
      score:c=>highest(scoreText(c,/MIFARE\s+Classic|\bMFC\b|\bS(?:20|50|70)\b/i,92),["08","09","18"].includes(c.sak)?78:0),
      steps:c=>classicSteps(c),
      commandVariants:["hf mf info","hf mf chk --mini","hf mf chk --1k","hf mf chk --2k","hf mf chk --4k","hf mf darkside","hf mf dump --mini","hf mf dump --1k","hf mf dump --2k","hf mf dump --4k"],
      recoveryStrategies:["dictionary","darkside","nested","hardnested","brute","autopwn"]
    },
    {
      id:"emv",label:"EMV contactless",band:"hf-14a",protocols:["iso14443a","iso14443-4","emv"],confidence:94,parserId:"emv",privacyClass:"sensitive",
      score:c=>{
        const probes=[commandResult(c,"emv pse"),commandResult(c,"emv pse -s2"),commandResult(c,"emv pse -st2"),commandResult(c,"emv search -st"),commandResult(c,"emv reader"),commandResult(c,"emv reader -v")].filter(Boolean);
        if(probes.some(probe=>probe.ok && /(?:2PAY\.SYS\.DDF01|1PAY\.SYS\.DDF01|PPSE[\s\S]{0,200}\bAID\b|APDU response status:\s*9000)/i.test(probe.output) && !/(?:not found|failed|failure|no response|timed?\s*out)/i.test(probe.output))) return 100;
        if(probes.length) return 0;
        return scoreText(c,/\bEMV\b|PPSE|2PAY\.SYS|1PAY\.SYS|payment|bank card|credit card|debit card/i,94);
      },
      steps:["emv pse -s2"],
      commandVariants:["emv pse","emv pse -s2","emv pse -st2","emv search -s","emv search -st","emv reader","emv reader -v"]
    },
    {
      id:"seos",label:"HID SEOS",band:"hf-14a",protocols:["iso14443a","iso14443-4","seos"],confidence:70,parserId:"seos",privacyClass:"sensitive",
      score:c=>{
        const probe=commandResult(c,"hf seos info");
        if(probe && positiveResult(c,"hf seos info",/(?:Selected ADF|Plaintext ADF|Diversifier\.*\s*[0-9A-F]{8,})/i)) return 100;
        if(probe) return 0;
        return scoreText(c,/\bHID\s+SEOS\b|\bSEOS\s+(?:card|tag|credential)\b/i,70);
      },
      steps:[step("seos-info","hf seos info","public-read",{parserId:"seos",successEvidence:["Selected ADF","Diversifier"]})]
    },
    {id:"em410x",label:"EM410x",band:"lf",protocols:["lf","em410x"],confidence:90,parserId:"em410x",score:c=>highest(scoreText(c,/EM\s*410x|EM4100|EM4102/i,90),scoreSuccessfulSearch(c,/EM\s*410x|EM4100|EM4102/i,98)),steps:["lf em 410x reader"]},
    {id:"hid-prox",label:"HID Prox",band:"lf",protocols:["lf","hid-prox"],confidence:90,parserId:"hid-prox",score:c=>highest(scoreText(c,/HID\s+Prox|H10301/i,90),scoreSuccessfulSearch(c,/HID\s+Prox|H10301/i,98)),steps:["lf hid reader"]},
    {id:"indala",label:"Indala",band:"lf",protocols:["lf","indala"],confidence:90,parserId:"indala",score:c=>highest(scoreText(c,/Indala/i,90),scoreSuccessfulSearch(c,/Indala/i,98)),steps:["lf indala reader"]},
    {id:"awid",label:"AWID",band:"lf",protocols:["lf","awid"],confidence:90,parserId:"awid",score:c=>highest(scoreText(c,/AWID/i,90),scoreSuccessfulSearch(c,/AWID/i,98)),steps:["lf awid reader"]},
    {id:"ioprox",label:"Kantech ioProx",band:"lf",protocols:["lf","ioprox"],confidence:90,parserId:"ioprox",score:c=>highest(scoreText(c,/IoProx|Kantech|\bIO\s+Prox/i,90),scoreSuccessfulSearch(c,/IoProx|Kantech|\bIO\s+Prox/i,98)),steps:["lf io reader"]},
    {id:"t55xx",label:"T55xx",band:"lf",protocols:["lf","t55xx"],confidence:90,parserId:"t55xx",score:c=>highest(scoreText(c,/T55(?:77|xx)|T5(?:5|7)|Temic|Atmel/i,90),scoreSuccessfulSearch(c,/T55(?:77|xx)|T5(?:5|7)|Temic|Atmel/i,98)),steps:["lf t55xx detect","lf t55xx info","lf t55xx dump"]}
  ];

  const FALLBACK_PROFILES=[
    {id:"lf-generic",label:"Unknown LF tag",band:"lf",protocols:["lf"],confidence:40,parserId:"lf-generic",score:c=>scoreText(c,/LF\s+RFID|125\s*kHz|134(?:\.2)?\s*kHz/i,40),steps:[]},
    {
      id:"iso14443a",label:"ISO14443-A / ISO14443-4 card",band:"hf-14a",protocols:["iso14443a","iso14443-4"],confidence:55,parserId:"iso14443a",
      score:c=>c.sak==="20"?55:scoreText(c,/ISO\s*14443-?A|ATQA|\bSAK\b|13\.56\s*MHz|HF\s+RFID|NFC/i,40),
      classificationSteps:c=>c.sak==="20"?sak20ClassificationSteps():[],steps:[]
    },
    {id:"unknown",label:"Unknown card type",band:"unknown",protocols:[],confidence:1,parserId:"plain-output",score:()=>1,steps:[]}
  ];

  function resolveSteps(value,context,defaults={}){
    return [...(resolved(value,context) || [])].map(item=>normalizeStep(item,{...defaults,parserId:defaults.parserId || "plain-output"}));
  }
  function detect(input){
    const context=normalizeInput(input);
    const candidates=[...PROFILE_DEFINITIONS,...FALLBACK_PROFILES].map((definition,index)=>({definition,index,score:Number(definition.score(context) || 0)}));
    candidates.sort((a,b)=>b.score-a.score || a.index-b.index);
    const selected=candidates[0];
    const definition=selected.definition;
    const executionSteps=resolveSteps(definition.steps,context,{parserId:definition.parserId});
    const classificationSteps=resolveSteps(definition.classificationSteps,context,{phase:"classification",parserId:definition.parserId});
    const discoverySteps=discoveryStepsForBand(definition.band);
    return {
      id:definition.id,
      label:text(resolved(definition.label,context)),
      band:definition.band,
      protocols:[...(definition.protocols || [])],
      confidence:selected.score,
      parserId:definition.parserId,
      privacyClass:definition.privacyClass || "standard",
      riskLevel:definition.riskLevel || "low",
      discoverySteps,
      classificationSteps,
      executionSteps,
      publicReadSteps:executionSteps.filter(item=>item.phase==="public-read" || item.phase==="read"),
      authenticatedReadSteps:executionSteps.filter(item=>item.phase==="authenticated-read" || item.phase==="key-check"),
      recoverySteps:executionSteps.filter(item=>item.phase==="recovery"),
      recoveryStrategies:[...(definition.recoveryStrategies || [])],
      commands:executionSteps.map(item=>item.command),
      evidence:context.evidence,
      sak:context.sak
    };
  }
  function allCommands(){
    const commands=new Set();
    const sampleContexts=[normalizeInput(""),normalizeInput("SAK: 08 MIFARE Classic 1K"),normalizeInput("SAK: 09 MIFARE Classic Mini"),normalizeInput("SAK: 18 MIFARE Classic 4K"),normalizeInput("MIFARE Classic 2K")];
    for(const band of ["hf","hf-14a","lf"]) discoveryStepsForBand(band).forEach(item=>commands.add(item.command));
    sak20ClassificationSteps().forEach(item=>commands.add(item.command));
    for(const definition of PROFILE_DEFINITIONS){
      if(definition.commandVariants) definition.commandVariants.forEach(command=>commands.add(command));
      for(const context of sampleContexts) resolveSteps(definition.steps,context,{parserId:definition.parserId}).forEach(item=>commands.add(item.command));
    }
    return [...commands].filter(Boolean);
  }
  function listProfiles(){
    return [...PROFILE_DEFINITIONS,...FALLBACK_PROFILES].map(item=>({id:item.id,label:text(typeof item.label==="string"?item.label:item.id),band:item.band,protocols:[...(item.protocols || [])],parserId:item.parserId}));
  }

  return {version:VERSION,detect,detectedSak,classicSizeFlag,normalizeStep,advancedWorkflowPlan,advancedRecoveryPlan,allCommands,listProfiles};
});
