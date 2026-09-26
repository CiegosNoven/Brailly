import {FRAME_BRIDGE} from './generated-frame';
export function frameDocument(html:string,url:string,token:string){
 const doc=new DOMParser().parseFromString(html,'text/html');
 doc.querySelectorAll('script,iframe,object,embed,base,meta[http-equiv]').forEach(node=>node.remove());
 doc.querySelectorAll('*').forEach(node=>{for(const attr of Array.from(node.attributes)){if(attr.name.toLowerCase().startsWith('on')||['srcdoc','action','formaction','value'].includes(attr.name.toLowerCase()))node.removeAttribute(attr.name);}if(node.tagName==='A'&&node.getAttribute('href')){node.setAttribute('data-reflow-href',new URL(node.getAttribute('href')!,url).href);node.removeAttribute('href');}if(node.tagName==='TEXTAREA')node.textContent='';});
 const csp=doc.createElement('meta');csp.setAttribute('http-equiv','Content-Security-Policy');csp.setAttribute('content',`default-src 'none'; script-src 'nonce-${token}'; style-src 'unsafe-inline' https:; img-src https: data:; font-src https: data:; connect-src 'none'; form-action 'none'; base-uri 'none'`);doc.head.prepend(csp);
 const style=doc.createElement('style');style.textContent='[data-reflow-id]{cursor:pointer}a[data-reflow-href]{cursor:pointer}html{overflow-x:hidden}body{min-width:0!important}';doc.head.append(style);
 const script=doc.createElement('script');script.setAttribute('nonce',token);script.textContent='window.__REFLOW='+JSON.stringify({url,token}).replace(/</g,'\\u003c')+';'+FRAME_BRIDGE;doc.body.append(script);
 return '<!doctype html>'+doc.documentElement.outerHTML;
}
