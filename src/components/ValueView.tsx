import { useState, type ReactNode } from 'react';
import { isMessage, pyRepr } from '../engine/pyrepr';
import type { DiffEntry, Message } from '../engine/types';

/** VS Code Variables 뷰처럼 값의 타입에 따라 색을 다르게 */
export function Val({ v, max = 120 }: { v: unknown; max?: number }) {
  if (v === undefined) return <span className="v-undef">&lt;설정되지 않음&gt;</span>;
  const cls =
    typeof v === 'string'
      ? 'v-string'
      : typeof v === 'number'
        ? 'v-number'
        : typeof v === 'boolean' || v === null
          ? 'v-boolean'
          : 'v-value';
  return <span className={cls}>{pyRepr(v, max)}</span>;
}

const MSG_CLASS: Record<Message['type'], string> = { human: 'HumanMessage', ai: 'AIMessage', system: 'SystemMessage', tool: 'ToolMessage' };

export function MsgVal({ m }: { m: Message }) {
  return (
    <span className="v-value">
      <span className="v-type">{MSG_CLASS[m.type]}</span>(<span className="v-string">{pyRepr(m.content)}</span>, id=
      <span className="v-string">'{m.id}'</span>)
    </span>
  );
}

interface RowProps {
  depth: number;
  name: ReactNode;
  value?: ReactNode;
  hint?: ReactNode;
  mark?: 'changed' | 'added' | 'removed' | 'manual';
  open?: boolean;
  onToggle?: () => void;
  title?: string;
}

/** 트리 한 줄: 들여쓰기 + 펼침 화살표 + 이름: 값 */
export function TreeRow({ depth, name, value, hint, mark, open, onToggle, title }: RowProps) {
  return (
    <div
      className={`tree-row ${mark ? `mark-${mark}` : ''} ${onToggle ? 'expandable' : ''}`}
      style={{ paddingLeft: 8 + depth * 12 }}
      onClick={onToggle}
      title={title}
    >
      <span className="twistie">{onToggle && <i className={`codicon codicon-chevron-${open ? 'down' : 'right'}`} />}</span>
      <span className="v-name">{name}</span>
      {value !== undefined && <span className="v-sep">: </span>}
      {value !== undefined && <span className="v-val">{value}</span>}
      {hint && <span className="v-hint">{hint}</span>}
    </div>
  );
}

function childrenOf(v: unknown): unknown[] | null {
  return Array.isArray(v) && v.length > 0 ? v : null;
}

/** 값이 리스트면 펼쳐서 원소를 보여준다 */
export function VarNode({
  depth,
  name,
  value,
  hint,
  mark,
  diff,
  title,
}: {
  depth: number;
  name: ReactNode;
  value: unknown;
  hint?: ReactNode;
  mark?: RowProps['mark'];
  diff?: DiffEntry;
  title?: string;
}) {
  const kids = childrenOf(value);
  const [open, setOpen] = useState(true);
  const summary = kids ? <span className="v-value">{kids.every(isMessage) ? `list[${kids.length}]` : `len() = ${kids.length}`}</span> : <Val v={value} />;
  const rows: ReactNode[] = [];
  if (kids && open) {
    const before = diff && Array.isArray(diff.before) ? (diff.before as unknown[]) : [];
    const seen = new Set<string>();
    kids.forEach((k, i) => {
      let m: RowProps['mark'];
      let extra: ReactNode = null;
      if (diff && isMessage(k)) {
        const prev = (before as Message[]).find((p) => isMessage(p) && p.id === k.id);
        if (diff.reducer === 'add_messages') {
          if (!prev) m = 'added';
          else if (prev.content !== k.content) {
            m = 'changed';
            extra = <TreeRow key={`was-${i}`} depth={depth + 2} name="이전" value={<span className="v-old">{pyRepr(prev.content)}</span>} />;
          }
        } else if (diff.reducer === 'add' && i >= before.length) {
          m = seen.has(k.id) ? 'removed' : 'added';
        }
        seen.add(k.id);
      } else if (diff && diff.reducer === 'add' && i >= before.length) {
        m = 'added';
      } else if (diff?.reducer === 'overwrite') {
        m = undefined;
      }
      if (isMessage(k)) seen.add(k.id);
      rows.push(
        <TreeRow
          key={i}
          depth={depth + 1}
          name={String(i)}
          value={isMessage(k) ? <MsgVal m={k} /> : <Val v={k} />}
          mark={m}
          hint={m === 'removed' ? 'id 중복' : m === 'changed' ? 'id 같음 → 교체' : undefined}
        />,
      );
      if (extra) rows.push(extra);
    });
  }
  const showOld = diff && (diff.reducer === 'overwrite' || diff.manual) && diff.before !== undefined;
  return (
    <>
      <TreeRow depth={depth} name={name} value={summary} hint={hint} mark={mark} open={open} onToggle={kids ? () => setOpen((x) => !x) : undefined} title={title} />
      {rows}
      {showOld && (
        <TreeRow
          depth={depth + 1}
          name="이전 값"
          value={
            <span className="v-old">
              {Array.isArray(diff!.before) && (diff!.before as unknown[]).every(isMessage)
                ? `[${(diff!.before as Message[]).map((m) => `${MSG_CLASS[m.type]}(id='${m.id}')`).join(', ')}]`
                : pyRepr(diff!.before, 100)}
            </span>
          }
        />
      )}
    </>
  );
}
