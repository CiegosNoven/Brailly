import 'dotenv/config';
import {readFile, stat, mkdir, writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import assert from 'node:assert/strict';
import {parseHTML} from 'linkedom';
import {extractDocument, type DomBlock, type PageSnapshot} from '../shared/dom.js';
import {classifyDom, describeChanges} from '../server/dom-jev.js';
import {fetchExpandedPage} from '../server/embedded-page.js';

// Usage: npx tsx scripts/check-real-sites.ts --achla-html /path/to/rendered-achla.html
// The supplied HTML must come from a real rendered browser capture, not generated sample data.
const inputIndex = process.argv.indexOf('--achla-html');
const htmlPath = inputIndex >= 0 ? process.argv[inputIndex + 1] : process.env.ACHLA_RENDERED_HTML;
if (!htmlPath) throw new Error('Supply --achla-html with a saved rendered capture of https://achladeal.com/en.');
const key = process.env.TYPESAFE_API_KEY;
if (!key) throw new Error('TYPESAFE_API_KEY must be set on the server.');
const model = process.env.TYPESAFE_MODEL || 'jev-1.13.0';
const capturedAt = new Date().toISOString();
const achlaHtml = await readFile(resolve(htmlPath), 'utf8');
const achlaFileDate = (await stat(resolve(htmlPath))).mtime.toISOString();
const hospital = await fetchExpandedPage('https://childrensdayton.org/wait-times/#emergency');
assert.ok(hospital.embeddedSources.some(source => source.status === 'included'), 'No public hospital widget was captured.');

function sourceDocument(html:string, url:string) {
  const {document} = parseHTML(html);
  document.querySelectorAll('[data-brailly-id]').forEach(node => node.removeAttribute('data-brailly-id'));
  const snapshot = extractDocument(document as unknown as Document, url);
  return {document, snapshot};
}
const achla = sourceDocument(achlaHtml, 'https://achladeal.com/en');
const dayton = sourceDocument(hospital.html, hospital.url);
const price = achla.snapshot.blocks.find(block => block.context && /\d[\d,.]*\s*[₪$€£]|[₪$€£]\s*\d/.test(block.text));
assert.ok(price, 'Rendered Achla capture has no contextual price block.');
const timerNode = achla.document.querySelector('.cd [aria-label], [role="timer"], [data-countdown]')?.closest('[data-brailly-id]');
assert.ok(timerNode, 'Rendered Achla capture has no countdown node.');
const timerId = timerNode.getAttribute('data-brailly-id');
assert.ok(timerId, 'Countdown node was not recognized by the extractor.');
const timerSnapshot = extractDocument(achla.document as unknown as Document, achla.snapshot.url, false, timerId);
const timer = timerSnapshot.blocks.find(block => block.id === timerId);
assert.ok(timer?.live === 'timer', 'Countdown is not identified as a timer.');
const wait = dayton.snapshot.blocks.find(block => block.context && /\d+\s*min(?:ute)?s?\b/i.test(block.text));
assert.ok(wait, 'Expanded hospital capture has no contextual wait estimate.');

function cloned(source:typeof achla) {
  return parseHTML('<!doctype html>' + source.document.documentElement.outerHTML).document;
}
function replace(document:ReturnType<typeof cloned>, id:string, value:string) {
  const node = document.querySelector(`[data-brailly-id="${id}"]`);
  assert.ok(node, `Source node ${id} is unavailable.`);
  node.textContent = value;
  if (node.hasAttribute('aria-label')) node.setAttribute('aria-label', value);
}
function bounded(snapshot:PageSnapshot, focus:DomBlock[], current:DomBlock) {
  const wanted = new Set([current.id, ...focus.map(block => block.id)]);
  const contexts = new Set(focus.map(block => block.context).filter(Boolean));
  const chosen = snapshot.blocks.filter(block => wanted.has(block.id));
  for (const block of snapshot.blocks) {
    if (chosen.length >= 8) break;
    if (!chosen.some(item => item.id === block.id) && block.context && contexts.has(block.context)) chosen.push(block);
  }
  return {...snapshot, blocks:chosen.sort((a, b) => a.order - b.order), truncated:snapshot.truncated || chosen.length < snapshot.blocks.length};
}
const records:unknown[] = [];
async function runReplay(options:{
  name:string; source:typeof achla; focus:DomBlock; current:DomBlock; task:string;
  mutate:(document:ReturnType<typeof cloned>)=>void; expected:string[];
  baseline?:(document:ReturnType<typeof cloned>)=>void; note:string;
}) {
  const beforeDocument = cloned(options.source);
  options.baseline?.(beforeDocument);
  const beforeFull = extractDocument(beforeDocument as unknown as Document, options.source.snapshot.url, false, options.focus.id);
  const current = beforeFull.blocks.find(block => block.id === options.current.id) || options.current;
  const before = bounded(beforeFull, [options.focus], current);
  const afterDocument = parseHTML('<!doctype html>' + beforeDocument.documentElement.outerHTML).document;
  options.mutate(afterDocument);
  const afterFull = extractDocument(afterDocument as unknown as Document, options.source.snapshot.url, false, options.focus.id);
  // Keep the same bounded selection between captures so unrelated budget changes do not become fake removals.
  const ids = new Set(before.blocks.map(block => block.id));
  const after = {...afterFull, blocks:afterFull.blocks.filter(block => ids.has(block.id)), truncated:before.truncated};
  const context = {current, offset:Math.min(4, current.text.length), previousBlocks:before.blocks};
  const changes = describeChanges(after, context);
  assert.ok(changes.page_changes.length, 'Replay did not change captured content.');
  const result = await classifyDom(after, options.task, key!, model, context);
  const passed = !!result.transition && options.expected.includes(result.transition.choice);
  const record = {
    name:options.name, evidence:'controlled DOM replay on a captured real website; not an observed upstream event',
    sourceUrl:options.source.snapshot.url, note:options.note, observedSourceValue:options.focus,
    task:options.task, retained:context.current, offset:context.offset, changes:changes.page_changes,
    expectedTransitions:options.expected, passed,
    actual:{transition:result.transition, model:result.model, latencyMs:result.latencyMs, usage:result.usage, results:result.results},
  };
  records.push(record);
  console.log(JSON.stringify({case:options.name, passed, transition:result.transition?.choice, latencyMs:result.latencyMs, usage:result.usage}));
}

const countdown = timer!.text.replace(/(\d{1,2}):(\d{2}):(\d{2})/, (_all, h, m, s) => {
  const seconds = Math.max(0, Number(h) * 3600 + Number(m) * 60 + Number(s) - 1);
  return [Math.floor(seconds / 3600), Math.floor(seconds / 60) % 60, seconds % 60].map(value => String(value).padStart(2, '0')).join(':');
});
assert.notEqual(countdown, timer!.text, 'Countdown is not in an editable HH:MM:SS format.');
await runReplay({name:'travel-countdown', source:achla, focus:timer!, current:price!, task:`Compare the published fare for ${price!.context}.`,
  mutate:document => replace(document, timer!.id, countdown), expected:['DEFER'], note:'One-second tick on the observed countdown; no reservation is active.'});
const promotion = achla.snapshot.blocks.find(block => /newsletter|subscribe|discount|offer|deal/i.test(block.text) && block.id !== price!.id && !block.context?.includes(price!.context || '\0'));
assert.ok(promotion, 'No unrelated source promotion available for replay.');
await runReplay({name:'travel-unrelated-promotion', source:achla, focus:promotion!, current:price!, task:`Read the published fare for ${price!.context}.`,
  mutate:document => replace(document, promotion!.id, 'Newsletter promotion updated. Subscribe to receive more travel offers.'), expected:['DEFER'], note:'An unrelated existing promotional node is replaced with explicitly controlled replay text.'});
const newPrice = price!.text.replace(/\d[\d,]*(?:\.\d+)?/, value => String(Number(value.replace(/,/g, '')) + 25));
await runReplay({name:'travel-current-price', source:achla, focus:price!, current:price!, task:`Compare the published fare for ${price!.context}; no booking or checkout is in progress.`,
  mutate:document => replace(document, price!.id, newPrice), expected:['QUEUE_HIGH'], note:'The observed price is increased by 25 in a local DOM copy; this is not a live fare claim.'});
await runReplay({name:'travel-missing-price', source:achla, focus:price!, current:price!, task:`Read the published fare for ${price!.context}.`,
  mutate:document => document.querySelector(`[data-brailly-id="${price!.id}"]`)!.remove(), expected:['NONE', 'QUEUE_HIGH'], note:'Price node removed only in the replay. Absence from a bounded capture does not establish cancellation.'});
const wait35 = wait!.text.replace(/\d+(?=\s*min(?:ute)?s?\b)/i, '35');
const wait55 = wait!.text.replace(/\d+(?=\s*min(?:ute)?s?\b)/i, '55');
const hospitalReading = dayton.snapshot.blocks.find(block => block.id !== wait!.id && /hour|address|location/i.test(block.text)) || dayton.snapshot.blocks[0];
await runReplay({name:'hospital-wait-replay-35-to-55', source:dayton, focus:wait!, current:hospitalReading, task:`Read the published wait estimate for ${wait!.context}.`,
  baseline:document => replace(document, wait!.id, wait35), mutate:document => replace(document, wait!.id, wait55), expected:['QUEUE_HIGH'],
  note:'Both 35 and 55 minutes are controlled replay values. observedSourceValue preserves the actual fetched estimate. No medical recommendation is generated.'});
const unrelated = dayton.snapshot.blocks.find(block => block.id !== wait!.id && block.id !== hospitalReading.id && /news|donat|career|connect|sign|search/i.test(block.text));
assert.ok(unrelated, 'No unrelated hospital source node available.');
await runReplay({name:'hospital-unrelated-update', source:dayton, focus:unrelated!, current:wait!, task:`Read the published wait estimate for ${wait!.context}.`,
  mutate:document => replace(document, unrelated!.id, 'Hospital newsletter subscription information has changed.'), expected:['DEFER'], note:'Only an unrelated existing site node is changed in the local replay.'});

const output = {capturedAt, limitations:[
  'Achla uses supplied rendered HTML; this script extracts with linkedom and cannot evaluate computed CSS visibility.',
  'Dayton widgets are independently fetched public HTML. There is no authenticated or private patient data.',
  'All mutations are controlled replay fixtures. Results do not prove the source websites changed naturally.',
  'Jev inputs are capped at eight source blocks per replay; full-site ranking is checked separately.',
], sources:{achla:{url:achla.snapshot.url, inputFile:resolve(htmlPath), fileModifiedAt:achlaFileDate, blocks:achla.snapshot.blocks.length, candidates:achla.snapshot.totalCandidates}, dayton:{url:dayton.snapshot.url, blocks:dayton.snapshot.blocks.length, embeddedSources:hospital.embeddedSources, embeddedOmitted:hospital.embeddedOmitted}}, records};
await mkdir('artifacts', {recursive:true});
await writeFile('artifacts/real-sites-jev-replays.json', JSON.stringify(output, null, 2) + '\n');
assert.ok(records.every(record => (record as {passed:boolean}).passed), 'A real Jev replay differed from the acceptance expectation; inspect artifacts/real-sites-jev-replays.json.');
