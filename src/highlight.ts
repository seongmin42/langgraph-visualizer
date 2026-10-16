import type { HighlighterCore, ThemedToken } from 'shiki/core';

// VS Code 와 같은 TextMate 문법 + VS Code 기본 테마(Light+/Dark+)로 파이썬을 칠한다.
// 첫 화면을 가볍게 하려고 하이라이터는 따로 불러온다 (그 전에는 색 없이 보인다).
let highlighter: HighlighterCore | null = null;
let loading: Promise<HighlighterCore> | null = null;

export function loadHighlighter(): Promise<HighlighterCore> {
  if (highlighter) return Promise.resolve(highlighter);
  loading ??= Promise.all([import('shiki/core'), import('shiki/engine/javascript')])
    .then(([{ createHighlighterCore }, { createJavaScriptRegexEngine }]) =>
      createHighlighterCore({
        themes: [import('@shikijs/themes/light-plus'), import('@shikijs/themes/dark-plus')],
        langs: [import('@shikijs/langs/python')],
        engine: createJavaScriptRegexEngine(),
      }),
    )
    .then((h) => (highlighter = h));
  return loading;
}

export function tokenize(code: string): ThemedToken[][] | null {
  if (!highlighter) return null;
  return highlighter.codeToTokens(code, {
    lang: 'python',
    themes: { light: 'light-plus', dark: 'dark-plus' },
    defaultColor: 'light',
  }).tokens;
}
