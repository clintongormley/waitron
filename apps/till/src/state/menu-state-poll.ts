import type { MenuState } from "../api/client.js";

/** How often a signed-in till reads its zones' menu state (plan decision D11). */
const POLL_MS = 15_000;

/**
 * How long a read may stay out before it is cancelled: longer than {@link POLL_MS}, so a slow
 * server's answer still lands, and due well before the tick after next.
 */
const READ_LIMIT_MS = 25_000;

export interface MenuStatePollOptions {
  read(zoneId: string, signal: AbortSignal): Promise<MenuState>;
  /** The zones whose offers the till holds now, read afresh at every tick. */
  zones(): readonly string[];
  onState(zoneId: string, state: MenuState): void;
}

/**
 * Reads each zone's live menu versions, and what cannot be sold now, every {@link POLL_MS},
 * between {@link start} and {@link stop}. A `session.required` answer stops it as a sign-out does.
 * It makes no activity of its own: a till's inactivity is counted from pointer and key presses.
 */
export class MenuStatePoll {
  readonly #options: MenuStatePollOptions;
  #timer?: ReturnType<typeof setInterval>;
  readonly #reads = new Set<AbortController>();
  #requested = 0;
  /** Per zone, the newest request whose answer has been reported. */
  readonly #applied = new Map<string, number>();

  constructor(options: MenuStatePollOptions) {
    this.#options = options;
  }

  get running(): boolean {
    return this.#timer !== undefined;
  }

  start(): void {
    if (this.#timer === undefined) this.#timer = setInterval(() => this.#tick(), POLL_MS);
  }

  stop(): void {
    clearInterval(this.#timer);
    this.#timer = undefined;
    for (const read of this.#reads) read.abort();
    this.#reads.clear();
  }

  #tick(): void {
    for (const zoneId of this.#options.zones()) void this.#readZone(zoneId, ++this.#requested);
  }

  async #readZone(zoneId: string, request: number): Promise<void> {
    const read = new AbortController();
    const limit = setTimeout(() => read.abort(), READ_LIMIT_MS);
    this.#reads.add(read);
    try {
      const state = await this.#options.read(zoneId, read.signal);
      if (read.signal.aborted || request < (this.#applied.get(zoneId) ?? 0)) return;
      this.#applied.set(zoneId, request);
      this.#options.onState(zoneId, state);
    } catch (error) {
      if (read.signal.aborted || request < (this.#applied.get(zoneId) ?? 0)) return;
      if ((error as { code?: string } | undefined)?.code === "session.required") this.stop();
    } finally {
      clearTimeout(limit);
      this.#reads.delete(read);
    }
  }
}
