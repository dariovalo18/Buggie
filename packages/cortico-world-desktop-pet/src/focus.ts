/**
 * Focus blocks: `focus.minutes` of work, then `focus.breakMinutes` of rest, then idle until the person starts another.
 * The World keeps the clock, so the page shows the same block after it reconnects; the page reads `state` from the
 * World's prefs and counts down to `endsAt` itself.
 */
export type FocusPhase = 'focus' | 'break';

export interface FocusState {
  phase: FocusPhase;
  /** When the phase ends, in milliseconds since the epoch. */
  endsAt: number;
  /** The phase's length in minutes. */
  minutes: number;
}

/** What changed: a block started, it ended and the break began, the break ended, or the person stopped either. */
export type FocusChange = 'start' | 'break' | 'done' | 'stop';

export interface FocusTimerOptions {
  lengths(): { minutes: number; breakMinutes: number };
  onChange(state: FocusState | null, change: FocusChange): void;
  now?(): number;
}

export class FocusTimer {
  private current: FocusState | null = null;
  private timer: ReturnType<typeof setTimeout> | undefined;

  constructor(private readonly o: FocusTimerOptions) {}

  get state(): FocusState | null {
    return this.current;
  }

  private now(): number {
    return this.o.now?.() ?? Date.now();
  }

  private enter(phase: FocusPhase | null, change: FocusChange): void {
    clearTimeout(this.timer);
    if (!phase) {
      this.current = null;
    } else {
      const { minutes, breakMinutes } = this.o.lengths();
      const length = phase === 'focus' ? minutes : breakMinutes;
      this.current = { phase, endsAt: this.now() + length * 60_000, minutes: length };
      this.timer = setTimeout(() => this.enter(phase === 'focus' ? 'break' : null, phase === 'focus' ? 'break' : 'done'), length * 60_000);
    }
    this.o.onChange(this.current, change);
  }

  /** Starts a focus block, replacing whatever ran. */
  start(): void {
    this.enter('focus', 'start');
  }

  /** Ends the block or the break now, without the break a block would have led to. */
  stop(): void {
    if (this.current) this.enter(null, 'stop');
  }

  dispose(): void {
    clearTimeout(this.timer);
    this.current = null;
  }
}
