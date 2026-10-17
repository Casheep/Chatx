/* ChatGPT DOM adapter. No private API, hidden state, or credentials. */
(() => {
  const COMPOSERS = '#prompt-textarea,#mobile-composer-prompt,textarea[data-mobile-composer-prompt],[data-composer-markdown][contenteditable="true"]';
  const SEND = '[data-testid="send-button"],button[aria-label="发送消息"],button[aria-label="发送"],button[aria-label="Send"],button[aria-label="Send message"],button[aria-label="Send prompt"]';
  const STOP = '[data-testid="stop-button"],button[aria-label="Stop streaming"],button[aria-label="停止流式传输"],button[aria-label="停止生成"],button[aria-label="停止"],button[aria-label="Stop"],button[aria-label="Stop generating"]';
  function visible(element) {
    if(!element?.isConnected || element.closest('[hidden],[aria-hidden="true"]')) return false;
    const style=getComputedStyle(element);
    return style.display!=='none' && style.visibility!=='hidden' && element.getClientRects().length>0;
  }
  function unique(elements, label) {
    const candidates=[...new Set(elements)].filter(visible);
    if(candidates.length>1) throw new Error('发现多个可见'+label+'，未自动选择，请手动粘贴结果');
    return candidates[0] || null;
  }
  function composer() {
    const editable=element=>!element.disabled && !element.readOnly &&
      element.getAttribute('aria-disabled')!=='true' &&
      (element instanceof HTMLTextAreaElement || element.isContentEditable);
    const known=unique([...document.querySelectorAll(COMPOSERS)].filter(editable), 'Chat 输入框');
    if(known)return known;
    // Renderer variants can change IDs. Only use semantic editors inside a
    // form containing a recognized send control; never pick an arbitrary editor.
    return unique([...document.querySelectorAll('form textarea,form [contenteditable="true"][role="textbox"],form [contenteditable="true"][data-lexical-editor="true"]')]
      .filter(element=>editable(element) && element.closest('form').querySelector(SEND)), 'Chat 输入框');
  }
  function sendButton(box) {
    const scope=box?.closest('form') || document;
    return unique([...scope.querySelectorAll(SEND)].filter(e=>!e.disabled && e.getAttribute('aria-disabled')!=='true'),'发送按钮');
  }
  function streaming() { return [...document.querySelectorAll(STOP)].some(visible); }
  function conversationIdentity() {
    const ids=[...new Set([...document.querySelectorAll('[data-chatgpt-selection-conversation-id]')]
      .map(e=>e.getAttribute('data-chatgpt-selection-conversation-id')).filter(Boolean))];
    return ids.length===1?ids[0]:null;
  }
  function routeConversation(path) {
    return path.match(/\/(?:c|uc)\/([^/]+)\/?$/)?.[1] || null;
  }
  function draftText(box) { return box ? (box.value || box.innerText || '') : ''; }
  function assistantMessages() {
    const candidates=[...document.querySelectorAll('[data-message-author-role="assistant"],[data-message-role="assistant"],article[data-turn="assistant"],[data-speaker="assistant"],[data-markdown-text-style="assistant-message"]')];
    // Mixed renderers may put both roles on nested nodes; return each message once.
    return candidates.filter(element=>!candidates.some(parent=>parent!==element && parent.contains(element)));
  }
  function userMessages() {
    const candidates=[...document.querySelectorAll('[data-message-author-role="user"],[data-message-role="user"],[data-user-message-bubble],article[data-turn="user"],[data-speaker="user"],[data-markdown-text-style="user-message"]')];
    for(const heading of document.querySelectorAll('[data-conversation-role="user"]')) {
      const turn=heading.closest('[data-content-search-unit-key]');
      if(turn)candidates.push(turn);
    }
    return [...new Set(candidates)];
  }
  function completeMessage(message) {
    if(message.getAttribute('aria-busy')==='true') return false;
    // The current lightweight renderer explicitly marks completed messages.
    if(message.matches('li[data-message-role]')) return message.hasAttribute('data-message-complete');
    if(message.matches('[data-is-streaming="true"],[data-streaming="true"]'))return false;
    return true;
  }
  function taskBlocks(message) {
    // Some renderers use pre > div instead of pre > code, or a language wrapper.
    const nodes=[...message.querySelectorAll('pre,[data-language="json"],code.language-json,[data-testid="code-block"]')];
    // A plain JSON assistant reply may have no code element at all. The protocol
    // parser still requires valid JSON, the exact session and a known tool.
    if(!nodes.length)nodes.push(message);
    return nodes.filter(e=>!nodes.some(parent=>parent!==e && parent.contains(e))).map(node=>{
      const code=node.querySelector('code');
      const raw=(code || node).textContent.trim();
      const start=raw.indexOf('{'),end=raw.lastIndexOf('}');
      return {node,text:start>=0 && end>start?raw.slice(start,end+1):raw};
    });
  }
  function insertText(text) {
    const box=composer();
    if(!box) throw new Error('找不到可用 Chat 输入框，请复制结果手动粘贴');
    if(draftText(box).trim()) throw new Error('输入框已有内容，未覆盖。请发送或清空后重试');
    box.focus();
    if(box instanceof HTMLTextAreaElement) {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(box,text);
      box.dispatchEvent(new Event('input',{bubbles:true}));
    } else {
      const selection=window.getSelection(),range=document.createRange();
      range.selectNodeContents(box);selection.removeAllRanges();selection.addRange(range);
      if(!document.execCommand('insertText',false,text)) throw new Error('编辑器未接受文本，请复制后粘贴');
    }
    // contenteditable editors can add paragraph breaks and NBSP indentation.
    // Verify all inserted characters independent of display whitespace; later
    // auto-send compares the exact resulting draft to detect user edits.
    const compact=value=>value.replace(/\s/g,'');
    if(compact(draftText(box))!==compact(text)) throw new Error('回填未确认，请复制结果手动粘贴');
    return box;
  }
  function diagnostics() {
    let input=null,error=null;
    try{input=composer();}catch(e){error=e.message;}
    // Only structural data; never return draft content, page text, cookies or session tokens.
    return {input:input?{tag:input.tagName,id:input.id,contenteditable:input.isContentEditable}:null,
      input_error:error,streaming:streaming(),assistant_count:assistantMessages().length,
      editors:[...document.querySelectorAll('textarea,[contenteditable="true"],[role="textbox"]')].slice(0,20).map(e=>({
        tag:e.tagName,id:e.id,role:e.getAttribute('role'),visible:visible(e),editable:e.isContentEditable,
        disabled:!!e.disabled,readonly:!!e.readOnly,in_form:!!e.closest('form'),
        has_send:!!e.closest('form')?.querySelector(SEND)}))};
  }
  globalThis.ChatxDom={composer,sendButton,streaming,conversationIdentity,routeConversation,assistantMessages,userMessages,completeMessage,taskBlocks,text:draftText,insertText,diagnostics};
})();
