import { END, HUB, START, type GraphSpec } from '../engine/types';
import type { PanelProps, Scenario } from './types';

const research: GraphSpec = {
  name: 'research',
  channels: [
    { key: 'question', pyType: 'str', reducer: 'overwrite' },
    { key: 'queries', pyType: 'list[str]', reducer: 'overwrite' },
    { key: 'docs', pyType: 'Annotated[list[str], operator.add]', reducer: 'add' },
    { key: 'findings', pyType: 'str', reducer: 'overwrite' },
  ],
  nodes: [
    { id: 'make_queries', reads: ['question'], fn: (s) => ({ queries: [`${s.question} 개념`, `${s.question} 예제`] }) },
    {
      id: 'search',
      reads: ['queries'],
      fn: (s) => ({ docs: (s.queries as string[]).map((q, i) => `문서${i + 1}: '${q}' 검색 결과`) }),
    },
    { id: 'summarize', reads: ['docs'], fn: (s) => ({ findings: `문서 ${(s.docs as string[]).length}개 요약: 서브그래프 = 그래프 안의 그래프` }) },
  ],
  edges: [
    { from: START, to: 'make_queries' },
    { from: 'make_queries', to: 'search' },
    { from: 'search', to: 'summarize' },
    { from: 'summarize', to: END },
  ],
};

const graph: GraphSpec = {
  name: 'parent',
  channels: [
    { key: 'question', pyType: 'str', reducer: 'overwrite' },
    { key: 'findings', pyType: 'str', reducer: 'overwrite' },
    { key: 'report', pyType: 'str', reducer: 'overwrite' },
  ],
  nodes: [
    { id: 'plan', reads: ['question'], fn: (s) => ({ question: String(s.question).replace(/\?$/, '').trim() }) },
    { id: 'research', reads: ['question'], subgraph: research },
    { id: 'write_report', reads: ['findings'], fn: (s) => ({ report: `[보고서] ${s.findings}` }) },
  ],
  edges: [
    { from: START, to: 'plan' },
    { from: 'plan', to: 'research' },
    { from: 'research', to: 'write_report' },
    { from: 'write_report', to: END },
  ],
};

const code = `import operator
from typing import Annotated, TypedDict
from langgraph.graph import StateGraph, START, END

# ── 서브그래프 ───────────────────────────────────────────
class ResearchState(TypedDict):
    question: str                               # 부모와 공유 (입력)
    queries: list[str]                          # 서브그래프 전용
    docs: Annotated[list[str], operator.add]    # 서브그래프 전용
    findings: str                               # 부모와 공유 (출력)

#@begin make_queries
def make_queries(state: ResearchState):
    q = state["question"]
    return {"queries": [f"{q} 개념", f"{q} 예제"]}
#@end

#@begin search
def search(state: ResearchState):
    return {"docs": [f"문서{i+1}: '{q}' 검색 결과" for i, q in enumerate(state["queries"])]}
#@end

#@begin summarize
def summarize(state: ResearchState):
    return {"findings": f"문서 {len(state['docs'])}개 요약: ..."}
#@end

sub = StateGraph(ResearchState)
sub.add_node("make_queries", make_queries)
sub.add_node("search", search)
sub.add_node("summarize", summarize)
sub.add_edge(START, "make_queries")  #@ edges
sub.add_edge("make_queries", "search")  #@ edges
sub.add_edge("search", "summarize")  #@ edges
sub.add_edge("summarize", END)  #@ edges
research_graph = sub.compile()  #@ research

# ── 부모 그래프 ──────────────────────────────────────────
#@begin state
class State(TypedDict):
    question: str
    findings: str
    report: str
#@end

#@begin plan
def plan(state: State):
    return {"question": state["question"].rstrip("?").strip()}
#@end

#@begin write_report
def write_report(state: State):
    return {"report": f"[보고서] {state['findings']}"}
#@end

builder = StateGraph(State)
builder.add_node("plan", plan)
builder.add_node("research", research_graph)   # 컴파일된 그래프를 그대로 노드로!  #@ research
builder.add_node("write_report", write_report)
builder.add_edge(START, "plan")  #@ edges
builder.add_edge("plan", "research")  #@ edges
builder.add_edge("research", "write_report")  #@ edges
builder.add_edge("write_report", END)  #@ edges
graph = builder.compile()

graph.invoke({"question": "LangGraph 서브그래프?"})  #@ invoke
# 내부 진행까지 보려면: graph.stream(..., subgraphs=True)
`;

function SubgraphPanel({ frame }: PanelProps) {
  return (
    <section className="panel">
      <header className="panel-head">
        <h2>state 경계</h2>
      </header>
      <table className="mini">
        <thead>
          <tr>
            <th>키</th>
            <th>부모</th>
            <th>서브그래프</th>
          </tr>
        </thead>
        <tbody>
          {[
            ['question', '있음', '있음 · 입력으로 전달'],
            ['findings', '있음', '있음 · 결과로 반환'],
            ['queries', '—', '전용'],
            ['docs', '—', '전용'],
            ['report', '있음', '—'],
          ].map(([k, p, s]) => (
            <tr key={k} className={frame.sub?.changedKeys.includes(k) || frame.changedKeys.includes(k) ? 'current' : ''}>
              <td className="mono">{k}</td>
              <td>{p}</td>
              <td>{s}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="callout info" style={{ marginTop: 8 }}>
        부모 그래프 입장에서 research 는 super-step 하나를 차지하는 "노드 하나"입니다. 그 안에서는 서브그래프가 자기 state 로
        여러 super-step 을 돌고(왼쪽 위 <b>› sub N</b>), 끝나면 이름이 같은 키(question, findings)만 부모에게 돌려줍니다.
      </div>
    </section>
  );
}

export const s10: Scenario = {
  id: 'subgraph',
  num: 10,
  title: '서브그래프',
  short: '서브그래프',
  intro: [
    '컴파일된 그래프는 다른 그래프의 노드로 그대로 넣을 수 있습니다. 부모와 서브그래프의 State 에서 이름이 같은 키를 통해 값이 오갑니다.',
    '서브그래프 전용 키는 바깥으로 새지 않습니다. 복잡한 에이전트를 팀/모듈 단위로 나누어 조립할 때 쓰는 패턴입니다.',
  ],
  watch: [
    '부모 super-step 2 동안 서브그래프 내부가 sub step 0, 1, 2, 3 으로 진행',
    '오른쪽 State 패널 아래 "서브그래프 내부 State" 에 전용 키(queries, docs)가 채워짐',
    '종료 시 공유 키 findings 만 부모 state 로 올라감',
  ],
  build: () => ({
    graph,
    code,
    layout: {
      width: 980,
      height: 470,
      nodes: {
        [START]: { x: 55, y: 110 },
        plan: { x: 170, y: 110 },
        write_report: { x: 870, y: 110 },
        [END]: { x: 870, y: 215 },
        [HUB]: { x: 860, y: 395 },
        'research/__start__': { x: 330, y: 105 },
        'research/make_queries': { x: 475, y: 105 },
        'research/search': { x: 640, y: 105 },
        'research/summarize': { x: 640, y: 195 },
        'research/__end__': { x: 470, y: 195 },
        'research/__state__': { x: 495, y: 320 },
      },
      containers: { research: { x: 270, y: 40, w: 470, h: 360 } },
    },
  }),
  input: () => ({ question: 'LangGraph 서브그래프?' }),
  defaultRun: (s) => s.runtime.invoke({ question: 'LangGraph 서브그래프?' }),
  Panel: SubgraphPanel,
};
