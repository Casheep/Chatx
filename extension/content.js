(() => {
  if (window.top !== window || document.getElementById('chatx-root')) return;
  const P = globalThis.ChatxProtocol;
  const D = globalThis.ChatxDom;
  const state = {armed:false, session:'', route:location.pathname, pending:null, result:null,
    busy:false, queued:new Set(), baseline:new WeakSet(), seen:new Map(), job:null, epoch:0, autoCount:0,
    conversation:null, navigation:null, awaitingFirstRoute:false,starting:false,recovering:false,recoverySeen:new Set(),outbox:null,sending:false,retryAt:0,activeRequest:null};
  const host = document.createElement('div');
  host.id = 'chatx-root';
  host.dataset.chatxVersion='0.1.16';
  document.documentElement.append(host);
  // Open shadow keeps styles isolated while exposing standard controls to
  // accessibility tools and background browser automation.
  const shadow = host.attachShadow({mode:'open'});
  shadow.innerHTML = `<style>
    :host { all:initial; font:13px/1.55 system-ui,sans-serif; color:#e6edf3; }
    * { box-sizing:border-box; } button,input,textarea { font:inherit; }
    #widget {position:fixed;right:18px;bottom:18px;z-index:2147483647;width:310px;max-width:calc(100vw - 36px);padding:14px;border:1px solid #344957;border-radius:14px;background:#111c25;box-shadow:0 5px 25px #0005}
    #widget .row {margin:0 0 10px} #widget strong{font-size:14px} #widget label{font-size:12px;margin:0 0 5px}
    #pythonPath {box-sizing:border-box;width:100%;padding:8px;border:1px solid #405767;border-radius:7px;background:#0a131b;color:#e6edf3;font:12px/1.5 ui-monospace,monospace}
    #liveStatus {margin-top:9px;color:#b7c9d5;font-size:12px;overflow-wrap:anywhere;display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden}
    #launcher {flex:0!important;white-space:nowrap;border:1px solid #647179;border-radius:16px;padding:6px 12px;background:#26313a;color:#c6d0d8;cursor:pointer}
    #launcher[aria-checked="true"] {background:#193a38;color:#dcfff7;border-color:#4b9f85}
    #launcher[data-busy="true"] {animation:chatx-pulse 1.2s ease-in-out infinite}
    #fold {flex:0!important;white-space:nowrap;padding:5px 8px;font-size:12px}
    #widget[data-collapsed="true"] {width:245px;padding:10px 12px}
    #widget[data-collapsed="true"] .row {margin-bottom:0}
    @keyframes chatx-pulse {50%{opacity:.55}}
    #panel { position:fixed; right:18px; top:78px; width:370px; max-width:calc(100vw - 36px); max-height:calc(100vh - 100px); overflow:auto; z-index:2147483647; background:#111c25; border:1px solid #344957; border-radius:18px; box-shadow:0 14px 60px #0007; padding:19px; }
    [hidden] { display:none!important; } h1 {font-size:18px;margin:0} h2 {font-size:14px;margin:17px 0 8px} p {margin:8px 0;color:#acbfcc} .row {display:flex;gap:8px;align-items:center;margin:9px 0} .row>* {flex:1} .row button {white-space:nowrap}
    button {border:1px solid #405767;border-radius:9px;background:#213442;color:#e6edf3;padding:8px 10px;cursor:pointer} button.primary {background:#247268;border-color:#398e82} button.danger {color:#ffbdb4} button:disabled{opacity:.45;cursor:default}
    pre,textarea {white-space:pre-wrap;word-break:break-word;background:#0a131b;border:1px solid #283f4f;border-radius:8px;color:#c8e7d6;padding:10px;font:12px/1.5 ui-monospace,monospace;width:100%;max-height:230px;overflow:auto} textarea {height:120px;resize:vertical} label {display:block;margin:9px 0;color:#b7c9d5} input[type=checkbox] {margin-right:7px} #status {padding:9px 11px;border-radius:9px;background:#1c303e;white-space:pre-wrap;word-break:break-word} #log {font-size:12px;color:#9bb0bf;max-height:85px;overflow:auto} .badge {font-size:11px;color:#85c6ba} .close {flex:0!important} a {color:#88d7c3}
  </style>
  <section id="widget" aria-label="Chatx 本机助手">
    <div class="row"><strong>Chatx</strong><button id="launcher" role="switch" aria-checked="false" aria-label="启用本机助手" title="点击开启本机助手">已关闭</button><button id="fold" aria-expanded="true" aria-controls="environment" aria-label="收起环境设置">收起</button></div>
    <div id="environment">
    <label for="pythonPath">Python 环境路径（PyTorch 所在环境）</label>
    <input id="pythonPath" type="text" aria-label="Python 环境路径" placeholder="C:\\路径\\venv\\Scripts\\python.exe" spellcheck="false">
    <button id="reconnect" style="margin-top:8px;width:100%" title="重新检测并恢复当前对话连接">恢复连接</button>
    </div>
    <div id="liveStatus" role="status">正在读取本机环境…</div>
  </section>
  <section id="panel" hidden>
    <div class="row"><div><h1>Chatx</h1><span class="badge">本地计算 · 0.1.16 预览版</span></div><button id="close" class="close">收起</button></div>
    <div id="status">尚未连接。先安装本地宿主，再检查连接。</div>
    <div class="row"><button id="connect">检查连接</button><button id="arm" class="primary" disabled>启用当前对话</button></div>
    <button id="diagnose">复制页面识别诊断</button>
    <p>文件保存在本机。Python / 终端使用你的系统账号权限，工作目录不等于沙箱。</p>
    <p>启用后自动执行本机任务并回传结果，可读写文件和运行程序；点击“停用对话”即可停止后续操作。</p>
    <details><summary>调试设置</summary>
    <label><input id="auto" type="checkbox" checked>自动回传结果</label>
    <label><input id="autoRun" type="checkbox" checked>自动执行任务</label>
    </details>
    <h2>文件直接放本地</h2>
    <input id="file" type="file" multiple>
    <p>不上传原始文件到 ChatGPT；可将文件路径告知 Chat。</p>
    <h2>待执行操作</h2><button id="scan">从最新回复读取任务</button><pre id="proposal">启用后，将连接说明发送给 Chat。仅识别本次启用后新生成的助手指令。</pre>
    <div class="row"><button id="approve" class="primary" disabled>执行这条操作</button><button id="reject" disabled>拒绝</button></div>
    <div class="row"><button id="cancel" class="danger" disabled>取消当前任务</button><button id="stop" disabled>停用对话</button></div>
    <h2>结果与进度</h2><pre id="output">等待任务</pre>
    <div class="row"><button id="insert" disabled>填入 Chat</button><button id="copy" disabled>复制结果</button></div>
    <details><summary>手动导入指令 / 恢复任务</summary><p>网页识别失效时，粘贴助手的 JSON。恢复任务可导入 job_status 调用。</p><textarea id="manual" placeholder="粘贴 JSON 指令" spellcheck="false"></textarea><button id="paste">从剪贴板粘贴指令</button><button id="parse">检查并加入待执行</button></details>
    <h2>活动</h2><div id="log"></div>
  </section>`;
  const $ = id => shadow.getElementById(id);
  // Keep page-level keyboard/paste shortcuts out of our local editor. Do not
  // prevent defaults here: browser-native typing, selection and paste still work.
  for(const type of ['keydown','keyup','keypress','beforeinput','input','paste','copy','cut'])
    shadow.addEventListener(type,event=>event.stopPropagation());
  $('manual').addEventListener('paste',event=>{
    const text=event.clipboardData?.getData('text/plain');
    if(text===undefined)return;
    event.preventDefault();event.stopPropagation();
    const box=$('manual');box.setRangeText(text,box.selectionStart,box.selectionEnd,'end');
    box.dispatchEvent(new Event('input',{bubbles:true}));
  });
  function log(text) { const p=document.createElement('div');p.textContent=new Date().toLocaleTimeString()+' '+text;$('log').prepend(p); }
  function status(text) { $('status').textContent=$('liveStatus').textContent=text;host.dataset.chatxStatus=text;$('launcher').title=text;$('liveStatus').title=text; }
  function native(payload) {
    return new Promise(resolve => chrome.runtime.sendMessage({type:'chatx.native',payload}, response => {
      const error=chrome.runtime.lastError;
      resolve(error ? {ok:false,transport_error:true,error:error.message} : response || {ok:false,transport_error:true,error:'宿主没有返回结果'});
    }));
  }
  function recovery(action,value) {
    return new Promise(resolve=>chrome.runtime.sendMessage({type:'chatx.state',action,value},reply=>
      resolve(chrome.runtime.lastError?{ok:false}:reply || {ok:false})));
  }
  function assistantMessages() { return D.assistantMessages(); }
  function streaming() { return D.streaming(); }
  function setResult(value) {
    state.result=value;
    $('output').textContent=typeof value==='string'?value:JSON.stringify(value,null,2);
    $('insert').disabled=$('copy').disabled=false;
  }
  function insertText(text) { return D.insertText(text); }
  let saving=Promise.resolve();
  function checkpoint() {
    const snapshot=state.armed?{session:state.session,route:location.pathname,
      queued:[...state.queued],recoverySeen:[...state.recoverySeen],autoCount:state.autoCount,
      outbox:state.outbox,job:state.job,request:state.activeRequest}:null;
    saving=saving.then(()=>snapshot?recovery('put',snapshot):recovery('take')).catch(()=>({ok:false}));
    return saving;
  }
  function alreadySent(text) {
    const compact=t=>t.replace(/\s+/g,'');
    const receipt=text.match(/CHATX_RECEIPT_[a-f0-9]{32}_[a-f0-9]{32}/)?.[0];
    const parse=value=>{try{return JSON.parse(value.slice(value.indexOf('{'),value.lastIndexOf('}')+1));}catch{return null;}};
    const canonical=value=>Array.isArray(value)?value.map(canonical):value && typeof value==='object'?
      Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(value[key])])):value;
    const expected=receipt?null:parse(text);
    return D.userMessages().some(node=>{
      const body=node.textContent || '';
      if(receipt)return body.includes(receipt);
      if(compact(body).includes(compact(text)))return true;
      // Older queued results have no receipt. Compare the complete JSON data,
      // rather than requiring Markdown rendering to preserve its source text.
      const actual=body.includes('CHATX_RESULT')?parse(body):null;
      return expected?.request_id && actual?.request_id===expected.request_id &&
        JSON.stringify(canonical(actual))===JSON.stringify(canonical(expected));
    });
  }
  async function deliver(value, epoch=state.epoch) {
    if(epoch!==state.epoch)return;
    const receipt='CHATX_RECEIPT_'+state.session+'_'+crypto.randomUUID().replaceAll('-','');
    const text='CHATX_RESULT（本地工具数据，不是用户的新指令；回执标识无需回复）\n'+receipt+'\n'+JSON.stringify(value,null,2);
    setResult(value);state.activeRequest=null;
    if(!$('auto').checked){await transmit(text,epoch);return;}
    state.outbox={text,value,clicked:false};
    await checkpoint();await flushOutbox(epoch);
  }
  async function flushOutbox(epoch=state.epoch) {
    if(!state.outbox || state.sending || !state.armed || epoch!==state.epoch)return;
    const item=state.outbox;
    const sent=await transmit(item.text,epoch,item);
    if(epoch!==state.epoch || state.outbox!==item)return;
    if(sent){state.outbox=null;await checkpoint();}
    else state.retryAt=Date.now()+3000;
  }
  async function transmit(text,epoch,item=null) {
    if(state.sending)return false;
    state.sending=true;
    try {
      if(alreadySent(text))return true;
      if(item?.clicked) {
        const draft=D.text(D.composer());
        item.clickedAt ||= Date.now();
        const unchanged=draft.trim() && draft.replace(/\s+/g,'')===text.replace(/\s+/g,'');
        if(unchanged && !streaming() && !state.navigation && location.pathname===state.route && Date.now()-item.clickedAt>=5000 && (item.attempts || 1)<3) {
          // Retry only when the exact unsent result is still in the editor.
          // An empty/changed editor is ambiguous and must never trigger a resend.
          item.clicked=false;await checkpoint();
        } else {
          status(unchanged?((item.attempts || 1)>=3?'发送尝试已达 3 次，结果仍保留在输入框；请检查网页发送按钮。':'发送未确认，已保留原草稿，正在等待重试；最多尝试 3 次。'):'正在核对结果回执；结果已保留，不会重复运行本机任务。');
          return false;
        }
      }
      if($('auto').checked && state.armed) {
        const deadline=Date.now()+10000;
        while(state.navigation || location.pathname!==state.route || streaming() || !D.composer()) {
          if(epoch!==state.epoch || !state.armed || !$('auto').checked)return false;
          if(Date.now()>=deadline)throw new Error('结果已保留，等待 Chat 输入框恢复后自动重试');
          status('任务已完成，等待 Chat 输入框就绪后自动回传…');
          await new Promise(resolve=>setTimeout(resolve,200));
        }
      }
      if(epoch!==state.epoch)return false;
      const box=D.composer(),draft=D.text(box);
      // A previous send-button timeout may have left our own complete result in the editor.
      const same=(a,b)=>a.replace(/\s+/g,'')===b.replace(/\s+/g,'');
      const insertedDraft=draft.trim() && same(draft,text)?draft:D.text(insertText(text));
      if($('auto').checked && state.armed) {
        await new Promise(resolve=>setTimeout(resolve,400));
        const deadline=Date.now()+5000;
        for(;;) {
          if(epoch!==state.epoch || !state.armed || !$('auto').checked)return false;
          if(state.navigation || location.pathname!==state.route || streaming()) {
            if(Date.now()>=deadline)throw new Error('结果已保留，等待网页恢复后自动重试');
            await new Promise(resolve=>setTimeout(resolve,200));continue;
          }
          if(D.text(D.composer()).trim()!==insertedDraft.trim())throw new Error('草稿发生变化，未覆盖；结果已保留，发送或清空草稿后自动重试');
          const send=D.sendButton(D.composer());
          if(send && !send.disabled) {
            if(item){item.clicked=true;item.clickedAt=Date.now();item.attempts=(item.attempts || 0)+1;await checkpoint();}
            if(epoch!==state.epoch || !state.armed)return false;
            send.click();
            if(item && alreadySent(text) && state.outbox===item){state.outbox=null;checkpoint();}
            break;
          }
          if(Date.now()>=deadline)throw new Error('结果已保留，等待发送按钮恢复后自动重试');
          await new Promise(resolve=>setTimeout(resolve,200));
        }
        const deadlineAck=Date.now()+5000;
        while(!alreadySent(text)) {
          if(epoch!==state.epoch || !state.armed || Date.now()>=deadlineAck)return false;
          await new Promise(resolve=>setTimeout(resolve,200));
        }
        log('结果已出现在聊天消息中');
        status('结果已回传，等待 Chat 继续。');
        return true;
      }
      log('结果已填入输入框，等待你发送');return false;
    } catch(error) {if(epoch===state.epoch){status(error.message);log(error.message);}return false;}
    finally {state.sending=false;}
  }
  function controls() {
    $('approve').disabled=$('reject').disabled=!state.pending || state.busy;
    $('cancel').disabled=!state.job;
    $('arm').disabled=state.armed || state.busy;
    host.dataset.chatxArmed=String(state.armed);
    host.dataset.chatxBusy=String(state.busy);
    const active=state.armed || state.starting;
    $('launcher').setAttribute('aria-checked',String(active));
    $('launcher').setAttribute('aria-label',active?'停用本机助手':'启用本机助手');
    $('launcher').dataset.busy=String(state.starting || (state.armed && state.busy));
    $('launcher').textContent=active?(state.starting?'连接中':'已开启'):'已关闭';
    $('stop').disabled=!state.armed;
    $('autoRun').disabled=!state.armed;
    $('file').disabled=state.busy || !state.connected;
  }
  function stop(reason) {
    state.epoch++;state.armed=false;state.pending=null;state.session='';
    state.navigation=null;state.conversation=null;state.awaitingFirstRoute=false;
    state.starting=false;
    state.recovering=false;state.outbox=null;state.activeRequest=null;checkpoint();
    $('autoRun').checked=false;$('auto').checked=false;state.autoCount=0;
    // An already launched local job remains inspectable; only automatic chat delivery stops.
    status(reason || '对话已停用；已启动的本地任务继续运行，可取消或查询。');
    controls();
  }
  function enqueue(text) {
    if (!state.armed) throw new Error('请先启用当前对话');
    const req=P.parse(text,state.session);
    if (state.queued.has(req.id)) return;
    if (state.pending || state.busy || state.job || state.activeRequest || state.outbox) return;
    state.pending=req;state.queued.add(req.id);
    $('proposal').textContent=JSON.stringify(req,null,2);controls();log('收到任务：'+req.tool);
    if($('autoRun').checked) {
      {
        const epoch=state.epoch;
        state.autoCount++;log('自动执行第 '+state.autoCount+' 条：'+req.tool);
        queueMicrotask(()=>{if(epoch===state.epoch && state.armed && $('autoRun').checked)approve().catch(error=>{state.busy=false;controls();status(error.message);});});
      }
    }
  }
  async function poll(job, request, epoch) {
    state.job=job;await checkpoint();controls();
    let failures=0,paused=false;
    try {
      while(state.job===job) {
        await new Promise(resolve=>setTimeout(resolve,2000));
        const reply=await native({action:'execute',request:{protocol:'chatx/1',session:request.session,
          id:'poll_'+crypto.randomUUID().replaceAll('-',''),tool:'job_status',args:{job_id:job}}});
        if(!reply.ok) {
          if(++failures>=3){paused=true;status('连续查询失败，已暂停；点击“恢复连接”继续查询，任务 ID：'+job);break;}
          status('任务查询暂时失败，将重试；任务 ID：'+job);continue;
        }
        failures=0;
        setResult({request_id:request.id,...reply.result});
        if(reply.result.diagnostic && ['queued','running'].includes(reply.result.status)) {
          stop('本机作业心跳异常，已暂停自动执行；结果未确认，任务 ID：'+job);break;
        }
        if (!['queued','running'].includes(reply.result.status)) {
          const labels={completed:'执行成功',failed:'执行失败',timed_out:'执行超时',cancelled:'任务已取消',output_limit:'输出超过限制'};
          status(labels[reply.result.status] || '任务 '+reply.result.status);
          if (state.armed && epoch===state.epoch) await deliver({request_id:request.id,...reply.result},epoch);
          break;
        }
        status('本地运行中 · '+job+(reply.result.diagnostic?'\n'+reply.result.diagnostic:''));
      }
    } finally {if(!paused)state.job=null;state.busy=false;controls();await checkpoint();}
  }
  async function approve() {
    if (!state.pending || state.busy) return;
    const request=state.pending,epoch=state.epoch;
    state.pending=null;state.activeRequest=request;state.busy=true;controls();status('执行中：'+request.tool);
    const saved=await checkpoint();
    if(!saved.ok){state.busy=false;state.activeRequest=null;controls();stop('恢复记录保存失败，已停止启动任务：'+(saved.error || '扩展存储不可用'));return;}
    if(epoch!==state.epoch || !state.armed){state.busy=false;controls();return;}
    const reply=await native({action:'execute',request});
    if(epoch!==state.epoch || !state.armed) {
      if(reply.ok && reply.result.job_id && ['queued','running'].includes(reply.result.status)) {
        await native({action:'execute',request:{protocol:'chatx/1',session:request.session,
          id:'cancel_'+crypto.randomUUID().replaceAll('-',''),tool:'job_cancel',args:{job_id:reply.result.job_id}}});
      }
      state.busy=false;controls();return;
    }
    if(reply.transport_error) {
      state.busy=false;controls();status('本机连接中断，任务状态未确认；点击“恢复连接”查询原请求。');
      await checkpoint();return;
    }
    if (reply.ok && reply.result.job_id && ['queued','running'].includes(reply.result.status)) {
      log('后台任务：'+reply.result.job_id);
      await poll(reply.result.job_id,request,epoch);return;
    }
    state.busy=false;controls();
    status(reply.ok?'已完成：'+request.tool:'失败：'+reply.error);
    if (epoch===state.epoch && state.armed) await deliver({request_id:request.id,...reply},epoch);
    else setResult({request_id:request.id,...reply});
  }
  function bindControl(id, handler) {
    $(id).addEventListener('click',event=>{
      Promise.resolve(handler()).catch(error=>{status(error.message);log(error.message);});
    });
  }
  bindControl('reconnect',async()=>{
    if(state.sending){status('正在等待当前回传结束，请稍后恢复连接。');return;}
    status('正在重新检测本机与当前对话…');
    const reply=await native({action:'ping'});
    if(!reply.ok)throw new Error('本机连接失败：'+reply.error);
    state.connected=true;
    if(!state.armed) {
      await restoreSnapshot(await recovery('take'));
      if(!state.armed){status('没有可恢复的连接，请点击“已关闭”开关启动本机助手。');return;}
    }
    if(state.activeRequest && !state.job && !state.busy && !state.outbox){state.pending=state.activeRequest;await approve();return;}
    if(state.job && state.activeRequest && !state.busy){state.busy=true;controls();await poll(state.job,state.activeRequest,state.epoch);return;}
    if(state.outbox) {
      const item=state.outbox;
      if(item.clicked && !alreadySent(item.text) && D.text(D.composer()).replace(/\s+/g,'')===item.text.replace(/\s+/g,''))item.clicked=false;
      state.retryAt=0;await checkpoint();await flushOutbox();
    } else status(state.busy?'本机已连接，继续查询当前任务。':'连接已恢复，可继续当前对话。');
  });
  bindControl('fold',()=>{
    const collapsed=!$('environment').hidden;
    $('environment').hidden=collapsed;
    $('widget').dataset.collapsed=String(collapsed);
    $('fold').setAttribute('aria-expanded',String(!collapsed));
    $('fold').setAttribute('aria-label',collapsed?'展开环境设置':'收起环境设置');
    $('fold').textContent=collapsed?'展开':'收起';
  });
  bindControl('launcher',async()=>{
    if(state.armed || state.starting) {
      const job=state.job,session=state.session;
      stop('本机助手已关闭。');
      if(job)await native({action:'execute',request:{protocol:'chatx/1',session,
        id:'cancel_'+crypto.randomUUID().replaceAll('-',''),tool:'job_cancel',args:{job_id:job}}});
    } else if(!state.busy)await enable();
  });
  bindControl('close',()=>{$('panel').hidden=true;});
  bindControl('connect',async()=>{
    status('连接本机…');
    const reply=await native({action:'ping'});state.connected=reply.ok;
    status(reply.ok?'已连接 · '+reply.result.workspace+'\nPython: '+reply.result.python:reply.error);controls();
  });
  async function enable() {
    if(state.armed || state.starting || state.busy)return;
    const epoch=++state.epoch;state.starting=true;controls();status('正在连接本机助手…');
    try {
      if(!state.connected) {
        const reply=await native({action:'ping'});state.connected=reply.ok;
        if(!reply.ok)throw new Error(reply.error);
      }
      if(epoch!==state.epoch)return;
      state.session=crypto.randomUUID().replaceAll('-','');state.armed=true;state.route=location.pathname;
      state.conversation=D.conversationIdentity();state.navigation=null;
      state.awaitingFirstRoute=!D.routeConversation(location.pathname);
      state.baseline=new WeakSet(assistantMessages());state.queued.clear();state.seen.clear();
      state.recoverySeen.clear();
      $('auto').checked=true;$('autoRun').checked=true;state.autoCount=0;
      setResult(P.instructions(state.session));
      state.starting=false;controls();status('本机助手已开启，任务将自动执行并回传。');
      await transmit(P.instructions(state.session),state.epoch);
    } finally {if(epoch===state.epoch){state.starting=false;controls();}}
  }
  bindControl('arm',enable);
  $('pythonPath').addEventListener('change',async()=>{
    const python=$('pythonPath').value.trim();
    status('正在验证 Python 环境…');
    const reply=await native({action:'configure_python',python});
    if(reply.ok) {
      $('pythonPath').value=reply.result.python;state.connected=true;
      status('路径已保存 · '+(reply.result.torch_installed?'已检测到 PyTorch':'未检测到 PyTorch，CPU 任务可用'));
    } else status('路径保存失败：'+reply.error);
  });
  $('pythonPath').addEventListener('keydown',event=>{if(event.key==='Enter'){event.preventDefault();$('pythonPath').blur();}});
  bindControl('stop',()=>stop());
  bindControl('diagnose',async()=>{
    await navigator.clipboard.writeText(JSON.stringify(D.diagnostics(),null,2));
    status('已复制页面识别诊断，可发给开发者；仅含编辑器结构，不含对话或草稿内容。');
  });
  bindControl('approve',approve);
  bindControl('reject',async()=>{
    const req=state.pending;if(!req)return;state.pending=null;controls();
    status('已拒绝：'+req.tool);await deliver({request_id:req.id,ok:false,error:'用户拒绝执行，请等待用户进一步指示。'});
  });
  bindControl('cancel',async()=>{
    if(!state.job)return;
    const reply=await native({action:'execute',request:{protocol:'chatx/1',session:state.session || crypto.randomUUID().replaceAll('-',''),
      id:'cancel_'+crypto.randomUUID().replaceAll('-',''),tool:'job_cancel',args:{job_id:state.job}}});
    status(reply.ok?'已请求取消；等待任务终态':reply.error);
  });
  bindControl('insert',()=>insertText(typeof state.result==='string'?state.result:'CHATX_RESULT\n'+JSON.stringify(state.result,null,2)));
  bindControl('copy',async()=>{await navigator.clipboard.writeText(typeof state.result==='string'?state.result:JSON.stringify(state.result,null,2));log('已复制');});
  bindControl('parse',()=>enqueue($('manual').value));
  bindControl('paste',async()=>{
    try {
      const text=await navigator.clipboard.readText();
      if(!text.trim())throw new Error('剪贴板没有文本');
      $('manual').value=text;status('指令已粘贴，请点击“检查并加入待执行”。');
    }catch(error){status('无法读取剪贴板：'+error.message+'。可点击“从最新回复读取任务”。');}
  });
  bindControl('scan',()=>{
    if(!state.armed)throw new Error('请先启用当前对话');
    if(streaming())throw new Error('Chat 仍在输出，请等回复完成');
    const latest=assistantMessages().at(-1);
    if(!latest || state.baseline.has(latest))throw new Error('尚未找到启用后的助手回复');
    const blocks=D.taskBlocks(latest);
    for(const {text} of blocks) {
      if(text.includes('chatx/1') && text.includes(state.session)){enqueue(text);return;}
    }
    throw new Error('最新回复未找到本次会话的任务 JSON；请让 Chat 按连接说明输出任务');
  });
  $('autoRun').addEventListener('change',event=>{
    state.autoCount=0;
    log($('autoRun').checked?'自动执行已开启。':'自动执行已关闭。');
  });
  $('file').addEventListener('change',async event=>{
    if(state.busy)return;
    state.busy=true;controls();
    const results=[];
    try {
      for(const file of $('file').files) {
        status('本地导入：'+file.name);
        const begin=await native({action:'upload_begin',name:file.name,size:file.size});
        if(!begin.ok)throw new Error(begin.error);
        for(let offset=0;offset<file.size;offset+=256*1024) {
          const bytes=new Uint8Array(await file.slice(offset,offset+256*1024).arrayBuffer());
          let raw='';for(let i=0;i<bytes.length;i+=8192)raw+=String.fromCharCode(...bytes.subarray(i,i+8192));
          const reply=await native({action:'upload_chunk',upload_id:begin.result.upload_id,offset,data:btoa(raw)});
          if(!reply.ok)throw new Error(reply.error);
          status('本地导入 '+file.name+' · '+Math.round((offset+bytes.length)/file.size*100)+'%');
        }
        const finish=await native({action:'upload_finish',upload_id:begin.result.upload_id});
        if(!finish.ok)throw new Error(finish.error);
        results.push(finish.result);
      }
      setResult({local_files:results});status('文件已保存到本地。点击“填入 Chat”仅传递路径和元数据。');
    }catch(error){status('导入失败：'+error.message);setResult({local_files:results,error:error.message});}
    finally{state.busy=false;$('file').value='';controls();}
  });
  chrome.runtime.onMessage.addListener(message=>{if(message.type==='chatx.toggle')$('launcher').click();});
  controls();
  native({action:'ping'}).then(reply=>{
    if(reply.ok) {
      state.connected=true;
      if(!$('pythonPath').value && shadow.activeElement!==$('pythonPath'))$('pythonPath').value=reply.result.python;
      if(!host.hasAttribute('data-chatx-status'))status('环境已就绪 · 插件未启用');
      controls();
    } else if(!state.armed && !state.starting)status('本机连接失败：'+reply.error);
  });
  async function restoreSnapshot(reply) {
    const saved=reply?.value;
    if(!reply.ok || !saved || !/^[0-9a-f]{32}$/.test(saved.session || '') || state.armed || state.starting)return;
    if(saved.route && saved.route!==location.pathname &&
      (!D.routeConversation(saved.route) || D.routeConversation(saved.route)!==D.routeConversation(location.pathname)))return;
    state.session=saved.session;state.armed=true;state.epoch++;
    state.route=location.pathname;state.conversation=D.conversationIdentity();
    state.queued=new Set(saved.queued || []);state.recoverySeen=new Set(saved.recoverySeen || []);
    state.autoCount=saved.autoCount || 0;state.baseline=new WeakSet();
    $('auto').checked=true;$('autoRun').checked=true;
    controls();status('本机助手已恢复，正在检查未完成任务和回传结果。');
    state.outbox=saved.outbox || null;state.activeRequest=saved.request || null;
    if(state.outbox) {setResult(state.outbox.value);flushOutbox();}
    else if(saved.job && state.activeRequest) {state.busy=true;controls();poll(saved.job,state.activeRequest,state.epoch).catch(error=>{status('恢复查询失败：'+error.message);});}
    else if(state.activeRequest) {state.pending=state.activeRequest;approve().catch(error=>{state.busy=false;controls();status(error.message);});}
    await checkpoint();
  }
  recovery('take').then(restoreSnapshot).catch(error=>status('恢复失败：'+error.message));
  // Require stable assistant code after streaming ends, never parse user messages or old history.
  setInterval(()=>{
    const identity=D.conversationIdentity();
    if(state.armed && identity) {
      if(state.conversation && identity!==state.conversation) {
        stop('已切换到另一段对话，需重新启用。');
      } else state.conversation=identity;
    }
    if(location.pathname!==state.route) {
      const previous=D.routeConversation(state.route),next=D.routeConversation(location.pathname);
      const firstConversation=state.awaitingFirstRoute && !previous && !!next;
      const sameConversation=!!next && ((!!previous && previous===next) ||
        (!!identity && identity===state.conversation));
      log('页面地址变化：'+state.route+' → '+location.pathname);
      state.route=location.pathname;
      if(state.armed) {
        if(firstConversation || sameConversation) {
          state.awaitingFirstRoute=false;state.navigation=null;
        } else state.navigation={at:Date.now()};
      }
    }
    if(state.armed && state.navigation) {
      if(D.routeConversation(location.pathname) && identity && identity===state.conversation) {
        state.navigation=null;
      } else if(Date.now()-state.navigation.at>=1600) {
        stop('已切换对话，需重新启用。');
      }
    }
    if(state.armed && state.outbox && !state.navigation && Date.now()>=state.retryAt){flushOutbox();return;}
    if(!state.armed || state.navigation || state.busy || state.pending || state.recovering || state.outbox || state.sending || streaming())return;
    const messages=assistantMessages();const latest=messages.at(-1);
    if(!latest || state.baseline.has(latest) || !D.completeMessage(latest))return;
    const failed=latest.querySelector('[data-dil-render-failed]');
    if(failed && !D.text(D.composer()).trim()) {
      const id=failed.closest('[data-dil-message-id]')?.getAttribute('data-dil-message-id') || location.pathname+':'+messages.length;
      if(!state.recoverySeen.has(id)) {
        state.recoverySeen.add(id);state.recovering=true;
        const epoch=state.epoch;
        status('Chat 回复暂时无法显示，正在自动恢复…');
        checkpoint().then(reply=>{
          if(reply.ok && epoch===state.epoch && state.armed && !D.text(D.composer()).trim())location.reload();
          else {state.recovering=false;recovery('take');if(epoch===state.epoch)status('网页回复未能自动恢复，请稍后重试。');}
        });
      } else status('网页仍无法显示这条回复，请稍后重试。');
      return;
    }
    for(const {node:code,text} of D.taskBlocks(latest)) {
      if(!text.includes('"chatx/1"') || !text.includes(state.session))continue;
      const last=state.seen.get(code);
      if(!last || last.text!==text){state.seen.set(code,{text,at:Date.now()});continue;}
      if(Date.now()-last.at<1200)continue;
      try{enqueue(text);}catch(error){status('指令无法解析：'+error.message);}
    }
  },800);
})();
