import { useCallback, useEffect, useMemo, useReducer, useState, useSyncExternalStore } from 'react';
import { CodePanel } from './components/CodePanel';
import { Controls } from './components/Controls';
import { EventLog } from './components/EventLog';
import { GraphView, phaseLabel } from './components/GraphView';
import { StatePanel } from './components/StatePanel';
import { Runtime } from './engine/runtime';
import { pyRepr } from './engine/pyrepr';
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

export default function App() {
  const [{ sc, v }, setSel] = useState(readHash);
  const [nonce, setNonce] = useState(0);
  const [, rerender] = useReducer((x: number) => x + 1, 0);
  const [showIntro, setShowIntro] = useState(false);

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

  const snap = useSyncExternalStore(session.player.subscribe, session.player.getSnapshot);
  const frame = snap.frame;
  const player = session.player;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement).tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      if (e.key === ' ') {
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
  }, []);

  const { Panel, BottomPanel } = sc;
  const canEdit = snap.atHead && (frame.editable?.length ?? 0) > 0;
  const variantInfo = sc.variants?.find((x) => x.id === v);
  const input = sc.input?.(session);

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="logo">◆</span> LangGraph Visualizer
          <span className="muted brand-sub">mock 노드로 배우는 실행 모델</span>
        </div>
        <nav className="tabs">
          {SCENARIOS.map((s) => (
            <button key={s.id} className={`tab ${s.id === sc.id ? 'on' : ''}`} onClick={() => select(s)} title={s.title}>
              <span className="tab-num">{s.num}</span>
              {s.short}
            </button>
          ))}
        </nav>
      </header>

      <div className="toolbar">
        <div className="scenario-title">
          <h1>
            {sc.num}. {sc.title}
          </h1>
          {sc.variants && (
            <div className="variants">
              {sc.variants.map((x) => (
                <button key={x.id} className={`variant ${x.id === v ? 'on' : ''}`} onClick={() => select(sc, x.id)} title={x.description}>
                  {x.label}
                </button>
              ))}
            </div>
          )}
        </div>
        <Controls
          snap={snap}
          onPlay={player.toggle}
          onStep={player.stepForward}
          onBack={player.stepBack}
          onReset={() => setNonce((n) => n + 1)}
          onSpeed={player.setSpeed}
        />
      </div>

      <main className="main">
        <section className="left">
          <div className={`intro ${showIntro ? 'open' : ''}`}>
            <button className="intro-toggle" onClick={() => setShowIntro((x) => !x)}>
              <span className="intro-caret">{showIntro ? '▾' : '▸'} 개념 & 관찰 포인트</span>
              {!showIntro && <span className="intro-oneline">{sc.intro[0]}</span>}
            </button>
            {showIntro && (
              <div className="intro-body">
                <div className="intro-text">
                  {sc.intro.map((p, i) => (
                    <p key={i}>{p}</p>
                  ))}
                  {variantInfo && (
                    <p className="variant-desc">
                      <b>{variantInfo.label}</b> — {variantInfo.description}
                    </p>
                  )}
                </div>
                <ul className="watch">
                  {sc.watch.map((w, i) => (
                    <li key={i}>{w}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>

          <div className="graph-wrap">
            <div className="graph-hud">
              <div className={`superstep ${frame.superstep === null ? 'none' : ''}`}>
                <span className="ss-label">SUPER-STEP</span>
                <span className="ss-num">{frame.superstep ?? '–'}</span>
                {frame.sub?.superstep !== undefined && frame.sub.superstep !== null && (
                  <span className="ss-sub">› sub {frame.sub.superstep}</span>
                )}
              </div>
              <span className={`phase phase-${frame.phase}`}>{phaseLabel(frame.phase)}</span>
              {frame.threadId !== null && <span className="badge badge-thread">thread '{frame.threadId}'</span>}
            </div>
            <GraphView built={session.built} frame={frame} interval={player.interval} />
            <div className="legend">
              <span><i className="lg lg-read" />state 읽기</span>
              <span><i className="lg lg-write" />update 쓰기</span>
              <span><i className="lg lg-trigger" />실행 신호</span>
              <span><i className="lg lg-send" />Send</span>
              <span><i className="lg-line" />엣지</span>
              <span><i className="lg-line dashed" />조건부</span>
            </div>
          </div>

          {BottomPanel && (
            <div className="bottom-panel">
              <BottomPanel session={session} snap={snap} frame={frame} />
            </div>
          )}

          <div className={`narration phase-${frame.phase}`}>
            <div className="narration-title">{frame.title}</div>
            {frame.detail && <div className="narration-detail">{frame.detail}</div>}
          </div>

          <div className="code-wrap">
            <div className="code-col">
              <div className="code-head">
                <span>Python (LangGraph)</span>
                <span className="muted">현재 실행 부분 하이라이트</span>
              </div>
              <CodePanel code={session.built.code} active={frame.code} />
            </div>
            <div className="log-col">
              <div className="code-head">
                <span>실행 로그</span>
                <span className="muted">클릭하면 그 시점으로 이동</span>
              </div>
              <EventLog frames={snap.frames} index={snap.index} onSeek={player.seek} />
            </div>
          </div>
        </section>

        <aside className="right">
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
              <div className="mono input-preview">graph.invoke({pyRepr(input)})</div>
              <p className="muted small">▶ 재생 또는 step 을 누르면 이 입력으로 실행합니다. ⟲ 로 초기화.</p>
            </section>
          )}
        </aside>
      </main>
    </div>
  );
}
