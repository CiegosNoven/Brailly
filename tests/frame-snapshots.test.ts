import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mergeFrameSnapshots, mergeFrameSnapshotsWithSources, type FrameSnapshot} from '../shared/frame-snapshots';
import type {DomBlock, PageSnapshot} from '../shared/dom';

const block = (id:string, text:string, extra:Partial<DomBlock> = {}):DomBlock =>
  ({id, text, tag:'p', role:'text', region:'main', order:Number(id.slice(1)), ...extra});
const page = (blocks:DomBlock[], url = 'https://hospital.example/waits'):PageSnapshot => ({
  id:'original-snapshot', url, title:'Published wait times', blocks, capturedAt:'2026-09-26T20:00:00Z',
  source:'extension', totalCandidates:blocks.length, truncated:false,
});
const frame = (url:string, context:string, blocks:DomBlock[], frameId?:number):FrameSnapshot =>
  ({url, context, snapshot:page(blocks, url), ...(frameId === undefined ? {} : {frameId})});

test('merges literal child values and supplied context, preserves main IDs and locate provenance', () => {
  const main = page([block('b1', 'Emergency departments')]);
  const child = frame('https://widget.example/south', 'South campus', [block('b1', '10 min', {context:'Emergency department'})], 7);
  const result = mergeFrameSnapshotsWithSources(main, [child]);
  assert.equal(result.snapshot.blocks[0].id, 'b1');
  assert.equal(result.snapshot.blocks[1].text, '10 min');
  assert.equal(result.snapshot.blocks[1].context, 'South campus / Emergency department');
  assert.match(result.snapshot.blocks[1].id, /^b\d+$/);
  assert.notEqual(result.snapshot.blocks[1].id, 'b1');
  assert.deepEqual(result.sources[result.snapshot.blocks[1].id], {url:child.url, originalId:'b1', frameId:7});
  assert.deepEqual(result.sources.b1, {url:main.url, originalId:'b1', frameId:0});
  assert.equal(result.snapshot.totalCandidates, 2);
  assert.equal(result.snapshot.truncated, false);
  assert.notEqual(result.snapshot.id, main.id);
  assert.equal(main.blocks[0].order, 1);
  assert.equal(child.snapshot.blocks[0].id, 'b1');
});

test('child IDs survive value, context and order changes and stay distinct across equal-URL frames', () => {
  const main = page([block('b1', 'Main page')]);
  const a = frame('https://widget.example/wait', 'South', [block('b1', '10 min'), block('b2', 'Open')], 8);
  const b = frame(a.url, 'Main', [block('b1', '3 min')], 9);
  const first = mergeFrameSnapshotsWithSources(main, [a, b]);
  const changed = {...a, context:'South campus', snapshot:page([{...a.snapshot.blocks[1], order:0}, {...a.snapshot.blocks[0], text:'20 min', order:1}], a.url)};
  const second = mergeFrameSnapshotsWithSources(main, [b, changed]);
  const identify = (value:typeof first, frameId:number, originalId:string) => Object.entries(value.sources)
    .find(([, source]) => source.frameId === frameId && source.originalId === originalId)?.[0];
  assert.equal(identify(first, 8, 'b1'), identify(second, 8, 'b1'));
  assert.equal(identify(first, 9, 'b1'), identify(second, 9, 'b1'));
  assert.notEqual(identify(first, 8, 'b1'), identify(first, 9, 'b1'));
  assert.equal(new Set(second.snapshot.blocks.map(block => block.id)).size, second.snapshot.blocks.length);
});

test('resolves a deliberate collision with a main ID without changing main identifiers', () => {
  const child = frame('https://widget.example/wait', 'Main campus', [block('b1', '3 min')], 4);
  const initially = mergeFrameSnapshots(page([]), [child]);
  const collidingId = initially.blocks[0].id;
  const main = page([block(collidingId, 'Keep this main block', {order:0})]);
  const first = mergeFrameSnapshots(main, [child]);
  const second = mergeFrameSnapshots(main, [child]);
  assert.equal(first.blocks[0].id, collidingId);
  assert.notEqual(first.blocks[1].id, collidingId);
  assert.equal(first.blocks[1].id, second.blocks[1].id);
});

test('reserves a fair child share under a 60-block cap and prioritizes facts over timers and menus', () => {
  const main = page(Array.from({length:60}, (_, index) => block(`b${index}`, `Main content ${index}`, {order:index})));
  const children = Array.from({length:4}, (_, index) => frame(`https://widget.example/${index}`, `Campus ${index}`, [
    ...Array.from({length:10}, (_, n) => block(`b${n}`, `Menu ${n}`, {region:'nav', order:n})),
    block('b11', 'Countdown 00:05:00', {live:'timer', order:11}),
    block('b12', `${index + 1} min`, {order:12}),
    block('b13', 'Closed for maintenance', {role:'status', order:13}),
  ], index + 1));
  const result = mergeFrameSnapshotsWithSources(main, children);
  assert.equal(result.snapshot.blocks.length, 60);
  assert.equal(Object.values(result.sources).filter(source => source.frameId === 0).length, 44);
  for (let frameId = 1; frameId <= 4; frameId++) {
    const ids = Object.entries(result.sources).filter(([, source]) => source.frameId === frameId).map(([id]) => id);
    assert.equal(ids.length, 4);
    assert.ok(result.snapshot.blocks.some(block => ids.includes(block.id) && block.text === `${frameId} min`));
    assert.ok(result.snapshot.blocks.some(block => ids.includes(block.id) && block.role === 'status'));
    assert.ok(!result.snapshot.blocks.some(block => ids.includes(block.id) && block.live === 'timer'));
  }
  assert.equal(result.snapshot.truncated, true);
  assert.equal(result.snapshot.totalCandidates, 112);
});

test('unused child slots return to the top page and more than four frames are reported as truncated', () => {
  const main = page(Array.from({length:60}, (_, index) => block(`b${index}`, `Main ${index}`, {order:index})));
  const children = Array.from({length:5}, (_, index) => frame(`https://widget.example/${index}`, '', [block('b1', `${index} min`)], index + 1));
  const result = mergeFrameSnapshotsWithSources(main, children);
  assert.equal(result.snapshot.blocks.length, 60);
  assert.equal(Object.values(result.sources).filter(source => source.frameId === 0).length, 56);
  assert.ok(!Object.values(result.sources).some(source => source.frameId === 5));
  assert.equal(result.snapshot.totalCandidates, 65);
  assert.equal(result.snapshot.truncated, true);
});

test('keeps empty input and existing truncation honest, without inventing child text', () => {
  const result = mergeFrameSnapshots({...page([]), truncated:true, totalCandidates:3}, [frame('https://widget.example/', '', [])]);
  assert.deepEqual(result.blocks, []);
  assert.equal(result.truncated, true);
  assert.equal(result.totalCandidates, 3);
});

test('rejects invalid or duplicate source IDs and repeated identified frames', () => {
  assert.throws(() => mergeFrameSnapshots(page([block('b1', 'One'), block('b1', 'Two')]), []));
  assert.throws(() => mergeFrameSnapshots(page([]), [frame('https://widget.example/', '', [block('unsafe"', 'Value')])]));
  const child = frame('https://widget.example/', '', [block('b1', 'Value')], 2);
  assert.throws(() => mergeFrameSnapshots(page([]), [child, child]));
});
