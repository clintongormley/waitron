import type { TillLiveConnection } from "../api/live-connection.js";

export function liveRefresh(
  connection: TillLiveConnection | undefined,
  options: {
    types: readonly string[];
    run(): void;
  },
): { stop(): void } {
  const owner = crypto.randomUUID();
  let stopped = false;
  let scheduled = false;
  const refresh = () => {
    if (scheduled || stopped) return;
    scheduled = true;
    queueMicrotask(() => {
      scheduled = false;
      if (!stopped) options.run();
    });
  };
  const change = (event: Event) => {
    const { types } = (event as CustomEvent<{ types: string[] }>).detail;
    if (types.some((type) => options.types.includes(type))) refresh();
  };
  connection?.addInterests(owner, options.types);
  connection?.addEventListener("up", refresh);
  connection?.addEventListener("down", refresh);
  connection?.addEventListener("change", change);
  if (connection?.up) refresh();
  return {
    stop() {
      stopped = true;
      connection?.removeEventListener("up", refresh);
      connection?.removeEventListener("down", refresh);
      connection?.removeEventListener("change", change);
      connection?.removeInterests(owner);
    },
  };
}

export function liveGate(
  connection: TillLiveConnection | undefined,
  options: {
    types: readonly string[];
    intervalMs: number;
    run(): void;
    quietWhileConnected: boolean;
  },
): { stop(): void } {
  const refresh = liveRefresh(connection, options);
  const timer = setInterval(() => {
    if (!(options.quietWhileConnected && connection?.up)) options.run();
  }, options.intervalMs);
  return {
    stop() {
      clearInterval(timer);
      refresh.stop();
    },
  };
}

export function queuedLiveRefresh(
  connection: TillLiveConnection | undefined,
  options: {
    types: readonly string[];
    run(): Promise<unknown>;
    beforeRun?(): Promise<void> | undefined;
  },
): { stop(): void } {
  let stopped = false,
    running = false,
    queued = false;
  const refresh = liveRefresh(connection, {
    types: options.types,
    run: () => {
      queued = true;
      if (running) return;
      running = true;
      void (async () => {
        try {
          while (queued && !stopped) {
            await options.beforeRun?.();
            if (stopped) break;
            queued = false;
            await options.run();
          }
        } finally {
          running = false;
        }
      })();
    },
  });
  return {
    stop() {
      stopped = true;
      refresh.stop();
    },
  };
}
