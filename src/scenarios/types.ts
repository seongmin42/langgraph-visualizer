import type { ComponentType } from 'react';
import type { Runtime, RuntimeOptions } from '../engine/runtime';
import type { Frame, GraphSpec, StateValues } from '../engine/types';
import type { Player, PlayerSnapshot } from '../player';

export interface Pos {
  x: number;
  y: number;
  w?: number;
  h?: number;
}

export interface Layout {
  width: number;
  height: number;
  /** 노드 중심 좌표. START/END/router:이름/__state__ 포함. 서브그래프 내부는 '부모/자식' id */
  nodes: Record<string, Pos>;
  /** 엣지 곡률 (엣지 id 'from->to' → 수직 방향 오프셋 px) */
  bends?: Record<string, number>;
  /** 서브그래프 컨테이너 (노드 id → 사각형, x/y 는 좌상단) */
  containers?: Record<string, { x: number; y: number; w: number; h: number }>;
}

export interface Built {
  graph: GraphSpec;
  layout: Layout;
  code: string;
  options?: RuntimeOptions;
}

export interface Variant {
  id: string;
  label: string;
  description: string;
}

/** 시나리오별 UI 상태(선택된 thread, 입력 문구 등)를 담는 세션 */
export interface Session {
  scenario: Scenario;
  variant: string;
  built: Built;
  runtime: Runtime;
  player: Player;
  ui: Record<string, unknown>;
  /** 패널 버튼에서 새 실행을 시작할 때 사용 */
  run: (gen: Generator<Frame>, autoplay?: boolean) => void;
  rerender: () => void;
}

export interface PanelProps {
  session: Session;
  snap: PlayerSnapshot;
  frame: Frame;
}

export interface Scenario {
  id: string;
  num: number;
  title: string;
  short: string;
  /** 개념 설명 (여러 문단) */
  intro: string[];
  /** 관찰 포인트 */
  watch: string[];
  variants?: Variant[];
  build: (variant: string) => Built;
  /** ▶ 를 눌렀는데 진행 중인 실행이 없을 때 시작할 실행 */
  defaultRun: (s: Session) => Generator<Frame> | null;
  /** 첫 화면 프레임 */
  initialFrame?: (s: Session) => Frame;
  initUi?: () => Record<string, unknown>;
  /** 오른쪽 State 패널 아래 실험 패널 */
  Panel?: ComponentType<PanelProps>;
  /** 그래프 아래 넓은 패널 */
  BottomPanel?: ComponentType<PanelProps>;
  stateView?: 'default' | 'compare';
  /** 실행 전 입력 미리보기 */
  input?: (s: Session) => StateValues;
}
