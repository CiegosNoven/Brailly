import 'dotenv/config';
import {readFile} from 'node:fs/promises';
import {parsePage} from '../server/page';
import {createDomRequest} from '../server/dom-jev';
const page=parsePage(await readFile('public/example.html','utf8'),'https://brailly-jev.vercel.app/example.html');
const body=createDomRequest(page,'Find opening hours and accessible entrance.','jev-1.13.0');
const r=await fetch('https://api.typesafe.ai/v1/systemone',{method:'POST',headers:{Authorization:`Bearer ${process.env.TYPESAFE_API_KEY}`,'Content-Type':'application/json'},body:JSON.stringify(body)});
const data=await r.json();console.log(JSON.stringify({status:r.status,blocks:page.blocks.length,questions:Object.keys(body.questions).length,bytes:JSON.stringify(body).length,response:r.ok?{model:data.model,answers:Object.keys(data.answers).length,usage:data.usage}:data}));
