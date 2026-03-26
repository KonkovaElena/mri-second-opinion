/**
 * Replay-nonce store — prevents signed-request replay attacks.
 *
 * Memory mode: Map<nonce, consumedAtMs> with lazy TTL prune.
 * PostgreSQL mode: replay_nonces table (see sql/migrations/002_idempotency_and_replay.sql).
 */

export interface ReplayStore {
  /** Returns true if nonce was already consumed. If new, records it atomically. */
  checkAndRecord(nonce: string, timestampMs: number): Promise<boolean>;

  /** Remove expired entries. Returns count of pruned items. */
  prune(): Promise<number>;
}

export interface ReplayStoreOptions {
  /** Entry TTL in milliseconds. Default: 120_000 (2× clock-skew window). */
  ttlMs?: number;

  /** Max entries for memory mode. Default: 10_000. */
  maxEntries?: number;
}

const DEFAULT_TTL_MS = 120_000;
const DEFAULT_MAX_ENTRIES = 10_000;
const PRUNE_INTERVAL_MS = 60_000;

export class MemoryReplayStore implements ReplayStore {
  private readonly nonces = new Map<string, number>();
  private readonly ttlMs: number;
  private readonly maxEntries: number;
  private lastPruneAt = 0;

  constructor(options: ReplayStoreOptions = {}) {
    this.ttlMs = options.ttlMs ?? DEFAULT_TTL_MS;
    this.maxEntries = options.maxEntries ?? DEFAULT_MAX_ENTRIES;
  }

  async checkAndRecord(nonce: string, timestampMs: number): Promise<boolean> {
    this.lazyPrune(timestampMs);

    if (this.nonces.has(nonce)) {
      return true; // Already consumed — replay
    }

    this.nonces.set(nonce, timestampMs);
    return false; // First time — not a replay
  }

  async prune(): Promise<number> {
    return this.pruneExpired(Date.now());
  }

  private lazyPrune(nowMs: number): void {
    if (nowMs - this.lastPruneAt < PRUNE_INTERVAL_MS) {
      return;
    }
    this.pruneExpired(nowMs);
  }

  private pruneExpired(nowMs: number): number {
    this.lastPruneAt = nowMs;
    const cutoff = nowMs - this.ttlMs;
    let pruned = 0;

    for (const [nonce, consumedAt] of this.nonces) {
      if (consumedAt < cutoff) {
        this.nonces.delete(nonce);
        pruned++;
      }
    }

    // Safety cap: if still over max, evict oldest entries
    if (this.nonces.size > this.maxEntries) {
      const sorted = [...this.nonces.entries()].sort((a, b) => a[1] - b[1]);
      const excess = sorted.slice(0, sorted.length - this.maxEntries);
      for (const [nonce] of excess) {
        this.nonces.delete(nonce);
        pruned++;
      }
    }

    return pruned;
  }
}
