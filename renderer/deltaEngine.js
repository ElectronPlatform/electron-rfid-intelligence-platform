(function(){
  function safeString(v){
    return String(v ?? "");
  }

  function escapeHtml(v){
    return safeString(v).replace(/[&<>"']/g, c => ({
      "&":"&amp;",
      "<":"&lt;",
      ">":"&gt;",
      '"':"&quot;",
      "'":"&#39;"
    }[c]));
  }

  function comparableFields(allFields, ignoredFields){
    const ignored = new Set(ignoredFields || []);
    return (allFields || []).filter(f => !ignored.has(f));
  }

  function diffObjects(before, after, options){
    const opts = options || {};
    const fieldList = comparableFields(opts.fields || Object.keys(after || before || {}), opts.ignoreFields || []);
    const labelMap = opts.labels || {};

    return fieldList
      .map(field => {
        const beforeValue = safeString(before && Object.prototype.hasOwnProperty.call(before, field) ? before[field] : "");
        const afterValue = safeString(after && Object.prototype.hasOwnProperty.call(after, field) ? after[field] : "");

        return {
          field,
          label: labelMap[field] || field,
          beforeValue,
          afterValue,
          changed: beforeValue !== afterValue
        };
      })
      .filter(row => row.changed);
  }

  function assetStatus(before, after, options){
    if(!before) return "New";
    return diffObjects(before, after, options).length ? "Changed" : "Identical";
  }

  function close(){
    const old=document.getElementById("deltaEngineOverlay");
    if(old) old.remove();
  }

  function show(options){
    const opts=options || {};
    const before=opts.before || null;
    const after=opts.after || null;
    const title=opts.title || "Review Changes Before Import";
    const subtitle=opts.subtitle || "";
    const beforeLabel=opts.beforeLabel || "Current inventory";
    const afterLabel=opts.afterLabel || "Import file";
    const diffs=diffObjects(before, after, opts);

    close();

    const overlay=document.createElement("div");
    overlay.id="deltaEngineOverlay";
    overlay.className="logDetailModal";

    const card=document.createElement("div");
    card.className="logDetailCard";

    const bodyHtml = !before
      ? `<div class="matchPanel good"><b>New record</b><br>This RFID tag does not exist in the current inventory. It will be added as a new RFID tag.</div>`
      : !diffs.length
        ? `<div class="matchPanel"><b>No changes</b><br>No field differences found.</div>`
        : `
          <div class="logDiffSummary">${escapeHtml(diffs.length)} changed field${diffs.length===1 ? "" : "s"}</div>
          <div class="logDiffRawGrid">
            ${diffs.map(d=>`
              <div>
                <div class="logDiffSummary">${escapeHtml(d.label)}</div>
                <div class="logChangeCell">
                  <span class="compactChangeLine">
                    <span class="changeLabel previousLabel">Previous</span>
                    <span class="changeText">${escapeHtml(d.beforeValue)}</span>
                  </span>
                  <span class="compactChangeLine">
                    <span class="changeLabel newLabel">New</span>
                    <span class="changeText">${escapeHtml(d.afterValue)}</span>
                  </span>
                </div>
              </div>
            `).join("")}
          </div>
        `;

    card.innerHTML=`
      <div class="logDetailHeader">
        <div>
          <h3>${escapeHtml(title)}</h3>
          ${subtitle ? `<div class="small">${escapeHtml(subtitle)}</div>` : ""}
        </div>
        <button id="deltaEngineCloseBtn">Close</button>
      </div>
      <div class="logDetailBody">
        ${bodyHtml}
      </div>
    `;

    overlay.appendChild(card);
    document.body.appendChild(overlay);

    document.getElementById("deltaEngineCloseBtn").onclick=close;
    overlay.onclick=e=>{ if(e.target===overlay) close(); };
  }

  window.DeltaEngine = {
    diffObjects,
    assetStatus,
    show,
    close,
    escapeHtml
  };
})();
