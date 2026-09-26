import { useId } from 'react';
import type { Classification, DomBlock } from '../shared/dom';
import './reading-queue.css';

type Props = {
  blocks: DomBlock[];
  results: Classification | null;
  currentId?: string;
  busy: boolean;
  onSelect: (block: DomBlock) => void;
  pending: boolean;
};

export default function ReadingQueue({ blocks, results, currentId, busy, onSelect, pending }: Props) {
  const headingId = useId();
  const scores = new Map(!busy && !pending ? results?.results.map(result => [result.id, result]) : []);
  const status = !blocks.length
    ? 'Open a page to see its text.'
    : busy
      ? `Jev is scoring all ${blocks.length} blocks.`
      : pending || !results
        ? 'Page order · awaiting Jev'
        : 'Ready · highest relevance first';

  return (
    <section className="queue-panel" aria-labelledby={headingId}>
      <div className="queue-heading">
        <h2 id={headingId}>Reading queue</h2>
        <span aria-label={`${blocks.length} blocks`}>{blocks.length}</span>
      </div>
      <p className="queue-status" role="status" aria-live="polite">{status}</p>
      {blocks.length > 0 && (
        <ol className="queue-list">
          {blocks.map((block, index) => {
            const score = scores.get(block.id);
            const current = block.id === currentId;
            return (
              <li key={block.id}>
                <button
                  type="button"
                  className={`queue-item${current ? ' queue-current' : ''}`}
                  aria-current={current ? 'true' : undefined}
                  onClick={() => onSelect(block)}
                >
                  <span className="queue-number" aria-hidden="true">{index + 1}</span>
                  <span className="queue-copy">
                    <span className="queue-text">{block.text}</span>
                    {current && <span className="queue-current-label">On display</span>}
                  </span>
                  <span className="queue-score">
                    {busy ? 'Pending' : score ? <><b>{score.score.toFixed(1)}</b><span className="queue-score-scale"> / 3</span></> : null}
                  </span>
                </button>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}
