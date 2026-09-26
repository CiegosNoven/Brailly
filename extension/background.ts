async function capture(tabId?: number) {
  try {
    if (!tabId) {
      const store = await chrome.storage.session.get('sourceTabId');
      tabId = typeof store.sourceTabId === 'number' ? store.sourceTabId : undefined;
    }
    if (!tabId) throw new Error('Open a website and click the Braily extension icon first.');
    await chrome.storage.session.set({ sourceTabId: tabId, captureError: '' });
    await chrome.scripting.executeScript({ target: { tabId }, files: ['content.js'] });
    return true;
  } catch (error) {
    await chrome.storage.session.set({ captureError: error instanceof Error ? error.message : 'Could not access this page.' });
    return false;
  }
}

chrome.action.onClicked.addListener(tab => {
  if (!tab.id) return;
  void chrome.sidePanel.open({ tabId: tab.id }).catch(error => {
    void chrome.storage.session.set({ captureError: error instanceof Error ? error.message : 'Could not open the reader.' });
  });
  void capture(tab.id);
});

chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (message.type === 'snapshot' && sender.tab?.id) {
    void chrome.storage.session.get('sourceTabId').then(value => {
      if (value.sourceTabId === sender.tab!.id) return chrome.storage.session.set({ snapshot: message.snapshot, pageChanged: false, captureError: '' });
    });
    return;
  }
  if (message.type === 'changed' && sender.tab?.id) {
    void chrome.storage.session.get('sourceTabId').then(value => {
      if (value.sourceTabId === sender.tab!.id) return chrome.storage.session.set({ pageChanged: true });
    });
    return;
  }
  const readerUrl = chrome.runtime.getURL('index.html');
  const fromReader = sender.id === chrome.runtime.id && sender.url?.split(/[?#]/)[0] === readerUrl;
  if (message.type === 'capture' && fromReader) {
    capture().then(ok => respond({ ok }));
    return true;
  }
  if (message.type === 'locate' && fromReader) {
    void chrome.storage.session.get('sourceTabId').then(async value => {
      if (typeof value.sourceTabId !== 'number') return;
      await chrome.scripting.executeScript({
        target: { tabId: value.sourceTabId },
        func: (id: string, text: string) => {
          if (!/^b\d+$/.test(id)) return;
          const node = document.querySelector<HTMLElement>(`[data-reflow-id="${id}"]`);
          if (!node) return;
          const source = (node.getAttribute('aria-label') || node.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 800);
          if (source !== text) return;
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
        args: [message.id, message.text],
      });
    }).then(() => respond({ ok: true })).catch(async error => {
      await chrome.storage.session.set({ captureError: error instanceof Error ? error.message : 'Could not locate this element.' });
      respond({ ok: false });
    });
    return true;
  }
});
