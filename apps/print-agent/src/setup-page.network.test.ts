import { serve, type ServerType } from "@hono/node-server";
import type { AgentSetupSnapshot } from "@waitron/print-agent";
import type { AddressInfo } from "node:net";
import { networkInterfaces } from "node:os";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createSetupApp } from "./setup-page.js";

describe("setup page socket boundary", () => {
  let server: ServerType | undefined;
  let port: number;
  let lanAddress: string;

  beforeAll(async () => {
    const address = Object.values(networkInterfaces())
      .flat()
      .find((candidate) => candidate?.internal === false && candidate.family === "IPv4")?.address;
    if (address === undefined) {
      throw new Error("the setup-page network test requires a non-loopback IPv4 interface");
    }
    lanAddress = address;
    const current: AgentSetupSnapshot = {
      status: {
        phase: "running",
        serverUrl: "https://box.test",
        current: "https://box.test",
      },
      config: { serverUrl: "https://box.test", name: "kitchen" },
      joined: true,
      outOfTouch: false,
    };
    const app = createSetupApp({
      snapshot: async () => current,
      configure: async () => false,
      beginNetworkReset: async () => false,
      cancelNetworkReset: async () => false,
      envLocked: false,
      defaultName: "kitchen",
      now: () => 0,
    });
    await new Promise<void>((resolve) => {
      server = serve({ fetch: app.fetch, port: 0, hostname: "0.0.0.0" }, (info: AddressInfo) => {
        port = info.port;
        resolve();
      });
    });
  });

  afterAll(async () => {
    if (server !== undefined) {
      await new Promise<void>((resolve, reject) => {
        server!.close((error) => (error ? reject(error) : resolve()));
      });
    }
  });

  it("refuses the joined page through a LAN socket and serves it through loopback", async () => {
    expect((await fetch(`http://${lanAddress}:${port}/`)).status).toBe(403);
    expect((await fetch(`http://127.0.0.1:${port}/`)).status).toBe(200);
  });
});
