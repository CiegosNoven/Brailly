import { test, expect, type Page } from '@playwright/test';
import type { PageSnapshot, ReadContext } from '../../shared/dom';

type TraceWindow = Window & { sounds: number; voices: number };
const text = 'Use the east entrance to reach the museum. This paragraph continues across several Braille lines and must keep its exact reading position.';
async function setup(page: Page, choice: string, partial = false) {
  let captures = 0;
  const requests: {page: PageSnapshot; context: ReadContext}[] = [];
  await page.route('**/api/config', route => route.fulfill({json:{visualEnabled:true,elevenlabsTts:{available:true}}}));
  await page.addInitScript(() => {
    const w = window as unknown as TraceWindow; w.sounds = 0; w.voices = 0;
    Object.defineProperty(window, 'Audio', {value:class {play(){w.voices++;return Promise.resolve();}pause(){}load(){}removeAttribute(){}}});
    Object.defineProperty(window, 'AudioContext', {value:class {
      state='running';currentTime=0;destination={};resume(){return Promise.resolve();}close(){return Promise.resolve();}
      createOscillator(){return {frequency:{value:0},connect(){},disconnect(){},start(){w.sounds++;},stop(){}};}
      createGain(){return {gain:{setValueAtTime(){},linearRampToValueAtTime(){},exponentialRampToValueAtTime(){}},connect(){},disconnect(){}};}
    }});
  });
  await page.route('**/api/tts', route => route.fulfill({contentType:'audio/mpeg',body:Buffer.from([73,68,51,1])}));
  await page.route('**/api/visual-capture', route => {
    captures++;
    const {requestId} = route.request().postDataJSON();
    const base = {requestId,snapshotId:`s${captures}`,captureId:`c${captures}`};
    const snapshot: PageSnapshot = {id:base.snapshotId,url:'https://fixture.example/map',title:'Museum',source:'browserbase',capturedAt:new Date().toISOString(),totalCandidates:1,truncated:false,blocks:[{id:'b1',tag:'p',role:'text',region:'main',order:0,text}]};
    const coverage = {totalCandidates:1,includedCandidates:1,inspected:1,sourceAlt:0,skipped:0,uninspected:0,hidden:0,truncated:false,domSkipped:false,blockedRequests:0,unsupported:[]};
    const candidate = {candidateId:'v1',kind:'svg',altStatus:'missing',sourceAltText:null,title:'Map',caption:'',accessibleName:'',nearbyHeading:'',nearbyText:'',control:null,width:400,height:300,x:0,y:0,hidden:false,locator:'svg',signature:`map-${Math.min(captures,2)}`,asset:''};
    const events = [
      {...base,sequence:1,type:'snapshot',page:snapshot,candidates:[candidate],coverage},
      {...base,sequence:2,type:'visual-evidence',evidence:[{...base,candidateId:'v1',signature:candidate.signature,sourceAltText:null,generatedDescription:captures===1?'East entrance open.':'East entrance closed. Use the west entrance.',recognizedText:'Museum access',uncertainty:'',observedAt:new Date().toISOString(),method:'stagehand-vision',model:'TEST',score:3,confidence:1,priority:'NOW'}]},
      {...base,sequence:3,type:'done',status:partial&&captures>1?'partial':'complete',coverage,metrics:{totalMs:1,loadMs:1,domMs:0,selectionMs:0,visionMs:0,priorityMs:0},sessionClosed:true},
    ];
    return route.fulfill({contentType:'application/x-ndjson',body:events.map(event=>JSON.stringify(event)).join('\n')+'\n'});
  });
  await page.route('**/api/rank', route => {
    const body = route.request().postDataJSON(); requests.push(body);
    return route.fulfill({json:{snapshotId:body.page.id,task:body.task,model:'TEST',latencyMs:1,source:'Jev',request:{},results:body.page.blocks.map((b:{id:string;tag:string})=>({id:b.id,category:'NOTICE',score:b.tag==='figure'?3:1,priority:'NOW',confidence:1})),transition:{choice,confidence:1}}});
  });
  await page.goto('/');
  await expect(page.locator('.live-status')).toContainText('rendered DOM blocks ready');
  await page.clock.install();
  await page.getByLabel('Website',{exact:true}).fill('https://fixture.example/map');
  await page.getByRole('button',{name:'Open with visual context',exact:true}).click();
  await expect(page.getByRole('button',{name:'Stop automatic checks',exact:true})).toBeVisible();
  return {requests,captures:()=>captures};
}

for (const decision of ['DEFER','QUEUE_HIGH','INTERRUPT']) {
  test(`30-second visual review: ${decision}, audio and retained Braille`, async ({page}) => {
    const trace = await setup(page,decision);
    await page.getByRole('tab',{name:'Read',exact:true}).click();
    await page.getByRole('button',{name:'Next line',exact:true}).click();
    const before = await page.locator('#reading-output').inputValue();
    const position = await page.locator('.reading-position > span').innerText();
    await page.clock.fastForward(30_000);
    await expect.poll(()=>trace.requests.length).toBe(1);
    expect(trace.requests[0].context.previousBlocks.some(b=>b.text.includes('East entrance open.'))).toBe(true);
    expect(trace.requests[0].page.blocks.some(b=>b.text.includes('East entrance closed.'))).toBe(true);
    if (decision==='INTERRUPT') {
      await expect(page.locator('#reading-output')).toHaveValue(/^Visual observation/);
      await expect.poll(()=>page.evaluate(()=>(window as unknown as TraceWindow).sounds)).toBe(1);
      await page.getByRole('button',{name:'Resume reading',exact:true}).click();
    } else if (decision==='QUEUE_HIGH') {
      await expect.poll(()=>page.evaluate(()=>(window as unknown as TraceWindow).voices)).toBe(1);
    } else {
      expect(await page.evaluate(()=>(window as unknown as TraceWindow).voices+(window as unknown as TraceWindow).sounds)).toBe(0);
    }
    await expect(page.locator('#reading-output')).toHaveValue(before);
    await expect(page.locator('.reading-position > span')).toHaveText(position);
    await page.clock.fastForward(30_000);
    await expect.poll(trace.captures).toBe(3);
    expect(trace.requests.length).toBe(1); // Identical visual observations are not announced twice.
    await page.getByRole('tab',{name:'Analyze',exact:true}).click();
    await page.getByRole('button',{name:'Stop automatic checks',exact:true}).click();
    await page.clock.fastForward(90_000);
    expect(trace.captures()).toBe(3);
  });
}

test('partial visual review retains text and makes no interruption decision', async ({page}) => {
  const trace = await setup(page,'INTERRUPT',true);
  const before = await page.locator('#reading-output').inputValue();
  await page.clock.fastForward(30_000);
  await expect(page.getByText('Check incomplete.',{exact:false})).toBeVisible();
  expect(trace.requests).toHaveLength(0);
  await expect(page.locator('#reading-output')).toHaveValue(before);
});
