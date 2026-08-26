import { createServer } from "node:http";
import { describe, expect, it } from "vitest";
import { fetchHttpClient } from "./sync-http.js";

describe("fetchHttpClient forwards method and body (cursor-report POST)", () => {
  it("POSTs a body and returns the status/text", async () => {
    const received: { method?: string; body: string } = { body: "" };
    const server = createServer((req, res) => {
      received.method = req.method;
      let b = "";
      req.on("data", (c) => (b += c));
      req.on("end", () => {
        received.body = b;
        res.writeHead(200, { "content-type": "text/plain" });
        res.end("ok");
      });
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    const port = (server.address() as { port: number }).port;
    try {
      const res = await fetchHttpClient(`http://127.0.0.1:${port}/sync-api/cursor`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ subscriberId: "n", lane: "fast", lastAppliedSeq: "3" }),
      });
      expect(res.status).toBe(200);
      expect(await res.text()).toBe("ok");
      expect(received.method).toBe("POST");
      expect(JSON.parse(received.body)).toEqual({
        subscriberId: "n",
        lane: "fast",
        lastAppliedSeq: "3",
      });
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});
