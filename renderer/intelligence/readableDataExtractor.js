/*
 * Electron Readable Data Extractor
 *
 * Converts fields that were actually present in parsed data or PM3 output
 * into a small structured contract. Knowledge records may describe a card,
 * but they never become "readable card data" by themselves.
 */
(function(){
  function text(value){ return String(value ?? ""); }
  function clean(value){
    if(value === null || value === undefined) return "";
    if(Array.isArray(value)) return value.map(clean).filter(Boolean).join(", ");
    if(typeof value === "object") return "";
    return text(value).trim();
  }
  function key(value){ return text(value).toLowerCase().replace(/[^a-z0-9]+/g, ""); }
  function firstFromObject(source, aliases){
    if(!source || typeof source !== "object" || Array.isArray(source)) return "";
    const lookup=new Map(Object.keys(source).map(name=>[key(name),name]));
    for(const alias of aliases){
      const actual=lookup.get(key(alias));
      if(!actual) continue;
      const value=clean(source[actual]);
      if(value) return value;
    }
    return "";
  }
  function rawValue(raw, labels){
    for(const label of labels){
      const escaped=label.replace(/[.*+?^${}()|[\]\\]/g,"\\$&");
      const match=text(raw).match(new RegExp(`(?:^|\\n)\\s*(?:\\[.\\]\\s*)?${escaped}\\s*(?:[:=]|\\.{2,})\\s*([^\\r\\n]+)`,"i"));
      if(match){
        const value=clean(match[1]).replace(/\s+\[(?:source|status):.*$/i,"").trim();
        if(value && !/^(?:not reported|unknown|not available|none)$/i.test(value)) return value;
      }
    }
    return "";
  }
  function normaliseDefinitionValue(value,definition){
    const candidate=clean(value);
    if(!candidate) return "";
    if(definition?.format==="hex"){
      return /^(?:0x)?[0-9a-f]+(?:[ :.-]+(?:0x)?[0-9a-f]+)*$/i.test(candidate) ? candidate.toUpperCase() : "";
    }
    return candidate;
  }

  const DEFINITIONS=[
    {key:"cardType",label:"Card type",category:"basic",aliases:["cardType","credentialType","cardSubtype","productType"],raw:["Card type","Credential type"]},
    {key:"atqa",label:"ATQA",category:"technical",format:"hex",aliases:["atqa","answerToRequestA"],raw:["ATQA"]},
    {key:"sak",label:"SAK",category:"technical",format:"hex",aliases:["sak","selectAcknowledgement"],raw:["SAK"]},
    {key:"ats",label:"ATS",category:"technical",format:"hex",aliases:["ats","answerToSelect"],raw:["ATS"]},
    {key:"name",label:"Name",category:"personal",aliases:["name","fullName","cardholderName","holderName","employeeName"],raw:["Name","Full name","Cardholder name","Employee name"]},
    {key:"firstName",label:"First name",category:"personal",aliases:["firstName","givenName","forename"],raw:["First name","Given name"]},
    {key:"lastName",label:"Last name",category:"personal",aliases:["lastName","surname","familyName"],raw:["Last name","Surname","Family name"]},
    {key:"room",label:"Room",category:"access",aliases:["room","roomNumber","hotelRoom"],raw:["Room","Room number"]},
    {key:"checkIn",label:"Check-in",category:"access",aliases:["checkIn","checkInDate"],raw:["Check-in","Check in"]},
    {key:"checkOut",label:"Check-out",category:"access",aliases:["checkOut","checkOutDate"],raw:["Check-out","Check out"]},
    {key:"department",label:"Department",category:"employment",aliases:["department","division","team"],raw:["Department","Division","Team"]},
    {key:"role",label:"Role",category:"employment",aliases:["role","jobTitle","function","position"],raw:["Role","Function","Job title","Position"]},
    {key:"email",label:"Email",category:"personal",aliases:["email","emailAddress","mail"],raw:["Email","Email address"]},
    {key:"employeeNumber",label:"Employee number",category:"employment",aliases:["employeeNumber","personnelNumber","staffNumber","employeeId"],raw:["Employee number","Personnel number","Staff number","Employee ID"]},
    {key:"dateOfBirth",label:"Date of birth",category:"personal",aliases:["dateOfBirth","dob","birthDate"],raw:["Date of birth","Birth date"]},
    {key:"issueDate",label:"Issue date",category:"validity",aliases:["issueDate","dateOfIssue","issued","issuedAt"],raw:["Issue date","Date of issue"]},
    {key:"validFrom",label:"Valid from",category:"validity",aliases:["validFrom","validFromDate"],raw:["Valid from"]},
    {key:"expiryDate",label:"Valid until",category:"validity",aliases:["expiryDate","expirationDate","expires","expiresAt","validUntil","validTo"],raw:["Valid until","Valid to","Expiry date","Expiration date"]},
    {key:"issuer",label:"Issuer",category:"application",aliases:["issuer","issuingAuthority","authority","issuerName"],raw:["Issuer","Issuing authority"]},
    {key:"cardNumber",label:"Card number",category:"application",aliases:["cardNumber","documentNumber","licenceNumber","licenseNumber","idNumber"],raw:["Card number","Document number","ID number"]},
    {key:"application",label:"Application",category:"application",aliases:["application","applicationLabel","aidLabel","appName","use"],raw:["Application","Application label","Use"]},
    {key:"balance",label:"Balance",category:"stored-value",requiresAuthentication:true,aliases:["balance","cardBalance","purseBalance","storedValue","balanceAmount"],raw:["Balance","Card balance","Purse balance","Stored value"]},
    {key:"currency",label:"Currency",category:"stored-value",requiresAuthentication:true,aliases:["currency","balanceCurrency"],raw:["Currency","Balance currency"]},
    {key:"access",label:"Access",category:"access",aliases:["access","accessRights","permissions","zones"],raw:["Access","Access rights","Permissions","Zones"]},
    {key:"status",label:"Status",category:"validity",aliases:["credentialStatus","validityStatus"],raw:["Credential status","Validity status"]},
    {key:"ndefText",label:"NDEF text",category:"application",aliases:["text","ndefText","payloadText"],raw:["NDEF text","Payload text"]},
    {key:"ndefUrl",label:"NDEF URL",category:"application",aliases:["url","uri","ndefUrl"],raw:["NDEF URL","NDEF URI"]}
  ];

  function sourceObjects(result){
    const parsed=result?.parsed || {};
    return [
      {value:parsed.readableData,source:"parsed-readable-data"},
      {value:parsed.application,source:"parsed-application"},
      {value:parsed.ndef,source:"parsed-ndef"},
      {value:result?.applicationData,source:"application-data"},
      {value:result?.ndef,source:"ndef-data"},
      {value:parsed,source:"parsed-scan"},
      {value:result,source:"analysis"}
    ];
  }

  function extract(result){
    const parsed=result?.parsed || {};
    const raw=text(parsed.raw || result?.raw || result?.output || "");
    const authenticated=/\[Electron authorized read\]|authentication\s+success/i.test(raw);
    const fields=[];
    for(const definition of DEFINITIONS){
      let value="";
      let source="";
      for(const candidate of sourceObjects(result)){
        value=normaliseDefinitionValue(firstFromObject(candidate.value,definition.aliases),definition);
        if(value){ source=candidate.source; break; }
      }
      if(!value && raw){
        value=normaliseDefinitionValue(rawValue(raw,definition.raw),definition);
        if(value) source=authenticated ? "authorized-read-output" : "pm3-output";
      }
      if(value) fields.push({
        key:definition.key,
        label:definition.label,
        value,
        category:definition.category || "other",
        exposed:true,
        source,
        authentication:authenticated ? "authenticated" : definition.requiresAuthentication ? "authentication-required" : "not-required-or-not-reported"
      });
    }
    return {
      fields,
      availableCount:fields.length,
      unavailableExpected:["Name","Issue date","Valid until","Issuer","Card number"],
      authentication:{confirmed:authenticated,source:authenticated?"authorized-read-output":"not-reported"},
      notice:"Only information exposed by the card or decoded from captured PM3 output is shown. Protected or encrypted fields are not guessed or bypassed."
    };
  }

  window.ReadableDataExtractor={extract,normaliseDefinitionValue};
})();
