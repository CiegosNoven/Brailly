import {extractDocument} from '../shared/dom';
const snapshot=extractDocument(document,location.href,true);
chrome.runtime.sendMessage({type:'snapshot',snapshot}).catch(()=>{});
const scope=window as unknown as {__reflowObserver?:MutationObserver};
scope.__reflowObserver?.disconnect();
let timer:ReturnType<typeof setTimeout>;
const observer=new MutationObserver(changes=>{if(!changes.some(c=>c.type==='characterData'||c.type==='childList'||(c.attributeName&&!c.attributeName.startsWith('data-reflow'))))return;clearTimeout(timer);timer=setTimeout(()=>chrome.runtime.sendMessage({type:'changed'}).catch(()=>{}),500);});
observer.observe(document.body,{childList:true,subtree:true,characterData:true,attributes:true,attributeFilter:['hidden','aria-hidden','aria-label']});scope.__reflowObserver=observer;
