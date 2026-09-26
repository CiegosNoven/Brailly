export type DomBlock={id:string;tag:string;role:string;region:string;text:string;href?:string;order:number};
export type PageSnapshot={id:string;url:string;title:string;blocks:DomBlock[];capturedAt:string;source:'url'|'extension'|'example';totalCandidates:number;truncated:boolean;previewHtml?:string};
// Self-contained so Chrome can serialize this exact function into the active tab.
export function extractDocument(doc:Document,url:string,rendered=false,selectedId?:string):PageSnapshot {
 let baseUrl=url;try{const base=new URL(doc.querySelector('base[href]')?.getAttribute('href')||url,url);if(['http:','https:'].includes(base.protocol))baseUrl=base.href;}catch{}
 const selector='h1,h2,h3,h4,h5,h6,p,li,a,button,label,input,select,textarea,td,th,summary,[role="alert"],[role="status"],[role="button"],[role="heading"]';
 const candidates=Array.from(doc.querySelectorAll<HTMLElement>(selector));const collected:DomBlock[]=[];const ids=new Set<string>();let nextId=candidates.reduce((highest,n)=>Math.max(highest,Number(n.getAttribute('data-brailly-id')?.slice(1))||0),0)+1;
 const visibility=new Map<HTMLElement,boolean>();
 const hidden=(node:HTMLElement)=>{for(let n:HTMLElement|null=node;n;n=n.parentElement){if(n.hidden||n.hasAttribute('inert')||n.getAttribute('aria-hidden')==='true'||/display\s*:\s*none|visibility\s*:\s*hidden/i.test(n.getAttribute('style')||''))return true;if(rendered&&doc.defaultView){let value=visibility.get(n);if(value===undefined){const style=doc.defaultView.getComputedStyle(n);value=style.display==='none'||style.visibility==='hidden';visibility.set(n,value);}if(value)return true;}}return false;};
 for(const node of candidates){
  if(node.closest('script,style,noscript,template,svg,[data-brailly-ui]')||hidden(node))continue;
  const tag=node.tagName.toLowerCase();if(tag==='input'&&['hidden','password'].includes(node.getAttribute('type')||''))continue;
  const child=node.querySelector('h1,h2,h3,h4,h5,h6,p,li,td,th,summary');if(child&&!/^h[1-6]$/.test(tag)&&!['a','button','label','summary'].includes(tag))continue;
  if(node.children.length===1&&node.firstElementChild?.matches('a')&&node.textContent?.trim()===node.firstElementChild.textContent?.trim())continue;
  if(node.parentElement?.closest('a,button,label,summary,h1,h2,h3,h4,h5,h6'))continue;
  const copy=node.cloneNode(true) as HTMLElement;copy.querySelectorAll('script,style,noscript,template,[hidden],[aria-hidden="true"]').forEach(child=>child.remove());
  const labelled=node.getAttribute('aria-labelledby')?.split(/\s+/).map(id=>doc.getElementById(id)?.textContent??'').join(' ');
  const inputLabel=Array.from(doc.querySelectorAll('label')).find(l=>l.getAttribute('for')===node.id&&node.id)?.textContent;
  const raw=labelled||node.getAttribute('aria-label')||(['input','textarea'].includes(tag)?inputLabel||node.getAttribute('placeholder')||node.getAttribute('name'):copy.textContent)||'';
  const text=raw.replace(/\s+/g,' ').trim();if(!text)continue;
  const landmark=node.closest('nav,main,aside,header,footer,[role="navigation"],[role="main"],[role="complementary"],[role="banner"],[role="contentinfo"]');
  const region=landmark?.getAttribute('role')||landmark?.tagName.toLowerCase()||'body';let id=node.getAttribute('data-brailly-id')||'';if(!/^b\d+$/.test(id)||ids.has(id))id=`b${nextId++}`;ids.add(id);node.setAttribute('data-brailly-id',id);
  const block:DomBlock={id,tag,role:(node.getAttribute('role')||(/^h[1-6]$/.test(tag)?'heading':tag==='a'?'link':['button','input','select','textarea'].includes(tag)?'control':'text')).slice(0,40),region:region.slice(0,40),text:text.slice(0,800),order:collected.length};
  if(tag==='a'){try{const href=new URL(node.getAttribute('data-brailly-href')||node.getAttribute('href')||'',baseUrl);if(['https:','http:'].includes(href.protocol)&&href.href.length<=2048)block.href=href.href;}catch{/* invalid source link */}}
  collected.push(block);
 }
 const isContent=(block:DomBlock)=>!['nav','navigation','header','banner','footer','contentinfo','aside','complementary'].includes(block.region);
 // Long navigation menus must not consume the entire request before the article begins.
 const content=collected.filter(isContent);const priority=new Set(content.slice(0,48));
 const selected=collected.find(block=>block.id===selectedId);if(selected)priority.add(selected);
 for(const block of collected){if(priority.size>=60)break;priority.add(block);}
 const blocks=collected.filter(block=>priority.has(block));
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
