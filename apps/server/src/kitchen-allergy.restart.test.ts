import { spawn } from "node:child_process";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { sql } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { openVenueDatabase } from "@waitron/db";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import type { KitchenAllergyBlock } from "@waitron/module";
import { copyMigrationsRoot } from "./testing/boot-harness.js";
import { freePorts } from "./testing/free-ports.js";
import { SESSION_COOKIE } from "./till-session.js";
import {
  kitchenCallers,
  kitchenCommand,
  kitchenCurrent,
  kitchenFixture,
  kitchenOriginal,
  kitchenState,
} from "./testing/kitchen-allergy-fixture.js";

const suite = useVenueDb({ migrations: migrationOptionsFor(manifestSets(), null) });

async function boot(env: NodeJS.ProcessEnv) {
  const child = spawn(
    process.execPath,
    [
      "--import",
      pathToFileURL(createRequire(import.meta.url).resolve("tsx")).href,
      fileURLToPath(new URL("./bin.ts", import.meta.url)),
    ],
    { env, stdio: ["ignore", "pipe", "pipe"] },
  );
  let output = "";
  child.stdout.on("data", (chunk: Buffer) => {
    output += chunk.toString();
  });
  child.stderr.on("data", (chunk: Buffer) => {
    output += chunk.toString();
  });
  const exited = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>(
    (resolve, reject) => {
      child.once("error", reject);
      child.once("exit", (code, signal) => resolve({ code, signal }));
    },
  );
  const stop = async () => {
    if (child.exitCode === null && child.signalCode === null) child.kill("SIGTERM");
    const deadline = setTimeout(() => child.kill("SIGKILL"), 12_000);
    try {
      return await exited;
    } finally {
      clearTimeout(deadline);
    }
  };
  try {
    await vi.waitFor(
      () => {
        expect(child.exitCode, output).toBeNull();
        expect(output, output).toContain('"event":"server.listening"');
      },
      { timeout: 30_000 },
    );
    return {
      pid: child.pid!,
      close: async () => {
        expect(await stop(), output).toEqual({ code: 0, signal: null });
      },
    };
  } catch (error) {
    await stop();
    throw error;
  }
}

interface Queue {
  items: { items: { id: string; allergy: KitchenAllergyBlock | null }[] }[];
  notices: {
    id: string;
    kind: string;
    allergyBlock?: KitchenAllergyBlock | null;
    quantity: string;
  }[];
}

describe("A669 atomic fresh server processes", () => {
  it.each(kitchenCallers)(
    "%s retains original, correction, exact retry and acknowledgement across new PIDs",
    async (caller) => {
      const f = await kitchenFixture(suite.db);
      const command = await kitchenCommand(f, caller);
      const scratch = await mkdtemp(join(tmpdir(), "waitron-kitchen-allergy-restart-"));
      let server: Awaited<ReturnType<typeof boot>> | undefined;
      try {
        const venueDir = join(scratch, "venue");
        await mkdir(venueDir);
        await suite.db.run(sql`vacuum into ${join(venueDir, "venue.db")}`);
        const migrationsRoot = join(scratch, "migrations");
        await copyMigrationsRoot(migrationsRoot);
        await writeFile(
          join(scratch, "modules.json"),
          JSON.stringify({ modules: { "fiscal-none": false } }),
        );
        const ports = await freePorts(3);
        const env: NodeJS.ProcessEnv = {
          ...Object.fromEntries(
            Object.entries(process.env).filter(([key]) => !key.startsWith("WAITRON_")),
          ),
          WAITRON_HTTP_HOST: "127.0.0.1",
          WAITRON_HTTP_LANDING_PORT: "0",
          WAITRON_HTTP_PORT: String(ports[0]),
          WAITRON_STATE_DIR: scratch,
          WAITRON_VENUE_DIR: venueDir,
          WAITRON_TILL_NODE_ID: f.v.cfg.nodeId,
          WAITRON_TILL_LOCATION_ID: f.v.cfg.locationId,
          WAITRON_MIGRATIONS_DIR: migrationsRoot,
          WAITRON_ENV: "preproduction",
          WAITRON_CLOUD_ORIGIN: "https://cloud.example",
          WAITRON_CREDENTIALS_KEY: Buffer.alloc(32, 5).toString("base64"),
          WAITRON_CREDENTIALS_KEY_VERSION: "1",
          WAITRON_FISCAL_TEST_SUBMISSIONS: "enabled",
        };
        let port = ports[0];
        const persisted = async () => {
          const db = await openVenueDatabase(venueDir);
          try {
            return await kitchenState(db.venue);
          } finally {
            await db.close();
          }
        };
        const request = (
          path: string,
          body?: unknown,
          method = body === undefined ? "GET" : "POST",
        ) =>
          fetch(`http://127.0.0.1:${port}${path}`, {
            method,
            headers: { "content-type": "application/json", cookie: `${SESSION_COOKIE}=${f.token}` },
            ...(body === undefined ? {} : { body: JSON.stringify(body) }),
            signal: AbortSignal.timeout(10_000),
          });
        const submit = async () => {
          const response = await request(command.url, command.body, command.method);
          const result: unknown = await response.json();
          expect(response.status, JSON.stringify(result)).toBe(200);
          return result;
        };
        const queue = async () => {
          const response = await request(`/api/stations/${f.ticket.stationId}/queue`);
          expect(response.status).toBe(200);
          return (await response.json()) as Queue;
        };
        server = await boot(env);
        const firstPid = server.pid;
        const result = await submit();
        const before = await queue();
        expect(
          before.items.flatMap((row) => row.items).find((item) => item.id === f.ticket.id)?.allergy,
        ).toEqual(kitchenOriginal);
        const notices = before.notices.filter((notice) => notice.kind === "allergy_changed");
        expect(notices).toHaveLength(1);
        expect(notices[0]).toMatchObject({ allergyBlock: kitchenCurrent, quantity: "3.000" });
        await server.close();
        server = undefined;
        const firstState = await persisted();
        expect(firstState.copies.find((row) => row.ticketItemId === f.ticket.id)).toEqual({
          ticketItemId: f.ticket.id,
          originalBlock: kitchenOriginal,
          currentBlock: kitchenCurrent,
        });
        expect(firstState.jobs.length).toBeGreaterThan(0);
        port = ports[1];
        server = await boot({ ...env, WAITRON_HTTP_PORT: String(port) });
        expect(server.pid).not.toBe(firstPid);
        expect(await queue()).toEqual(before);
        expect(await submit()).toEqual(result);
        expect(await queue()).toEqual(before);
        const mismatch = structuredClone(command.body);
        (mismatch.allergy as { party: { guests: { note: string }[] } }).party.guests[0]!.note =
          "Changed after restart";
        const refused = await request(command.url, mismatch, command.method);
        expect(refused.status).toBe(409);
        expect(await refused.json()).toMatchObject({ error: { code: "submission.id_reused" } });
        expect(await queue()).toEqual(before);
        const ack = await request(`/api/kitchen-notices/${notices[0]!.id}/acknowledge`, {});
        expect(ack.status).toBe(200);
        const acknowledged = await queue();
        expect(acknowledged.notices.filter((notice) => notice.kind === "allergy_changed")).toEqual(
          [],
        );
        const secondPid = server.pid;
        await server.close();
        server = undefined;
        const secondState = await persisted();
        expect(secondState).toEqual({
          ...firstState,
          notices: firstState.notices.map((notice) =>
            notice.id === notices[0]!.id
              ? { ...notice, acknowledgedAt: expect.any(String) }
              : notice,
          ),
        });
        port = ports[2];
        server = await boot({ ...env, WAITRON_HTTP_PORT: String(port) });
        expect(server.pid).not.toBe(secondPid);
        expect(server.pid).not.toBe(firstPid);
        expect(await queue()).toEqual(acknowledged);
        expect(await submit()).toEqual(result);
        expect(await queue()).toEqual(acknowledged);
        await server.close();
        server = undefined;
        expect(await persisted()).toEqual(secondState);
      } finally {
        try {
          await server?.close();
        } finally {
          await rm(scratch, { recursive: true, force: true });
        }
      }
    },
    300_000,
  );
});
