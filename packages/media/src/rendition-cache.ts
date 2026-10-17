import { AppError } from "@waitron/shared";
import "./errors.js";

type Work = {
  key: string;
  produce: () => Promise<Uint8Array>;
  resolve: (bytes: Uint8Array) => void;
  reject: (error: unknown) => void;
};
export class RenditionCache {
  private readonly completed = new Map<string, Uint8Array>();
  private readonly inFlight = new Map<string, Promise<Uint8Array>>();
  private readonly pending: Work[] = [];
  private active = false;
  private byteCount = 0;
  private readonly maxBytes: number;
  private readonly maxPending: number;
  constructor(options: { maxBytes?: number; maxPending?: number } = {}) {
    this.maxBytes = options.maxBytes ?? 32 * 1024 * 1024;
    this.maxPending = options.maxPending ?? 100;
  }
  get(key: string, produce: () => Promise<Uint8Array>): Promise<Uint8Array> {
    const cached = this.completed.get(key);
    if (cached) {
      this.completed.delete(key);
      this.completed.set(key, cached);
      return Promise.resolve(cached);
    }
    const shared = this.inFlight.get(key);
    if (shared) return shared;
    if (this.active && this.pending.length >= this.maxPending)
      return Promise.reject(new AppError("image.busy", {}));
    let resolve!: Work["resolve"];
    let reject!: Work["reject"];
    const promise = new Promise<Uint8Array>((yes, no) => {
      resolve = yes;
      reject = no;
    });
    this.inFlight.set(key, promise);
    this.pending.push({ key, produce, resolve, reject });
    void this.drain();
    return promise;
  }
  private async drain(): Promise<void> {
    if (this.active) return;
    const work = this.pending.shift();
    if (!work) return;
    this.active = true;
    try {
      const bytes = await work.produce();
      if (bytes.byteLength <= this.maxBytes) {
        this.completed.set(work.key, bytes);
        this.byteCount += bytes.byteLength;
        while (this.byteCount > this.maxBytes) {
          const [key, value] = this.completed.entries().next().value!;
          this.completed.delete(key);
          this.byteCount -= value.byteLength;
        }
      }
      work.resolve(bytes);
    } catch (error) {
      work.reject(error);
    } finally {
      this.inFlight.delete(work.key);
      this.active = false;
      void this.drain();
    }
  }
}
