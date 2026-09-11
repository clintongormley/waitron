import type { LiveData } from "./live-data.js";
import type { ResourceIdentity } from "@waitron/shared";

interface EventStream extends EventTarget {
  readonly readyState?: number;
  close(): void;
}
interface Options {
  open?: (url: string) => EventStream;
  onSessionInvalid?: (code: string) => void;
}

export class LiveConnection {
  #active = false;
  #scheduled = false;
  #stream?: EventStream;
  #key = "";
  #unsubscribe?: () => void;
  #retry?: ReturnType<typeof setTimeout>;
  #retryMs = 1000;

  constructor(
    private readonly data: LiveData,
    private readonly options: Options = {},
  ) {}

  start(): void {
    if (this.#active) return;
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
      const interests = this.data.interests;
      const key = JSON.stringify(interests);
      if (key === this.#key) return;
      this.#close();
      if (interests.length === 0) return;
      this.#key = key;
      const open =
        this.options.open ?? ((url: string) => new EventSource(url, { withCredentials: true }));
      const stream = open(`/management-api/events?resources=${encodeURIComponent(key)}`);
      this.#stream = stream;
      const listen = (name: string, action: (event: Event) => void): void => {
        stream.addEventListener(name, (event) => {
          if (this.#active && this.#stream === stream) action(event);
        });
      };
      listen("open", () => {
        this.#retryMs = 1000;
        this.data.refresh();
      });
      listen("error", () => {
        this.data.refresh();
        // EventSource retries transport interruptions itself, but HTTP failures can leave it CLOSED.
        if (stream.readyState !== 2) return;
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
      listen("session-invalid", (event) => {
        try {
          const parsed = JSON.parse((event as MessageEvent<string>).data) as { code?: unknown };
          if (typeof parsed.code !== "string") return;
          this.stop();
          this.options.onSessionInvalid?.(parsed.code);
        } catch {
          this.data.refresh();
        }
      });
    });
  }
}
