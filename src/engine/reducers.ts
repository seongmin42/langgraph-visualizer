import type { ChannelSpec, DiffEntry, Message, ReducerKind, StateValues } from './types';

export class InvalidUpdateError extends Error {
  constructor(
    message: string,
    public key: string,
    public writers: string[],
  ) {
    super(message);
    this.name = 'InvalidUpdateError';
  }
}

let autoId = 0;

function asList(v: unknown): unknown[] {
  if (v === undefined || v === null) return [];
  return Array.isArray(v) ? v : [v];
}

function isMessage(v: unknown): v is Message {
  return typeof v === 'object' && v !== null && 'type' in v && 'content' in v;
}

/** langgraph.graph.message.add_messages: id가 같으면 교체, 없으면 뒤에 추가 */
export function addMessages(left: unknown, right: unknown): Message[] {
  const merged = asList(left).map((m) => ({ ...(m as Message) }));
  for (const raw of asList(right)) {
    if (!isMessage(raw)) throw new Error('add_messages에는 메시지만 넣을 수 있습니다');
    const m: Message = raw.id ? { ...raw } : { ...raw, id: `auto-${++autoId}` };
    const idx = merged.findIndex((x) => x.id === m.id);
    if (idx >= 0) merged[idx] = m;
    else merged.push(m);
  }
  return merged;
}

export function applyReducer(kind: ReducerKind, current: unknown, value: unknown): unknown {
  switch (kind) {
    case 'overwrite':
      return value;
    case 'add':
      if (typeof current === 'number' && typeof value === 'number') return current + value;
      return [...asList(current), ...asList(value)];
    case 'add_messages':
      return addMessages(current, value);
  }
}

export function defaultValues(channels: ChannelSpec[]): StateValues {
  const values: StateValues = {};
  for (const ch of channels) {
    // operator.add / add_messages 채널은 빈 리스트로 시작한다 (BinaryOperatorAggregate)
    if (ch.reducer !== 'overwrite') values[ch.key] = [];
  }
  return values;
}

export interface Write {
  node: string;
  update: StateValues;
}

/**
 * 한 super-step의 writes를 채널별 reducer로 한꺼번에 반영한다.
 * reducer가 없는 채널에 같은 step에서 두 번 이상 쓰면 InvalidUpdateError.
 */
export function applyWrites(
  channels: ChannelSpec[],
  values: StateValues,
  writes: Write[],
): { values: StateValues; diff: DiffEntry[] } {
  const byKey = new Map<string, { node: string; value: unknown }[]>();
  for (const w of writes) {
    for (const [key, value] of Object.entries(w.update)) {
      if (!channels.some((c) => c.key === key)) {
        throw new Error(`State에 없는 키 '${key}'에 쓰려고 했습니다 (node: ${w.node})`);
      }
      if (!byKey.has(key)) byKey.set(key, []);
      byKey.get(key)!.push({ node: w.node, value });
    }
  }
  const next: StateValues = { ...values };
  const diff: DiffEntry[] = [];
  for (const ch of channels) {
    const list = byKey.get(ch.key);
    if (!list) continue;
    if (ch.reducer === 'overwrite' && list.length > 1) {
      throw new InvalidUpdateError(
        `InvalidUpdateError: At key '${ch.key}': Can receive only one value per step. ` +
          `Use an Annotated key to handle multiple values.`,
        ch.key,
        list.map((l) => l.node),
      );
    }
    let v = values[ch.key];
    for (const item of list) v = applyReducer(ch.reducer, v, item.value);
    next[ch.key] = v;
    diff.push({
      key: ch.key,
      before: values[ch.key],
      after: v,
      reducer: ch.reducer,
      writers: list.map((l) => l.node),
      written: list.map((l) => l.value),
    });
  }
  // 키 순서는 TypedDict 에 선언된 순서를 따른다 (파이썬 dict 출력과 동일하게)
  const ordered: StateValues = {};
  for (const ch of channels) if (ch.key in next) ordered[ch.key] = next[ch.key];
  return { values: ordered, diff };
}
