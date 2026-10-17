const HOST = 'com.chatchatchats.local';
const stateTasks = new Map();
function queueState(key, operation) {
  const task=(stateTasks.get(key) || Promise.resolve()).catch(()=>{}).then(operation);
  stateTasks.set(key,task);
  const clear=()=>{if(stateTasks.get(key)===task)stateTasks.delete(key);};
  task.then(clear,clear);
  return task;
}
chrome.tabs?.onRemoved?.addListener(tabId=>queueState('chatx.recovery.'+tabId,
  ()=>chrome.storage.session.remove('chatx.recovery.'+tabId)).catch(()=>{}));
chrome.action.onClicked.addListener(async tab => {
  if (!tab.id || !tab.url?.startsWith('https://chatgpt.com/')) return;
  try { await chrome.tabs.sendMessage(tab.id, {type: 'chatx.toggle'}); } catch { /* Reload tab after installing. */ }
});
chrome.runtime.onMessage.addListener((message, sender, reply) => {
  if (!sender.tab || !sender.url?.startsWith('https://chatgpt.com/') || sender.frameId !== 0) return;
  if(message.type==='chatx.state') {
    const key='chatx.recovery.'+sender.tab.id;
    queueState(key,async()=>{
      if(message.action==='put') {
        await chrome.storage.session.set({[key]:message.value});reply({ok:true});
      } else if(message.action==='take') {
        const data=await chrome.storage.session.get(key);
        await chrome.storage.session.remove(key);reply({ok:true,value:data[key] || null});
      } else reply({ok:false,error:'未知恢复动作'});
    }).catch(error=>reply({ok:false,error:error.message}));
    return true;
  }
  if(message.type!=='chatx.native')return;
  chrome.runtime.sendNativeMessage(HOST, message.payload, response => {
    const error = chrome.runtime.lastError;
    reply(error ? {ok:false,transport_error:true,error:error.message + '。请检查本机宿主与扩展连接。'} : response);
  });
  return true;
});
