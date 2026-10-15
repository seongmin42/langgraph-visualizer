import { REDUCER_LABEL } from '../components/StatePanel';
import { DiffView, ValueView } from '../components/ValueView';
import { ai, human, system } from '../engine/messages';
import { pyRepr } from '../engine/pyrepr';
import { END, HUB, START, type ChannelSpec, type Frame, type GraphSpec } from '../engine/types';
import type { Scenario } from './types';

const sys = system('너는 날씨 비서야', '0');
const all = (m: unknown) => ({ plain: [m], added: [m], messages: [m] });

const graph: GraphSpec = {
  name: 'reducers',
  channels: [
    { key: 'plain', pyType: 'list', reducer: 'overwrite' },
    { key: 'added', pyType: 'Annotated[list, operator.add]', reducer: 'add' },
    { key: 'messages', pyType: 'Annotated[list, add_messages]', reducer: 'add_messages' },
  ],
  nodes: [
    { id: 'user_turn', reads: [], fn: () => all(human('서울 날씨 알려줘', '1')) },
    { id: 'ai_turn', reads: [], fn: () => all(ai('서울은 맑습니다', '2')) },
    { id: 'fix_turn', reads: [], fn: () => all(ai('서울은 맑고 23℃ 입니다', '2')) },
  ],
  edges: [
    { from: START, to: 'user_turn' },
    { from: 'user_turn', to: 'ai_turn' },
    { from: 'ai_turn', to: 'fix_turn' },
    { from: 'fix_turn', to: END },
  ],
};

const code = `import operator
from typing import Annotated, TypedDict
from langchain_core.messages import AIMessage, HumanMessage, SystemMessage
from langgraph.graph import StateGraph, START, END
from langgraph.graph.message import add_messages

#@begin state
class State(TypedDict):
    plain: list                                # reducer 없음 → 새 값으로 덮어쓰기
    added: Annotated[list, operator.add]       # 기존 리스트 + 새 리스트
    messages: Annotated[list, add_messages]    # id 가 같으면 교체, 아니면 추가
#@end

def same_update(msg):
    # 세 필드에 똑같은 값을 반환해서 reducer 차이만 비교한다
    return {"plain": [msg], "added": [msg], "messages": [msg]}

#@begin user_turn
def user_turn(state: State):
    return same_update(HumanMessage("서울 날씨 알려줘", id="1"))
#@end

#@begin ai_turn
def ai_turn(state: State):
    return same_update(AIMessage("서울은 맑습니다", id="2"))
#@end

#@begin fix_turn
def fix_turn(state: State):
    # 같은 id="2" 로 내용을 고친 메시지 → add_messages 는 '교체'한다
    return same_update(AIMessage("서울은 맑고 23℃ 입니다", id="2"))
#@end

builder = StateGraph(State)
builder.add_node("user_turn", user_turn)
builder.add_node("ai_turn", ai_turn)
builder.add_node("fix_turn", fix_turn)
builder.add_edge(START, "user_turn")  #@ edges
builder.add_edge("user_turn", "ai_turn")  #@ edges
builder.add_edge("ai_turn", "fix_turn")  #@ edges
builder.add_edge("fix_turn", END)  #@ edges
graph = builder.compile()

system_msg = SystemMessage("너는 날씨 비서야", id="0")  #@ invoke
graph.invoke({"plain": [system_msg], "added": [system_msg], "messages": [system_msg]})  #@ invoke
`;

const NOTES: Record<string, string> = {
  plain: '매번 마지막으로 반환된 값만 남습니다. 이전 메시지가 사라져요.',
  added: '리스트를 계속 이어 붙입니다. 같은 id 라도 구분하지 않아 중복이 생깁니다.',
  messages: '새 id 면 추가, 이미 있는 id 면 그 자리에서 교체합니다. 대화 기록에 적합.',
};

export function CompareView({ frame, channels }: { frame: Frame; channels: ChannelSpec[] }) {
  return (
    <section className="panel">
      <header className="panel-head">
        <h2>State — reducer 비교</h2>
        <span className="muted small">같은 update 를 세 필드에 반환</span>
      </header>
      {frame.pendingWrites.length > 0 && (
        <div className="pending">
          <div className="pending-head">대기 중인 writes (세 필드에 같은 값)</div>
          {frame.pendingWrites.map((w) => (
            <div key={w.taskId} className="pending-row mono">
              <b>{w.node}</b> → {pyRepr(Object.values(w.update)[0], 80)}
            </div>
          ))}
        </div>
      )}
      <div className="compare">
        {channels.map((ch) => {
          const d = frame.diff.find((x) => x.key === ch.key);
          const changed = frame.changedKeys.includes(ch.key);
          return (
            <div key={ch.key} className={`compare-col ${changed ? 'changed' : ''}`}>
              <h4>{ch.key}</h4>
              <span className={`reducer reducer-${ch.reducer}`}>{REDUCER_LABEL[ch.reducer]}</span>
              <div className="compare-note">{NOTES[ch.key]}</div>
              {changed && d ? <DiffView d={d} /> : <ValueView v={frame.state[ch.key]} />}
              <div className="muted small" style={{ marginTop: 4 }}>
                len = {Array.isArray(frame.state[ch.key]) ? (frame.state[ch.key] as unknown[]).length : 0}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

export const s02: Scenario = {
  id: 'reducer',
  num: 2,
  title: 'Reducer: 덮어쓰기 vs 누적 vs 병합',
  short: 'Reducer',
  intro: [
    'state 의 각 키는 "새 update 를 기존 값과 어떻게 합칠지"를 정하는 reducer 를 가질 수 있습니다. Annotated[타입, reducer함수] 로 지정합니다.',
    'reducer 가 없으면 새 값으로 덮어쓰고, operator.add 는 리스트를 이어 붙이며, add_messages 는 메시지 id 를 기준으로 추가/교체합니다.',
  ],
  watch: [
    '세 노드는 매번 세 필드에 똑같은 값을 반환합니다. 결과 차이는 오직 reducer 때문!',
    'plain 은 입력으로 준 SystemMessage 가 첫 update 에서 사라짐',
    'fix_turn 이 같은 id="2" 메시지를 보내면: added 는 중복, messages 는 교체',
  ],
  stateView: 'compare',
  build: () => ({
    graph,
    code,
    layout: {
      width: 900,
      height: 380,
      nodes: {
        [START]: { x: 70, y: 100 },
        user_turn: { x: 250, y: 100 },
        ai_turn: { x: 450, y: 100 },
        fix_turn: { x: 650, y: 100 },
        [END]: { x: 820, y: 100 },
        [HUB]: { x: 450, y: 270 },
      },
    },
  }),
  input: () => ({ plain: [sys], added: [sys], messages: [sys] }),
  defaultRun: (s) => s.runtime.invoke({ plain: [sys], added: [sys], messages: [sys] }),
};
