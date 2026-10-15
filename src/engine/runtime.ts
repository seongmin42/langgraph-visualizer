import { applyWrites, defaultValues, InvalidUpdateError, type Write } from './reducers';
import { pyRepr } from './pyrepr';
import {
  Command,
  END,
  HUB,
  Send,
  START,
  type AccessEntry,
  type Checkpoint,
  type ConditionalEdgeSpec,
  type DiffEntry,
  type Frame,
  type GraphSpec,
  type InterruptInfo,
  type NodeContext,
  type NodeSpec,
  type Packet,
  type PendingWrite,
  type RouterInfo,
  type StateValues,
  type StreamChunk,
  type Task,
} from './types';

export interface RuntimeOptions {
  /** compile(checkpointer=InMemorySaver()) 여부 */
  checkpointer?: boolean;
  /** 이 router 실행 직전에 멈추고 state 수정을 허용 (실험용 breakpoint) */
  breakAtRouters?: string[];
  /** breakpoint에서 수정 가능한 키 */
  editableKeys?: string[];
}

class GraphInterrupt {
  constructor(public value: unknown) {}
}

export const routerId = (name: string) => `router:${name}`;
export const edgeId = (from: string, to: string) => `${from}->${to}`;

interface TaskResult {
  task: Task;
  update: StateValues;
  goto: string[];
}

interface LoopOpts {
  skipInterruptOnce?: boolean;
  resume?: unknown;
  hasResume?: boolean;
}

type Gen<R = void> = Generator<Frame, R, unknown>;

const clone = <T,>(v: T): T => (v === undefined ? v : structuredClone(v));
const uniq = <T,>(xs: T[]) => [...new Set(xs)];
const keysText = (keys: string[]) => keys.map((k) => `'${k}'`).join(', ');

export class Runtime {
  readonly graph: GraphSpec;
  readonly opts: RuntimeOptions;
  private cps = new Map<string, Checkpoint>();
  private order: string[] = [];
  private cpSeq = 0;
  private taskSeq = 0;
  private msgSeq = 0;
  private frameSeq = 0;
  private packetSeq = 0;
  private attempts: Record<string, number> = {};
  private stream: StreamChunk[] = [];
  private streamSeq = 0;
  private nodeRuns: Record<string, number[]> = {};
  private accessLog: AccessEntry[] = [];
  private pendingPatch: StateValues | null = null;
  private view: { threadId: string | null; values: StateValues; step: number | null; headId: string | null };

  constructor(graph: GraphSpec, opts: RuntimeOptions = {}) {
    this.graph = graph;
    this.opts = opts;
    this.view = { threadId: null, values: defaultValues(graph.channels), step: null, headId: null };
  }

  // ───────────────────────── 조회 API ─────────────────────────

  node(id: string): NodeSpec | undefined {
    return this.graph.nodes.find((n) => n.id === id);
  }

  getCheckpoint(id: string): Checkpoint | undefined {
    return this.cps.get(id);
  }

  /** graph.get_state_history(config) — 생성 순서대로 */
  getHistory(threadId: string | null): Checkpoint[] {
    return this.order.map((id) => this.cps.get(id)!).filter((cp) => cp.threadId === threadId);
  }

  /** graph.get_state(config) — thread의 가장 최근 체크포인트 */
  latest(threadId: string | null): Checkpoint | undefined {
    const h = this.getHistory(threadId);
    return h[h.length - 1];
  }

  threads(): string[] {
    return uniq(this.order.map((id) => this.cps.get(id)!.threadId).filter((t): t is string => t !== null));
  }

  /** 실험용 breakpoint에서 사용자가 수정한 값을 다음 스텝에 반영 */
  queuePatch(patch: StateValues) {
    this.pendingPatch = { ...(this.pendingPatch ?? {}), ...patch };
  }

  idleFrame(threadId: string | null = null, title = '▶ 재생 버튼을 누르면 graph.invoke()가 실행됩니다'): Frame {
    const cp = threadId !== null ? this.latest(threadId) : undefined;
    this.view = {
      threadId,
      values: cp ? cp.values : defaultValues(this.graph.channels),
      step: cp ? cp.step : null,
      headId: cp?.id ?? null,
    };
    return this.frame({ phase: 'idle', title, nextNodes: cp ? cp.next.map((t) => t.node) : [] });
  }

  /** 과거 체크포인트를 골라 그 시점의 state를 보여준다 (읽기 전용) */
  inspect(cpId: string, title?: string): Frame {
    const cp = this.cps.get(cpId)!;
    this.view = { threadId: cp.threadId, values: cp.values, step: cp.step, headId: cp.id };
    return this.frame({
      phase: 'restore',
      title: title ?? `checkpoint #${cp.seq} (step ${cp.step}) 의 state 를 불러왔습니다`,
      detail:
        `graph.get_state(config) 처럼 이 시점의 values 와 next 를 그대로 복원합니다. ` +
        (cp.next.length ? `다음에 실행될 노드: ${cp.next.map((t) => t.node).join(', ')}` : '이 시점 이후로 실행할 노드가 없습니다.'),
      nextNodes: cp.next.map((t) => t.node),
      code: ['history'],
    });
  }

  // ───────────────────────── 실행 API ─────────────────────────

  /** graph.invoke(input, config) */
  *invoke(input: StateValues, threadId: string | null = null): Gen {
    this.resetCallState();
    const parent = threadId !== null && this.opts.checkpointer ? this.latest(threadId) : undefined;
    const base = parent ? parent.values : defaultValues(this.graph.channels);
    const step = parent ? parent.step + 1 : -1;
    const cp = this.save({
      threadId,
      parentId: parent?.id ?? null,
      step,
      source: 'input',
      values: base,
      next: [{ id: this.newTaskId(), node: START, arg: clone(input) }],
      writes: { [START]: clone(input) },
      joins: parent?.joins ?? {},
    });
    this.view = { threadId, values: base, step, headId: cp.id };
    yield this.frame({
      phase: 'input',
      title: `graph.invoke(${pyRepr(input, 60)}) 호출`,
      detail: parent
        ? `thread '${threadId}' 의 마지막 체크포인트(#${parent.seq})에 이어서 실행합니다. 입력은 START 노드가 state 에 쓰는 것으로 처리됩니다.`
        : '입력은 바로 state 가 되는 게 아니라, START 노드가 state 에 "쓰는" 첫 번째 업데이트로 처리됩니다.',
      nextNodes: [START],
      code: ['invoke'],
    });
    yield* this.loop(cp, {});
  }

  /** interrupt 이후 재개: invoke(None) 또는 invoke(Command(resume=value)) */
  *resume(threadId: string | null, value?: unknown): Gen {
    this.resetCallState();
    const cur = this.latest(threadId);
    if (!cur) return;
    const dynamic = cur.interrupts?.some((i) => i.kind === 'dynamic') ?? false;
    this.view = { threadId, values: cur.values, step: cur.step, headId: cur.id };
    yield this.frame({
      phase: 'resume',
      title: dynamic
        ? `graph.invoke(Command(resume=${pyRepr(value, 50)})) 로 재개`
        : 'graph.invoke(None, config) 로 재개',
      detail: dynamic
        ? `저장된 checkpoint #${cur.seq} 에서 다시 시작합니다. interrupt() 를 호출했던 노드는 처음부터 다시 실행되고, 이번에는 interrupt() 가 resume 값을 반환합니다.`
        : `멈춰 있던 checkpoint #${cur.seq} (next: ${cur.next.map((t) => t.node).join(', ')}) 에서 이어서 실행합니다.`,
      nextNodes: cur.next.map((t) => t.node),
      code: ['resume'],
    });
    yield* this.loop(cur, { skipInterruptOnce: true, resume: value, hasResume: dynamic });
  }

  /** 과거 체크포인트에서 그대로 다시 실행 (replay) → 새 분기가 생긴다 */
  *replay(cpId: string): Gen {
    this.resetCallState();
    const cp = this.cps.get(cpId)!;
    this.view = { threadId: cp.threadId, values: cp.values, step: cp.step, headId: cp.id };
    yield this.frame({
      phase: 'restore',
      title: `checkpoint #${cp.seq} (step ${cp.step}) 에서 다시 실행 (replay)`,
      detail:
        'graph.invoke(None, past_config): 이 체크포인트 이전 단계는 다시 실행하지 않고, 이후 노드만 새로 실행합니다. 새로 생기는 체크포인트들은 이 체크포인트를 부모로 하는 새 분기(fork)가 됩니다.',
      nextNodes: cp.next.map((t) => t.node),
      code: ['replay'],
    });
    yield* this.loop(cp, { skipInterruptOnce: true });
  }

  /** graph.update_state(config, patch, as_node) — reducer 를 거쳐 새 체크포인트 생성 */
  updateState(cpId: string, patch: StateValues, asNode = 'update_state'): Checkpoint {
    const cp = this.cps.get(cpId)!;
    const { values } = applyWrites(this.graph.channels, cp.values, [{ node: asNode, update: patch }]);
    return this.save({
      threadId: cp.threadId,
      parentId: cp.id,
      step: cp.step + 1,
      source: 'update',
      values,
      next: cp.next.map((t) => ({ ...t, id: this.newTaskId() })),
      writes: { [asNode]: clone(patch) },
      joins: cp.joins,
    });
  }

  /** update_state 로 state 를 수정한 뒤 그 지점부터 실행 → fork */
  *fork(cpId: string, patch: StateValues, opts: { title?: string; detail?: string } = {}): Gen {
    this.resetCallState();
    const parent = this.cps.get(cpId)!;
    const cp = this.updateState(cpId, patch);
    const diff = applyWrites(this.graph.channels, parent.values, [{ node: 'update_state', update: patch }]).diff;
    this.view = { threadId: cp.threadId, values: cp.values, step: cp.step, headId: cp.id };
    yield this.frame({
      phase: 'update',
      title: opts.title ?? `graph.update_state(config, ${pyRepr(patch, 50)})`,
      detail:
        opts.detail ??
        `checkpoint #${parent.seq} 를 부모로 하는 새 체크포인트 #${cp.seq} (source="update") 가 만들어졌습니다. 기존 히스토리는 그대로 남고, 여기서부터 새 분기가 시작됩니다.`,
      changedKeys: diff.map((d) => d.key),
      diff: diff.map((d) => ({ ...d, manual: true })),
      nextNodes: cp.next.map((t) => t.node),
      code: ['update_state'],
    });
    yield* this.loop(cp, { skipInterruptOnce: true });
  }

  // ───────────────────────── 내부: super-step 루프 ─────────────────────────

  private *loop(start: Checkpoint, opts: LoopOpts): Gen {
    let cur = start;
    let first = true;
    while (true) {
      const tasks = cur.next;
      this.view.headId = cur.id;
      this.view.values = cur.values;

      if (tasks.length === 0) {
        yield this.frame({
          phase: 'end',
          title: '그래프 실행 완료 — 더 이상 실행할 노드가 없습니다 (END)',
          detail: '최종 state 가 invoke() 의 반환값이 됩니다.',
          activeNodes: [END],
          code: ['invoke'],
          final: true,
        });
        return;
      }

      // ── interrupt_before (정적 breakpoint)
      const before = this.graph.interruptBefore ?? [];
      const hitBefore = tasks.filter((t) => before.includes(t.node));
      if (hitBefore.length && !(first && opts.skipInterruptOnce)) {
        const infos: InterruptInfo[] = hitBefore.map((t) => ({ taskId: t.id, node: t.node, kind: 'before', value: null }));
        cur = this.mark(cur, { interrupts: infos });
        this.pushStream(cur.step, 'updates', { __interrupt__: [] });
        yield this.frame({
          phase: 'interrupt',
          title: `interrupt_before=['${hitBefore[0].node}'] — 노드 실행 직전에 멈춤`,
          detail: `checkpoint #${cur.seq} 가 저장된 상태로 실행이 중단되었습니다. snapshot.next == ('${hitBefore[0].node}',). 사람이 state 를 확인/수정한 뒤 invoke(None) 으로 재개할 수 있습니다.`,
          nextNodes: tasks.map((t) => t.node),
          interruptedNodes: hitBefore.map((t) => t.node),
          interrupt: infos[0],
          code: ['interrupt'],
          pauseHere: true,
          final: true,
        });
        return;
      }

      const step = cur.step + 1;
      this.view.step = step;
      const state = cur.values;
      const taskNodes = tasks.map((t) => t.node);
      const reused = cur.pendingWrites ?? [];

      // ── 1) 실행: 이번 super-step 의 모든 노드가 같은 state 스냅샷을 읽는다
      const readPackets: Packet[] = tasks
        .filter((t) => t.node !== START && !reused.some((w) => w.taskId === t.id))
        .map((t) => {
          const keys = t.arg ? Object.keys(t.arg) : (this.node(t.node)?.reads ?? []);
          return this.packet(t.push ? 'send' : 'read', t.push ? routerOrigin(this.graph, t.node) : HUB, t.node,
            t.push ? pyRepr(t.arg, 28) : keys.join(', '), keys);
        });
      yield this.frame({
        phase: 'run',
        title:
          taskNodes.length > 1
            ? `super-step ${step}: ${uniq(taskNodes).length === taskNodes.length ? taskNodes.join(', ') : `${taskNodes[0]} ×${taskNodes.length}`} 동시 실행`
            : step === 0 && taskNodes[0] === START
              ? 'super-step 0: START 가 입력을 state 에 기록합니다'
              : `super-step ${step}: '${taskNodes[0]}' 노드 실행`,
        detail:
          taskNodes.length > 1
            ? '같은 super-step 의 노드들은 모두 step 시작 시점의 동일한 state 스냅샷을 읽고 병렬로 실행됩니다. 서로의 결과는 이번 step 이 끝나야 보입니다.'
            : taskNodes[0] === START
              ? '입력값이 START 의 write 로 처리됩니다.'
              : `노드는 현재 state 를 입력으로 받아 실행됩니다. (읽는 키: ${keysText(this.node(taskNodes[0])?.reads ?? [])})`,
        activeNodes: uniq(taskNodes),
        tasks: tasks.map((t) => ({ id: t.id, node: t.node, arg: t.arg, push: t.push })),
        packets: readPackets,
        code: uniq(taskNodes),
      });

      const results: TaskResult[] = [];
      const interrupts: InterruptInfo[] = [];
      for (const t of tasks) {
        const pend = reused.find((w) => w.taskId === t.id);
        if (pend) {
          results.push({ task: t, update: pend.update, goto: pend.goto ?? [] });
          continue;
        }
        if (t.node === START) {
          results.push({ task: t, update: t.arg ?? {}, goto: [] });
          continue;
        }
        const spec = this.node(t.node);
        if (!spec) throw new Error(`unknown node ${t.node}`);
        if (spec.subgraph) {
          const update = yield* this.runSubgraph(spec, t.arg ?? state);
          results.push({ task: t, update, goto: [] });
          continue;
        }
        const resumeFor = opts.hasResume && first && cur.interrupts?.some((i) => i.taskId === t.id && i.kind === 'dynamic');
        this.attempts[t.node] = (this.attempts[t.node] ?? 0) + 1;
        const ctx: NodeContext = {
          attempt: this.attempts[t.node],
          newId: () => `${++this.msgSeq}`,
          interrupt: (value) => {
            if (resumeFor) return clone(opts.resume);
            throw new GraphInterrupt(value);
          },
        };
        try {
          const out = spec.fn!(clone(t.arg ?? state), ctx);
          if (out instanceof Command) {
            const goto = out.opts.goto === undefined ? [] : Array.isArray(out.opts.goto) ? out.opts.goto : [out.opts.goto];
            results.push({ task: t, update: out.opts.update ?? {}, goto });
          } else {
            results.push({ task: t, update: out ?? {}, goto: [] });
          }
        } catch (e) {
          if (e instanceof GraphInterrupt) {
            interrupts.push({ taskId: t.id, node: t.node, kind: 'dynamic', value: e.value });
          } else {
            throw e;
          }
        }
      }

      // ── interrupt() 호출 (동적 interrupt)
      if (interrupts.length) {
        const pending: PendingWrite[] = results.map((r) => ({ taskId: r.task.id, node: r.task.node, update: r.update, goto: r.goto }));
        cur = this.mark(cur, { interrupts, pendingWrites: pending });
        this.view.headId = cur.id;
        this.pushStream(step, 'updates', { __interrupt__: interrupts.map((i) => ({ value: i.value })) });
        yield this.frame({
          phase: 'interrupt',
          title: `'${interrupts[0].node}' 안에서 interrupt() 호출 — 사람의 입력을 기다립니다`,
          detail: `노드 실행이 중간에 멈췄고 새 체크포인트는 만들어지지 않았습니다. 마지막 체크포인트 #${cur.seq} 에 interrupt 정보가 기록되었습니다. Command(resume=...) 로 재개하면 이 노드가 처음부터 다시 실행됩니다.`,
          activeNodes: [],
          interruptedNodes: interrupts.map((i) => i.node),
          nextNodes: taskNodes,
          interrupt: interrupts[0],
          code: [interrupts[0].node, 'interrupt'],
          pauseHere: true,
          final: true,
        });
        return;
      }

      // ── 2) 각 노드가 partial update 를 반환 (아직 state 에 반영 전)
      const visible = results.filter((r) => r.task.node !== START || Object.keys(r.update).length);
      const pendingWrites: PendingWrite[] = visible.map((r) => ({ taskId: r.task.id, node: r.task.node, update: r.update, goto: r.goto }));
      yield this.frame({
        phase: 'write',
        title:
          results.length > 1
            ? `${uniq(taskNodes).join(', ')} 가 각각 partial update 를 반환`
            : taskNodes[0] === START
              ? `START → ${pyRepr(results[0].update, 60)}`
              : `'${taskNodes[0]}' 가 ${pyRepr(results[0].update, 60)} 반환`,
        detail:
          '노드는 state 전체가 아니라 바꾸고 싶은 키만 담은 dict 를 반환합니다. 이 writes 는 super-step 이 끝날 때 한꺼번에 반영됩니다.',
        doneNodes: uniq(taskNodes),
        tasks: tasks.map((t) => ({ id: t.id, node: t.node, arg: t.arg, push: t.push })),
        pendingWrites,
        packets: visible
          .filter((r) => Object.keys(r.update).length)
          .map((r) => this.packet('write', r.task.node, HUB, pyRepr(r.update, 30), Object.keys(r.update))),
        code: uniq(taskNodes.filter((n) => n !== START)),
      });

      // ── 3) reducer 로 writes 를 적용
      const ordered = sortWrites(results);
      let applied: { values: StateValues; diff: DiffEntry[] };
      try {
        applied = applyWrites(
          this.graph.channels,
          state,
          ordered.map<Write>((r) => ({ node: r.task.node === START ? 'START' : r.task.node, update: r.update })),
        );
      } catch (e) {
        if (e instanceof InvalidUpdateError) {
          yield this.frame({
            phase: 'error',
            title: `InvalidUpdateError — '${e.key}' 에 reducer 가 없는데 같은 step 에서 ${e.writers.length}번 쓰기`,
            detail: `${e.message}\n\n${e.writers.join(', ')} 가 같은 super-step 에서 '${e.key}' 를 동시에 업데이트했습니다. 덮어쓰기 채널(LastValue)은 어떤 값을 남겨야 할지 알 수 없기 때문에 에러가 납니다. Annotated[list, operator.add] 같은 reducer 를 지정해야 합니다.`,
            errorNodes: e.writers,
            pendingWrites,
            error: e.message,
            code: ['state'],
            final: true,
          });
          return;
        }
        throw e;
      }
      const values = applied.values;
      this.view.values = values;
      for (const r of results) {
        if (r.task.node === START) continue;
        (this.nodeRuns[r.task.node] ??= []).push(step);
        const reads = r.task.arg ? Object.keys(r.task.arg) : (this.node(r.task.node)?.reads ?? []);
        this.accessLog.push({ step, node: r.task.node, reads, writes: Object.keys(r.update) });
        if (Object.keys(r.update).length) this.pushStream(step, 'updates', { [r.task.node]: r.update });
      }
      this.pushStream(step, 'values', values);
      yield this.frame({
        phase: 'apply',
        title: applied.diff.length
          ? `reducer 로 state 갱신: ${applied.diff.map((d) => d.key).join(', ')}`
          : '바뀐 키가 없습니다',
        detail: applied.diff.length
          ? applied.diff
              .map((d) =>
                d.reducer === 'overwrite'
                  ? `· ${d.key}: reducer 없음 → 새 값으로 덮어쓰기`
                  : d.reducer === 'add'
                    ? `· ${d.key}: operator.add → 기존 값 + 새 값${d.writers.length > 1 ? ` (${d.writers.length}개 writes 를 순서대로 합침)` : ''}`
                    : `· ${d.key}: add_messages → id 가 같으면 교체, 새 id 면 추가`,
              )
              .join('\n')
          : '반환된 update 가 비어 있어 state 는 그대로입니다.',
        changedKeys: applied.diff.map((d) => d.key),
        diff: applied.diff,
        packets: [],
        code: ['state'],
      });

      // ── 4) 라우팅: 실행된 노드의 엣지를 보고 다음 노드를 결정
      let routeValues = values;
      const next: Task[] = [];
      const joins: Record<string, string[]> = clone(cur.joins);
      const staticPackets: Packet[] = [];
      const staticEdges: string[] = [];
      const ran = uniq(taskNodes);
      for (const n of ran) {
        for (const e of this.graph.edges) {
          if (typeof e.from === 'string' && e.from === n) {
            next.push({ id: this.newTaskId(), node: e.to });
            staticPackets.push(this.packet('trigger', n, e.to, e.to === END ? 'END' : '실행 신호'));
            staticEdges.push(edgeId(n, e.to));
          } else if (Array.isArray(e.from) && e.from.includes(n)) {
            const key = `${e.from.join('+')}->${e.to}`;
            const seen = uniq([...(joins[key] ?? []), n]);
            staticEdges.push(edgeId(n, e.to));
            if (e.from.every((f) => seen.includes(f))) {
              joins[key] = [];
              next.push({ id: this.newTaskId(), node: e.to });
              staticPackets.push(this.packet('trigger', n, e.to, '모두 도착 → 실행'));
            } else {
              joins[key] = seen;
              staticPackets.push(this.packet('trigger', n, e.to, `대기 ${seen.length}/${e.from.length}`));
            }
          }
        }
        for (const r of results.filter((x) => x.task.node === n)) {
          for (const g of r.goto) {
            next.push({ id: this.newTaskId(), node: g });
            staticPackets.push(this.packet('trigger', n, g, `Command(goto='${g}')`));
            staticEdges.push(edgeId(n, g));
          }
        }
      }
      if (staticPackets.length) {
        const waiting = Object.entries(joins).filter(([, v]) => v.length);
        yield this.frame({
          phase: 'route',
          title: `엣지를 따라 다음 노드 결정: ${uniq(next.map((t) => t.node)).map(nameOf).join(', ') || '(대기)'}`,
          detail:
            '엣지를 따라 이동하는 것은 데이터가 아니라 "다음에 실행하라"는 신호입니다. 데이터는 언제나 공유 state 를 통해 전달됩니다.' +
            (waiting.length ? `\n대기 엣지: ${waiting.map(([k, v]) => `${k} (도착: ${v.join(', ')})`).join(' / ')}` : ''),
          packets: staticPackets,
          activeEdges: staticEdges,
          nextNodes: uniq(next.map((t) => t.node)),
          code: ['edges'],
        });
      }

      for (const n of ran) {
        for (const ce of (this.graph.conditionalEdges ?? []).filter((c) => c.from === n)) {
          if (this.opts.breakAtRouters?.includes(ce.routerName)) {
            yield this.frame({
              phase: 'route-pending',
              title: `router '${ce.routerName}' 가 state 를 읽고 다음 노드를 고르려 합니다`,
              detail: `지금 state 의 ${keysText(ce.reads)} 값을 바꾸면 다른 경로로 갈 수 있습니다. 값을 수정한 뒤 ▶ 를 눌러 보세요.`,
              router: this.routerInfo(ce, routeValues, true),
              activeNodes: [],
              editable: this.opts.editableKeys ?? ce.reads,
              code: [ce.routerName],
              pauseHere: true,
            });
            if (this.pendingPatch) {
              const patch = this.pendingPatch;
              this.pendingPatch = null;
              const diff: DiffEntry[] = Object.entries(patch).map(([key, after]) => ({
                key,
                before: routeValues[key],
                after,
                reducer: this.graph.channels.find((c) => c.key === key)?.reducer ?? 'overwrite',
                writers: ['사용자'],
                written: [after],
                manual: true,
              }));
              routeValues = { ...routeValues, ...patch };
              this.view.values = routeValues;
              yield this.frame({
                phase: 'update',
                title: `사용자가 state 를 직접 수정: ${pyRepr(patch, 60)}`,
                detail: '실제 LangGraph 에서는 graph.update_state() 로 하는 일에 해당합니다. router 는 수정된 값을 보고 판단합니다.',
                changedKeys: Object.keys(patch),
                diff,
                router: this.routerInfo(ce, routeValues, true),
                code: [ce.routerName],
              });
            }
          }
          const info = this.routerInfo(ce, routeValues, false);
          const packets: Packet[] = [];
          const edges: string[] = [edgeId(n, info.routerId)];
          for (const target of info.result) {
            next.push({ id: this.newTaskId(), node: target });
            packets.push(this.packet('trigger', n, target, target === END ? 'END' : '실행 신호'));
            edges.push(edgeId(info.routerId, target));
          }
          for (const s of info.sends) {
            next.push({ id: this.newTaskId(), node: s.node, arg: s.arg, push: true });
            packets.push(this.packet('send', n, s.node, pyRepr(s.arg, 26)));
            edges.push(edgeId(info.routerId, s.node));
          }
          yield this.frame({
            phase: 'route',
            title: info.sends.length
              ? `${ce.routerName}() → Send ×${info.sends.length}: '${info.sends[0].node}' 를 각각 다른 입력으로 실행`
              : `${ce.routerName}() → '${info.result.map(nameOf).join("', '")}'`,
            detail: info.sends.length
              ? 'Send(node, arg) 는 실행 시점에 개수가 정해지는 동적 분기입니다. 각 Send 는 공유 state 대신 자신만의 arg 를 입력으로 받는 별도 태스크가 됩니다.'
              : `router 함수는 갱신된 state 의 ${keysText(ce.reads)} 를 읽고 다음 노드 이름을 반환합니다.`,
            router: info,
            packets,
            activeEdges: edges,
            nextNodes: uniq(next.map((t) => t.node)),
            code: [ce.routerName],
          });
        }
      }

      // ── 5) 체크포인트 저장
      const pull = dedupePull(next.filter((t) => t.node !== END));
      const writesMeta: Record<string, unknown> = {};
      for (const r of results) {
        const k = r.task.node;
        if (k in writesMeta) {
          const prev = writesMeta[k];
          writesMeta[k] = Array.isArray(prev) && r.task.push ? [...prev, r.update] : [prev, r.update];
        } else writesMeta[k] = r.task.push ? [r.update] : r.update;
      }
      const newCp = this.save({
        threadId: cur.threadId,
        parentId: cur.id,
        step,
        source: 'loop',
        values: routeValues,
        next: pull,
        writes: writesMeta,
        joins,
      });
      this.view.headId = newCp.id;
      this.view.values = routeValues;
      if (this.opts.checkpointer) {
        yield this.frame({
          phase: 'checkpoint',
          title: `checkpoint #${newCp.seq} 저장 (step ${step}${cur.threadId !== null ? `, thread_id='${cur.threadId}'` : ''})`,
          detail: `super-step 이 끝날 때마다 checkpointer 가 values / next / metadata(writes, step) 를 저장합니다. next = (${pull.map((t) => `'${t.node}'`).join(', ')}${pull.length === 1 ? ',' : ''})`,
          nextNodes: pull.map((t) => t.node),
          code: ['checkpointer'],
        });
      }

      // ── interrupt_after
      const after = this.graph.interruptAfter ?? [];
      const hitAfter = tasks.filter((t) => after.includes(t.node));
      if (hitAfter.length && pull.length) {
        const infos: InterruptInfo[] = hitAfter.map((t) => ({ taskId: t.id, node: t.node, kind: 'after', value: null }));
        const marked = this.mark(newCp, { interrupts: infos });
        yield this.frame({
          phase: 'interrupt',
          title: `interrupt_after=['${hitAfter[0].node}'] — 노드 실행 직후 멈춤`,
          detail: `checkpoint #${marked.seq} 에서 멈췄습니다. invoke(None) 으로 재개합니다.`,
          nextNodes: pull.map((t) => t.node),
          interruptedNodes: hitAfter.map((t) => t.node),
          interrupt: infos[0],
          code: ['interrupt'],
          pauseHere: true,
          final: true,
        });
        return;
      }

      cur = newCp;
      first = false;
    }
  }

  private *runSubgraph(spec: NodeSpec, state: StateValues): Gen<StateValues> {
    const sub = spec.subgraph!;
    const child = new Runtime(sub, {});
    child.msgSeq = this.msgSeq + 100;
    const parentKeys = this.graph.channels.map((c) => c.key);
    const shared = sub.channels.map((c) => c.key).filter((k) => parentKeys.includes(k));
    const input = pick(state, shared);
    const p = (id: string) => `${spec.id}/${id}`;
    yield this.frame({
      phase: 'sub-enter',
      title: `서브그래프 '${spec.id}' 진입`,
      detail: `부모 state 중 서브그래프 State 와 이름이 같은 키(${keysText(shared)})만 서브그래프의 입력이 됩니다. 서브그래프는 자기만의 state 와 super-step 을 갖습니다.`,
      activeNodes: [spec.id],
      packets: [this.packet('read', HUB, p(HUB), pyRepr(input, 30), shared)],
      code: [spec.id],
      sub: { nodeId: spec.id, channels: sub.channels, state: defaultValues(sub.channels), superstep: null, changedKeys: [], diff: [], pendingWrites: [] },
    });
    let last: Frame | null = null;
    for (const f of child.invoke(input, null)) {
      if (f.phase === 'input') continue;
      last = f;
      const mapEdge = (e: string) => e.split('->').map(p).join('->');
      yield this.frame({
        phase: f.phase,
        title: `[서브그래프 ${spec.id}] ${f.title}`,
        detail: f.detail,
        activeNodes: [spec.id, ...f.activeNodes.map(p)],
        doneNodes: f.doneNodes.map(p),
        nextNodes: f.nextNodes.map(p),
        errorNodes: f.errorNodes.map(p),
        activeEdges: f.activeEdges.map(mapEdge),
        packets: f.packets.map((pk) => ({ ...pk, from: p(pk.from), to: p(pk.to) })),
        tasks: f.tasks.map((t) => ({ ...t, node: p(t.node) })),
        router: f.router && { ...f.router, from: p(f.router.from), routerId: p(f.router.routerId) },
        code: f.code,
        sub: {
          nodeId: spec.id,
          channels: sub.channels,
          state: f.state,
          superstep: f.superstep,
          changedKeys: f.changedKeys,
          diff: f.diff,
          pendingWrites: f.pendingWrites,
        },
      });
    }
    this.msgSeq = child.msgSeq;
    const finalState = last?.state ?? input;
    const out = pick(finalState, shared);
    yield this.frame({
      phase: 'sub-exit',
      title: `서브그래프 '${spec.id}' 종료 → 공유 키만 부모에게 반환`,
      detail: `서브그래프 전용 키(${keysText(sub.channels.map((c) => c.key).filter((k) => !shared.includes(k)))})는 부모 state 로 새어 나가지 않습니다. 부모 입장에서는 '${spec.id}' 노드가 ${pyRepr(out, 50)} 를 반환한 것과 같습니다.`,
      activeNodes: [spec.id],
      packets: [this.packet('write', p(HUB), HUB, pyRepr(out, 30), shared)],
      code: [spec.id],
      sub: { nodeId: spec.id, channels: sub.channels, state: finalState, superstep: last?.superstep ?? null, changedKeys: [], diff: [], pendingWrites: [] },
    });
    return out;
  }

  // ───────────────────────── 헬퍼 ─────────────────────────

  private routerInfo(ce: ConditionalEdgeSpec, values: StateValues, pending: boolean): RouterInfo {
    const base: RouterInfo = {
      from: ce.from,
      routerName: ce.routerName,
      routerId: routerId(ce.routerName),
      reads: ce.reads.map((key) => ({ key, value: values[key] })),
      pending,
      result: [],
      sends: [],
      rows: ce.explain ? ce.explain(values) : [],
    };
    if (pending) return { ...base, rows: base.rows.map((r) => ({ ...r, matched: false })) };
    const raw = ce.router(clone(values));
    const list = Array.isArray(raw) ? raw : [raw];
    for (const item of list) {
      if (item instanceof Send) base.sends.push({ node: item.node, arg: item.arg });
      else base.result.push(ce.pathMap?.[item] ?? item);
    }
    return base;
  }

  private resetCallState() {
    this.stream = [];
    this.nodeRuns = {};
    this.accessLog = [];
    this.pendingPatch = null;
  }

  private pushStream(step: number, mode: StreamChunk['mode'], payload: unknown) {
    this.stream.push({ seq: ++this.streamSeq, step, mode, payload: clone(payload) });
  }

  private newTaskId() {
    return `task-${++this.taskSeq}`;
  }

  private packet(kind: Packet['kind'], from: string, to: string, label: string, keys?: string[]): Packet {
    return { id: `p${++this.packetSeq}`, kind, from, to, label, keys };
  }

  private save(cp: Omit<Checkpoint, 'id' | 'seq'>): Checkpoint {
    const seq = ++this.cpSeq;
    const full: Checkpoint = { ...cp, id: `ckpt-${seq}`, seq, values: clone(cp.values) };
    this.cps.set(full.id, full);
    this.order.push(full.id);
    return full;
  }

  private mark(cp: Checkpoint, patch: Partial<Checkpoint>): Checkpoint {
    const updated = { ...cp, ...patch };
    this.cps.set(cp.id, updated);
    return updated;
  }

  private frame(p: Partial<Frame> & Pick<Frame, 'phase' | 'title'>): Frame {
    const threadId = this.view.threadId;
    return {
      seq: ++this.frameSeq,
      detail: '',
      superstep: this.view.step,
      threadId,
      activeNodes: [],
      doneNodes: [],
      nextNodes: [],
      interruptedNodes: [],
      errorNodes: [],
      activeEdges: [],
      packets: [],
      state: this.view.values,
      changedKeys: [],
      diff: [],
      pendingWrites: [],
      tasks: [],
      code: [],
      checkpointId: this.view.headId,
      history: this.opts.checkpointer ? this.getHistory(threadId) : [],
      stream: [...this.stream],
      nodeRuns: clone(this.nodeRuns),
      accessLog: [...this.accessLog],
      ...p,
    };
  }
}

function nameOf(n: string) {
  return n === END ? 'END' : n === START ? 'START' : n;
}

function pick(values: StateValues, keys: string[]): StateValues {
  const out: StateValues = {};
  for (const k of keys) if (k in values) out[k] = clone(values[k]);
  return out;
}

/** Send 패킷은 router 다이아몬드에서 출발하는 것처럼 그린다 */
function routerOrigin(graph: GraphSpec, node: string): string {
  const ce = (graph.conditionalEdges ?? []).find((c) => c.targets.includes(node));
  return ce ? routerId(ce.routerName) : HUB;
}

/** 일반(pull) 태스크는 노드당 하나로 합치고, Send(push) 태스크는 개별 유지 */
function dedupePull(tasks: Task[]): Task[] {
  const seen = new Set<string>();
  const out: Task[] = [];
  for (const t of tasks) {
    if (t.push) {
      out.push(t);
      continue;
    }
    if (seen.has(t.node)) continue;
    seen.add(t.node);
    out.push(t);
  }
  // LangGraph 와 비슷하게: pull 태스크(노드 이름순) → push 태스크(생성순)
  return [
    ...out.filter((t) => !t.push).sort((a, b) => a.node.localeCompare(b.node)),
    ...out.filter((t) => t.push),
  ];
}

/** 같은 super-step 의 writes 적용 순서: pull 태스크는 노드 이름순, push(Send) 는 생성순 */
function sortWrites(results: TaskResult[]): TaskResult[] {
  return [
    ...results.filter((r) => !r.task.push).sort((a, b) => a.task.node.localeCompare(b.task.node)),
    ...results.filter((r) => r.task.push),
  ];
}
