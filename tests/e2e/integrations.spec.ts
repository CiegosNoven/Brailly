import {test, expect, type Page} from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import type {PageSnapshot} from '../../shared/dom';
import type {VisualCandidate, VisualCoverage} from '../../shared/visual';

const paragraph = 'Open Tuesday–Sunday, 10 am–6 pm. Admission is $18. The Garden Lane entrance is shown in the map. Continue reading this original museum paragraph while the independently generated description and Jev ranking arrive. Neither late result should change this line or its Braille cell page.';
const candidate: VisualCandidate = {candidateId:'v1',kind:'svg',altStatus:'not-applicable',sourceAltText:null,title:'',caption:'Museum access map',accessibleName:'Museum site map',nearbyHeading:'Accessibility',nearbyText:'Use this map to find the step-free entrance.',control:null,width:880,height:490,x:0,y:500,hidden:false,locator:'[data-brailly-visual="v1"]',signature:'fixture-map-signature',asset:''};
const coverage: VisualCoverage = {totalCandidates:1,includedCandidates:1,inspected:0,sourceAlt:0,skipped:0,uninspected:1,hidden:0,truncated:false,domSkipped:false,blockedRequests:0,unsupported:['CSS backgrounds','iframes','shadow DOM']};
type TestWindow = Window & {__visualEmit:(type:string)=>void;__visualAbort:boolean;__visualReady:boolean;__ttsResolve:()=>void;__ttsCalls:{text:string;requestId:string}[];__ttsAbort:boolean;__audioPlays:number;__browserSpeaks:number};
const tab = (page:Page, name:'Analyze'|'Read') => page.getByRole('tab',{name,exact:true}).click();
const output = (page:Page) => page.locator('#reading-output');

/** Explicit test-only provider stream; late events cross separate browser tasks. */
async function installVisualStream(page:Page, empty=false) {
  const snapshot:PageSnapshot = {id:'test-visual-snapshot',url:'https://fixture.example/visual-demo.html',title:'Visual fixture',source:'browserbase',capturedAt:'2026-09-26T12:00:00Z',totalCandidates:empty?0:2,truncated:false,blocks:empty?[]:[{id:'b1',tag:'p',role:'text',region:'main',text:paragraph,order:0},{id:'b2',tag:'p',role:'text',region:'main',text:'Higher-ranked source text must not steal the current reading position.',order:1}]};
  await page.route('**/api/config',route=>route.fulfill({json:{jevConfigured:true,model:'TEST-ONLY-MOCK',visualEnabled:true,visualConfigured:true,visualAllowedOrigins:['https://fixture.example'],elevenlabsTts:{enabled:true,configured:true,available:true,maxCharacters:800}}}));
  await page.addInitScript(({snapshot,candidate,coverage,empty})=>{
    const scope=window as unknown as TestWindow;
    const originalFetch=window.fetch.bind(window);
    scope.__visualAbort=false;scope.__visualReady=false;scope.__audioPlays=0;scope.__browserSpeaks=0;scope.__ttsAbort=false;scope.__ttsCalls=[];
    Object.defineProperty(window,'Audio',{configurable:true,value:class TestAudio {onended=null;onerror=null;play(){scope.__audioPlays++;return Promise.resolve();}pause(){}removeAttribute(){}load(){}}});
    window.speechSynthesis.speak=()=>{scope.__browserSpeaks++;};
    window.fetch=async(input,init)=>{
      const url=typeof input==='string'?input:input instanceof URL?input.href:input.url;
      if(url.endsWith('/api/tts')){
        scope.__ttsCalls.push(JSON.parse(String(init?.body)));
        init?.signal?.addEventListener('abort',()=>{scope.__ttsAbort=true;});
        // Resolves despite abort to prove that stale audio is discarded.
        return new Promise(resolve=>{scope.__ttsResolve=()=>resolve(new Response(new Uint8Array([73,68,51,1]),{headers:{'Content-Type':'audio/mpeg'}}));});
      }
      if(!url.endsWith('/api/visual-capture')) return originalFetch(input,init);
      const request=JSON.parse(String(init?.body));let sequence=0;let closed=false;
      const identity={requestId:request.requestId,snapshotId:snapshot.id,captureId:'test-visual-capture'};
      const currentCoverage={...coverage,domSkipped:empty};
      const encoder=new TextEncoder();
      const stream=new ReadableStream<Uint8Array>({start(controller){
        const send=(payload:Record<string,unknown>)=>{if(closed)return;const bytes=encoder.encode(JSON.stringify({...identity,sequence:++sequence,...payload})+'\n');const split=Math.floor(bytes.length/2);controller.enqueue(bytes.slice(0,split));controller.enqueue(bytes.slice(split));};
        scope.__visualEmit=(type)=>{
          if(type==='rank')send({type:'dom-ranked',classification:{snapshotId:snapshot.id,task:request.task.trim(),model:'TEST-ONLY-MOCK',latencyMs:12,source:'Jev',request:{testOnly:true},results:snapshot.blocks.map((block,index)=>({id:block.id,category:'CONTENT',score:index?3:1,confidence:1,categoryConfidence:1,priority:index?'NOW':'LATER',probabilities:{'0':0,'1':index?0:1,'2':0,'3':index?1:0}}))}});
          if(type==='evidence')send({type:'visual-evidence',evidence:[{...identity,candidateId:'v1',signature:candidate.signature,sourceAltText:null,generatedDescription:'The step-free route reaches the east museum door via the Garden Lane ramp. The front door has stairs.',recognizedText:'STEP-FREE ENTRANCE',uncertainty:'The diagram is not to scale.',observedAt:'2026-09-26T12:00:01Z',method:'stagehand-vision',model:'TEST-ONLY-VISION',score:3,confidence:1,priority:'NOW'}]});
          if(type==='done'){send({type:'done',status:'complete',coverage:{...currentCoverage,inspected:1,uninspected:0},metrics:{totalMs:100,loadMs:10,domMs:10,selectionMs:10,visionMs:60,priorityMs:10},sessionClosed:true});closed=true;controller.close();}
          if(type==='disconnect'){closed=true;controller.close();}
        };
        send({type:'snapshot',page:snapshot,candidates:[candidate],coverage:currentCoverage});
        scope.__visualReady=true;
        init?.signal?.addEventListener('abort',()=>{scope.__visualAbort=true;if(!closed){closed=true;controller.error(new DOMException('Stopped','AbortError'));}});
      }});
      return new Response(stream,{headers:{'Content-Type':'application/x-ndjson'}});
    };
  },{snapshot,candidate,coverage,empty});
}
async function emit(page:Page,type:'rank'|'evidence'|'done'|'disconnect') {await page.evaluate(type=>(window as unknown as TestWindow).__visualEmit(type),type);}
async function openVisual(page:Page) {
  await page.goto('/');await expect(page.locator('.live-status')).toContainText('rendered DOM blocks ready');
  await page.getByLabel('Website',{exact:true}).fill('https://fixture.example/visual-demo.html');
  await page.getByRole('button',{name:'Open with visual context',exact:true}).click();
  await expect.poll(()=>page.evaluate(()=>(window as unknown as TestWindow).__visualReady)).toBe(true);
  await expect(page.getByRole('heading',{name:'Visual details',exact:true})).toBeVisible();
}

for (const order of [['rank','evidence'],['evidence','rank']] as const) {
  test(`late ${order.join(' then ')} retains source line, cells and focus; detail restores its opener`,async({page})=>{
    await installVisualStream(page);await openVisual(page);await tab(page,'Read');await page.getByLabel('Display cells').selectOption('20');
    await page.getByRole('button',{name:'Next line',exact:true}).click();await page.getByRole('button',{name:'Hardware next cells',exact:true}).click();
    const line=await output(page).inputValue();const position=await page.locator('.reading-position > span').innerText();const cells=await page.locator('.hw-pagination').getAttribute('aria-label');const queue=await page.locator('.queue-item .queue-text').allTextContents();expect(position).not.toMatch(/^1–/);expect(cells).toMatch(/page 2 /);
    await output(page).focus();for(const event of order)await emit(page,event);await emit(page,'done');
    await expect(page.locator('.visual-announcement')).toContainText('1 visual detail');await expect(output(page)).toHaveValue(line);await expect(output(page)).toBeFocused();await expect(page.locator('.reading-position > span')).toHaveText(position);await expect(page.locator('.hw-pagination')).toHaveAttribute('aria-label',cells!);
    expect(await page.locator('.queue-item .queue-text').allTextContents()).toEqual(queue);
    expect(await page.evaluate(()=>(window as unknown as TestWindow).__audioPlays+(window as unknown as TestWindow).__browserSpeaks)).toBe(0);
    await tab(page,'Analyze');const opener=page.getByRole('button',{name:/^Open visual detail 1/});await opener.click();
    await expect(page.getByRole('dialog')).toContainText('Generated visual description');await expect(page.getByRole('dialog')).toContainText('Garden Lane ramp');await expect(page.getByRole('button',{name:'Close visual detail',exact:true})).toBeFocused();
    expect((await new AxeBuilder({page}).exclude('iframe').analyze()).violations).toEqual([]);
    await page.keyboard.press('Escape');await expect(opener).toBeFocused();await tab(page,'Read');await expect(output(page)).toHaveValue(line);await expect(page.locator('.hw-pagination')).toHaveAttribute('aria-label',cells!);
  });
}

test('changing the task aborts an old capture and rejects its late evidence',async({page})=>{
  await installVisualStream(page);await openVisual(page);const line=await output(page).inputValue();await page.getByLabel('Find',{exact:true}).fill('Find discounts in the museum shop instead.');
  await expect.poll(()=>page.evaluate(()=>(window as unknown as TestWindow).__visualAbort)).toBe(true);await emit(page,'evidence');await emit(page,'rank');
  await expect(page.getByRole('button',{name:/^Open visual detail 1/})).toHaveCount(0);await expect(page.locator('.queue-score b')).toHaveCount(0);await tab(page,'Read');await expect(output(page)).toHaveValue(line);
});

test('cancelling after snapshot keeps source reading available',async({page})=>{
  await installVisualStream(page);await openVisual(page);await page.getByRole('button',{name:'Cancel visual capture',exact:true}).click();
  await expect.poll(()=>page.evaluate(()=>(window as unknown as TestWindow).__visualAbort)).toBe(true);await expect(page.locator('.visual-details')).toContainText('Partial analysis');await tab(page,'Read');await expect(output(page)).toHaveValue(paragraph.slice(0,40));await expect(page.getByRole('button',{name:'Listen',exact:true})).toBeEnabled();
});

test('a visual-only capture never submits empty source blocks for ranking',async({page})=>{
  let ranks=0;await page.route('**/api/rank',route=>{ranks++;return route.fulfill({status:500,json:{error:'An empty source must never be ranked.'}});});
  await installVisualStream(page,true);await openVisual(page);await emit(page,'evidence');await emit(page,'done');
  await expect(page.locator('.visual-details')).toContainText('no source text blocks');await expect(page.getByRole('button',{name:'Analyze page',exact:true})).toBeDisabled();
  await tab(page,'Read');await expect(output(page)).toHaveValue('');await expect(page.getByRole('button',{name:'Listen',exact:true})).toBeDisabled();await tab(page,'Analyze');await page.getByRole('button',{name:/^Open visual detail 1/}).click();await expect(page.getByRole('button',{name:'Listen to visual detail',exact:true})).toBeEnabled();expect(ranks).toBe(0);
});

test('Stop during ElevenLabs loading prevents late audio and automatic fallback',async({page})=>{
  await installVisualStream(page);await openVisual(page);await emit(page,'rank');await emit(page,'done');await tab(page,'Read');await page.getByLabel('Voice provider').selectOption('elevenlabs');const selected=await output(page).inputValue();
  await page.getByRole('button',{name:'Listen',exact:true}).click();await expect.poll(()=>page.evaluate(()=>(window as unknown as TestWindow).__ttsCalls.length)).toBe(1);expect(await page.evaluate(()=>(window as unknown as TestWindow).__ttsCalls[0].text)).toBe('Higher-ranked source text must not steal the current reading position.');
  await page.getByRole('button',{name:'Stop',exact:true}).click();await expect.poll(()=>page.evaluate(()=>(window as unknown as TestWindow).__ttsAbort)).toBe(true);await page.evaluate(()=>(window as unknown as TestWindow).__ttsResolve());await expect(page.getByRole('button',{name:'Listen',exact:true})).toBeVisible();expect(await page.evaluate(()=>(window as unknown as TestWindow).__audioPlays)).toBe(0);expect(await page.evaluate(()=>(window as unknown as TestWindow).__browserSpeaks)).toBe(0);await expect(output(page)).toHaveValue(selected);
});

test('closing a visual detail stops its loading audio without speaking the source',async({page})=>{
  await installVisualStream(page);await openVisual(page);await emit(page,'rank');await emit(page,'evidence');await emit(page,'done');await tab(page,'Read');await page.getByLabel('Voice provider').selectOption('elevenlabs');const retained=await output(page).inputValue();await tab(page,'Analyze');
  const opener=page.getByRole('button',{name:/^Open visual detail 1/});await opener.click();await page.getByRole('button',{name:'Listen to visual detail',exact:true}).click();await expect.poll(()=>page.evaluate(()=>(window as unknown as TestWindow).__ttsCalls.length)).toBe(1);expect(await page.evaluate(()=>(window as unknown as TestWindow).__ttsCalls[0].text)).toContain('Garden Lane ramp');await page.keyboard.press('Escape');await expect(opener).toBeFocused();await expect.poll(()=>page.evaluate(()=>(window as unknown as TestWindow).__ttsAbort)).toBe(true);await page.evaluate(()=>(window as unknown as TestWindow).__ttsResolve());expect(await page.evaluate(()=>(window as unknown as TestWindow).__audioPlays+(window as unknown as TestWindow).__browserSpeaks)).toBe(0);await tab(page,'Read');await expect(output(page)).toHaveValue(retained);
});


test('selecting another source while ElevenLabs plays stops the old audio and starts the new block',async({page})=>{
  await installVisualStream(page);await openVisual(page);await emit(page,'rank');await emit(page,'done');await tab(page,'Read');await page.getByLabel('Voice provider').selectOption('elevenlabs');
  await page.getByRole('button',{name:'Listen',exact:true}).click();await expect.poll(()=>page.evaluate(()=>(window as unknown as TestWindow).__ttsCalls.length)).toBe(1);await page.evaluate(()=>(window as unknown as TestWindow).__ttsResolve());await expect.poll(()=>page.evaluate(()=>(window as unknown as TestWindow).__audioPlays)).toBe(1);await expect(page.getByRole('button',{name:'Stop',exact:true})).toBeVisible();
  await page.getByRole('button',{name:'Next block',exact:true}).click();await expect.poll(()=>page.evaluate(()=>(window as unknown as TestWindow).__ttsCalls.length)).toBe(2);expect(await page.evaluate(()=>(window as unknown as TestWindow).__ttsCalls[1].text)).toBe(paragraph);await page.evaluate(()=>(window as unknown as TestWindow).__ttsResolve());await expect.poll(()=>page.evaluate(()=>(window as unknown as TestWindow).__audioPlays)).toBe(2);await expect(page.getByRole('button',{name:'Stop',exact:true})).toBeVisible();await expect(output(page)).toHaveValue(paragraph.slice(0,40));
});


test('an interrupted stream keeps its captured text and reports a partial analysis',async({page})=>{
  await installVisualStream(page);await openVisual(page);await emit(page,'evidence');await emit(page,'disconnect');await expect(page.locator('.visual-details')).toContainText('Partial analysis');await expect(page.locator('.visual-errors')).toContainText(/complete|ended/i);await tab(page,'Read');await expect(output(page)).toHaveValue(paragraph.slice(0,40));await page.getByRole('button',{name:/^Open visual detail 1/}).click();await expect(page.getByRole('dialog')).toContainText('Garden Lane ramp');
});

test('a task with surrounding spaces uses the same normalized task for streamed ranking',async({page})=>{
  await installVisualStream(page);await page.goto('/');await expect(page.locator('.live-status')).toContainText('rendered DOM blocks ready');await page.getByLabel('Website',{exact:true}).fill('https://fixture.example/visual-demo.html');await page.getByLabel('Find',{exact:true}).fill('  Find the accessible entrance.  ');await page.getByRole('button',{name:'Open with visual context',exact:true}).click();await expect.poll(()=>page.evaluate(()=>(window as unknown as TestWindow).__visualReady)).toBe(true);await emit(page,'rank');await emit(page,'done');await expect(page.locator('.queue-score b')).toHaveCount(2);await expect(page.locator('.visual-errors')).toHaveCount(0);await expect(page.locator('.visual-details')).toContainText('Analysis complete');
});

test('recognized image text has its own exact speech action and closes without resuming source audio',async({page})=>{
  await installVisualStream(page);await openVisual(page);await emit(page,'evidence');await emit(page,'rank');await emit(page,'done');
  await page.getByLabel('Voice provider').selectOption('elevenlabs');const retained=await output(page).inputValue();
  const opener=page.getByRole('button',{name:/^Open visual detail 1/});await opener.click();await page.getByRole('button',{name:'Listen to recognized text',exact:true}).click();
  await expect.poll(()=>page.evaluate(()=>(window as unknown as TestWindow).__ttsCalls.length)).toBe(1);expect(await page.evaluate(()=>(window as unknown as TestWindow).__ttsCalls[0].text)).toBe('STEP-FREE ENTRANCE');
  await expect(page.getByRole('button',{name:'Stop recognized audio',exact:true})).toBeVisible();await expect(page.getByRole('button',{name:'Listen to visual detail',exact:true})).toBeVisible();
  await page.keyboard.press('Escape');await expect(opener).toBeFocused();await expect.poll(()=>page.evaluate(()=>(window as unknown as TestWindow).__ttsAbort)).toBe(true);await page.evaluate(()=>(window as unknown as TestWindow).__ttsResolve());
  expect(await page.evaluate(()=>(window as unknown as TestWindow).__audioPlays+(window as unknown as TestWindow).__browserSpeaks)).toBe(0);await tab(page,'Read');await expect(output(page)).toHaveValue(retained);
});

test('starting source speech before visual ranking retains that block and its audio when ranking arrives',async({page})=>{
  await installVisualStream(page);await openVisual(page);await tab(page,'Read');await page.getByLabel('Voice provider').selectOption('elevenlabs');await page.getByRole('button',{name:'Listen',exact:true}).click();
  await expect.poll(()=>page.evaluate(()=>(window as unknown as TestWindow).__ttsCalls.length)).toBe(1);expect(await page.evaluate(()=>(window as unknown as TestWindow).__ttsCalls[0].text)).toBe(paragraph);
  await emit(page,'rank');await emit(page,'done');await expect(output(page)).toHaveValue(paragraph.slice(0,40));expect(await page.evaluate(()=>(window as unknown as TestWindow).__ttsAbort)).toBe(false);
  await page.evaluate(()=>(window as unknown as TestWindow).__ttsResolve());await expect.poll(()=>page.evaluate(()=>(window as unknown as TestWindow).__audioPlays)).toBe(1);await expect(page.getByRole('button',{name:'Stop',exact:true})).toBeVisible();
});

test('alert and visual captures cancel the previous job and restore the appropriate reader panel',async({page})=>{
  let rankCalls=0;
  await installVisualStream(page);
  await page.route('**/api/rank',route=>{
    rankCalls++;
    const {page:snapshot,task,context}=route.request().postDataJSON() as {page:PageSnapshot;task:string;context?:unknown};
    return route.fulfill({json:{snapshotId:snapshot.id,task,model:'TEST-ONLY-MOCK',source:'Jev',latencyMs:5,request:{testOnly:true},results:snapshot.blocks.map(block=>({id:block.id,category:'CONTENT',score:block.text.startsWith('Street elevator')?3:1,confidence:1,categoryConfidence:1,priority:'NOW',probabilities:{'0':0,'1':block.text.startsWith('Street elevator')?0:1,'2':0,'3':block.text.startsWith('Street elevator')?1:0}})),transition:context?{choice:'DEFER',confidence:1,probabilities:{DEFER:1,INTERRUPT:0,QUEUE_HIGH:0,NONE:0}}:undefined}});
  });
  await openVisual(page);await tab(page,'Read');await page.getByLabel('Voice provider').selectOption('elevenlabs');await page.getByRole('button',{name:'Listen',exact:true}).click();
  await expect.poll(()=>page.evaluate(()=>(window as unknown as TestWindow).__ttsCalls.length)).toBe(1);
  await page.getByRole('button',{name:'Play alert demo',exact:true}).click();
  await expect.poll(()=>page.evaluate(()=>(window as unknown as TestWindow).__visualAbort)).toBe(true);await expect.poll(()=>page.evaluate(()=>(window as unknown as TestWindow).__ttsAbort)).toBe(true);
  await emit(page,'evidence');await emit(page,'rank');
  await expect(output(page)).toHaveValue(/^Street elevator in service/);
  await expect(page.getByRole('complementary',{name:'Live alert demonstration'})).toBeVisible();
  await expect(page.locator('.queue-panel')).toHaveCount(0);await expect(page.locator('.visual-details')).toHaveCount(0);
  await tab(page,'Analyze');await page.getByLabel('Website',{exact:true}).fill('https://fixture.example/visual-demo.html');await page.getByRole('button',{name:'Open with visual context',exact:true}).click();
  await expect(page.locator('.visual-details')).toBeVisible();await emit(page,'evidence');await emit(page,'rank');await emit(page,'done');await tab(page,'Read');
  await expect(page.getByRole('complementary',{name:'Live alert demonstration'})).toHaveCount(0);await expect(page.locator('.queue-panel')).toBeVisible();
  const retained=await output(page).inputValue();
  // The old elevator timer fires after 1.4s; it must not mutate the new source.
  await page.waitForTimeout(1700);
  await expect(output(page)).toHaveValue(retained);expect(rankCalls).toBe(1);
  await page.evaluate(()=>(window as unknown as TestWindow).__ttsResolve());expect(await page.evaluate(()=>(window as unknown as TestWindow).__audioPlays)).toBe(0);
  await expect(page.getByRole('button',{name:/^Open visual detail 1/})).toBeVisible();
});
