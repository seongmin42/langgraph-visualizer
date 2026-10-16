import { useEffect, useMemo, useRef, useState } from 'react';
import { loadHighlighter, tokenize } from '../highlight';

interface Line {
  text: string;
  tags: string[];
}

/**
 * 시나리오 코드의 태그 문법
 *  - 줄 끝 `  #@ tag1 tag2` : 그 줄에 태그
 *  - `#@begin tag` ... `#@end` : 블록 전체에 태그 (마커 줄은 화면에서 제거)
 */
export function parseCode(src: string): Line[] {
  const out: Line[] = [];
  const stack: string[][] = [];
  for (const raw of src.replace(/\n$/, '').split('\n')) {
    const begin = raw.match(/^\s*#@begin\s+(.+)$/);
    if (begin) {
      stack.push(begin[1].split(/[\s,]+/));
      continue;
    }
    if (/^\s*#@end\s*$/.test(raw)) {
      stack.pop();
      continue;
    }
    const inline = raw.match(/\s+#@\s*([\w\-:, ]+)$/);
    const text = inline ? raw.slice(0, inline.index) : raw;
    const tags = [...stack.flat(), ...(inline ? inline[1].split(/[\s,]+/).filter(Boolean) : [])];
    out.push({ text, tags });
  }
  return out;
}

/** 태그가 처음 등장하는 줄 번호(1부터) — 콜 스택의 `파일:줄` 표시에 쓴다 */
export function firstLineOf(code: string, tag: string): number | null {
  const i = parseCode(code).findIndex((l) => l.tags.includes(tag));
  return i < 0 ? null : i + 1;
}

const ROW = 19;

export function CodePanel({ code, active }: { code: string; active: string[] }) {
  const lines = useMemo(() => parseCode(code), [code]);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    let alive = true;
    loadHighlighter().then(() => alive && setReady(true));
    return () => {
      alive = false;
    };
  }, []);
  const tokens = useMemo(() => (ready ? tokenize(lines.map((l) => l.text).join('\n')) : null), [ready, lines]);

  const box = useRef<HTMLDivElement>(null);
  const hl = lines.map((l) => l.tags.some((t) => active.includes(t)));
  const first = hl.indexOf(true);
  const last = hl.lastIndexOf(true);

  useEffect(() => {
    const el = box.current;
    if (!el || first < 0) return;
    const top = first * ROW;
    const bottom = (last + 1) * ROW;
    const view = el.clientHeight;
    if (top < el.scrollTop + 8 || bottom > el.scrollTop + view - 8) {
      const target = bottom - top < view - 40 ? top - (view - (bottom - top)) / 2 : top - 20;
      el.scrollTo({ top: Math.max(0, target), behavior: 'smooth' });
    }
  }, [first, last, code]);

  return (
    <div className="code" ref={box}>
      <pre>
        {lines.map((l, i) => (
          <div key={i} className={`code-line ${hl[i] ? 'hl' : ''} ${i === first ? 'hl-first' : ''}`}>
            <span className="glyph">{i === first && <i className="codicon codicon-debug-stackframe" />}</span>
            <span className="ln">{i + 1}</span>
            <span className="lc">
              {tokens?.[i]
                ? tokens[i].map((t, j) => (
                    <span key={j} style={t.htmlStyle as React.CSSProperties}>
                      {t.content}
                    </span>
                  ))
                : l.text}
              {'\n'}
            </span>
          </div>
        ))}
      </pre>
    </div>
  );
}
