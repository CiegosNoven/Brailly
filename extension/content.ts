import { extractDocument } from '../shared/dom';

const scope = window as unknown as {
  __braillyObserver?: MutationObserver;
  __braillyLiveCapture?: { stop: () => void };
};
scope.__braillyLiveCapture?.stop();
scope.__braillyObserver?.disconnect();

let quietTimer: ReturnType<typeof setTimeout> | undefined;
let deadlineTimer: ReturnType<typeof setTimeout> | undefined;
let lastContent = '';
let stopped = false;

function clearTimers() {
  clearTimeout(quietTimer);
  clearTimeout(deadlineTimer);
  quietTimer = undefined;
  deadlineTimer = undefined;
}

function capture(force = false) {
  clearTimers();
  if (stopped) return;
  const snapshot = extractDocument(document, location.href, true);
  const content = JSON.stringify({
    url: snapshot.url,
    title: snapshot.title,
    blocks: snapshot.blocks,
    totalCandidates: snapshot.totalCandidates,
    truncated: snapshot.truncated,
  });
  if (!force && content === lastContent) return;
  lastContent = content;
  void chrome.runtime.sendMessage({ type: 'snapshot', snapshot, live: !force }).catch(() => {});
}

function schedule() {
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

capture(true);
observer.observe(document.body || document.documentElement, {
  childList: true,
  subtree: true,
  characterData: true,
  attributes: true,
  attributeFilter: ['hidden', 'aria-hidden', 'aria-label', 'aria-labelledby', 'role', 'href', 'open', 'class', 'style'],
});
scope.__braillyLiveCapture = {
  stop() {
    stopped = true;
    clearTimers();
    observer.disconnect();
  },
};
