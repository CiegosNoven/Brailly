import { extractDocument } from '../shared/dom';

const scope = window as unknown as {
  __BRAILLY_EXTENSION_CAPTURE?: { token: string; url: string; revision: number; child?: boolean };
  __braillyObserver?: MutationObserver;
  __braillyLiveCapture?: { stop: () => void };
};
scope.__braillyLiveCapture?.stop();
scope.__braillyObserver?.disconnect();

let quietTimer: ReturnType<typeof setTimeout> | undefined;
let deadlineTimer: ReturnType<typeof setTimeout> | undefined;
let lastContent = '';
let stopped = false;
const captureToken = scope.__BRAILLY_EXTENSION_CAPTURE?.token;
let frameRevision = 0;

function visibleFrames() {
  if (window !== window.top) return [];
  const nodes = Array.from(document.querySelectorAll<HTMLIFrameElement>('iframe[src]'));
  const visible = (frame: HTMLIFrameElement) => {
    if (!frame.getClientRects().length || frame.clientWidth < 1 || frame.clientHeight < 1) return false;
    for (let node: HTMLElement | null = frame; node; node = node.parentElement) {
      const style = getComputedStyle(node);
      if (node.hidden || node.getAttribute('aria-hidden') === 'true' || style.display === 'none' || style.visibility === 'hidden') return false;
    }
    return true;
  };
  return nodes.filter(frame => visible(frame) && nodes.filter(other => other.src === frame.src).every(visible)).flatMap(frame => {
    let url: URL;
    try { url = new URL(frame.src); } catch { return []; }
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || /^(localhost|127\.|10\.|192\.168\.|169\.254\.|\[::1\])/.test(url.hostname) || /\.(local|internal)$/.test(url.hostname)) return [];
    let context = frame.title;
    for (let node = frame.parentElement, depth = 0; node && depth < 5; node = node.parentElement, depth++) {
      if (['BODY', 'HTML'].includes(node.tagName)) break;
      const heading = node.querySelector('h1,h2,h3,h4,h5,h6');
      if (heading?.textContent?.trim()) { context = heading.textContent.replace(/\s+/g, ' ').trim(); break; }
    }
    return [{ url: url.href, context: (context || url.hostname).slice(0, 240) }];
  }).slice(0, 4);
}

function clearTimers() {
  clearTimeout(quietTimer);
  clearTimeout(deadlineTimer);
  quietTimer = undefined;
  deadlineTimer = undefined;
}

function capture(force = false) {
  clearTimers();
  if (stopped || document.visibilityState === 'hidden') return;
  if (window !== window.top && !scope.__BRAILLY_EXTENSION_CAPTURE?.child) return;
  const snapshot = extractDocument(document, location.href, true);
  const frames = visibleFrames();
  const content = JSON.stringify({
    url: snapshot.url,
    title: snapshot.title,
    blocks: snapshot.blocks,
    totalCandidates: snapshot.totalCandidates,
    truncated: snapshot.truncated,
    frames,
    frameRevision,
  });
  if (!force && content === lastContent) return;
  lastContent = content;
  void chrome.runtime.sendMessage({ type: 'snapshot', snapshot, live: !force, captureToken, visibleFrames: frames, frameRevision }).catch(() => {});
}

function schedule() {
  if (stopped || document.visibilityState === 'hidden') return;
  clearTimeout(quietTimer);
  quietTimer = setTimeout(() => capture(), 450);
  if (deadlineTimer === undefined) deadlineTimer = setTimeout(() => capture(), 2000);
}

const observer = new MutationObserver(changes => {
  const sourceChanged = changes.some(change => {
    const element = change.target instanceof Element ? change.target : change.target.parentElement;
    if (element?.closest('[data-brailly-ui],script,style,noscript')) return false;
    return change.type !== 'attributes' || !change.attributeName?.startsWith('data-brailly');
  });
  if (sourceChanged) schedule();
});

const iframeLoaded = (event: Event) => { if (event.target instanceof HTMLIFrameElement) { frameRevision++; schedule(); } };
document.addEventListener('load', iframeLoaded, true);
capture(true);
observer.observe(document.body || document.documentElement, {
  childList: true,
  subtree: true,
  characterData: true,
  attributes: true,
  attributeFilter: ['hidden', 'aria-hidden', 'aria-label', 'aria-labelledby', 'role', 'href', 'src', 'open', 'class', 'style'],
});
scope.__braillyLiveCapture = {
  stop() {
    stopped = true;
    clearTimers();
    observer.disconnect();
    document.removeEventListener('load', iframeLoaded, true);
  },
};
