import { parseHTML } from 'linkedom';
import { extractDocument } from '../shared/dom.js';
import { fetchPublicHtml } from './page.js';

type HtmlSource = { html: string; url: string };
type FetchHtml = (url: string) => Promise<HtmlSource>;
export type EmbeddedSource = { url: string; context: string; status: 'included' | 'unavailable'; reason?: string };
export type ExpandedPage = HtmlSource & { embeddedSources: EmbeddedSource[]; embeddedOmitted: number };
const MAX_BYTES = 2_000_000;
const MAX_FRAMES = 4;

function hidden(element: Element): boolean {
  for (let node: Element | null = element; node; node = node.parentElement) {
    if (node.hasAttribute('hidden') || node.hasAttribute('inert') || node.getAttribute('aria-hidden') === 'true') return true;
    if (/display\s*:\s*none|visibility\s*:\s*hidden/i.test(node.getAttribute('style') || '')) return true;
    if (node.classList.contains('hidden') || node.classList.contains('jqHidden')) return true;
  }
  return false;
}

function frameContext(frame: Element, sourceUrl: string) {
  for (let parent = frame.parentElement, depth = 0; parent && depth < 5; parent = parent.parentElement, depth++) {
    if (['BODY', 'HTML'].includes(parent.tagName)) break;
    const heading = parent.querySelector('h1,h2,h3,h4,h5,h6');
    if (heading?.textContent?.trim()) return heading.textContent.replace(/\s+/g, ' ').trim().slice(0, 240);
  }
  return frame.getAttribute('title')?.trim().slice(0, 240) || new URL(sourceUrl).hostname;
}

function embeddedText(source: HtmlSource): string[] {
  const { document } = parseHTML(source.html);
  document.querySelectorAll('script,style,noscript,template,iframe,frame,object,embed,input,textarea,select').forEach(node => node.remove());
  document.querySelectorAll('*').forEach(node => { if (hidden(node)) node.remove(); });
  const root = document.querySelector('main,[role="main"]') || document.body;
  if (!root) return [];
  const isolated = parseHTML(`<!doctype html><html><head><title>Embedded source</title></head><body>${root.outerHTML}</body></html>`).document;
  const blocks = extractDocument(isolated as unknown as Document, source.url).blocks;
  if (blocks.length) return blocks.map(block => block.text);
  const text = root.textContent?.replace(/\s+/g, ' ').trim() || '';
  return text ? [text.slice(0, 800)] : [];
}

export async function fetchExpandedPage(rawUrl: string, fetchHtml: FetchHtml = fetchPublicHtml): Promise<ExpandedPage> {
  const source = await fetchHtml(rawUrl);
  let totalBytes = Buffer.byteLength(source.html, 'utf8');
  if (totalBytes > MAX_BYTES) throw new Error('Page exceeds the combined 2 MB preview limit.');
  const { document } = parseHTML(source.html);
  let base = source.url;
  try {
    const candidate = new URL(document.querySelector('base[href]')?.getAttribute('href') || source.url, source.url);
    if (['http:', 'https:'].includes(candidate.protocol)) base = candidate.href;
  } catch { /* Keep the fetched page URL. */ }
  const frames = Array.from(document.querySelectorAll('iframe[src]')).filter(frame => {
    if (hidden(frame) || frame.getAttribute('width') === '0' || frame.getAttribute('height') === '0') return false;
    return !!frame.getAttribute('src')?.trim();
  });
  const embeddedSources: EmbeddedSource[] = [];
  const cache = new Map<string, HtmlSource>();
  for (const frame of frames.slice(0, MAX_FRAMES)) {
    let frameUrl: URL;
    try {
      frameUrl = new URL(frame.getAttribute('src')!, base);
      if (!['http:', 'https:'].includes(frameUrl.protocol)) continue;
    } catch { continue; }
    const context = frameContext(frame, frameUrl.href);
    const section = document.createElement('section');
    section.setAttribute('data-brailly-embedded-source', frameUrl.href);
    section.setAttribute('aria-label', context);
    const heading = document.createElement('h3');
    heading.textContent = context;
    section.append(heading);
    const record: EmbeddedSource = { url: frameUrl.href, context, status: 'unavailable' };
    try {
      let embedded = cache.get(frameUrl.href);
      if (!embedded) {
        embedded = await fetchHtml(frameUrl.href);
        totalBytes += Buffer.byteLength(embedded.html, 'utf8');
        if (totalBytes > MAX_BYTES) throw new Error('Combined preview limit reached.');
        cache.set(frameUrl.href, embedded);
      }
      const lines = embeddedText(embedded);
      if (!lines.length) throw new Error('No readable HTML in the embedded page.');
      for (const line of lines) {
        const paragraph = document.createElement('p');
        paragraph.textContent = line;
        section.append(paragraph);
      }
      record.url = embedded.url;
      record.status = 'included';
    } catch (error) {
      record.reason = error instanceof Error ? error.message : 'Could not load the embedded page.';
      const message = document.createElement('p');
      message.textContent = 'Embedded page unavailable.';
      section.append(message);
    }
    const link = document.createElement('a');
    link.setAttribute('href', record.url);
    link.textContent = 'Open embedded source';
    section.append(link);
    frame.replaceWith(section);
    embeddedSources.push(record);
    if (totalBytes > MAX_BYTES) break;
  }
  return {
    html: '<!doctype html>' + document.documentElement.outerHTML,
    url: source.url,
    embeddedSources,
    embeddedOmitted: Math.max(0, frames.length - embeddedSources.length),
  };
}
