import type {DomBlock, PageSnapshot} from './dom.js';

export type FrameSnapshot = {
  url:string;
  context:string;
  snapshot:PageSnapshot;
  frameId?:number;
};
export type FrameBlockSource = {url:string; originalId:string; frameId?:number};
export type MergedFrameSnapshots = {snapshot:PageSnapshot; sources:Record<string, FrameBlockSource>};

const MAX_BLOCKS = 60;
const MAX_FRAMES = 4;
const CHILD_BUDGET = 16;
const chromeRegions = new Set(['nav', 'navigation', 'header', 'banner', 'footer', 'contentinfo', 'aside', 'complementary']);

function blockRank(block:DomBlock, parentContext = '') {
  if (chromeRegions.has(block.region)) return 3;
  if (block.live === 'timer') return 4;
  if ((block.context || parentContext) && (['alert', 'status'].includes(block.role)
    || (block.role === 'text' && /\d|\b(?:closed|unavailable|wait|open)\b/i.test(block.text)))) return 0;
  return block.role === 'heading' ? 1 : 2;
}

function hashId(value:string) {
  let hash = 14695981039346656037n;
  for (let index = 0; index < value.length; index++) {
    hash = BigInt.asUintN(64, (hash ^ BigInt(value.charCodeAt(index))) * 1099511628211n);
  }
  return `b${hash}`;
}

function assertUnique(blocks:DomBlock[]) {
  const ids = new Set<string>();
  for (const block of blocks) {
    if (!/^b\d+$/.test(block.id) || ids.has(block.id)) throw new Error('Frame snapshot contains invalid or duplicate DOM block identifiers.');
    ids.add(block.id);
  }
}

/** Callers must authorize and filter visible frames before merging; this helper does not fetch or inspect frames. */
export function mergeFrameSnapshotsWithSources(main:PageSnapshot, frames:FrameSnapshot[]):MergedFrameSnapshots {
  assertUnique(main.blocks);
  const seenUrls = new Map<string, number>();
  const included = frames.slice(0, MAX_FRAMES).map(frame => {
    assertUnique(frame.snapshot.blocks);
    const occurrence = seenUrls.get(frame.url) || 0;
    seenUrls.set(frame.url, occurrence + 1);
    const instance = frame.frameId === undefined ? `occurrence:${occurrence}` : `frame:${frame.frameId}`;
    const scope = `${frame.url}\u0000${instance}`;
    const candidates = [...frame.snapshot.blocks].sort((a, b) =>
      blockRank(a, frame.context) - blockRank(b, frame.context) || a.order - b.order);
    return {frame, scope, candidates, selected:[] as DomBlock[]};
  });

  // Reserve a bounded, fair share for child facts so top-page navigation cannot bury embedded wait times.
  let childCount = 0;
  while (childCount < CHILD_BUDGET) {
    let progressed = false;
    for (const item of included) {
      if (childCount >= CHILD_BUDGET) break;
      const block = item.candidates[item.selected.length];
      if (!block) continue;
      item.selected.push(block);
      childCount++;
      progressed = true;
    }
    if (!progressed) break;
  }
  const topSelection = [...main.blocks].sort((a, b) => blockRank(a) - blockRank(b) || a.order - b.order)
    .slice(0, MAX_BLOCKS - childCount).sort((a, b) => a.order - b.order);
  const sources:Record<string, FrameBlockSource> = {};
  const blocks = topSelection.map(block => {
    sources[block.id] = {url:main.url, originalId:block.id, frameId:0};
    return {...block};
  });

  // Reserve every main ID, including omitted blocks, so selection changes cannot create a collision later.
  const usedIds = new Set(main.blocks.map(block => block.id));
  const scopedBlocks = included.flatMap(item => item.frame.snapshot.blocks.map(block => ({scope:item.scope, block})))
    .sort((a, b) => `${a.scope}\u0000${a.block.id}`.localeCompare(`${b.scope}\u0000${b.block.id}`));
  const mappedIds = new Map<string, string>();
  for (const {scope, block} of scopedBlocks) {
    const key = `${scope}\u0000${block.id}`;
    if (mappedIds.has(key)) throw new Error('The same frame was supplied more than once.');
    let attempt = 0;
    let id = hashId(key);
    while (usedIds.has(id)) id = hashId(`${key}\u0000collision:${++attempt}`);
    usedIds.add(id);
    mappedIds.set(key, id);
  }
  for (const item of included) {
    for (const block of item.selected.sort((a, b) => a.order - b.order)) {
      const id = mappedIds.get(`${item.scope}\u0000${block.id}`)!;
      const labels = [item.frame.context.trim(), block.context?.trim()].filter((value):value is string => !!value);
      const context = [...new Set(labels)].join(' / ').slice(0, 240);
      blocks.push({...block, id, ...(context ? {context} : {})});
      sources[id] = {url:item.frame.url, originalId:block.id, ...(item.frame.frameId === undefined ? {} : {frameId:item.frame.frameId})};
    }
  }
  return {
    snapshot:{
      ...main,
      id:crypto.randomUUID(),
      capturedAt:new Date().toISOString(),
      blocks:blocks.map((block, order) => ({...block, order})),
      totalCandidates:main.totalCandidates + frames.reduce((sum, frame) => sum + frame.snapshot.totalCandidates, 0),
      truncated:main.truncated || frames.length > MAX_FRAMES || frames.some(frame => frame.snapshot.truncated)
        || blocks.length < main.blocks.length + frames.reduce((sum, frame) => sum + frame.snapshot.blocks.length, 0),
    },
    sources,
  };
}

export function mergeFrameSnapshots(main:PageSnapshot, frames:FrameSnapshot[]):PageSnapshot {
  return mergeFrameSnapshotsWithSources(main, frames).snapshot;
}
