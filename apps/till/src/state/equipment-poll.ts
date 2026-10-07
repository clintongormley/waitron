import type { DeviceEquipment } from "../api/client.js";

/** How often a signed-in till reads its equipment, so it learns when another device took an item. */
const POLL_MS = 15_000;

/** Longer than {@link POLL_MS}, so a slow server's answer still lands, and due well before the tick
 * after next. */
const READ_LIMIT_MS = 25_000;

/** `T` is what a read answers: the equipment, or the equipment with whatever the caller needs to
 * judge how fresh it is. */
export interface EquipmentPollOptions<T = DeviceEquipment> {
  read(signal: AbortSignal): Promise<T>;
  onEquipment(equipment: T): void;
}

/**
 * Reads the device's equipment every {@link POLL_MS}, between {@link start} and {@link stop}. The
 * read needs the device, not a session, so it stops on `device.unauthorized`: the device was
 * switched off or this browser no longer proves it. It makes no activity of its own: a till's
 * inactivity is counted from pointer and key presses.
 */
export class EquipmentPoll<T = DeviceEquipment> {
  readonly #options: EquipmentPollOptions<T>;
  #timer?: ReturnType<typeof setInterval>;
  readonly #reads = new Set<AbortController>();
  #requested = 0;
  #applied = 0;

  constructor(options: EquipmentPollOptions<T>) {
    this.#options = options;
  }

  get running(): boolean {
    return this.#timer !== undefined;
  }

  start(): void {
    if (this.#timer === undefined)
      this.#timer = setInterval(() => void this.#read(++this.#requested), POLL_MS);
  }

  stop(): void {
    clearInterval(this.#timer);
    this.#timer = undefined;
    for (const read of this.#reads) read.abort();
    this.#reads.clear();
  }

  async #read(request: number): Promise<void> {
    const read = new AbortController();
    const limit = setTimeout(() => read.abort(), READ_LIMIT_MS);
    this.#reads.add(read);
    try {
      const equipment = await this.#options.read(read.signal);
      if (read.signal.aborted || request < this.#applied) return;
      this.#applied = request;
      this.#options.onEquipment(equipment);
    } catch (error) {
      if (read.signal.aborted || request < this.#applied) return;
      if ((error as { code?: string } | undefined)?.code === "device.unauthorized") this.stop();
    } finally {
      clearTimeout(limit);
      this.#reads.delete(read);
    }
  }
}
