import { useEffect, useMemo, useRef } from 'react';

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

const KW = new Set(
  'def class return if elif else for in while import from as with not and or is lambda yield try except raise pass None True False async await'.split(' '),
);
const BUILTIN = new Set('len list dict str int float print next range isinstance any all sum max min sorted enumerate'.split(' '));

type Tok = { t: string; c?: string };

function tokenize(line: string): Tok[] {
  const toks: Tok[] = [];
  let i = 0;
  let prevWord = '';
  while (i < line.length) {
    const rest = line.slice(i);
    let m: RegExpMatchArray | null;
    if (rest[0] === '#') {
      toks.push({ t: rest, c: 'tk-com' });
      break;
    }
    if ((m = rest.match(/^[fr]?("""|'''|"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')/))) {
      toks.push({ t: m[0], c: 'tk-str' });
      i += m[0].length;
      continue;
    }
    if ((m = rest.match(/^@\w+/))) {
      toks.push({ t: m[0], c: 'tk-dec' });
      i += m[0].length;
      continue;
    }
    if ((m = rest.match(/^\d+(\.\d+)?/))) {
      toks.push({ t: m[0], c: 'tk-num' });
      i += m[0].length;
      continue;
    }
    if ((m = rest.match(/^[A-Za-z_]\w*/))) {
      const w = m[0];
      const after = line.slice(i + w.length);
      let c: string | undefined;
      if (KW.has(w)) c = 'tk-kw';
      else if (prevWord === 'def' || prevWord === 'class') c = 'tk-def';
      else if (BUILTIN.has(w)) c = 'tk-bi';
      else if (/^[A-Z]/.test(w)) c = 'tk-cls';
      else if (/^\s*\(/.test(after)) c = 'tk-call';
      toks.push({ t: w, c });
      prevWord = w;
      i += w.length;
      continue;
    }
    toks.push({ t: rest[0] });
    i += 1;
  }
  return toks;
}

export function CodePanel({ code, active }: { code: string; active: string[] }) {
  const lines = useMemo(() => parseCode(code), [code]);
  const tokenized = useMemo(() => lines.map((l) => tokenize(l.text)), [lines]);
  const box = useRef<HTMLDivElement>(null);
  const hl = lines.map((l) => l.tags.some((t) => active.includes(t)));
  const first = hl.indexOf(true);
  const last = hl.lastIndexOf(true);

  useEffect(() => {
    const el = box.current;
    if (!el || first < 0) return;
    const rowH = 19;
    const top = first * rowH;
    const bottom = (last + 1) * rowH;
    const view = el.clientHeight;
    if (top < el.scrollTop + 8 || bottom > el.scrollTop + view - 8) {
      const target = bottom - top < view - 40 ? top - (view - (bottom - top)) / 2 : top - 20;
      el.scrollTo({ top: Math.max(0, target), behavior: 'smooth' });
    }
  }, [first, last, code]);

  return (
    <div className="code" ref={box}>
      <pre>
        {tokenized.map((toks, i) => (
          <div key={i} className={`code-line ${hl[i] ? 'hl' : ''}`}>
            <span className="ln">{i + 1}</span>
            <span className="lc">
              {toks.map((t, j) =>
                t.c ? (
                  <span key={j} className={t.c}>
                    {t.t}
                  </span>
                ) : (
                  t.t
                ),
              )}
              {'\n'}
            </span>
          </div>
        ))}
      </pre>
    </div>
  );
}
