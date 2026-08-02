/*
 * Electron PM3 Command Safety
 *
 * This is the single place where Electron manages blocked Proxmark3 command
 * patterns for user-entered or UI-triggered commands.
 *
 * To add a new block:
 * - Add one object to blockedPatterns.
 * - Keep the pattern specific enough to avoid blocking harmless read-only tools.
 * - Write the reason in user-facing language; it is shown in Live PM3/status UI.
 *
 * To add an exception:
 * - Prefer a narrow exception through allowedContexts on the specific rule.
 * - Pass that context from the caller, for example:
 *   Pm3CommandSafety.validate(command, {context:"authorized-read"})
 * - Do not add broad exceptions unless the workflow performs its own checks.
 */
(function(){
  const CUSTOM_STORAGE_KEY="electron.pm3CommandSafety.customBlocks.v1";

  function text(value){ return String(value ?? ""); }
  function cleanCommand(command){ return text(command).trim().replace(/\s+/g, " "); }
  function escapeRegExp(value){ return text(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }

  const blockedPatterns=[


  ];

  const exceptions=[
    {
      id:"read-only-pm3-basics",
      pattern:/^\s*(hf|lf)\s+(search|list)\b/i,
      reason:"Read-only discovery command."
    },
    {
      id:"read-only-info",
      pattern:/^\s*hf\s+[\w-]+\s+info\b/i,
      reason:"Read-only information command."
    },
    {
      id:"hardware-version",
      pattern:/^\s*hw\s+version\b/i,
      reason:"Reads Proxmark3 hardware/software version."
    }
  ];

  function readCustomBlocks(){
    try{
      const items=JSON.parse(localStorage.getItem(CUSTOM_STORAGE_KEY) || "[]");
      return Array.isArray(items) ? items.filter(item=>text(item?.patternText).trim()) : [];
    }catch{
      return [];
    }
  }

  function writeCustomBlocks(items){
    localStorage.setItem(CUSTOM_STORAGE_KEY, JSON.stringify(Array.isArray(items) ? items : [], null, 2));
  }

  function compileCustomPattern(patternText){
    const raw=text(patternText).trim();
    const regexMatch=raw.match(/^\/(.+)\/([a-z]*)$/i);
    if(regexMatch){
      try{ return new RegExp(regexMatch[1], regexMatch[2] || "i"); }catch{}
    }
    const parts=raw.split(/\s+/).map(escapeRegExp).filter(Boolean);
    return new RegExp("^\\s*" + parts.join("\\s+") + "\\b", "i");
  }

  function customRules(){
    return readCustomBlocks().map(item=>{
      let pattern;
      try{ pattern=compileCustomPattern(item.patternText); }catch{ pattern=/a^/; }
      return {
        id:item.id || `custom-${Date.now()}`,
        pattern,
        patternText:item.patternText,
        reason:item.reason || "Blocked by your custom PM3 safety rule.",
        custom:true
      };
    });
  }

  function saveCustomBlock(data){
    const patternText=text(data?.patternText).trim();
    if(!patternText) return {ok:false,message:"Enter a command or pattern first."};
    const reason=text(data?.reason).trim() || "Blocked by your custom PM3 safety rule.";
    try{ compileCustomPattern(patternText); }catch(err){ return {ok:false,message:String(err?.message || err)}; }
    const items=readCustomBlocks();
    const item={
      id:data?.id || `custom_${Date.now()}`,
      patternText,
      reason,
      createdAt:data?.createdAt || new Date().toISOString(),
      updatedAt:new Date().toISOString()
    };
    const idx=items.findIndex(x=>x.id===item.id);
    if(idx>=0) items[idx]=item; else items.unshift(item);
    writeCustomBlocks(items);
    return {ok:true,item};
  }

  function deleteCustomBlock(id){
    const before=readCustomBlocks();
    const after=before.filter(item=>item.id!==id);
    writeCustomBlocks(after);
    return {ok:after.length!==before.length};
  }

  function matchingException(command){
    const cmd=cleanCommand(command);
    return exceptions.find(item=>item.pattern.test(cmd)) || null;
  }

  function matchingBlock(command, options={}){
    const cmd=cleanCommand(command);
    for(const rule of [...customRules(), ...blockedPatterns]){
      if(!rule.pattern.test(cmd)) continue;
      if((rule.allowedContexts || []).includes(options.context)) continue;
      return rule;
    }
    return null;
  }

  function validate(command, options={}){
    const cmd=cleanCommand(command);
    if(!cmd) return {allowed:false, command:cmd, reason:"No PM3 command provided.", ruleId:"empty-command"};
    const block=matchingBlock(cmd, options);
    if(block) return {allowed:false, command:cmd, reason:block.reason, ruleId:block.id, rule:block};
    const exception=matchingException(cmd);
    if(exception) return {allowed:true, command:cmd, exception};
    return {allowed:true, command:cmd};
  }

  function validateAll(commands, options={}){
    return (Array.isArray(commands) ? commands : []).map(command=>validate(command, options));
  }

  function blockedMessage(result){
    if(!result || result.allowed) return "";
    return `Command blocked: ${result.reason || "This PM3 command is not allowed in this workflow."}`;
  }

  function listRules(){
    return {
      builtIn:blockedPatterns.map(rule=>({id:rule.id, reason:rule.reason, patternText:text(rule.pattern), custom:false})),
      custom:readCustomBlocks().map(rule=>({...rule, custom:true}))
    };
  }

  window.Pm3CommandSafety={
    blockedPatterns,
    exceptions,
    cleanCommand,
    validate,
    validateAll,
    blockedMessage,
    listRules,
    readCustomBlocks,
    saveCustomBlock,
    deleteCustomBlock
  };
})();
