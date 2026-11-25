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

const LIVE_SILENCE_MS = 30_000;

function identitiesIn(parsed: unknown): ResourceIdentity[] | undefined {
  if (!Array.isArray(parsed)) return undefined;
  const identities: ResourceIdentity[] = [];
  for (const resource of parsed as unknown[]) {
    if (
      resource === null ||
      typeof resource !== "object" ||
      !("type" in resource) ||
      typeof resource.type !== "string"
    )
      return undefined;
    if ("id" in resource && typeof resource.id !== "string") return undefined;
    identities.push(
      "id" in resource
        ? { type: resource.type, id: resource.id as string }
        : { type: resource.type },
    );
  }
  return identities;
}

/** What the server says changed before this stream opened, or undefined when it cannot say. */
function missedIn(event: Event): ResourceIdentity[] | undefined {
  try {
    const parsed = JSON.parse((event as MessageEvent<string>).data) as { missed?: unknown } | null;
    return identitiesIn(parsed?.missed);
  } catch {
    return undefined;
  }
}

const positionOf = (event: Event): string | undefined =>
  (event as MessageEvent<string>).lastEventId || undefined;

export class LiveConnection {
  #active = false;
  #suspended = false;
  #page?: Window;
  #errorRefresh?: ReturnType<typeof setTimeout>;
  #scheduled = false;
  #stream?: EventStream;
  #key = "";
  #unsubscribe?: () => void;
  #retry?: ReturnType<typeof setTimeout>;
  #retryMs = 1000;
  #generation?: number;
  /** The server's change position that every watched read is known to cover, while the stream is
   * healthy. Undefined makes the next stream read everything again when it opens. */
  #position?: string;
  #silenceCheck?: ReturnType<typeof setInterval>;

  constructor(
    private readonly data: LiveData,
    private readonly options: Options = {},
  ) {}

  #onPageHide = (): void => {
    this.#suspended = true;
    this.#close();
    this.data.pause();
  };

  #onPageShow = (): void => {
    if (!this.#suspended) return;
    this.#suspended = false;
    if (!this.#active) {
      this.#detachPage();
      return;
    }
    this.data.resume();
    if (this.data.interestKeys.length === 0) this.data.refresh();
    this.#schedule();
  };

  /** Pass a position only when the server gave it before any read still watched was sent. */
  start(position?: string): void {
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
    this.#position = position;
    if (!this.#suspended && this.data.resume()) this.data.refresh();
    this.#page = typeof window === "undefined" ? undefined : window;
    this.#page?.addEventListener("pagehide", this.#onPageHide);
    this.#page?.addEventListener("pageshow", this.#onPageShow);
    this.#unsubscribe = this.data.subscribeToInterests(() => this.#schedule());
    this.#schedule();
  }

  stop(): void {
    this.#active = false;
    if (this.#suspended) {
      // Keep the return listener so a delayed start cannot resume a departed document.
      this.#page?.removeEventListener("pagehide", this.#onPageHide);
    } else {
      this.#detachPage();
      this.data.resume();
    }
    this.#unsubscribe?.();
    this.#unsubscribe = undefined;
    this.#close();
    this.data.clear();
  }

  #detachPage(): void {
    this.#page?.removeEventListener("pagehide", this.#onPageHide);
    this.#page?.removeEventListener("pageshow", this.#onPageShow);
    this.#page = undefined;
  }

  #close(): void {
    this.#position = undefined;
    this.data.setConnected(false);
    clearInterval(this.#silenceCheck);
    this.#silenceCheck = undefined;
    clearTimeout(this.#errorRefresh);
    this.#errorRefresh = undefined;
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
      if (!this.#active || this.#suspended) return;
      const interests = this.data.interestKeys;
      const key = `[${interests.join(",")}]`;
      if (key === this.#key) return;
      const since = this.#position;
      this.#close();
      if (interests.length === 0) return;
      this.#position = since;
      this.#key = key;
      const open =
        this.options.open ?? ((url: string) => new EventSource(url, { withCredentials: true }));
      const stream = open(
        `/management-api/events?resources=${encodeURIComponent(key)}` +
          (since === undefined ? "" : `&since=${encodeURIComponent(since)}`),
      );
      let catchingUp = since !== undefined;
      this.#stream = stream;
      const generation = this.#generation;
      let refreshed = false;
      let closed = false;
      let lastHeardAt = Date.now();
      const current = (allowStale = false): boolean =>
        this.#active &&
        !this.#suspended &&
        this.#stream === stream &&
        (allowStale || generation === this.options.sessionGeneration?.());
      const listen = (name: string, action: (event: Event) => void, allowStale = false): void => {
        stream.addEventListener(name, (event) => {
          if (current(allowStale)) {
            lastHeardAt = Date.now();
            action(event);
          }
        });
      };
      const reconnect = (): void => {
        this.#close();
        this.#retry = setTimeout(() => {
          this.#retry = undefined;
          this.#schedule();
        }, this.#retryMs);
        this.#retryMs = Math.min(this.#retryMs * 2, 30_000);
      };
      this.#silenceCheck = setInterval(() => {
        if (!current() || Date.now() - lastHeardAt < LIVE_SILENCE_MS) return;
        this.data.refresh();
        reconnect();
      }, 5000);
      listen("ready", (event) => {
        if (catchingUp) {
          catchingUp = false;
          const missed = missedIn(event);
          if (missed === undefined) this.data.refresh();
          else this.data.catchUp(missed);
        }
        this.#position = positionOf(event);
        this.data.setConnected(true);
      });
      listen("keepalive", (event) => {
        this.#position = positionOf(event);
      });
      listen("open", () => {
        this.#retryMs = 1000;
        refreshed = false;
        closed = false;
        if (!catchingUp) this.data.refresh();
      });
      listen("error", () => {
        catchingUp = false;
        this.#position = undefined;
        this.data.setConnected(false);
        // EventSource retries transport interruptions itself, but HTTP failures can leave it CLOSED.
        // Chromium fires `error` on every one of its own retries, so only this stream's first error,
        // or its first since it last opened, re-reads everything.
        closed ||= stream.readyState === 2;
        if (!closed && refreshed) return;
        if (!closed) refreshed = true;
        if (this.#errorRefresh !== undefined) return;
        // Chromium can fail the stream before pagehide. Let pagehide suspend reads before recovery.
        this.#errorRefresh = setTimeout(() => {
          this.#errorRefresh = undefined;
          if (!current()) return;
          this.data.refresh();
          if (!closed) return;
          reconnect();
        }, 0);
      });
      listen("reset", (event) => {
        this.data.refresh();
        this.#position = positionOf(event);
      });
      listen("change", (event) => {
        try {
          const identities = identitiesIn(JSON.parse((event as MessageEvent<string>).data));
          if (identities === undefined) return;
          this.data.invalidate(identities);
          this.#position = positionOf(event);
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
