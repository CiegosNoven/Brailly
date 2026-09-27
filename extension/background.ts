import { mergeFrameSnapshotsWithSources } from '../shared/frame-snapshots';
import type { PageSnapshot } from '../shared/dom';

type FrameDescriptor = { url: string; context: string };
type CapturedFrame = FrameDescriptor & { frameId: number; snapshot: PageSnapshot };
type SourceSession = { tabId: number; windowId: number; url: string; token: string; revision: number; generation: number; main?: PageSnapshot; published?: PageSnapshot; controlBusy?: boolean; frames: Map<number, FrameDescriptor>; children: Map<number, CapturedFrame>; framePlan: string; frameGeneration: number; frameWarning?: string; publishTimer?: ReturnType<typeof setTimeout>; locations: Record<string, { url: string; originalId: string; frameId?: number }> };
const readers = new Set<chrome.runtime.Port>();
let generation = 0;
let source: SourceSession | null = null;
let revision = 0;
let storageWrites = Promise.resolve();

function writeCurrent(expected: number, values: Record<string, unknown>) {
  storageWrites = storageWrites.catch(() => {}).then(async () => {
    if (expected === generation) await chrome.storage.session.set(values);
  });
  return storageWrites;
}

async function stopObserver(previous: SourceSession | null) {
  if (!previous) return;
  clearTimeout(previous.publishTimer);
  try {
    await chrome.scripting.executeScript({
      target: { tabId: previous.tabId, allFrames: true },
      func: (token: string) => {
        const scope = window as unknown as { __BRAILLY_EXTENSION_CAPTURE?: { token: string }; __braillyLiveCapture?: { stop: () => void } };
        if (scope.__BRAILLY_EXTENSION_CAPTURE?.token === token) scope.__braillyLiveCapture?.stop();
      },
      args: [previous.token],
    });
  } catch { /* Closed or newly navigated documents no longer need an observer. */ }
}

async function focusedTab() {
  const window = await chrome.windows.getLastFocused();
  if (window.id === undefined) return undefined;
  return (await chrome.tabs.query({ active: true, windowId: window.id }))[0];
}

async function stillCurrent(candidate: SourceSession) {
  if (!readers.size || source !== candidate || generation !== candidate.generation) return false;
  const active = await focusedTab();
  return source === candidate && generation === candidate.generation && active?.id === candidate.tabId && active.url === candidate.url;
}

async function followActive() {
  if (!readers.size) return false;
  const expected = ++generation;
  const previous = source;
  source = null;
  void stopObserver(previous);
  try {
    const active = await focusedTab();
    const stored = await chrome.storage.session.get('sourceRevision');
    if (expected !== generation || !readers.size) return false;
    revision = Math.max(Date.now(), revision + 1, Number(stored.sourceRevision || 0) + 1);
    const metadata = { sourceTabId: active?.id ?? null, sourceWindowId: active?.windowId ?? null, sourceRevision: revision };
    if (!active?.id || !active.url || !/^https?:\/\//.test(active.url)) {
      await writeCurrent(expected, { ...metadata, snapshot: null, captureStatus: 'unavailable', captureError: 'Open an HTTP or HTTPS website to read it with Brailly.', pageChanged: false });
      return false;
    }
    if (active.status === 'loading') {
      await writeCurrent(expected, { ...metadata, snapshot: null, captureStatus: 'capturing', captureError: '', pageChanged: false });
      return true;
    }
    const candidate: SourceSession = { tabId: active.id, windowId: active.windowId, url: active.url, revision, token: crypto.randomUUID(), generation: expected, frames: new Map(), children: new Map(), framePlan: '', frameGeneration: 0, locations: {} };
    source = candidate;
    await writeCurrent(expected, { ...metadata, snapshot: null, captureStatus: 'capturing', captureError: '', pageChanged: false });
    await chrome.scripting.executeScript({
      target: { tabId: candidate.tabId },
      func: (capture: { token: string; url: string; revision: number }) => {
        (window as unknown as { __BRAILLY_EXTENSION_CAPTURE: typeof capture }).__BRAILLY_EXTENSION_CAPTURE = capture;
      },
      args: [{ token: candidate.token, url: candidate.url, revision: candidate.revision }],
    });
    if (!await stillCurrent(candidate)) return false;
    await chrome.scripting.executeScript({ target: { tabId: candidate.tabId }, files: ['content.js'] });
    return true;
  } catch (error) {
    await writeCurrent(expected, { snapshot: null, captureStatus: 'unavailable', captureError: error instanceof Error ? error.message : 'Could not access the active website.' });
    return false;
  }
}

async function captureChildren(candidate: SourceSession, frames: FrameDescriptor[], frameRevision: number) {
  const plan = JSON.stringify({ frames, frameRevision });
  if (plan === candidate.framePlan) return;
  candidate.framePlan = plan;
  const request = ++candidate.frameGeneration;
  candidate.frames.clear();
  candidate.children.clear();
  try {
  const results = await chrome.scripting.executeScript({
    target: { tabId: candidate.tabId, allFrames: true },
    func: (allowed: FrameDescriptor[], capture: { token: string; url: string; revision: number }) => {
      if (window === window.top || window.parent !== window.top) return null;
      const scope = window as unknown as { __BRAILLY_EXTENSION_CAPTURE?: typeof capture & { child?: boolean }; __braillyLiveCapture?: { stop: () => void } };
      const match = allowed.find(frame => frame.url === location.href);
      if (!match) { if (scope.__BRAILLY_EXTENSION_CAPTURE?.token === capture.token) scope.__braillyLiveCapture?.stop(); return null; }
      scope.__BRAILLY_EXTENSION_CAPTURE = { ...capture, url: location.href, child: true };
      return match;
    },
    args: [frames, { token: candidate.token, url: candidate.url, revision: candidate.revision }],
  });
  if (request !== candidate.frameGeneration || !await stillCurrent(candidate)) return;
  for (const result of results) if (result.result) candidate.frames.set(result.frameId, result.result);
  if (candidate.frames.size) await chrome.scripting.executeScript({ target: { tabId: candidate.tabId, frameIds: [...candidate.frames.keys()] }, files: ['content.js'] });
  if (request === candidate.frameGeneration) candidate.frameWarning = '';
  } catch {
    if (request !== candidate.frameGeneration) return;
    candidate.frames.clear();
    candidate.children.clear();
    candidate.framePlan = '';
    candidate.frameWarning = 'Some embedded content could not be read.';
  }
}

function publish(candidate: SourceSession) {
  clearTimeout(candidate.publishTimer);
  candidate.publishTimer = setTimeout(() => {
    void stillCurrent(candidate).then(async valid => {
      if (!valid || !candidate.main) return;
      const merged = mergeFrameSnapshotsWithSources(candidate.main, [...candidate.children.values()]);
      candidate.locations = merged.sources;
      candidate.published = merged.snapshot;
      await writeCurrent(candidate.generation, {
        snapshot: merged.snapshot, sourceTabId: candidate.tabId, sourceWindowId: candidate.windowId,
        sourceRevision: candidate.revision, captureStatus: 'ready', captureError: candidate.frameWarning || '', pageChanged: false,
      });
    });
  }, 80);
}

async function followWindow(windowId: number) {
  if (!readers.size) return;
  const focused = await chrome.windows.getLastFocused();
  if (focused.id === windowId) await followActive();
}

chrome.action.onClicked.addListener(tab => {
  if (tab.windowId === undefined) return;
  void chrome.sidePanel.open({ windowId: tab.windowId }).catch(error => {
    void chrome.storage.session.set({ captureError: error instanceof Error ? error.message : 'Could not open the reader.' });
  });
});

chrome.runtime.onConnect.addListener(port => {
  if (port.name !== 'brailly-reader' || port.sender?.id !== chrome.runtime.id) return;
  readers.add(port);
  void followActive();
  port.onMessage.addListener(message => { if (message?.type === 'refresh') void followActive(); });
  port.onDisconnect.addListener(() => {
    readers.delete(port);
    if (readers.size) return;
    const previous = source;
    source = null;
    const expected = ++generation;
    void stopObserver(previous);
    void writeCurrent(expected, { captureStatus: 'idle', snapshot: null });
  });
});

chrome.tabs.onActivated.addListener(info => { void followWindow(info.windowId); });
chrome.tabs.onUpdated.addListener((_tabId, change, tab) => {
  if (tab.active && (change.url !== undefined || change.status === 'loading' || change.status === 'complete')) void followWindow(tab.windowId);
});
chrome.tabs.onRemoved.addListener(tabId => { if (source?.tabId === tabId) void followActive(); });
chrome.windows.onFocusChanged.addListener(windowId => {
  if (!readers.size) return;
  if (windowId === chrome.windows.WINDOW_ID_NONE) {
    const previous = source;
    source = null;
    const expected = ++generation;
    void stopObserver(previous);
    void writeCurrent(expected, { captureStatus: 'idle', snapshot: null });
  } else void followWindow(windowId);
});

chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (message.type === 'snapshot' && sender.tab?.id && sender.frameId !== undefined) {
    const candidate = source;
    if (!candidate || sender.tab.id !== candidate.tabId || message.captureToken !== candidate.token) return;
    const child = candidate.frames.get(sender.frameId);
    if (sender.frameId === 0 ? message.snapshot?.url !== candidate.url : !child || message.snapshot?.url !== child.url) return;
    void stillCurrent(candidate).then(async valid => {
      if (!valid) return;
      if (sender.frameId === 0) {
        candidate.main = message.snapshot;
        const frames = Array.isArray(message.visibleFrames) ? message.visibleFrames.filter((frame: FrameDescriptor) => typeof frame.url === 'string' && /^https?:\/\//.test(frame.url) && typeof frame.context === 'string').slice(0, 4) : [];
        await captureChildren(candidate, frames, Number(message.frameRevision) || 0);
      } else if (child) candidate.children.set(sender.frameId!, { ...child, frameId: sender.frameId!, snapshot: message.snapshot });
      publish(candidate);
    });
    return;
  }
  const readerUrl = chrome.runtime.getURL('index.html');
  const fromReader = sender.id === chrome.runtime.id && sender.url?.split(/[?#]/)[0] === readerUrl;
  if (message.type === 'activate-control' && fromReader) {
    const candidate = source;
    void (async () => {
      if (!candidate || !await stillCurrent(candidate) || candidate.controlBusy || !candidate.published || message.snapshotId !== candidate.published.id)
        return { ok: false, message: 'The source page changed. Select a control from the current capture.' };
      const block = candidate.published.blocks.find(block => block.id === message.id);
      const location = candidate.locations[message.id];
      if (!block || !location) return { ok: false, message: 'This control is no longer in the captured page.' };
      const original = (location.frameId ? candidate.children.get(location.frameId)?.snapshot : candidate.main)?.blocks.find(item => item.id === location.originalId);
      if (!original) return { ok: false, message: 'This frame changed. Capture the page again.' };
      candidate.controlBusy = true;
      try {
        return await chrome.tabs.sendMessage(candidate.tabId, {
          type: 'operate-control', token: candidate.token, requestId: crypto.randomUUID(), url: location.url,
          block: original,
        }, { frameId: location.frameId || 0 });
      } finally { candidate.controlBusy = false; }
    })().then(respond).catch(() => respond({ ok: false, message: 'Could not reach the original control. Capture the page again.' }));
    return true;
  }
  if (message.type === 'capture' && fromReader) {
    followActive().then(ok => respond({ ok }));
    return true;
  }
  if (message.type === 'locate' && fromReader) {
    const candidate = source;
    void (async () => {
      if (!candidate || !await stillCurrent(candidate)) return false;
      await chrome.scripting.executeScript({
        target: { tabId: candidate.tabId, frameIds: [candidate.locations[message.id]?.frameId || 0] },
        func: (id: string, text: string) => {
          if (!/^b\d+$/.test(id)) return;
          const node = document.querySelector<HTMLElement>(`[data-brailly-id="${id}"]`);
          if (!node) return;
          const label = node.getAttribute('aria-label') || node.textContent || '';
          if (label.replace(/\s+/g, ' ').trim().slice(0, 800) !== text) return;
          const previousTabIndex = node.getAttribute('tabindex');
          const previousOutline = node.style.outline;
          node.scrollIntoView({ block: 'center', behavior: 'instant' });
          node.setAttribute('tabindex', '-1');
          node.focus();
          node.style.outline = '3px solid #2d5bdb';
          setTimeout(() => {
            node.style.outline = previousOutline;
            if (previousTabIndex === null) node.removeAttribute('tabindex');
            else node.setAttribute('tabindex', previousTabIndex);
          }, 2500);
        },
        args: [candidate.locations[message.id]?.originalId || message.id, message.text],
      });
      return true;
    })().then(ok => respond({ ok })).catch(async error => {
      if (candidate) await writeCurrent(candidate.generation, { captureError: error instanceof Error ? error.message : 'Could not locate this element.' });
      respond({ ok: false });
    });
    return true;
  }
});
