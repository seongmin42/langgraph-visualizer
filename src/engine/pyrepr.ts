import type { Message } from './types';

const MSG_CLASS: Record<Message['type'], string> = {
  human: 'HumanMessage',
  ai: 'AIMessage',
  system: 'SystemMessage',
  tool: 'ToolMessage',
};

export function isMessage(v: unknown): v is Message {
  return typeof v === 'object' && v !== null && 'type' in v && 'content' in v && 'id' in v;
}

/** 파이썬 repr 규칙: 작은따옴표가 있고 큰따옴표가 없으면 큰따옴표로 감싼다 */
function str(s: string) {
  const esc = s.replace(/\\/g, '\\\\').replace(/\n/g, '\\n');
  if (s.includes("'") && !s.includes('"')) return `"${esc}"`;
  return `'${esc.replace(/'/g, "\\'")}'`;
}

/** JS 값을 파이썬 repr 처럼 표현 (화면 표시용) */
export function pyRepr(v: unknown, max = Infinity): string {
  const out = repr(v);
  return out.length > max ? out.slice(0, Math.max(1, max - 1)) + '…' : out;
}

function repr(v: unknown): string {
  if (v === undefined || v === null) return 'None';
  if (typeof v === 'string') return str(v);
  if (typeof v === 'boolean') return v ? 'True' : 'False';
  if (typeof v === 'number') return Number.isInteger(v) ? String(v) : String(Math.round(v * 100) / 100);
  if (Array.isArray(v)) return `[${v.map(repr).join(', ')}]`;
  if (isMessage(v)) return `${MSG_CLASS[v.type]}(${str(v.content)}, id=${str(v.id)})`;
  if (typeof v === 'object') {
    return `{${Object.entries(v as Record<string, unknown>)
      .map(([k, x]) => `${str(k)}: ${repr(x)}`)
      .join(', ')}}`;
  }
  return String(v);
}
