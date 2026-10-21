import { IncomingMessage, ServerResponse, createServer } from "node:http";
import { Socket } from "node:net";
import { once } from "node:events";
import { describe, expect, it, vi } from "vitest";
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
});
