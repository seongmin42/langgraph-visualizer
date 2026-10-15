import { useEffect, useState } from 'react';
import { pyRepr } from '../engine/pyrepr';
import type { ChannelSpec, DiffEntry, Frame, PendingWrite, ReducerKind, StateValues } from '../engine/types';
import { DiffView, ValueView } from './ValueView';

export const REDUCER_LABEL: Record<ReducerKind, string> = {
  overwrite: 'reducer 없음 · 덮어쓰기',
  add: 'operator.add · 이어붙이기',
  add_messages: 'add_messages · id 병합',
};

interface Props {
  frame: Frame;
  channels: ChannelSpec[];
  /** 지금 수정이 허용되는지 (최신 프레임 + editable) */
  canEdit: boolean;
  onEdit: (patch: StateValues) => void;
  title?: string;
}

export function StatePanel({ frame, channels, canEdit, onEdit, title }: Props) {
  const editable = canEdit ? (frame.editable ?? []) : [];
  const cp = frame.history.find((c) => c.id === frame.checkpointId);
  return (
    <section className="panel state-panel">
      <header className="panel-head">
        <h2>{title ?? 'State'}</h2>
        <span className="muted mono">TypedDict</span>
        {frame.threadId !== null && <span className="badge badge-thread">thread_id='{frame.threadId}'</span>}
        {cp && <span className="badge">checkpoint #{cp.seq}</span>}
      </header>

      {frame.pendingWrites.length > 0 && <PendingWrites writes={frame.pendingWrites} phase={frame.phase} />}

      <ChannelRows
        channels={channels}
        state={frame.state}
        changed={frame.changedKeys}
        diff={frame.diff}
        editable={editable}
        onEdit={onEdit}
      />

      {frame.sub && (
        <div className="sub-state">
          <div className="sub-state-head">
            서브그래프 <b>{frame.sub.nodeId}</b> 내부 State
            {frame.sub.superstep !== null && <span className="badge">sub step {frame.sub.superstep}</span>}
          </div>
          {frame.sub.pendingWrites.length > 0 && <PendingWrites writes={frame.sub.pendingWrites} phase="write" />}
          <ChannelRows
            channels={frame.sub.channels}
            state={frame.sub.state}
            changed={frame.sub.changedKeys}
            diff={frame.sub.diff}
            editable={[]}
            onEdit={() => {}}
          />
        </div>
      )}
    </section>
  );
}

function PendingWrites({ writes, phase }: { writes: PendingWrite[]; phase: Frame['phase'] }) {
  return (
    <div className="pending">
      <div className="pending-head">
        {phase === 'error'
          ? '충돌한 writes'
          : phase === 'interrupt'
            ? '이미 끝난 태스크의 writes (pending_writes 로 저장)'
            : '대기 중인 writes — super-step 끝에 한꺼번에 반영'}
      </div>
      {writes.map((w) => (
        <div key={w.taskId} className="pending-row">
          <span className="pending-node">{w.node}</span>
          <span className="mono">→ {pyRepr(w.update, 120)}</span>
          {w.goto && w.goto.length > 0 && <span className="mono muted"> goto={pyRepr(w.goto)}</span>}
        </div>
      ))}
    </div>
  );
}

export function ChannelRows({
  channels,
  state,
  changed,
  diff,
  editable,
  onEdit,
}: {
  channels: ChannelSpec[];
  state: StateValues;
  changed: string[];
  diff: DiffEntry[];
  editable: string[];
  onEdit: (patch: StateValues) => void;
}) {
  return (
    <div className="channels">
      {channels.map((ch) => {
        const d = diff.find((x) => x.key === ch.key);
        const isChanged = changed.includes(ch.key);
        return (
          <div key={ch.key} className={`channel ${isChanged ? 'changed' : ''} ${d?.manual ? 'manual' : ''}`}>
            <div className="channel-head">
              <span className="channel-key">{ch.key}</span>
              <span className="channel-type">{ch.pyType}</span>
              <span className={`reducer reducer-${ch.reducer}`}>{REDUCER_LABEL[ch.reducer]}</span>
              {isChanged && <span className="changed-tag">{d?.manual ? '수동 수정' : '변경됨'}</span>}
            </div>
            <div className="channel-val">{isChanged && d ? <DiffView d={d} /> : <ValueView v={state[ch.key]} />}</div>
            {isChanged && d && d.writers.length > 0 && !d.manual && (
              <div className="channel-writers">
                writes: {d.writers.map((w, i) => (
                  <span key={i} className="mono">
                    {i > 0 && ', '}
                    {w}→{pyRepr(d.written[i], 40)}
                  </span>
                ))}
              </div>
            )}
            {editable.includes(ch.key) && <Editor value={state[ch.key]} onApply={(v) => onEdit({ [ch.key]: v })} />}
          </div>
        );
      })}
    </div>
  );
}

function Editor({ value, onApply }: { value: unknown; onApply: (v: unknown) => void }) {
  const kind = typeof value === 'number' ? 'number' : Array.isArray(value) && value.every((x) => typeof x === 'string') ? 'list' : typeof value === 'string' ? 'string' : 'json';
  const toText = (v: unknown) => (kind === 'list' ? (v as string[]).join(', ') : kind === 'json' ? JSON.stringify(v) : String(v ?? ''));
  const [text, setText] = useState(toText(value));
  useEffect(() => setText(toText(value)), [value]); // eslint-disable-line react-hooks/exhaustive-deps

  const parse = (): unknown => {
    if (kind === 'number') return Number(text);
    if (kind === 'list') return text.split(',').map((s) => s.trim()).filter(Boolean);
    if (kind === 'string') return text;
    return JSON.parse(text);
  };

  return (
    <div className="editor">
      <span className="editor-label">✎ 값 바꿔보기</span>
      {kind === 'number' ? (
        <>
          <input type="range" min={-1} max={1} step={0.05} value={Number(text)} onChange={(e) => setText(e.target.value)} />
          <span className="mono editor-num">{Number(text).toFixed(2)}</span>
        </>
      ) : (
        <input className="editor-text" value={text} onChange={(e) => setText(e.target.value)} />
      )}
      <button
        className="btn btn-small btn-accent"
        onClick={() => {
          try {
            onApply(parse());
          } catch {
            alert('값을 해석할 수 없습니다');
          }
        }}
      >
        적용
      </button>
    </div>
  );
}
