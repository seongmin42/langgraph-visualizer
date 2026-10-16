import { Timeline } from '../components/Timeline';
import { pyRepr } from '../engine/pyrepr';
import { END, HUB, START, type GraphSpec } from '../engine/types';
import type { PanelProps, Scenario } from './types';
import { useUi } from './useUi';

const PHRASES: Record<string, string[]> = {
  고양이: ['상자만 보면 들어가고 본다', '새벽 4시에 우다다를 시작한다', '키보드 위가 제일 따뜻하다는 걸 안다'],
  강아지: ['산책이라는 단어에 귀가 번쩍 선다', '꼬리로 기분을 전부 말해 버린다', '간식 봉지 소리는 3층에서도 듣는다'],
};
const phrase = (topic: string, attempt: number) => {
  const list = PHRASES[topic] ?? [`${topic}은(는) 생각보다 재미있다`, `${topic}에는 숨은 이야기가 많다`, `${topic}을(를) 다시 보게 된다`];
  return list[(attempt - 1) % list.length];
};

const graph: GraphSpec = {
  name: 'timetravel',
  channels: [
    { key: 'request', pyType: 'str', reducer: 'overwrite' },
    { key: 'topic', pyType: 'str', reducer: 'overwrite' },
    { key: 'draft', pyType: 'str', reducer: 'overwrite' },
    { key: 'title', pyType: 'str', reducer: 'overwrite' },
  ],
  nodes: [
    { id: 'pick_topic', reads: ['request'], fn: () => ({ topic: '고양이' }) },
    {
      id: 'write_draft',
      reads: ['topic'],
      // mock LLM: 같은 입력이어도 호출할 때마다 결과가 달라지는 것을 흉내
      fn: (s, ctx) => ({ draft: `${s.topic}는 ${phrase(String(s.topic), ctx.attempt)}. (생성 #${ctx.attempt})` }),
    },
    { id: 'make_title', reads: ['topic', 'draft'], fn: (s) => ({ title: `「${s.topic}」의 비밀` }) },
  ],
  edges: [
    { from: START, to: 'pick_topic' },
    { from: 'pick_topic', to: 'write_draft' },
    { from: 'write_draft', to: 'make_title' },
    { from: 'make_title', to: END },
  ],
};

const code = `from typing import TypedDict
from langgraph.checkpoint.memory import InMemorySaver
from langgraph.graph import StateGraph, START, END

#@begin state
class State(TypedDict):
    request: str
    topic: str
    draft: str
    title: str
#@end

#@begin pick_topic
def pick_topic(state: State):
    return {"topic": "고양이"}                     # mock LLM
#@end

#@begin write_draft
def write_draft(state: State):
    return {"draft": llm_write(state["topic"])}    # 호출할 때마다 결과가 다를 수 있음
#@end

#@begin make_title
def make_title(state: State):
    return {"title": f"「{state['topic']}」의 비밀"}
#@end

builder = StateGraph(State)
builder.add_node("pick_topic", pick_topic)
builder.add_node("write_draft", write_draft)
builder.add_node("make_title", make_title)
builder.add_edge(START, "pick_topic")  #@ edges
builder.add_edge("pick_topic", "write_draft")  #@ edges
builder.add_edge("write_draft", "make_title")  #@ edges
builder.add_edge("make_title", END)  #@ edges
graph = builder.compile(checkpointer=InMemorySaver())  #@ checkpointer

config = {"configurable": {"thread_id": "1"}}  #@ invoke
graph.invoke({"request": "동물에 관한 짧은 글"}, config)  #@ invoke

#@begin history
# 1) 과거 checkpoint 찾기 (get_state_history 는 최신 → 과거 순)
history = list(graph.get_state_history(config))
before_draft = next(s for s in history if s.next == ("write_draft",))
#@end

#@begin replay
# 2) 그 시점부터 그대로 다시 실행 → 이후 노드만 재실행, 새 분기 생성
graph.invoke(None, before_draft.config)
#@end

#@begin update_state
# 3) state 를 고쳐서 fork → update_state 가 새 checkpoint 를 만들고 그 config 를 돌려준다
fork_config = graph.update_state(before_draft.config, {"topic": "강아지"})
graph.invoke(None, fork_config)
#@end
`;

function TimeTravelPanel({ session, frame, snap }: PanelProps) {
  const rt = session.runtime;
  const [selected, setSelected] = useUi<string | null>(session, 'selected', null);
  const [topic, setTopic] = useUi<string>(session, 'topic', '강아지');
  const history = rt.getHistory('1');
  const cp = selected ? rt.getCheckpoint(selected) : undefined;
  const suggested = history.find((c) => c.next.length === 1 && c.next[0].node === 'write_draft' && c.source === 'loop');

  return (
    <section className="panel">
      <header className="panel-head">
        <h2>타임라인 (thread '1')</h2>
        <span className="muted small">클릭해서 과거로 이동</span>
      </header>
      <Timeline
        history={frame.history.length ? frame.history : history}
        headId={frame.checkpointId}
        selectedId={selected}
        onSelect={(c) => {
          setSelected(c.id);
          session.player.push(rt.inspect(c.id, `checkpoint #${c.seq} (step ${c.step}) 로 시간 여행 — 이 시점의 state 복원`));
        }}
        emptyText="먼저 재생해서 그래프를 한 번 실행하세요."
      />

      {cp ? (
        <div className="stack" style={{ marginTop: 10 }}>
          <div className="callout warn">
            <b>선택: checkpoint #{cp.seq}</b> · step {cp.step} · source="{cp.source}"
            <br />
            next = ({cp.next.map((t) => `'${t.node}'`).join(', ')}
            {cp.next.length === 1 ? ',' : ''})
            <div className="mono small" style={{ marginTop: 4, wordBreak: 'break-all' }}>
              values = {pyRepr(cp.values, 220)}
            </div>
          </div>
          <button
            className="btn btn-accent"
            disabled={snap.running || cp.next.length === 0}
            onClick={() => session.run(rt.replay(cp.id))}
          >
            여기서 그대로 다시 실행 (replay)
          </button>
          <div className="row">
            <span className="mono small">topic =</span>
            <input className="text-input" value={topic} onChange={(e) => setTopic(e.target.value)} />
          </div>
          <button
            className="btn btn-warn"
            disabled={snap.running || cp.next.length === 0}
            onClick={() => session.run(rt.fork(cp.id, { topic }))}
          >
            update_state 로 topic 수정 후 fork
          </button>
          {cp.next.length === 0 && <div className="muted small">마지막 checkpoint 는 next 가 비어 있어 이어서 실행할 노드가 없습니다.</div>}
        </div>
      ) : (
        <div className="callout info" style={{ marginTop: 10 }}>
          {history.length === 0 ? (
            <>먼저 재생하면 super-step 마다 checkpoint 가 쌓입니다.</>
          ) : (
            <>
              추천: <b>#{suggested?.seq ?? '?'} (next: write_draft)</b> 를 선택한 뒤 ① replay 로 다시 생성해 보고, ② topic 을 바꿔 fork 해
              보세요. 원래 기록은 지워지지 않고 타임라인에 분기가 생깁니다.
            </>
          )}
        </div>
      )}
    </section>
  );
}

export const s07: Scenario = {
  id: 'timetravel',
  num: 7,
  title: 'Time travel 과 fork',
  short: 'Time travel',
  intro: [
    'checkpointer 가 저장한 과거 checkpoint 의 config(checkpoint_id 포함)로 invoke(None, config) 하면, 그 시점부터 다시 실행됩니다(replay). 이전 단계는 다시 실행하지 않습니다.',
    'update_state(config, values) 로 과거 시점의 state 를 고치면 그 checkpoint 를 부모로 하는 새 checkpoint 가 만들어지고, 거기서 실행하면 새로운 분기(fork)가 생깁니다. 원래 히스토리는 그대로 남습니다.',
  ],
  watch: [
    '타임라인에서 과거 checkpoint 를 클릭하면 변수 창이 그 시점 값으로 복원',
    'replay: write_draft 부터만 다시 실행되고 (생성 #2) 처럼 결과가 달라짐',
    'fork: source="update" checkpoint 가 생기고 타임라인이 갈라짐',
  ],
  build: () => ({
    graph,
    code,
    options: { checkpointer: true },
    layout: {
      width: 920,
      height: 400,
      nodes: {
        [START]: { x: 60, y: 100 },
        pick_topic: { x: 225, y: 100 },
        write_draft: { x: 440, y: 100 },
        make_title: { x: 655, y: 100 },
        [END]: { x: 845, y: 100 },
        [HUB]: { x: 450, y: 290 },
      },
    },
  }),
  initUi: () => ({ selected: null, topic: '강아지' }),
  initialFrame: (s) => s.runtime.idleFrame('1'),
  defaultRun: (s) => (s.runtime.getHistory('1').length ? null : s.runtime.invoke({ request: '동물에 관한 짧은 글' }, '1')),
  Panel: TimeTravelPanel,
};
