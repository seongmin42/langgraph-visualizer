import { describe, expect, it } from 'vitest';
import { s01 } from '../scenarios/s01-state';
import { s02 } from '../scenarios/s02-reducers';
import { s04 } from '../scenarios/s04-conditional';
import { s05 } from '../scenarios/s05-parallel';
import { s06 } from '../scenarios/s06-checkpoint';
import { s07 } from '../scenarios/s07-timetravel';
import { s08 } from '../scenarios/s08-interrupt';
import { s09 } from '../scenarios/s09-send';
import { s10 } from '../scenarios/s10-subgraph';
import { s11 } from '../scenarios/s11-stream';
import { SCENARIOS } from '../scenarios';
import { buildScene } from '../geometry';
import type { Scenario } from '../scenarios/types';
import { addMessages, applyWrites, InvalidUpdateError } from './reducers';
import { Runtime } from './runtime';
import type { Frame, Message } from './types';
import { human } from './messages';

const drain = (gen: Generator<Frame>) => [...gen];
const last = (fs: Frame[]) => fs[fs.length - 1];
const rt = (sc: Scenario, variant = '') => {
  const b = sc.build(variant);
  return new Runtime(b.graph, b.options);
};

describe('reducers', () => {
  it('add_messages 는 같은 id 를 교체하고 새 id 를 추가한다', () => {
    const out = addMessages(
      [{ id: '1', type: 'human', content: 'a' }],
      [
        { id: '1', type: 'human', content: 'a2' },
        { id: '2', type: 'ai', content: 'b' },
      ],
    );
    expect(out.map((m) => [m.id, m.content])).toEqual([
      ['1', 'a2'],
      ['2', 'b'],
    ]);
  });

  it('reducer 없는 키에 한 step 에서 두 번 쓰면 InvalidUpdateError', () => {
    expect(() =>
      applyWrites([{ key: 'x', pyType: 'int', reducer: 'overwrite' }], {}, [
        { node: 'a', update: { x: 1 } },
        { node: 'b', update: { x: 2 } },
      ]),
    ).toThrow(InvalidUpdateError);
  });
});

describe('scenarios', () => {
  it('모든 시나리오의 그래프가 레이아웃과 함께 그려진다', () => {
    for (const sc of SCENARIOS) {
      for (const v of sc.variants?.map((x) => x.id) ?? ['']) {
        const b = sc.build(v);
        expect(() => buildScene(b.graph, b.layout), `${sc.id}/${v}`).not.toThrow();
      }
    }
  });

  it('1. partial update 만 반영되고 나머지 키는 유지된다', () => {
    const r = rt(s01);
    const fs = drain(r.invoke({ question: 'LangGraph state 는 어떻게 업데이트되나요' }));
    const end = last(fs);
    expect(end.phase).toBe('end');
    expect(end.state.word_count).toBe(5);
    expect(end.state.keywords).toEqual(['LangGraph', 'state']);
    expect(end.state.question).toBe('LangGraph state 는 어떻게 업데이트되나요');
    const polishApply = fs.find((f) => f.phase === 'apply' && f.superstep === 4)!;
    expect(polishApply.changedKeys).toEqual(['answer']);
    expect(String(polishApply.diff[0].before)).toContain('(초안)');
  });

  it('2. 덮어쓰기 / operator.add / add_messages 결과가 다르다', () => {
    const r = rt(s02);
    const end = last(drain(s02.defaultRun({ runtime: r } as never)!));
    const plain = end.state.plain as Message[];
    const added = end.state.added as Message[];
    const messages = end.state.messages as Message[];
    expect(plain).toHaveLength(1);
    expect(added.map((m) => m.id)).toEqual(['0', '1', '2', '2']);
    expect(messages.map((m) => m.id)).toEqual(['0', '1', '2']);
    expect(messages[2].content).toContain('23℃');
  });

  it('4. router 가 score 로 경로를 고르고, breakpoint 에서 수정하면 다른 경로로 간다', () => {
    const r1 = rt(s04);
    const fs1 = drain(r1.invoke({ text: '배송도 빠르고 품질도 최고예요, 감사합니다!' }));
    expect(fs1.find((f) => f.phase === 'route' && f.router)!.router!.result).toEqual(['thank']);

    const r2 = rt(s04);
    const gen = r2.invoke({ text: '배송도 빠르고 품질도 최고예요, 감사합니다!' });
    const frames: Frame[] = [];
    for (const f of gen) {
      frames.push(f);
      if (f.phase === 'route-pending') r2.queuePatch({ score: -0.8 });
    }
    expect(frames.some((f) => f.phase === 'update')).toBe(true);
    expect(frames.find((f) => f.phase === 'route' && f.router)!.router!.result).toEqual(['apologize']);
    expect(last(frames).state.reply).toContain('죄송');
  });

  it('5. 병렬 실행: 같은 super-step, reducer 로 합침 / 에러 / 불균형 / 대기 엣지', () => {
    const run = (v: string) => drain(rt(s05, v).invoke({ query: ' X ' }));
    const ok = last(run('reducer'));
    expect(ok.nodeRuns.search_web).toEqual([2]);
    expect(ok.nodeRuns.search_docs).toEqual([2]);
    expect(ok.nodeRuns.merge).toEqual([3]);
    expect(ok.state.results).toHaveLength(3);

    const err = last(run('no-reducer'));
    expect(err.phase).toBe('error');
    expect(err.errorNodes.sort()).toEqual(['search_db', 'search_docs', 'search_web']);

    const unb = last(run('unbalanced'));
    expect(unb.nodeRuns.merge).toEqual([3, 4]);

    const join = last(run('join'));
    expect(join.nodeRuns.merge).toEqual([4]);
    expect(String(join.state.summary)).toMatch(/^3개/);
  });

  it('6. thread 마다 히스토리가 분리되고, 같은 thread 는 이어서 실행된다', () => {
    const r = rt(s06);
    drain(r.invoke({ messages: [human('내 이름은 민수야', 'h1')] }, 'alice'));
    const a2 = last(drain(r.invoke({ messages: [human('내 이름이 뭐야?', 'h2')] }, 'alice')));
    const b1 = last(drain(r.invoke({ messages: [human('내 이름이 뭐야?', 'h3')] }, 'bob')));
    expect((a2.state.messages as Message[]).at(-1)!.content).toContain('민수');
    expect((b1.state.messages as Message[]).at(-1)!.content).toContain('아직');
    expect(a2.state.turns).toBe(2);
    expect(b1.state.turns).toBe(1);
    expect(r.getHistory('alice').map((c) => c.step)).toEqual([-1, 0, 1, 2, 3, 4, 5, 6]);
    expect(r.getHistory('bob').map((c) => c.step)).toEqual([-1, 0, 1, 2]);
  });

  it('7. replay 와 update_state fork 는 과거 checkpoint 에서 분기를 만든다', () => {
    const r = rt(s07);
    drain(r.invoke({ request: '동물' }, '1'));
    const target = r.getHistory('1').find((c) => c.next[0]?.node === 'write_draft')!;
    const replay = last(drain(r.replay(target.id)));
    expect(String(replay.state.draft)).toContain('생성 #2');
    const fork = last(drain(r.fork(target.id, { topic: '강아지' })));
    expect(fork.state.title).toBe('「강아지」의 비밀');
    const children = r.getHistory('1').filter((c) => c.parentId === target.id);
    expect(children).toHaveLength(3);
    expect(children.map((c) => c.source)).toEqual(['loop', 'loop', 'update']);
  });

  it('8. interrupt(): 멈춘 뒤 resume 값으로 재개, 반려 시 다시 검토', () => {
    const r = rt(s08, 'dynamic');
    const f1 = drain(r.invoke({ request: 'x' }, '1'));
    expect(last(f1).phase).toBe('interrupt');
    expect(last(f1).interruptedNodes).toEqual(['human_review']);
    const f2 = drain(r.resume('1', { action: 'reject', feedback: '정중하게' }));
    expect(last(f2).phase).toBe('interrupt');
    expect(String(last(f2).state.draft)).toContain('정중하게');
    const f3 = drain(r.resume('1', { action: 'edit', draft: '최종 초안입니다' }));
    expect(last(f3).phase).toBe('end');
    expect(String(last(f3).state.status)).toContain('최종 초안');
  });

  it('8. interrupt_before: send_email 직전에서 멈추고 update_state 후 재개', () => {
    const r = rt(s08, 'static');
    const f1 = drain(r.invoke({ request: 'x' }, '1'));
    expect(last(f1).phase).toBe('interrupt');
    expect(r.latest('1')!.next.map((t) => t.node)).toEqual(['send_email']);
    const f2 = drain(r.fork(r.latest('1')!.id, { draft: '고친 초안' }));
    expect(String(last(f2).state.status)).toContain('고친 초안');
  });

  it('9. Send: 주제 수만큼 같은 노드가 병렬 실행된다', () => {
    const r = rt(s09);
    const frames: Frame[] = [];
    for (const f of r.invoke({ topic: '동물' })) {
      frames.push(f);
      if (f.phase === 'route-pending') r.queuePatch({ subjects: ['라면', '회의'] });
    }
    const route = frames.find((f) => f.phase === 'route' && f.router)!;
    expect(route.router!.sends).toHaveLength(2);
    expect(last(frames).state.jokes).toHaveLength(2);
    expect(last(frames).nodeRuns.write_joke).toEqual([2, 2]);
  });

  it('10. 서브그래프 전용 키는 부모로 새지 않는다', () => {
    const fs = drain(rt(s10).invoke({ question: 'LangGraph 서브그래프?' }));
    const end = last(fs);
    expect(end.state.report).toContain('[보고서]');
    expect('queries' in end.state).toBe(false);
    expect(fs.some((f) => f.sub && (f.sub.state.queries as string[] | undefined)?.length === 2)).toBe(true);
  });

  it('11. values 는 step 마다, updates 는 노드마다 나온다', () => {
    const end = last(drain(rt(s11).invoke({ topic: '3분기' })));
    const values = end.stream.filter((c) => c.mode === 'values');
    const updates = end.stream.filter((c) => c.mode === 'updates');
    expect(values.map((c) => c.step)).toEqual([0, 1, 2, 3]);
    expect(updates.map((c) => c.step)).toEqual([1, 2, 2, 3]);
  });
});
