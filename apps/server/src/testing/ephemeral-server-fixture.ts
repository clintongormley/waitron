import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Database } from "@waitron/db";
import { expect, vi } from "vitest";
import { seedModuleSettings } from "../../test/module-settings.js";
import type { StartedServer } from "../boot.js";
import { copyMigrationsRoot, tradingBootEnv } from "./boot-trading-fixture.js";
import { freePorts } from "./free-ports.js";
import { listener } from "./ephemeral-listener.js";
import { serverFixture } from "./server-fixture.js";

/** Requires the test's Hono mock to delegate to `ephemeralHttpMock`. */
export function ephemeralServerFixture() {
  const fixture = serverFixture();
  const currentListener = () => listener.current;
  const httpPort = () => {
    if (listener.port === undefined) throw new Error("the boot listener has not bound");
    return listener.port;
  };
  const startServer = async (...args: Parameters<typeof fixture.startServer>) => {
    listener.current = undefined;
    listener.port = undefined;
    const server = await fixture.startServer(...args);
    try {
      const bound = currentListener();
      if (!bound) throw new Error("boot returned without an HTTP listener");
      if (!bound.listening) await once(bound, "listening");
      return server;
    } catch (error) {
      await server.close();
      throw error;
    }
  };
  const startConfiguredServer = async (...args: Parameters<typeof fixture.startServer>) => {
    listener.configured = true;
    try {
      return await fixture.startServer(...args);
    } finally {
      listener.configured = false;
    }
  };
  return { ...fixture, startServer, startConfiguredServer, httpPort };
}

export async function withTradingBootServer(
  options: {
    db: Database;
    nodeId: string;
    scratchPrefix: string;
    start: (env: Record<string, string>) => Promise<StartedServer>;
    httpPort: () => number;
  },
  use: (base: string) => Promise<void>,
): Promise<void> {
  const [port] = await freePorts(1);
  const scratch = await mkdtemp(join(tmpdir(), options.scratchPrefix));
  let server: StartedServer | undefined;
  try {
    const migrationsRoot = join(scratch, "migrations");
    await copyMigrationsRoot(migrationsRoot);
    await seedModuleSettings(options.db, { "fiscal-none": false });
    server = await options.start({
      ...tradingBootEnv(options.db, scratch, options.nodeId, migrationsRoot),
      WAITRON_HTTP_PORT: String(port),
    });
    const base = `http://127.0.0.1:${options.httpPort()}`;
    await vi.waitFor(async () => {
      expect((await fetch(`${base}/health`)).status).toBe(200);
    });
    await use(base);
  } finally {
    if (server !== undefined) await server.close();
    await rm(scratch, { recursive: true, force: true });
  }
}
