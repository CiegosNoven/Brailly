import type { DomBlock, PageSnapshot } from '../shared/dom';
import type { VisualEvidence } from '../shared/visual';

// Keep visual observations distinct from literal website text, including uncertainty.
export function withVisualEvidence(page: PageSnapshot, evidence: VisualEvidence[]): PageSnapshot {
  const visual = evidence.slice(0, 12).map((item, index): DomBlock => ({
    id: `b900000000${item.candidateId.slice(1)}`,
    tag: 'figure', role: 'img', region: 'main', order: page.blocks.length + index,
    context: 'Visual observation; generated descriptions may be uncertain.',
    text: [
      item.method === 'source-alt' ? `Image alternative: ${item.sourceAltText || ''}` :
        `Visual observation: ${[item.recognizedText, item.generatedDescription].filter(Boolean).join('. ')}`,
      item.uncertainty ? `Uncertainty: ${item.uncertainty}` : '',
    ].filter(Boolean).join(' ').slice(0, 800),
  }));
  const blocks = [...page.blocks.slice(0, 60 - visual.length), ...visual];
  return { ...page, blocks, totalCandidates: page.totalCandidates + visual.length,
    truncated: page.truncated || page.blocks.length + visual.length > 60 };
}

export class ChangeTone {
  private context: AudioContext | null = null;
  async unlock() {
    try {
      this.context ||= new AudioContext();
      if (this.context.state === 'suspended') await this.context.resume();
    } catch { /* Visible alerts remain available if audio is unavailable. */ }
  }
  play(): boolean {
    const context = this.context;
    if (!context || context.state !== 'running') return false;
    const tone = context.createOscillator();
    const gain = context.createGain();
    tone.frequency.value = 740;
    gain.gain.setValueAtTime(0, context.currentTime);
    gain.gain.linearRampToValueAtTime(.12, context.currentTime + .015);
    gain.gain.exponentialRampToValueAtTime(.001, context.currentTime + .15);
    tone.connect(gain); gain.connect(context.destination);
    tone.start(); tone.stop(context.currentTime + .16);
    tone.onended = () => { tone.disconnect(); gain.disconnect(); };
    return true;
  }
  close() { void this.context?.close(); this.context = null; }
}
