import { describe, expect, it } from 'vitest';
import { pyRepr } from './pyrepr';

describe('pyRepr', () => {
  it('파이썬 repr 처럼 표시한다', () => {
    expect(pyRepr({ a: [1, 'x'], b: null, c: true })).toBe("{'a': [1, 'x'], 'b': None, 'c': True}");
    expect(pyRepr("web: 'q' 글")).toBe(`"web: 'q' 글"`);
    expect(pyRepr({ id: '1', type: 'ai', content: 'hi' })).toBe("AIMessage('hi', id='1')");
    expect(pyRepr('abcdef', 4)).toBe("'ab…");
  });
});

describe('applyWrites key order', () => {
  it('state 키 순서는 채널 선언 순서', async () => {
    const { applyWrites } = await import('./reducers');
    const { values } = applyWrites(
      [
        { key: 'a', pyType: 'str', reducer: 'overwrite' },
        { key: 'b', pyType: 'list', reducer: 'add' },
      ],
      { b: [] },
      [{ node: 'n', update: { a: 'x' } }],
    );
    expect(Object.keys(values)).toEqual(['a', 'b']);
  });
});
