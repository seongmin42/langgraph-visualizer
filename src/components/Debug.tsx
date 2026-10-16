import type { Frame } from '../engine/types';
import type { PlayerSnapshot } from '../player';
import { phaseLabel } from './GraphView';

interface ToolbarProps {
  snap: PlayerSnapshot;
  onPlay: () => void;
  onStep: () => void;
  onBack: () => void;
  onReset: () => void;
}

/** VS Code 의 떠 있는 디버그 툴바 (Continue / Step Over / Step Back / Restart) */
export function DebugToolbar({ snap, onPlay, onStep, onBack, onReset }: ToolbarProps) {
  return (
    <div className="debug-toolbar" role="toolbar" aria-label="실행 제어">
      <span className="dt-grip codicon codicon-gripper" aria-hidden="true" />
      <button className="dt-btn continue" onClick={onPlay} title={snap.playing ? '일시정지 (F5 / Space)' : '계속 실행 (F5 / Space)'} aria-label={snap.playing ? '일시정지' : '계속 실행'}>
        <i className={`codicon ${snap.playing ? 'codicon-debug-pause' : 'codicon-debug-continue'}`} />
      </button>
      <button className="dt-btn step" onClick={onStep} title="한 스텝 진행 (F10 / →)" aria-label="한 스텝 진행">
        <i className="codicon codicon-debug-step-over" />
      </button>
      <button className="dt-btn step" onClick={onBack} disabled={!snap.canBack} title="이전 스텝 (Shift+F10 / ←)" aria-label="이전 스텝">
        <i className="codicon codicon-debug-step-back" />
      </button>
      <button className="dt-btn restart" onClick={onReset} title="처음부터 다시 (Ctrl+Shift+F5)" aria-label="처음부터 다시">
        <i className="codicon codicon-debug-restart" />
      </button>
    </div>
  );
}

/** Python Tutor 처럼 코드 아래에서 실행 기록을 앞뒤로 훑는 슬라이더 */
export function StepSlider({ snap, onSeek }: { snap: PlayerSnapshot; onSeek: (i: number) => void }) {
  const n = snap.frames.length;
  return (
    <div className="step-slider">
      <button className="link-btn" onClick={() => onSeek(0)} disabled={!snap.canBack}>
        &lt;&lt; 처음
      </button>
      <button className="link-btn" onClick={() => onSeek(snap.index - 1)} disabled={!snap.canBack}>
        &lt; 이전
      </button>
      <input
        type="range"
        min={0}
        max={Math.max(0, n - 1)}
        value={snap.index}
        onChange={(e) => onSeek(Number(e.target.value))}
        aria-label="실행 기록 위치"
      />
      <button className="link-btn" onClick={() => onSeek(snap.index + 1)} disabled={snap.atHead}>
        다음 &gt;
      </button>
      <button className="link-btn" onClick={() => onSeek(n - 1)} disabled={snap.atHead}>
        마지막 &gt;&gt;
      </button>
      <span className="step-count">
        Step {snap.index + 1} of {n}
        {snap.running ? '+' : ''}
      </span>
    </div>
  );
}

interface StatusProps {
  snap: PlayerSnapshot;
  frame: Frame;
  file: string;
  variant?: string;
  onSpeed: () => void;
}

const DEBUGGING: Frame['phase'][] = ['input', 'run', 'write', 'apply', 'route-pending', 'route', 'checkpoint', 'interrupt', 'resume', 'update', 'restore', 'sub-enter', 'sub-exit', 'error'];

/** 디버깅 중에는 색이 바뀌는 VS Code 상태 표시줄 */
export function StatusBar({ snap, frame, file, variant, onSpeed }: StatusProps) {
  const debugging = DEBUGGING.includes(frame.phase) || snap.running;
  return (
    <footer className={`statusbar ${debugging ? 'debugging' : ''}`}>
      <div className="sb-left">
        <span className="sb-item">
          <i className="codicon codicon-debug-alt-small" />
          {file}
          {variant ? ` (${variant})` : ''}
        </span>
        {snap.playing && (
          <span className="sb-item">
            <i className="codicon codicon-sync codicon-modifier-spin" /> 실행 중
          </span>
        )}
        <span className="sb-item">super-step {frame.superstep ?? '-'}</span>
        <span className="sb-item">{phaseLabel(frame.phase)}</span>
      </div>
      <div className="sb-right">
        {frame.threadId !== null && <span className="sb-item">thread_id: {frame.threadId}</span>}
        <button className="sb-item sb-btn" onClick={onSpeed} title="재생 속도 바꾸기">
          속도 {snap.speed}×
        </button>
        <span className="sb-item">Python 3.12</span>
        <span className="sb-item">langgraph (mock)</span>
      </div>
    </footer>
  );
}
