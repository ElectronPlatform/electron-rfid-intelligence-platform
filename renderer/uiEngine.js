/*
 * Team Electron UI Engine v1.0
 * Central UI layer for modals, dialogs, alerts, confirmations and small notifications.
 */
(function(){
  const DEFAULT_MODAL_ID = "teamElectronModal";
  let toastTimer = null;

  function safeString(value){ return String(value ?? ""); }

  function escapeHtml(value){
    return safeString(value).replace(/[&<>"']/g, c => ({
      "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;"
    }[c]));
  }

  function remove(id){
    const el=document.getElementById(id || DEFAULT_MODAL_ID);
    if(el) el.remove();
  }

  function buttonClass(variant){
    if(variant === "danger") return "teBtn teBtnDanger";
    if(variant === "warning") return "teBtn teBtnWarning";
    if(variant === "secondary") return "teBtn teBtnSecondary";
    if(variant === "ghost") return "teBtn teBtnGhost";
    if(variant === "success") return "teBtn teBtnSuccess";
    return "teBtn teBtnPrimary";
  }

  function sizeClass(size){
    if(size === "sm") return "teModalCardSm";
    if(size === "lg") return "teModalCardLg";
    if(size === "xl") return "teModalCardXl";
    return "teModalCardMd";
  }

  function showModal(options){
    const opts=options || {};
    const id=opts.id || DEFAULT_MODAL_ID;
    remove(id);

    const overlay=document.createElement("div");
    overlay.id=id;
    overlay.className=`teModalOverlay ${opts.overlayClass || ""}`.trim();

    const card=document.createElement("div");
    card.className=`teModalCard ${sizeClass(opts.size)} ${opts.cardClass || ""}`.trim();

    const title=opts.title || "";
    const subtitle=opts.subtitle || "";
    const body=opts.body || "";
    const bodyHtml=opts.escapeBody ? escapeHtml(body) : body;
    const buttons=Array.isArray(opts.buttons) ? opts.buttons : [{text:"Close", variant:"primary", close:true}];

    card.innerHTML=`
      <div class="teModalHeader">
        <div class="teModalTitleBlock">
          ${title ? `<h3>${escapeHtml(title)}</h3>` : ""}
          ${subtitle ? `<div class="teModalSubtitle">${escapeHtml(subtitle)}</div>` : ""}
        </div>
        ${opts.showX === false ? "" : `<button type="button" class="teModalX" data-te-close="true" title="Close">×</button>`}
      </div>
      <div class="teModalBody ${opts.bodyClass || ""}">${bodyHtml}</div>
      ${opts.footer === false ? "" : `<div class="teModalFooter"></div>`}
    `;

    overlay.appendChild(card);
    document.body.appendChild(overlay);

    const footer=card.querySelector(".teModalFooter");
    if(footer){
      buttons.forEach((cfg,index)=>{
        const btn=document.createElement("button");
        btn.type="button";
        btn.id=cfg.id || `${id}_btn_${index}`;
        btn.className=buttonClass(cfg.variant);
        btn.textContent=cfg.text || "OK";
        if(cfg.title) btn.title=cfg.title;
        if(cfg.disabled) btn.disabled=true;
        btn.onclick=async()=>{
          try{
            if(cfg.onClick){
              const result=await cfg.onClick({overlay,card,button:btn,close:()=>closeModal(id)});
              if(result === false) return;
            }
            if(cfg.close !== false) closeModal(id);
          }catch(err){
            console.error("UI Engine button handler failed", err);
            showToast("Action failed: " + (err?.message || err), "error");
          }
        };
        footer.appendChild(btn);
      });
    }

    overlay.addEventListener("click", e=>{
      if(e.target === overlay && opts.closeOnOverlay !== false) closeModal(id);
      if(e.target.closest("[data-te-close='true']")) closeModal(id);
    });

    if(opts.closeOnEscape !== false){
      document.addEventListener("keydown", function escHandler(e){
        if(e.key === "Escape" && document.getElementById(id)){
          closeModal(id);
          document.removeEventListener("keydown", escHandler);
        }
      });
    }

    if(typeof opts.onOpen === "function") opts.onOpen({overlay,card,close:()=>closeModal(id)});
    return {overlay,card,close:()=>closeModal(id)};
  }

  function closeModal(id){
    const el=document.getElementById(id || DEFAULT_MODAL_ID);
    if(!el) return;
    el.classList.add("teModalClosing");
    setTimeout(()=>{ if(el.parentNode) el.remove(); }, 120);
  }

  function alertDialog(options){
    const opts=typeof options === "string" ? {body:options} : (options || {});
    return new Promise(resolve=>{
      showModal({
        id:opts.id || "teamElectronAlert",
        title:opts.title || "Message",
        body:opts.body || "",
        size:opts.size || "sm",
        buttons:[{text:opts.buttonText || "OK", variant:opts.variant || "primary", onClick:()=>resolve(true)}]
      });
    });
  }

  function confirmDialog(options){
    const opts=options || {};
    return new Promise(resolve=>{
      showModal({
        id:opts.id || "teamElectronConfirm",
        title:opts.title || "Confirm",
        body:opts.body || "",
        size:opts.size || "sm",
        closeOnOverlay:false,
        closeOnEscape:opts.closeOnEscape,
        showX:opts.showX,
        buttons:[
          {text:opts.cancelText || "Cancel", variant:"secondary", onClick:()=>resolve(false)},
          {text:opts.confirmText || "OK", variant:opts.danger ? "danger" : (opts.variant || "primary"), onClick:()=>resolve(true)}
        ]
      });
    });
  }

  function showToast(message, variant="info", timeout=2600){
    let el=document.getElementById("teamElectronToast");
    if(!el){
      el=document.createElement("div");
      el.id="teamElectronToast";
      document.body.appendChild(el);
    }
    el.className=`teToast teToast_${variant}`;
    el.textContent=safeString(message);
    el.classList.add("teToastVisible");
    if(toastTimer) clearTimeout(toastTimer);
    toastTimer=setTimeout(()=>el.classList.remove("teToastVisible"), timeout);
  }

  window.UIEngine = {
    escapeHtml,
    modal:showModal,
    showModal,
    closeModal,
    remove,
    alert:alertDialog,
    confirm:confirmDialog,
    toast:showToast
  };
})();
