import 'dotenv/config';
import {readFile,writeFile} from 'node:fs/promises';
import {parsePage} from '../server/page';
import {classifyDom} from '../server/dom-jev';
const page=parsePage(await readFile('public/example.html','utf8'),'https://brailly-jev.vercel.app/example.html');
if(!process.env.TYPESAFE_API_KEY)throw new Error('Server key is missing');
const result=await classifyDom(page,'Find the opening hours, ticket price, and accessible entrance.',process.env.TYPESAFE_API_KEY,'jev-1.13.0');
await writeFile('artifacts/live-jev-dom.json',JSON.stringify({page:{...page,previewHtml:undefined},result},null,2));
console.log(JSON.stringify({model:result.model,blocks:result.results.length,latencyMs:result.latencyMs,top:result.results.filter(r=>r.score>=2.4).map(r=>({text:page.blocks.find(b=>b.id===r.id)?.text,score:r.score,confidence:r.confidence}))},null,2));
