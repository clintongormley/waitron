import { IncomingMessage, ServerResponse, createServer } from "node:http";
import { Socket } from "node:net";
import { once } from "node:events";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AppError } from "@waitron/shared";
import { restartAfterResponse } from "./restart-after-response.js";

function outgoing() {
  return new ServerResponse(new IncomingMessage(new Socket()));
}
describe("committed repair restart lifecycle", () => {
  it.each(["finish", "close"] as const)(
    "requests restart only once after %s, clearing both listeners",
    (event) => {
      const response = outgoing();
      const restart = vi.fn();
      restartAfterResponse(response, restart);
      expect(restart).not.toHaveBeenCalled();
      response.emit(event);
      response.emit("finish");
      response.emit("close");
      expect(restart).toHaveBeenCalledTimes(1);
      expect(response.listenerCount("finish")).toBe(0);
      expect(response.listenerCount("close")).toBe(0);
    },
  );
  it("requests restart once when another finish listener emits a nested disconnect", () => {
    const response = outgoing();
    response.on("finish", () => response.emit("close"));
    const restart = vi.fn();
    restartAfterResponse(response, restart);
    response.emit("finish");
    expect(restart).toHaveBeenCalledTimes(1);
    expect(response.listenerCount("close")).toBe(0);
  });
  it("requests restart when the connection already closed during the commit", () => {
    const response = outgoing();
    response.destroy();
    const restart = vi.fn();
    restartAfterResponse(response, restart);
    expect(restart).toHaveBeenCalledTimes(1);
  });
  it("requests restart when the response has already finished", () => {
    const response = outgoing();
    Object.defineProperty(response, "writableFinished", { value: true });
    const restart = vi.fn();
    restartAfterResponse(response, restart);
    expect(restart).toHaveBeenCalledTimes(1);
  });
  it("lets a real HTTP response finish before requesting server shutdown", async () => {
    const events: string[] = [];
    const server = createServer((_request, response) => {
      response.on("finish", () => events.push("finish"));
      restartAfterResponse(response, () => {
        events.push("restart");
        server.close();
      });
      events.push("committed");
      response.end(JSON.stringify({ repaired: true }));
    });
    try {
      server.listen(0, "127.0.0.1");
      await once(server, "listening");
      const address = server.address();
      if (address === null || typeof address === "string") throw new Error("Missing HTTP address");
      const response = await fetch(`http://127.0.0.1:${address.port}`);
      expect(await response.json()).toEqual({ repaired: true });
      expect(events).toEqual(["committed", "finish", "restart"]);
    } finally {
      server.closeAllConnections();
      if (server.listening) await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
  it("restarts at once when there is no response to wait for", () => {
    const restart = vi.fn();
    restartAfterResponse(undefined, restart);
    expect(restart).toHaveBeenCalledTimes(1);
  });
  it("restarts at once when the connection has already closed", () => {
    const response = outgoing();
    Object.defineProperty(response, "closed", { value: true });
    const restart = vi.fn();
    restartAfterResponse(response, restart);
    expect(restart).toHaveBeenCalledTimes(1);
  });
});

describe("a restart that fails", () => {
  const escaped: unknown[] = [];
  const collect = (reason: unknown) => escaped.push(reason);
  beforeEach(() => {
    escaped.length = 0;
    process.on("unhandledRejection", collect);
    process.on("uncaughtException", collect);
  });
  afterEach(() => {
    process.off("unhandledRejection", collect);
    process.off("uncaughtException", collect);
  });
  const settle = () => new Promise((resolve) => setTimeout(resolve, 10));
  const failures: [string, () => void | Promise<void>][] = [
    [
      "throws",
      () => {
        throw new AppError("recovery.rate_limited", {});
      },
    ],
    ["rejects", () => Promise.reject(new AppError("recovery.rate_limited", {}))],
  ];

  it.each(failures)("is logged and nothing escapes when it %s on 'finish'", async (_, restart) => {
    const response = outgoing();
    const log = vi.fn();
    restartAfterResponse(response, restart, log);
    expect(() => response.emit("finish")).not.toThrow();
    await settle();
    expect(log).toHaveBeenCalledExactlyOnceWith("error", "server.restart_failed", {
      errorCode: "recovery.rate_limited",
      errno: null,
      reason: null,
    });
    expect(escaped).toEqual([]);
  });
  it.each(failures)(
    "is logged and nothing escapes when it %s with no response",
    async (_, restart) => {
      const log = vi.fn();
      expect(() => restartAfterResponse(undefined, restart, log)).not.toThrow();
      await settle();
      expect(log).toHaveBeenCalledOnce();
      expect(escaped).toEqual([]);
    },
  );
  it("logs an errno and a reason when the failure carries them", async () => {
    const log = vi.fn();
    const failure = Object.assign(new Error("exit failed"), { code: "EIO" });
    restartAfterResponse(
      undefined,
      () => {
        throw failure;
      },
      log,
    );
    restartAfterResponse(
      undefined,
      () => Promise.reject(new AppError("recovery.rate_limited", {}, { reason: "probe" })),
      log,
    );
    await settle();
    expect(log.mock.calls).toEqual([
      ["error", "server.restart_failed", { errorCode: null, errno: "EIO", reason: null }],
      [
        "error",
        "server.restart_failed",
        { errorCode: "recovery.rate_limited", errno: null, reason: "probe" },
      ],
    ]);
  });
  it.each(failures)(
    "leaves nothing escaping when it %s and the logger throws too",
    async (_, restart) => {
      const response = outgoing();
      const log = vi.fn(() => {
        throw new Error("log down");
      });
      restartAfterResponse(response, restart, log);
      expect(() => response.emit("close")).not.toThrow();
      await settle();
      expect(log).toHaveBeenCalledOnce();
      expect(escaped).toEqual([]);
    },
  );
});
