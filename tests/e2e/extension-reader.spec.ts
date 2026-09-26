import {test,expect,type Page,type Route} from '@playwright/test';
import type {PageSnapshot,ReadContext} from '../../shared/dom';

type RankRequest={page:PageSnapshot;task:string;context?:ReadContext};
type ExtensionTestWindow=Window&{
  __extensionChange:(values:Record<string,unknown>)=>void;
  __extensionMessages:unknown[];
};
const headers={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'Content-Type','Access-Control-Allow-Methods':'GET, POST, OPTIONS'};
const sourceUrl='https://example.org/first-page';
const readingText='The first page contains a long reading paragraph that continues across several Braille lines without losing the current position.';
const snapshot=(url=sourceUrl,id='initial',notice='Admission costs $18.'):PageSnapshot=>({
  id,url,title:url===sourceUrl?'First source page':'Second source page',source:'extension',capturedAt:new Date().toISOString(),totalCandidates:2,truncated:false,
  blocks:[{id:'b101',tag:'p',role:'text',region:'main',text:url===sourceUrl?readingText:'The second page is now selected in the browser.',order:0},{id:'b102',tag:'p',role:'text',region:'main',text:notice,order:1}],
});

async function installExtension(page:Page,initial:PageSnapshot|null){
  await page.addInitScript(({initial})=>{
    const listeners=new Set<(changes:Record<string,unknown>,area:string)=>void>();
    const values:Record<string,unknown>={snapshot:initial,captureError:'',pageChanged:false,sourceTabId:11,sourceWindowId:1,sourceRevision:100,captureStatus:'ready'};
    const messages:unknown[]=[];
    const emit=(patch:Record<string,unknown>)=>{const changes:Record<string,unknown>={};for(const[key,value]of Object.entries(patch)){changes[key]={oldValue:values[key],newValue:value};values[key]=value;}for(const listener of listeners)listener(changes,'session');};
    const storage={get:async(keys?:string|string[]|Record<string,unknown>)=>{if(!keys)return structuredClone(values);const names=typeof keys==='string'?[keys]:Array.isArray(keys)?keys:Object.keys(keys);return structuredClone(Object.fromEntries(names.map(key=>[key,values[key]])));},set:async(patch:Record<string,unknown>)=>emit(patch)};
    Object.defineProperty(window,'chrome',{configurable:true,value:{runtime:{id:'brailly-test-extension',connect:()=>{const disconnected=new Set<()=>void>();return{name:'brailly-reader',disconnect:()=>{for(const listener of disconnected)listener();},onDisconnect:{addListener:(listener:()=>void)=>disconnected.add(listener),removeListener:(listener:()=>void)=>disconnected.delete(listener)}};},sendMessage:async(message:unknown)=>{messages.push(message);return{ok:true};},getURL:(path:string)=>'chrome-extension://brailly-test-extension/'+path},storage:{session:storage,local:storage,onChanged:{addListener:(listener:(changes:Record<string,unknown>,area:string)=>void)=>listeners.add(listener),removeListener:(listener:(changes:Record<string,unknown>,area:string)=>void)=>listeners.delete(listener)}}}});
    const testWindow=window as unknown as ExtensionTestWindow;testWindow.__extensionChange=emit;testWindow.__extensionMessages=messages;
  },{initial});
  await page.route('**/api/config',route=>route.fulfill({headers,json:{jevConfigured:true,model:'TEST-ONLY-MOCK'}}));
}

async function emit(page:Page,values:Record<string,unknown>){await page.evaluate(patch=>(window as unknown as ExtensionTestWindow).__extensionChange(patch),values);}
async function response(route:Route,transition:'DEFER'|'INTERRUPT'='DEFER'){
  const request=route.request().postDataJSON() as RankRequest;
  return route.fulfill({headers,json:{snapshotId:request.page.id,task:request.task,model:'TEST-ONLY-MOCK',source:'Jev',latencyMs:15,usage:{input_tokens:100,output_tokens:20},request:{testOnly:true},results:request.page.blocks.map((block,index)=>({id:block.id,category:'CONTENT',score:index===0?3:1,confidence:.95,categoryConfidence:.95,priority:index===0?'NOW':'LATER',probabilities:{'0':0,'1':index===0?0:1,'2':0,'3':index===0?1:0}})),transition:request.context?{choice:transition,confidence:.95,probabilities:{DEFER:transition==='DEFER'?.95:.05,INTERRUPT:transition==='INTERRUPT'?.95:.05}}:undefined}});
}
async function mockRanks(page:Page,handler:(route:Route,request:RankRequest)=>Promise<unknown>){
  await page.route('**/api/rank',async route=>{if(route.request().method()==='OPTIONS'){await route.fulfill({status:204,headers,body:''});return;}await handler(route,route.request().postDataJSON() as RankRequest);});
}
const readTab=async(page:Page)=>page.getByRole('tab',{name:'Read',exact:true}).click();
const analyzeTab=async(page:Page)=>page.getByRole('tab',{name:'Analyze',exact:true}).click();

test('automatically analyzes the initial extension capture without pressing Analyze',async({page})=>{
  const initial=snapshot();const requests:RankRequest[]=[];
  await installExtension(page,initial);await mockRanks(page,async(route,request)=>{requests.push(request);await response(route);});
  await page.goto('/');
  await expect.poll(()=>requests.length).toBe(1);
  expect(requests[0].page.id).toBe(initial.id);
  await expect(page.locator('.queue-status')).toContainText('Ready');
  await expect(page.getByLabel('Website',{exact:true})).toHaveValue(sourceUrl);
  await expect(page.locator('iframe')).toHaveCount(0);
  await readTab(page);
  await expect(page.locator('#reading-output')).toHaveValue(readingText.slice(0,40));
  await expect(page.locator('.queue-score b')).toHaveCount(initial.blocks.length);
});

test('analyzes same-page extension updates and retains the exact current line',async({page})=>{
  test.setTimeout(30000);
  const requests:RankRequest[]=[];await installExtension(page,snapshot());await mockRanks(page,async(route,request)=>{requests.push(request);await response(route);});await page.goto('/');
  await expect(page.locator('.queue-status')).toContainText('Ready');await readTab(page);await page.getByRole('button',{name:'Next line',exact:true}).click();
  const line=await page.locator('#reading-output').inputValue();const position=await page.locator('.reading-position > span').innerText();
  await emit(page,{snapshot:snapshot(sourceUrl,'updated','Admission costs $22.'),sourceTabId:11,sourceWindowId:1,sourceRevision:100,pageChanged:false});
  await expect.poll(()=>requests.length,{timeout:12000}).toBe(2);
  expect(requests[1].context?.offset).toBeGreaterThan(0);
  expect(requests[1].context?.previousBlocks.find(block=>block.id==='b102')?.text).toBe('Admission costs $18.');
  expect(requests[1].page.blocks.find(block=>block.id==='b102')?.text).toBe('Admission costs $22.');
  await expect(page.locator('.queue-status')).toContainText('Ready');await expect(page.locator('#reading-output')).toHaveValue(line);await expect(page.locator('.reading-position > span')).toHaveText(position);
});

test('follows a newly captured URL automatically while keeping the user task',async({page})=>{
  const requests:RankRequest[]=[];await installExtension(page,snapshot());await mockRanks(page,async(route,request)=>{requests.push(request);await response(route);});await page.goto('/');await expect(page.locator('.queue-status')).toContainText('Ready');
  await analyzeTab(page);const task='Find the admission price and opening hours.';await page.getByLabel('Find',{exact:true}).fill(task);
  const next=snapshot('https://example.org/second-page','new-navigation','Admission is free.');await emit(page,{sourceTabId:22,sourceWindowId:1,sourceRevision:200,snapshot:next,pageChanged:false});
  await expect.poll(()=>requests.some(request=>request.page.url===next.url)).toBe(true);
  expect(requests.find(request=>request.page.url===next.url)?.task).toBe(task);
  await expect(page.locator('.queue-status')).toContainText('Ready');await expect(page.getByLabel('Website',{exact:true})).toHaveValue(next.url);await expect(page.getByLabel('Find',{exact:true})).toHaveValue(task);
  await readTab(page);await expect(page.locator('#reading-output')).toHaveValue(next.blocks[0].text.slice(0,40));
});

test('late classification from the previous source cannot overwrite a new extension page',async({page})=>{
  test.setTimeout(30000);
  const requests:RankRequest[]=[];let release!:()=>void;const held=new Promise<void>(resolve=>{release=resolve;});
  await installExtension(page,snapshot());await mockRanks(page,async(route,request)=>{requests.push(request);if(request.page.url===sourceUrl)await held;await response(route,'INTERRUPT');});await page.goto('/');await expect.poll(()=>requests.length).toBe(1);
  const next=snapshot('https://example.org/second-page','replacement');await emit(page,{sourceTabId:22,sourceWindowId:1,sourceRevision:200,snapshot:next,pageChanged:false});
  await expect.poll(()=>requests.some(request=>request.page.id===next.id)).toBe(true);await expect(page.locator('.queue-status')).toContainText('Ready');await readTab(page);const retained=await page.locator('#reading-output').inputValue();release();
  await expect(page.locator('#reading-output')).toHaveValue(retained);await page.waitForTimeout(250);await expect(page.locator('#reading-output')).toHaveValue(next.blocks[0].text.slice(0,40));await expect(page.getByRole('button',{name:'Resume reading',exact:true})).toHaveCount(0);
  await analyzeTab(page);await expect(page.getByLabel('Website',{exact:true})).toHaveValue(next.url);
});

test('a new active tab at the same URL starts a fresh analysis instead of treating it as a live mutation',async({page})=>{
  const requests:RankRequest[]=[];await installExtension(page,snapshot());await mockRanks(page,async(route,request)=>{requests.push(request);await response(route);});await page.goto('/');await expect(page.locator('.queue-status')).toContainText('Ready');
  await readTab(page);await page.getByRole('button',{name:'Next line',exact:true}).click();await expect(page.locator('.reading-position > span')).not.toHaveText(/^1–/);
  const next=snapshot(sourceUrl,'same-url-new-tab','Admission costs $35.');await emit(page,{sourceTabId:22,sourceWindowId:1,sourceRevision:200,snapshot:next,captureStatus:'ready'});
  await expect.poll(()=>requests.some(request=>request.page.id===next.id)).toBe(true);
  expect(requests.find(request=>request.page.id===next.id)?.context).toBeUndefined();await expect(page.locator('.queue-status')).toContainText('Ready');await expect(page.locator('#reading-output')).toHaveValue(readingText.slice(0,40));await expect(page.locator('.reading-position > span')).toHaveText(/^1–/);
});

test('ignores a late storage snapshot from an older source revision',async({page})=>{
  const requests:RankRequest[]=[];await installExtension(page,snapshot());await mockRanks(page,async(route,request)=>{requests.push(request);await response(route);});await page.goto('/');await expect(page.locator('.queue-status')).toContainText('Ready');
  const next=snapshot('https://example.org/second-page','current-tab');await emit(page,{sourceTabId:22,sourceWindowId:1,sourceRevision:200,snapshot:next,captureStatus:'ready'});await expect.poll(()=>requests.some(request=>request.page.id===next.id)).toBe(true);await expect(page.locator('.queue-status')).toContainText('Ready');
  await emit(page,{sourceTabId:11,sourceWindowId:1,sourceRevision:100,snapshot:snapshot(sourceUrl,'late-old-tab','Stale source must not return.'),captureStatus:'ready'});
  await readTab(page);await expect(page.locator('#reading-output')).toHaveValue(next.blocks[0].text.slice(0,40));await analyzeTab(page);await expect(page.getByLabel('Website',{exact:true})).toHaveValue(next.url);await page.waitForTimeout(800);expect(requests.some(request=>request.page.id==='late-old-tab')).toBe(false);await expect(page.getByLabel('Website',{exact:true})).toHaveValue(next.url);
});

test('clears the previous source during a new capture and rejects its in-flight response',async({page})=>{
  test.setTimeout(30000);
  const requests:RankRequest[]=[];
  let release!:()=>void;
  let oldResponseFinished=false;
  const held=new Promise<void>(resolve=>{release=resolve;});
  await installExtension(page,snapshot());
  await mockRanks(page,async(route,request)=>{
    requests.push(request);
    if(request.page.id==='held-update'){
      await held;
      await response(route,'INTERRUPT');
      oldResponseFinished=true;
      return;
    }
    await response(route);
  });
  await page.goto('/');
  await expect(page.locator('.queue-status')).toContainText('Ready');
  await expect(page.locator('#reading-output')).not.toHaveValue('');
  await emit(page,{snapshot:snapshot(sourceUrl,'held-update','Admission costs $22.'),sourceTabId:11,sourceRevision:100,captureStatus:'ready'});
  await expect.poll(()=>requests.some(request=>request.page.id==='held-update'),{timeout:12000}).toBe(true);

  await emit(page,{snapshot:null,sourceTabId:22,sourceWindowId:1,sourceRevision:200,captureStatus:'capturing',captureError:''});
  await expect(page.locator('#reading-output')).toHaveValue('');
  await expect(page.locator('.hw-dots i.raised')).toHaveCount(0);
  await expect(page.locator('.queue-score b')).toHaveCount(0);
  release();
  await expect.poll(()=>oldResponseFinished).toBe(true);
  await expect(page.locator('#reading-output')).toHaveValue('');
  await expect(page.getByRole('button',{name:'Resume reading',exact:true})).toHaveCount(0);

  const next=snapshot('https://example.org/second-page','captured-new-tab');
  await emit(page,{snapshot:next,sourceTabId:22,sourceWindowId:1,sourceRevision:200,captureStatus:'ready',captureError:''});
  await expect.poll(()=>requests.some(request=>request.page.id===next.id)).toBe(true);
  await expect(page.locator('.queue-status')).toContainText('Ready');
  await expect(page.locator('#reading-output')).toHaveValue(next.blocks[0].text.slice(0,40));
});

test('an unsupported browser page clears the previous reading and explains the capture failure',async({page})=>{
  const requests:RankRequest[]=[];
  await installExtension(page,snapshot());
  await mockRanks(page,async(route,request)=>{requests.push(request);await response(route);});
  await page.goto('/');
  await expect(page.locator('.queue-status')).toContainText('Ready');
  await expect(page.locator('#reading-output')).not.toHaveValue('');
  expect(await page.locator('.hw-dots i.raised').count()).toBeGreaterThan(0);

  const captureError='Browser settings pages cannot be read. Open a website to continue.';
  await emit(page,{snapshot:null,sourceTabId:33,sourceWindowId:1,sourceRevision:200,captureStatus:'unavailable',captureError});
  await expect(page.getByRole('alert')).toContainText(captureError);
  await expect(page.locator('#reading-output')).toHaveValue('');
  await expect(page.locator('.hw-dots i.raised')).toHaveCount(0);
  await expect(page.locator('.queue-score b')).toHaveCount(0);
  await analyzeTab(page);
  await expect(page.getByLabel('Website',{exact:true})).toHaveValue('');
  expect(requests).toHaveLength(1);
});
