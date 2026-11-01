import { expect, it } from "vitest";
import { Hono } from "hono";
import { TLSSocket } from "node:tls";
import { Socket } from "node:net";
import { createErrorBoundary } from "@waitron/server-kit";
import { requireNodeOperationHttps } from "./node-operation-https.js";

async function request(headers: Record<string, string> = {}, tls: boolean | "forged" = true) {
  const socket =
    tls === "forged" ? { encrypted: true } : tls ? new TLSSocket(new Socket()) : new Socket();
  try {
    const app = new Hono();
    const boundary = createErrorBoundary(
      { "authorization.not_permitted": 403 },
      "promotion.failed",
    );
    app.post("/operation", (c) =>
      boundary(
        c,
        () => {},
        async () => {
          requireNodeOperationHttps(c);
          return c.json({ admitted: true });
        },
      ),
    );
    return await app.request(
      "https://box.test/operation",
      { method: "POST", headers },
      { incoming: { socket } },
    );
  } finally {
    if (socket instanceof Socket) socket.destroy();
  }
}

it("refuses a plain object claiming encryption instead of an actual TLS socket", async () => {
  expect((await request({}, "forged")).status).toBe(403);
});
it.each<Record<string, string>>([
  {},
  { Origin: "https://box.test", "Sec-Fetch-Site": "same-origin" },
  { "Sec-Fetch-Site": "none" },
])("admits a real TLS socket with compatible origin and site %j", async (headers) => {
  const response = await request(headers);
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ admitted: true });
});
it.each<Record<string, string>>([
  { Origin: "https://evil.test" },
  { Origin: "null" },
  { "Sec-Fetch-Site": "same-site" },
  { "Sec-Fetch-Site": "cross-site" },
])("refuses incompatible browser context %j", async (headers) => {
  expect((await request(headers)).status).toBe(403);
});
it.each<Record<string, string>>([
  {},
  { "X-Forwarded-Proto": "https", Forwarded: "proto=https", Origin: "https://box.test" },
])("refuses a cleartext socket despite proxy headers %j", async (headers) => {
  expect((await request(headers, false)).status).toBe(403);
});
