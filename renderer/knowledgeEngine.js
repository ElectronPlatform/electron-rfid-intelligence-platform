/*
 * Electron / Atlas Knowledge Engine v0.6
 * Turns PM3 output into beginner-readable RFID/NFC intelligence.
 */
(function(){
  const state = { index:null, modules:{}, ready:false, error:null, lastResult:null };
  const MAX_ALTERNATIVE_CONFIDENCE=84;

  function text(v){ return String(v ?? ""); }
  function clean(v){ return text(v).trim(); }
  function list(v){ return Array.isArray(v) ? v : (v ? [v] : []); }
  function html(v){ return text(v).replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c])); }
  async function loadJson(path){ const res=await fetch(path,{cache:"no-store"}); if(!res.ok) throw new Error(`Could not load ${path}: ${res.status}`); return await res.json(); }

  async function init(){
    if(state.ready) return state;
    try{
      state.index=await loadJson("knowledge/index.json");
      for(const m of state.index.modules || []) state.modules[m.id]=await loadJson("knowledge/"+m.file);
      if(window.ElectronDatabase?.loadKnowledgeCatalog){
        const catalog = await window.ElectronDatabase.loadKnowledgeCatalog();
        for(const family of catalog.cardFamilies || []){
          state.modules[family.id] = Object.assign({}, state.modules[family.id] || {}, family, {
            knowledgeSource:"Electron Knowledge Database"
          });
        }
        state.knowledgeCatalog = catalog;
      }
      state.ready=true;
    }catch(err){ state.error=err; console.error("Knowledge Engine load failed",err); }
    return state;
  }

  function positiveScanEvidence(scanText){
    let possibleTypeList=false;
    return text(scanText).split(/[\r\n]+/).filter(line=>{
      if(/^\s*\[\+\]\s*Possible types?\s*:/i.test(line)){
        possibleTypeList=true;
        return false;
      }
      if(possibleTypeList){
        if(!line.trim()) return false;
        if(/^\s*\[\+\]/.test(line)) return false;
        possibleTypeList=false;
      }
      const value=line.replace(/^\s*\[[=+?!-]\]\s*/,"").trim();
      if(!value || /^\[Electron\s+[^\]]+\]$/i.test(value)) return false;
      if(/(?:Searching for|Checking for known tags|Searching for auth LF|False Positives ARE possible)/i.test(value)) return false;
      if(/(?:command execution time out|timed?\s*out|Couldn't identify a chipset|No known\/supported|No tag found|not detected|no card)/i.test(value)) return false;
      if(/^(?:Session log|loaded\b|execute command|Using UART|Communicating with PM3|pm3\s*-->)/i.test(value)) return false;
      if(/^Hint:\s*(?:try|use)\b/i.test(value)) return false;
      return true;
    }).join("\n");
  }
  function extractAtsBytes(scanText){
    for(const line of text(scanText).split(/[\r\n]+/)){
      const match=line.match(/\bATS\s*:\s*((?:[0-9A-F]{2}\s+){1,63}[0-9A-F]{2})(?:\s*\[|$)/i);
      if(match) return match[1].trim().replace(/\s+/g," ").toUpperCase();
    }
    return "";
  }
  function parseScanOutput(scanText){
    const t=text(scanText);
    const evidence=positiveScanEvidence(t);
    const uidMatch=t.match(/UID:\s*([0-9A-Fa-f ]+)/) || t.match(/EM\s*410x ID\s*([0-9A-Fa-f]+)/i) || t.match(/IDm\s*[:=]\s*([0-9A-Fa-f ]+)/i);
    const atqaMatch=t.match(/ATQA:\s*([0-9A-Fa-f ]+)/i);
    const sakMatch=t.match(/SAK:\s*([0-9A-Fa-f]+)/i);
    const ats=extractAtsBytes(t);
    const typeHints=[];
    const lf = window.ElectronDatabase?.parseLfSearchOutput ? window.ElectronDatabase.parseLfSearchOutput(t) : {detected:false};
    if(/EMV|PPSE|2PAY\.SYS|AID|Visa|Mastercard|PayPass|PayWave|contactless payment|pre-issuing data/i.test(evidence)) typeHints.push("EMV payment");
    if(/MIFARE\s+Classic|hf\s+mf|PRNG|nested|sector trailer/i.test(evidence)) typeHints.push("MIFARE Classic");
    if(/\bDESFire\b|MIFARE\s+DESFire|MF3ICD|PICC\s+(?:Master Key|level)/i.test(evidence)) typeHints.push("DESFire");
    if(/NTAG|Ultralight|NDEF|NFC Forum Type 2/i.test(evidence)) typeHints.push("NTAG/Ultralight");
    if(/ISO15693|iCode|Vicinity/i.test(evidence)) typeHints.push("ISO15693");
    if(/FeliCa|NFC-F|IDm|PMm/i.test(evidence)) typeHints.push("FeliCa");
    if(/EM\s*410x/i.test(evidence)) typeHints.push("EM410x");
    if(/HID\s*Prox|H103/i.test(evidence) || /HID|H10301/i.test(lf.primary?.format || "")) typeHints.push("HID Prox");
    if(/Hitag\s*2|PCF\s*7952/i.test(evidence) || /Hitag/i.test(lf.primary?.format || "")) typeHints.push("Hitag 2");
    if(/T5577|T55xx|Temic/i.test(evidence)) typeHints.push("T5577");
    if(/iCLASS|PicoPass/i.test(evidence)) typeHints.push("iCLASS");
    if(/Indala/i.test(evidence)) typeHints.push("Indala");
    if(/ISO14443-A|13\.56|Valid ISO14443/i.test(evidence)) typeHints.push("ISO14443-A");
    if(/ISO14443-B/i.test(evidence)) typeHints.push("ISO14443-B");
    if(lf.detected) typeHints.push("LF");
    const uid = lf.primary && lf.rawId ? lf.rawId : (uidMatch?clean(uidMatch[1]).replace(/\s+/g," ").toUpperCase():(lf.rawId||""));
    return { raw:t, uid, atqa:atqaMatch?clean(atqaMatch[1]).toUpperCase():"", sak:sakMatch?clean(sakMatch[1]).toUpperCase():"", ats, typeHints, lf };
  }

  function addReason(reasons, condition, label, weight){ if(condition){ reasons.push({label, weight}); return weight; } return 0; }
  function scoreDetectionPatterns(module, raw, reasons){
    const patterns=Array.isArray(module.detectionPatterns) ? module.detectionPatterns : [];
    let best=null;
    for(const item of patterns){
      const pattern=typeof item==="string" ? item : item?.pattern;
      if(!pattern) continue;
      try{
        const re=new RegExp(pattern, "i");
        if(re.test(raw)){
          const weight=Number((typeof item==="object" && item.weight) || module.detectionWeight || 82);
          if(!best || weight>best.weight) best={weight, label:(typeof item==="object" && item.label) || module.detectionLabel || "Knowledge database pattern matched"};
        }
      }catch(err){
        console.warn("Invalid knowledge detection pattern", module.id, pattern, err);
      }
    }
    return addReason(reasons, !!best, best?.label || "", best?.weight || 0);
  }

  function scoreModule(module, parsed){
    const raw=positiveScanEvidence(parsed.raw);
    let score=0; const reasons=[]; const id=module.id;
    const hasIsoA=/ISO14443-A|Valid ISO14443|13\.56/i.test(raw);
    const hasLf=!!parsed.lf?.detected;
    const hasNfc=/NFC|NDEF|NTAG|Ultralight/i.test(raw);

    if(id==="emv_payment"){
      score+=addReason(reasons,/EMV|PPSE|2PAY\.SYS|AID|Visa|Mastercard|PayPass|PayWave|contactless payment|pre-issuing data|Try `?emv/i.test(raw),"EMV/payment terms found",85);
      score+=addReason(reasons,parsed.ats,"ATS / ISO14443-4 style data present",20);
      score+=addReason(reasons,hasIsoA || /ISO14443-B/i.test(raw),"Contactless smart-card protocol detected",12);
      if(/MIFARE\s+Classic/i.test(raw)) score-=35;
    }
    if(id==="mifare_classic"){
      score+=addReason(reasons,/MIFARE\s+Classic/i.test(raw),"MIFARE Classic text found",90);
      score+=addReason(reasons,/hf\s+mf|PRNG|nested|sector trailer|blocks?\s+\d+/i.test(raw),"MIFARE Classic tooling/sector hints found",45);
      score+=addReason(reasons,/SAK:\s*08/i.test(raw),"SAK 08 can match Classic 1K",18);
      score+=addReason(reasons,/ATQA:\s*00\s*04/i.test(raw),"ATQA 00 04 commonly appears with Classic",10);
      if(/EMV|PPSE|2PAY\.SYS|AID|DESFire|NTAG|Ultralight/i.test(raw)) score-=40;
    }
    if(id==="mifare_desfire"){
      score+=addReason(reasons,/\bDESFire\b|MIFARE\s+DESFire|MF3ICD|PICC\s+(?:Master Key|level)/i.test(raw),"DESFire-specific text found",85);
      score+=addReason(reasons,/ISO\s*14443-4|ATS|RATS/i.test(raw),"ISO14443-4 / ATS data present",24);
      if(/EMV|PPSE|2PAY/i.test(raw)) score-=20;
    }
    if(id==="ntag21x"){
      score+=addReason(reasons,/NTAG|NT2H|NFC Forum Type 2|NDEF/i.test(raw),"NTAG/NDEF hints found",90);
      score+=addReason(reasons,hasNfc,"NFC tag terms present",18);
    }
    if(id==="mifare_ultralight"){
      score+=addReason(reasons,/Ultralight|MF0|pages|lock bytes/i.test(raw),"Ultralight/page-memory hints found",88);
      score+=addReason(reasons,/NFC Forum Type 2/i.test(raw),"NFC Forum Type 2 hint found",20);
    }
    if(id==="iso15693") score+=addReason(reasons,/ISO15693|iCode|Vicinity/i.test(raw),"ISO15693/vicinity hints found",95);
    if(id==="felica") score+=addReason(reasons,/FeliCa|NFC-F|IDm|PMm/i.test(raw),"FeliCa/NFC-F hints found",95);
    if(id==="em410x") score+=addReason(reasons,/EM\s*410x/i.test(raw),"EM410x ID detected",95) + addReason(reasons,hasLf,"LF / 125 kHz output detected",20);
    if(id==="hid_prox") score+=addReason(reasons,/Valid\s+HID\s+Prox\s+ID\s+found|HID\s*Prox|H103|HID/i.test(raw),"HID Prox hints found",/Valid\s+HID\s+Prox\s+ID\s+found/i.test(raw)?100:92) + addReason(reasons,hasLf,"LF / 125 kHz output detected",12);
    if(id==="t5577") score+=addReason(reasons,/T5577|T55xx|Temic/i.test(raw),"T5577/T55xx hints found",92) + addReason(reasons,hasLf,"LF / 125 kHz output detected",12);
    if(id==="hitag2") score+=addReason(reasons,/Hitag\s*2|PCF\s*7952|lf\s+hitag/i.test(raw),"Hitag / PCF7952 LF hints found",98) + addReason(reasons,hasLf,"LF / 125 kHz output detected",12);
    if(id==="iclass") score+=addReason(reasons,/iCLASS|PicoPass/i.test(raw),"iCLASS/PicoPass hints found",95);
    if(id==="indala") score+=addReason(reasons,/Indala/i.test(raw),"Indala hints found",95) + addReason(reasons,hasLf,"LF / 125 kHz output detected",12);
    score+=scoreDetectionPatterns(module, raw, reasons);

    if((module.technology||"").includes("HF") && hasIsoA) score+=addReason(reasons,true,"HF/ISO14443 context matches",8);
    if((module.technology||"").includes("LF") && hasLf) score+=addReason(reasons,true,"LF context matches",8);
    return {score:Math.max(0,Math.min(100,Math.round(score))), reasons};
  }

  function confidenceLevel(n){ if(n>=85) return "Very high"; if(n>=65) return "High"; if(n>=35) return "Medium"; if(n>0) return "Low"; return "Unknown"; }

  function primaryLfOverride(parsed, ranked){
    const primary=parsed?.lf?.primary;
    if(!primary) return null;
    const primaryText=`${primary.format || ""} ${parsed.lf?.source || ""}`;
    if(/HID|H10301/i.test(primaryText) && state.modules?.hid_prox){
      const existing=ranked.find(x=>x.module?.id==="hid_prox");
      return {
        module:state.modules.hid_prox,
        score:100,
        reasons:[
          {label:"Valid HID Prox ID found in LF output", weight:100},
          {label:`Primary LF decode: ${primary.format || "HID Prox"}`, weight:20}
        ],
        previousScore:existing?.score || 0
      };
    }
    if(/Hitag/i.test(primaryText) && state.modules?.hitag2){
      const existing=ranked.find(x=>x.module?.id==="hitag2");
      return {
        module:state.modules.hitag2,
        score:100,
        reasons:[
          {label:"Hitag card found in LF output", weight:100},
          {label:`Primary LF decode: ${primary.format || "Hitag"}`, weight:20}
        ],
        previousScore:existing?.score || 0
      };
    }
    return null;
  }

  function identify(scanText){
    const parsed=parseScanOutput(scanText);
    const ranked=Object.values(state.modules||{}).map(module=>({module,...scoreModule(module,parsed)})).sort((a,b)=>b.score-a.score);
    const override=primaryLfOverride(parsed, ranked);
    const best=override || ranked[0] || null; const confidence=best?best.score:0;
    const alternatives=(override ? ranked.filter(x=>x.module?.id!==override.module.id) : ranked.slice(1))
      .slice(0,5)
      .filter(x=>x.score>0)
      .map(item=>({...item,score:Math.min(MAX_ALTERNATIVE_CONFIDENCE,item.score),classification:"hypothesis"}));
    const result={ parsed, module: confidence>0?best.module:null, confidence, confidenceLevel:confidenceLevel(confidence), reasons:best?best.reasons:[], alternatives, status:confidence>0?"identified":"unknown" };
    state.lastResult=result; return result;
  }

  function recommendationCards(result){
    const m=result.module;
    if(!m) return ["Start with a safe identification scan.","Keep only one card on the antenna.","Save the raw output in an Assistant Review Pack if you need help."];
    const recs=[...(m.safeRecommendedActions||[])];
    if(result.parsed.uid) recs.unshift(`UID detected: ${result.parsed.uid}`);
    if(m.id==="emv_payment") recs.unshift("Do not clone, write or modify this card.");
    return [...new Set(recs)].slice(0,7);
  }

  function tagPill(value){ return value?`<span class="atlasPill">${html(value)}</span>`:""; }
  function capabilityList(module){
    return [module.uiHints?.primaryTool,...(module.uiHints?.secondaryTools||[])].filter(Boolean)
      .map(tool=>linkButton({"data-atlas-tool":tool,"data-module-id":module.id || ""}, tool, "atlasMiniTool"))
      .join("");
  }
  function reasonList(result){
    const r=(result.reasons||[]).filter(x=>x.weight>0).slice(0,6);
    if(!r.length) return "<li>No strong signature found yet.</li>";
    return r.map(x=>`<li>${html(x.label)}</li>`).join("");
  }
  function alternativesText(result){
    const alts=(result.alternatives||[]).slice(0,3);
    if(!alts.length) return "No close alternatives.";
    return alts.map(a=>`${html(a.module.displayName)} (${a.score}%)`).join("<br>");
  }

  function key(value){ return clean(value).toLowerCase().replace(/[^a-z0-9]+/g,"_").replace(/^_+|_+$/g,""); }
  function unique(items){
    const seen=new Set();
    return items.filter(item=>{
      const id=key(item?.id || item?.displayName || item?.name || item);
      if(!id || seen.has(id)) return false;
      seen.add(id);
      return true;
    });
  }
  function moduleAliases(module){
    const profile=module?.cardProfile || {};
    return [module?.id, module?.displayName, module?.family, profile.name, profile.chipFamily, ...(module?.aliases||[]), ...(profile.similarCards||[])].filter(Boolean);
  }
  function findModule(value){
    const target=key(value);
    if(!target) return null;
    return Object.values(state.modules || {}).find(module=>moduleAliases(module).some(alias=>key(alias)===target)) || null;
  }
  function commandInfo(command, module={}){
    const c=clean(command);
    const cardName=module?.displayName || "the card";
    const defaults={
      summary:"Read-only information command.",
      purpose:`Collect public information about ${cardName} without writing to the card.`,
      reveals:["Technology or protocol hints when the card answers", "UID or public identifier when the card exposes one", "Enough metadata for Electron to improve the report model"],
      doesNot:["Write to the card", "Recover keys", "Bypass authentication", "Clone or emulate a card"],
      risk:"Low. This is intended as a read-only metadata command, but you should still use it only on cards you own or are authorized to inspect.",
      example:"[+] Card information detected\n[+] UID / protocol details shown when available"
    };
    const map=[
      [/^hf search$/i,{
        summary:"Scans for high-frequency RFID/NFC cards.",
        purpose:"This is the safest first HF check. It asks the Proxmark3 to look for common 13.56 MHz card families and report what it can identify.",
        reveals:["Whether an HF/NFC card is present", "Likely family such as ISO14443-A, ISO14443-B, ISO15693, FeliCa, MIFARE or DESFire", "UID or protocol metadata when exposed", "Basic hints Electron can use for Card Intelligence"],
        example:"[+] Valid ISO14443-A tag found\n[+] UID: 04 A1 B2 C3 D4 E5 80\n[+] SAK: 08"
      }],
      [/^lf search$/i,{
        summary:"Scans for low-frequency 125/134 kHz tags.",
        purpose:"This is the safest first LF check. It listens for common low-frequency access and transponder formats.",
        reveals:["Whether an LF tag is present", "Known formats such as EM410x, HID Prox, Indala, Hitag or T55xx hints", "Decoded ID/facility/card fields when PM3 can decode them"],
        example:"[+] EM 410x ID found\n[+] Raw: 0F0368568B\n[+] Possible access credential format"
      }],
      [/^hf 14a info$/i,{
        summary:"Reads public ISO14443-A card details.",
        purpose:"Use this after an HF scan suggests ISO14443-A. It asks for public card-selection and protocol information, which helps separate MIFARE Classic, Ultralight/NTAG, DESFire-style cards and other ISO14443-A families.",
        reveals:["UID", "ATQA and SAK values", "Card-selection details (also called anti-collision)", "ATS/RATS hints when supported", "Useful information for Detection Confidence"],
        example:"[+] UID: 04 A1 B2 C3 D4 E5 80\n[+] ATQA: 00 04\n[+] SAK: 08\n[+] Possible MIFARE Classic 1K"
      }],
      [/^hf mf info$/i,{
        summary:"Reads public MIFARE Classic information.",
        purpose:"Use this when Electron thinks the card is MIFARE Classic. It gathers safe card metadata and technical details without reading protected sector contents.",
        reveals:["MIFARE Classic family hints", "Card size/type hints when available", "PRNG / generation indicators where PM3 reports them", "Whether deeper sector reading would require authorized keys"],
        doesNot:["Dump sectors", "Try key recovery", "Run nested/hardnested/default-key attacks", "Write or modify trailers"],
        example:"[+] MIFARE Classic information\n[+] UID / ATQA / SAK confirmed\n[+] Sector data requires valid authorized keys"
      }],
      [/^hf mfu info$/i,{
        summary:"Reads public MIFARE Ultralight / NTAG information.",
        purpose:"Use this for NTAG and Ultralight-style NFC tags. It checks public tag metadata and lock/configuration hints.",
        reveals:["NTAG/Ultralight type hints", "Public pages and configuration hints", "Lock/password-protection indicators", "NDEF-readiness clues"],
        example:"[+] MIFARE Ultralight / NTAG info\n[+] Capability container detected\n[+] Lock bytes / configuration reported when readable"
      }],
      [/^hf 15 info$/i,{
        summary:"Reads public ISO15693 / NFC Type 5 information.",
        purpose:"Use this when Electron suspects ISO15693. It asks for vicinity-card metadata instead of ISO14443 data.",
        reveals:["ISO15693 UID", "DSFID / AFI / memory-size hints when exposed", "Manufacturer or chip-family clues", "Block-read planning information"],
        example:"[+] ISO15693 tag found\n[+] UID: E0 04 01 23 45 67 89 AB\n[+] DSFID / AFI reported when available"
      }],
      [/^hf felica info$/i,{
        summary:"Reads public FeliCa / NFC-F information.",
        purpose:"Use this when an HF scan indicates FeliCa or NFC-F. It collects public polling metadata.",
        reveals:["IDm and PMm when exposed", "System-code hints", "NFC-F protocol evidence"],
        example:"[+] FeliCa tag found\n[+] IDm / PMm shown when available"
      }]
    ];
    const found=map.find(([pattern])=>pattern.test(c));
    return Object.assign({}, defaults, found ? found[1] : {});
  }
  function commandLabel(command, module){
    return commandInfo(command, module).summary;
  }
  function safeCommandsFor(module){
    const profile=module?.cardProfile || {};
    const commands=[...(profile.safePm3Commands||[]), ...(module?.safePm3Commands||[])];
    if((module?.technology||"").includes("HF")) commands.push("hf search");
    if((module?.technology||"").includes("LF")) commands.push("lf search");
    if(/MIFARE Classic/i.test(module?.displayName||module?.family||"")) commands.push("hf 14a info","hf mf info");
    if(/NTAG|Ultralight/i.test(module?.displayName||"")) commands.push("hf mfu info");
    if(/ISO15693|Vicinity|Type 5/i.test(module?.protocol||module?.displayName||"")) commands.push("hf 15 info");
    return [...new Set(commands.map(clean).filter(Boolean))].slice(0,8).map(command=>({command,detail:commandLabel(command, module)}));
  }
  function relatedKnowledgeFor(module){
    const profile=module?.cardProfile || {};
    const ids=[...(profile.relatedKnowledgeRecords||[]), ...(module?.relatedKnowledgeRecords||[])];
    if(/MIFARE/i.test(module?.family||module?.displayName||"")) ids.push("mifare_plus","ntag21x","mifare_ultralight","iso14443a");
    if(/ISO\/IEC 14443-A|ISO14443-A/i.test(module?.protocol||"")) ids.push("iso14443a");
    if(/NTAG|Ultralight/i.test(module?.displayName||"")) ids.push("nfc_type2","mifare_classic","mifare_plus");
    if(/Hitag/i.test(module?.family||module?.displayName||"")) ids.push("hitag_s","hitag_u","pcf793x");
    return unique(ids.map(findModule).filter(Boolean).filter(item=>item.id!==module?.id)).slice(0,8);
  }
  function similarCardsFor(module){
    const profile=module?.cardProfile || {};
    const names=[...(profile.similarCards||[]), ...(module?.similarCards||[])];
    if(module?.id==="hitag2") names.push("hitag_s","hitag_u","pcf7952","pcf793x");
    if(module?.id==="mifare_classic") names.push("mifare_mini","mifare_plus","mifare_ultralight","fudan","magic_gen1a");
    if(module?.id==="em410x") names.push("em4200","hid_prox","t5577");
    return unique(names.map(value=>findModule(value) || {id:key(value), displayName:clean(value)})).filter(item=>item.id!==module?.id).slice(0,8);
  }
  function supportRank(support){ return ({supported:3,yes:3,possible:2,partial:2,limited:2,unknown:1,no:0}[support] ?? 1); }
  function deviceSupport(module, device){
    const id=module?.id || "";
    const tech=module?.technology || "";
    const protocol=key(module?.protocol || id);
    const familyMatch=(device.families||[]).some(f=>tech.toLowerCase().includes(clean(f).toLowerCase()));
    const protocolMatch=(device.supportedProtocols||[]).some(p=>protocol.includes(key(p)) || key(p).includes(protocol));
    if(device.id==="proxmark3") return {support:"supported", note:"Primary supported device for Electron live scanning."};
    if(module?.id==="emv_payment") return {support:"partial", note:"Safe identification only; protected/payment workflows stay unavailable."};
    if(protocolMatch || familyMatch) return {support:familyMatch && !protocolMatch ? "partial" : "supported", note:device.notes || "Supported by matching protocol or family."};
    return {support:"unknown", note:"No direct match in the current knowledge catalog."};
  }
  function deviceItemsFor(module){
    const catalog=state.knowledgeCatalog || {};
    const devices=(catalog.devices || []).length ? catalog.devices : [
      {id:"proxmark3",displayName:"Proxmark3",families:["HF","LF"],capabilityIds:["read_uid","identify","read_info","read_memory"]},
      {id:"flipper_zero",displayName:"Flipper Zero",families:["HF","LF","NFC"],capabilityIds:["read_uid","identify","read_memory"]},
      {id:"pn532",displayName:"PN532",families:["HF","NFC"],capabilityIds:["read_uid","identify","read_info"]},
      {id:"chameleon_ultra",displayName:"Chameleon Ultra",families:["HF","NFC"],capabilityIds:["read_uid","identify","emulation"]}
    ];
    return devices.map(device=>({...device,...deviceSupport(module, device)})).sort((a,b)=>supportRank(b.support)-supportRank(a.support));
  }
  function linkButton(attrs, label, cls="electronKnowledgeChip"){
    const pairs=Object.entries(attrs).map(([k,v])=>`${k}="${html(v)}"`).join(" ");
    return `<button type="button" class="${cls}" ${pairs}>${html(label)}</button>`;
  }
  function commandButtonList(commands, moduleId){
    const values=list(commands).map(item=>typeof item==="string" ? item : item?.command).filter(Boolean);
    if(!values.length) return `<p class="small">No safe commands recorded yet.</p>`;
    return `<div class="electronKnowledgeChipRow">${values.map(command=>linkButton({"data-safe-command":command,"data-module-id":moduleId || ""}, command)).join("")}</div>`;
  }
  function mirrorSafeCommand(command, output, options={}){
    const textOutput=output || options.message || "No output returned.";
    if(window.electronMirrorPm3Command){
      window.electronMirrorPm3Command(command, textOutput, {ok:options.ok, source:"Safe Command"});
      return;
    }
    window.electronAppendPm3Terminal?.(`\n[Safe Command]\n> ${command}\n${textOutput}\n`, {forceScroll:true});
  }
  function cardLabSafeCommands(module){
    const base=["hf search", "hf 14a info", "hf mf info", "lf search"];
    const moduleCommands=safeCommandsFor(module).map(item=>item.command);
    return [...new Set([...base, ...moduleCommands].map(clean).filter(Boolean))];
  }
  function renderKnowledgePanels(module){
    const related=relatedKnowledgeFor(module);
    const similar=similarCardsFor(module);
    const devices=deviceItemsFor(module);
    const commands=safeCommandsFor(module);
    return `<div class="electronKnowledgePanels">
      <div class="electronKnowledgePanel"><b>Related Knowledge</b><div class="electronKnowledgeChipRow">${related.length?related.map(item=>linkButton({"data-knowledge-id":item.id}, item.displayName || item.id)).join(""):"<span>No related records yet.</span>"}</div></div>
      <div class="electronKnowledgePanel"><b>Similar Cards</b><div class="electronKnowledgeChipRow">${similar.length?similar.map(item=>linkButton({"data-knowledge-id":item.id}, item.displayName || item.id)).join(""):"<span>No similar cards yet.</span>"}</div></div>
      <div class="electronKnowledgePanel"><b>Compatible Devices</b><div class="electronDeviceMiniGrid">${devices.map(item=>linkButton({"data-device-id":item.id,"data-module-id":module.id}, `${item.displayName || item.name || item.id} · ${item.support}`,"electronDeviceChip")).join("")}</div></div>
      <div class="electronKnowledgePanel"><b>Safe Commands</b><div class="electronKnowledgeChipRow">${commands.map(item=>linkButton({"data-safe-command":item.command,"data-module-id":module.id}, item.command)).join("")}</div></div>
    </div>`;
  }

  function modal(title, body, options={}){
    if(window.UIEngine?.modal){
      return window.UIEngine.modal({id:options.id || "electronKnowledgeDetailModal", title, subtitle:options.subtitle || "", body, size:options.size || "lg", buttons:options.buttons || [{text:"Close", variant:"primary"}]});
    }
    const old=document.getElementById("electronKnowledgeDetailModal");
    if(old) old.remove();
    const overlay=document.createElement("div");
    overlay.id="electronKnowledgeDetailModal";
    overlay.className="teModalOverlay";
    overlay.innerHTML=`<div class="teModalCard teModalCardLg"><div class="teModalHeader"><div class="teModalTitleBlock"><h3>${html(title)}</h3></div><button type="button" class="teModalX" data-close="true">×</button></div><div class="teModalBody">${body}</div><div class="teModalFooter"><button type="button" class="teBtn teBtnPrimary" data-close="true">Close</button></div></div>`;
    overlay.addEventListener("click", e=>{ if(e.target===overlay || e.target.closest("[data-close='true']")) overlay.remove(); });
    document.body.appendChild(overlay);
  }
  function listHtml(items){
    const values=(items||[]).map(x=>typeof x==="string"?x:(x?.name||x?.displayName||x?.id||"")).filter(Boolean);
    return values.length ? `<ul>${values.map(x=>`<li>${html(x)}</li>`).join("")}</ul>` : `<p class="small">No detailed records loaded yet.</p>`;
  }
  function openKnowledgeDetail(moduleId){
    const module=findModule(moduleId);
    if(!module){
      modal(clean(moduleId || "Knowledge record"), `<div class="electronKnowledgeDetail"><p>This related card is known as a neighbouring family, but Electron does not have a full local knowledge record for it yet.</p></div>`, {subtitle:"Related knowledge"});
      return;
    }
    const profile=module.cardProfile || {};
    const commands=safeCommandsFor(module);
    const body=`<div class="electronKnowledgeDetail">
      <p>${html(profile.description || module.beginnerExplanation || module.summary || "Knowledge record loaded.")}</p>
      <div class="electronDetailGrid">
        <section><h4>Typical applications</h4>${listHtml(profile.typicalApplications || module.typicalApplications || [module.application])}</section>
        <section><h4>Memory structure</h4><p>${html(module.memoryLayout?.concept || module.memory?.model || profile.meaning || "Family-specific memory details are not loaded yet.")}</p></section>
        <section><h4>Known chips</h4>${listHtml(module.commonSubtypes || module.aliases || [profile.chipFamily])}</section>
        <section><h4>Detection</h4>${listHtml((module.detectionPatterns||[]).map(x=>x.label || x.pattern))}</section>
        <section><h4>Supported hardware</h4>${listHtml(profile.compatibleHardware || module.compatibleHardware || deviceItemsFor(module).map(d=>d.displayName || d.id))}</section>
        <section><h4>Safe PM3 commands</h4>${commandButtonList(commands, module.id)}</section>
      </div>
      <div class="electronKnowledgePanel"><b>Related families</b><div class="electronKnowledgeChipRow">${relatedKnowledgeFor(module).concat(similarCardsFor(module)).slice(0,10).map(item=>linkButton({"data-knowledge-id":item.id}, item.displayName || item.id)).join("")}</div></div>
    </div>`;
    modal(module.displayName || module.id, body, {subtitle:"Knowledge detail", size:"xl"});
  }
  function openDeviceDetail(deviceId, moduleId){
    const module=findModule(moduleId) || state.lastResult?.module || {};
    const device=(state.knowledgeCatalog?.devices || []).find(d=>d.id===deviceId) || {id:deviceId, displayName:deviceId};
    const support=deviceSupport(module, device);
    const caps=(device.capabilityIds || []).map(id=>window.ElectronDatabase?.getCapability?.(id) || {id,displayName:id});
    const body=`<div class="electronKnowledgeDetail">
      <p><b>${html(support.support)}</b> for ${html(module.displayName || "this card")}.</p>
      <p>${html(support.note || device.notes || "")}</p>
      <h4>Available functions</h4>${listHtml(caps.map(c=>c.displayName || c.id))}
      <h4>Supported families</h4>${listHtml(device.families || [])}
    </div>`;
    modal(device.displayName || device.id, body, {subtitle:"Compatible device"});
  }
  function openSafeCommandDetail(command, moduleId){
    const module=findModule(moduleId) || state.lastResult?.module || {};
    const info=commandInfo(command, module);
    const outputId=`electronCommandOutput_${Date.now()}`;
    const statusId=`electronCommandStatus_${Date.now()}`;
    const body=`<div class="electronKnowledgeDetail">
      <p class="electronCommandIntro"><code>${html(command)}</code> ${html(info.summary)}</p>
      <div class="electronDetailGrid">
        <section><h4>What it does</h4><p>${html(info.purpose)}</p></section>
        <section><h4>What it can show</h4>${listHtml(info.reveals)}</section>
        <section><h4>What it does not do</h4>${listHtml(info.doesNot)}</section>
        <section><h4>Risk</h4><p>${html(info.risk)}</p></section>
        <section><h4>Example output</h4><pre class="normalPre">${html(info.example)}</pre></section>
        <section><h4>Used for</h4><p>${html(module.displayName || "Card identification")}</p></section>
      </div>
      <div class="electronInlineCommandRunner">
        <div class="electronCommandPreview">
          <b>Command to run</b>
          <pre class="normalPre">${html(command)}</pre>
        </div>
        <div class="electronInlineCommandHeader">
          <b>Command output</b>
          <span id="${statusId}">Not run yet</span>
        </div>
        <pre id="${outputId}" class="normalPre electronInlineCommandOutput">Click Run here to execute this command and keep the result in this window.</pre>
      </div>
    </div>`;
    modal(command, body, {
      subtitle:"Safe PM3 command",
      buttons:[
        {text:"Close", variant:"secondary"},
        {text:"Run here", variant:"success", close:false, onClick:async({button})=>{
          const output=document.getElementById(outputId);
          const status=document.getElementById(statusId);
          if(!window.pm3api?.runPm3LiveCommand){
            if(status) status.textContent="PM3 runner unavailable";
            if(output) output.textContent="Electron cannot run this command because the PM3 bridge is not available in this build.";
            return false;
          }
          const ready=window.DeviceGuard?.ensure ? await window.DeviceGuard.ensure({workflow:"Safe Command", command}) : {ok:true};
          if(!ready?.ok){
            if(status) status.textContent="Device unavailable";
            if(output) output.textContent=`> ${command}\n\nDevice unavailable. Connect a compatible RFID reader and try again.`;
            return false;
          }
          button.disabled=true;
          const oldText=button.textContent;
          button.textContent="Running...";
          if(status) status.textContent="Starting Proxmark3...";
          if(output) output.textContent=`> ${command}\n\nStarting Proxmark3 and running the command here. This can take a few seconds.`;
          const safety=window.Pm3CommandSafety?.validate ? window.Pm3CommandSafety.validate(command, {context:"safe-command"}) : {allowed:true};
          if(!safety.allowed){
            if(status) status.textContent="Blocked";
            if(output) output.textContent=`> ${command}\n\nCommand blocked: ${safety.reason}`;
            mirrorSafeCommand(command, `Command blocked: ${safety.reason}`, {ok:false});
            button.disabled=false;
            button.textContent=oldText;
            return false;
          }
          try{
            const started=Date.now();
            const result=window.electronRunPm3CommandWithSharedOutput
              ? await window.electronRunPm3CommandWithSharedOutput(command, {workflow:"Safe Command"})
              : await window.pm3api.runPm3LiveCommand(command);
            const combined=result?.output || (result?.stdout || "") + (result?.stderr || "");
            const seconds=((Date.now()-started)/1000).toFixed(1);
            if(status) status.textContent=result?.ok ? `Complete (${seconds}s)` : `Finished with error (${seconds}s)`;
            if(output) output.textContent=`> ${command}\n\n${combined || result?.message || "No output returned."}`;
            mirrorSafeCommand(command, combined || result?.message || "No output returned.", {ok:!!result?.ok});
          }catch(err){
            if(status) status.textContent="Failed";
            if(output) output.textContent=`> ${command}\n\nCommand failed: ${err?.message || err}`;
            mirrorSafeCommand(command, `Command failed: ${err?.message || err}`, {ok:false});
          }finally{
            button.disabled=false;
            button.textContent=oldText;
          }
          return false;
        }}
      ]
    });
  }
  function openActionDetail(action, result=state.lastResult){
    const module=result?.module || {};
    const titles={identity:"Identification",technology:"Technology",application:"Likely use",why:"Why Electron thinks this",memory:"Memory Explorer",security:"Security profile",clone:"Clone / write guidance",recommendations:"Recommended next actions","best-tool":"Best next tool"};
    if(action==="memory") return modal("Memory Explorer", renderMemoryExplorerHtml(result || {}, {}), {size:"xl"});
    if(action==="recommendations") return modal("Recommended next actions", `<ul>${recommendationCards(result||{}).map(r=>`<li>${html(r)}</li>`).join("")}</ul>`);
    if(action==="best-tool"){
      const tool=module.uiHints?.primaryTool || "Card Intelligence";
      const body=`<p>${html(tool)} is the best next view for this card family.</p><div class="electronKnowledgeChipRow">
        ${linkButton({"data-knowledge-id":module.id || ""},"Open knowledge detail")}
      </div>`;
      return modal("Best next tool", body, {buttons:[
        {text:"Close", variant:"secondary"},
        {text:`Open ${tool}`, variant:"success", onClick:()=>{
          const result=openSuggestedTool(tool, module.id, state.lastResult);
          return result === "replace-current-modal" ? false : true;
        }}
      ]});
    }
    const body=`<p>${html(module.beginnerExplanation || module.summary || "Electron matched this card against the loaded knowledge database.")}</p>
      <div class="electronDetailGrid">
        <section><h4>Family</h4><p>${html(module.family || module.displayName || "Unknown")}</p></section>
        <section><h4>Protocol</h4><p>${html(module.protocol || "Unknown")}</p></section>
        <section><h4>Confidence</h4><p>${html(result?.confidence || 0)}% · ${html(result?.confidenceLevel || "Unknown")}</p></section>
        <section><h4>Safe next commands</h4>${commandButtonList(safeCommandsFor(module), module.id)}</section>
      </div>`;
    modal(titles[action] || "Card Intelligence", body);
  }

  function openSuggestedTool(tool, moduleId, result=state.lastResult){
    const toolId=key(tool);
    const module=findModule(moduleId) || result?.module || {};
    const cardName=module.displayName || "this card";

    if(["sector_explorer","page_viewer","memory_explorer","block_viewer","classic_sector_viewer"].includes(toolId)){
      openActionDetail("memory", result);
      return "replace-current-modal";
    }
    if(toolId==="dump_history"){
      modal("Dump History", `<p>Electron keeps dump references with the RFID tag record they belong to.</p><p>Open Collection to select a saved RFID tag and review its registered backup files.</p>`, {
        subtitle:cardName,
        buttons:[
          {text:"Close", variant:"secondary"},
          {text:"Open Collection", variant:"primary", onClick:()=>{ window.showTab?.("inventory"); return true; }}
        ]
      });
      return "replace-current-modal";
    }
    if(toolId==="compare_dumps"){
      window.showTab?.("compare");
      return true;
    }
    if(toolId==="key_manager"){
      if(window.ElectronResearchManager?.openAuthorizedKeyWizard){
        window.ElectronResearchManager.openAuthorizedKeyWizard({returnToCardIntelligence:true});
        return "close-current-modal";
      }
      modal("Key Manager", `<p>Electron can store a key only when you are authorised to use it. It never cracks, guesses or recovers keys automatically.</p>`, {subtitle:cardName});
      return "replace-current-modal";
    }
    if(toolId==="card_intelligence"){
      window.showTab?.("cardlab");
      return true;
    }
    modal(tool, `<p><b>${html(tool)}</b> is suggested for ${html(cardName)}, but it does not yet have a separate Electron workspace.</p><p>Open the knowledge detail to review what Electron knows and the safe next steps available now.</p>`, {
      subtitle:"Suggested tool",
      buttons:[
        {text:"Close", variant:"secondary"},
        {text:"Open knowledge detail", variant:"primary", onClick:()=>{ openKnowledgeDetail(module.id); return false; }}
      ]
    });
    return "replace-current-modal";
  }

  document.addEventListener("click", event=>{
    const command=event.target.closest("[data-safe-command]");
    if(command){ event.preventDefault(); openSafeCommandDetail(command.dataset.safeCommand, command.dataset.moduleId); return; }
    const device=event.target.closest("[data-device-id]");
    if(device){ event.preventDefault(); openDeviceDetail(device.dataset.deviceId, device.dataset.moduleId); return; }
    const knowledge=event.target.closest("[data-knowledge-id]");
    if(knowledge){ event.preventDefault(); openKnowledgeDetail(knowledge.dataset.knowledgeId); return; }
    const tool=event.target.closest("[data-atlas-tool]");
    if(tool){ event.preventDefault(); event.stopPropagation(); openSuggestedTool(tool.dataset.atlasTool, tool.dataset.moduleId); return; }
    const action=event.target.closest("[data-atlas-action]");
    if(action){ event.preventDefault(); openActionDetail(action.dataset.atlasAction); }
  });

  function renderUnknown(result){
    return `<div class="atlasHero atlasHeroUnknown"><div><div class="atlasKicker">Card Intelligence</div><h3>Unknown card or unsupported output</h3><p>Electron could not match this scan to a loaded knowledge module yet.</p></div><div class="atlasScore atlasScoreNeutral"><span>0%</span><small>Recognition Confidence</small></div></div>
    <div class="atlasGrid"><div class="atlasCard atlasActionCard"><b>Recommended next step</b><ul>${recommendationCards(result).map(r=>`<li>${html(r)}</li>`).join("")}</ul></div><div class="atlasCard"><b>What Electron needs</b><p>A safe scan from Card Lab, or raw PM3 output as fallback.</p></div><div class="atlasCard"><b>Safe by design</b><p>This view explains; writing/cloning actions stay separate and explicit.</p></div></div>`;
  }

  function renderIntelligenceHtml(result){
    const m=result.module; if(!m) return renderUnknown(result);
    const subtype=(m.commonSubtypes||[])[0]||{}; const recs=recommendationCards(result); const parsed=result.parsed||{};
    const attacks=(m.knownAttacks||[]).map(a=>typeof a==="string"?a:(a.name||a.id||"")).filter(Boolean);
    const cloneable=m.cloneable===true || m.cloneSupport || m.magicCardSupport;
    const profileHtml=window.CardProfileEngine?.renderProfileHtml ? window.CardProfileEngine.renderProfileHtml(result) : "";
    const visibleSafeCommands=cardLabSafeCommands(m);
    return `<div class="atlasHero atlasHeroDetected"><div><div class="atlasKicker">Card Intelligence · Knowledge Module Loaded</div><h3>${html(m.displayName)}</h3><p>${html(m.beginnerExplanation || m.summary || "")}</p><div class="atlasPillRow">${tagPill(m.technology)}${tagPill(m.frequency)}${tagPill(m.protocol)}${tagPill(m.application)}${parsed.uid?tagPill("UID "+parsed.uid):""}</div></div><div class="atlasScore"><span>${html(result.confidence)}%</span><small>Recognition Confidence</small></div></div>
    <div class="atlasGrid atlasIntelligenceGrid">
      <div class="atlasCard atlasActionCard" data-atlas-action="identity"><b>Identification</b><p><b>${html(result.confidenceLevel)}</b> confidence<br>${html(m.family||m.displayName)}</p><small>${alternativesText(result)}</small></div>
      <div class="atlasCard atlasActionCard" data-atlas-action="technology"><b>Technology</b><p>${html(m.technology||"")}<br>${html(m.frequency||"")}<br>${html(m.protocol||"")}</p><small>${parsed.atqa?`ATQA ${html(parsed.atqa)} · `:""}${parsed.sak?`SAK ${html(parsed.sak)}`:""}</small></div>
      <div class="atlasCard atlasActionCard" data-atlas-action="application"><b>Likely use</b><p>${html(m.application||"Unknown")}</p><small>${m.id==="emv_payment"?"Safe identification only. No payment data is needed for inventory use.":"This is a best-effort explanation based on scan output."}</small></div>
      <div class="atlasCard atlasActionCard" data-atlas-action="why"><b>Why Electron thinks this</b><ul>${reasonList(result)}</ul></div>
      <div class="atlasCard atlasActionCard" data-atlas-action="memory"><b>Memory model</b><p>${html(subtype.name||m.memoryLayout?.concept||"")}</p><small>${html(m.memoryLayout?.sectorTrailer || m.memoryLayout?.ndef || m.memoryLayout?.concept || "")}</small></div>
      <div class="atlasCard atlasActionCard" data-atlas-action="security"><b>Security profile</b><p>${html(m.security?.crypto || m.security || "Known card family")}</p><small>${attacks.length?`Known research paths: ${html(attacks.join(", "))}`:"No attack information loaded yet."}</small></div>
      <div class="atlasCard atlasActionCard" data-atlas-action="clone"><b>Clone / write guidance</b><p>${cloneable?"Possible only with compatible test tags and authorization":"Not recommended / not confirmed"}</p><small>${html(m.magicCardSupport || m.cloneSupport || "Electron stays conservative until scan data confirms safe options.")}</small></div>
      <div class="atlasCard atlasWideCard"><b>Safe Commands</b><p>Read-only PM3 commands you can inspect before running.</p>${commandButtonList(visibleSafeCommands, m.id || "")}</div>
      <div class="atlasCard atlasActionCard atlasWideCard" data-atlas-action="recommendations"><b>Recommended next actions</b><ul>${recs.map(r=>`<li>${html(r)}</li>`).join("")}</ul></div>
      <div class="atlasCard atlasActionCard" data-atlas-action="best-tool"><b>Best next tool</b><p>${html(m.uiHints?.primaryTool||"Card Intelligence")}</p><div class="atlasMiniTools">${capabilityList(m)}</div></div>
    </div>${renderKnowledgePanels(m)}${profileHtml}`;
  }


  function memoryModelFor(result, report={}){
    const m=result?.module || {};
    const id=m.id || "unknown";
    const raw=result?.parsed?.raw || "";
    const model={
      type:"generic",
      title:"Memory Explorer",
      subtitle:"Electron can describe the likely memory structure from the detected card family.",
      summary:"Memory layout is not confirmed yet.",
      items:[],
      notes:[]
    };

    if(id==="mifare_classic"){
      const is4k=/Classic\s*4K|MIFARE\s*4K/i.test(raw);
      const sectorCount=is4k ? 40 : 16;
      model.type="sectors";
      model.title=is4k ? "MIFARE Classic 4K Sector Map" : "MIFARE Classic 1K Sector Map";
      model.subtitle="MIFARE Classic memory is organised in sectors. The last block of each sector is the sector trailer with keys and access bits.";
      model.summary=is4k ? "40 sectors. Sector 0 contains manufacturer data." : "16 sectors. 64 blocks total. Sector 0 contains manufacturer data.";
      for(let i=0;i<sectorCount;i++){
        let status="unknown", label="Unknown";
        if(i===0){ status="known"; label="Manufacturer / card identity"; }
        else if(/found keys|autopwn|FFFFFFFFFFFF|key A|key B/i.test(raw)){ status="possible"; label="May be readable with known keys"; }
        else { label="Needs key check"; }
        model.items.push({index:i,name:`Sector ${i}`,status,label,blocks:i<32?4:16});
      }
      model.notes.push("A full backup requires valid sector keys.");
      model.notes.push("Sector trailers contain Key A, access bits and Key B/data depending on configuration.");
      return model;
    }

    if(id==="ntag21x" || id==="mifare_ultralight"){
      model.type="pages";
      model.title=id==="ntag21x" ? "NTAG / NFC Sticker Page Map" : "MIFARE Ultralight Page Map";
      model.subtitle="NTAG and Ultralight tags use small pages instead of MIFARE Classic sectors.";
      model.summary="Page-based memory. Early pages hold UID/manufacturer data, lock bytes and capability data.";
      const count=/NTAG216/i.test(raw)?222:/NTAG215/i.test(raw)?135:/NTAG213/i.test(raw)?45:48;
      for(let i=0;i<Math.min(count,64);i++){
        let status="unknown", label="User/data page";
        if(i<=1){status="known";label="UID / manufacturer data";}
        else if(i===2){status="known";label="Internal / lock bytes";}
        else if(i===3){status="known";label="Capability container";}
        else if(/NDEF|URI|Text record/i.test(raw)){status="possible";label="Possible NDEF/user data";}
        model.items.push({index:i,name:`Page ${i}`,status,label,blocks:1});
      }
      model.notes.push("Writing lock bytes can permanently restrict a tag.");
      model.notes.push("NDEF records, if present, should be decoded before any write action.");
      return model;
    }

    if(id==="iso15693"){
      model.type="blocks";
      model.title="ISO15693 / Vicinity Block Map";
      model.subtitle="ISO15693 cards usually expose block-based memory, but block count and size depend on the chip.";
      model.summary="Block-based memory. More ISO15693-specific commands are needed for exact block count.";
      for(let i=0;i<16;i++) model.items.push({index:i,name:`Block ${i}`,status:i===0?"known":"unknown",label:i===0?"System / manufacturer area":"Needs block read",blocks:1});
      model.notes.push("Use ISO15693 inventory/read commands for a confirmed block map.");
      model.notes.push("Do not use ISO14443 tools on ISO15693 cards.");
      return model;
    }

    if(id==="emv_payment"){
      model.type="secure-app";
      model.title="Secure Application Card";
      model.subtitle="Payment and identity smartcards do not expose a simple cloneable memory map.";
      model.summary="Application-based smartcard. Electron keeps this to safe identification and does not read/store sensitive data.";
      ["Card OS / ATS", "Application directory", "Secure applets", "Protected data", "Cryptographic functions"].forEach((name,i)=>model.items.push({index:i,name,status:i<2?"known":"protected",label:i<2?"Public/safe metadata":"Protected / not for cloning",blocks:1}));
      model.notes.push("No write or clone workflow is offered for payment/identity smartcards.");
      model.notes.push("Inventory should store only safe metadata and user notes.");
      return model;
    }

    if((m.technology||"").includes("LF")){
      model.type="lf-id";
      model.title="LF Identifier View";
      model.subtitle="Many LF tags are ID-based rather than memory-card based.";
      model.summary="Electron can usually record the identifier and later decode format/facility information when available.";
      ["Identifier", "Format", "Facility code", "Card number", "Writable test tag compatibility"].forEach((name,i)=>model.items.push({index:i,name,status:i===0?"known":"unknown",label:i===0?"Captured from LF scan":"Needs decoder support",blocks:1}));
      model.notes.push("LF clone/write options must only be used with authorised test tags.");
      return model;
    }

    model.items=[
      {index:0,name:"Identity",status:"known",label:"Card family detected",blocks:1},
      {index:1,name:"Memory",status:"unknown",label:"Needs family-specific reader",blocks:1},
      {index:2,name:"Security",status:"unknown",label:"Not enough information yet",blocks:1}
    ];
    return model;
  }

  function memoryStatusLabel(status){
    return ({known:"Known",possible:"Possible",unknown:"Unknown",protected:"Protected"}[status] || status || "Unknown");
  }

  function renderMemoryExplorerHtml(result, report={}){
    const model=memoryModelFor(result, report);
    const visibleItems=model.items || [];
    const gridClass=model.type==="sectors" ? "electronMemoryGrid sectors" : model.type==="pages" ? "electronMemoryGrid pages" : "electronMemoryGrid generic";
    return `<div class="electronMemoryExplorer">
      <div class="electronMemoryHeader">
        <div>
          <div class="atlasKicker">Memory Explorer · Card structure</div>
          <h3>${html(model.title)}</h3>
          <p>${html(model.subtitle)}</p>
        </div>
        <div class="electronMemorySummary"><b>${html(String(visibleItems.length))}</b><small>${model.type==="sectors"?"sectors shown":model.type==="pages"?"pages shown":"items shown"}</small></div>
      </div>
      <div class="electronMemoryIntro"><b>${html(model.summary)}</b></div>
      <div class="${gridClass}">
        ${visibleItems.map(item=>`<div class="electronMemoryCell mem_${html(item.status)}" title="${html(item.label)}">
          <b>${html(item.name)}</b>
          <small>${html(item.label)}</small>
          ${item.blocks?`<em>${html(item.blocks)} block${item.blocks===1?"":"s"}</em>`:""}
        </div>`).join("")}
      </div>
      ${(model.notes||[]).length?`<div class="electronMemoryNotes"><b>Memory notes</b><ul>${model.notes.map(n=>`<li>${html(n)}</li>`).join("")}</ul></div>`:""}
    </div>`;
  }


  function capabilityScan(result, report={}){
    const m=result?.module || {};
    const raw=result?.parsed?.raw || "";
    const id=m.id || "unknown";
    const caps=[];
    function add(name,status,detail){ caps.push({name,status,detail}); }

    add("Identify card", result?.status==="identified" ? "yes" : "partial", result?.status==="identified" ? "Electron identified a matching knowledge module." : "More scan data is needed.");
    add("Safe scan", "yes", "Quick Scan and Explore Card use read-only identification commands.");

    if(id==="mifare_classic"){
      add("Read card information", "yes", "hf search and hf mf info can inspect card information.");
      add("Check default keys", /key|default|FFFFFFFFFFFF|found keys|autopwn/i.test(raw) ? "yes" : "possible", "MIFARE Classic can often be checked against known/default keys.");
      add("Create backup", /dump|autopwn|found keys|sector/i.test(raw) ? "possible" : "possible", "A full backup depends on available sector keys and authorization.");
      add("Clone to test tag", /Magic|Gen1A|Chinese magic/i.test(raw) ? "possible" : "possible", "Only for cards/tags you own or are authorized to test.");
      add("Memory explorer", "yes", "A sector map is available for this card family.");
    }else if(id==="ntag21x" || id==="mifare_ultralight"){
      add("Read NDEF", "possible", "NFC Forum Type 2 tags can often contain NDEF records such as URL or text.");
      add("Open pages", "possible", "Ultralight/NTAG memory is page-based rather than sector-based.");
      add("Write", "caution", "Only write to blank/test NFC tags you own.");
      add("Memory explorer", "yes", "A page viewer is available for this card family.");
    }else if(id==="emv_payment"){
      add("Safe identification", "yes", "Electron can identify payment-card characteristics safely.");
      add("Read payment data", "no", "Electron does not need payment data for inventory/learning use.");
      add("Clone/write", "no", "Not supported and not recommended.");
      add("Store as inventory item", "yes", "You can save a safe card profile without sensitive data.");
    }else if((m.technology||"").includes("LF")){
      add("Read ID", "yes", "LF tags usually expose an identifier or facility/card code.");
      add("Decode format", "possible", "Some LF formats can be decoded when enough raw data is present.");
      add("Clone to test tag", "possible", "Only to compatible writable test tags and with authorization.");
    }else{
      add("Read details", "possible", "More technology-specific commands may improve the result.");
      add("Backup", "unknown", "Electron needs more information before recommending backup steps.");
      add("Memory explorer", "possible", "Electron shows a conservative memory model when the family supports it.");
    }
    return caps;
  }

  function statusBadge(status){
    const label={yes:"Yes",possible:"Possible",partial:"Partial",planned:"Planned",caution:"Caution",unknown:"Unknown",no:"No"}[status] || status;
    return `<span class="electronCapBadge electronCap_${html(status)}">${html(label)}</span>`;
  }

  function renderCapabilityHtml(result, report={}){
    const caps=capabilityScan(result, report);
    return `<div class="electronCapabilityGrid">${caps.map(c=>`
      <div class="electronCapabilityItem">
        <div><b>${html(c.name)}</b><small>${html(c.detail||"")}</small></div>
        ${statusBadge(c.status)}
      </div>`).join("")}</div>`;
  }

  function renderExploreReportHtml(result, report={}){
    const m=result?.module;
    const parsed=result?.parsed || {};
    const commands=Array.isArray(report.commands) ? report.commands : [];
    const safeCommands=commands.map(c=>`<li><code>${html(c.command)}</code> — ${html(c.ok ? "complete" : "check output")}</li>`).join("") || "<li>No command log available.</li>";
    const proposedSafeCommands=cardLabSafeCommands(m);
    const summary=m
      ? `${html(m.displayName)} was investigated with safe read-only commands.`
      : "Electron could not identify this card yet, but the collected output has been saved for review.";

    return `<div class="electronReport">
      <div class="electronReportHero">
        <div>
          <div class="atlasKicker">Electron Card Report · Read-only analysis</div>
          <h3>${m ? html(m.displayName) : "Unknown card"}</h3>
          <p>${summary}</p>
        </div>
        <div class="atlasScore"><span>${html(result?.confidence || 0)}%</span><small>Recognition Confidence</small></div>
      </div>

      <div class="atlasGrid atlasIntelligenceGrid">
        <div class="atlasCard"><b>Identity</b><p>${html(m?.family || m?.displayName || "Unknown")}</p><small>${parsed.uid ? "UID " + html(parsed.uid) : "UID not available"}</small></div>
        <div class="atlasCard"><b>Technology</b><p>${html(m?.technology || "Unknown")}<br>${html(m?.frequency || "")}</p><small>${html(m?.protocol || "")}</small></div>
        <div class="atlasCard"><b>Confidence</b><p>${html(result?.confidenceLevel || "Unknown")}</p><small>Recognition Confidence explains how strongly the scan matches loaded knowledge.</small></div>
        <div class="atlasCard atlasWideCard"><b>Capabilities</b>${renderCapabilityHtml(result, report)}</div>
        <div class="atlasCard atlasWideCard"><b>Safe Commands</b><p>Choose a read-only command to inspect what it does, then run it here or mirror the output to Live PM3.</p>${commandButtonList(proposedSafeCommands, m?.id || "")}</div>
        <div class="atlasCard atlasWideCard"><b>Memory Explorer</b>${renderMemoryExplorerHtml(result, report)}</div>
        <div class="atlasCard"><b>Investigation log</b><ul>${safeCommands}</ul></div>
        <div class="atlasCard atlasWideCard"><b>Recommended next actions</b><ul>${recommendationCards(result).map(r=>`<li>${html(r)}</li>`).join("")}</ul></div>
      </div>
      ${window.ElectronResearchManager ? window.ElectronResearchManager.renderLearnResearchPanel(result, report) : ""}
    </div>`;
  }


  function availableModules(){ return Object.values(state.modules || {}); }
  window.KnowledgeEngine={ init, identify, parseScanOutput, renderIntelligenceHtml, renderExploreReportHtml, renderCapabilityHtml, renderMemoryExplorerHtml, memoryModelFor, capabilityScan, recommendationCards, availableModules, openKnowledgeDetail, state, html };
})();
