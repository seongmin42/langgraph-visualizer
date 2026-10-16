import { useEffect, useMemo, useRef } from 'react';
import { pyRepr } from '../engine/pyrepr';
import { routerId } from '../engine/runtime';
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

/*
 * 그래프는 LangGraph 의 graph.get_graph().draw_mermaid() 출력과 같은 모양으로 그린다.
 *  - 노드: fill #f2f0ff, 테두리 #9370DB (Mermaid 기본), 둥근 사각형
 *  - __start__: 투명한 stadium, __end__: #bfb6fc stadium
 *  - 조건부 엣지: 점선(-.->), 엣지 라벨: 회색 반투명 배경
 * 실행 상태는 VS Code 디버거 표기를 따른다: 현재 프레임 = 노란 화살표 + 노란 배경, 중단점 = 빨간 점.
 */

const PHASE_LABEL: Record<Frame['phase'], string> = {
  idle: '대기',
  input: '입력',
  run: '노드 실행',
  write: 'update 반환',
  apply: 'reducer 적용',
  'route-pending': 'router 대기',
  route: '라우팅',
  checkpoint: '체크포인트 저장',
  interrupt: 'interrupt',
  resume: '재개',
  update: 'state 수정',
  restore: '체크포인트 복원',
  'sub-enter': '서브그래프 진입',
  'sub-exit': '서브그래프 종료',
  end: '완료',
  error: '예외',
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
  const breakpoints = useMemo(
    () =>
      new Set([
        ...(built.graph.interruptBefore ?? []),
        ...(built.graph.interruptAfter ?? []),
        ...(built.options?.breakAtRouters ?? []).map(routerId),
      ]),
    [built],
  );

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
        {(['base', 'active', 'dim'] as const).map((k) => (
          <marker key={k} id={`arrow-${k}`} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
            <path d="M0,0 L10,5 L0,10 z" className={`arrowhead arrowhead-${k}`} />
          </marker>
        ))}
      </defs>

      {scene.nodes
        .filter((n) => n.kind === 'container')
        .map((n) => (
          <ClusterView key={n.id} n={n} frame={frame} />
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
            <RouterView key={n.id} n={n} frame={frame} breakpoint={breakpoints.has(n.id)} />
          ) : n.kind === 'start' || n.kind === 'end' ? (
            <TerminalView key={n.id} n={n} frame={frame} />
          ) : (
            <NodeView key={n.id} n={n} frame={frame} sends={sendGroups.get(n.id)} breakpoint={breakpoints.has(n.id)} />
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

/** 고정폭 기준 폭(한글 등 전각 문자는 약 1.7칸)에 맞춰 자른다 */
function fitWidth(text: string, units: number) {
  let used = 0;
  let out = '';
  for (const ch of text) {
    const w = /[ᄀ-ᇿ　-鿿가-힯＀-￯]/.test(ch) ? 1.7 : 1;
    if (used + w > units - 1) return out + '…';
    used += w;
    out += ch;
  }
  return out;
}

/** 텍스트 대략 폭 (라벨 배경 사각형 크기용) */
function textWidth(text: string, px: number) {
  let u = 0;
  for (const ch of text) u += /[ᄀ-ᇿ　-鿿가-힯]/.test(ch) ? 1.6 : 0.62;
  return u * px;
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
    const extraTop = n.kind === 'router' ? 26 : n.kind === 'node' ? 18 : 0;
    const extraBottom = n.kind === 'router' ? 28 : 0;
    const extraLeft = n.kind === 'node' ? 22 : 0;
    add(n.x - n.w / 2 - extraLeft, n.y - n.h / 2 - extraTop);
    add(n.x + n.w / 2, n.y + n.h / 2 + extraBottom);
  }
  for (const e of scene.edges) for (const sg of e.segs) add((sg.p0.x + 2 * sg.c.x + sg.p1.x) / 4, (sg.p0.y + 2 * sg.c.y + sg.p1.y) / 4);
  for (const p of built.layout.reserve ?? []) add(p.x, p.y);
  const pad = 30;
  const top = 64; // 위쪽에 떠 있는 디버그 툴바와 겹치지 않도록
  return `${x0 - pad} ${y0 - top} ${x1 - x0 + pad * 2} ${y1 - y0 + top + pad}`;
}

function ClusterView({ n, frame }: { n: VNode; frame: Frame }) {
  const active = frame.activeNodes.includes(n.id);
  const x0 = n.x - n.w / 2;
  const y0 = n.y - n.h / 2;
  return (
    <g className={`cluster ${active ? 'active' : ''}`}>
      <rect x={x0} y={y0} width={n.w} height={n.h} />
      <text x={n.x} y={y0 + 20} className="cluster-label">
        {n.label}
      </text>
    </g>
  );
}

function LabelBox({ x, y, text, className, anchor = 'middle' }: { x: number; y: number; text: string; className: string; anchor?: 'middle' | 'start' }) {
  const w = textWidth(text, 12) + 8;
  const left = anchor === 'middle' ? x - w / 2 : x;
  return (
    <g className={className}>
      <rect x={left} y={y - 11} width={w} height={16} />
      <text x={left + w / 2} y={y + 1} textAnchor="middle">
        {text}
      </text>
    </g>
  );
}

function EdgeView({ e, frame, routerActive }: { e: VEdge; frame: Frame; routerActive?: string }) {
  const active = frame.activeEdges.includes(e.id);
  const dim = routerActive && e.router === routerActive && !frame.router?.pending && !active;
  const marker = e.kind === 'cond-in' ? undefined : `url(#arrow-${active ? 'active' : dim ? 'dim' : 'base'})`;
  const mid = pointAt(e.segs, 0.5);
  const dotted = e.kind === 'cond-in' || e.kind === 'cond-out' || e.kind === 'command';
  return (
    <g className={`edge ${dotted ? 'dotted' : ''} ${active ? 'active' : ''} ${dim ? 'dim' : ''}`}>
      {e.segs.map((s, i) => (
        <path key={i} d={segPath(s)} markerEnd={i === e.segs.length - 1 ? marker : undefined} />
      ))}
      {e.label && <LabelBox x={mid.x} y={mid.y} text={e.label.replace(/"/g, '')} className="edge-label" />}
    </g>
  );
}

function TerminalView({ n, frame }: { n: VNode; frame: Frame }) {
  const active = frame.activeNodes.includes(n.id) || frame.doneNodes.includes(n.id);
  return (
    <g className={`node terminal terminal-${n.kind} ${active ? 'current' : ''} ${frame.nextNodes.includes(n.id) ? 'next' : ''}`}>
      <rect className="node-box" x={n.x - n.w / 2} y={n.y - n.h / 2} width={n.w} height={n.h} rx={n.h / 2} />
      <text x={n.x} y={n.y + 5} className="node-label">
        {n.kind === 'start' ? '__start__' : '__end__'}
      </text>
    </g>
  );
}

/** VS Code 거터의 현재 프레임 화살표 */
function FrameArrow({ x, y }: { x: number; y: number }) {
  return <path className="frame-arrow" d={`M${x - 6},${y - 6} h6 l6,6 l-6,6 h-6 z`} />;
}

function NodeView({ n, frame, sends, breakpoint }: { n: VNode; frame: Frame; sends?: { arg?: StateValues }[]; breakpoint: boolean }) {
  const current = frame.activeNodes.includes(n.id);
  const interrupted = frame.interruptedNodes.includes(n.id);
  const cls = [
    'node',
    current && 'current',
    frame.doneNodes.includes(n.id) && 'done',
    frame.nextNodes.includes(n.id) && 'next',
    interrupted && 'paused',
    frame.errorNodes.includes(n.id) && 'error',
  ]
    .filter(Boolean)
    .join(' ');
  const runs = frame.nodeRuns[n.id];
  const x0 = n.x - n.w / 2;
  const y0 = n.y - n.h / 2;
  return (
    <g className={cls}>
      <rect className="node-box" x={x0} y={y0} width={n.w} height={n.h} rx={5} />
      <text x={n.x} y={n.y + 5} className="node-label">
        {n.label}
      </text>
      {(breakpoint || interrupted) && <circle className="bp-dot" cx={x0 - 12} cy={n.y} r={5} />}
      {(current || interrupted) && <FrameArrow x={x0 - 12} y={n.y} />}
      {frame.errorNodes.includes(n.id) && (
        <text x={x0} y={y0 - 6} className="node-tag error">
          Exception
        </text>
      )}
      {interrupted && (
        <text x={x0} y={y0 - 6} className="node-tag paused">
          Paused on interrupt
        </text>
      )}
      {runs && !interrupted && !frame.errorNodes.includes(n.id) && (
        <text x={x0 + n.w} y={y0 - 6} className="node-tag" textAnchor="end">
          step {runs.join(', ')}
        </text>
      )}
      {sends && sends.length > 0 && (
        <g className="send-list">
          <text x={x0 + n.w + 8} y={n.y + 5} className="send-count">
            ×{sends.length}
          </text>
          {sends.slice(0, 6).map((s, i) => (
            <text key={i} x={x0} y={y0 + n.h + 18 + i * 16} className="send-item">
              Send({pyRepr(s.arg, 26)})
            </text>
          ))}
        </g>
      )}
    </g>
  );
}

function RouterView({ n, frame, breakpoint }: { n: VNode; frame: Frame; breakpoint: boolean }) {
  const r = frame.router;
  const active = r?.routerId === n.id;
  const pending = active && r!.pending;
  const s = n.w / 2;
  const result = active && !r!.pending ? (r!.sends.length ? `Send ×${r!.sends.length}` : `→ ${r!.result.map((x) => (x === END ? '__end__' : x)).join(', ')}`) : null;
  return (
    <g className={`node router ${active ? 'current' : ''} ${pending ? 'paused' : ''}`}>
      <path className="node-box" d={`M${n.x},${n.y - s} L${n.x + s},${n.y} L${n.x},${n.y + s} L${n.x - s},${n.y} Z`} />
      <text x={n.x} y={n.y - s - 8} className="router-label">
        {n.label}()
      </text>
      {breakpoint && <circle className="bp-dot" cx={n.x - s - 12} cy={n.y} r={5} />}
      {active && <FrameArrow x={n.x - s - 12} y={n.y} />}
      {result && <LabelBox x={n.x} y={n.y + s + 18} text={result} className="router-result" />}
    </g>
  );
}

/** 공유 state 는 Mermaid 클래스 다이어그램처럼: «TypedDict» State + 필드 목록 */
function HubView({ n, values, hl }: { n: VNode; values: StateValues; hl: { read: Set<string>; write: Set<string>; changed: Set<string> } }) {
  const channels = (n.channels ?? []).filter((c) => !c.hidden);
  const x0 = n.x - n.w / 2;
  const y0 = n.y - n.h / 2;
  const sub = n.id !== HUB;
  return (
    <g className={`hub ${sub ? 'hub-sub' : ''}`}>
      <rect className="hub-box" x={x0} y={y0} width={n.w} height={n.h} />
      <text x={n.x} y={y0 + 15} className="hub-stereo">
        «TypedDict»
      </text>
      <text x={n.x} y={y0 + 32} className="hub-title">
        {sub ? 'SubgraphState' : 'State'}
      </text>
      <line x1={x0} x2={x0 + n.w} y1={y0 + HUB_HEAD - 1} y2={y0 + HUB_HEAD - 1} className="hub-rule" />
      {channels.map((c, i) => {
        const y = y0 + HUB_HEAD + i * HUB_ROW;
        const cls = hl.write.has(c.key) ? 'write' : hl.changed.has(c.key) ? 'changed' : hl.read.has(c.key) ? 'read' : '';
        const v = values[c.key];
        return (
          <g key={c.key} className={`hub-row ${cls}`}>
            <rect x={x0 + 1} y={y + 1} width={n.w - 2} height={HUB_ROW - 2} />
            <text x={x0 + 10} y={y + 14} className="hub-key">
              {c.key}
            </text>
            <text x={x0 + n.w - 10} y={y + 14} className="hub-val">
              {v === undefined ? '' : fitWidth(pyRepr(v), Math.max(5, (n.w - 30 - c.key.length * 7.6) / 6.9))}
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
        <circle r={5} />
        {p.label && <LabelBox x={10} y={-10} text={p.label} className="packet-label" anchor="start" />}
      </g>
    </g>
  );
}
