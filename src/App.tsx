import { Moon, Sun } from 'lucide-react';
import { useCallback, useEffect, useMemo, useReducer, useState, useSyncExternalStore } from 'react';
import { CodePanel } from './components/CodePanel';
import { EventLog } from './components/EventLog';
import { GraphView, phaseLabel } from './components/GraphView';
import { StatePanel } from './components/StatePanel';
import { Transport } from './components/Transport';
import { pyRepr } from './engine/pyrepr';
import { Runtime } from './engine/runtime';
import { Player } from './player';
import { SCENARIOS } from './scenarios';
import { CompareView } from './scenarios/s02-reducers';
import type { Scenario, Session } from './scenarios/types';

function createSession(scenario: Scenario, variant: string, rerender: () => void): Session {
  const built = scenario.build(variant);
  const runtime = new Runtime(built.graph, built.options);
  const session = {
    scenario,
    variant,
    built,
    runtime,
    ui: scenario.initUi?.() ?? {},
    rerender,
  } as Session;
  session.player = new Player(scenario.initialFrame?.(session) ?? runtime.idleFrame());
  session.player.onNeedRun = () => scenario.defaultRun(session);
  session.player.restartOnEnd = !built.options?.checkpointer;
  session.run = (gen, autoplay = true) => session.player.run(gen, autoplay);
  return session;
}

function readHash() {
  const [id, variant] = location.hash.replace(/^#\/?/, '').split('/');
  const sc = SCENARIOS.find((s) => s.id === id) ?? SCENARIOS[0];
  const v = sc.variants?.find((x) => x.id === variant)?.id ?? sc.variants?.[0]?.id ?? '';
  return { sc, v };
}

const GROUPS: { title: string; nums: number[] }[] = [
  { title: '기초', nums: [1, 2, 3] },
  { title: '흐름 제어', nums: [4, 5, 9] },
  { title: '지속성과 사람의 개입', nums: [6, 7, 8] },
  { title: '구성과 관찰', nums: [10, 11] },
];

type Theme = 'light' | 'dark';

function useTheme(): [Theme, () => void] {
  const [theme, setTheme] = useState<Theme>(() => {
    try {
      const saved = localStorage.getItem('lgv-theme');
      if (saved === 'light' || saved === 'dark') return saved;
    } catch {
      /* 저장소를 쓸 수 없으면 시스템 설정을 따른다 */
    }
    return matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  });
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    try {
      localStorage.setItem('lgv-theme', theme);
    } catch {
      /* noop */
    }
  }, [theme]);
  return [theme, () => setTheme((t) => (t === 'dark' ? 'light' : 'dark'))];
}

export default function App() {
  const [{ sc, v }, setSel] = useState(readHash);
  const [nonce, setNonce] = useState(0);
  const [, rerender] = useReducer((x: number) => x + 1, 0);
  const [more, setMore] = useState(false);
  const [dock, setDock] = useState<'code' | 'log'>('code');
  const [theme, toggleTheme] = useTheme();

  const session = useMemo(() => createSession(sc, v, rerender), [sc, v, nonce]);
  useEffect(() => () => session.player.dispose(), [session]);

  useEffect(() => {
    const target = `#/${sc.id}${v ? `/${v}` : ''}`;
    if (location.hash !== target) history.replaceState(null, '', target);
  }, [sc, v]);
  useEffect(() => {
    const onHash = () => setSel(readHash());
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  useEffect(() => {
    document.querySelector('.chapter.on')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [sc]);

  const snap = useSyncExternalStore(session.player.subscribe, session.player.getSnapshot);
  const frame = snap.frame;
  const player = session.player;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT') return;
      if (e.key === ' ') {
        // 버튼에 포커스가 있을 때 Space 가 버튼 클릭으로도 처리되지 않도록
        if (el.tagName === 'BUTTON') el.blur();
        e.preventDefault();
        player.toggle();
      } else if (e.key === 'ArrowRight') player.stepForward();
      else if (e.key === 'ArrowLeft') player.stepBack();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [player]);

  const select = useCallback((s: Scenario, variant?: string) => {
    setSel({ sc: s, v: variant ?? s.variants?.[0]?.id ?? '' });
    setMore(false);
  }, []);

  const { Panel, BottomPanel } = sc;
  const canEdit = snap.atHead && (frame.editable?.length ?? 0) > 0;
  const variantInfo = sc.variants?.find((x) => x.id === v);
  const input = sc.input?.(session);
  const group = GROUPS.find((g) => g.nums.includes(sc.num));

  return (
    <div className={`app ${sc.stateView === 'compare' ? 'wide-inspector' : ''}`}>
      <nav className="sidebar" aria-label="챕터">
        <div className="wordmark">
          <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
            <circle cx="4" cy="4" r="2.6" className="wm-dot" />
            <circle cx="14" cy="9" r="2.6" className="wm-ring" />
            <circle cx="4" cy="14" r="2.6" className="wm-ring" />
            <path d="M6.3 5.2 11.8 8M11.8 10 6.3 12.8" className="wm-line" />
          </svg>
          <span>
            LangGraph<span className="wm-light"> Visualizer</span>
          </span>
        </div>

        <div className="chapters">
          {GROUPS.map((g) => (
            <div key={g.title} className="chapter-group">
              <div className="eyebrow">{g.title}</div>
              {g.nums.map((num) => {
                const s = SCENARIOS.find((x) => x.num === num)!;
                return (
                  <button key={s.id} className={`chapter ${s.id === sc.id ? 'on' : ''}`} onClick={() => select(s)}>
                    <span className="chapter-num">{String(s.num).padStart(2, '0')}</span>
                    <span className="chapter-title">{s.title}</span>
                  </button>
                );
              })}
            </div>
          ))}
        </div>

        <div className="sidebar-foot">
          <div className="keys">
            <span>
              <kbd>Space</kbd> 재생
            </span>
            <span>
              <kbd>←</kbd>
              <kbd>→</kbd> 스텝
            </span>
          </div>
          <button className="icon-btn" onClick={toggleTheme} title="테마 전환" aria-label="테마 전환">
            {theme === 'dark' ? <Sun size={15} strokeWidth={1.75} /> : <Moon size={15} strokeWidth={1.75} />}
          </button>
        </div>
      </nav>

      <main className="stage">
        <header className="chapter-head">
          <div className="eyebrow">
            Chapter {String(sc.num).padStart(2, '0')} · {group?.title}
          </div>
          <h1>{sc.title}</h1>
          <p className="lede">
            {sc.intro[0]}{' '}
            <button className="link" onClick={() => setMore((x) => !x)}>
              {more ? '접기' : '더 읽기'}
            </button>
          </p>
          {more && (
            <div className="more">
              {sc.intro.slice(1).map((p, i) => (
                <p key={i}>{p}</p>
              ))}
              <div className="watch">
                <div className="eyebrow">관찰 포인트</div>
                <ol>
                  {sc.watch.map((w, i) => (
                    <li key={i}>{w}</li>
                  ))}
                </ol>
              </div>
            </div>
          )}
          {sc.variants && (
            <div className="variant-tabs" role="tablist">
              {sc.variants.map((x) => (
                <button
                  key={x.id}
                  role="tab"
                  aria-selected={x.id === v}
                  className={x.id === v ? 'on' : ''}
                  onClick={() => select(sc, x.id)}
                  title={x.description}
                >
                  {x.label}
                </button>
              ))}
              {variantInfo && <span className="variant-desc">{variantInfo.description}</span>}
            </div>
          )}
        </header>

        <section className="canvas">
          <div className="hud">
            <div className="hud-step">
              <span className="eyebrow">Super-step</span>
              <span className="hud-num">{frame.superstep === null ? '—' : frame.superstep}</span>
              {frame.sub?.superstep !== undefined && frame.sub.superstep !== null && (
                <span className="hud-sub">sub {frame.sub.superstep}</span>
              )}
            </div>
            <div className="hud-meta">
              <span className={`hud-phase phase-${frame.phase}`}>{phaseLabel(frame.phase)}</span>
              {frame.threadId !== null && <span className="hud-thread">thread_id = {frame.threadId}</span>}
            </div>
          </div>
          <div className="legend" aria-label="범례">
            <span><i className="sw sw-read" />읽기</span>
            <span><i className="sw sw-write" />쓰기</span>
            <span><i className="sw sw-trigger" />실행 신호</span>
            <span><i className="sw sw-send" />Send</span>
            <span><i className="sw-line" />엣지</span>
            <span><i className="sw-line dashed" />조건부</span>
          </div>
          <GraphView built={session.built} frame={frame} interval={player.interval} />
        </section>

        <div className={`caption phase-${frame.phase}`} aria-live="polite">
          <div className="caption-title">{frame.title}</div>
          {frame.detail && <div className="caption-detail">{frame.detail}</div>}
        </div>

        {BottomPanel && (
          <div className="bottom-panel">
            <BottomPanel session={session} snap={snap} frame={frame} />
          </div>
        )}

        <section className="dock">
          <div className="dock-tabs" role="tablist">
            <button role="tab" aria-selected={dock === 'code'} className={dock === 'code' ? 'on' : ''} onClick={() => setDock('code')}>
              코드
            </button>
            <button role="tab" aria-selected={dock === 'log'} className={dock === 'log' ? 'on' : ''} onClick={() => setDock('log')}>
              실행 로그 <span className="count">{snap.frames.length}</span>
            </button>
            <span className="dock-hint">{dock === 'code' ? 'python · 지금 실행 중인 줄 표시' : '항목을 누르면 그 시점으로 이동'}</span>
          </div>
          {dock === 'code' ? (
            <CodePanel code={session.built.code} active={frame.code} />
          ) : (
            <EventLog frames={snap.frames} index={snap.index} onSeek={player.seek} />
          )}
        </section>
      </main>

      <aside className="inspector">
        {sc.stateView === 'compare' ? (
          <CompareView frame={frame} channels={session.built.graph.channels} />
        ) : (
          <StatePanel
            frame={frame}
            channels={session.built.graph.channels}
            canEdit={canEdit}
            onEdit={(patch) => {
              session.runtime.queuePatch(patch);
              player.stepForward();
            }}
          />
        )}
        {Panel && <Panel session={session} snap={snap} frame={frame} />}
        {input && (
          <section className="panel">
            <header className="panel-head">
              <h2>입력</h2>
            </header>
            <pre className="input-preview">graph.invoke({pyRepr(input)})</pre>
            <p className="note">재생하면 이 입력으로 실행합니다.</p>
          </section>
        )}
      </aside>

      <Transport
        snap={snap}
        onPlay={player.toggle}
        onStep={player.stepForward}
        onBack={player.stepBack}
        onReset={() => setNonce((n) => n + 1)}
        onSpeed={player.setSpeed}
        onSeek={player.seek}
      />
    </div>
  );
}
