import { Pause, Play, RotateCcw, SkipBack, SkipForward } from 'lucide-react';
import { useRef } from 'react';
import type { Frame } from '../engine/types';
import type { PlayerSnapshot } from '../player';
import { phaseLabel } from './GraphView';

interface Props {
  snap: PlayerSnapshot;
  onPlay: () => void;
  onStep: () => void;
  onBack: () => void;
  onReset: () => void;
  onSpeed: (s: number) => void;
  onSeek: (i: number) => void;
}

const SPEEDS = [0.5, 1, 2, 4];

/** 영상 편집기처럼 하단에 고정된 재생 바 + 프레임 스크러버 */
export function Transport({ snap, onPlay, onStep, onBack, onReset, onSpeed, onSeek }: Props) {
  return (
    <footer className="transport">
      <div className="transport-buttons">
        <button className="icon-btn" onClick={onReset} title="처음부터 (그래프/체크포인트 초기화)" aria-label="초기화">
          <RotateCcw size={15} strokeWidth={1.75} />
        </button>
        <button className="icon-btn" onClick={onBack} disabled={!snap.canBack} title="이전 스텝 (←)" aria-label="이전 스텝">
          <SkipBack size={15} strokeWidth={1.75} />
        </button>
        <button className="play-btn" onClick={onPlay} title="재생 / 일시정지 (Space)" aria-label={snap.playing ? '일시정지' : '재생'}>
          {snap.playing ? <Pause size={16} strokeWidth={2} /> : <Play size={16} strokeWidth={2} />}
        </button>
        <button className="icon-btn" onClick={onStep} title="한 스텝 진행 (→)" aria-label="한 스텝 진행">
          <SkipForward size={15} strokeWidth={1.75} />
        </button>
      </div>

      <Scrubber frames={snap.frames} index={snap.index} running={snap.running} onSeek={onSeek} />

      <div className="transport-right">
        <div className="seg" role="group" aria-label="재생 속도">
          {SPEEDS.map((s) => (
            <button key={s} className={snap.speed === s ? 'on' : ''} onClick={() => onSpeed(s)}>
              {s}×
            </button>
          ))}
        </div>
        <span className="counter">
          {String(snap.index + 1).padStart(2, '0')}
          <span className="counter-sep">/</span>
          {String(snap.frames.length).padStart(2, '0')}
        </span>
      </div>
    </footer>
  );
}

function tickKind(f: Frame) {
  if (f.phase === 'error') return 'err';
  if (f.phase === 'interrupt' || f.phase === 'route-pending') return 'pause';
  if (f.phase === 'checkpoint') return 'ckpt';
  if (f.phase === 'run' || f.phase === 'end') return 'major';
  return '';
}

function Scrubber({ frames, index, running, onSeek }: { frames: Frame[]; index: number; running: boolean; onSeek: (i: number) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const n = frames.length;
  const pick = (clientX: number) => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const t = Math.max(0, Math.min(1, (clientX - r.left) / r.width));
    onSeek(Math.min(n - 1, Math.floor(t * n)));
  };
  const onDown = (e: React.PointerEvent) => {
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    pick(e.clientX);
  };
  const onMove = (e: React.PointerEvent) => {
    if (e.buttons & 1) pick(e.clientX);
  };

  // super-step 이 바뀌는 지점마다 라벨
  const labels: { i: number; s: number }[] = [];
  frames.forEach((f, i) => {
    if (f.superstep !== null && (i === 0 || frames[i - 1].superstep !== f.superstep)) labels.push({ i, s: f.superstep });
  });
  const cur = frames[index];

  return (
    <div className="scrubber">
      <div className="scrub-meta">
        <span className="scrub-phase">{phaseLabel(cur.phase)}</span>
        <span className="scrub-title">{cur.title}</span>
      </div>
      <div className="scrub-track" ref={ref} onPointerDown={onDown} onPointerMove={onMove} role="slider" aria-valuemin={1} aria-valuemax={n} aria-valuenow={index + 1} aria-label="프레임 위치">
        {labels.map((l) => (
          <span key={l.i} className="scrub-label" style={{ left: `${(l.i / n) * 100}%` }}>
            {l.s}
          </span>
        ))}
        {frames.map((f, i) => (
          <span
            key={f.seq}
            className={`scrub-tick ${tickKind(f)} ${i <= index ? 'past' : ''}`}
            style={{ left: `${((i + 0.5) / n) * 100}%` }}
            title={`${i + 1}. ${f.title}`}
          />
        ))}
        <span className="scrub-fill" style={{ width: `${((index + 1) / n) * 100}%` }} />
        <span className="scrub-head" style={{ left: `${((index + 0.5) / n) * 100}%` }} />
        {running && <span className="scrub-more">…</span>}
      </div>
    </div>
  );
}
