# LangGraph Visualizer

LangGraph 의 핵심 실행 모델을 **실제 LLM 호출 없이 mock 노드로** 한 단계씩 따라가며 공부하는 웹 앱입니다.

- 왼쪽: 그래프 (노드 / 엣지 / router / 공유 State 허브, 데이터 패킷 애니메이션)
- 오른쪽: 현재 State 패널 (바뀐 키 하이라이트, 이전 값 → 새 값 diff, 대기 중인 writes) + 시나리오별 실험 패널
- 아래: 해당 시나리오의 LangGraph 파이썬 코드 (지금 실행 중인 부분 하이라이트) + 실행 로그
- 모든 시나리오: ▶ 재생 / ⏸ 일시정지 / ▶| 한 스텝 / ◀ 이전 스텝 / 속도 조절 / ⟲ 초기화

## 실행

```bash
npm install
npm run dev      # http://localhost:5173
```

```bash
npm test         # 엔진 동작 테스트 (vitest)
npm run build    # dist/ 에 정적 빌드 (base: './' 라서 GitHub Pages 등 어디에 올려도 동작)
```

단축키: `Space` 재생/일시정지, `→` 한 스텝, `←` 이전 스텝. 실행 로그의 항목을 클릭하면 그 시점으로 이동합니다.
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
  components/     # GraphView, StatePanel, CodePanel, Timeline, EventLog ...
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
