import { test, expect, type Page, type Route } from '@playwright/test';

import type {PageSnapshot, ReadContext} from '../../shared/dom';
import {parsePage} from '../../server/page';
declare global { interface Window { __sourceSnapshot?:PageSnapshot; } }
type RankRequest = {page:PageSnapshot;task:string;context?:ReadContext};
function reply(route:Route, choice?:'DEFER'|'INTERRUPT') {
 const {page:snapshot,task,context}=route.request().postDataJSON() as RankRequest;
 const interrupt=choice==='INTERRUPT'||(!choice&&snapshot.blocks.some(b=>b.text.includes('Harbor Street entrance is now closed')));
 return route.fulfill({json:{snapshotId:snapshot.id,task,model:'TEST-ONLY-MOCK',latencyMs:12,results:snapshot.blocks.map(block=>{const relevant=block.text.includes('Open Tuesday');return{id:block.id,category:'CONTENT',score:relevant?3:1,confidence:.9,categoryConfidence:.9,priority:relevant?'NOW':'LATER',probabilities:{'0':0,'1':relevant?0:1,'2':0,'3':relevant?1:0}};}),usage:{input_tokens:120,output_tokens:40},transition:context?{choice:interrupt?'INTERRUPT':'DEFER',confidence:.95,probabilities:{DEFER:interrupt?.05:.95,INTERRUPT:interrupt?.95:.05}}:undefined,request:{testOnly:true},source:'Jev'}});
}
async function mockJev(page: Page, delay = 0, release?: Promise<void>) {
  await page.route('**/api/rank', async route => {
    if (release) await release;
    if (delay) await new Promise(resolve => setTimeout(resolve, delay));
    await reply(route);
  });
}

const output = (page: Page) => page.locator('#reading-output');
const tab = async (page: Page, name: 'Analyze' | 'Read') => page.getByRole('tab', { name, exact: true }).click();
const openJev = async (page: Page) => {
  await tab(page, 'Analyze');
  if (!await page.locator('.jev-details').evaluate(element => (element as HTMLDetailsElement).open)) {
    await page.locator('.jev-details > summary').click();
  }
};

const sourceSnapshot = (page:Page) => page.evaluate(()=>window.__sourceSnapshot!);

test.beforeEach(async ({ page }) => {
  await page.addInitScript(()=>window.addEventListener('message',event=>{if(event.data?.brailly&&event.data.type==='snapshot')window.__sourceSnapshot=event.data.page;}));
  await page.goto('/');
  await expect(page.locator('.live-status')).toContainText('rendered DOM blocks ready');
});

test('loads real DOM into the queue without fabricated Jev scores', async ({ page }) => {
  await expect(page.getByRole('tab', { name: 'Analyze', exact: true })).toHaveAttribute('aria-selected', 'true');
  await expect(page.frameLocator('iframe').getByText('Open Tuesday–Sunday, 10 am–6 pm. Closed Mondays.', { exact: true })).toBeVisible();
  const captured=await sourceSnapshot(page);
  expect(captured.blocks.length).toBeGreaterThan(0);
  await expect(page.locator('.queue-item')).toHaveCount(captured.blocks.length);
  expect(await page.locator('.queue-text').allTextContents()).toEqual(captured.blocks.map(block=>block.text));
  await expect(page.locator('.queue-score b')).toHaveCount(0);
  await expect(page.locator('.queue-status')).toContainText('awaiting Jev');
  await openJev(page);
  await expect(page.locator('.jev-metrics')).toContainText('N/A');
  await tab(page, 'Read');
  await expect(output(page)).toBeVisible();
  await expect(output(page)).toHaveValue('The Harbor Museum');
  await expect(page.locator('.queue-current')).toContainText('The Harbor Museum');
});

test('one batch scores the queue, then source and queue selection drive the display', async ({ page }) => {
  let finish!: () => void;
  const release = new Promise<void>(resolve => { finish = resolve; });
  const count=(await sourceSnapshot(page)).blocks.length;
  await mockJev(page, 0, release);
  await page.getByRole('button', { name: 'Analyze page', exact: true }).click();
  await expect(page.locator('.queue-status')).toContainText(`scoring all ${count} blocks`);
  await expect(page.locator('.queue-score').filter({ hasText: 'Pending' })).toHaveCount(count);
  await expect(page.locator('.queue-score b')).toHaveCount(0);
  finish();
  await expect(page.locator('.queue-status')).toContainText('Ready');
  await expect(page.locator('.queue-item').first()).toContainText('Open Tuesday');
  await expect(page.locator('.queue-score').first()).toContainText('3.0 / 3');
  await expect(page.locator('.queue-score b')).toHaveCount(count);
  await openJev(page);
  await expect(page.locator('.jev-details > summary')).toContainText('160 tokens');
  await tab(page, 'Read');
  await expect(output(page)).toHaveValue(/Open Tuesday/);
  await expect(page.locator('.physical-cell i.raised').first()).toBeVisible();
  await page.getByRole('button', { name: 'Next block', exact: true }).click();
  await expect(output(page)).not.toHaveValue(/Open Tuesday/);
  await tab(page, 'Analyze');
  await page.locator('.queue-item').first().click();
  await expect(page.getByRole('tab', { name: 'Read', exact: true })).toHaveAttribute('aria-selected', 'true');
  await expect(output(page)).toHaveValue(/Open Tuesday/);
  await expect(page.locator('.queue-item').first()).toHaveAttribute('aria-current', 'true');
  await tab(page, 'Analyze');
  await page.frameLocator('iframe').getByRole('heading', { name: 'Tickets', exact: true }).click();
  await tab(page, 'Read');
  await expect(output(page)).toHaveValue('Tickets');
  await expect(page.locator('.queue-current')).toContainText('Tickets');
  await page.getByRole('button', { name: 'Listen', exact: true }).click();
});

test('task change invalidates in-flight classification', async ({ page }) => {
  await mockJev(page, 1200);
  const request = page.waitForRequest('**/api/rank');
  await page.getByRole('button', { name: 'Analyze page', exact: true }).click();
  await request;
  await page.getByLabel('Find', { exact: true }).fill('Find membership information instead');
  await page.waitForTimeout(1500);
  await expect(page.locator('.queue-score b')).toHaveCount(0);
  await expect(page.locator('.queue-status')).toContainText('awaiting Jev');
  await expect(page.getByRole('button', { name: 'Analyze page', exact: true })).toBeEnabled();
  await tab(page, 'Read');
  await expect(output(page)).toHaveValue('The Harbor Museum');
});

test('API failure preserves exact reading and never fabricates fallback scores', async ({ page }) => {
  await page.route('**/api/rank', route => route.fulfill({ status: 503, json: { error: 'Live Jev needs an API key.' } }));
  const before = await output(page).inputValue();
  await page.getByRole('button', { name: 'Analyze page', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('API key');
  await expect(page.locator('.queue-score b')).toHaveCount(0);
  await tab(page, 'Read');
  await expect(output(page)).toHaveValue(before);
});

test('mobile tabs, hardware disclosure and downloadable extension', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await tab(page, 'Read');
  await page.getByRole('button', { name: 'Compatible devices' }).click();
  await expect(page.getByRole('dialog')).toContainText('No physical display');
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Get extension', exact: true }).click();
  await expect(page.getByRole('link', { name: 'Download the extension ZIP' })).toHaveAttribute('href', '/brailly-extension.zip');
  await page.keyboard.press('Escape');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await tab(page, 'Analyze');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('page changes and reading position survive tab switches, interruption and resume', async ({ page }) => {
  await mockJev(page);
  await page.getByRole('button', { name: 'Analyze page', exact: true }).click();
  await expect(page.locator('.queue-status')).toContainText('Ready');
  await tab(page, 'Read');
  await expect(output(page)).toHaveValue(/Open Tuesday/);
  await page.getByRole('button', { name: 'Next line', exact: true }).click();
  const retained = await output(page).inputValue();
  const frameToken = await page.locator('iframe').getAttribute('data-token');
  await openJev(page);
  await page.locator('.demo-controls > summary').click();
  await page.getByRole('button', { name: 'Change offer', exact: true }).click();
  await expect(page.locator('.transition').first()).toHaveText('DEFER');
  await expect(page.frameLocator('iframe').locator('[data-demo="noise"]')).toContainText('Member shop offer refreshed');
  await tab(page, 'Read');
  await expect(output(page)).toHaveValue(retained);
  await tab(page, 'Analyze');
  await expect(page.locator('iframe')).toHaveAttribute('data-token', frameToken!);
  await expect(page.frameLocator('iframe').locator('[data-demo="noise"]')).toContainText('Member shop offer refreshed');
  await page.getByRole('button', { name: 'Close entrance', exact: true }).click();
  await expect(page.locator('.transition').first()).toHaveText('INTERRUPT');
  await expect(page.locator('.jev-metrics')).toContainText('120');
  await tab(page, 'Read');
  await expect(output(page)).toHaveValue(/Harbor Street entrance is now closed/);
  await page.getByRole('button', { name: 'Resume reading', exact: true }).click();
  await expect(output(page)).toHaveValue(retained);
  await page.getByLabel('Display cells').selectOption('20');
  await expect(page.locator('.physical-cell')).toHaveCount(20);
  await page.getByLabel('Display cells').selectOption('80');
  await expect(page.locator('.physical-cell')).toHaveCount(80);
});

test('links navigate within the preview and trigger a new classification', async ({ page }) => {
  await mockJev(page);
  await page.frameLocator('iframe').getByText('Book your tickets', { exact: true }).click();
  await expect(page.getByLabel('Website', { exact: true })).toHaveValue(/museum-tickets.html/);
  await expect(page.frameLocator('iframe').getByRole('heading', { name: 'Your next visit.' })).toBeVisible();
  await openJev(page);
  await expect(page.locator('.call-destination')).toContainText('TEST-ONLY-MOCK');
  await expect(page.locator('.queue-status')).toContainText('Ready');
  await page.frameLocator('iframe').getByText('Return to museum', { exact: true }).click();
  await expect(page.getByLabel('Website', { exact: true })).toHaveValue(/example.html/);
});

test('coalesces updates and drops an obsolete interruption without losing the accepted baseline or reading offset', async ({page})=>{
  test.setTimeout(40000);
  const requests:RankRequest[]=[];
  let releaseOld!:()=>void;
  const oldResponse=new Promise<void>(resolve=>{releaseOld=resolve;});
  await page.route('**/api/rank',async route=>{
    requests.push(route.request().postDataJSON() as RankRequest);
    if(requests.length===2){await oldResponse;await reply(route,'INTERRUPT');}
    else await reply(route,'DEFER');
  });
  await page.getByRole('button',{name:'Analyze page',exact:true}).click();
  await expect(page.locator('.queue-status')).toContainText('Ready');
  await tab(page,'Read');
  await page.getByRole('button',{name:'Next line',exact:true}).click();
  const retained=await output(page).inputValue();
  const offsetLabel=await page.locator('.reading-position > span').innerText();
  const original=requests[0].page;
  const frame=page.frameLocator('iframe');
  await frame.locator('[data-demo="entrance"]').evaluate(node=>{node.textContent='Harbor Street entrance is now closed. Step-free access is temporarily through the East Lane entrance.';});
  await expect.poll(()=>requests.length,{timeout:12000}).toBe(2);
  await frame.locator('[data-demo="hours"]').evaluate(node=>{node.textContent='The museum now closes at 3 pm today. Last entry is at 2 pm.';});
  await expect.poll(async()=>JSON.stringify((await sourceSnapshot(page)).blocks)).toContain('closes at 3 pm');
  releaseOld();
  await expect.poll(()=>requests.length,{timeout:12000}).toBe(3);
  await expect(page.locator('.queue-status')).toContainText('Ready');
  const latest=requests[2];
  expect(latest.context?.offset).toBeGreaterThan(0);
  expect(latest.context?.previousBlocks).toEqual(original.blocks);
  const previous=new Map(latest.context!.previousBlocks.map(block=>[block.id,block.text]));
  const changed=latest.page.blocks.filter(block=>previous.get(block.id)!==block.text);
  expect(changed.some(block=>block.text.includes('Harbor Street entrance is now closed'))).toBe(true);
  expect(changed.some(block=>block.text.includes('closes at 3 pm'))).toBe(true);
  await expect(output(page)).toHaveValue(retained);
  await expect(page.locator('.reading-position > span')).toHaveText(offsetLabel);
  await expect(page.getByRole('button',{name:'Resume reading',exact:true})).toHaveCount(0);
  await openJev(page);
  await expect(page.locator('.transition')).toHaveCount(1);
  await expect(page.locator('.transition')).toHaveText('DEFER');
});

test('captures status attributes, hidden blocks and an empty page while retaining the reading line',async({page})=>{
  await mockJev(page);
  const retained=await output(page).inputValue();
  const initial=await sourceSnapshot(page);
  const frame=page.frameLocator('iframe');
  const notice=frame.locator('[data-demo="entrance"]');
  const id=await notice.getAttribute('data-brailly-id');
  await notice.evaluate(node=>node.setAttribute('aria-label','Entrance status: use the East Lane entrance.'));
  await expect.poll(async()=>(await sourceSnapshot(page)).blocks.find(block=>block.id===id)?.text).toBe('Entrance status: use the East Lane entrance.');
  await notice.evaluate(node=>node.setAttribute('hidden',''));
  await expect.poll(async()=>(await sourceSnapshot(page)).blocks.some(block=>block.id===id)).toBe(false);
  await expect(page.locator('.queue-item')).toHaveCount(initial.blocks.length-1);
  await frame.locator('body').evaluate(body=>body.replaceChildren());
  await expect.poll(async()=>(await sourceSnapshot(page)).blocks.length).toBe(0);
  await expect(page.locator('.queue-item')).toHaveCount(0);
  await tab(page,'Read');
  await expect(output(page)).toHaveValue(retained);
  await expect(page.locator('.queue-score b')).toHaveCount(0);
});

test('refreshes a fresh imported document without resetting the reading position or stable change IDs',async({page})=>{
  test.setTimeout(30000);
  const sourceUrl='https://example.org/brailly-test-page';
  let fetches=0;
  const requests:RankRequest[]=[];
  await page.route('**/api/page',route=>{
    const price=++fetches===1?'18':'22';
    const html=`<!doctype html><html><head><title>Browser test fixture</title></head><body><main id="content"><h1>Test visiting information</h1><p id="hours">Open Tuesday through Sunday from ten in the morning until six in the evening. Closed Mondays.</p><p id="price">Admission costs $${price}.</p></main></body></html>`;
    return route.fulfill({json:parsePage(html,sourceUrl)});
  });
  await page.route('**/api/rank',async route=>{requests.push(route.request().postDataJSON() as RankRequest);await reply(route,'DEFER');});
  await page.getByLabel('Website',{exact:true}).fill(sourceUrl);
  await page.getByRole('button',{name:'Analyze page',exact:true}).click();
  await expect(page.locator('.queue-status')).toContainText('Ready');
  await expect(page.frameLocator('iframe').locator('#price')).toHaveText('Admission costs $18.');
  await tab(page,'Read');
  await page.getByRole('button',{name:'Next line',exact:true}).click();
  const retained=await output(page).inputValue();
  const offsetLabel=await page.locator('.reading-position > span').innerText();
  const previousPrice=requests[0].page.blocks.find(block=>block.text==='Admission costs $18.')!;
  const oldToken=await page.locator('iframe').getAttribute('data-token');
  await tab(page,'Analyze');
  await page.getByRole('button',{name:'Refresh source page',exact:true}).click();
  await expect(page.frameLocator('iframe').locator('#price')).toHaveText('Admission costs $22.');
  await expect(page.locator('iframe')).not.toHaveAttribute('data-token',oldToken!);
  await expect.poll(()=>requests.length,{timeout:12000}).toBe(2);
  await expect(page.locator('.queue-status')).toContainText('Ready');
  const latest=requests[1];
  expect(latest.context?.previousBlocks.find(block=>block.id===previousPrice.id)?.text).toBe('Admission costs $18.');
  expect(latest.page.blocks.find(block=>block.id===previousPrice.id)?.text).toBe('Admission costs $22.');
  expect(latest.context?.offset).toBeGreaterThan(0);
  await tab(page,'Read');
  await expect(output(page)).toHaveValue(retained);
  await expect(page.locator('.reading-position > span')).toHaveText(offsetLabel);
});
