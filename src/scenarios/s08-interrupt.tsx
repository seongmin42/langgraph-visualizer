import { useEffect } from 'react';
import { Timeline } from '../components/Timeline';
import { pyRepr } from '../engine/pyrepr';
import { Command, END, HUB, START, type GraphSpec } from '../engine/types';
import type { Layout, PanelProps, Scenario } from './types';
import { useUi } from './useUi';

type V = 'dynamic' | 'static';

const writeEmail = (s: Record<string, unknown>) => ({
  draft: s.feedback
    ? `안녕하세요 팀장님, 내일 회의를 오후 3시로 옮겨도 될까요? (반영한 피드백: ${s.feedback})`
    : '팀장님, 내일 회의 3시로 미뤄도 되죠?',
});

function buildGraph(v: V): GraphSpec {
  if (v === 'static') {
    return {
      name: 'interrupt-static',
      channels: [
        { key: 'request', pyType: 'str', reducer: 'overwrite' },
        { key: 'draft', pyType: 'str', reducer: 'overwrite' },
        { key: 'status', pyType: 'str', reducer: 'overwrite' },
      ],
      nodes: [
        { id: 'write_email', reads: ['request'], fn: (s) => writeEmail(s) },
        { id: 'send_email', reads: ['draft'], fn: (s) => ({ status: `발송 완료: "${String(s.draft).slice(0, 24)}…"` }) },
      ],
      edges: [
        { from: START, to: 'write_email' },
        { from: 'write_email', to: 'send_email' },
        { from: 'send_email', to: END },
      ],
      interruptBefore: ['send_email'],
    };
  }
  return {
    name: 'interrupt-dynamic',
    channels: [
      { key: 'request', pyType: 'str', reducer: 'overwrite' },
      { key: 'draft', pyType: 'str', reducer: 'overwrite' },
      { key: 'feedback', pyType: 'str', reducer: 'overwrite' },
      { key: 'status', pyType: 'str', reducer: 'overwrite' },
    ],
    nodes: [
      { id: 'write_email', reads: ['request', 'feedback'], fn: (s) => writeEmail(s) },
      {
        id: 'human_review',
        reads: ['draft'],
        fn: (s, ctx) => {
          const decision = ctx.interrupt({ question: '이 초안을 보낼까요?', draft: s.draft }) as {
            action: 'approve' | 'edit' | 'reject';
            draft?: string;
            feedback?: string;
          };
          if (decision.action === 'approve') return new Command({ update: { status: '승인됨' }, goto: 'send_email' });
          if (decision.action === 'edit')
            return new Command({ update: { draft: decision.draft, status: '사람이 수정함' }, goto: 'send_email' });
          return new Command({ update: { feedback: decision.feedback, status: '반려됨' }, goto: 'write_email' });
        },
      },
      { id: 'send_email', reads: ['draft'], fn: (s) => ({ status: `발송 완료: "${String(s.draft).slice(0, 24)}…"` }) },
    ],
    edges: [
      { from: START, to: 'write_email' },
      { from: 'write_email', to: 'human_review' },
      { from: 'send_email', to: END },
    ],
    commandEdges: [
      { from: 'human_review', to: 'send_email', label: 'approve / edit' },
      { from: 'human_review', to: 'write_email', label: 'reject' },
    ],
  };
}

const CODE_DYNAMIC = `from typing import Literal, TypedDict
from langgraph.checkpoint.memory import InMemorySaver
from langgraph.graph import StateGraph, START, END
from langgraph.types import Command, interrupt

#@begin state
class State(TypedDict):
    request: str
    draft: str
    feedback: str
    status: str
#@end

#@begin write_email
def write_email(state: State):
    return {"draft": llm_write(state["request"], state.get("feedback"))}   # mock
#@end

#@begin human_review
def human_review(state: State) -> Command[Literal["send_email", "write_email"]]:
    # ⏸ 여기서 실행이 멈춘다. resume 시에는 이 노드가 '처음부터' 다시 실행되고
    #    interrupt() 가 Command(resume=...) 로 받은 값을 반환한다.
#@end
    decision = interrupt({"question": "이 초안을 보낼까요?", "draft": state["draft"]})  #@ human_review interrupt
#@begin human_review
    if decision["action"] == "approve":
        return Command(update={"status": "승인됨"}, goto="send_email")
    if decision["action"] == "edit":
        return Command(update={"draft": decision["draft"], "status": "사람이 수정함"}, goto="send_email")
    return Command(update={"feedback": decision["feedback"], "status": "반려됨"}, goto="write_email")
#@end

#@begin send_email
def send_email(state: State):
    return {"status": f"발송 완료: {state['draft'][:24]}…"}
#@end

builder = StateGraph(State)
builder.add_node("write_email", write_email)
builder.add_node("human_review", human_review)
builder.add_node("send_email", send_email)
builder.add_edge(START, "write_email")  #@ edges
builder.add_edge("write_email", "human_review")  #@ edges
builder.add_edge("send_email", END)  #@ edges
graph = builder.compile(checkpointer=InMemorySaver())   # interrupt 에는 checkpointer 필수  #@ checkpointer

config = {"configurable": {"thread_id": "1"}}  #@ invoke
result = graph.invoke({"request": "회의 시간 변경 요청 메일"}, config)  #@ invoke
print(result["__interrupt__"])   # [Interrupt(value={'question': ..., 'draft': ...})]  #@ interrupt

#@begin resume
# 사람의 결정을 전달하며 재개
graph.invoke(Command(resume={"action": "approve"}), config)
# graph.invoke(Command(resume={"action": "edit", "draft": "..."}), config)
# graph.invoke(Command(resume={"action": "reject", "feedback": "..."}), config)
#@end
`;

const CODE_STATIC = `from typing import TypedDict
from langgraph.checkpoint.memory import InMemorySaver
from langgraph.graph import StateGraph, START, END

#@begin state
class State(TypedDict):
    request: str
    draft: str
    status: str
#@end

#@begin write_email
def write_email(state: State):
    return {"draft": llm_write(state["request"])}   # mock
#@end

#@begin send_email
def send_email(state: State):
    return {"status": f"발송 완료: {state['draft'][:24]}…"}
#@end

builder = StateGraph(State)
builder.add_node("write_email", write_email)
builder.add_node("send_email", send_email)
builder.add_edge(START, "write_email")  #@ edges
builder.add_edge("write_email", "send_email")  #@ edges
builder.add_edge("send_email", END)  #@ edges
graph = builder.compile(  #@ checkpointer interrupt
    checkpointer=InMemorySaver(),  #@ checkpointer
    interrupt_before=["send_email"],   # 정적 breakpoint: 이 노드 실행 '직전'에 멈춤  #@ interrupt
)  #@ checkpointer interrupt

config = {"configurable": {"thread_id": "1"}}  #@ invoke
graph.invoke({"request": "회의 시간 변경 요청 메일"}, config)   # send_email 앞에서 멈춤  #@ invoke

snapshot = graph.get_state(config)  #@ interrupt
print(snapshot.next)      # ('send_email',)  #@ interrupt

#@begin update_state
# (선택) 사람이 state 를 직접 고친다 → 새 checkpoint(source="update")
graph.update_state(config, {"draft": "수정된 초안"})
#@end

#@begin resume
# 입력 None 으로 invoke 하면 멈춘 지점부터 재개
graph.invoke(None, config)
#@end
`;

function InterruptPanel({ session, snap, frame }: PanelProps) {
  const v = session.variant as V;
  const rt = session.runtime;
  const last = snap.frames[snap.frames.length - 1];
  const waiting = !snap.running && last.phase === 'interrupt';
  const latest = rt.latest('1');
  const currentDraft = String(latest?.values.draft ?? '');
  const [edited, setEdited] = useUi<string>(session, 'edited', '');
  const [feedback, setFeedback] = useUi<string>(session, 'feedback', '좀 더 정중하게, 시간도 정확히');
  useEffect(() => {
    if (waiting) setEdited(currentDraft);
  }, [waiting, currentDraft]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <section className="panel">
      <header className="panel-head">
        <h2>사람의 검토 (Human-in-the-loop)</h2>
      </header>
      {waiting ? (
        <div className="stack">
          <div className="callout warn">
            <b>⏸ 실행이 멈춰 사람의 결정을 기다립니다.</b>
            <div className="mono small" style={{ marginTop: 4 }}>
              {v === 'dynamic'
                ? `__interrupt__: Interrupt(value=${pyRepr(last.interrupt?.value, 160)})`
                : `snapshot.next = ('send_email',)  —  draft = ${pyRepr(currentDraft, 120)}`}
            </div>
          </div>
          <button
            className="btn btn-ok"
            onClick={() => session.run(v === 'dynamic' ? rt.resume('1', { action: 'approve' }) : rt.resume('1'))}
          >
            ✔ 승인하고 재개 {v === 'dynamic' ? '— Command(resume={"action": "approve"})' : '— invoke(None, config)'}
          </button>
          <textarea className="text-input" rows={3} value={edited} onChange={(e) => setEdited(e.target.value)} />
          <button
            className="btn btn-warn"
            onClick={() =>
              session.run(
                v === 'dynamic'
                  ? rt.resume('1', { action: 'edit', draft: edited })
                  : rt.fork(latest!.id, { draft: edited }, {
                      title: `graph.update_state(config, {'draft': …}) 후 invoke(None) 로 재개`,
                      detail:
                        '사람이 수정한 draft 가 새 checkpoint(source="update")로 저장되었습니다. 이제 send_email 이 수정된 값을 읽습니다.',
                    }),
              )
            }
          >
            ✎ 수정해서 보내기 {v === 'dynamic' ? '— resume={"action": "edit", ...}' : '— update_state + invoke(None)'}
          </button>
          {v === 'dynamic' && (
            <>
              <input className="text-input" value={feedback} onChange={(e) => setFeedback(e.target.value)} />
              <button className="btn btn-err" onClick={() => session.run(rt.resume('1', { action: 'reject', feedback }))}>
                ✖ 반려 — resume={'{'}"action": "reject", "feedback": ...{'}'} → write_email 로 돌아감
              </button>
            </>
          )}
        </div>
      ) : (
        <div className="callout info">
          {v === 'dynamic'
            ? 'human_review 노드 안의 interrupt() 가 호출되면 실행이 멈추고 여기에 승인/수정/반려 버튼이 나타납니다. 재개하면 human_review 가 처음부터 다시 실행되는 점에 주목하세요.'
            : 'interrupt_before=["send_email"] 이므로 send_email 이 실행되기 직전 checkpoint 에서 멈춥니다. 그때 승인하거나 draft 를 고친 뒤 재개할 수 있습니다.'}
        </div>
      )}
      <h3>checkpoint 히스토리 (thread '1')</h3>
      <Timeline history={frame.history} headId={frame.checkpointId} emptyText="▶ 재생으로 시작하세요." />
    </section>
  );
}

export const s08: Scenario = {
  id: 'interrupt',
  num: 8,
  title: 'Interrupt (Human-in-the-loop)',
  short: 'Interrupt',
  intro: [
    'interrupt 는 그래프 실행을 멈추고 사람의 입력을 기다리게 합니다. 멈춘 시점의 state 는 checkpointer 에 저장되므로 checkpointer 가 꼭 필요하며, 나중에 같은 thread_id 로 재개합니다.',
    '두 가지 방식이 있습니다: ① 노드 안에서 interrupt(value) 를 호출하고 Command(resume=...) 로 재개하는 동적 방식(권장), ② compile(interrupt_before=[...]) 로 특정 노드 직전에 멈추는 정적 breakpoint.',
  ],
  watch: [
    '주황색으로 멈춘 노드와 ⏸ 아이콘, 오른쪽 승인/수정/반려 버튼',
    '동적 방식: 재개 시 human_review 가 "처음부터" 다시 실행되고 interrupt() 가 resume 값을 반환',
    '반려하면 Command(goto="write_email") 로 되돌아가 다시 검토를 요청',
  ],
  variants: [
    { id: 'dynamic', label: 'interrupt() + Command(resume)', description: '노드 안에서 interrupt() 호출 — 승인/수정/반려' },
    { id: 'static', label: 'interrupt_before', description: 'compile(interrupt_before=["send_email"]) 정적 breakpoint' },
  ],
  build: (variant) => {
    const v = variant as V;
    return {
      graph: buildGraph(v),
      code: v === 'dynamic' ? CODE_DYNAMIC : CODE_STATIC,
      options: { checkpointer: true },
      layout: (v === 'dynamic'
          ? {
              width: 920,
              height: 420,
              nodes: {
                [START]: { x: 60, y: 130 },
                write_email: { x: 220, y: 130 },
                human_review: { x: 450, y: 130 },
                send_email: { x: 680, y: 130 },
                [END]: { x: 850, y: 130 },
                [HUB]: { x: 450, y: 325 },
              },
              bends: { 'human_review->write_email': -70 },
            }
          : {
              width: 920,
              height: 400,
              nodes: {
                [START]: { x: 70, y: 110 },
                write_email: { x: 280, y: 110 },
                send_email: { x: 540, y: 110 },
                [END]: { x: 780, y: 110 },
                [HUB]: { x: 420, y: 300 },
              },
            }) as Layout,
    };
  },
  initialFrame: (s) => s.runtime.idleFrame('1'),
  defaultRun: (s) => (s.runtime.getHistory('1').length ? null : s.runtime.invoke({ request: '회의 시간 변경 요청 메일' }, '1')),
  Panel: InterruptPanel,
};
