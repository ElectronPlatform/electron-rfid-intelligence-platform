/*
 * Electron Full Card Report Builder v3
 *
 * Builds one structured report object from the current Card Intelligence state.
 * Export is handled by main.js so the renderer stays sandbox-safe.
 */
(function(){
  function text(value){ return String(value ?? ""); }
  function clean(value){ return text(value).trim(); }
  function list(value){
    if(Array.isArray(value)) return value.filter(v => v !== null && v !== undefined && clean(v) !== "");
    if(value === null || value === undefined || value === "") return [];
    return [value];
  }
  function first(){
    for(const value of arguments){
      if(Array.isArray(value) && value.length) return value;
      if(clean(value)) return value;
    }
    return "";
  }
  function escapeHtml(value){
    return text(value).replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
  }
  function normalizeReportText(value){
    return text(value)
      .normalize("NFKC")
      .replace(/\r\n?/g, "\n")
      .replace(/[\u2018\u2019]/g, "'")
      .replace(/[\u201C\u201D]/g, '"')
      .replace(/[\u2013\u2014]/g, "-")
      .replace(/\u2026/g, "...")
      .replace(/\u00A0/g, " ")
      .replace(/\u00E2\u0080[\u0093\u0094\u0099\u009C\u009D\u00A6]/g, "-")
      .replace(/[\u2800-\u28FF]+/g, "")
      .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "");
  }
  function stripControl(value){
    return normalizeReportText(value);
  }
  function compactLine(value){ return stripControl(value).replace(/\s+/g, " ").trim(); }
  function percent(value){
    if(value === null || value === undefined || value === "") return "Not yet calculated";
    const n=Number(value);
    return Number.isFinite(n) ? `${Math.round(n)}%` : text(value);
  }
  function displayValue(value){
    const v=clean(value);
    if(!v || /^unknown%?$/i.test(v) || /^no .*recorded/i.test(v) || /^not recorded/i.test(v)) return "";
    return v;
  }
  function unique(items){
    const seen=new Set();
    return list(items).map(x=>typeof x === "object" ? x : clean(x)).filter(x=>{
      if(typeof x === "object") return true;
      const key=x.toLowerCase();
      if(!key || seen.has(key)) return false;
      seen.add(key); return true;
    });
  }
  function section(title, lines){
    const body=list(lines).map(line=>text(line)).filter(line=>clean(line));
    if(!body.length) return "";
    return `${title}\n${"-".repeat(title.length)}\n${body.join("\n")}\n`;
  }
  function kv(label, value){
    const v=displayValue(value);
    return v ? `${label}: ${v}` : "";
  }
  function bullet(value){ return `- ${value}`; }
  function bullets(items){ return unique(items).map(item=>bullet(typeof item === "object" ? JSON.stringify(item) : item)); }
  function rowsToText(rows){
    return rows.map(row=>`${row[0]}: ${row[1]}`).filter(line=>!/:\s*$/.test(line));
  }
  function htmlSection(title, body, extraClass=""){
    if(!clean(body)) return "";
    return `<section class="report-section ${extraClass}"><h2>${escapeHtml(title)}</h2>${body}</section>`;
  }
  function htmlTable(rows){
    const filtered=rows.filter(row=>displayValue(row[1]));
    if(!filtered.length) return "";
    return `<table><tbody>${filtered.map(row=>`<tr><th>${escapeHtml(row[0])}</th><td>${escapeHtml(row[1])}</td></tr>`).join("")}</tbody></table>`;
  }
  function htmlGridTable(headers, rows){
    const filtered=rows.filter(row=>row.some(displayValue));
    if(!filtered.length) return "";
    return `<table><thead><tr>${headers.map(header=>`<th>${escapeHtml(header)}</th>`).join("")}</tr></thead><tbody>${filtered.map(row=>`<tr>${row.map(cell=>`<td>${escapeHtml(cell)}</td>`).join("")}</tr>`).join("")}</tbody></table>`;
  }
  function htmlList(items){
    const filtered=unique(items).map(item=>typeof item === "object" ? JSON.stringify(item) : item).filter(Boolean);
    if(!filtered.length) return "";
    return `<ul>${filtered.map(item=>`<li>${escapeHtml(item)}</li>`).join("")}</ul>`;
  }
  function htmlCards(rows){
    const filtered=rows.filter(row=>displayValue(row[1]));
    if(!filtered.length) return "";
    return `<div class="score-grid">${filtered.map(row=>`<div class="score-card"><span>${escapeHtml(row[0])}</span><b>${escapeHtml(row[1])}</b></div>`).join("")}</div>`;
  }
  function rawTextFromResult(result){
    return stripControl(result?.parsed?.raw || result?.raw || result?.output || "");
  }
  function truncate(value, max=9000){
    const v=stripControl(value);
    return v.length > max ? `${v.slice(0,max)}\n\n[truncated: ${v.length-max} more characters]` : v;
  }
  function safeJson(value){
    try{ return JSON.stringify(value || {}, null, 2); }
    catch{ return "{}"; }
  }
  function signatureFrom(result, intelligence){
    if(window.ElectronDatabase?.signatureFromAnalysis){
      const sig=window.ElectronDatabase.signatureFromAnalysis(result || {});
      return window.ElectronDatabase.normaliseSignature ? window.ElectronDatabase.normaliseSignature(sig) : sig;
    }
    return intelligence?.signature || result?.signature || {};
  }
  function profileFrom(result){
    if(window.CardProfileEngine?.profileFromResult) return window.CardProfileEngine.profileFromResult(result || {});
    const module=result?.module || {};
    const profile=module.cardProfile || {};
    return {
      name:first(profile.name, module.displayName),
      description:first(profile.description, module.summary, module.beginnerExplanation),
      meaning:first(profile.meaning, module.beginnerExplanation, module.summary),
      frequency:module.frequency,
      technology:module.technology,
      protocol:module.protocol,
      chipFamily:first(profile.chipFamily, module.family, module.displayName),
      manufacturers:list(profile.manufacturers || module.manufacturer),
      typicalApplications:list(profile.typicalApplications || module.typicalApplications || module.application),
      publicReadable:list(profile.publicReadableData || module.publicReadableData),
      authenticatedReadable:list(profile.authenticatedReadableData || module.authenticatedReadableData),
      normallyAbsent:list(profile.normallyAbsentData || module.normallyAbsentData),
      notVisibleReasons:list(profile.notVisibleReasons),
      compatibleHardware:list(profile.compatibleHardware || module.compatibleHardware),
      recommendedNextSteps:list(profile.recommendedNextSteps || module.safeRecommendedActions),
      safeCommands:list(profile.safePm3Commands || module.safePm3Commands),
      confidenceLevel:result?.confidenceLevel,
      scores:profile.scores || {}
    };
  }
  function readableRows(readableData){
    const rows=[];
    for(const field of list(readableData?.fields)){
      const value=field?.value ?? field?.text ?? field?.displayValue;
      if(displayValue(value)) rows.push([field.label || field.key || "Field", value, field.source || "scan"]);
    }
    if(readableData?.asciiText) rows.push(["ASCII text", readableData.asciiText, "PM3 output"]);
    if(readableData?.accessData) rows.push(["Access data", readableData.accessData, "PM3 output"]);
    return rows;
  }
  function readableRowsText(rows){ return rows.map(row=>`- ${row[0]}: ${row[1]}${row[2] ? ` (${row[2]})` : ""}`); }
  function readableRowsHtml(rows){
    if(!rows.length) return `<p>No readable personal fields were exposed by this card.</p>`;
    return `<table><thead><tr><th>Field</th><th>Value</th><th>Source</th></tr></thead><tbody>${rows.map(row=>`<tr><td>${escapeHtml(row[0])}</td><td>${escapeHtml(row[1])}</td><td>${escapeHtml(row[2] || "scan")}</td></tr>`).join("")}</tbody></table>`;
  }
  function protectedSummary(intelligence, profile){
    const protectedData=intelligence?.protectedData || {};
    const items=[];
    if(protectedData?.summary) items.push(protectedData.summary);
    if(protectedData?.access?.detected) items.push("Protected access detected: Yes");
    if(protectedData?.authorizedKeyAvailable) items.push("Authorized key available: Yes");
    items.push(...list(profile.authenticatedReadable).map(x=>`Authentication may be required for: ${x}`));
    items.push(...list(profile.notVisibleReasons));
    return unique(items);
  }
  function deviceRows(intelligence, profile){
    const devices=list(intelligence?.supportedDevices?.devices || intelligence?.supportedDevices || profile.compatibleDeviceDetails || profile.compatibleHardware);
    return devices.map(d=>{
      if(typeof d === "string") return [d, "possible", "Declared in knowledge profile"];
      return [d.name || d.id || "Device", d.support || d.status || "possible", d.note || d.notes || ""];
    });
  }
  function actionRows(intelligence, profile){
    return unique([
      ...(list(intelligence?.recommendedActions)),
      ...(list(profile.recommendedNextSteps)),
      ...(list(profile.safeCommands).map(cmd=>`Safe PM3 command: ${cmd}`))
    ]);
  }
  function alternativeRows(result){
    return list(result?.alternatives).slice(0,8).map(item=>{
      const mod=item?.module || {};
      const reasons=list(item?.reasons).map(r=>r?.label || r).filter(Boolean).join("; ");
      return [mod.displayName || mod.id || "Alternative", `${item?.score ?? ""}%`, reasons];
    });
  }
  function calculatedScores(result, profile, intelligence){
    const scores=Object.assign({}, profile.scores || {});
    const knownFields=[
      profile.name,
      profile.description,
      profile.technology,
      profile.protocol,
      profile.frequency,
      profile.chipFamily,
      list(profile.typicalApplications).length,
      list(profile.publicReadable).length,
      list(profile.compatibleHardware).length,
      list(profile.safeCommands).length
    ].filter(Boolean).length;
    if(scores.knowledgeCompleteness === undefined) scores.knowledgeCompleteness=Math.min(100, Math.round((knownFields / 10) * 100));
    if(scores.detectionConfidence === undefined && result?.confidence !== undefined) scores.detectionConfidence=result.confidence;
    if(scores.readableInformation === undefined){
      const readable=readableRows(intelligence?.readableData || {});
      const publicReadable=list(profile.publicReadable).length;
      scores.readableInformation=Math.min(100, Math.round(((readable.length || publicReadable || (result?.parsed?.uid ? 1 : 0)) / 6) * 100));
    }
    if(!scores.authenticationRequired){
      const authCount=list(profile.authenticatedReadable).length + list(profile.notVisibleReasons).length;
      scores.authenticationRequired=authCount ? "Likely / required for protected data" : "Not indicated by current scan";
    }
    if(!scores.electronConfidence){
      scores.electronConfidence=first(result?.confidenceLevel, result?.confidence ? `${result.confidence}%` : "");
    }
    return scores;
  }
  function technicalRows(result, sig, profile){
    const parsed=result?.parsed || {};
    const lf=parsed.lf || {};
    return [
      ["UID / Raw ID", first(parsed.uid, sig.uid, lf.rawId)],
      ["ATQA", parsed.atqa],
      ["SAK", parsed.sak],
      ["ATS/RATS observed", parsed.ats ? "Yes" : ""],
      ["Module", `${result?.module?.id || sig.moduleId || ""}${result?.module?.displayName ? ` / ${result.module.displayName}` : ""}`],
      ["Technology", first(profile.technology, result?.module?.technology, sig.technology)],
      ["Protocol", first(profile.protocol, result?.module?.protocol, sig.protocol)],
      ["Frequency", profile.frequency || result?.module?.frequency],
      ["Family", result?.module?.family || sig.family],
      ["Type hints", list(parsed.typeHints).join(", ")],
      ["LF primary", lf.primary?.format || lf.type],
      ["LF raw ID", lf.rawId],
      ["LF alternatives", list(lf.alternatives).length ? String(list(lf.alternatives).length) : ""],
      ["T55xx hint", lf.t55xxHint]
    ];
  }
  function buildText(data){
    const {meta,summaryRows,scoreRows,quickLines,exploreLines,profile,known,research,readable,protectedItems,devices,actions,technical,alternatives,rawPm3,rawJson}=data;
    const parts=[];
    parts.push("ELECTRON FULL CARD REPORT\n==========================\n");
    parts.push(section("Report", [kv("Generated", meta.generated), kv("Source", meta.source), kv("Report version", meta.reportVersion)]));
    parts.push(section("Card Summary", rowsToText(summaryRows)));
    parts.push(section("Knowledge Score", rowsToText(scoreRows)));
    parts.push(section("Quick Scan Result", quickLines));
    parts.push(section("Explore Card Result", exploreLines));
    parts.push(section("Card Profile", [
      kv("Description", profile.description),
      kv("Meaning", profile.meaning),
      kv("Frequency", profile.frequency),
      kv("Chip family", profile.chipFamily),
      kv("Manufacturers", list(profile.manufacturers).join(", ")),
      kv("Typical applications", list(profile.typicalApplications).join(", "))
    ]));
    parts.push(section("Known by You", known));
    parts.push(section("Research Library Matches", research));
    parts.push(section("Readable Card Data", readableRowsText(readable)));
    parts.push(section("Protected / Not Exposed Data", bullets(protectedItems)));
    parts.push(section("Compatible Devices", devices.map(d=>`- ${d[0]}: ${d[1]}${d[2] ? ` - ${d[2]}` : ""}`)));
    parts.push(section("Recommended Safe Actions", bullets(actions)));
    parts.push(section("Technical Summary", rowsToText(technical)));
    parts.push(section("Possible Related Technologies", alternatives.map(a=>`- ${a[0]}: score ${a[1]}${a[2] ? ` - ${a[2]}` : ""}`)));
    if(rawPm3) parts.push(section("Appendix A - Raw PM3 Output", [truncate(rawPm3, 30000)]));
    parts.push(section("Appendix B - Raw JSON", [truncate(rawJson, 30000)]));
    return parts.filter(Boolean).join("\n");
  }
  function htmlCss(){
    return `@page{size:A4;margin:14mm 14mm 20mm}*{box-sizing:border-box}body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Arial,sans-serif;margin:0;color:#111827;line-height:1.45;font-size:13px;-webkit-print-color-adjust:exact;print-color-adjust:exact}h1{font-size:28px;margin:0 0 8px}h2{font-size:18px;margin:0 0 10px;border-bottom:1px solid #d1d5db;padding-bottom:6px;break-after:avoid;page-break-after:avoid}.muted{color:#6b7280}.cover{border:1px solid #d1d5db;border-radius:8px;padding:18px;margin-bottom:22px;background:#f9fafb;break-inside:avoid;page-break-inside:avoid}.score-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin:10px 0;break-inside:avoid;page-break-inside:avoid}.score-card{border:1px solid #d1d5db;border-radius:8px;padding:10px;background:#fff;min-width:0}.score-card span{display:block;font-size:12px;color:#6b7280}.score-card b{display:block;font-size:17px;overflow-wrap:anywhere}table{width:100%;border-collapse:collapse;margin:10px 0 16px;table-layout:fixed;break-inside:auto;page-break-inside:auto}thead{display:table-header-group}tbody{display:table-row-group}tr{break-inside:avoid;page-break-inside:avoid}th,td{border:1px solid #e5e7eb;padding:7px 9px;vertical-align:top;text-align:left;overflow-wrap:anywhere;word-break:break-word}th{background:#f3f4f6;width:32%}ul{margin:8px 0 16px;padding-left:20px}li{margin:3px 0;overflow-wrap:anywhere;break-inside:avoid;page-break-inside:avoid}pre{white-space:pre-wrap;overflow-wrap:anywhere;word-break:break-word;background:#111827;color:#f9fafb;padding:12px;border-radius:8px;font-size:10.5px;line-height:1.35;break-inside:auto;page-break-inside:auto}.appendix pre{max-height:none}.report-section{margin:0 0 20px;break-inside:auto;page-break-inside:auto}.report-section h2 + *{break-before:avoid;page-break-before:avoid}.footer{margin-top:28px;border-top:1px solid #e5e7eb;padding-top:8px;font-size:11px;color:#6b7280;break-inside:avoid;page-break-inside:avoid}.generated-note{margin-top:28px;border-top:1px solid #d1d5db;padding-top:10px;font-size:11px;color:#475569;break-inside:avoid;page-break-inside:avoid}.page-break{break-before:page;page-break-before:always}@media(max-width:720px){.score-grid{grid-template-columns:1fr}body{font-size:12px}}`;
  }
  function buildHtml(data, options={}){
    const pdfMode=options.pdf === true;
    const {meta,summaryRows,scoreRows,quickLines,exploreLines,profile,known,research,readable,protectedItems,devices,actions,technical,alternatives,rawPm3,rawJson}=data;
    const appConfig=(typeof window !== "undefined" && window.ElectronAppConfig) ? window.ElectronAppConfig : {};
    const appDisplayName=appConfig.APP_DISPLAY_NAME || `${appConfig.APP_NAME || "Electron"} ${appConfig.APP_SUBTITLE || "RFID Intelligence Platform"}`;
    const body=[];
    body.push(`<div class="cover"><h1>Electron Full Card Report</h1><p class="muted">Generated ${escapeHtml(meta.generated)} | Source ${escapeHtml(meta.source)}${pdfMode ? ` | Report Format Version ${escapeHtml(meta.reportFormatVersion)}` : ""}</p>${htmlTable(summaryRows)}${htmlCards(scoreRows)}</div>`);
    body.push(htmlSection("Quick Scan Result", htmlList(quickLines)));
    body.push(htmlSection("Explore Card Result", htmlList(exploreLines)));
    body.push(htmlSection("Card Profile", htmlTable([
      ["Description", profile.description],
      ["Meaning", profile.meaning],
      ["Frequency", profile.frequency],
      ["Chip family", profile.chipFamily],
      ["Manufacturers", list(profile.manufacturers).join(", ")],
      ["Typical applications", list(profile.typicalApplications).join(", ")]
    ])));
    body.push(htmlSection("Known by You", htmlList(known)));
    body.push(htmlSection("Research Library Matches", htmlList(research)));
    body.push(htmlSection("Readable Card Data", readableRowsHtml(readable)));
    body.push(htmlSection("Protected / Not Exposed Data", htmlList(protectedItems)));
    body.push(htmlSection("Compatible Devices", htmlGridTable(["Device", "Support", "Notes"], devices)));
    body.push(htmlSection("Recommended Safe Actions", htmlList(actions)));
    body.push(htmlSection("Technical Summary", htmlTable(technical), "page-break"));
    if(alternatives.length) body.push(htmlSection("Possible Related Technologies", htmlGridTable(["Technology", "Score", "Reason"], alternatives)));
    if(rawPm3) body.push(htmlSection("Appendix A - Raw PM3 Output", `<pre>${escapeHtml(truncate(rawPm3, 50000))}</pre>`, "appendix page-break"));
    body.push(htmlSection("Appendix B - Raw JSON", `<p class="muted">Raw JSON is intentionally not printed in the PDF/DOC report to keep the report readable. Use the TXT export when a complete machine-readable debug appendix is needed.</p>`, "appendix"));
    body.push(`<div class="footer">${escapeHtml(appDisplayName)} | Generated by Electron RFID Intelligence Platform | ${escapeHtml(meta.reportVersion)}</div>`);
    if(pdfMode) body.push(`<div class="generated-note">Generated by ${escapeHtml(appDisplayName)}</div>`);
    return `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(meta.title)}</title><style>${htmlCss()}</style></head><body>${body.filter(Boolean).join("\n")}</body></html>`;
  }
  function build(options){
    const result=options?.result || {};
    const intelligence=options?.intelligence || {};
    const context=options?.context || {};
    const sig=signatureFrom(result, intelligence);
    const profile=profileFrom(result);
    const now=new Date();
    const rawPm3=first(rawTextFromResult(result), context.pm3Output);
    const scores=calculatedScores(result, profile, intelligence);
    const title=first(sig.displayName, profile.name, result?.module?.displayName, "Unknown card");
    const signatureId=first(sig.signatureId, sig.id, result?.signatureId, "unknown-signature");
    const meta={
      title:`Electron Card Report - ${title}`,
      generated:now.toLocaleString(),
      source:first(result?.source, context.sourceLabel, context.source, "current-card"),
      reportVersion:"Full Card Report v3",
      reportFormatVersion:"1.0"
    };
    const summaryRows=[
      ["Name", title],
      ["Signature", signatureId],
      ["Technology", first(profile.technology, sig.technology, result?.module?.technology)],
      ["Protocol", first(profile.protocol, sig.protocol, result?.module?.protocol)],
      ["Family", first(sig.family, result?.module?.family, profile.chipFamily)],
      ["Confidence", result?.confidence ? `${result.confidence}% (${first(result.confidenceLevel, profile.confidenceLevel)})` : first(result?.confidenceLevel, profile.confidenceLevel)]
    ];
    const scoreRows=[
      ["Knowledge Completeness", percent(scores.knowledgeCompleteness)],
      ["Detection Confidence", percent(scores.detectionConfidence || result?.confidence)],
      ["Readable Information", percent(scores.readableInformation)],
      ["Authentication Required", scores.authenticationRequired || "Not yet calculated"],
      ["Electron Confidence", scores.electronConfidence || first(result?.confidenceLevel, "Not yet calculated")]
    ];
    const quickLines=[
      kv("Status", result?.status || "identified"),
      kv("Module", result?.module?.id || sig.moduleId),
      ...(result?.reasons || []).map(r=>bullet(r?.label || r)).filter(Boolean)
    ];
    const exploreLines=[];
    if(context?.report?.mode) exploreLines.push(kv("Mode", context.report.mode));
    if(context?.report?.startedAt) exploreLines.push(kv("Started", context.report.startedAt));
    if(context?.report?.finishedAt) exploreLines.push(kv("Finished", context.report.finishedAt));
    for(const command of list(context?.report?.commands)){
      exploreLines.push(bullet(`${command.command || command.name || "command"} - ${command.status || "complete"}${command.label ? ` (${command.label})` : ""}`));
    }
    const known=[];
    const k=intelligence?.knownByYou;
    if(k){
      known.push(kv("Nickname", k.nickname)); known.push(kv("Owner", k.owner)); known.push(kv("Category", k.category)); known.push(kv("Location", k.location));
      if(list(k.tags).length) known.push(kv("Tags", list(k.tags).join(", ")));
      if(k.notes) known.push(kv("Notes", k.notes));
    }
    const research=list(intelligence?.researchMatches).map(m=>`${m.record?.name || "Research record"}${m.record?.use ? ` (${m.record.use})` : ""}${m.score ? ` - match ${m.score}%` : ""}`);
    const readable=readableRows(intelligence?.readableData || window.ElectronResearchManager?.readableCardData?.(result) || {});
    const protectedItems=protectedSummary(intelligence, profile);
    const devices=deviceRows(intelligence, profile);
    const actions=actionRows(intelligence, profile);
    const technical=technicalRows(result, sig, profile);
    const alternatives=alternativeRows(result);
    const rawJson=safeJson({result,intelligence,context,signature:sig,profile});
    const data={meta,summaryRows,scoreRows,quickLines,exploreLines,profile,known,research,readable,protectedItems,devices,actions,technical,alternatives,rawPm3,rawJson};
    const textReport=buildText(data);
    const htmlReport=buildHtml(data);
    const pdfHtmlReport=buildHtml(data, {pdf:true});
    const baseName=`electron-card-report-${signatureId}-${now.toISOString().slice(0,16).replace(/[-:T]/g,"")}`.replace(/[^a-z0-9._-]+/gi,"-");
    return {title:meta.title, baseName, text:textReport, html:htmlReport, pdfHtml:pdfHtmlReport, json:rawJson, reportFormatVersion:meta.reportFormatVersion};
  }
  window.CardReportBuilder={build};
})();
