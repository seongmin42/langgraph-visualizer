import { useEffect, useMemo, useRef } from 'react';
import { pyRepr } from '../engine/pyrepr';
import { END, HUB, START, type Frame, type Packet, type StateValues } from '../engine/types';
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
  const { width, height } = built.layout;
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
    const isSubHub = hubId !== HUB;
    const changed = new Set(isSubHub ? (frame.sub?.changedKeys ?? []) : frame.changedKeys);
    return { read, write, changed };
  };

  const hubValues = (hubId: string): StateValues => {
    if (hubId === HUB) return frame.state;
    const owner = hubId.slice(0, -(HUB.length + 1));
    return frame.sub?.nodeId === owner ? frame.sub.state : {};
  };

  return (
    <svg className="graph-svg" viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="xMidYMid meet">
      <defs>
        {(['base', 'active', 'cond', 'cmd', 'dim'] as const).map((k) => (
          <marker
            key={k}
            id={`arrow-${k}`}
            viewBox="0 0 10 10"
            refX="9"
            refY="5"
            markerWidth="7"
            markerHeight="7"
            orient="auto-start-reverse"
          >
            <path d="M0,0 L10,5 L0,10 z" className={`arrowhead arrowhead-${k}`} />
          </marker>
        ))}
        <filter id="glow" x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="5" result="b" />
          <feMerge>
            <feMergeNode in="b" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
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

function ContainerNode({ n, frame }: { n: VNode; frame: Frame }) {
  const active = frame.activeNodes.includes(n.id);
  const runs = frame.nodeRuns[n.id];
  return (
    <g className={`container ${active ? 'active' : ''} ${runs ? 'ran' : ''}`}>
      <rect x={n.x - n.w / 2} y={n.y - n.h / 2} width={n.w} height={n.h} rx={14} />
      <text x={n.x - n.w / 2 + 14} y={n.y - n.h / 2 + 20} className="container-label">
        {n.label}
        <tspan className="container-sub"> · subgraph (컴파일된 그래프를 노드로 사용)</tspan>
      </text>
      {runs && <StepBadges x={n.x + n.w / 2 - 8} y={n.y - n.h / 2} steps={runs} />}
    </g>
  );
}

function EdgeView({ e, frame, routerActive }: { e: VEdge; frame: Frame; routerActive?: string }) {
  const active = frame.activeEdges.includes(e.id);
  const routed = routerActive && e.router === routerActive && !frame.router?.pending;
  const dim = routed && !active;
  const kind = e.kind === 'command' ? 'cmd' : e.kind.startsWith('cond') ? 'cond' : 'base';
  const marker = e.kind === 'cond-in' ? undefined : `url(#arrow-${active ? 'active' : dim ? 'dim' : kind})`;
  const mid = pointAt(e.segs, 0.5);
  return (
    <g className={`edge edge-${e.kind} ${active ? 'active' : ''} ${dim ? 'dim' : ''}`}>
      {e.segs.map((s, i) => (
        <path key={i} d={segPath(s)} markerEnd={i === e.segs.length - 1 ? marker : undefined} />
      ))}
      {e.kind === 'join' && <circle cx={e.segs[0].p1.x} cy={e.segs[0].p1.y} r={3.5} className="join-dot" />}
      {e.label && (
        <text x={mid.x} y={mid.y - 6} className="edge-label">
          {e.label}
        </text>
      )}
    </g>
  );
}

function StepBadges({ x, y, steps }: { x: number; y: number; steps: number[] }) {
  const label = `step ${steps.join(',')}`;
  const w = label.length * 6.4 + 10;
  return (
    <g className="step-badge" transform={`translate(${x - w + 10},${y - 9})`}>
      <rect width={w} height={17} rx={8.5} />
      <text x={w / 2} y={12.5}>
        {label}
      </text>
    </g>
  );
}

function NodeView({ n, frame, sends }: { n: VNode; frame: Frame; sends?: { arg?: StateValues }[] }) {
  const cls = [
    'node',
    `node-${n.kind}`,
    frame.activeNodes.includes(n.id) && 'active',
    frame.doneNodes.includes(n.id) && 'done',
    frame.nextNodes.includes(n.id) && 'next',
    frame.interruptedNodes.includes(n.id) && 'interrupted',
    frame.errorNodes.includes(n.id) && 'error',
    frame.nodeRuns[n.id] && 'ran',
  ]
    .filter(Boolean)
    .join(' ');
  const runs = frame.nodeRuns[n.id];
  const pill = n.kind === 'start' || n.kind === 'end';
  return (
    <g className={cls}>
      <rect
        x={n.x - n.w / 2}
        y={n.y - n.h / 2}
        width={n.w}
        height={n.h}
        rx={pill ? n.h / 2 : 10}
        filter={frame.activeNodes.includes(n.id) ? 'url(#glow)' : undefined}
      />
      <text x={n.x} y={n.y + 4.5} className="node-label">
        {n.id.endsWith(START) ? 'START' : n.id.endsWith(END) ? 'END' : n.label}
      </text>
      {frame.interruptedNodes.includes(n.id) && (
        <text x={n.x + n.w / 2 - 14} y={n.y - n.h / 2 - 6} className="node-icon">
          ⏸
        </text>
      )}
      {frame.errorNodes.includes(n.id) && (
        <text x={n.x + n.w / 2 - 14} y={n.y - n.h / 2 - 6} className="node-icon err">
          ✖
        </text>
      )}
      {runs && !pill && <StepBadges x={n.x + n.w / 2} y={n.y - n.h / 2} steps={runs} />}
      {sends && sends.length > 0 && (
        <g className="send-chips">
          <text x={n.x + n.w / 2 + 6} y={n.y + 5} className="send-count">
            ×{sends.length}
          </text>
          {sends.slice(0, 5).map((s, i) => {
            const label = pyRepr(s.arg, 24);
            const w = Math.max(80, label.length * 6.3 + 12);
            return (
              <g key={i} transform={`translate(${n.x - w / 2},${n.y + n.h / 2 + 6 + i * 21})`}>
                <rect width={w} height={18} rx={9} />
                <text x={w / 2} y={13}>
                  {label}
                </text>
              </g>
            );
          })}
        </g>
      )}
    </g>
  );
}

function RouterView({ n, frame }: { n: VNode; frame: Frame }) {
  const r = frame.router;
  const active = r?.routerId === n.id;
  const s = n.w / 2;
  const result = active && !r!.pending ? (r!.sends.length ? `Send ×${r!.sends.length}` : `→ ${r!.result.map((x) => (x === END ? 'END' : x)).join(', ')}`) : null;
  return (
    <g className={`router ${active ? 'active' : ''} ${active && r!.pending ? 'pending' : ''}`}>
      <path
        d={`M${n.x},${n.y - s} L${n.x + s},${n.y} L${n.x},${n.y + s} L${n.x - s},${n.y} Z`}
        filter={active ? 'url(#glow)' : undefined}
      />
      <text x={n.x} y={n.y + 4} className="router-q">
        ?
      </text>
      <text x={n.x} y={n.y - s - 7} className="router-label">
        {n.label}()
      </text>
      {result && (
        <g className="router-result">
          <rect x={n.x - (result.length * 7 + 14) / 2} y={n.y + s + 6} width={result.length * 7 + 14} height={22} rx={11} />
          <text x={n.x} y={n.y + s + 21} textAnchor="middle">
            {result}
          </text>
        </g>
      )}
    </g>
  );
}

function HubView({
  n,
  values,
  hl,
}: {
  n: VNode;
  values: StateValues;
  hl: { read: Set<string>; write: Set<string>; changed: Set<string> };
}) {
  const channels = (n.channels ?? []).filter((c) => !c.hidden);
  const x0 = n.x - n.w / 2;
  const y0 = n.y - n.h / 2;
  const sub = n.id !== HUB;
  return (
    <g className={`hub ${sub ? 'hub-sub' : ''}`}>
      <rect x={x0} y={y0} width={n.w} height={n.h} rx={10} />
      <text x={x0 + 10} y={y0 + 17} className="hub-title">
        {sub ? '서브그래프 State' : '공유 State (채널)'}
      </text>
      {channels.map((c, i) => {
        const y = y0 + HUB_HEAD + i * HUB_ROW;
        const cls = hl.write.has(c.key) ? 'write' : hl.changed.has(c.key) ? 'changed' : hl.read.has(c.key) ? 'read' : '';
        const v = values[c.key];
        return (
          <g key={c.key} className={`hub-row ${cls}`}>
            <rect x={x0 + 4} y={y} width={n.w - 8} height={HUB_ROW - 2} rx={4} />
            <text x={x0 + 10} y={y + 11.5} className="hub-key">
              {c.key}
            </text>
            <text x={x0 + n.w - 10} y={y + 11.5} className="hub-val">
              {v === undefined ? '—' : pyRepr(v, Math.max(5, Math.floor((n.w - 30 - c.key.length * 6.8) / 7.2)))}
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
        ref.current.style.opacity = t >= 1 ? '0.0' : '1';
      }
      if (t < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
    // 패킷은 key 로 새로 마운트될 때 한 번만 애니메이션한다
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const start = segs[0].p0;
  const w = Math.min(200, p.label.length * 6.3 + 14);
  return (
    <g className={`packet packet-${p.kind}`}>
      {segs.map((s, i) => (
        <path key={i} d={segPath(s)} className="packet-trail" />
      ))}
      <g ref={ref} transform={`translate(${start.x},${start.y})`} className="packet-dot">
        <circle r={6.5} />
        {p.label && (
          <g transform="translate(10,-22)">
            <rect width={w} height={17} rx={8.5} />
            <text x={7} y={12.5}>
              {p.label}
            </text>
          </g>
        )}
      </g>
    </g>
  );
}
