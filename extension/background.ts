async function capture(tabId?:number){
 try{if(!tabId){const store=await chrome.storage.session.get('sourceTabId');tabId=typeof store.sourceTabId==='number'?store.sourceTabId:undefined;}if(!tabId)throw new Error('Open a website and click the Reflow extension icon first.');await chrome.storage.session.set({sourceTabId:tabId,captureError:''});await chrome.scripting.executeScript({target:{tabId},files:['content.js']});}
 catch(e){await chrome.storage.session.set({captureError:e instanceof Error?e.message:'Could not access this page.'});}
}
chrome.action.onClicked.addListener(tab=>{if(!tab.id)return;void chrome.sidePanel.open({tabId:tab.id});void capture(tab.id);});
chrome.runtime.onMessage.addListener((message,sender,respond)=>{
 if(message.type==='snapshot'&&sender.tab?.id){void chrome.storage.session.get('sourceTabId').then(v=>{if(v.sourceTabId===sender.tab!.id)return chrome.storage.session.set({snapshot:message.snapshot,pageChanged:false,captureError:''});});return;}
 if(message.type==='changed'&&sender.tab?.id){void chrome.storage.session.get('sourceTabId').then(v=>{if(v.sourceTabId===sender.tab!.id)return chrome.storage.session.set({pageChanged:true});});return;}
 if(message.type==='capture'&&!sender.tab){capture().then(()=>respond({ok:true}));return true;}
 if(message.type==='locate'&&!sender.tab){void chrome.storage.session.get('sourceTabId').then(async v=>{if(typeof v.sourceTabId!=='number')return;await chrome.scripting.executeScript({target:{tabId:v.sourceTabId},func:(id:string,text:string)=>{if(!/^b\d+$/.test(id))return;const node=document.querySelector<HTMLElement>(`[data-reflow-id="${id}"]`);if(!node)return;const source=(node.getAttribute('aria-label')||node.textContent||'').replace(/\s+/g,' ').trim().slice(0,800);if(source!==text)return;node.scrollIntoView({block:'center',behavior:'instant'});node.setAttribute('tabindex','-1');node.focus();node.style.outline='3px solid #2d5bdb';setTimeout(()=>{node.style.outline='';},2500);},args:[message.id,message.text]});});respond({ok:true});return;}
});
