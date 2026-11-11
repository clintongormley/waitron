import { TillLiveConnection } from "../src/api/live-connection.js";

export function liveReadFixture() {
  const reads: {
    types: readonly string[];
    receive: (name: string, data: string) => void;
    signal?: AbortSignal;
    end(): void;
  }[] = [];
  return {
    reads,
    read(
      types: readonly string[],
      receive: (name: string, data: string) => void,
      options: { signal?: AbortSignal } = {},
    ) {
      return new Promise<void>((resolve) => {
        reads.push({ types, receive, signal: options.signal, end: resolve });
        options.signal?.addEventListener("abort", () => resolve(), { once: true });
      });
    },
    event(name: string, data = "{}") {
      reads.at(-1)!.receive(name, data);
    },
  };
}

export function liveConnectionFixture() {
  let receive!: (name: string, data: string) => void;
  const connection = new TillLiveConnection({
    read: (_types, onEvent, signal) => {
      receive = onEvent;
      return new Promise<void>((resolve) =>
        signal.addEventListener("abort", () => resolve(), { once: true }),
      );
    },
  });
  connection.addInterests("device", ["devices"]);
  connection.start();
  return {
    connection,
    ready() {
      receive("ready", "{}");
    },
    change(type: string) {
      receive("change", JSON.stringify([{ type }]));
    },
    keepalive() {
      receive("keepalive", "{}");
    },
  };
}
