import { END, HUB, START, type GraphSpec } from '../engine/types';
import type { PanelProps, Scenario } from './types';

const graph: GraphSpec = {
  name: 'communication',
  channels: [
    { key: 'topic', pyType: 'str', reducer: 'overwrite' },
    { key: 'notes', pyType: 'list[str]', reducer: 'overwrite' },
    { key: 'draft', pyType: 'str', reducer: 'overwrite' },
    { key: 'feedback', pyType: 'str', reducer: 'overwrite' },
  ],
  nodes: [
    {
      id: 'researcher',
      reads: ['topic'],
      fn: (s) => ({
        notes: [`${s.topic}: 노드 = 함수`, `${s.topic}: 엣지 = 실행 순서`, `${s.topic}: state = 공유 메모리`],
      }),
    },
    {
      id: 'writer',
      reads: ['notes'],
      fn: (s) => ({ draft: `요약: ${(s.notes as string[]).map((n) => n.split(': ')[1]).join(' / ')}` }),
    },
    {
      id: 'reviewer',
      reads: ['draft'],
      fn: (s) => ({ feedback: `좋아요! (${String(s.draft).length}자) — 노트 ${String(s.draft).split('/').length}개가 모두 반영됨` }),
    },
  ],
  edges: [
    { from: START, to: 'researcher' },
    { from: 'researcher', to: 'writer' },
    { from: 'writer', to: 'reviewer' },
    { from: 'reviewer', to: END },
  ],
};

const code = `from typing import TypedDict
from langgraph.graph import StateGraph, START, END

#@begin state
class State(TypedDict):
    topic: str
    notes: list[str]
    draft: str
    feedback: str
#@end

#@begin researcher
def researcher(state: State):
    # topic 을 읽고, 결과를 state 의 notes 에 '쓴다'
    t = state["topic"]
    return {"notes": [f"{t}: 노드 = 함수", f"{t}: 엣지 = 실행 순서", f"{t}: state = 공유 메모리"]}
#@end

#@begin writer
def writer(state: State):
    # writer 는 researcher 를 호출하거나 반환값을 직접 받지 않는다.
    # 오직 공유 state 에서 notes 를 '읽을' 뿐이다.
    points = [n.split(": ")[1] for n in state["notes"]]
    return {"draft": "요약: " + " / ".join(points)}
#@end

#@begin reviewer
def reviewer(state: State):
    d = state["draft"]
    return {"feedback": f"좋아요! ({len(d)}자) — 노트 {len(d.split('/'))}개가 모두 반영됨"}
#@end

builder = StateGraph(State)
builder.add_node("researcher", researcher)
builder.add_node("writer", writer)
builder.add_node("reviewer", reviewer)
# 엣지는 '다음에 누가 실행될지'만 정한다. 데이터를 나르지 않는다.
builder.add_edge(START, "researcher")  #@ edges
builder.add_edge("researcher", "writer")  #@ edges
builder.add_edge("writer", "reviewer")  #@ edges
builder.add_edge("reviewer", END)  #@ edges
graph = builder.compile()

graph.invoke({"topic": "LangGraph"})  #@ invoke
`;

function AccessPanel({ frame }: PanelProps) {
  return (
    <section className="panel">
      <header className="panel-head">
        <h2>채널 접근 기록</h2>
        <span className="muted small">누가 어떤 키를 읽고/썼나</span>
      </header>
      {frame.accessLog.length === 0 ? (
        <div className="muted small">노드가 실행되면 여기에 기록됩니다.</div>
      ) : (
        <table className="mini">
          <thead>
            <tr>
              <th>step</th>
              <th>노드</th>
              <th>읽음 (state →)</th>
              <th>씀 (→ state)</th>
            </tr>
          </thead>
          <tbody>
            {frame.accessLog.map((a, i) => (
              <tr key={i} className={i === frame.accessLog.length - 1 ? 'current' : ''}>
                <td className="mono">{a.step}</td>
                <td className="mono">{a.node}</td>
                <td className="mono" style={{ color: 'var(--read)' }}>
                  {a.reads.join(', ')}
                </td>
                <td className="mono" style={{ color: 'var(--write)' }}>
                  {a.writes.join(', ')}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <div className="callout info" style={{ marginTop: 8 }}>
        researcher 가 쓴 <b>notes</b> 를 writer 가 읽고, writer 가 쓴 <b>draft</b> 를 reviewer 가 읽습니다. 노드 사이에
        직접 오가는 메시지는 없습니다 — 모든 데이터는 <b>공유 state</b> 를 거칩니다.
      </div>
    </section>
  );
}

export const s03: Scenario = {
  id: 'communication',
  num: 3,
  title: '노드 간 통신은 공유 State 로',
  short: '통신',
  intro: [
    'LangGraph 의 노드는 서로를 직접 호출하거나 메시지를 주고받지 않습니다. 노드는 공유 state 에서 값을 읽고, 결과를 state 에 씁니다.',
    '엣지는 "다음에 어떤 노드를 실행할지"라는 제어 흐름만 담당합니다. 이것이 노드를 독립적으로 테스트하고 재사용하기 쉬운 이유입니다.',
  ],
  watch: [
    '파란 점: state → 노드 (읽기), 노란 점: 노드 → state (쓰기)',
    '엣지를 따라가는 어두운 점은 "실행 신호"일 뿐 — 데이터는 실려 있지 않음',
    '그래프의 State 상자에서 읽히는 키(파랑)와 쓰이는 키(노랑)가 번갈아 표시됨',
  ],
  build: () => ({
    graph,
    code,
    layout: {
      width: 920,
      height: 420,
      nodes: {
        [START]: { x: 70, y: 90 },
        researcher: { x: 250, y: 90 },
        writer: { x: 460, y: 90 },
        reviewer: { x: 670, y: 90 },
        [END]: { x: 850, y: 90 },
        [HUB]: { x: 460, y: 310 },
      },
    },
  }),
  input: () => ({ topic: 'LangGraph' }),
  defaultRun: (s) => s.runtime.invoke({ topic: 'LangGraph' }),
  Panel: AccessPanel,
};
