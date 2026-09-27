import { useEffect, useRef, useState } from 'react';
import type { DomBlock, PageSnapshot } from '../shared/dom';
import { controlKind, type ControlResult } from '../shared/page-controls';
import './page-controls.css';

type Props = {
  page: PageSnapshot | null;
  current?: DomBlock;
  onChoose: (block: DomBlock) => void;
  onActivate: (block: DomBlock) => Promise<ControlResult>;
};

export default function PageControls({ page, current, onChoose, onActivate }: Props) {
  const dialog = useRef<HTMLDialogElement>(null);
  const opener = useRef<HTMLButtonElement>(null);
  const search = useRef<HTMLInputElement>(null);
  const busyRef = useRef(false);
  const selectedOnClose = useRef(false);
  const generation = useRef(0);
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const controls = page?.blocks.filter(block => controlKind(block)) || [];
  const matches = controls.filter(block => `${block.text} ${block.context || ''}`.toLowerCase().includes(query.toLowerCase().trim()));
  const kind = current && controlKind(current);
  const remote = page?.source === 'browserbase';
  useEffect(() => {
    generation.current++;
    busyRef.current = false;
    setBusy(false);
    setMessage('');
  }, [page?.id]);

  function open() {
    if (!page || document.querySelector('dialog[open], [aria-modal="true"]')) return;
    setQuery('');
    dialog.current?.showModal();
    search.current?.focus();
  }
  async function activate() {
    if (!current || !kind || remote || busyRef.current) return;
    const request = generation.current;
    busyRef.current = true;
    setBusy(true);
    setMessage(kind === 'field' ? 'Focusing the field…' : 'Activating the control…');
    try {
      const result = await onActivate(current);
      if (request === generation.current) setMessage(result.message);
    } catch {
      if (request === generation.current) setMessage('Could not reach this control. Capture the page again.');
    } finally {
      if (request === generation.current) { busyRef.current = false; setBusy(false); }
    }
  }
  useEffect(() => {
    const keyboard = (event: KeyboardEvent) => {
      if (event.repeat || event.isComposing || event.ctrlKey || event.metaKey) return;
      if (event.altKey && event.code === 'KeyK' && !event.shiftKey) {
        event.preventDefault();
        open();
      } else if (event.key === 'Enter' && !event.altKey && !event.shiftKey && (event.target as HTMLElement)?.id === 'reading-output' && kind) {
        event.preventDefault();
        void activate();
      }
    };
    window.addEventListener('keydown', keyboard);
    return () => window.removeEventListener('keydown', keyboard);
  });

  return <section className="page-controls" aria-label="Page controls">
    <div className="control-actions">
      <button ref={opener} onClick={open} disabled={!page} aria-keyshortcuts="Alt+K">Find a control <kbd>Alt + K</kbd></button>
      {kind && <button onClick={() => void activate()} disabled={busy || remote}>
        {kind === 'field' ? 'Focus field' : kind === 'link' ? 'Open link' : 'Activate button'}
      </button>}
    </div>
    {kind && <p className="control-hint">{remote ? 'Use the extension to interact with the original page.' : 'Press Enter on the Braille reading line to use this control.'}</p>}
    <p className="control-status" role="status">{message}</p>
    <dialog className="control-dialog" ref={dialog} aria-labelledby="control-title" onKeyDown={event => { if (event.key === "Escape") { event.preventDefault(); dialog.current?.close(); } }} onClose={() => {
      if (selectedOnClose.current) document.getElementById("reading-output")?.focus();
      else opener.current?.focus();
      selectedOnClose.current = false;
    }}>
      <div className="control-dialog-heading"><h2 id="control-title">Find a control</h2><button aria-label="Close control search" onClick={() => dialog.current?.close()}>Close</button></div>
      <label htmlFor="control-query">Button, link, or field name</label>
      <input ref={search} id="control-query" type="search" value={query} onChange={event => setQuery(event.target.value)} />
      <p role="status">{matches.length} {matches.length === 1 ? "control" : "controls"}{page?.truncated ? ' in this captured portion of the page' : ''}</p>
      <ul>{matches.map(block => <li key={block.id}><button onClick={() => {
        selectedOnClose.current = true;
        dialog.current?.close();
        onChoose(block);
      }}><span>{block.text}</span><small>{controlKind(block)}{block.context ? ` · ${block.context}` : ''}</small></button></li>)}</ul>
      {!matches.length && <p>No matching controls. Try another name or capture the page again.</p>}
    </dialog>
  </section>;
}
