import { useEffect, useRef } from 'react';
import { pyRepr } from '../engine/pyrepr';
import { END, HUB, START, type GraphSpec, type StreamChunk } from '../engine/types';
import type { PanelProps, Scenario } from './types';

const graph: GraphSpec = {
  name: 'stream',
  channels: [
    { key: 'topic', pyType: 'str', reducer: 'overwrite' },
    { key: 'data', pyType: 'str', reducer: 'overwrite' },
    { key: 'analyses', pyType: 'Annotated[list[str], operator.add]', reducer: 'add' },
    { key: 'report', pyType: 'str', reducer: 'overwrite' },
  ],
  nodes: [
    { id: 'fetch', reads: ['topic'], fn: (s) => ({ data: `${s.topic} 매출 데이터` }) },
    { id: 'analyze_trend', reads: ['data'], fn: () => ({ analyses: ['추세: 상승'] }) },
    { id: 'analyze_risk', reads: ['data'], fn: () => ({ analyses: ['리스크: 낮음'] }) },
    { id: 'report', reads: ['analyses'], fn: (s) => ({ report: (s.analyses as string[]).join(', ') }) },
  ],
  edges: [
    { from: START, to: 'fetch' },
    { from: 'fetch', to: 'analyze_trend' },
    { from: 'fetch', to: 'analyze_risk' },
    { from: 'analyze_trend', to: 'report' },
    { from: 'analyze_risk', to: 'report' },
    { from: 'report', to: END },
  ],
};

const code = `import operator
from typing import Annotated, TypedDict
from langgraph.graph import StateGraph, START, END

class State(TypedDict):
    topic: str
    data: str
    analyses: Annotated[list[str], operator.add]
    report: str

#@begin fetch
def fetch(state):          return {"data": f"{state['topic']} 매출 데이터"}
#@end
#@begin analyze_trend
def analyze_trend(state):  return {"analyses": ["추세: 상승"]}
#@end
#@begin analyze_risk
def analyze_risk(state):   return {"analyses": ["리스크: 낮음"]}
#@end
#@begin report
def report(state):         return {"report": ", ".join(state["analyses"])}
#@end

builder = StateGraph(State)
# ... add_node / add_edge 생략: fetch → (analyze_trend, analyze_risk) → report  #@ edges
graph = builder.compile()
inputs = {"topic": "3분기"}

#@begin state
# ① values: super-step 이 끝날 때마다 '전체 state' 를 내보낸다
for chunk in graph.stream(inputs, stream_mode="values"):
    print(chunk)

# ② updates: 각 노드가 반환한 'update 만' {노드이름: update} 로 내보낸다
for chunk in graph.stream(inputs, stream_mode="updates"):
    print(chunk)
#@end

# 둘 다: stream_mode=["values", "updates"] → (mode, chunk) 튜플
`;

function Console({ title, desc, chunks, prevSeq }: { title: string; desc: string; chunks: StreamChunk[]; prevSeq: number }) {
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    box.current?.scrollTo({ top: box.current.scrollHeight, behavior: 'smooth' });
  }, [chunks.length]);
  return (
    <div className="stream-col">
      <div className="stream-head">
        {title} <span className="muted">— {desc}</span>
      </div>
      <div className="stream-body" ref={box}>
        {chunks.length === 0 && <div className="stream-chunk muted"># 아직 출력 없음</div>}
        {chunks.map((c) => (
          <div key={c.seq} className={`stream-chunk ${c.seq > prevSeq ? 'fresh' : ''}`}>
            <span className="k">step {c.step} ›</span> {pyRepr(c.payload)}
          </div>
        ))}
      </div>
    </div>
  );
}

function StreamConsoles({ frame, snap }: PanelProps) {
  const prev = snap.index > 0 ? snap.frames[snap.index - 1].stream : [];
  const prevSeq = prev.length ? prev[prev.length - 1].seq : 0;
  const values = frame.stream.filter((c) => c.mode === 'values');
  const updates = frame.stream.filter((c) => c.mode === 'updates');
  return (
    <div className="streams">
      <Console title='stream_mode="values"' desc={`${values.length}개 chunk`} chunks={values} prevSeq={prevSeq} />
      <Console title='stream_mode="updates"' desc={`${updates.length}개 chunk`} chunks={updates} prevSeq={prevSeq} />
    </div>
  );
}

function StreamNotes({ frame }: PanelProps) {
  const v = frame.stream.filter((c) => c.mode === 'values').length;
  const u = frame.stream.filter((c) => c.mode === 'updates').length;
  return (
    <section className="panel">
      <header className="panel-head">
        <h2>values vs updates</h2>
      </header>
      <table className="mini">
        <thead>
          <tr>
            <th></th>
            <th>values</th>
            <th>updates</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>언제</td>
            <td>super-step 마다 1개</td>
            <td>노드 실행마다 1개</td>
          </tr>
          <tr>
            <td>내용</td>
            <td>전체 state</td>
            <td>{'{노드: 반환한 update}'}</td>
          </tr>
          <tr>
            <td>병렬 step</td>
            <td>합쳐진 결과 1개</td>
            <td>노드별로 따로</td>
          </tr>
          <tr>
            <td>입력 직후</td>
            <td>입력 state 도 출력</td>
            <td>출력 없음</td>
          </tr>
          <tr className="current">
            <td>지금까지</td>
            <td className="mono">{v}개</td>
            <td className="mono">{u}개</td>
          </tr>
        </tbody>
      </table>
      <div className="callout info" style={{ marginTop: 8 }}>
        super-step 2 에서 analyze_trend 와 analyze_risk 가 병렬로 실행될 때, <b>updates</b> 에는 chunk 가 2개, <b>values</b> 에는
        합쳐진 state 1개가 나오는 것을 확인해 보세요. 이 밖에 LLM 토큰 단위의 "messages", 사용자 정의 "custom", 디버깅용 "debug"
        모드도 있습니다.
      </div>
    </section>
  );
}

export const s11: Scenario = {
  id: 'stream',
  num: 11,
  title: 'stream_mode: values vs updates',
  short: 'Stream',
  intro: [
    'graph.stream() 은 실행 도중의 중간 결과를 하나씩 내보냅니다. stream_mode 에 따라 무엇을 내보내는지가 달라집니다.',
    '"values" 는 super-step 이 끝날 때마다 전체 state 를, "updates" 는 노드가 반환한 update 만 {노드 이름: update} 형태로 내보냅니다.',
  ],
  watch: [
    '아래 두 콘솔에 chunk 가 쌓이는 타이밍 (새 chunk 는 파랗게 표시)',
    'values 의 첫 chunk 는 입력 그대로의 state (super-step 0)',
    '병렬 super-step 에서 updates 는 2개, values 는 1개',
  ],
  build: () => ({
    graph,
    code,
    layout: {
      width: 920,
      height: 380,
      nodes: {
        [START]: { x: 55, y: 140 },
        fetch: { x: 185, y: 140 },
        analyze_trend: { x: 400, y: 70 },
        analyze_risk: { x: 400, y: 210 },
        report: { x: 615, y: 140 },
        [END]: { x: 760, y: 140 },
        [HUB]: { x: 790, y: 300 },
      },
    },
  }),
  input: () => ({ topic: '3분기' }),
  defaultRun: (s) => s.runtime.invoke({ topic: '3분기' }),
  Panel: StreamNotes,
  BottomPanel: StreamConsoles,
};
