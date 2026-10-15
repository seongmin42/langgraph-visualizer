// LangGraph 실행 모델(Pregel)을 흉내 내는 mock 엔진의 타입 정의.
// 실제 LLM 호출은 없고, 모든 노드는 결정적인 mock 함수다.

export type StateValues = Record<string, unknown>;

export const START = '__start__';
export const END = '__end__';
/** 그래프 그림 위의 공유 state 허브(채널 저장소) id */
export const HUB = '__state__';

export interface Message {
  id: string;
  type: 'human' | 'ai' | 'system' | 'tool';
  content: string;
}

/** reducer 종류: 없음(LastValue, 덮어쓰기) / operator.add / add_messages */
export type ReducerKind = 'overwrite' | 'add' | 'add_messages';

export interface ChannelSpec {
  key: string;
  /** 화면 표시용 파이썬 타입 표기 (예: "Annotated[list, operator.add]") */
  pyType: string;
  reducer: ReducerKind;
  /** 그래프 그림의 state 허브에서 숨길지 여부 */
  hidden?: boolean;
}

/** Send(node, arg): 특정 노드를 개별 입력으로 실행하는 동적 분기 */
export class Send {
  constructor(
    public node: string,
    public arg: StateValues,
  ) {}
}

/** Command(update=..., goto=...): 노드가 업데이트와 다음 이동을 함께 반환 */
export class Command {
  constructor(public opts: { update?: StateValues; goto?: string | string[]; resume?: unknown }) {}
}

export interface NodeContext {
  /** langgraph.types.interrupt() 흉내. resume 값이 있으면 반환, 없으면 실행을 멈춘다. */
  interrupt: (value: unknown) => unknown;
  /** 이 런타임에서 해당 노드가 몇 번째로 실행되는지 (1부터). mock LLM의 '매번 다른 답' 표현용 */
  attempt: number;
  /** 메시지 id 발급 */
  newId: () => string;
}

export type NodeResult = StateValues | Command | null | undefined;
export type NodeFn = (state: StateValues, ctx: NodeContext) => NodeResult;

export interface NodeSpec {
  id: string;
  /** 이 노드가 state에서 읽는 키 (애니메이션/로그 표시용) */
  reads: string[];
  fn?: NodeFn;
  /** 컴파일된 서브그래프를 노드로 추가한 경우 */
  subgraph?: GraphSpec;
}

/** from이 배열이면 add_edge([a, b], c) 처럼 '모두 끝나야' 실행되는 대기(join) 엣지 */
export interface EdgeSpec {
  from: string | string[];
  to: string;
}

export interface RouteExplainRow {
  cond: string;
  target: string;
  matched: boolean;
}

export interface ConditionalEdgeSpec {
  from: string;
  routerName: string;
  reads: string[];
  router: (state: StateValues) => string | Array<string | Send>;
  /** add_conditional_edges의 path_map: router 반환값 → 노드 */
  pathMap?: Record<string, string>;
  /** 그림에 그릴 가능한 목적지 */
  targets: string[];
  /** router 판단 과정을 표로 보여주기 위한 설명 */
  explain?: (state: StateValues) => RouteExplainRow[];
}

export interface GraphSpec {
  name: string;
  channels: ChannelSpec[];
  nodes: NodeSpec[];
  edges: EdgeSpec[];
  conditionalEdges?: ConditionalEdgeSpec[];
  /** Command(goto=...)로 이동 가능한 경로 (그림 표시용) */
  commandEdges?: { from: string; to: string; label?: string }[];
  interruptBefore?: string[];
  interruptAfter?: string[];
}

export interface Task {
  id: string;
  node: string;
  /** Send로 전달된 개별 입력, 또는 START 태스크의 입력 */
  arg?: StateValues;
  /** Send로 생성된 태스크인지 */
  push?: boolean;
}

export interface PendingWrite {
  taskId: string;
  node: string;
  update: StateValues;
  goto?: string[];
}

export interface InterruptInfo {
  taskId: string;
  node: string;
  kind: 'before' | 'after' | 'dynamic';
  value: unknown;
}

export interface Checkpoint {
  id: string;
  threadId: string | null;
  parentId: string | null;
  step: number;
  source: 'input' | 'loop' | 'update';
  values: StateValues;
  next: Task[];
  /** 이 체크포인트를 만든 writes (metadata.writes) */
  writes: Record<string, unknown> | null;
  joins: Record<string, string[]>;
  pendingWrites?: PendingWrite[];
  interrupts?: InterruptInfo[];
  seq: number;
}

export type Phase =
  | 'idle'
  | 'input'
  | 'run'
  | 'write'
  | 'apply'
  | 'route-pending'
  | 'route'
  | 'checkpoint'
  | 'interrupt'
  | 'resume'
  | 'update'
  | 'restore'
  | 'sub-enter'
  | 'sub-exit'
  | 'end'
  | 'error';

export interface Packet {
  id: string;
  kind: 'read' | 'write' | 'trigger' | 'send';
  from: string;
  to: string;
  label: string;
  /** read/write 패킷이 다루는 state 키 */
  keys?: string[];
}

export interface DiffEntry {
  key: string;
  before: unknown;
  after: unknown;
  reducer: ReducerKind;
  writers: string[];
  written: unknown[];
  manual?: boolean;
}

export interface RouterInfo {
  from: string;
  routerName: string;
  routerId: string;
  reads: { key: string; value: unknown }[];
  pending: boolean;
  result: string[];
  sends: { node: string; arg: StateValues }[];
  rows: RouteExplainRow[];
}

export interface StreamChunk {
  seq: number;
  step: number;
  mode: 'values' | 'updates';
  payload: unknown;
}

export interface AccessEntry {
  step: number;
  node: string;
  reads: string[];
  writes: string[];
}

export interface TaskView {
  id: string;
  node: string;
  arg?: StateValues;
  push?: boolean;
}

export interface SubView {
  nodeId: string;
  channels: ChannelSpec[];
  state: StateValues;
  superstep: number | null;
  changedKeys: string[];
  diff: DiffEntry[];
  pendingWrites: PendingWrite[];
}

/** 플레이어가 한 칸씩 보여주는 화면 스냅샷 */
export interface Frame {
  seq: number;
  phase: Phase;
  title: string;
  detail: string;
  superstep: number | null;
  threadId: string | null;
  activeNodes: string[];
  doneNodes: string[];
  nextNodes: string[];
  interruptedNodes: string[];
  errorNodes: string[];
  activeEdges: string[];
  packets: Packet[];
  state: StateValues;
  changedKeys: string[];
  diff: DiffEntry[];
  pendingWrites: PendingWrite[];
  tasks: TaskView[];
  /** 코드 패널에서 하이라이트할 태그 */
  code: string[];
  router?: RouterInfo;
  checkpointId: string | null;
  history: Checkpoint[];
  stream: StreamChunk[];
  nodeRuns: Record<string, number[]>;
  accessLog: AccessEntry[];
  interrupt?: InterruptInfo;
  error?: string;
  /** 이 프레임에서 사용자가 직접 수정할 수 있는 state 키 */
  editable?: string[];
  /** 재생 중 이 프레임에 도달하면 자동 일시정지 */
  pauseHere?: boolean;
  /** 이 실행(invoke/resume 등)의 마지막 프레임 */
  final?: boolean;
  sub?: SubView;
}
