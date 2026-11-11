interface Options {
  read(
    types: readonly string[],
    onEvent: (event: string, data: string) => void,
    signal: AbortSignal,
  ): Promise<void>;
  now?: () => number;
}

export class TillLiveConnection extends EventTarget {
  readonly #interests = new Map<string, readonly string[]>();
  #active = false;
  #up = false;
  #key = "";
  #read?: AbortController;
  #silence?: ReturnType<typeof setTimeout>;
  #retry?: ReturnType<typeof setTimeout>;
  #retryMs = 1000;

  constructor(private readonly options: Options) {
    super();
  }
  get up(): boolean {
    return this.#up;
  }
  addInterests(owner: string, types: readonly string[]): void {
    this.#interests.set(owner, types);
    this.#sync();
  }
  removeInterests(owner: string): void {
    this.#interests.delete(owner);
    this.#sync();
  }
  start(): void {
    if (this.#active) return;
    this.#active = true;
    this.#retryMs = 1000;
    this.#sync();
  }
  stop(): void {
    this.#active = false;
    this.#close();
    this.#key = "";
  }
  #setUp(up: boolean): void {
    if (up === this.#up) return;
    this.#up = up;
    this.dispatchEvent(new Event(up ? "up" : "down"));
  }
  #close(): void {
    const read = this.#read;
    this.#read = undefined;
    clearTimeout(this.#silence);
    clearTimeout(this.#retry);
    read?.abort();
    this.#setUp(false);
  }
  #sync(): void {
    if (!this.#active) return;
    const types = [...new Set([...this.#interests.values()].flat())].sort();
    const key = JSON.stringify(types);
    if (key === this.#key) return;
    this.#close();
    this.#key = key;
    if (types.length > 0) this.#connect(types);
  }
  #connect(types: readonly string[]): void {
    if (!this.#active) return;
    const read = new AbortController();
    this.#read = read;
    const current = () => this.#active && this.#read === read;
    const reconnect = () => {
      if (!current()) return;
      this.#close();
      this.#retry = setTimeout(() => this.#connect(types), this.#retryMs);
      this.#retryMs = Math.min(this.#retryMs * 2, 30_000);
    };
    const heard = () => {
      clearTimeout(this.#silence);
      this.#silence = setTimeout(reconnect, 30_000);
    };
    heard();
    void this.options
      .read(
        types,
        (event, data) => {
          if (!current()) return;
          heard();
          if (event === "ready") {
            this.#retryMs = 1000;
            this.#setUp(true);
          } else if (event === "change") {
            const resources = JSON.parse(data) as { type: string }[];
            this.dispatchEvent(
              new CustomEvent("change", { detail: { types: resources.map(({ type }) => type) } }),
            );
          } else if (
            event === "session-invalid" &&
            (JSON.parse(data) as { code?: string }).code === "device.unauthorized"
          ) {
            this.stop();
            this.dispatchEvent(new Event("unauthorized"));
          }
        },
        read.signal,
      )
      .catch((error: unknown) => {
        if (current() && (error as { code?: string } | null)?.code === "device.unauthorized") {
          this.stop();
          this.dispatchEvent(new Event("unauthorized"));
        }
      })
      .finally(reconnect);
  }
}
