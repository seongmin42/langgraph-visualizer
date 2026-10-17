# LangGraph Visualizer

LangGraph 의 핵심 실행 모델을 **실제 LLM 호출 없이 mock 노드로** 한 단계씩 따라가며 공부하는 웹 앱입니다.

- 가운데: 그래프 (노드 / 엣지 / router / 공유 State, state 를 읽고 쓰는 데이터 이동 애니메이션)
- 오른쪽: 현재 State (변수 트리 — 바뀐 값 강조, 이전 값, 대기 중인 writes) / super-step 호출 스택 / 중단점 / 시나리오별 실험 창
- 아래: 해당 시나리오의 LangGraph 파이썬 코드 (지금 실행 중인 줄 강조) + 디버그 콘솔(실행 기록)
- 디버그 툴바(계속/한 스텝/이전 스텝/다시 시작), 코드 아래 단계 슬라이더(처음·이전·다음·마지막), 상태 표시줄에서 속도 변경
- 라이트/다크 테마 (시스템 설정을 따르고, 왼쪽 활동 표시줄 아래에서 전환)

### 디자인 레퍼런스

"AI 가 만든 듯한" 임의의 스타일 대신, 학습자가 이미 익숙한 실제 도구의 모양과 값을 그대로 가져왔습니다.

| 영역 | 레퍼런스 | 가져온 것 |
|------|----------|-----------|
| 화면 전체 | VS Code **실행 및 디버그** 뷰 | 탐색기 / 변수·호출 스택·중단점 창 / 떠 있는 디버그 툴바 / 디버깅 중 색이 바뀌는 상태 표시줄. 색은 VS Code `Light Modern`·`Dark Modern` 테마 파일과 `debugColors.ts` 의 값 (현재 프레임 노란 배경, 중단점 빨간 점, 변수 이름·문자열·숫자 색) |
| 그래프 | LangGraph `graph.get_graph().draw_mermaid()` | `langchain_core` 의 `NodeStyles` (`#f2f0ff` 노드, 투명 `__start__`, `#bfb6fc` `__end__`), Mermaid 기본 테마 (`#9370DB` 테두리, `#333` 선, 점선 조건부 엣지, `#ffffde` 서브그래프 영역) |
| 코드 | VS Code 편집기 | Shiki + VS Code `Light+`/`Dark+` TextMate 테마, 실행 중인 줄 노란 배경과 거터 화살표 |
| 실행 기록 이동 | Python Tutor | 코드 아래 `<< 처음 < 이전 [슬라이더] 다음 > 마지막 >>`, "Step N of M" |

아이콘은 VS Code 의 Codicons 를 씁니다.

## 실행

```bash
npm install
npm run dev      # http://localhost:5173
```

```bash
npm test         # 엔진 동작 테스트 (vitest)
npm run build    # dist/ 에 정적 빌드 (base: './' 라서 GitHub Pages 등 어디에 올려도 동작)
```

### 배포 (Tailscale Funnel)

빌드 결과는 정적 파일뿐이라 서버가 필요 없습니다. Tailscale Funnel 의 경로 마운트로 공개하면 같은 기기에서 돌고 있는 다른 앱(예: 5173 포트, `/` 경로)과 겹치지 않습니다.

```bash
./scripts/deploy-funnel.sh
# → https://<기기>.<tailnet>.ts.net/langgraph/
```

- 기본은 `tailscaled` 가 빌드 폴더를 직접 서빙합니다 (포트를 쓰지 않음). 폴더를 읽을 수 없는 환경(macOS App Store 버전 등)에서는 `MODE=proxy PORT=4173 ./scripts/deploy-funnel.sh` 로 로컬 서버를 띄워 프록시합니다.
- Funnel 은 마운트 경로(`/langgraph`)를 떼고 요청을 넘기므로, 상대 경로(`base: './'`)로 빌드된 이 앱은 하위 경로에서도 그대로 동작합니다.
- 처음 쓰는 tailnet 이면 관리 콘솔에서 MagicDNS·HTTPS 인증서·Funnel 을 켜야 합니다 (`tailscale funnel` 이 안내 링크를 보여 줍니다).
- 내리기: `tailscale funnel --set-path /langgraph off`. `tailscale funnel reset` 은 다른 앱의 설정까지 지우니 쓰지 마세요.

단축키: VS Code 와 같이 `F5` 계속/일시정지, `F10` 한 스텝, `Shift+F10` 이전 스텝, `Ctrl+Shift+F5` 다시 시작 (`Space`, `→`, `←` 도 됩니다). 단계 슬라이더나 디버그 콘솔 항목으로 원하는 시점으로 이동합니다.
URL 해시(`#/parallel/join` 등)로 시나리오와 변형을 바로 열 수 있습니다.

## 시나리오

| # | 개념 | 볼 수 있는 장면 |
|---|------|----------------|
| 1 | State 와 노드 업데이트 | TypedDict state, 노드가 반환한 partial update 만 반영, 바뀐 키 diff |
| 2 | Reducer | 같은 update 를 세 필드에 반환 → 덮어쓰기 / `operator.add` / `add_messages` 를 나란히 비교 (같은 id 메시지: 중복 vs 교체) |
| 3 | 노드 간 통신 | 노드 → State 쓰기(주황), State → 노드 읽기(파랑), 엣지는 데이터 없는 "실행 신호"(흰색) |
| 4 | 조건부 엣지 | router 가 state 를 읽고 경로 선택. router 직전 breakpoint 에서 `score` 를 바꿔 다른 경로 실험 |
| 5 | 병렬 실행과 super-step | fan-out/fan-in, super-step 번호, reducer 로 합치기. 변형: reducer 없음 → `InvalidUpdateError`, 불균형 분기, `add_edge([...], node)` 대기 엣지 |
| 6 | Checkpoint 와 thread | super-step 마다 checkpoint 가 타임라인에 쌓임, `thread_id` 별로 히스토리/기억 분리 |
| 7 | Time travel 과 fork | 과거 checkpoint 선택 → state 복원, replay, `update_state` 로 수정 후 fork (타임라인 분기 트리) |
| 8 | Interrupt (HITL) | `interrupt()` + `Command(resume=...)` 로 승인/수정/반려, 또는 `interrupt_before` 정적 breakpoint |
| 9 | Send API | router 가 `Send` 리스트를 반환 → 같은 노드를 서로 다른 입력으로 병렬 실행 (map-reduce) |
| 10 | 서브그래프 | 컴파일된 그래프를 노드로 사용, 공유 키만 오가고 전용 키는 밖으로 새지 않음 |
| 11 | stream_mode | `values`(step 마다 전체 state) vs `updates`(노드마다 update) 콘솔 비교 |

## 구조

```
src/
  engine/         # mock LangGraph 런타임 (UI 와 무관한 순수 TS)
    runtime.ts    #   Pregel 식 super-step 루프 → 화면 스냅샷(Frame)을 generator 로 yield
    reducers.ts   #   overwrite / operator.add / add_messages, InvalidUpdateError
    types.ts      #   GraphSpec, Checkpoint, Frame, Send, Command ...
  player.ts       # Frame 버퍼 + 재생/일시정지/스텝/되감기
  geometry.ts     # 노드 배치 → SVG 엣지/패킷 경로 계산
  components/     # GraphView, StatePanel(변수 트리), CodePanel, Debug(툴바·슬라이더·상태 표시줄), Timeline, EventLog ...
  scenarios/      # 시나리오 하나 = 그래프 정의 + 레이아웃 + 파이썬 코드 + (선택) 실험 패널
```

엔진은 실제 LangGraph 의 실행 순서를 따릅니다.

1. 한 super-step 에서 실행할 노드 전부가 **같은 state 스냅샷**을 읽고 실행
2. 각 노드가 반환한 partial update 를 모아 두었다가 step 끝에 **채널별 reducer 로 한꺼번에 적용**
3. 실행된 노드의 엣지(정적 / 조건부 router / `Command(goto)` / `Send`)로 다음 노드 결정
4. checkpointer 가 있으면 `values / next / metadata(step, writes)` 를 checkpoint 로 저장 (step -1 = input, 0 = START)

### 새 시나리오 추가하기

`src/scenarios/sNN-*.tsx` 에 `Scenario` 객체를 만들고 `src/scenarios/index.ts` 에 등록합니다.

- `graph`: 채널(키, 표시용 파이썬 타입, reducer)과 mock 노드 함수, 엣지
- `layout`: 노드 중심 좌표 (`__start__`, `__end__`, `__state__` 허브, `router:<이름>` 포함)
- `code`: 화면에 보여줄 파이썬 코드. 하이라이트 태그는 줄 끝 `  #@ 태그` 또는 `#@begin 태그` … `#@end` 블록으로 지정합니다.
  엔진은 노드 실행 시 노드 id, reducer 적용 시 `state`, 라우팅 시 router 이름/`edges`, 저장 시 `checkpointer` 등의 태그를 보냅니다.

## 한계

학습용 시뮬레이터라 실제 LangGraph 와 세부 동작이 다를 수 있습니다. 예를 들어 checkpoint id 는 UUID 대신 순번을 쓰고,
같은 step 의 writes 적용 순서는 노드 이름순으로 단순화했으며, `messages`/`custom` stream 모드와 서브그래프 내부 interrupt 는 다루지 않습니다.
