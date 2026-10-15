import { useEffect, useRef } from 'react';
import type { Frame } from '../engine/types';
import { phaseLabel } from './GraphView';

export function EventLog({ frames, index, onSeek }: { frames: Frame[]; index: number; onSeek: (i: number) => void }) {
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = box.current?.querySelector<HTMLElement>('.log-row.current');
    const parent = box.current;
    if (el && parent) {
      const top = el.offsetTop - parent.offsetTop;
      if (top < parent.scrollTop || top > parent.scrollTop + parent.clientHeight - 30) {
        parent.scrollTo({ top: top - parent.clientHeight / 2, behavior: 'smooth' });
      }
    }
  }, [index, frames.length]);
  return (
    <div className="log" ref={box}>
      {frames.map((f, i) => (
        <button
          key={f.seq}
          className={`log-row phase-${f.phase} ${i === index ? 'current' : ''} ${i > index ? 'future' : ''}`}
          onClick={() => onSeek(i)}
        >
          <span className="log-step mono">{f.superstep ?? '·'}</span>
          <span className="log-phase">{phaseLabel(f.phase)}</span>
          <span className="log-title">{f.title}</span>
        </button>
      ))}
    </div>
  );
}
