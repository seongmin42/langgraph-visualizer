import { isMessage, pyRepr } from '../engine/pyrepr';
import type { DiffEntry, Message } from '../engine/types';

const ROLE: Record<Message['type'], string> = { human: 'human', ai: 'ai', system: 'system', tool: 'tool' };

type Mark = 'new' | 'replaced' | 'dup';
const GUTTER: Record<Mark, string> = { new: '+', replaced: '~', dup: '!' };

/** 메시지 한 줄: 대화 로그처럼 역할 / id / 내용 */
export function MessageRow({ m, mark, was }: { m: Message; mark?: Mark; was?: string }) {
  return (
    <div className={`msg ${mark ? `msg-${mark}` : ''}`}>
      <span className="msg-gutter">{mark ? GUTTER[mark] : ''}</span>
      <span className={`msg-role role-${m.type}`}>{ROLE[m.type]}</span>
      <span className="msg-body">
        {was !== undefined && <span className="msg-was">{was}</span>}
        {m.content}
      </span>
      <span className="msg-id">#{m.id}</span>
      {mark === 'dup' && <span className="msg-note">id 중복</span>}
      {mark === 'replaced' && <span className="msg-note">교체</span>}
    </div>
  );
}

export function ValueView({ v }: { v: unknown }) {
  if (v === undefined) return <span className="v-unset">설정되지 않음</span>;
  if (Array.isArray(v)) {
    if (v.length === 0) return <span className="v-mono">[]</span>;
    if (v.every(isMessage)) {
      return (
        <div className="v-msgs">
          {(v as Message[]).map((m, i) => (
            <MessageRow key={`${m.id}-${i}`} m={m} />
          ))}
        </div>
      );
    }
    if (v.every((x) => typeof x === 'string' || typeof x === 'number')) {
      return (
        <ol className="v-list">
          {v.map((x, i) => (
            <li key={i}>
              <span className="v-idx">{i}</span>
              {pyRepr(x)}
            </li>
          ))}
        </ol>
      );
    }
  }
  if (typeof v === 'string') return <span className="v-str">{pyRepr(v)}</span>;
  return <span className="v-mono">{pyRepr(v)}</span>;
}

/** 이전 값 → 새 값. git diff 처럼 - / + 줄로 보여준다. reducer 종류에 따라 표현이 다르다 */
export function DiffView({ d }: { d: DiffEntry }) {
  const before = d.before;
  const after = d.after;

  if (d.reducer === 'add_messages' && Array.isArray(after)) {
    const old = (Array.isArray(before) ? before : []) as Message[];
    return (
      <div className="v-msgs">
        {(after as Message[]).map((m, i) => {
          const prev = old.find((o) => o.id === m.id);
          const mark: Mark | undefined = !prev ? 'new' : prev.content !== m.content ? 'replaced' : undefined;
          return <MessageRow key={`${m.id}-${i}`} m={m} mark={mark} was={mark === 'replaced' ? prev!.content : undefined} />;
        })}
      </div>
    );
  }

  if (d.reducer === 'add' && Array.isArray(after)) {
    const n = Array.isArray(before) ? before.length : 0;
    if (after.every(isMessage)) {
      const seen = new Set<string>();
      return (
        <div className="v-msgs">
          {(after as Message[]).map((m, i) => {
            const dup = seen.has(m.id);
            seen.add(m.id);
            return <MessageRow key={i} m={m} mark={i >= n ? (dup ? 'dup' : 'new') : undefined} />;
          })}
        </div>
      );
    }
    return (
      <ol className="v-list">
        {after.map((x, i) => (
          <li key={i} className={i >= n ? 'added' : ''}>
            <span className="v-idx">{i >= n ? '+' : i}</span>
            {pyRepr(x)}
          </li>
        ))}
      </ol>
    );
  }

  return (
    <div className="diff">
      <div className="diff-line del">
        <span className="diff-sign">−</span>
        <span>{before === undefined ? '설정되지 않음' : <DiffInline v={before} />}</span>
      </div>
      <div className="diff-line add">
        <span className="diff-sign">+</span>
        <span>
          <DiffInline v={after} />
        </span>
      </div>
    </div>
  );
}

function DiffInline({ v }: { v: unknown }) {
  if (Array.isArray(v) && v.length && v.every(isMessage)) {
    return (
      <span className="v-msgs inline">
        {(v as Message[]).map((m, i) => (
          <MessageRow key={i} m={m} />
        ))}
      </span>
    );
  }
  return <>{pyRepr(v)}</>;
}
