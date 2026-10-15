import { END, HUB, START, type GraphSpec } from '../engine/types';
import type { Scenario } from './types';

const QUESTION = 'LangGraph state 는 어떻게 업데이트되나요';

const graph: GraphSpec = {
  name: 'state-basics',
  channels: [
    { key: 'question', pyType: 'str', reducer: 'overwrite' },
    { key: 'word_count', pyType: 'int', reducer: 'overwrite' },
    { key: 'keywords', pyType: 'list[str]', reducer: 'overwrite' },
    { key: 'answer', pyType: 'str', reducer: 'overwrite' },
  ],
  nodes: [
    {
      id: 'parse',
      reads: ['question'],
      fn: (s) => ({ word_count: String(s.question).split(/\s+/).filter(Boolean).length }),
    },
    {
      id: 'extract',
      reads: ['question'],
      fn: (s) => ({ keywords: String(s.question).split(/\s+/).filter((w) => /^[\x00-\x7F]+$/.test(w)) }),
    },
    {
      id: 'draft',
      reads: ['keywords'],
      fn: (s) => ({ answer: `(초안) ${(s.keywords as string[]).join(', ')} 에 대한 설명` }),
    },
    {
      id: 'polish',
      reads: ['answer', 'word_count'],
      fn: (s) => ({
        answer: `${String(s.answer).replace('(초안) ', '')}: 노드는 바뀐 키만 반환하고, 나머지 키는 그대로 유지됩니다. (질문 ${s.word_count}단어)`,
      }),
    },
  ],
  edges: [
    { from: START, to: 'parse' },
    { from: 'parse', to: 'extract' },
    { from: 'extract', to: 'draft' },
    { from: 'draft', to: 'polish' },
    { from: 'polish', to: END },
  ],
};

const code = `from typing import TypedDict
from langgraph.graph import StateGraph, START, END

#@begin state
class State(TypedDict):
    question: str
    word_count: int
    keywords: list[str]
    answer: str
#@end

#@begin parse
def parse(state: State) -> dict:
    words = state["question"].split()
    # state 전체가 아니라 '바꿀 키'만 담은 partial update 를 반환
    return {"word_count": len(words)}
#@end

#@begin extract
def extract(state: State) -> dict:
    words = state["question"].split()
    return {"keywords": [w for w in words if w.isascii()]}
#@end

#@begin draft
def draft(state: State) -> dict:
    # 실제로는 LLM 호출 자리 (여기서는 mock)
    return {"answer": f"(초안) {', '.join(state['keywords'])} 에 대한 설명"}
#@end

#@begin polish
def polish(state: State) -> dict:
    # 같은 키(answer)를 다시 반환하면 reducer 가 없으므로 덮어쓴다
    better = state["answer"].replace("(초안) ", "") + ": 노드는 바뀐 키만 반환하고, ..."
    return {"answer": better}
#@end

builder = StateGraph(State)
builder.add_node("parse", parse)
builder.add_node("extract", extract)
builder.add_node("draft", draft)
builder.add_node("polish", polish)
builder.add_edge(START, "parse")  #@ edges
builder.add_edge("parse", "extract")  #@ edges
builder.add_edge("extract", "draft")  #@ edges
builder.add_edge("draft", "polish")  #@ edges
builder.add_edge("polish", END)  #@ edges
graph = builder.compile()

result = graph.invoke({"question": "${QUESTION}"})  #@ invoke
`;

export const s01: Scenario = {
  id: 'state',
  num: 1,
  title: 'State와 노드 업데이트',
  short: 'State',
  intro: [
    'StateGraph 의 State 는 TypedDict 로 정의한 "공유 메모리"입니다. 각 키는 내부적으로 하나의 채널(channel)이 됩니다.',
    '노드는 state 를 입력으로 받아 state 전체가 아니라 바꾸고 싶은 키만 담은 dict(partial update)를 반환합니다. 반환하지 않은 키는 그대로 유지됩니다.',
  ],
  watch: [
    '각 노드가 반환하는 dict 에 어떤 키가 들어 있는지 (오른쪽 "대기 중인 writes")',
    '바뀐 키만 색으로 표시되고 이전 값 → 새 값 diff 가 나타남',
    'polish 노드가 answer 를 다시 쓰면 reducer 가 없으므로 덮어쓰기',
  ],
  build: () => ({
    graph,
    code,
    layout: {
      width: 920,
      height: 400,
      nodes: {
        [START]: { x: 60, y: 110 },
        parse: { x: 205, y: 110 },
        extract: { x: 370, y: 110 },
        draft: { x: 535, y: 110 },
        polish: { x: 700, y: 110 },
        [END]: { x: 850, y: 110 },
        [HUB]: { x: 455, y: 300 },
      },
    },
  }),
  input: () => ({ question: QUESTION }),
  defaultRun: (s) => s.runtime.invoke({ question: QUESTION }),
};
