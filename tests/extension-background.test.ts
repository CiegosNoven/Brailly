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
  const active = { id: 3, windowId: 1, url: 'https://source.example/', status: 'complete' };
  const chrome = {
    runtime: { id: 'reader', getURL: (path: string) => `chrome-extension://reader/${path}`, onConnect: event('connect'), onMessage: event('message') },
    storage: { session: { get: async () => stored, set: async (value: object) => Object.assign(stored, value) } },
    windows: { getLastFocused: async () => ({ id: 1 }), onFocusChanged: event('focus'), WINDOW_ID_NONE: -1 },
    tabs: { query: async () => [active], onActivated: event('activated'), onUpdated: event('updated'), onRemoved: event('removed') },
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
  listeners.disconnect();
  await until(() => stored.captureStatus === 'idle');
  assert.equal(stored.snapshot, null);
});
