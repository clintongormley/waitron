import { expect, it } from "vitest";
import { Hono } from "hono";
import { Socket } from "node:net";
import { TLSSocket } from "node:tls";

it.each(["absent", "plain", "forged", "unencrypted TLS", "TLS"] as const)(
  "checks the actual socket for %s, ignoring proxy claims",
  async (kind) => {
    const { isSecure } = await import("./encrypted-connection.js");
    const socket =
      kind === "absent"
        ? undefined
        : kind === "forged"
          ? { encrypted: true }
          : kind === "plain"
            ? new Socket()
            : new TLSSocket(new Socket());
    if (kind === "unencrypted TLS") Object.defineProperty(socket, "encrypted", { value: false });
    try {
      const app = new Hono();
      app.get("/", (c) => c.json({ secure: isSecure(c) }));
      const response = await app.request(
        "https://box.test/",
        {
          headers: { "X-Forwarded-Proto": "https", Forwarded: "proto=https" },
        },
        { incoming: { socket } },
      );
      expect(await response.json()).toEqual({ secure: kind === "TLS" });
    } finally {
      if (socket instanceof Socket) socket.destroy();
    }
  },
);
