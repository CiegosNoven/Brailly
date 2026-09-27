import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { runInNewContext } from 'node:vm';
import { randomUUID } from 'node:crypto';

test('an inaccessible embedded frame cannot block the readable main page', async () => {
  const bundle = await build({ entryPoints: ['extension/background.ts'], bundle: true, format: 'iife', write: false });
  const listeners: Record<string, (...args: any[]) => unknown> = {};
  const event = (name: string) => ({ addListener: (fn: (...args: any[]) => unknown) => { listeners[name] = fn; } });
  const stored: Record<string, any> = {};
  let capture: { token: string } | undefined;
  const actions: any[] = [];
  let finishAction: (() => void) | undefined;
  const active = { id: 3, windowId: 1, url: 'https://source.example/', status: 'complete' };
  const chrome = {
    runtime: { id: 'reader', getURL: (path: string) => `chrome-extension://reader/${path}`, onConnect: event('connect'), onMessage: event('message') },
    storage: { session: { get: async () => stored, set: async (value: object) => Object.assign(stored, value) } },
    windows: { getLastFocused: async () => ({ id: 1 }), onFocusChanged: event('focus'), WINDOW_ID_NONE: -1 },
    tabs: { sendMessage: async (tab: number, message: any, options: any) => { actions.push({tab,message,options}); await new Promise<void>(resolve => { finishAction = resolve; }); return {ok:true}; }, query: async () => [active], onActivated: event('activated'), onUpdated: event('updated'), onRemoved: event('removed') },
    action: { onClicked: event('clicked') },
    scripting: { executeScript: async (request: any) => {
      if (request.target.allFrames) throw new Error('Cannot access embedded document');
      if (request.args) capture = request.args[0];
      return [];
    } },
  };
  runInNewContext(bundle.outputFiles[0].text, { chrome, crypto: { randomUUID }, setTimeout, clearTimeout, URL, Date });
  listeners.connect({ name: 'brailly-reader', sender: { id: 'reader' }, onMessage: event('portMessage'), onDisconnect: event('disconnect') });
  const until = async (condition: () => boolean) => {
    for (let i = 0; i < 100 && !condition(); i++) await new Promise(resolve => setTimeout(resolve, 10));
    assert.equal(condition(), true);
  };
  await until(() => !!capture);
  const snapshot = { id: 'main', url: active.url, title: 'Main page', capturedAt: new Date().toISOString(), source: 'extension', totalCandidates: 1, truncated: false,
    blocks: [{ id: 'b1', text: 'Readable main content', tag: 'p', role: 'text', region: 'main', order: 0 }] };
  listeners.message({ type: 'snapshot', captureToken: capture!.token, snapshot, visibleFrames: [{ url: 'https://widget.example/', context: 'Wait times' }] }, { tab: active, frameId: 0 }, () => {});
  await until(() => stored.captureStatus === 'ready');
  assert.equal(stored.snapshot.blocks.length, 1);
  assert.equal(stored.snapshot.blocks[0].text, 'Readable main content');
  assert.equal(stored.captureError, 'Some embedded content could not be read.');
  const sender = {id:'reader',url:'chrome-extension://reader/index.html'};
  const activate = (snapshotId: string) => new Promise<any>(resolve => listeners.message({type:'activate-control',snapshotId,id:'b1'},sender,resolve));
  assert.equal((await activate('outdated')).ok,false);
  assert.equal(actions.length,0);
  const first = activate(stored.snapshot.id);
  const duplicate = activate(stored.snapshot.id);
  await until(() => actions.length === 1);
  assert.equal((await duplicate).ok,false);
  assert.equal(actions[0].tab,active.id);
  assert.equal(actions[0].message.token,capture!.token);
  assert.equal(actions[0].message.block.id,'b1');
  assert.equal(actions[0].options.frameId,0);
  finishAction!();
  assert.equal((await first).ok,true);
  listeners.message({type:'activate-control',snapshotId:stored.snapshot.id,id:'b1'},{id:'reader',url:active.url},()=>assert.fail('Website cannot operate reader controls'));
  assert.equal(actions.length,1);
  listeners.disconnect();
  await until(() => stored.captureStatus === 'idle');
  assert.equal(stored.snapshot, null);
});
