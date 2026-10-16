import '@vscode/codicons/dist/codicon.css';
import { useCallback, useEffect, useMemo, useReducer, useState, useSyncExternalStore, type ReactNode } from 'react';
import { CodePanel, firstLineOf } from './components/CodePanel';
import { DebugToolbar, StatusBar, StepSlider } from './components/Debug';
import { EventLog } from './components/EventLog';
import { GraphView, phaseLabel } from './components/GraphView';
import { StatePanel } from './components/StatePanel';
import { pyRepr } from './engine/pyrepr';
import { Runtime } from './engine/runtime';
import { END, START, type Frame } from './engine/types';
import { Player } from './player';
import { SCENARIOS } from './scenarios';
import { CompareView } from './scenarios/s02-reducers';
import type { Scenario, Session } from './scenarios/types';

function createSession(scenario: Scenario, variant: string, rerender: () => void): Session {
  const built = scenario.build(variant);
  const runtime = new Runtime(built.graph, built.options);
  const session = { scenario, variant, built, runtime, ui: scenario.initUi?.() ?? {}, rerender } as Session;
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

/** 시나리오 = 튜토리얼 폴더 안의 파이썬 파일 하나 */
export const fileName = (s: Scenario) => `${String(s.num).padStart(2, '0')}_${s.id}.py`;

const FOLDERS: { name: string; nums: number[] }[] = [
  { name: '1_basics', nums: [1, 2, 3] },
  { name: '2_control_flow', nums: [4, 5, 9] },
  { name: '3_persistence', nums: [6, 7, 8] },
  { name: '4_composition', nums: [10, 11] },
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

/** 사이드바의 접을 수 있는 섹션 (VS Code pane) */
function Pane({ title, actions, children, defaultOpen = true, grow }: { title: string; actions?: ReactNode; children: ReactNode; defaultOpen?: boolean; grow?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section className={`pane ${open ? 'open' : ''} ${grow ? 'grow' : ''}`}>
      <div className="pane-header" onClick={() => setOpen((x) => !x)} role="button" aria-expanded={open}>
        <i className={`codicon codicon-chevron-${open ? 'down' : 'right'}`} />
        <span className="pane-title">{title}</span>
        {actions && (
          <span className="pane-actions" onClick={(e) => e.stopPropagation()}>
            {actions}
          </span>
        )}
      </div>
      {open && <div className="pane-body">{children}</div>}
    </section>
  );
}

const SPEEDS = [0.5, 1, 2, 4];

export default function App() {
  const [{ sc, v }, setSel] = useState(readHash);
  const [nonce, setNonce] = useState(0);
  const [, rerender] = useReducer((x: number) => x + 1, 0);
  const [panel, setPanel] = useState<'code' | 'console' | 'output'>('code');
  const [explorer, setExplorer] = useState(true);
  const [theme, toggleTheme] = useTheme();

  const session = useMemo(() => createSession(sc, v, rerender), [sc, v, nonce]);
  useEffect(() => () => session.player.dispose(), [session]);

  useEffect(() => {
    const target = `#/${sc.id}${v ? `/${v}` : ''}`;
    if (location.hash !== target) history.replaceState(null, '', target);
    setPanel(sc.BottomPanel ? 'output' : 'code');
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
      const el = e.target as HTMLElement;
      if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT') return;
      // VS Code 디버거 단축키 + 간단한 키
      if (e.key === 'F5' && (e.ctrlKey || e.metaKey) && e.shiftKey) {
        e.preventDefault();
        setNonce((n) => n + 1);
      } else if (e.key === 'F5' || e.key === ' ') {
        e.preventDefault();
        if (el.tagName === 'BUTTON') el.blur();
        player.toggle();
      } else if ((e.key === 'F10' && !e.shiftKey) || e.key === 'ArrowRight') {
        e.preventDefault();
        player.stepForward();
      } else if ((e.key === 'F10' && e.shiftKey) || e.key === 'ArrowLeft') {
        e.preventDefault();
        player.stepBack();
      }
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
  const file = fileName(sc);
  const graph = session.built.graph;
  const breakpoints = [
    ...(graph.interruptBefore ?? []).map((n) => ({ label: `interrupt_before=["${n}"]`, where: n })),
    ...(graph.interruptAfter ?? []).map((n) => ({ label: `interrupt_after=["${n}"]`, where: n })),
    ...(session.built.options?.breakAtRouters ?? []).map((r) => ({ label: `${r}() 실행 직전`, where: r })),
    ...(session.built.code.includes('interrupt(') && !graph.interruptBefore ? [{ label: 'interrupt() 호출 지점', where: 'interrupt' }] : []),
  ];

  return (
    <div className={`workbench ${explorer ? '' : 'no-explorer'}`}>
      <nav className="activitybar" aria-label="활동 표시줄">
        <button className={`ab-item ${explorer ? 'on' : ''}`} onClick={() => setExplorer((x) => !x)} title="탐색기" aria-label="탐색기">
          <i className="codicon codicon-files" />
        </button>
        <div className="ab-spacer" />
        <button className="ab-item" onClick={toggleTheme} title={theme === 'dark' ? '밝은 테마로' : '어두운 테마로'} aria-label="색 테마 전환">
          <i className="codicon codicon-color-mode" />
        </button>
      </nav>

      {explorer && (
        <aside className="sidebar explorer">
          <div className="sidebar-title">탐색기</div>
          <Pane title="langgraph-tutorial" grow>
            {FOLDERS.map((f) => (
              <div key={f.name}>
                <div className="tree-row folder" style={{ paddingLeft: 8 }}>
                  <span className="twistie">
                    <i className="codicon codicon-chevron-down" />
                  </span>
                  <span>{f.name}</span>
                </div>
                {f.nums.map((num) => {
                  const s = SCENARIOS.find((x) => x.num === num)!;
                  return (
                    <button key={s.id} className={`tree-row file ${s.id === sc.id ? 'selected' : ''}`} style={{ paddingLeft: 28 }} onClick={() => select(s)} title={s.title}>
                      <i className="codicon codicon-file-code py-icon" aria-hidden="true" />
                      <span className="file-name">{fileName(s)}</span>
                      <span className="file-desc">{s.short}</span>
                    </button>
                  );
                })}
              </div>
            ))}
          </Pane>
          <Pane title={`개요: ${sc.short}`}>
            <div className="readme">
              <h3>{sc.title}</h3>
              {sc.intro.map((p, i) => (
                <p key={i}>{p}</p>
              ))}
              <h4>관찰 포인트</h4>
              <ul>
                {sc.watch.map((w, i) => (
                  <li key={i}>{w}</li>
                ))}
              </ul>
            </div>
          </Pane>
        </aside>
      )}

      <main className="editor-area">
        <div className="editor-group">
          <div className="tabs">
            <div className="tab active">
              <i className="codicon codicon-type-hierarchy-sub" />
              <span className="tab-label">Graph: {file}</span>
            </div>
          </div>
          <div className="breadcrumbs">
            <span>langgraph-tutorial</span>
            <i className="codicon codicon-chevron-right" />
            <span>{file}</span>
            <i className="codicon codicon-chevron-right" />
            <span>graph</span>
            {frame.superstep !== null && (
              <>
                <i className="codicon codicon-chevron-right" />
                <span>super-step {frame.superstep}</span>
                {frame.sub?.superstep != null && (
                  <>
                    <i className="codicon codicon-chevron-right" />
                    <span>
                      {frame.sub.nodeId} › step {frame.sub.superstep}
                    </span>
                  </>
                )}
              </>
            )}
          </div>
          <div className="graph-canvas">
            <div className="graph-stage">
              <DebugToolbar snap={snap} onPlay={player.toggle} onStep={player.stepForward} onBack={player.stepBack} onReset={() => setNonce((n) => n + 1)} />
              <GraphView built={session.built} frame={frame} interval={player.interval} />
            </div>
            <Hover frame={frame} />
          </div>
        </div>

        <section className="panel-area">
          <div className="panel-tabs" role="tablist">
            <button role="tab" aria-selected={panel === 'code'} className={panel === 'code' ? 'on' : ''} onClick={() => setPanel('code')}>
              {file}
            </button>
            <button role="tab" aria-selected={panel === 'console'} className={panel === 'console' ? 'on' : ''} onClick={() => setPanel('console')}>
              디버그 콘솔
            </button>
            {BottomPanel && (
              <button role="tab" aria-selected={panel === 'output'} className={panel === 'output' ? 'on' : ''} onClick={() => setPanel('output')}>
                출력 (stream)
              </button>
            )}
          </div>
          <div className="panel-body">
            {panel === 'code' && <CodePanel code={session.built.code} active={frame.code} />}
            {panel === 'console' && <EventLog frames={snap.frames} index={snap.index} onSeek={player.seek} />}
            {panel === 'output' && BottomPanel && <BottomPanel session={session} snap={snap} frame={frame} />}
          </div>
          <StepSlider snap={snap} onSeek={player.seek} />
        </section>
      </main>

      <aside className="sidebar debug">
        <div className="sidebar-title">
          실행 및 디버그
          <div className="launch">
            <button className="launch-run" onClick={player.toggle} title="실행 (F5)" aria-label="실행">
              <i className="codicon codicon-debug-start" />
            </button>
            {sc.variants ? (
              <select value={v} onChange={(e) => select(sc, e.target.value)} aria-label="실행 구성" title={variantInfo?.description}>
                {sc.variants.map((x) => (
                  <option key={x.id} value={x.id}>
                    {x.label}
                  </option>
                ))}
              </select>
            ) : (
              <span className="launch-name">{sc.short}</span>
            )}
          </div>
        </div>
        <div className="sidebar-scroll">
          <Pane title="변수">
            {sc.stateView === 'compare' ? (
              <CompareView frame={frame} channels={graph.channels} />
            ) : (
              <StatePanel
                frame={frame}
                channels={graph.channels}
                canEdit={canEdit}
                onEdit={(patch) => {
                  session.runtime.queuePatch(patch);
                  player.stepForward();
                }}
              />
            )}
          </Pane>
          <Pane title="호출 스택 (super-step)">
            <CallStack frame={frame} code={session.built.code} file={file} />
          </Pane>
          {breakpoints.length > 0 && (
            <Pane title="중단점">
              {breakpoints.map((b) => (
                <div key={b.label} className="tree-row bp-row" style={{ paddingLeft: 12 }}>
                  <input type="checkbox" checked readOnly aria-label={b.label} />
                  <i className="codicon codicon-circle-filled bp-icon" />
                  <span>{b.label}</span>
                  <span className="v-hint">{file}</span>
                </div>
              ))}
            </Pane>
          )}
          {Panel && (
            <Pane title="실험">
              <Panel session={session} snap={snap} frame={frame} />
            </Pane>
          )}
          {input && (
            <Pane title="실행 입력 (launch.json)" defaultOpen={false}>
              <pre className="launch-input">graph.invoke({pyRepr(input)})</pre>
            </Pane>
          )}
        </div>
      </aside>

      <StatusBar
        snap={snap}
        frame={frame}
        file={file}
        variant={variantInfo?.label}
        onSpeed={() => player.setSpeed(SPEEDS[(SPEEDS.indexOf(snap.speed) + 1) % SPEEDS.length])}
      />
    </div>
  );
}

/** 지금 일어나는 일을 설명하는 에디터 호버 위젯 */
function Hover({ frame }: { frame: Frame }) {
  return (
    <div className={`hover-widget phase-${frame.phase}`} aria-live="polite">
      <div className="hover-head">
        <span className="hover-phase">{phaseLabel(frame.phase)}</span>
        {frame.superstep !== null && <span className="hover-step">super-step {frame.superstep}</span>}
      </div>
      <div className="hover-title">{frame.title}</div>
      {frame.detail && <div className="hover-detail">{frame.detail}</div>}
    </div>
  );
}

/** super-step 을 스레드처럼, 그 안에서 실행된 노드를 스택 프레임처럼 보여준다 */
function CallStack({ frame, code, file }: { frame: Frame; code: string; file: string }) {
  const steps = new Map<number, string[]>();
  for (const [node, ss] of Object.entries(frame.nodeRuns)) for (const s of ss) steps.set(s, [...(steps.get(s) ?? []), node]);
  const cur = frame.superstep;
  const live = frame.tasks.map((t) => t.node).filter((n) => n !== START && n !== END);
  if (cur !== null && live.length && !steps.has(cur)) steps.set(cur, live.filter((n) => !n.includes('/')));
  if (cur !== null && frame.sub && !steps.get(cur)?.length) steps.set(cur, [frame.sub.nodeId]);
  const rows = [...steps.entries()].sort((a, b) => b[0] - a[0]);
  if (!rows.length) return <div className="empty-view">실행하면 super-step 별로 실행된 노드가 쌓입니다.</div>;
  const state = frame.phase === 'interrupt' ? 'INTERRUPT 에서 일시 중지됨' : frame.phase === 'error' ? '예외로 중지됨' : frame.phase === 'end' ? '완료됨' : '스텝에서 일시 중지됨';
  return (
    <div>
      {rows.map(([s, nodes]) => (
        <div key={s}>
          <div className={`tree-row thread ${s === cur ? 'current' : ''}`} style={{ paddingLeft: 8 }}>
            <span className="twistie">
              <i className="codicon codicon-chevron-down" />
            </span>
            <span>super-step {s}</span>
            {s === cur && <span className="state-label">{state}</span>}
          </div>
          {[...new Set(nodes)].sort().map((n) => {
            const count = nodes.filter((x) => x === n).length;
            const line = firstLineOf(code, n);
            return (
              <div key={n} className={`tree-row stack-frame ${s === cur ? 'top' : ''}`} style={{ paddingLeft: 30 }}>
                <span className="sf-name">
                  {n}
                  {count > 1 ? ` ×${count}` : ''}
                </span>
                <span className="v-hint">
                  {file}
                  {line ? ` ${line}` : ''}
                </span>
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}
