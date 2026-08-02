/*
 * Card Viewer Advanced Workflow Result Builder
 *
 * Converts completed family workflows into records without touching the DOM.
 * Sensitive EMV/SEOS workflows retain metadata only; authenticated reads retain
 * only the output produced by their explicitly authenticated read step.
 */
(function(root,factory){
  const redactor=typeof module!=="undefined" && module.exports ? require("./emvDataRedactor") : root?.EmvDataRedactor;
  const api=factory(redactor);
  if(typeof module!=="undefined" && module.exports) module.exports=api;
  if(root) root.AdvancedWorkflowResultBuilder=api;
})(typeof window!=="undefined" ? window : globalThis,function(emvRedactor){
  const VERSION="1.2.0";
  const EMV_DIAGNOSTIC_VERSION="1.0.0";
  const EMV_DIAGNOSTIC_FIELDS=[
    {key:"pan",label:"Card number (PAN)",retainedWhenDetected:"last-four-only"},
    {key:"track2",label:"Track 2 data",retainedWhenDetected:"presence-only"},
    {key:"expiry",label:"Expiry",retainedWhenDetected:"month-year"},
    {key:"issuerCountry",label:"Issuer country",retainedWhenDetected:"country-only"}
  ];
  function text(value){ return String(value ?? ""); }
  function output(item){ return text(item?.result?.stdout)+text(item?.result?.stderr); }
  function displayCommand(item){ return text(item?.displayCommand || item?.step?.displayCommand || item?.command).trim(); }
  function commandMetadata(item){
    return {
      command:displayCommand(item),
      phase:text(item?.phase || item?.step?.phase || "read"),
      ok:item?.result?.ok===true,
      status:text(item?.result?.status || (item?.result?.ok?"completed":"failed")),
      outputLength:output(item).length
    };
  }
  function baseRecord(context={}){
    const results=Array.isArray(context.results)?context.results:[];
    return {
      schemaVersion:VERSION,
      signature:context.signature || {},
      profile:{id:text(context.profile?.id),label:text(context.profile?.label),band:text(context.profile?.band)},
      workflowType:text(context.plan?.workflowType || "extended-analysis"),
      workflowTitle:text(context.plan?.title || "Extended Analysis"),
      strategy:{id:text(context.strategy?.id),label:text(context.strategy?.label),riskLevel:text(context.strategy?.riskLevel || "low")},
      status:context.cancelled?"cancelled":results.some(item=>item?.result?.ok)?"completed":"failed",
      privacyClass:text(context.plan?.privacyClass || "standard"),
      persistPolicy:text(context.plan?.persistPolicy || "metadata-only"),
      commands:results.map(commandMetadata),
      createdAt:context.createdAt || new Date().toISOString()
    };
  }
  function emvFieldDetected(metadata,key){
    if(key==="pan") return metadata?.panPresent===true;
    if(key==="track2") return metadata?.track2Present===true;
    if(key==="expiry") return !!text(metadata?.expiryMonthYear);
    if(key==="issuerCountry") return Array.isArray(metadata?.fields) && metadata.fields.some(item=>item?.key==="issuerCountry" && text(item?.value).trim());
    return false;
  }
  function buildEmvDiagnostics(results,combinedMetadata){
    const commandResults=(Array.isArray(results)?results:[]).map(item=>{
      const command=displayCommand(item);
      if(!/^emv\s+(?:pse|search|reader)\b/i.test(command)) return null;
      const metadata=emvRedactor?.extract?.(output(item));
      return {
        command,
        ok:item?.result?.ok===true,
        detectedFields:EMV_DIAGNOSTIC_FIELDS.filter(field=>emvFieldDetected(metadata,field.key)).map(field=>field.key)
      };
    }).filter(Boolean);
    return {
      schemaVersion:EMV_DIAGNOSTIC_VERSION,
      parserVersion:text(emvRedactor?.version || ""),
      commandsChecked:commandResults.map(item=>item.command).filter(Boolean),
      fields:EMV_DIAGNOSTIC_FIELDS.map(field=>{
        const commands=commandResults.filter(item=>item.detectedFields.includes(field.key)).map(item=>item.command).filter(Boolean);
        const detected=emvFieldDetected(combinedMetadata,field.key);
        return {
          key:field.key,
          label:field.label,
          detected,
          retained:detected ? field.retainedWhenDetected : "none",
          commands
        };
      })
    };
  }
  function buildMetadataRecord(context={}){
    const record=baseRecord(context);
    const results=Array.isArray(context.results)?context.results:[];
    const combinedOutput=results.map(output).join("\n");
    const emvMetadata=record.profile.id==="emv" ? emvRedactor?.extract?.(combinedOutput) : null;
    return {
      ...record,
      rawOutputStored:false,
      metadataFields:Array.isArray(emvMetadata?.fields)?emvMetadata.fields:[],
      emvDiagnostics:emvMetadata ? buildEmvDiagnostics(results,emvMetadata) : null,
      metadata:emvMetadata ? {
        schemaVersion:emvMetadata.schemaVersion,
        applicationLabels:emvMetadata.applicationLabels,
        aids:emvMetadata.aids,
        paymentNetwork:emvMetadata.paymentNetwork,
        accountLast4:emvMetadata.accountLast4,
        maskedAccount:emvMetadata.maskedAccount,
        expiryMonthYear:emvMetadata.expiryMonthYear,
        panPresent:emvMetadata.panPresent,
        track2Present:emvMetadata.track2Present,
        cardholderNamePresent:emvMetadata.cardholderNamePresent,
        transactionLogPresent:emvMetadata.transactionLogPresent,
        rawOutputStored:false
      } : null,
      summary:record.status==="completed"
        ? `${record.workflowTitle} completed. ${emvMetadata?.fields?.length || 0} redacted metadata field${emvMetadata?.fields?.length===1?"":"s"} retained; sensitive raw card output was not stored.`
        : `${record.workflowTitle} did not complete. Sensitive raw card output was not stored.`
    };
  }
  function buildAuthenticatedReadRecord(context={}){
    const record=baseRecord(context);
    const authenticated=(Array.isArray(context.results)?context.results:[]).filter(item=>(item?.phase || item?.step?.phase)==="authenticated-read");
    const successful=authenticated.filter(item=>item?.result?.ok===true && output(item).trim());
    const protectedOutput=successful.map(item=>`[Card Viewer ${record.workflowTitle}]\n${displayCommand(item)}\n${output(item)}`).join("\n");
    const target=text(context.strategy?.target || "Authorized target");
    return {
      signature:record.signature,
      scanProfile:record.profile,
      workflow:{type:record.workflowType,title:record.workflowTitle,strategy:record.strategy,persistPolicy:record.persistPolicy},
      status:successful.length?"success":"failed",
      message:successful.length?`Authenticated bounded read succeeded for ${target}.`:`No successful authenticated bounded read was confirmed for ${target}.`,
      stats:{authenticatedReads:successful.length,totalReads:authenticated.length,readableSectors:0,totalSectors:0,keyResults:0},
      commands:record.commands,
      keys:[],
      access:successful.length?[{label:target,status:"readable",detail:"The explicitly targeted authenticated read succeeded"}]:[],
      output:protectedOutput,
      debug:{pm3Invoked:record.commands.length>0,pm3Calls:record.commands.length,outputLength:protectedOutput.length,scanProfile:record.profile.id},
      createdAt:record.createdAt
    };
  }
  return {version:VERSION,commandMetadata,buildMetadataRecord,buildAuthenticatedReadRecord};
});
