import { ArrowDown, ArrowUpRight, Check, CircleNotch, Warning } from '@phosphor-icons/react';
import './change-demo.css';

export const ELEVATOR_SITE = 'https://www.sfmta.com/elevator-status/elevatorstatus.php?src=prod';
export const ELEVATOR_BEFORE = 'Street elevator in service. Step-free access to the platform is available.';

type Props = {
  after?: string;
  busy: boolean;
  decision?: { decision: string; latencyMs: number; model: string };
  error: string;
  canResume: boolean;
  onReplay: () => void;
  onRealSite: () => void;
};

export default function ChangeDemo({ after, busy, decision, error, canResume, onReplay, onRealSite }: Props) {
  const changed = !!after && after !== ELEVATOR_BEFORE;
  const interrupted = decision?.decision === 'INTERRUPT';
  const labels: Record<string, string> = { INTERRUPT: 'Alert sent to the display', DEFER: 'Reading held', QUEUE_HIGH: 'Update moved up the queue', NONE: 'No interruption', ERROR: 'Analysis failed', STALE: 'Waiting for a fresh analysis' };
  return <aside className="change-demo" aria-label="Live alert demonstration">
    <header><h2>A change you need to know</h2><span>Controlled demo</span></header>
    <div className="change-source"><Check size={22}/><div><span>Before</span><p>{ELEVATOR_BEFORE}</p></div></div>
    <ArrowDown className="change-arrow" size={24} aria-hidden="true"/>
    <div className={`change-source ${changed ? 'change-source-alert' : ''}`}>
      {changed ? <Warning size={24}/> : <CircleNotch size={22} className={busy ? 'spin' : undefined}/>}
      <div><span>{changed ? 'Page changed' : 'Watching the page'}</span><p>{changed ? after : 'The elevator status will change after Jev reads the page.'}</p></div>
    </div>
    <div className={`change-decision ${interrupted ? 'change-decision-alert' : ''}`} role={interrupted && canResume ? 'alert' : 'status'} aria-atomic="true">
      <strong>{error ? 'Could not finish the demo' : busy ? changed ? 'Jev is checking the change…' : 'Jev is reading the page…' : decision ? labels[decision.decision] || decision.decision : 'Waiting for the page change'}</strong>
      {decision && <span>{decision.model} · {decision.latencyMs} ms · {decision.decision}</span>}
      {interrupted && canResume && <p>Your previous reading position is saved. Use Resume reading to go back.</p>}
      {error && <p>{error}</p>}
    </div>
    <button onClick={onReplay} disabled={busy}>Replay demo</button>
    <footer><h3>Try a real website</h3><button onClick={onRealSite} disabled={busy}>SFMTA elevator status <ArrowUpRight size={18}/></button><a href={ELEVATOR_SITE} target="_blank" rel="noreferrer">Open original page</a></footer>
  </aside>;
}
