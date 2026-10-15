import { useEffect, useMemo, useRef } from 'react';
import { pyRepr } from '../engine/pyrepr';
import { END, HUB, type Frame, type Packet, type StateValues } from '../engine/types';
import {
  buildScene,
  HUB_HEAD,
  HUB_ROW,
  packetPath,
  pointAt,
  segPath,
  type Seg,
  type VEdge,
  type VNode,
} from '../geometry';
import type { Built } from '../scenarios/types';

const PHASE_LABEL: Record<Frame['phase'], string> = {
  idle: '대기',
  input: '입력',
  run: '노드 실행',
  write: 'update 반환',
  apply: 'reducer 적용',
  'route-pending': 'router 대기',
  route: '라우팅',
  checkpoint: '체크포인트',
  interrupt: 'interrupt',
  resume: '재개',
  update: 'state 수정',
  restore: '복원',
  'sub-enter': '서브 진입',
  'sub-exit': '서브 종료',
  end: '완료',
  error: '에러',
};

export function phaseLabel(p: Frame['phase']) {
  return PHASE_LABEL[p];
}

interface Props {
  built: Built;
  frame: Frame;
  interval: number;
}

export function GraphView({ built, frame, interval }: Props) {
  const scene = useMemo(() => buildScene(built.graph, built.layout), [built]);
  const vb = useMemo(() => sceneBounds(scene, built), [scene, built]);
  const duration = Math.max(450, Math.min(1100, interval * 0.62));

  const routerActive = frame.router?.routerId;
  const sendGroups = useMemo(() => {
    const groups = new Map<string, { arg?: StateValues }[]>();
    for (const t of frame.tasks) {
      if (!t.push) continue;
      if (!groups.has(t.node)) groups.set(t.node, []);
      groups.get(t.node)!.push({ arg: t.arg });
    }
    return groups;
  }, [frame.tasks]);

  const hubHighlights = (hubId: string) => {
    const read = new Set<string>();
    const write = new Set<string>();
    for (const p of frame.packets) {
      if (p.kind === 'read' && p.from === hubId) p.keys?.forEach((k) => read.add(k));
      if (p.kind === 'write' && p.to === hubId) p.keys?.forEach((k) => write.add(k));
    }
    const changed = new Set(hubId !== HUB ? (frame.sub?.changedKeys ?? []) : frame.changedKeys);
    return { read, write, changed };
  };

  const hubValues = (hubId: string): StateValues => {
    if (hubId === HUB) return frame.state;
    const owner = hubId.slice(0, -(HUB.length + 1));
    return frame.sub?.nodeId === owner ? frame.sub.state : {};
  };

  return (
    <svg className="graph-svg" viewBox={vb} preserveAspectRatio="xMidYMid meet" role="img" aria-label="그래프">
      <defs>
        {(['base', 'active', 'cond', 'cmd', 'dim'] as const).map((k) => (
          <marker key={k} id={`arrow-${k}`} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
            <path d="M0,1 L9,5 L0,9 z" className={`arrowhead arrowhead-${k}`} />
          </marker>
        ))}
      </defs>

      {scene.nodes
        .filter((n) => n.kind === 'container')
        .map((n) => (
          <ContainerNode key={n.id} n={n} frame={frame} />
        ))}

      {scene.edges.map((e) => (
        <EdgeView key={e.id} e={e} frame={frame} routerActive={routerActive} />
      ))}

      {scene.nodes
        .filter((n) => n.kind !== 'container')
        .map((n) =>
          n.kind === 'hub' ? (
            <HubView key={n.id} n={n} values={hubValues(n.id)} hl={hubHighlights(n.id)} />
          ) : n.kind === 'router' ? (
            <RouterView key={n.id} n={n} frame={frame} />
          ) : n.kind === 'start' || n.kind === 'end' ? (
            <TerminalView key={n.id} n={n} frame={frame} />
          ) : (
            <NodeView key={n.id} n={n} frame={frame} sends={sendGroups.get(n.id)} />
          ),
        )}

      {frame.packets.map((p) => {
        const segs = packetPath(scene, p.from, p.to);
        if (!segs.length) return null;
        return <PacketView key={`${frame.seq}-${p.id}`} p={p} segs={segs} duration={duration} />;
      })}
    </svg>
  );
}

/** 고정폭 글꼴 기준 폭(한글 등 전각 문자는 약 1.7칸)에 맞춰 자른다 */
function fitWidth(text: string, units: number) {
  let used = 0;
  let out = '';
  for (const ch of text) {
    const w = /[\u1100-\u11ff\u3000-\u9fff\uac00-\ud7af\uff00-\uffef]/.test(ch) ? 1.7 : 1;
    if (used + w > units - 1) return out + '…';
    used += w;
    out += ch;
  }
  return out;
}

/** 레이아웃의 고정 크기 대신 실제 그려지는 요소의 경계로 viewBox 를 잡아 화면을 꽉 채운다 */
function sceneBounds(scene: { nodes: VNode[]; edges: VEdge[] }, built: Built) {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  const add = (x: number, y: number) => {
    x0 = Math.min(x0, x);
    y0 = Math.min(y0, y);
    x1 = Math.max(x1, x);
    y1 = Math.max(y1, y);
  };
  for (const n of scene.nodes) {
    const extraTop = n.kind === 'router' ? 26 : n.kind === 'node' ? 16 : 0;
    const extraBottom = n.kind === 'start' || n.kind === 'end' ? 22 : n.kind === 'router' ? 26 : 0;
    add(n.x - n.w / 2, n.y - n.h / 2 - extraTop);
    add(n.x + n.w / 2, n.y + n.h / 2 + extraBottom);
  }
  for (const e of scene.edges) for (const sg of e.segs) add((sg.p0.x + 2 * sg.c.x + sg.p1.x) / 4, (sg.p0.y + 2 * sg.c.y + sg.p1.y) / 4);
  for (const p of built.layout.reserve ?? []) add(p.x, p.y);
  const padX = 36;
  const top = 78; // 왼쪽 위 SUPER-STEP 표시와 겹치지 않도록
  return `${x0 - padX} ${y0 - top} ${x1 - x0 + padX * 2} ${y1 - y0 + top + 24}`;
}

function ContainerNode({ n, frame }: { n: VNode; frame: Frame }) {
  const active = frame.activeNodes.includes(n.id);
  const runs = frame.nodeRuns[n.id];
  const x0 = n.x - n.w / 2;
  const y0 = n.y - n.h / 2;
  return (
    <g className={`container ${active ? 'active' : ''}`}>
      <rect x={x0} y={y0} width={n.w} height={n.h} rx={8} />
      <text x={x0 + 14} y={y0 + 20} className="container-label">
        <tspan className="container-kind">SUBGRAPH</tspan>
        <tspan dx={8}>{n.label}</tspan>
      </text>
      {runs && (
        <text x={x0 + n.w - 12} y={y0 + 20} className="step-mark" textAnchor="end">
          s{runs.join(',')}
        </text>
      )}
    </g>
  );
}

function EdgeView({ e, frame, routerActive }: { e: VEdge; frame: Frame; routerActive?: string }) {
  const active = frame.activeEdges.includes(e.id);
  const dim = routerActive && e.router === routerActive && !frame.router?.pending && !active;
  const kind = e.kind === 'command' ? 'cmd' : e.kind.startsWith('cond') ? 'cond' : 'base';
  const marker = e.kind === 'cond-in' ? undefined : `url(#arrow-${active ? 'active' : dim ? 'dim' : kind})`;
  const mid = pointAt(e.segs, 0.5);
  return (
    <g className={`edge edge-${e.kind} ${active ? 'active' : ''} ${dim ? 'dim' : ''}`}>
      {e.segs.map((s, i) => (
        <path key={i} d={segPath(s)} markerEnd={i === e.segs.length - 1 ? marker : undefined} />
      ))}
      {e.kind === 'join' && <circle cx={e.segs[0].p1.x} cy={e.segs[0].p1.y} r={2.5} className="join-dot" />}
      {e.label && (
        <text x={mid.x} y={mid.y - 6} className="edge-label halo">
          {e.label}
        </text>
      )}
    </g>
  );
}

/** UML 상태도처럼 START 는 채운 원, END 는 이중 원 */
function TerminalView({ n, frame }: { n: VNode; frame: Frame }) {
  const active = frame.activeNodes.includes(n.id) || frame.doneNodes.includes(n.id);
  const next = frame.nextNodes.includes(n.id);
  return (
    <g className={`terminal terminal-${n.kind} ${active ? 'active' : ''} ${next ? 'next' : ''}`}>
      {n.kind === 'start' ? (
        <circle cx={n.x} cy={n.y} r={7} className="t-fill" />
      ) : (
        <>
          <circle cx={n.x} cy={n.y} r={9.5} className="t-ring" />
          <circle cx={n.x} cy={n.y} r={5} className="t-fill" />
        </>
      )}
      <text x={n.x} y={n.y + 26} className="t-label">
        {n.kind === 'start' ? 'START' : 'END'}
      </text>
    </g>
  );
}

function NodeView({ n, frame, sends }: { n: VNode; frame: Frame; sends?: { arg?: StateValues }[] }) {
  const active = frame.activeNodes.includes(n.id);
  const cls = [
    'node',
    active && 'active',
    frame.doneNodes.includes(n.id) && 'done',
    frame.nextNodes.includes(n.id) && 'next',
    frame.interruptedNodes.includes(n.id) && 'interrupted',
    frame.errorNodes.includes(n.id) && 'error',
    frame.nodeRuns[n.id] && 'ran',
  ]
    .filter(Boolean)
    .join(' ');
  const runs = frame.nodeRuns[n.id];
  const x0 = n.x - n.w / 2;
  const y0 = n.y - n.h / 2;
  return (
    <g className={cls}>
      {active && <rect className="node-halo" x={x0 - 4} y={y0 - 4} width={n.w + 8} height={n.h + 8} rx={8} />}
      <rect className="node-box" x={x0} y={y0} width={n.w} height={n.h} rx={5} />
      <text x={n.x} y={n.y + 5} className="node-label">
        {n.label}
      </text>
      {frame.interruptedNodes.includes(n.id) && (
        <text x={x0 + n.w} y={y0 - 7} className="node-flag" textAnchor="end">
          interrupt
        </text>
      )}
      {frame.errorNodes.includes(n.id) && (
        <text x={x0 + n.w} y={y0 - 7} className="node-flag err" textAnchor="end">
          error
        </text>
      )}
      {runs && !frame.interruptedNodes.includes(n.id) && !frame.errorNodes.includes(n.id) && (
        <text x={x0 + n.w} y={y0 - 7} className="step-mark" textAnchor="end">
          s{runs.join(',')}
        </text>
      )}
      {sends && sends.length > 0 && (
        <g className="send-list">
          <text x={x0 + n.w + 8} y={n.y + 4.5} className="send-count">
            ×{sends.length}
          </text>
          {sends.slice(0, 6).map((s, i) => (
            <text key={i} x={x0 + 2} y={y0 + n.h + 18 + i * 16} className="send-item">
              <tspan className="send-bullet">●</tspan> {pyRepr(s.arg, 26)}
            </text>
          ))}
        </g>
      )}
    </g>
  );
}

function RouterView({ n, frame }: { n: VNode; frame: Frame }) {
  const r = frame.router;
  const active = r?.routerId === n.id;
  const s = n.w / 2;
  const result =
    active && !r!.pending
      ? r!.sends.length
        ? `Send ×${r!.sends.length}`
        : `→ ${r!.result.map((x) => (x === END ? 'END' : x)).join(', ')}`
      : null;
  return (
    <g className={`router ${active ? 'active' : ''} ${active && r!.pending ? 'pending' : ''}`}>
      <path d={`M${n.x},${n.y - s} L${n.x + s},${n.y} L${n.x},${n.y + s} L${n.x - s},${n.y} Z`} />
      <text x={n.x} y={n.y - s - 8} className="router-label halo">
        {n.label}()
      </text>
      {result && (
        <text x={n.x} y={n.y + s + 18} className="router-result halo">
          {result}
        </text>
      )}
    </g>
  );
}

function HubView({ n, values, hl }: { n: VNode; values: StateValues; hl: { read: Set<string>; write: Set<string>; changed: Set<string> } }) {
  const channels = (n.channels ?? []).filter((c) => !c.hidden);
  const x0 = n.x - n.w / 2;
  const y0 = n.y - n.h / 2;
  const sub = n.id !== HUB;
  return (
    <g className={`hub ${sub ? 'hub-sub' : ''}`}>
      <rect className="hub-box" x={x0} y={y0} width={n.w} height={n.h} rx={6} />
      <text x={x0 + 12} y={y0 + 18} className="hub-title">
        {sub ? 'SUBGRAPH STATE' : 'SHARED STATE'}
      </text>
      <text x={x0 + n.w - 12} y={y0 + 18} className="hub-sub-title" textAnchor="end">
        channels
      </text>
      {channels.map((c, i) => {
        const y = y0 + HUB_HEAD + i * HUB_ROW;
        const cls = hl.write.has(c.key) ? 'write' : hl.changed.has(c.key) ? 'changed' : hl.read.has(c.key) ? 'read' : '';
        const v = values[c.key];
        return (
          <g key={c.key} className={`hub-row ${cls}`}>
            <line x1={x0} x2={x0 + n.w} y1={y - 1} y2={y - 1} className="hub-rule" />
            <rect x={x0 + 1} y={y} width={n.w - 2} height={HUB_ROW - 1} />
            <text x={x0 + 12} y={y + 14.5} className="hub-key">
              {c.key}
            </text>
            <text x={x0 + n.w - 12} y={y + 14.5} className="hub-val">
              {v === undefined ? '—' : fitWidth(pyRepr(v), Math.max(5, (n.w - 34 - c.key.length * 7.8) / 7))}
            </text>
          </g>
        );
      })}
    </g>
  );
}

function PacketView({ p, segs, duration }: { p: Packet; segs: Seg[]; duration: number }) {
  const ref = useRef<SVGGElement>(null);
  useEffect(() => {
    let raf = 0;
    const start = performance.now();
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / duration);
      const e = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
      const pt = pointAt(segs, e);
      if (ref.current) {
        ref.current.setAttribute('transform', `translate(${pt.x},${pt.y})`);
        ref.current.style.opacity = t >= 1 ? '0' : '1';
      }
      if (t < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
    // 패킷은 key 로 새로 마운트될 때 한 번만 애니메이션한다
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const start = segs[0].p0;
  return (
    <g className={`packet packet-${p.kind}`}>
      {(p.kind === 'read' || p.kind === 'write') && segs.map((s, i) => <path key={i} d={segPath(s)} className="packet-trail" />)}
      <g ref={ref} transform={`translate(${start.x},${start.y})`} className="packet-dot">
        <circle r={4.5} />
        {p.label && (
          <text x={9} y={-8} className="packet-label halo">
            {p.label}
          </text>
        )}
      </g>
    </g>
  );
}
