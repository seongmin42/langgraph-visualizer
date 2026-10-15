import { Timeline } from '../components/Timeline';
import { ai, human } from '../engine/messages';
import { END, HUB, START, type GraphSpec, type Message } from '../engine/types';
import type { PanelProps, Scenario, Session } from './types';
import { uid, useUi } from './useUi';

function extractName(text: string): string | null {
  const m = text.match(/이름은\s*([^\s,.!?]+)/);
  if (!m) return null;
  return m[1].replace(/(이야|야|입니다|이에요|예요|이다)$/, '');
}

function mockReply(messages: Message[]): string {
  const last = messages[messages.length - 1]?.content ?? '';
  const name = extractName(last);
  if (name) return `반가워요, ${name}님! 기억해 둘게요.`;
  if (/이름/.test(last)) {
    const known = [...messages].reverse().map((m) => (m.type === 'human' ? extractName(m.content) : null)).find(Boolean);
    return known
      ? `${known}님이잖아요! (이 thread 의 이전 대화에서 기억)`
      : '아직 이름을 알려주지 않으셨어요. (이 thread 에는 그런 기록이 없어요)';
  }
  const humans = messages.filter((m) => m.type === 'human').length;
  return `"${last}" 라고 하셨군요. 이 thread 에서 ${humans}번째 메시지예요.`;
}

const graph: GraphSpec = {
  name: 'checkpoint',
  channels: [
    { key: 'messages', pyType: 'Annotated[list, add_messages]', reducer: 'add_messages' },
    { key: 'turns', pyType: 'int', reducer: 'overwrite' },
  ],
  nodes: [
    { id: 'chatbot', reads: ['messages'], fn: (s, ctx) => ({ messages: [ai(mockReply(s.messages as Message[]), `a${ctx.newId()}`)] }) },
    { id: 'count_turns', reads: ['turns'], fn: (s) => ({ turns: ((s.turns as number | undefined) ?? 0) + 1 }) },
  ],
  edges: [
    { from: START, to: 'chatbot' },
    { from: 'chatbot', to: 'count_turns' },
    { from: 'count_turns', to: END },
  ],
};

const code = `from typing import Annotated, TypedDict
from langchain_core.messages import AIMessage, HumanMessage
from langgraph.checkpoint.memory import InMemorySaver
from langgraph.graph import StateGraph, START, END
from langgraph.graph.message import add_messages

#@begin state
class State(TypedDict):
    messages: Annotated[list, add_messages]
    turns: int
#@end

#@begin chatbot
def chatbot(state: State):
    return {"messages": [AIMessage(mock_reply(state["messages"]))]}
#@end

#@begin count_turns
def count_turns(state: State):
    return {"turns": state.get("turns", 0) + 1}
#@end

builder = StateGraph(State)
builder.add_node("chatbot", chatbot)
builder.add_node("count_turns", count_turns)
builder.add_edge(START, "chatbot")  #@ edges
builder.add_edge("chatbot", "count_turns")  #@ edges
builder.add_edge("count_turns", END)  #@ edges

checkpointer = InMemorySaver()   # super-step 마다 state 스냅샷을 저장  #@ checkpointer
graph = builder.compile(checkpointer=checkpointer)  #@ checkpointer

# thread_id 가 대화(히스토리)의 단위다
config = {"configurable": {"thread_id": "alice"}}  #@ invoke
graph.invoke({"messages": [HumanMessage("내 이름은 민수야")]}, config)  #@ invoke

# 같은 thread 로 다시 invoke 하면 이전 state 에 이어서 실행된다
graph.invoke({"messages": [HumanMessage("내 이름이 뭐야?")]}, config)  #@ invoke

#@begin history
snapshot = graph.get_state(config)          # 가장 최근 체크포인트
for s in graph.get_state_history(config):    # 최신 → 과거 순
    print(s.metadata["step"], s.next, s.values)
#@end
`;

const PRESETS = ['내 이름은 민수야', '내 이름이 뭐야?', '오늘 날씨 좋다'];

function invokeOn(s: Session, thread: string, text: string) {
  return s.runtime.invoke({ messages: [human(text, uid('h'))] }, thread);
}

function ThreadPanel({ session, frame, snap }: PanelProps) {
  const [threads, setThreads] = useUi<string[]>(session, 'threads', ['alice', 'bob']);
  const [thread, setThread] = useUi<string>(session, 'thread', 'alice');
  const [text, setText] = useUi<string>(session, 'text', PRESETS[0]);
  const rt = session.runtime;

  const switchThread = (t: string) => {
    setThread(t);
    session.player.push(
      rt.idleFrame(t, rt.latest(t) ? `thread '${t}' 의 최신 state — graph.get_state(config)` : `thread '${t}' 는 아직 비어 있습니다`),
    );
  };

  return (
    <section className="panel">
      <header className="panel-head">
        <h2>thread 와 checkpoint</h2>
      </header>
      <div className="stack">
        <div className="thread-tabs">
          {threads.map((t) => (
            <button key={t} className={`thread-tab ${t === thread ? 'on' : ''}`} onClick={() => switchThread(t)}>
              {t} <span className="muted">({rt.getHistory(t).length})</span>
            </button>
          ))}
          <button
            className="thread-tab"
            onClick={() => {
              const t = `user-${threads.length + 1}`;
              setThreads([...threads, t]);
              switchThread(t);
            }}
          >
            + 새 thread
          </button>
        </div>
        <div className="presets">
          {PRESETS.map((p) => (
            <button key={p} className={`preset ${p === text ? 'on' : ''}`} onClick={() => setText(p)}>
              {p}
            </button>
          ))}
        </div>
        <div className="row">
          <input className="text-input" value={text} onChange={(e) => setText(e.target.value)} />
          <button className="btn btn-accent" disabled={snap.running} onClick={() => session.run(invokeOn(session, thread, text))}>
            invoke
          </button>
        </div>
        <div className="mono small muted">
          config = {'{'}"configurable": {'{'}"thread_id": "{thread}"{'}}'}
        </div>
      </div>

      <h3>
        get_state_history — thread '{frame.threadId ?? thread}'
      </h3>
      <Timeline
        history={frame.history}
        headId={frame.checkpointId}
        onSelect={(cp) => session.player.push(rt.inspect(cp.id))}
        emptyText="이 thread 에는 아직 checkpoint 가 없습니다. invoke 해 보세요."
      />
      <div className="callout info" style={{ marginTop: 8 }}>
        추천 순서: <b>alice</b> 에 "내 이름은 민수야" → "내 이름이 뭐야?" 를 invoke 한 뒤, <b>bob</b> 으로 바꿔 "내 이름이 뭐야?" 를
        물어보세요. thread 마다 checkpoint 히스토리가 따로 쌓여 기억이 분리됩니다.
      </div>
    </section>
  );
}

export const s06: Scenario = {
  id: 'checkpoint',
  num: 6,
  title: 'Checkpoint 와 thread',
  short: 'Checkpoint',
  intro: [
    'compile(checkpointer=...) 로 그래프를 만들면 super-step 이 끝날 때마다 state 스냅샷(checkpoint)이 저장됩니다. 각 checkpoint 에는 values, next(다음 실행 노드), metadata(step, writes) 가 담깁니다.',
    'checkpoint 는 thread_id 별로 따로 쌓입니다. 같은 thread 로 다시 invoke 하면 마지막 checkpoint 에서 이어지므로 "대화 기억"이 생기고, 다른 thread 는 완전히 독립입니다.',
  ],
  watch: [
    '오른쪽 타임라인에 step -1(input), 0, 1, 2 … checkpoint 가 쌓이는 모습',
    '같은 thread 로 다시 invoke 하면 step 번호가 이어지고 messages 가 누적',
    'thread 를 바꾸면 히스토리와 state 가 완전히 분리됨',
  ],
  build: () => ({
    graph,
    code,
    options: { checkpointer: true },
    layout: {
      width: 900,
      height: 400,
      nodes: {
        [START]: { x: 80, y: 100 },
        chatbot: { x: 290, y: 100 },
        count_turns: { x: 520, y: 100 },
        [END]: { x: 740, y: 100 },
        [HUB]: { x: 400, y: 290 },
      },
    },
  }),
  initUi: () => ({ threads: ['alice', 'bob'], thread: 'alice', text: PRESETS[0] }),
  initialFrame: (s) => s.runtime.idleFrame('alice', '▶ 재생 또는 오른쪽 invoke 버튼으로 thread "alice" 에 메시지를 보내세요'),
  defaultRun: (s) => invokeOn(s, (s.ui.thread as string) ?? 'alice', (s.ui.text as string) ?? PRESETS[0]),
  Panel: ThreadPanel,
};
