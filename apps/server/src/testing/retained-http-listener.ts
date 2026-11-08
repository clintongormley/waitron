import { createServer, type AddressInfo, type Server } from "node:net";
import type { ChildProcess } from "node:child_process";

export interface RetainedHttpListener {
  server: Server;
  host: string;
  port: number;
  close(): Promise<void>;
}

export async function retainHttpListener(host = "127.0.0.1"): Promise<RetainedHttpListener> {
  const server = createServer((socket) => socket.destroy());
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, host, resolve);
  });
  return {
    server,
    host,
    port: (server.address() as AddressInfo).port,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      }),
  };
}

export const retainedHttpPreload = new URL("./retained-http-preload.mjs", import.meta.url).href;

export async function transferRetainedListeners(
  child: ChildProcess,
  entries: readonly RetainedHttpListener[],
  timeoutMs: number,
): Promise<void> {
  let finish: () => void;
  let fail: (error: Error) => void;
  const completed = new Promise<void>((resolve, reject) => {
    finish = resolve;
    fail = reject;
  });
  const onExit = () => fail(new Error("the child exited before receiving its retained listeners"));
  const onMessage = (message: unknown) => {
    if (message === null || typeof message !== "object" || !("kind" in message)) return;
    if (message.kind === "retained-listeners.request") {
      for (const entry of entries) {
        try {
          child.send!(
            {
              kind: "retained-listeners.handle",
              count: entries.length,
              host: entry.host,
              port: entry.port,
            },
            entry.server,
            (error: Error | null) => {
              if (error) fail(error);
            },
          );
        } catch (error) {
          fail(error instanceof Error ? error : new Error(String(error)));
        }
      }
    } else if (
      message.kind === "retained-listeners.received" &&
      "count" in message &&
      message.count === entries.length
    ) {
      finish();
    }
  };
  const deadline = setTimeout(
    () => fail(new Error("retained listener handoff timed out")),
    timeoutMs,
  );
  child.on("message", onMessage);
  child.once("exit", onExit);
  child.once("error", fail!);
  try {
    if (!child.connected || child.send === undefined)
      throw new Error("dedicated test IPC required");
    await completed;
  } finally {
    clearTimeout(deadline);
    child.off("message", onMessage);
    child.off("exit", onExit);
    child.off("error", fail!);
    await Promise.all(entries.map((entry) => entry.close()));
  }
}
