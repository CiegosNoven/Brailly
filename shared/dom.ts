export type DomBlock={id:string;tag:string;role:string;region:string;text:string;href?:string;context?:string;live?:'timer';order:number};
export type PageSnapshot={id:string;url:string;title:string;blocks:DomBlock[];capturedAt:string;source:'url'|'extension'|'example'|'browserbase';totalCandidates:number;truncated:boolean;previewHtml?:string};
// Self-contained so the browser extension can inject the same extractor.
export function extractDocument(doc:Document,url:string,rendered=false,selectedId?:string):PageSnapshot {
 const semantic='h1,h2,h3,h4,h5,h6,p,li,a,button,label,input,select,textarea,td,th,summary,[role="alert"],[role="status"],[role="button"],[role="heading"],[role="timer"]';
 const landmarks='main,[role="main"],#main-content,#maincontent,#content-main,.site-main,.entry-content';
 const excluded='script,style,noscript,template,svg,[data-brailly-ui]';
 let baseUrl=url;try{const base=new URL(doc.querySelector('base[href]')?.getAttribute('href')||url,url);if(['http:','https:'].includes(base.protocol))baseUrl=base.href;}catch{}
 const candidates=Array.from(doc.querySelectorAll<HTMLElement>(semantic+',div,span,dt,dd,time,output,address'));
 const visibility=new Map<HTMLElement,boolean>();
 const hidden=(node:HTMLElement)=>{for(let n:HTMLElement|null=node;n;n=n.parentElement){if(n.hidden||n.hasAttribute('inert')||n.getAttribute('aria-hidden')==='true'||/display\s*:\s*none|visibility\s*:\s*hidden/i.test(n.getAttribute('style')||''))return true;if(rendered&&doc.defaultView){let value=visibility.get(n);if(value===undefined){const style=doc.defaultView.getComputedStyle(n);value=style.display==='none'||style.visibility==='hidden';visibility.set(n,value);}if(value)return true;}}return false;};
 const cleanText=(node:HTMLElement)=>{const copy=node.cloneNode(true) as HTMLElement;copy.querySelectorAll(excluded+',iframe,frame,[hidden],[aria-hidden="true"],input,textarea,select').forEach(child=>child.remove());copy.querySelectorAll('br').forEach(br=>br.replaceWith(' '));return (copy.textContent||'').replace(/\s+/g,' ').trim();};
 const heading=(node:HTMLElement)=>{const h=node.querySelector<HTMLElement>('h1,h2,h3,h4,h5,h6,[role="heading"]');return h?cleanText(h).slice(0,240):'';};
 const cardFor=(node:HTMLElement)=>{const keyed=node.closest<HTMLElement>('[data-deal-id],[data-product-id]');if(keyed&&heading(keyed))return keyed;for(let p=node.parentElement;p&&p!==doc.body;p=p.parentElement){if(p.matches('article,[role="listitem"],[data-deal-id],[data-product-id]')||Array.from(p.classList).some(c=>/(?:^|[-_])(card|location)(?:$|[-_])/i.test(c))){if(heading(p))return p;}}return null;};
 const hash=(key:string)=>{let n=2166136261;for(let i=0;i<key.length;i++)n=Math.imul(n^key.charCodeAt(i),16777619);return n>>>0;};
 const stableKey=(node:HTMLElement,card:HTMLElement|null)=>{const path:string[]=[];for(let p:HTMLElement|null=node;p&&p!==doc.documentElement;p=p.parentElement){if(p.id)return 'id:'+p.id+'/'+path.reverse().join('/');if(p===card){const anchor=p.getAttribute('data-deal-id')||p.getAttribute('data-product-id')||heading(p);return 'card:'+anchor+'/'+path.reverse().join('/');}const siblings=p.parentElement?Array.from(p.parentElement.children).filter(s=>s.tagName===p!.tagName):[p];path.push(p.tagName.toLowerCase()+':'+siblings.indexOf(p));}return path.reverse().join('/');};
 const generic=(node:HTMLElement)=>!node.matches(semantic);
 const leafGroup=(node:HTMLElement)=>!node.querySelector(semantic+',div,section,article,ul,ol,dl,table')&&!!cleanText(node);
 let fragment:HTMLElement|null=null;try{const id=decodeURIComponent(new URL(url).hash.slice(1));if(id)fragment=doc.getElementById(id);}catch{}
 const collected:{block:DomBlock;node:HTMLElement;main:boolean;fragment:boolean;fact:boolean}[]=[];
 const ids=new Set<string>();const keys=new Map<string,number>();
 const labels=Array.from(doc.querySelectorAll('label'));
 for(const node of candidates){
  if(node.closest(excluded)||hidden(node))continue;
  const tag=node.tagName.toLowerCase();if(tag==='input'&&['hidden','password'].includes(node.getAttribute('type')||''))continue;
  if(generic(node)){
   if(node.parentElement?.closest(semantic)||!leafGroup(node))continue;
   const parent=node.parentElement;if(parent?.matches('div,span,dt,dd,time,output,address')&&leafGroup(parent))continue;
  }else{
   const child=node.querySelector('h1,h2,h3,h4,h5,h6,p,li,td,th,summary');if(child&&!/^h[1-6]$/.test(tag)&&!['a','button','label','summary'].includes(tag))continue;
   if(node.children.length===1&&node.firstElementChild?.matches('a')&&node.textContent?.trim()===node.firstElementChild.textContent?.trim())continue;
   if(node.parentElement?.closest('a,button,label,summary,h1,h2,h3,h4,h5,h6'))continue;
  }
  const labelled=node.getAttribute('aria-labelledby')?.split(/\s+/).map(id=>{const label=doc.getElementById(id);return label?cleanText(label):'';}).join(' ');
  const inputLabel=labels.find(label=>label.getAttribute('for')===node.id&&node.id);
  const raw=labelled||node.getAttribute('aria-label')||(['input','textarea'].includes(tag)?(inputLabel?cleanText(inputLabel):'')||node.getAttribute('placeholder')||node.getAttribute('name'):cleanText(node))||'';
  const text=raw.replace(/\s+/g,' ').trim();if(!text||!/[\p{L}\p{N}]/u.test(text))continue;
  const card=cardFor(node);const context=card?heading(card):'';
  const landmark=node.closest('nav,main,aside,header,footer,[role="navigation"],[role="main"],[role="complementary"],[role="banner"],[role="contentinfo"]');
  const isMain=!!node.closest(landmarks)&&!node.closest('nav,aside,footer,header,[role="navigation"],[role="complementary"]');
  const region=landmark?.getAttribute('role')||landmark?.tagName.toLowerCase()||(isMain?'main':'body');
  const key=stableKey(node,card);const occurrence=keys.get(key)||0;keys.set(key,occurrence+1);
  let id=node.getAttribute('data-brailly-id')||'';if(!/^b\d+$/.test(id)||ids.has(id)){let suffix=occurrence;do{id='b'+hash(key+'#'+suffix++);}while(ids.has(id));}ids.add(id);node.setAttribute('data-brailly-id',id);
  const role=(node.getAttribute('role')||(/^h[1-6]$/.test(tag)?'heading':tag==='a'?'link':['button','input','select','textarea'].includes(tag)?'control':'text')).slice(0,40);
  const block:DomBlock={id,tag,role,region:region.slice(0,40),text:text.slice(0,800),order:collected.length};
  if(context&&context!==text)block.context=context;
  if(node.closest('[role="timer"],[data-countdown],[class*="countdown"],.cd')&&(/\d/.test(text)))block.live='timer';
  if(tag==='a'){try{const href=new URL(node.getAttribute('data-brailly-href')||node.getAttribute('href')||'',baseUrl);if(['https:','http:'].includes(href.protocol)&&href.href.length<=2048)block.href=href.href;}catch{}}
  collected.push({block,node,main:isMain,fragment:!!fragment&&(fragment===node||fragment.contains(node)),fact:!!context&&role==='text'&&block.live!=='timer'&&(/\d/.test(text)||/\b(?:closed|unavailable|wait|open)\b/i.test(text))});
 }
 const priority=new Set<DomBlock>();
 const include=(rows:typeof collected,limit:number)=>{for(const row of rows){if(priority.size>=limit)break;priority.add(row.block);}};
 const selected=collected.find(row=>row.block.id===selectedId);if(selected)priority.add(selected.block);
 include(collected.filter(row=>row.fragment),48);
 include(collected.filter(row=>row.main&&row.fact),36);
 include(collected.filter(row=>row.main),48);
 include(collected.filter(row=>!['nav','navigation','header','banner','footer','contentinfo','aside','complementary'].includes(row.block.region)),48);
 include(collected,60);
 const blocks=collected.filter(row=>priority.has(row.block)).map(row=>row.block);
 return {id:crypto.randomUUID(),url,title:(doc.title||new URL(url).hostname).slice(0,500),blocks,capturedAt:new Date().toISOString(),source:rendered?'extension':'url',totalCandidates:collected.length,truncated:collected.length>blocks.length||blocks.some(block=>block.text.length===800)};
}
export type BlockResult={id:string;category:'CONTENT'|'ACTION'|'NAVIGATION'|'NOTICE'|'EXTRA';score:number;confidence:number;probabilities:Record<string,number>;categoryConfidence:number;priority:'NOW'|'NEXT'|'LATER'|'REVIEW'};
export type ReadContext={current:DomBlock;offset:number;previousBlocks:DomBlock[]};
export type Transition={choice:'DEFER'|'QUEUE_HIGH'|'INTERRUPT'|'NONE';confidence:number;probabilities:Record<string,number>};
export type Classification={transition?:Transition;snapshotId:string;task:string;model:string;latencyMs:number;results:BlockResult[];request:unknown;usage?:unknown;source:'Jev'};
export function readingOrder(page:PageSnapshot,result:Classification|null){
 if(!result||result.snapshotId!==page.id)return page.blocks;
 const scores=new Map(result.results.map(r=>[r.id,r]));
 return [...page.blocks].sort((a,b)=>{const av=scores.get(a.id),bv=scores.get(b.id);return (bv?.score??0)-(av?.score??0)||a.order-b.order;});
}
