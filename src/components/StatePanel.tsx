import { useEffect, useState } from 'react';
import { pyRepr } from '../engine/pyrepr';
import type { ChannelSpec, DiffEntry, Frame, PendingWrite, ReducerKind, StateValues } from '../engine/types';
import { DiffView, ValueView } from './ValueView';

export const REDUCER_LABEL: Record<ReducerKind, string> = {
  overwrite: '덮어쓰기',
  add: 'operator.add',
  add_messages: 'add_messages',
};

interface Props {
  frame: Frame;
  channels: ChannelSpec[];
  /** 지금 수정이 허용되는지 (최신 프레임 + editable) */
  canEdit: boolean;
  onEdit: (patch: StateValues) => void;
}

export function StatePanel({ frame, channels, canEdit, onEdit }: Props) {
  const editable = canEdit ? (frame.editable ?? []) : [];
  const cp = frame.history.find((c) => c.id === frame.checkpointId);
  return (
    <section className="panel state-panel">
      <header className="panel-head">
        <h2>State</h2>
        <span className="panel-meta">
          {frame.threadId !== null && <>thread {frame.threadId}</>}
          {cp && <> · checkpoint #{cp.seq}</>}
          {frame.threadId === null && !cp && 'TypedDict'}
        </span>
      </header>

      {frame.pendingWrites.length > 0 && <PendingWrites writes={frame.pendingWrites} phase={frame.phase} />}

      <ChannelRows channels={channels} state={frame.state} changed={frame.changedKeys} diff={frame.diff} editable={editable} onEdit={onEdit} />

      {frame.sub && (
        <div className="sub-state">
          <div className="sub-head">
            <span className="eyebrow">Subgraph · {frame.sub.nodeId}</span>
            {frame.sub.superstep !== null && <span className="panel-meta">sub step {frame.sub.superstep}</span>}
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
      <div className="eyebrow">
        {phase === 'error' ? '충돌한 writes' : phase === 'interrupt' ? 'pending_writes 로 저장됨' : '대기 중인 writes · step 끝에 반영'}
      </div>
      {writes.map((w) => (
        <div key={w.taskId} className="pending-row">
          <span className="pending-node">{w.node}</span>
          <span className="pending-val">
            {pyRepr(w.update, 140)}
            {w.goto && w.goto.length > 0 && <span className="muted"> goto={pyRepr(w.goto)}</span>}
          </span>
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
    <dl className="ledger">
      {channels.map((ch) => {
        const d = diff.find((x) => x.key === ch.key);
        const isChanged = changed.includes(ch.key);
        return (
          <div key={ch.key} className={`ledger-row ${isChanged ? 'changed' : ''} ${d?.manual ? 'manual' : ''}`}>
            <dt>
              <span className="key">{ch.key}</span>
              <span className="type">{ch.pyType}</span>
              {ch.reducer !== 'overwrite' && <span className="reducer">{REDUCER_LABEL[ch.reducer]}</span>}
              {isChanged && <span className="changed-mark">{d?.manual ? '직접 수정' : '변경'}</span>}
            </dt>
            <dd>
              {isChanged && d ? <DiffView d={d} /> : <ValueView v={state[ch.key]} />}
              {isChanged && d && d.writers.length > 0 && !d.manual && (
                <div className="writers">
                  {d.writers.length > 1 ? `${d.writers.length}개 writes: ` : 'from '}
                  {d.writers.join(', ')}
                </div>
              )}
              {editable.includes(ch.key) && <Editor value={state[ch.key]} onApply={(v) => onEdit({ [ch.key]: v })} />}
            </dd>
          </div>
        );
      })}
    </dl>
  );
}

function Editor({ value, onApply }: { value: unknown; onApply: (v: unknown) => void }) {
  const kind =
    typeof value === 'number'
      ? 'number'
      : Array.isArray(value) && value.every((x) => typeof x === 'string')
        ? 'list'
        : typeof value === 'string'
          ? 'string'
          : 'json';
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
      <span className="eyebrow">값 바꿔보기</span>
      <div className="editor-row">
        {kind === 'number' ? (
          <>
            <input type="range" min={-1} max={1} step={0.05} value={Number(text)} onChange={(e) => setText(e.target.value)} />
            <span className="editor-num">{Number(text).toFixed(2)}</span>
          </>
        ) : (
          <input className="text-input" value={text} onChange={(e) => setText(e.target.value)} />
        )}
        <button
          className="btn btn-primary"
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
    </div>
  );
}
