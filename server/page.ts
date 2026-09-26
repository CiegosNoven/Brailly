import {lookup} from 'node:dns/promises';
import https from 'node:https';
import http from 'node:http';
import {isIP} from 'node:net';
import {parseHTML} from 'linkedom';
import {extractDocument} from '../shared/dom.js';
export function publicAddress(ip:string):boolean{
 if(isIP(ip)===6){const v=ip.toLowerCase();return !v.startsWith('::')&&!v.startsWith('fc')&&!v.startsWith('fd')&&!/^fe[89ab]/.test(v)&&!v.startsWith('ff')&&!v.startsWith('2001:db8')&&!v.startsWith('2002:');}
 if(isIP(ip)!==4)return false;const [a,b]=ip.split('.').map(Number);return !([0,10,127].includes(a)||a>=224||(a===169&&b===254)||(a===172&&b>=16&&b<=31)||(a===192&&(b===168||b===0))||(a===100&&b>=64&&b<=127)||(a===198&&(b===18||b===19)));
}
export async function fetchPublicHtml(raw:string,depth=0):Promise<{html:string;url:string}>{
 if(depth>4)throw new Error('Too many redirects. Try the final page URL.');const url=new URL(raw);
 if(!['http:','https:'].includes(url.protocol)||url.username||url.password||(url.port&&!['80','443'].includes(url.port)))throw new Error('Use a public HTTP or HTTPS page URL.');
 const hostname=url.hostname.replace(/^\[|\]$/g,'');const addresses=await lookup(hostname,{all:true});if(!addresses.length||addresses.some(a=>!publicAddress(a.address)))throw new Error('Only public websites can be imported.');
 const pinned=addresses.find(a=>a.family===4)||addresses[0];
 return new Promise((resolve,reject)=>{
  const req=(url.protocol==='https:'?https:http).get(url,{headers:{'User-Agent':'Reflow/0.2 (accessible page preview)','Accept':'text/html,application/xhtml+xml','Accept-Encoding':'identity'},lookup:((_host:unknown,opts:{all?:boolean},cb:Function)=>opts.all?cb(null,[pinned]):cb(null,pinned.address,pinned.family)) as never},res=>{
   if(res.statusCode&&res.statusCode>=300&&res.statusCode<400&&res.headers.location){res.resume();clearTimeout(deadline);fetchPublicHtml(new URL(res.headers.location,url).href,depth+1).then(resolve,reject);return;}
   if(res.statusCode!==200){res.resume();reject(new Error(`The website returned HTTP ${res.statusCode}. Use the extension to capture it in your browser.`));return;}
   if(!/text\/html|application\/xhtml\+xml/i.test(res.headers['content-type']||'')){res.resume();reject(new Error('This URL does not return an HTML page.'));return;}
   let length=0;const parts:Buffer[]=[];res.on('data',part=>{length+=part.length;if(length>1_500_000){req.destroy(new Error('Page exceeds the 1.5 MB preview limit. Use the extension.'));return;}parts.push(Buffer.from(part));});res.on('end',()=>{clearTimeout(deadline);resolve({html:Buffer.concat(parts).toString('utf8'),url:url.href});});res.on('error',reject);
  });const deadline=setTimeout(()=>req.destroy(new Error('The website took too long. Try the extension.')),12000);req.on('error',e=>{clearTimeout(deadline);reject(e);});req.on('close',()=>clearTimeout(deadline));
 });
}
export function parsePage(html:string,url:string){
 const {document}=parseHTML(html);const page=extractDocument(document as unknown as Document,url);
 // Snapshot only. Never execute third-party code or preserve form values.
 document.querySelectorAll('script,iframe,frame,object,embed,base,meta[http-equiv],link[rel="preload"],link[rel="modulepreload"],noscript').forEach(n=>n.remove());
 document.querySelectorAll('*').forEach(n=>{for(const attr of Array.from(n.attributes)){const name=attr.name.toLowerCase();if(name.startsWith('on')||['srcdoc','integrity','nonce','action','formaction','value','srcset','ping'].includes(name))n.removeAttribute(attr.name);}
  if(n.tagName==='TEXTAREA')n.textContent='';
  for(const attr of ['src','href','poster']){const value=n.getAttribute(attr);if(!value)continue;try{const resolved=new URL(value,url);if(!['http:','https:'].includes(resolved.protocol))n.removeAttribute(attr);else n.setAttribute(attr,resolved.href);}catch{n.removeAttribute(attr);}}
  if(n.tagName==='A'){if(n.getAttribute('href'))n.setAttribute('data-reflow-href',n.getAttribute('href')!);n.removeAttribute('href');}
  if(['INPUT','BUTTON','SELECT','TEXTAREA'].includes(n.tagName))n.setAttribute('disabled','');
 });
 const csp=document.createElement('meta');csp.setAttribute('http-equiv','Content-Security-Policy');csp.setAttribute('content',"default-src 'none'; style-src 'unsafe-inline' https:; img-src https: data:; font-src https: data:; script-src 'none'; connect-src 'none'; form-action 'none'; base-uri 'none'");document.head.prepend(csp);
 const style=document.createElement('style');style.textContent='html{scroll-behavior:auto!important}body{min-width:0!important}[data-reflow-id]{transition:background .2s}';document.head.append(style);
 page.previewHtml='<!doctype html>'+document.documentElement.outerHTML;
 return page;
}
