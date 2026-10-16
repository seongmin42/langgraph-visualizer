import { useEffect, useState } from 'react';
import { pyRepr } from '../engine/pyrepr';
import type { ChannelSpec, DiffEntry, Frame, PendingWrite, ReducerKind, StateValues } from '../engine/types';
import { TreeRow, VarNode } from './ValueView';

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

/** VS Code 디버거의 VARIABLES 섹션: 스코프(State / Pending writes / Subgraph) 아래 변수 트리 */
export function StatePanel({ frame, channels, canEdit, onEdit }: Props) {
  const editable = canEdit ? (frame.editable ?? []) : [];
  const [open, setOpen] = useState({ state: true, pending: true, sub: true });
  return (
    <div className="vars">
      {frame.pendingWrites.length > 0 && (
        <>
          <TreeRow
            depth={0}
            name={<span className="scope">{frame.phase === 'error' ? 'Conflicting writes' : frame.phase === 'interrupt' ? 'pending_writes' : 'Pending writes'}</span>}
            hint="super-step 끝에 반영"
            open={open.pending}
            onToggle={() => setOpen({ ...open, pending: !open.pending })}
          />
          {open.pending && <Pending writes={frame.pendingWrites} />}
        </>
      )}

      <TreeRow
        depth={0}
        name={<span className="scope">State</span>}
        hint="TypedDict"
        open={open.state}
        onToggle={() => setOpen({ ...open, state: !open.state })}
      />
      {open.state && (
        <Channels channels={channels} state={frame.state} changed={frame.changedKeys} diff={frame.diff} editable={editable} onEdit={onEdit} />
      )}

      {frame.sub && (
        <>
          <TreeRow
            depth={0}
            name={<span className="scope">Subgraph: {frame.sub.nodeId}</span>}
            hint={frame.sub.superstep !== null ? `sub step ${frame.sub.superstep}` : undefined}
            open={open.sub}
            onToggle={() => setOpen({ ...open, sub: !open.sub })}
          />
          {open.sub && (
            <>
              {frame.sub.pendingWrites.length > 0 && <Pending writes={frame.sub.pendingWrites} />}
              <Channels channels={frame.sub.channels} state={frame.sub.state} changed={frame.sub.changedKeys} diff={frame.sub.diff} editable={[]} onEdit={() => {}} />
            </>
          )}
        </>
      )}
    </div>
  );
}

function Pending({ writes }: { writes: PendingWrite[] }) {
  return (
    <>
      {writes.map((w) => (
        <TreeRow
          key={w.taskId}
          depth={1}
          name={w.node}
          value={<span className="v-value">{pyRepr(w.update, 90)}</span>}
          hint={w.goto && w.goto.length > 0 ? `goto=${pyRepr(w.goto)}` : undefined}
          title={pyRepr(w.update)}
        />
      ))}
    </>
  );
}

export function Channels({
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
    <>
      {channels.map((ch) => {
        const d = diff.find((x) => x.key === ch.key);
        const isChanged = changed.includes(ch.key);
        return (
          <div key={ch.key}>
            <VarNode
              depth={1}
              name={ch.key}
              value={state[ch.key]}
              diff={isChanged ? d : undefined}
              mark={isChanged ? (d?.manual ? 'manual' : 'changed') : undefined}
              hint={ch.reducer !== 'overwrite' ? REDUCER_LABEL[ch.reducer] : undefined}
              title={`${ch.key}: ${ch.pyType}${isChanged && d && !d.manual ? `\nwrites: ${d.writers.join(', ')}` : ''}`}
            />
            {editable.includes(ch.key) && <Editor value={state[ch.key]} onApply={(v) => onEdit({ [ch.key]: v })} />}
          </div>
        );
      })}
    </>
  );
}

/** Variables 뷰의 "Set Value" 처럼 값을 직접 바꾸는 입력 */
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

  const apply = () => {
    try {
      onApply(kind === 'number' ? Number(text) : kind === 'list' ? text.split(',').map((s) => s.trim()).filter(Boolean) : kind === 'string' ? text : JSON.parse(text));
    } catch {
      alert('값을 해석할 수 없습니다');
    }
  };

  return (
    <div className="set-value">
      <div className="set-value-label">Set Value — 값을 바꾸고 Enter (router 가 바뀐 값으로 판단)</div>
      <div className="set-value-row">
        {kind === 'number' && (
          <input type="range" min={-1} max={1} step={0.05} value={Number(text)} onChange={(e) => setText(e.target.value)} aria-label="값" />
        )}
        <input
          className="input"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && apply()}
          aria-label="새 값"
        />
        <button className="button" onClick={apply}>
          적용
        </button>
      </div>
    </div>
  );
}
