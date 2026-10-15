import type { PlayerSnapshot } from '../player';

interface Props {
  snap: PlayerSnapshot;
  onPlay: () => void;
  onStep: () => void;
  onBack: () => void;
  onReset: () => void;
  onSpeed: (s: number) => void;
}

const SPEEDS = [0.5, 1, 2, 4];

export function Controls({ snap, onPlay, onStep, onBack, onReset, onSpeed }: Props) {
  return (
    <div className="controls">
      <button className="btn" onClick={onReset} title="처음부터 (그래프/체크포인트 초기화)">
        ⟲
      </button>
      <button className="btn" onClick={onBack} disabled={!snap.canBack} title="이전 프레임 (←)">
        ◀
      </button>
      <button className="btn btn-play" onClick={onPlay} title="재생 / 일시정지 (Space)">
        {snap.playing ? '⏸ 일시정지' : '▶ 재생'}
      </button>
      <button className="btn" onClick={onStep} title="한 스텝 진행 (→)">
        ▶| step
      </button>
      <div className="speed">
        {SPEEDS.map((s) => (
          <button key={s} className={`btn btn-small ${snap.speed === s ? 'on' : ''}`} onClick={() => onSpeed(s)}>
            {s}×
          </button>
        ))}
      </div>
      <span className="frame-counter mono">
        {snap.index + 1} / {snap.frames.length}
        {snap.running ? ' +' : ''}
      </span>
    </div>
  );
}
