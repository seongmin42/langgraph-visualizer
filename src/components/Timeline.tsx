import { pyRepr } from '../engine/pyrepr';
import type { Checkpoint } from '../engine/types';

interface Props {
  history: Checkpoint[];
  headId: string | null;
  selectedId?: string | null;
  onSelect?: (cp: Checkpoint) => void;
  /** 새로 추가된 체크포인트 강조 */
  emptyText?: string;
}

/** thread 의 체크포인트 히스토리를 부모-자식 트리(분기 포함)로 그린다 */
export function Timeline({ history, headId, selectedId, onSelect, emptyText }: Props) {
  if (!history.length) return <div className="muted timeline-empty">{emptyText ?? '아직 저장된 checkpoint 가 없습니다'}</div>;
  const ids = new Set(history.map((c) => c.id));
  const children = new Map<string | null, Checkpoint[]>();
  for (const cp of history) {
    const p = cp.parentId && ids.has(cp.parentId) ? cp.parentId : null;
    if (!children.has(p)) children.set(p, []);
    children.get(p)!.push(cp);
  }
  const forks = history.filter((c) => (children.get(c.id)?.length ?? 0) > 1).length;

  const renderChain = (start: Checkpoint, depth: number, branchIdx: number): React.ReactNode => {
    const rows: React.ReactNode[] = [];
    let cur: Checkpoint | undefined = start;
    while (cur) {
      const kids: Checkpoint[] = children.get(cur.id) ?? [];
      rows.push(<Row key={cur.id} cp={cur} head={cur.id === headId} selected={cur.id === selectedId} onSelect={onSelect} />);
      if (kids.length === 1) cur = kids[0];
      else {
        if (kids.length > 1) {
          rows.push(
            <div key={`${cur.id}-forks`} className="tl-forks">
              {kids.map((k, i) => (
                <div key={k.id} className={`tl-branch ${i > 0 ? 'tl-branch-fork' : ''}`}>
                  <div className="tl-branch-label">{i === 0 ? '원래 분기' : `fork #${i}`}</div>
                  {renderChain(k, depth + 1, i)}
                </div>
              ))}
            </div>,
          );
        }
        cur = undefined;
      }
    }
    return (
      <div className="tl-chain" data-depth={depth} data-branch={branchIdx}>
        {rows}
      </div>
    );
  };

  return (
    <div className="timeline">
      <div className="tl-summary muted">
        checkpoint {history.length}개{forks > 0 ? ` · 분기점 ${forks}곳` : ''}
      </div>
      {(children.get(null) ?? []).map((root, i) => (
        <div key={root.id}>{renderChain(root, 0, i)}</div>
      ))}
    </div>
  );
}

function Row({
  cp,
  head,
  selected,
  onSelect,
}: {
  cp: Checkpoint;
  head: boolean;
  selected: boolean;
  onSelect?: (cp: Checkpoint) => void;
}) {
  const writers = cp.writes ? Object.keys(cp.writes) : [];
  const interrupted = cp.interrupts && cp.interrupts.length > 0;
  return (
    <button
      className={`tl-row ${head ? 'head' : ''} ${selected ? 'selected' : ''} src-${cp.source}`}
      onClick={() => onSelect?.(cp)}
      disabled={!onSelect}
      title={pyRepr(cp.values)}
    >
      <span className="tl-dot" />
      <span className="tl-id mono">#{cp.seq}</span>
      <span className="tl-step mono">step {cp.step}</span>
      <span className={`tl-src src-${cp.source}`}>{cp.source}</span>
      <span className="tl-writes">
        {writers.length ? writers.map((w) => (w === '__start__' ? 'START' : w)).join(', ') : '—'}
      </span>
      <span className="tl-next mono">
        {interrupted ? '⏸ ' : ''}next: {cp.next.length ? cp.next.map((t) => t.node).join(', ') : '()'}
      </span>
      {head && <span className="tl-head">현재</span>}
    </button>
  );
}
