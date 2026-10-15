import { pyRepr } from '../engine/pyrepr';
import { END, HUB, START, Send, type GraphSpec } from '../engine/types';
import type { PanelProps, Scenario } from './types';
import { useUi } from './useUi';

const SUBJECTS: Record<string, string[]> = {
  동물: ['고양이', '펭귄', '나무늘보', '앵무새'],
  회사생활: ['월요일', '회의', '야근'],
  음식: ['라면', '민트초코'],
};

const JOKES: Record<string, string> = {
  고양이: '고양이가 키보드를 밟았다 — 커밋 메시지가 더 나아졌다',
  펭귄: '펭귄은 정장을 입고 태어나서 면접 걱정이 없다',
  나무늘보: '나무늘보에게 "빨리"는 다음 주라는 뜻이다',
  앵무새: '앵무새가 회의록을 대신 써 준다 — 그대로',
  월요일: '월요일은 일요일 밤 11시부터 시작된다',
  회의: '이 회의는 메일로 충분했을 회의입니다',
  야근: '야근은 계획에 없었는데 일정에는 있었다',
  라면: '라면은 물 조절이 인생 조절이다',
  민트초코: '민트초코는 치약이 아니라 신념이다',
};
const joke = (s: string) => JOKES[s] ?? `${s}에 대한 농담: 아직 아무도 웃지 않았다`;

const graph: GraphSpec = {
  name: 'send',
  channels: [
    { key: 'topic', pyType: 'str', reducer: 'overwrite' },
    { key: 'subjects', pyType: 'list[str]', reducer: 'overwrite' },
    { key: 'jokes', pyType: 'Annotated[list[str], operator.add]', reducer: 'add' },
    { key: 'best', pyType: 'str', reducer: 'overwrite' },
  ],
  nodes: [
    {
      id: 'generate_subjects',
      reads: ['topic'],
      fn: (s) => ({ subjects: SUBJECTS[String(s.topic)] ?? ['하나', '둘'] }),
    },
    { id: 'write_joke', reads: ['subject'], fn: (s) => ({ jokes: [joke(String(s.subject))] }) },
    {
      id: 'pick_best',
      reads: ['jokes'],
      fn: (s) => ({ best: [...(s.jokes as string[])].sort((a, b) => b.length - a.length)[0] ?? '' }),
    },
  ],
  edges: [
    { from: START, to: 'generate_subjects' },
    { from: 'write_joke', to: 'pick_best' },
    { from: 'pick_best', to: END },
  ],
  conditionalEdges: [
    {
      from: 'generate_subjects',
      routerName: 'continue_to_jokes',
      reads: ['subjects'],
      router: (s) => (s.subjects as string[]).map((sub) => new Send('write_joke', { subject: sub })),
      targets: ['write_joke'],
    },
  ],
};

const code = `import operator
from typing import Annotated, TypedDict
from langgraph.graph import StateGraph, START, END
from langgraph.types import Send

#@begin state
class OverallState(TypedDict):
    topic: str
    subjects: list[str]
    jokes: Annotated[list[str], operator.add]   # 여러 Send 결과를 모은다
    best: str
#@end

class JokeState(TypedDict):      # write_joke 가 받는 '개별' 입력
    subject: str

#@begin generate_subjects
def generate_subjects(state: OverallState):
    return {"subjects": llm_list_subjects(state["topic"])}   # mock
#@end

#@begin continue_to_jokes
def continue_to_jokes(state: OverallState):
    # 개수가 실행 시점에 정해지는 동적 fan-out (map-reduce 의 map)
    return [Send("write_joke", {"subject": s}) for s in state["subjects"]]
#@end

#@begin write_joke
def write_joke(state: JokeState):
    # 공유 state 가 아니라 Send 로 받은 {"subject": ...} 가 입력
    return {"jokes": [llm_joke(state["subject"])]}
#@end

#@begin pick_best
def pick_best(state: OverallState):
    return {"best": max(state["jokes"], key=len)}
#@end

builder = StateGraph(OverallState)
builder.add_node("generate_subjects", generate_subjects)
builder.add_node("write_joke", write_joke)
builder.add_node("pick_best", pick_best)
builder.add_edge(START, "generate_subjects")  #@ edges
builder.add_conditional_edges("generate_subjects", continue_to_jokes, ["write_joke"])  #@ continue_to_jokes
builder.add_edge("write_joke", "pick_best")  #@ edges
builder.add_edge("pick_best", END)  #@ edges
graph = builder.compile()

graph.invoke({"topic": "동물"})  #@ invoke
`;

function SendPanel({ session, frame }: PanelProps) {
  const [topic, setTopic] = useUi<string>(session, 'topic', '동물');
  const sends = frame.router?.sends.length ? frame.router.sends : frame.tasks.filter((t) => t.push).map((t) => ({ node: t.node, arg: t.arg! }));
  return (
    <section className="panel">
      <header className="panel-head">
        <h2>Send 실험</h2>
      </header>
      <div className="stack">
        <div className="presets">
          {Object.entries(SUBJECTS).map(([k, v]) => (
            <button key={k} className={`preset ${k === topic ? 'on' : ''}`} onClick={() => setTopic(k)}>
              {k} <span className="muted">({v.length}개 주제)</span>
            </button>
          ))}
        </div>
        <button className="btn btn-accent" onClick={() => session.run(session.runtime.invoke({ topic }))}>
          graph.invoke({'{'}"topic": "{topic}"{'}'})
        </button>
      </div>
      <h3>생성된 Send 태스크</h3>
      {sends.length === 0 ? (
        <div className="muted small">continue_to_jokes 가 실행되면 Send 목록이 여기에 표시됩니다.</div>
      ) : (
        <table className="mini">
          <tbody>
            {sends.map((s, i) => (
              <tr key={i}>
                <td className="mono" style={{ color: 'var(--send)' }}>
                  Send('{s.node}', {pyRepr(s.arg)})
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <div className="callout info" style={{ marginTop: 8 }}>
        router 직전에서 자동으로 멈춥니다. 위 State 패널에서 <b>subjects</b> 를 쉼표로 늘리거나 줄여 보세요 — Send 개수, 즉 병렬로
        실행되는 write_joke 인스턴스 수가 바뀝니다.
      </div>
    </section>
  );
}

export const s09: Scenario = {
  id: 'send',
  num: 9,
  title: 'Send API — 동적 분기 (map-reduce)',
  short: 'Send',
  intro: [
    '조건부 엣지의 router 가 노드 이름 대신 Send(node, arg) 리스트를 반환하면, 같은 노드를 서로 다른 입력으로 여러 번 병렬 실행합니다. 몇 개로 갈라질지는 실행 시점의 state 로 결정됩니다.',
    '각 Send 태스크는 공유 state 대신 자신만의 arg 를 입력으로 받고, 결과는 reducer(operator.add)로 공유 state 에 모입니다.',
  ],
  watch: [
    '분홍 Send 패킷이 각자 다른 {"subject": ...} 를 싣고 write_joke 로 이동',
    'write_joke 아래 인스턴스 칩 ×N — 모두 같은 super-step 에서 실행',
    '주제 수를 바꾸면 Send 개수가 달라짐 (동물 4 / 회사생활 3 / 음식 2)',
  ],
  build: () => ({
    graph,
    code,
    options: { breakAtRouters: ['continue_to_jokes'], editableKeys: ['subjects'] },
    layout: {
      width: 960,
      height: 450,
      nodes: {
        [START]: { x: 55, y: 120 },
        generate_subjects: { x: 225, y: 120 },
        'router:continue_to_jokes': { x: 410, y: 120 },
        write_joke: { x: 580, y: 120 },
        pick_best: { x: 770, y: 120 },
        [END]: { x: 905, y: 120 },
        [HUB]: { x: 250, y: 360 },
      },
      reserve: [{ x: 580, y: 250 }],
    },
  }),
  initUi: () => ({ topic: '동물' }),
  defaultRun: (s) => s.runtime.invoke({ topic: (s.ui.topic as string) ?? '동물' }),
  Panel: SendPanel,
};
