import { useState } from 'react';
import { pyRepr } from '../engine/pyrepr';
import { END, HUB, START, type GraphSpec, type StateValues } from '../engine/types';
import type { PanelProps, Scenario } from './types';

const POS = ['좋', '최고', '감사', '만족', '훌륭', '빨', '빠르'];
const NEG = ['별로', '최악', '실망', '느려', '느리', '환불', '고장'];

export function mockSentiment(text: string): number {
  const pos = POS.filter((w) => text.includes(w)).length;
  const neg = NEG.filter((w) => text.includes(w)).length;
  if (pos + neg === 0) return 0;
  return Math.round(((pos - neg) / (pos + neg)) * 100) / 100;
}

const label = (score: number) => (score >= 0.3 ? 'positive' : score <= -0.3 ? 'negative' : 'neutral');

const graph: GraphSpec = {
  name: 'conditional',
  channels: [
    { key: 'text', pyType: 'str', reducer: 'overwrite' },
    { key: 'score', pyType: 'float', reducer: 'overwrite' },
    { key: 'reply', pyType: 'str', reducer: 'overwrite' },
  ],
  nodes: [
    { id: 'classify', reads: ['text'], fn: (s) => ({ score: mockSentiment(String(s.text)) }) },
    { id: 'thank', reads: ['text'], fn: () => ({ reply: '칭찬 감사합니다! 쿠폰을 보내드릴게요.' }) },
    { id: 'ask_more', reads: ['text'], fn: () => ({ reply: '조금 더 자세히 알려주실 수 있을까요?' }) },
    { id: 'apologize', reads: ['text'], fn: () => ({ reply: '불편을 드려 죄송합니다. 상담원을 연결해 드릴게요.' }) },
  ],
  edges: [
    { from: START, to: 'classify' },
    { from: 'thank', to: END },
    { from: 'ask_more', to: END },
    { from: 'apologize', to: END },
  ],
  conditionalEdges: [
    {
      from: 'classify',
      routerName: 'route_by_score',
      reads: ['score'],
      router: (s) => label(Number(s.score)),
      pathMap: { positive: 'thank', neutral: 'ask_more', negative: 'apologize' },
      targets: ['thank', 'ask_more', 'apologize'],
      explain: (s) => {
        const sc = Number(s.score);
        const l = label(sc);
        return [
          { cond: 'score >= 0.3', target: '"positive" → thank', matched: l === 'positive' },
          { cond: 'score <= -0.3', target: '"negative" → apologize', matched: l === 'negative' },
          { cond: 'else', target: '"neutral" → ask_more', matched: l === 'neutral' },
        ];
      },
    },
  ],
};

const code = `from typing import Literal, TypedDict
from langgraph.graph import StateGraph, START, END

#@begin state
class State(TypedDict):
    text: str
    score: float      # -1.0(부정) ~ 1.0(긍정)
    reply: str
#@end

#@begin classify
def classify(state: State):
    return {"score": mock_sentiment(state["text"])}   # LLM 대신 키워드 점수
#@end

#@begin route_by_score
def route_by_score(state: State) -> Literal["positive", "negative", "neutral"]:
    # router 는 state 를 '읽기만' 하고, 다음 경로의 이름을 반환한다
    if state["score"] >= 0.3:
        return "positive"
    elif state["score"] <= -0.3:
        return "negative"
    return "neutral"
#@end

#@begin thank
def thank(state: State):
    return {"reply": "칭찬 감사합니다! 쿠폰을 보내드릴게요."}
#@end

#@begin ask_more
def ask_more(state: State):
    return {"reply": "조금 더 자세히 알려주실 수 있을까요?"}
#@end

#@begin apologize
def apologize(state: State):
    return {"reply": "불편을 드려 죄송합니다. 상담원을 연결해 드릴게요."}
#@end

builder = StateGraph(State)
for name, fn in [("classify", classify), ("thank", thank), ("ask_more", ask_more), ("apologize", apologize)]:
    builder.add_node(name, fn)
builder.add_edge(START, "classify")  #@ edges
builder.add_conditional_edges(  #@ route_by_score
    "classify",  #@ route_by_score
    route_by_score,  #@ route_by_score
    {"positive": "thank", "neutral": "ask_more", "negative": "apologize"},  #@ route_by_score
)  #@ route_by_score
for n in ["thank", "ask_more", "apologize"]:  #@ edges
    builder.add_edge(n, END)  #@ edges
graph = builder.compile()

graph.invoke({"text": user_text})  #@ invoke
`;

const PRESETS = [
  '배송도 빠르고 품질도 최고예요, 감사합니다!',
  '주문한 상품 색상이 어떤가요?',
  '제품이 별로고 배송도 느려서 실망했어요',
  '디자인은 좋은데 배송이 느려요',
];

function RouterLab({ session, frame, snap }: PanelProps) {
  const [text, setText] = useState<string>((session.ui.text as string) ?? PRESETS[0]);
  const set = (t: string) => {
    session.ui.text = t;
    setText(t);
  };
  const ce = session.built.graph.conditionalEdges![0];
  const values: StateValues = frame.state;
  const rows = frame.router?.rows.length ? frame.router.rows : 'score' in values ? ce.explain!(values) : [];
  const pending = frame.phase === 'route-pending' && snap.atHead;
  return (
    <section className="panel">
      <header className="panel-head">
        <h2>Router 실험실</h2>
      </header>
      <div className="stack">
        <div className="presets">
          {PRESETS.map((p) => (
            <button key={p} className={`preset ${p === text ? 'on' : ''}`} onClick={() => set(p)}>
              {p}
            </button>
          ))}
        </div>
        <div className="row">
          <input className="text-input" value={text} onChange={(e) => set(e.target.value)} />
          <button className="btn btn-accent" onClick={() => session.run(session.runtime.invoke({ text }))}>
            실행
          </button>
        </div>
        <div className="muted small">
          mock 점수: <span className="mono">{mockSentiment(text)}</span> (긍정 단어: {POS.join(' ')} / 부정: {NEG.join(' ')})
        </div>
      </div>

      <h3>route_by_score() 판단 표</h3>
      <div className="rules">
        {rows.length === 0 ? (
          <div className="muted small">classify 가 score 를 기록하면 표시됩니다.</div>
        ) : (
          rows.map((r, i) => (
            <div key={i} className={`rule ${r.matched && frame.router && !frame.router.pending ? 'matched' : ''}`}>
              <span>{r.cond}</span>
              <span>{r.target}</span>
            </div>
          ))
        )}
      </div>
      {frame.router && (
        <div className="muted small" style={{ marginTop: 6 }}>
          router 가 읽은 값: {frame.router.reads.map((r) => `${r.key}=${pyRepr(r.value)}`).join(', ')}
        </div>
      )}
      <div className={`callout ${pending ? 'warn' : 'info'}`} style={{ marginTop: 8 }}>
        {pending ? (
          <>
            <b>router 직전에서 멈췄습니다.</b> 위 변수 창의 <b>score</b> 값을 바꾸고 적용하면, router
            가 바뀐 값으로 다른 경로를 고릅니다. 그대로 다음 스텝으로 가면 원래 값으로 진행합니다.
          </>
        ) : (
          <>실행하면 router 가 판단하기 직전에 자동으로 멈춥니다. 그때 state 의 score 를 직접 바꿔 다른 경로를 실험할 수 있어요.</>
        )}
      </div>
    </section>
  );
}

export const s04: Scenario = {
  id: 'conditional',
  num: 4,
  title: '조건부 엣지 (router)',
  short: '조건부 엣지',
  intro: [
    'add_conditional_edges(source, router, path_map) 은 source 노드가 끝난 뒤 router 함수를 실행해 다음 노드를 고릅니다.',
    'router 는 갱신된 state 를 읽기만 하고 경로 이름을 반환합니다. path_map 이 그 이름을 실제 노드로 연결합니다.',
  ],
  watch: [
    '마름모(router)에 현재 프레임 화살표가 와서 state 의 score 를 읽는 순간',
    '선택된 경로만 밝아지고 나머지 경로는 흐려짐',
    'router 직전 breakpoint 에서 score 를 바꾸면 다른 노드로 감',
  ],
  build: () => ({
    graph,
    code,
    options: { breakAtRouters: ['route_by_score'], editableKeys: ['score'] },
    layout: {
      width: 920,
      height: 430,
      nodes: {
        [START]: { x: 60, y: 160 },
        classify: { x: 205, y: 160 },
        'router:route_by_score': { x: 370, y: 160 },
        thank: { x: 590, y: 55 },
        ask_more: { x: 590, y: 160 },
        apologize: { x: 590, y: 265 },
        [END]: { x: 820, y: 160 },
        [HUB]: { x: 250, y: 345 },
      },
    },
  }),
  initUi: () => ({ text: PRESETS[0] }),
  defaultRun: (s) => s.runtime.invoke({ text: (s.ui.text as string) ?? PRESETS[0] }),
  Panel: RouterLab,
};
