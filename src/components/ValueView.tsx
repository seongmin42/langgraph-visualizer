import { isMessage, pyRepr } from '../engine/pyrepr';
import type { DiffEntry, Message } from '../engine/types';

const ROLE: Record<Message['type'], string> = { human: 'Human', ai: 'AI', system: 'System', tool: 'Tool' };

export function MessageBubble({ m, mark }: { m: Message; mark?: 'new' | 'replaced' | 'dup' | 'old' }) {
  return (
    <div className={`msg msg-${m.type} ${mark ? `msg-${mark}` : ''}`}>
      <div className="msg-head">
        <span className="msg-role">{ROLE[m.type]}</span>
        <span className="msg-id">id={m.id}</span>
        {mark === 'new' && <span className="msg-tag tag-new">+ 추가</span>}
        {mark === 'replaced' && <span className="msg-tag tag-rep">↻ 교체</span>}
        {mark === 'dup' && <span className="msg-tag tag-dup">중복 id</span>}
      </div>
      <div className="msg-body">{m.content}</div>
    </div>
  );
}

export function ValueView({ v, compact }: { v: unknown; compact?: boolean }) {
  if (v === undefined) return <span className="v-unset">(아직 없음)</span>;
  if (Array.isArray(v)) {
    if (v.length === 0) return <span className="v-mono">[]</span>;
    if (v.every(isMessage)) {
      return (
        <div className="v-msgs">
          {(v as Message[]).map((m, i) => (
            <MessageBubble key={`${m.id}-${i}`} m={m} />
          ))}
        </div>
      );
    }
    if (!compact && v.every((x) => typeof x === 'string' || typeof x === 'number')) {
      return (
        <div className="v-chips">
          {v.map((x, i) => (
            <span key={i} className="chip">
              {pyRepr(x)}
            </span>
          ))}
        </div>
      );
    }
  }
  if (typeof v === 'string') return <span className="v-str">{pyRepr(v)}</span>;
  return <span className="v-mono">{pyRepr(v)}</span>;
}

/** 이전 값 → 새 값 diff. reducer 종류에 따라 보여주는 방식이 다르다 */
export function DiffView({ d }: { d: DiffEntry }) {
  const before = d.before;
  const after = d.after;

  if (d.reducer === 'add_messages' && Array.isArray(after)) {
    const old = (Array.isArray(before) ? before : []) as Message[];
    return (
      <div className="v-msgs">
        {(after as Message[]).map((m, i) => {
          const prev = old.find((o) => o.id === m.id);
          const mark = !prev ? 'new' : prev.content !== m.content ? 'replaced' : undefined;
          return (
            <div key={`${m.id}-${i}`}>
              {mark === 'replaced' && <div className="msg-was">이전: {prev!.content}</div>}
              <MessageBubble m={m} mark={mark} />
            </div>
          );
        })}
      </div>
    );
  }

  if (d.reducer === 'add' && Array.isArray(after)) {
    const n = Array.isArray(before) ? before.length : 0;
    const allMsgs = after.every(isMessage);
    if (allMsgs) {
      const seen = new Set<string>();
      return (
        <div className="v-msgs">
          {(after as Message[]).map((m, i) => {
            const dup = seen.has(m.id);
            seen.add(m.id);
            return <MessageBubble key={i} m={m} mark={i >= n ? (dup ? 'dup' : 'new') : undefined} />;
          })}
        </div>
      );
    }
    return (
      <div className="v-chips">
        {after.map((x, i) => (
          <span key={i} className={`chip ${i >= n ? 'chip-new' : ''}`}>
            {i >= n && '+ '}
            {pyRepr(x)}
          </span>
        ))}
      </div>
    );
  }

  return (
    <div className="diff-ow">
      <div className="diff-before">
        <ValueView v={before} compact />
      </div>
      <div className="diff-arrow">↓</div>
      <div className="diff-after">
        <ValueView v={after} />
      </div>
    </div>
  );
}
