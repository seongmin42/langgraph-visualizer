import { routerId } from './engine/runtime';
import { END, HUB, START, type ChannelSpec, type GraphSpec } from './engine/types';
import type { Layout } from './scenarios/types';

export interface Pt {
  x: number;
  y: number;
}

/** 2차 베지어 곡선 한 구간 */
export interface Seg {
  p0: Pt;
  c: Pt;
  p1: Pt;
}

export interface VNode {
  id: string;
  label: string;
  kind: 'start' | 'end' | 'node' | 'router' | 'hub' | 'container';
  x: number;
  y: number;
  w: number;
  h: number;
  /** hub 일 때 표시할 채널 */
  channels?: ChannelSpec[];
}

export interface VEdge {
  id: string;
  from: string;
  to: string;
  kind: 'static' | 'join' | 'cond-in' | 'cond-out' | 'command';
  label?: string;
  router?: string;
  segs: Seg[];
}

export const HUB_ROW = 20;
export const HUB_HEAD = 40;

export function hubSize(channels: ChannelSpec[]) {
  const visible = channels.filter((c) => !c.hidden);
  return { w: 240, h: HUB_HEAD + visible.length * HUB_ROW + 6 };
}

export function buildScene(graph: GraphSpec, layout: Layout, prefix = ''): { nodes: VNode[]; edges: VEdge[] } {
  const nodes: VNode[] = [];
  const edges: VEdge[] = [];
  const P = (id: string) => prefix + id;
  const pos = (id: string) => {
    const p = layout.nodes[P(id)];
    if (!p) throw new Error(`layout 에 '${P(id)}' 좌표가 없습니다`);
    return p;
  };

  const add = (id: string, label: string, kind: VNode['kind'], w: number, h: number, extra: Partial<VNode> = {}) => {
    const p = pos(id);
    nodes.push({ id: P(id), label, kind, x: p.x, y: p.y, w: p.w ?? w, h: p.h ?? h, ...extra });
  };

  add(START, '__start__', 'start', 92, 34);
  if (layout.nodes[P(END)]) add(END, '__end__', 'end', 84, 34);
  const hub = hubSize(graph.channels);
  add(HUB, 'State', 'hub', hub.w, hub.h, { channels: graph.channels });

  for (const n of graph.nodes) {
    if (n.subgraph) {
      const c = layout.containers?.[P(n.id)];
      if (!c) throw new Error(`container ${n.id} 없음`);
      nodes.push({ id: P(n.id), label: n.id, kind: 'container', x: c.x + c.w / 2, y: c.y + c.h / 2, w: c.w, h: c.h });
      const inner = buildScene(n.subgraph, layout, `${P(n.id)}/`);
      nodes.push(...inner.nodes);
      edges.push(...inner.edges);
    } else {
      add(n.id, n.id, 'node', Math.max(108, n.id.length * 8.6 + 34), 40);
    }
  }
  for (const ce of graph.conditionalEdges ?? []) {
    const rid = routerId(ce.routerName);
    if (!nodes.some((v) => v.id === P(rid))) add(rid, ce.routerName, 'router', 30, 30);
  }

  const find = (id: string) => nodes.find((v) => v.id === P(id))!;
  const bend = (from: string, to: string) => layout.bends?.[`${P(from)}->${P(to)}`] ?? 0;

  for (const e of graph.edges) {
    const froms = Array.isArray(e.from) ? e.from : [e.from];
    for (const f of froms) {
      if (!layout.nodes[P(e.to)] && e.to === END) continue;
      edges.push({
        id: `${P(f)}->${P(e.to)}`,
        from: P(f),
        to: P(e.to),
        kind: Array.isArray(e.from) ? 'join' : 'static',
        segs: [connect(find(f), find(e.to), bend(f, e.to))],
      });
    }
  }
  for (const ce of graph.conditionalEdges ?? []) {
    const rid = routerId(ce.routerName);
    const r = find(rid);
    edges.push({
      id: `${P(ce.from)}->${P(rid)}`,
      from: P(ce.from),
      to: P(rid),
      kind: 'cond-in',
      router: P(rid),
      segs: [connect(find(ce.from), r, bend(ce.from, rid))],
    });
    for (const t of ce.targets) {
      const label = ce.pathMap ? Object.entries(ce.pathMap).find(([, v]) => v === t)?.[0] : undefined;
      edges.push({
        id: `${P(rid)}->${P(t)}`,
        from: P(rid),
        to: P(t),
        kind: 'cond-out',
        router: P(rid),
        label: label && label !== t ? `"${label}"` : undefined,
        segs: [connect(r, find(t), bend(rid, t))],
      });
    }
  }
  for (const ce of graph.commandEdges ?? []) {
    edges.push({
      id: `${P(ce.from)}->${P(ce.to)}`,
      from: P(ce.from),
      to: P(ce.to),
      kind: 'command',
      label: ce.label,
      segs: [connect(find(ce.from), find(ce.to), bend(ce.from, ce.to))],
    });
  }
  return { nodes, edges };
}

/** 사각형 중심에서 target 방향으로 나가는 선이 테두리와 만나는 점 */
export function clip(n: VNode, toward: Pt): Pt {
  const dx = toward.x - n.x;
  const dy = toward.y - n.y;
  if (dx === 0 && dy === 0) return { x: n.x, y: n.y };
  if (n.kind === 'router') {
    // 마름모: |dx|/hw + |dy|/hh = 1
    const s = 1 / (Math.abs(dx) / (n.w / 2 + 3) + Math.abs(dy) / (n.h / 2 + 3));
    return { x: n.x + dx * s, y: n.y + dy * s };
  }
  const hw = n.w / 2 + 2;
  const hh = n.h / 2 + 2;
  const s = Math.min(dx !== 0 ? hw / Math.abs(dx) : Infinity, dy !== 0 ? hh / Math.abs(dy) : Infinity);
  return { x: n.x + dx * s, y: n.y + dy * s };
}

export function connect(a: VNode, b: VNode, bendPx = 0): Seg {
  const mx = (a.x + b.x) / 2;
  const my = (a.y + b.y) / 2;
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy) || 1;
  const c = { x: mx + (-dy / len) * bendPx, y: my + (dx / len) * bendPx };
  return { p0: clip(a, c), c, p1: clip(b, c) };
}

export function segPath(s: Seg) {
  return `M${s.p0.x},${s.p0.y} Q${s.c.x},${s.c.y} ${s.p1.x},${s.p1.y}`;
}

export function pointAt(segs: Seg[], t: number): Pt {
  const n = segs.length;
  const i = Math.min(n - 1, Math.floor(t * n));
  const u = t * n - i;
  const s = segs[i];
  const a = (1 - u) * (1 - u);
  const b = 2 * (1 - u) * u;
  const c = u * u;
  return { x: a * s.p0.x + b * s.c.x + c * s.p1.x, y: a * s.p0.y + b * s.c.y + c * s.p1.y };
}

/** 패킷이 지나갈 경로: 그려진 엣지가 있으면 그 엣지, router 를 거치는 경우 두 구간, 없으면 곡선 */
export function packetPath(scene: { nodes: VNode[]; edges: VEdge[] }, from: string, to: string): Seg[] {
  const direct = scene.edges.find((e) => e.from === from && e.to === to);
  if (direct) return direct.segs;
  const viaIn = scene.edges.filter((e) => e.from === from && e.kind === 'cond-in');
  for (const e of viaIn) {
    const out = scene.edges.find((o) => o.from === e.to && o.to === to);
    if (out) return [...e.segs, ...out.segs];
  }
  const a = scene.nodes.find((n) => n.id === from);
  const b = scene.nodes.find((n) => n.id === to);
  if (!a || !b) return [];
  const isHub = a.kind === 'hub' || b.kind === 'hub';
  return [connect(a, b, isHub ? 26 : 0)];
}
