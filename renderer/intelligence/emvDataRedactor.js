/*
 * EMV Data Redactor
 *
 * Extracts a deliberately small set of human-readable EMV metadata. Full PAN,
 * Track 1/2 data, cardholder names, verification values and transaction-log
 * contents never leave this module.
 */
(function(root,factory){
  const api=factory();
  if(typeof module!=="undefined" && module.exports) module.exports=api;
  if(root) root.EmvDataRedactor=api;
})(typeof window!=="undefined" ? window : globalThis,function(){
  const VERSION="1.2.0";
  function text(value){ return String(value ?? ""); }
  function plain(value){ return text(value).replace(/\x1b\[[0-9;]*m/g,"").replace(/\r/g,""); }
  function unique(values){ return [...new Set(values.filter(Boolean))]; }
  function cleanLabel(value){
    return text(value).replace(/[\u0000-\u001f\u007f]/g," ").replace(/\s+/g," ").trim().slice(0,80);
  }
  function compactDigits(value){ return text(value).replace(/\D/g,""); }
  function validPan(value){
    const digits=compactDigits(value).replace(/F+$/i,"");
    return /^\d{12,19}$/.test(digits) ? digits : "";
  }
  function maskedAccount(value){
    const pan=validPan(value);
    return pan ? `•••• ${pan.slice(-4)}` : "";
  }
  function lineValues(source,labelPattern){
    const values=[];
    const pattern=new RegExp(`(?:^|\\n)\\s*(?:\\[[^\\]]+\\]\\s*)?(?:${labelPattern})\\s*(?:\\.{2,}|[:=])\\s*([^\\n]+)`,`gim`);
    for(const match of source.matchAll(pattern)) values.push(cleanLabel(match[1]));
    return unique(values);
  }
  function panCandidates(source){
    const values=[];
    for(const line of lineValues(source,"PAN(?!\\s+Sequence)")){
      const candidate=validPan(line);
      if(candidate) values.push(candidate);
    }
    const tagged=/(?:Application Primary Account Number(?: \(PAN\))?|\b5A\b)[^\n]{0,80}?((?:\d[\s:]*){12,19}F?)/gim;
    const decodedSource=source.replace(/^.*<<<<.*$/gm,"");
    for(const match of decodedSource.matchAll(tagged)){
      const candidate=validPan(match[1]);
      if(candidate) values.push(candidate);
    }
    return unique(values);
  }
  function track2Candidates(source){
    const values=[];
    const pattern=/(?:^|\n)\s*(?:\[[^\]]+\]\s*)?Track\s*2(?:\s+Equivalent(?:\s+Data)?)?\.*\s*[:=]?\s*([0-9A-F =;]{20,80})/gim;
    for(const match of source.matchAll(pattern)){
      const candidate=validTrack2(match[1]);
      if(candidate) values.push(candidate);
    }
    return unique(values);
  }
  function validTrack2(value){
    const candidate=text(value).replace(/[\s;]/g,"").toUpperCase();
    return /^[0-9]{12,19}[D=][0-9]{4}[0-9A-F]*$/.test(candidate) ? candidate : "";
  }
  function panFromTrack2(value){ return validPan(text(value).split(/[D=]/i)[0]); }
  function expiryFromTrack2(value){
    const match=text(value).match(/[D=](\d{2})(\d{2})/i);
    return match ? `${match[2]}/${match[1]}` : "";
  }
  function expiryFromApplicationDate(value){
    const match=text(value).replace(/[^0-9]/g,"").match(/^(\d{2})(0[1-9]|1[0-2])(\d{2})$/);
    return match ? `${match[2]}/${match[1]}` : "";
  }
  function normalizedExpiry(value){
    const source=cleanLabel(value);
    let match=source.match(/\(\s*(0[1-9]|1[0-2])\/(\d{2})\s*\)/);
    if(match) return `${match[1]}/${match[2]}`;
    match=source.match(/\b(0[1-9]|1[0-2])\/(\d{2})\b/);
    if(match) return `${match[1]}/${match[2]}`;
    match=source.match(/\b(?:20)?(\d{2})[-/.](0[1-9]|1[0-2])(?:[-/.]\d{2})?\b/);
    if(match) return `${match[2]}/${match[1]}`;
    match=source.match(/\b(\d{2})(\d{2})\b/);
    return match && /^(?:0[1-9]|1[0-2])$/.test(match[2]) ? `${match[2]}/${match[1]}` : "";
  }
  function normalizedDate(value){
    const source=cleanLabel(value);
    let match=source.match(/\b(20\d{2})[-/.](\d{1,2})[-/.](\d{1,2})\b/);
    if(match) return `${match[1]}-${match[2].padStart(2,"0")}-${match[3].padStart(2,"0")}`;
    match=source.match(/\b(\d{2})(\d{2})(\d{2})\b/);
    return match ? `20${match[1]}-${match[2]}-${match[3]}` : "";
  }
  function withoutLogPrefixes(value){ return plain(value).replace(/^(?:\[[^\]]+\]\s*)+/gm,""); }
  function tlvBlocks(source,name){
    const expected=text(name).toLowerCase();
    return withoutLogPrefixes(source).split(/\n(?=\s*--[0-9a-f]+\[[0-9a-f]+\])/i).filter(block=>block.toLowerCase().includes(`'${expected}':`));
  }
  function decodeHexText(value){
    const hex=text(value).replace(/[^0-9A-F]/gi,"");
    if(!hex || hex.length%2) return "";
    let result="";
    for(let index=0;index<hex.length;index+=2){
      const code=parseInt(hex.slice(index,index+2),16);
      if(code===0) continue;
      if(code<32 || code>126) return "";
      result+=String.fromCharCode(code);
    }
    return cleanLabel(result);
  }
  function tlvStringValues(source,name){
    return unique(tlvBlocks(source,name).map(block=>{
      const match=block.match(/String value\s+'([0-9A-F ]+)'/i);
      return match ? decodeHexText(match[1]) : "";
    }));
  }
  function tlvNumericValues(source,name){
    return unique(tlvBlocks(source,name).map(block=>block.match(/Numeric value\s+(\d+)/i)?.[1] || ""));
  }
  function tlvDateValues(source,name){
    return unique(tlvBlocks(source,name).map(block=>normalizedDate(block.match(/Date:\s*([^\n]+)/i)?.[1] || "")));
  }
  function tlvHexValues(source,name){
    return unique(tlvBlocks(source,name).map(block=>{
      const match=block.match(/(?:^|\n)\s*[0-9a-f]{2}:\s*((?:[0-9a-f]{2}\s+){1,16})\s*\|/i);
      return match ? match[1].replace(/\s/g,"").toUpperCase() : "";
    }));
  }
  function rawResponseTlvValues(source,wantedTag){
    const expected=text(wantedTag).replace(/[^0-9A-F]/gi,"").toUpperCase();
    const values=[];
    function parse(bytes,start=0,end=bytes.length,depth=0){
      if(depth>8) return;
      let index=start;
      while(index<end){
        const first=bytes[index++];
        if(first===undefined) return;
        let tag=first.toString(16).padStart(2,"0").toUpperCase();
        if((first&0x1f)===0x1f){
          let complete=false;
          while(index<end){
            const next=bytes[index++];
            tag+=next.toString(16).padStart(2,"0").toUpperCase();
            if((next&0x80)===0){ complete=true; break; }
          }
          if(!complete) return;
        }
        if(index>=end) return;
        let length=bytes[index++];
        if(length&0x80){
          const count=length&0x7f;
          if(!count || count>3 || index+count>end) return;
          length=0;
          for(let offset=0;offset<count;offset++) length=(length<<8)|bytes[index++];
        }
        if(length<0 || index+length>end) return;
        const value=bytes.slice(index,index+length);
        index+=length;
        if(tag===expected) values.push(value.map(byte=>byte.toString(16).padStart(2,"0")).join("").toUpperCase());
        if(first&0x20) parse(value,0,value.length,depth+1);
      }
    }
    const pattern=/(?:^|\n)[^\n]*<<<<\s+((?:[0-9A-F]{2}\s+){2,})/gim;
    for(const match of plain(source).matchAll(pattern)){
      const bytes=match[1].trim().split(/\s+/).map(value=>parseInt(value,16));
      if(bytes.every(Number.isFinite)) parse(bytes);
    }
    return unique(values);
  }
  function searchTableApplications(source){
    const entries=[];
    const pattern=/^\|\s*((?:[0-9A-F]{2}\s*){5,16})\|\s*([0-9A-F]{0,2})\s*\|\s*([^|]*)\|/gim;
    for(const match of withoutLogPrefixes(source).matchAll(pattern)){
      const aid=match[1].replace(/\s/g,"").toUpperCase();
      if(!/^[0-9A-F]{10,32}$/.test(aid) || aid.length%2 || !/[A-F]/.test(aid)) continue;
      const priority=parseInt(match[2] || "",16);
      entries.push({aid,priority:Number.isFinite(priority) ? priority&0x0f : null,label:cleanLabel(match[3])});
    }
    return entries;
  }
  function currencyLabel(value){
    const code=text(value).replace(/\D/g,"").padStart(3,"0").slice(-3);
    const known={"036":"AUD","124":"CAD","156":"CNY","392":"JPY","554":"NZD","826":"GBP","840":"USD","978":"EUR"};
    return code ? (known[code] ? `${known[code]} (${code})` : code) : "";
  }
  function decodeAip(value){
    const hex=text(value).replace(/[^0-9A-F]/gi,"").toUpperCase();
    if(!/^[0-9A-F]{4}$/.test(hex)) return [];
    const first=parseInt(hex.slice(0,2),16);
    const second=parseInt(hex.slice(2,4),16);
    const definitions=[
      [first,0x40,"SDA"],
      [first,0x20,"DDA"],
      [first,0x10,"Cardholder verification"],
      [first,0x08,"Terminal risk management"],
      [first,0x04,"Issuer authentication"],
      [first,0x01,"CDA"],
      [second,0x80,"MSD"]
    ];
    return definitions.filter(([byte,mask])=>(byte&mask)!==0).map(([, ,label])=>label);
  }
  function aipCapabilities(source){
    const allowed=["SDA supported","DDA supported","Cardholder verification is supported","Terminal risk management is to be performed","Issuer authentication is supported","CDA supported (Combined Dynamic Data Authentication / Application Cryptogram Generation)","MSD is supported (Magnetic Stripe Data)"];
    const blocks=tlvBlocks(source,"Application Interchange Profile").join("\n");
    const decodedText=allowed.filter(label=>blocks.includes(`'${label}'`)).map(label=>label.replace(" is supported","").replace(" supported","").replace(/ \(.+\)$/,""));
    const rawValues=unique([...tlvHexValues(source,"Application Interchange Profile"),...rawResponseTlvValues(source,"82")]);
    return unique([...decodedText,...rawValues.flatMap(decodeAip)]);
  }
  function decodeAuc(value){
    const hex=text(value).replace(/[^0-9A-F]/gi,"").toUpperCase();
    if(!/^[0-9A-F]{4}$/.test(hex)) return [];
    const first=parseInt(hex.slice(0,2),16);
    const second=parseInt(hex.slice(2,4),16);
    if(second&0x3f) return [];
    const definitions=[
      [first,0x80,"Domestic cash"],
      [first,0x40,"International cash"],
      [first,0x20,"Domestic goods"],
      [first,0x10,"International goods"],
      [first,0x08,"Domestic services"],
      [first,0x04,"International services"],
      [first,0x02,"ATMs"],
      [first,0x01,"Terminals other than ATMs"],
      [second,0x80,"Domestic cashback"],
      [second,0x40,"International cashback"]
    ];
    return definitions.filter(([byte,mask])=>(byte&mask)!==0).map(([, ,label])=>label);
  }
  function bcdCountryCode(value){
    const hex=text(value).replace(/[^0-9A-F]/gi,"").toUpperCase();
    if(!/^\d{4}$/.test(hex)) return "";
    const numeric=Number(hex);
    return Number.isInteger(numeric) && numeric>0 && numeric<=999 ? String(numeric).padStart(3,"0") : "";
  }
  function normalizedCountryCode(value){
    const candidate=cleanLabel(value);
    if(/^\d{1,3}$/.test(candidate)){
      const numeric=Number(candidate);
      return numeric>0 && numeric<=999 ? String(numeric).padStart(3,"0") : "";
    }
    return /^[A-Z]{2,3}$/i.test(candidate) ? candidate.toUpperCase() : "";
  }
  function countryLabel(value){
    const code=normalizedCountryCode(value);
    const known={"036":"Australia","528":"Netherlands"};
    return code ? (known[code] ? `${known[code]} (${code})` : code) : "";
  }
  function aidValues(source){
    const values=[];
    const pattern=/(?:^|\n)[^\n]*(?:\bAID\b|ADF Name|Dedicated File \(DF\) Name)[^\n]{0,50}?((?:[0-9A-F]{2}[ :.-]*){5,16})/gim;
    for(const match of source.matchAll(pattern)){
      const value=match[1].replace(/[^0-9A-F]/gi,"").toUpperCase();
      if(/^[0-9A-F]{10,32}$/.test(value) && value.length%2===0 && /[A-F]/.test(value)) values.push(value);
    }
    for(const value of tlvHexValues(source,"Application Dedicated File (ADF) Name")){
      if(/^[0-9A-F]{10,32}$/.test(value) && value.length%2===0 && /[A-F]/.test(value)) values.push(value);
    }
    return unique(values);
  }
  function cardholderNamePresent(source){
    return lineValues(source,"Cardhold(?:er)? Name").some(value=>{
      const candidate=cleanLabel(value);
      if(!candidate || /^(?:[/\\|._-]+|N\/?A|NONE|NULL|UNKNOWN|NOT (?:PRESENT|AVAILABLE))$/i.test(candidate)) return false;
      return /[\p{L}\p{N}]/u.test(candidate);
    });
  }
  function paymentNetwork(labels,aids){
    const fromAid=value=>value.startsWith("A000000003")?"Visa":value.startsWith("A000000004")?"Mastercard":value.startsWith("A000000025")?"American Express":value.startsWith("A000000152")?"Discover":value.startsWith("A000000065")?"JCB":value.startsWith("A000000333")?"UnionPay":"";
    const fromLabel=value=>/\bvisa\b|paywave/i.test(value)?"Visa":/mastercard|maestro|paypass/i.test(value)?"Mastercard":/american express|\bamex\b/i.test(value)?"American Express":/discover/i.test(value)?"Discover":/\bjcb\b/i.test(value)?"JCB":/unionpay/i.test(value)?"UnionPay":"";
    return unique([...aids.map(fromAid),...labels.map(fromLabel)]).join(" + ");
  }
  function safeText(value){
    return cleanLabel(value).replace(/\b\d(?:[\s-]*\d){11,18}\b/g,match=>maskedAccount(match) || "[redacted]");
  }
  function extract(value){
    const source=plain(value);
    const tableApplications=searchTableApplications(source);
    const tracks=unique([
      ...track2Candidates(source),
      ...rawResponseTlvValues(source,"57").map(validTrack2)
    ]);
    const pans=unique([
      ...panCandidates(source),
      ...rawResponseTlvValues(source,"5A").map(validPan),
      ...tracks.map(panFromTrack2)
    ]);
    const labels=unique([
      ...lineValues(source,"Application(?! Preferred Name)"),
      ...lineValues(source,"(?:Application )?Label"),
      ...tlvStringValues(source,"Application Label"),
      ...tableApplications.map(item=>item.label)
    ]).map(safeText).filter(Boolean);
    const preferredNames=unique([...lineValues(source,"Application Preferred Name"),...tlvStringValues(source,"Application Preferred Name")]).map(safeText).filter(Boolean);
    const aids=unique([...aidValues(source),...tableApplications.map(item=>item.aid)]);
    const explicitExpiry=lineValues(source,"(?:Application )?(?:Expiration|Expiry) date").map(normalizedExpiry).find(Boolean) || "";
    const tlvExpiry=tlvDateValues(source,"Application Expiration Date").map(normalizedExpiry).find(Boolean) || "";
    const rawExpiry=rawResponseTlvValues(source,"5F24").map(expiryFromApplicationDate).find(Boolean) || "";
    const expiry=explicitExpiry || tlvExpiry || rawExpiry || tracks.map(expiryFromTrack2).find(Boolean) || "";
    const effectiveDate=lineValues(source,"(?:Application )?Effective date").map(normalizedDate).find(Boolean) || tlvDateValues(source,"Application Effective Date")[0] || "";
    const languages=unique([...lineValues(source,"Language(?: Preference)?"),...tlvStringValues(source,"Language Preference")]).map(value=>safeText(value).slice(0,20));
    const currencyValues=lineValues(source,"(?:Application )?Currency(?: Code)?").map(value=>safeText(value).slice(0,40));
    const tlvCurrencies=tlvNumericValues(source,"Application Currency Code").map(currencyLabel);
    const currencies=unique([...currencyValues,...tlvCurrencies]);
    const issuerCountries=unique([
      ...tlvStringValues(source,"Issuer Country Code (alpha2 format)"),
      ...tlvStringValues(source,"Issuer Country Code (alpha3 format)"),
      ...tlvNumericValues(source,"Issuer Country Code"),
      ...rawResponseTlvValues(source,"5F28").map(bcdCountryCode)
    ]).map(countryLabel).filter(Boolean);
    const applicationVersion=tlvHexValues(source,"Application Version Number")[0] || "";
    const priorities=unique([
      ...tableApplications.map(item=>item.priority==null?"":String(item.priority)),
      ...tlvHexValues(source,"Application Priority Indicator").map(value=>String(parseInt(value.slice(0,2),16)&0x0f))
    ]).filter(value=>/^(?:[1-9]|1[0-5])$/.test(value));
    const capabilities=aipCapabilities(source);
    const serviceCode=lineValues(source,"Service code").find(value=>/^\d{3}$/.test(value)) || "";
    const usage=unique(rawResponseTlvValues(source,"9F07").flatMap(decodeAuc));
    const kernelIdentifier=unique([
      ...tlvHexValues(source,"Kernel Identifier"),
      ...rawResponseTlvValues(source,"9F2A")
    ]).find(value=>/^[0-9A-F]{2}$/.test(value)) || "";
    const last4=pans[0]?.slice(-4) || "";
    const network=paymentNetwork(labels,aids);
    const fields=[];
    const add=(key,label,value)=>{ if(value) fields.push({key,label,value,category:"application",source:"EMV Extended Analysis",authentication:"public"}); };
    add("paymentNetwork","Payment network",network);
    add("applicationLabel","Application label",labels[0]);
    add("applicationPreferredName","Preferred name",preferredNames[0]);
    add("applicationAid","Application AID",aids[0]);
    add("applicationCount","Applications found",aids.length?String(aids.length):"");
    add("applicationAidList","Application AIDs",aids.length>1?aids.slice(0,6).join(" · "):"");
    add("applicationList","Available applications",labels.length>1?labels.slice(0,4).join(" · "):"");
    add("applicationPriority",priorities.length>1?"Application priorities":"Application priority",priorities.join(" · "));
    add("accountReference","Account reference",last4?`•••• ${last4}`:"");
    add("expiryMonthYear","Expiry",expiry);
    add("effectiveDate","Effective date",effectiveDate);
    add("emvLanguage","Language",languages[0]);
    add("emvCurrency","Currency",currencies[0]);
    add("issuerCountry","Issuer country",issuerCountries[0]);
    add("applicationVersion","Application version",applicationVersion?`0x${applicationVersion}`:"");
    add("aipCapabilities","Public capabilities",capabilities.length?capabilities.join(" · "):"");
    add("serviceCode","Service code",serviceCode);
    add("applicationUsage","Application usage",usage.length?usage.join(" · "):"");
    add("kernelIdentifier","Kernel identifier",kernelIdentifier);
    add("track2Presence","Track 2 data",tracks.length?"Present (full value not stored)":"");
    add("panPresence","PAN",pans.length?"Detected (only last four digits retained)":"");
    add("transactionLogPresence","Transaction log",/transaction\s+log|Logs EMV|Log Entry|Log Format/i.test(source)?"Present (contents not stored)":"");
    return {
      schemaVersion:VERSION,
      fields,
      applicationLabels:labels.slice(0,8),
      applicationPreferredNames:preferredNames.slice(0,8),
      aids:aids.slice(0,16),
      applicationPriorities:priorities.slice(0,16),
      aipCapabilities:capabilities,
      paymentNetwork:network,
      accountLast4:last4,
      maskedAccount:last4?`•••• ${last4}`:"",
      expiryMonthYear:expiry,
      panPresent:pans.length>0,
      track2Present:tracks.length>0,
      cardholderNamePresent:cardholderNamePresent(source),
      transactionLogPresent:/transaction\s+log|Logs EMV|Log Entry|Log Format/i.test(source),
      rawOutputStored:false
    };
  }
  function consoleSummary(metadata){
    const value=metadata?.fields ? metadata : extract(metadata);
    const lines=value.fields.map(field=>`${field.label}: ${field.value}`);
    lines.push("Privacy: full PAN, Track 1/2, cardholder name, verification values and transaction-log contents were not shown or stored.");
    return lines.join("\n");
  }
  function containsSensitivePaymentData(value){
    const source=plain(value);
    return panCandidates(source).length>0 || track2Candidates(source).length>0 || /Cardhold(?:er)? Name(?:\.{2,}|\s*[:=])\s*\S+/i.test(source);
  }
  return {version:VERSION,plain,validPan,maskedAccount,extract,consoleSummary,containsSensitivePaymentData};
});
