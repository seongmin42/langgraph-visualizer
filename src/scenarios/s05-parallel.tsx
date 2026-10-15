import { END, HUB, START, type ChannelSpec, type EdgeSpec, type GraphSpec, type NodeSpec } from '../engine/types';
import type { PanelProps, Scenario } from './types';

type V = 'reducer' | 'no-reducer' | 'unbalanced' | 'join';

function buildGraph(v: V): GraphSpec {
  const unbalanced = v === 'unbalanced' || v === 'join';
  const channels: ChannelSpec[] = [
    { key: 'query', pyType: 'str', reducer: 'overwrite' },
    v === 'no-reducer'
      ? { key: 'results', pyType: 'list[str]', reducer: 'overwrite' }
      : { key: 'results', pyType: 'Annotated[list[str], operator.add]', reducer: 'add' },
    ...(unbalanced ? [{ key: 'web_raw', pyType: 'list[str]', reducer: 'overwrite' } as ChannelSpec] : []),
    { key: 'summary', pyType: 'str', reducer: 'overwrite' },
  ];
  const nodes: NodeSpec[] = [
    { id: 'plan', reads: ['query'], fn: (s) => ({ query: String(s.query).trim().toLowerCase() }) },
    unbalanced
      ? { id: 'search_web', reads: ['query'], fn: (s) => ({ web_raw: [`${s.query} 블로그 #1`, `${s.query} 블로그 #2`, `${s.query} 영상 #3`] }) }
      : { id: 'search_web', reads: ['query'], fn: (s) => ({ results: [`web: '${s.query}' 블로그 글`] }) },
    { id: 'search_docs', reads: ['query'], fn: (s) => ({ results: [`docs: '${s.query}' 공식 문서`] }) },
    { id: 'search_db', reads: ['query'], fn: (s) => ({ results: [`db: '${s.query}' 사내 위키`] }) },
    ...(unbalanced
      ? [{ id: 'rank_web', reads: ['web_raw'], fn: (s: Record<string, unknown>) => ({ results: [`web: 상위 1건 '${(s.web_raw as string[])[0]}'`] }) }]
      : []),
    {
      id: 'merge',
      reads: ['results'],
      fn: (s) => {
        const r = s.results as string[] | string;
        const list = Array.isArray(r) ? r : [r];
        return { summary: `${list.length}개 소스 종합: ${list.map((x) => x.split(':')[0]).join(' + ')}` };
      },
    },
  ];
  const edges: EdgeSpec[] = [
    { from: START, to: 'plan' },
    { from: 'plan', to: 'search_web' },
    { from: 'plan', to: 'search_docs' },
    { from: 'plan', to: 'search_db' },
    { from: 'merge', to: END },
  ];
  if (!unbalanced) {
    edges.push({ from: 'search_web', to: 'merge' }, { from: 'search_docs', to: 'merge' }, { from: 'search_db', to: 'merge' });
  } else {
    edges.push({ from: 'search_web', to: 'rank_web' });
    if (v === 'join') edges.push({ from: ['rank_web', 'search_docs', 'search_db'], to: 'merge' });
    else edges.push({ from: 'rank_web', to: 'merge' }, { from: 'search_docs', to: 'merge' }, { from: 'search_db', to: 'merge' });
  }
  return { name: `parallel-${v}`, channels, nodes, edges };
}

function buildCode(v: V): string {
  const unbalanced = v === 'unbalanced' || v === 'join';
  const resultsLine =
    v === 'no-reducer'
      ? '    results: list[str]                          # ⚠ reducer 없음!'
      : '    results: Annotated[list[str], operator.add]  # 병렬 결과를 합치는 reducer';
  const web = unbalanced
    ? `#@begin search_web
def search_web(state: State):
    return {"web_raw": [f"{state['query']} 블로그 #1", ..., f"{state['query']} 영상 #3"]}
#@end

#@begin rank_web
def rank_web(state: State):   # 웹 분기만 한 단계 더 길다
    return {"results": [f"web: 상위 1건 '{state['web_raw'][0]}'"]}
#@end`
    : `#@begin search_web
def search_web(state: State):
    return {"results": [f"web: '{state['query']}' 블로그 글"]}
#@end`;
  const fanIn =
    v === 'join'
      ? `# 대기(join) 엣지: 세 노드가 '모두' 끝나야 merge 를 한 번 실행
builder.add_edge(["rank_web", "search_docs", "search_db"], "merge")  #@ edges`
      : unbalanced
        ? `builder.add_edge("search_web", "rank_web")  #@ edges
# 개별 엣지: 어느 하나만 끝나도 merge 가 다음 step 에 실행된다
builder.add_edge("rank_web", "merge")  #@ edges
builder.add_edge("search_docs", "merge")  #@ edges
builder.add_edge("search_db", "merge")  #@ edges`
        : `for n in ["search_web", "search_docs", "search_db"]:  #@ edges
    builder.add_edge(n, "merge")      # fan-in  #@ edges`;
  return `import operator
from typing import Annotated, TypedDict
from langgraph.graph import StateGraph, START, END

#@begin state
class State(TypedDict):
    query: str
${resultsLine}${unbalanced ? '\n    web_raw: list[str]' : ''}
    summary: str
#@end

#@begin plan
def plan(state: State):
    return {"query": state["query"].strip().lower()}
#@end

${web}

#@begin search_docs
def search_docs(state: State):
    return {"results": [f"docs: '{state['query']}' 공식 문서"]}
#@end

#@begin search_db
def search_db(state: State):
    return {"results": [f"db: '{state['query']}' 사내 위키"]}
#@end

#@begin merge
def merge(state: State):
    r = state["results"]
    return {"summary": f"{len(r)}개 소스 종합: ..."}
#@end

builder = StateGraph(State)
for name, fn in [("plan", plan), ("search_web", search_web), ("search_docs", search_docs),
                 ("search_db", search_db), ${unbalanced ? '("rank_web", rank_web), ' : ''}("merge", merge)]:
    builder.add_node(name, fn)
builder.add_edge(START, "plan")  #@ edges
for n in ["search_web", "search_docs", "search_db"]:  #@ edges
    builder.add_edge("plan", n)       # fan-out: 같은 super-step 에서 동시에 실행  #@ edges
${fanIn}
builder.add_edge("merge", END)  #@ edges
graph = builder.compile()

graph.invoke({"query": "  LangGraph 병렬  "})  #@ invoke
`;
}

const NOTES: Record<V, string> = {
  reducer:
    'search_web / search_docs / search_db 가 같은 super-step 2 에서 동시에 실행되고, 각자 반환한 results 가 operator.add 로 합쳐집니다. merge 는 세 결과가 모두 반영된 뒤 super-step 3 에서 한 번 실행됩니다.',
  'no-reducer':
    'results 에 reducer 가 없으면, 같은 super-step 에서 세 노드가 results 에 쓰는 순간 어떤 값을 남겨야 할지 모르므로 InvalidUpdateError 가 발생합니다.',
  unbalanced:
    '웹 분기만 rank_web 이 하나 더 있어 길이가 다릅니다. 개별 엣지는 "어느 하나라도 끝나면" merge 를 트리거하기 때문에, merge 가 step 3(결과 2개)과 step 4(결과 3개)에 두 번 실행됩니다.',
  join: 'add_edge([...], "merge") 대기 엣지는 나열한 노드가 모두 끝날 때까지 기다립니다. 그래서 merge 는 step 4 에 결과 3개를 가지고 한 번만 실행됩니다.',
};

function StepTable({ frame, session }: PanelProps) {
  const v = session.variant as V;
  const steps = new Map<number, string[]>();
  for (const [node, ss] of Object.entries(frame.nodeRuns)) for (const s of ss) steps.set(s, [...(steps.get(s) ?? []), node]);
  const rows = [...steps.entries()].sort((a, b) => a[0] - b[0]);
  return (
    <section className="panel">
      <header className="panel-head">
        <h2>super-step 별 실행 노드</h2>
      </header>
      {rows.length === 0 ? (
        <div className="muted small">실행하면 super-step 마다 어떤 노드가 함께 실행됐는지 쌓입니다.</div>
      ) : (
        <table className="mini">
          <thead>
            <tr>
              <th>step</th>
              <th>동시에 실행된 노드</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(([s, ns]) => (
              <tr key={s} className={s === frame.superstep ? 'current' : ''}>
                <td className="mono">{s}</td>
                <td className="mono">
                  {ns.sort().join(', ')}
                  {ns.length > 1 && <span style={{ color: 'var(--accent2)' }}> ← 병렬</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <div className={`callout ${v === 'no-reducer' || v === 'unbalanced' ? 'warn' : 'info'}`} style={{ marginTop: 8 }}>
        {NOTES[v]}
      </div>
      <div className="muted small" style={{ marginTop: 6 }}>
        같은 super-step 의 writes 는 순서가 정해져 있습니다(이 앱에서는 노드 이름순) — 병렬 실행이 끝나는 순서와 무관하게 결과가
        결정적입니다.
      </div>
    </section>
  );
}

export const s05: Scenario = {
  id: 'parallel',
  num: 5,
  title: '병렬 실행과 super-step',
  short: '병렬',
  intro: [
    'LangGraph 는 Pregel 방식으로 실행됩니다. 한 super-step 에서는 "실행할 차례인 노드 전부"가 같은 state 스냅샷을 읽고 병렬로 실행되며, 그들의 writes 는 step 이 끝날 때 한꺼번에 반영됩니다.',
    '한 노드에서 여러 노드로 엣지를 내면(fan-out) 그 노드들은 같은 super-step 에 실행되고, 여러 노드가 한 노드로 모이면(fan-in) reducer 가 결과를 합칩니다.',
  ],
  watch: [
    '왼쪽 위 SUPER-STEP 번호와 노드 위 "step N" 배지 — 세 검색 노드가 같은 번호',
    'super-step 2 의 writes 3개가 results 에 operator.add 로 합쳐지는 순간',
    '변형을 바꿔 InvalidUpdateError, 불균형 분기, 대기 엣지 차이를 비교',
  ],
  variants: [
    { id: 'reducer', label: '기본 (operator.add)', description: 'fan-out 후 reducer 로 fan-in' },
    { id: 'no-reducer', label: 'reducer 없음 → 에러', description: 'results 에 reducer 를 빼면 병렬 쓰기에서 InvalidUpdateError' },
    { id: 'unbalanced', label: '불균형 분기', description: '분기 길이가 다를 때 개별 엣지는 merge 를 두 번 실행' },
    { id: 'join', label: '불균형 + 대기 엣지', description: 'add_edge([a, b, c], merge) 로 모두 끝날 때까지 대기' },
  ],
  build: (variant) => {
    const v = variant as V;
    return {
      graph: buildGraph(v),
      code: buildCode(v),
      layout: {
        width: 960,
        height: 470,
        nodes: {
          [START]: { x: 55, y: 175 },
          plan: { x: 180, y: 175 },
          search_web: { x: 390, y: 60 },
          search_docs: { x: 390, y: 175 },
          search_db: { x: 390, y: 290 },
          rank_web: { x: 590, y: 60 },
          merge: { x: 750, y: 175 },
          [END]: { x: 895, y: 175 },
          [HUB]: { x: 640, y: 395 },
        },
      },
    };
  },
  input: () => ({ query: '  LangGraph 병렬  ' }),
  defaultRun: (s) => s.runtime.invoke({ query: '  LangGraph 병렬  ' }),
  Panel: StepTable,
};
