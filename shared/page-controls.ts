import { extractDocument, type DomBlock } from './dom';

export function controlKind(block: DomBlock): 'link' | 'button' | 'field' | null {
  if (block.tag === 'a' && block.href) return 'link';
  if (block.tag === 'button' || block.tag === 'summary' || block.role === 'button') return 'button';
  if (['input', 'select', 'textarea'].includes(block.tag)) return 'field';
  return null;
}

export type ControlResult = { ok: boolean; message: string };

export function operateControl(doc: Document, url: string, expected: DomBlock, mode: 'live' | 'preview'): ControlResult {
  const fail = (message: string): ControlResult => ({ ok: false, message });
  if (!expected || !/^b\d+$/.test(expected.id)) return fail('This control is unavailable. Capture the page again.');
  const current = extractDocument(doc, url, true, expected.id).blocks.find(block => block.id === expected.id);
  if (!current || ['text', 'tag', 'role', 'href', 'context'].some(key => current[key as keyof DomBlock] !== expected[key as keyof DomBlock]))
    return fail('This control changed. Select it again from the updated page.');
  const node = doc.querySelector<HTMLElement>(`[data-brailly-id="${expected.id}"]`);
  const kind = controlKind(current);
  if (!node || !kind) return fail('This item is not an available page control.');
  if (node.matches(':disabled') || node.closest('[aria-disabled="true"], [inert]'))
    return fail('This control is disabled on the website.');
  if (mode === 'preview' && kind !== 'link' && current.tag !== 'summary')
    return fail('Use the Brailly extension to interact with this control on the original website.');
  node.scrollIntoView({ block: 'center', behavior: 'instant' });
  node.focus({ preventScroll: true });
  if (kind === 'field') return doc.activeElement === node
    ? { ok: true, message: `Focused ${current.text}. Continue typing on the website.` }
    : fail('Could not focus this field. Open the original website.');
  node.click();
  return { ok: true, message: `Activated ${current.text}.` };
}
