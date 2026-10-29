import type { LiveData } from "./live-data.js";
import type { ResourceIdentity } from "@waitron/shared";

interface EventStream extends EventTarget {
  readonly readyState?: number;
  close(): void;
}
interface Options {
  open?: (url: string) => EventStream;
  onSessionInvalid?: (code: string, generation?: number) => void;
  sessionGeneration?: () => number;
}

export class LiveConnection {
  #active = false;
  #scheduled = false;
  #stream?: EventStream;
  #key = "";
  #unsubscribe?: () => void;
  #retry?: ReturnType<typeof setTimeout>;
  #retryMs = 1000;
  #generation?: number;

  constructor(
    private readonly data: LiveData,
    private readonly options: Options = {},
  ) {}

  start(): void {
    const generation = this.options.sessionGeneration?.();
    if (this.#active) {
      if (generation !== this.#generation) {
        this.#generation = generation;
        this.#close();
        this.#schedule();
      }
      return;
    }
    this.#generation = generation;
    this.#active = true;
    this.#unsubscribe = this.data.subscribeToInterests(() => this.#schedule());
    this.#schedule();
  }

  stop(): void {
    this.#active = false;
    this.#unsubscribe?.();
    this.#unsubscribe = undefined;
    this.#close();
    this.data.clear();
  }

  #close(): void {
    clearTimeout(this.#retry);
    this.#retry = undefined;
    this.#stream?.close();
    this.#stream = undefined;
    this.#key = "";
  }

  #schedule(): void {
    if (this.#scheduled) return;
    this.#scheduled = true;
    queueMicrotask(() => {
      this.#scheduled = false;
      if (!this.#active) return;
      const interests = this.data.interestKeys;
      const key = `[${interests.join(",")}]`;
      if (key === this.#key) return;
      this.#close();
      if (interests.length === 0) return;
      this.#key = key;
      const open =
        this.options.open ?? ((url: string) => new EventSource(url, { withCredentials: true }));
      const stream = open(`/management-api/events?resources=${encodeURIComponent(key)}`);
      this.#stream = stream;
      const generation = this.#generation;
      let refreshed = false;
      const listen = (name: string, action: (event: Event) => void, allowStale = false): void => {
        stream.addEventListener(name, (event) => {
          if (
            this.#active &&
            this.#stream === stream &&
            (allowStale || generation === this.options.sessionGeneration?.())
          )
            action(event);
        });
      };
      listen("open", () => {
        this.#retryMs = 1000;
        refreshed = false;
        this.data.refresh();
      });
      listen("error", () => {
        // EventSource retries transport interruptions itself, but HTTP failures can leave it CLOSED.
        // Chromium fires `error` on every one of its own retries, so only this stream's first error,
        // or its first since it last opened, re-reads everything.
        const closed = stream.readyState === 2;
        if (!closed && refreshed) return;
        if (!closed) refreshed = true;
        this.data.refresh();
        if (!closed) return;
        this.#close();
        this.#retry = setTimeout(() => {
          this.#retry = undefined;
          this.#schedule();
        }, this.#retryMs);
        this.#retryMs = Math.min(this.#retryMs * 2, 30_000);
      });
      listen("reset", () => this.data.refresh());
      listen("change", (event) => {
        try {
          const parsed: unknown = JSON.parse((event as MessageEvent<string>).data);
          if (!Array.isArray(parsed)) return;
          const identities: ResourceIdentity[] = [];
          for (const resource of parsed as unknown[]) {
            if (
              resource === null ||
              typeof resource !== "object" ||
              !("type" in resource) ||
              typeof resource.type !== "string"
            )
              return;
            if ("id" in resource && typeof resource.id !== "string") return;
            identities.push(
              "id" in resource
                ? { type: resource.type, id: resource.id as string }
                : { type: resource.type },
            );
          }
          this.data.invalidate(identities);
        } catch {
          this.data.refresh();
        }
      });
      listen(
        "session-invalid",
        (event) => {
          try {
            const parsed = JSON.parse((event as MessageEvent<string>).data) as { code?: unknown };
            if (typeof parsed.code !== "string") return;
            if (parsed.code !== "node.reset" && generation !== this.options.sessionGeneration?.())
              return;
            this.stop();
            if (generation === undefined) this.options.onSessionInvalid?.(parsed.code);
            else this.options.onSessionInvalid?.(parsed.code, generation);
          } catch {
            if (generation === this.options.sessionGeneration?.()) this.data.refresh();
          }
        },
        true,
      );
    });
  }
}
