import { useEffect } from 'react';
import { useStore } from '../state/store';
import { ringLabel, ringShare } from '../popouts/deepReadHelpers';

/** A thin ring that fills as Deep read reads: the title bar's small one and the pop-out's large one. */
export function Ring({ share, size, width = 2, children }: { share: number; size: number; width?: number; children?: React.ReactNode }) {
  const r = (size - width) / 2;
  const c = 2 * Math.PI * r;
  return (
    <span className="dr-ring" style={{ width: size, height: size }} aria-hidden="true">
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="currentColor" strokeOpacity={0.22} strokeWidth={width} />
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="currentColor" strokeWidth={width} strokeLinecap="round"
          strokeDasharray={c} strokeDashoffset={c * (1 - Math.max(0, Math.min(1, share)))} transform={`rotate(-90 ${size / 2} ${size / 2})`} className="dr-arc" />
      </svg>
      {children}
    </span>
  );
}

/** The title-bar button: Deep read, with its ring and percentage. Polls while a read runs so the ring moves. */
export function DeepReadButton() {
  const { memory, refreshMemory, openPopout } = useStore();
  useEffect(() => { void refreshMemory(); }, [refreshMemory]);
  const running = memory?.job.status === 'running';
  useEffect(() => {
    if (!running) return;
    const t = setInterval(() => { void refreshMemory(); }, 3000);
    return () => clearInterval(t);
  }, [running, refreshMemory]);
  const label = ringLabel(memory);
  return (
    <button className={`pill deep-pill${running ? ' reading' : ''}`} data-action="deep-read" aria-label={`Deep read${label ? `, ${label} read` : ''}`}
      title="Deep read: what the assistant has read of what people wrote" onClick={() => openPopout({ kind: 'deep-read' })}>
      <Ring share={ringShare(memory)} size={14} />Deep read{label && <span className="dr-pct">{label}</span>}
    </button>
  );
}
