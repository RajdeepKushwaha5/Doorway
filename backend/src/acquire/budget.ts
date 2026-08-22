/**
 * How much discovery a public endpoint is allowed to spend.
 *
 * Discovery is the one route here that both costs real money and has to be
 * open to anyone. Every other spending route is behind the admin token, but a
 * student cannot be asked for a token and neither can a judge, so this one is
 * public by necessity.
 *
 * Public plus paid is a combination that ends one way if it is left alone. The
 * limits below are deliberately blunt: a per-caller allowance so one person
 * cannot loop it, and a hard global ceiling so that even if the per-caller
 * limit is defeated by rotating addresses, the account cannot be drained. The
 * ceiling is the one that actually protects the budget; the per-caller limit
 * just keeps honest users from tripping it.
 *
 * In memory, which is the right scope. The window is an hour, the process is
 * long-lived, and a restart resetting the counters is a smaller problem than
 * the dependency a shared store would add.
 */

export interface BudgetLimits {
  /** Discoveries one caller may start per window. */
  perCaller: number;
  /** Discoveries anyone may start per window, across all callers. */
  global: number;
  windowMs: number;
}

export const DEFAULT_LIMITS: BudgetLimits = {
  perCaller: 5,
  global: 120,
  windowMs: 60 * 60 * 1000,
};

export interface BudgetDecision {
  allowed: boolean;
  /** Why not, in words a caller can act on. Null when allowed. */
  reason: string | null;
  /** How many this caller has left in the window. */
  remaining: number;
  retryAfterSeconds: number;
}

export class DiscoveryBudget {
  readonly #limits: BudgetLimits;
  readonly #now: () => number;
  readonly #byCaller = new Map<string, number[]>();
  #global: number[] = [];

  constructor(limits: BudgetLimits = DEFAULT_LIMITS, now: () => number = () => Date.now()) {
    this.#limits = limits;
    this.#now = now;
  }

  #prune(stamps: number[], at: number): number[] {
    const cutoff = at - this.#limits.windowMs;
    return stamps.filter((stamp) => stamp > cutoff);
  }

  /**
   * Ask whether one more discovery may run, and record it if so.
   *
   * Combined rather than split into check-then-consume, because two calls
   * would race: under any concurrency at all, several requests can pass the
   * check before the first records itself, which is exactly the case the
   * ceiling exists to stop.
   */
  take(caller: string): BudgetDecision {
    const at = this.#now();

    this.#global = this.#prune(this.#global, at);
    const mine = this.#prune(this.#byCaller.get(caller) ?? [], at);

    const retryAfterSeconds = (stamps: number[]): number => {
      const oldest = stamps[0];
      if (oldest === undefined) return 0;
      return Math.max(1, Math.ceil((oldest + this.#limits.windowMs - at) / 1000));
    };

    if (this.#global.length >= this.#limits.global) {
      this.#byCaller.set(caller, mine);
      return {
        allowed: false,
        reason:
          'Discovery is busy across all visitors right now. This searches the live web through Bright Data, so it is capped to keep the account from being drained. Try again shortly.',
        remaining: Math.max(0, this.#limits.perCaller - mine.length),
        retryAfterSeconds: retryAfterSeconds(this.#global),
      };
    }

    if (mine.length >= this.#limits.perCaller) {
      this.#byCaller.set(caller, mine);
      return {
        allowed: false,
        reason: `You have run ${String(this.#limits.perCaller)} live searches in the last hour, which is the limit. Every search costs real requests against the live web, so it is capped rather than unlimited.`,
        remaining: 0,
        retryAfterSeconds: retryAfterSeconds(mine),
      };
    }

    mine.push(at);
    this.#global.push(at);
    this.#byCaller.set(caller, mine);

    // Keep the caller map from growing without bound in a long-lived process.
    if (this.#byCaller.size > 5000) {
      for (const [key, stamps] of this.#byCaller) {
        if (this.#prune(stamps, at).length === 0) this.#byCaller.delete(key);
      }
    }

    return {
      allowed: true,
      reason: null,
      remaining: Math.max(0, this.#limits.perCaller - mine.length),
      retryAfterSeconds: 0,
    };
  }
}
