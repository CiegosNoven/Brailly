import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fetchExpandedPage } from '../server/embedded-page.js';
import { parsePage } from '../server/page.js';

const page = (body: string) => `<!doctype html><html><head><title>Wait times</title></head><body><main>${body}</main></body></html>`;

test('imports only visible public frame text with nearby context, without nested frames or scripts', async () => {
  const requests: string[] = [];
  const result = await fetchExpandedPage('https://hospital.example/waits', async url => {
    requests.push(url);
    if (url === 'https://hospital.example/waits') return { url, html: page('<article><h2>South Campus</h2><iframe src="https://widget.example/wait"></iframe></article><div style="display:none"><iframe src="https://widget.example/hidden"></iframe></div>') };
    return { url, html: page('<ul><li>South Campus ED <span>10</span> min</li></ul><div class="hidden">Loading...</div><script>untrusted()</script><iframe src="https://widget.example/nested"></iframe><input value="private-value">') };
  });
  assert.deepEqual(requests, ['https://hospital.example/waits', 'https://widget.example/wait']);
  assert.equal(result.embeddedSources[0].context, 'South Campus');
  assert.equal(result.embeddedSources[0].status, 'included');
  assert.match(result.html, /South Campus ED 10 min/);
  assert.doesNotMatch(result.html, /untrusted|Loading\.\.\.|private-value|widget\.example\/nested/);
  const parsed = parsePage(result.html, result.url);
  assert.ok(parsed.blocks.some(block => block.text === 'South Campus ED 10 min'));
  assert.doesNotMatch(parsed.previewHtml!, /<iframe/);
});

test('fetch errors remain visible and do not replace source values with invented content', async () => {
  const result = await fetchExpandedPage('https://hospital.example/waits', async url => {
    if (url === 'https://hospital.example/waits') return { url, html: page('<h2>Emergency</h2><iframe src="http://127.0.0.1/private"></iframe>') };
    throw new Error('Only public websites can be imported.');
  });
  assert.equal(result.embeddedSources[0].status, 'unavailable');
  assert.match(result.embeddedSources[0].reason!, /public websites/);
  assert.match(result.html, /Embedded page unavailable/);
});

test('caps frame requests at four and reports omitted embeds', async () => {
  const requests: string[] = [];
  const result = await fetchExpandedPage('https://parent.example/', async url => {
    requests.push(url);
    return { url, html: url === 'https://parent.example/' ? page(Array.from({ length: 7 }, (_, i) => `<iframe src="https://widget.example/${i}"></iframe>`).join('')) : page('<p>Current public value</p>') };
  });
  assert.equal(requests.length, 5);
  assert.equal(result.embeddedSources.length, 4);
  assert.equal(result.embeddedOmitted, 3);
});

test('limits combined source bytes and stops requesting more frames', async () => {
  let calls = 0;
  const result = await fetchExpandedPage('https://parent.example/', async url => {
    calls++;
    return { url, html: url === 'https://parent.example/' ? page('<iframe src="https://widget.example/large"></iframe><iframe src="https://widget.example/next"></iframe>') + ' '.repeat(1_100_000) : page('<p>Must not import over-limit value</p>') + ' '.repeat(1_000_000) };
  });
  assert.equal(calls, 2);
  assert.equal(result.embeddedSources[0].status, 'unavailable');
  assert.doesNotMatch(result.html, /Must not import over-limit value/);
  assert.equal(result.embeddedOmitted, 1);
});
