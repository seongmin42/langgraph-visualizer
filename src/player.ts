import type { Frame } from './engine/types';

export interface PlayerSnapshot {
  frame: Frame;
  frames: Frame[];
  index: number;
  playing: boolean;
  speed: number;
  /** 아직 소비하지 않은 실행(generator)이 있는지 */
  running: boolean;
  atHead: boolean;
  canForward: boolean;
  canBack: boolean;
}

const BASE_INTERVAL = 1500;

/**
 * 엔진이 만들어 내는 Frame 을 한 칸씩 소비하는 재생기.
 * 이미 본 프레임은 버퍼에 남아 있어서 ◀ 로 되돌아가 볼 수 있다.
 */
export class Player {
  private frames: Frame[];
  private index = 0;
  private playing = false;
  private speed = 1;
  private gen: Generator<Frame> | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private listeners = new Set<() => void>();
  private snap!: PlayerSnapshot;
  /** generator 가 없을 때 ▶ 를 누르면 호출 (시나리오 기본 실행) */
  onNeedRun: (() => Generator<Frame> | null) | null = null;
  /** 끝난 뒤 ▶ 를 다시 누르면 프레임 버퍼를 비우고 처음부터 (체크포인트가 없는 시나리오) */
  restartOnEnd = true;

  constructor(initial: Frame) {
    this.frames = [initial];
    this.update();
  }

  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };

  getSnapshot = () => this.snap;

  private get canForward() {
    return this.index < this.frames.length - 1 || this.gen !== null;
  }

  get interval() {
    return BASE_INTERVAL / this.speed;
  }

  private update() {
    const atHead = this.index === this.frames.length - 1;
    this.snap = {
      frame: this.frames[this.index],
      frames: this.frames,
      index: this.index,
      playing: this.playing,
      speed: this.speed,
      running: this.gen !== null,
      atHead,
      canForward: !atHead || this.gen !== null,
      canBack: this.index > 0,
    };
    this.listeners.forEach((l) => l());
  }

  /** 새 실행을 시작한다. 현재 위치 이후의 프레임은 버린다. */
  run(gen: Generator<Frame>, autoplay = true) {
    this.frames = this.frames.slice(0, this.index + 1);
    this.gen = gen;
    this.pull();
    this.update();
    if (autoplay) this.play();
  }

  /** 엔진과 무관한 프레임(체크포인트 조회 등)을 끼워 넣는다 */
  push(frame: Frame) {
    this.stop();
    this.gen = null;
    this.frames = [...this.frames.slice(0, this.index + 1), frame];
    this.index = this.frames.length - 1;
    this.update();
  }

  /** 프레임 버퍼를 모두 비우고 처음 상태로 */
  reset(initial: Frame) {
    this.stop();
    this.gen = null;
    this.frames = [initial];
    this.index = 0;
    this.update();
  }

  private pull(): boolean {
    if (!this.gen) return false;
    const r = this.gen.next();
    if (r.done) {
      this.gen = null;
      return false;
    }
    this.frames = [...this.frames, r.value];
    this.index = this.frames.length - 1;
    if (r.value.final) {
      // 마지막 프레임이면 실행을 바로 닫아 '대기 중' 상태를 정확히 표시한다
      this.gen.return(undefined);
      this.gen = null;
    }
    return true;
  }

  stepForward = () => {
    if (this.index < this.frames.length - 1) this.index++;
    else if (this.gen) this.pull();
    else if (this.onNeedRun && this.frames.length === 1) {
      const g = this.onNeedRun();
      if (g) {
        this.frames = this.frames.slice(0, this.index + 1);
        this.gen = g;
        this.pull();
      }
    }
    this.update();
  };

  stepBack = () => {
    this.stop();
    if (this.index > 0) this.index--;
    this.update();
  };

  seek = (i: number) => {
    this.stop();
    this.index = Math.max(0, Math.min(i, this.frames.length - 1));
    this.update();
  };

  play = () => {
    if (this.playing) return;
    if (!this.canForward) {
      if (!this.onNeedRun) return;
      const g = this.onNeedRun();
      if (!g) return;
      this.frames = this.restartOnEnd && this.frames.length > 1 ? [this.frames[0]] : this.frames.slice(0, this.index + 1);
      this.gen = g;
      this.pull();
    }
    this.playing = true;
    this.update();
    this.schedule();
  };

  pause = () => {
    this.stop();
    this.update();
  };

  toggle = () => (this.playing ? this.pause() : this.play());

  setSpeed = (s: number) => {
    this.speed = s;
    this.update();
  };

  private stop() {
    this.playing = false;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  private schedule() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      if (!this.playing) return;
      this.stepForward();
      const next = this.frames[this.index];
      const ended = !this.canForward;
      // 사람이 개입해야 하는 프레임(router breakpoint, interrupt)에서는 자동으로 멈춘다
      if (ended || (next.pauseHere && this.snap.atHead)) {
        this.stop();
        this.update();
        return;
      }
      this.schedule();
    }, this.interval);
  }

  dispose() {
    this.stop();
  }
}
