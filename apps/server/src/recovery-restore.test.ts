import { BOX_LEAF_HOSTNAMES } from "./box-name.js";
import { runEntry } from "./node-entry.js";
import { loadBoxEnv } from "./box-env.js";
import { withRecoveryLock } from "./recovery-lock.js";
import { startServer } from "./boot.js";
import { ensureBoxSecrets } from "./box-secrets.js";
import { copyMigrationsRoot } from "./testing/boot-harness.js";
import { retainHttpListener } from "./testing/retained-http-listener.js";
import { adoptRetainedListeners } from "./testing/retained-http-adoption.mjs";
import { Agent } from "undici";
import { Socket } from "node:net";
import { TLSSocket } from "node:tls";
import { mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { hashPassword } from "@waitron/identity";
import { recoveryApp } from "./recovery-surface.js";
import { FRESH, readRecoveryState, writeRecoveryState } from "./recovery-state.js";
import { publishRestoreFlow } from "./restore-flow.js";
import { RESTORE_DISCARD_TEXT } from "./i18n/recovery-page.js";

const password = "the backup administrator password";
const hashes = [hashPassword(password)];
const dirs: string[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});
async function fixture(phase: "staged" | "placing" | "first-start" | "unreadable") {
  const stateDir = await mkdtemp(join(tmpdir(), "restore-discard-"));
  dirs.push(stateDir);
  const venueDir = join(stateDir, "venue");
  await mkdir(venueDir);
  await mkdir(join(stateDir, "tls"));
  await writeFile(join(stateDir, "tls/ca.crt"), "trusted CA");
  await writeFile(join(venueDir, "venue.db"), "destination database");
  await writeFile(join(stateDir, "trading.env"), "destination identity");
  await writeFile(join(stateDir, "secrets.env"), "destination secrets");
  await publishRestoreFlow(
    stateDir,
    {
      version: 1,
      phase: phase === "unreadable" ? "staged" : phase,
      request: { version: 1, environment: "preproduction" },
    },
    async (dir) => {
      await writeFile(join(dir, "admin-verifiers"), JSON.stringify(hashes), { mode: 0o600 });
    },
  );
  if (phase === "unreadable")
    await writeFile(join(stateDir, "flows/restore/record.json"), "broken");
  const state = { ...FRESH, level: "recovery" as const, lastErrorCode: "restore.flow_unreadable" };
  await writeRecoveryState(stateDir, state);
  const app = recoveryApp({
    state,
    logDir: stateDir,
    onRetry: async () => {},
    restore: {
      roots: { stateDir, venueDir },
      onFinished: async () => {},
    },
  });
  const request = async (path: string, body?: string, locale = "en-GB", secure = true) => {
    const socket = secure ? new TLSSocket(new Socket()) : new Socket();
    try {
      return await app.request(
        `https://box.test${path}`,
        {
          headers: { Origin: "https://box.test", "Accept-Language": locale },
          ...(body === undefined ? {} : { method: "POST", body: new URLSearchParams(body) }),
        },
        { incoming: { socket } },
      );
    } finally {
      socket.destroy();
    }
  };
  const discard = () =>
    request(
      "/recovery-api/restore/discard",
      new URLSearchParams({ choice: "move", password }).toString(),
    );
  return { stateDir, venueDir, request, discard };
}
it("offers the discard form for unreadable state in both languages, with a safe Stop", async () => {
  const f = await fixture("unreadable");
  for (const locale of ["en-GB", "es-ES"] as const) {
    const { move: action, stop } = RESTORE_DISCARD_TEXT[locale];
    const body = await (await f.request("/", undefined, locale)).text();
    expect(body).toContain(`>${action}</button>`);
    expect(body).toContain(`formnovalidate>${stop}</button>`);
    expect(body).toContain('name="password"');
    expect(body).toContain('action="/recovery-api/restore/discard"');
    expect(await (await f.request("/", undefined, locale, false)).text()).not.toContain(
      'name="password"',
    );
  }
});
it("preserves destination data before copying, puts its identity back and ends the request", async () => {
  const f = await fixture("staged");
  await rm(join(f.stateDir, "trading.env"));
  await writeFile(join(f.stateDir, "trading.env.replaced"), "destination identity");
  expect((await f.discard()).status).toBe(200);
  expect(await readFile(join(f.venueDir, "venue.db"), "utf8")).toBe("destination database");
  expect(await readFile(join(f.stateDir, "trading.env"), "utf8")).toBe("destination identity");
  expect(await readFile(join(f.stateDir, "secrets.env"), "utf8")).toBe("destination secrets");
  await expect(stat(join(f.stateDir, "flows/restore"))).rejects.toMatchObject({ code: "ENOENT" });
});
it.each(["placing", "first-start", "unreadable"] as const)(
  "removes partial databases and configuration at %s, keeping trusted TLS",
  async (phase) => {
    const f = await fixture(phase);
    for (const name of [
      "trading.env.replaced",
      "backup.env",
      "modules.json",
      "backup-room-note.json",
      "flows/setup/operation.json",
    ])
      await writeFile(join(f.stateDir, name), "partial");
    for (const name of ["node.db", "venue.db.incoming", "venue.db-wal", "node.db-shm"])
      await writeFile(join(f.venueDir, name), "partial");
    await mkdir(join(f.venueDir, ".venue.db-litestream"));
    const page = await (await f.request("/")).text();
    expect(page).toContain("previous database");
    const answer = await f.discard();
    expect(answer.status).toBe(200);
    expect(await answer.text()).toContain("restore again");
    expect(await readdir(f.venueDir)).toEqual(["venue.lock"]);
    for (const name of [
      "trading.env",
      "trading.env.replaced",
      "secrets.env",
      "backup.env",
      "modules.json",
      "backup-room-note.json",
      "flows/setup/operation.json",
      "flows/restore",
    ])
      await expect(stat(join(f.stateDir, name)), name).rejects.toMatchObject({ code: "ENOENT" });
    expect(await readFile(join(f.stateDir, "tls/ca.crt"), "utf8")).toBe("trusted CA");
    expect((await readRecoveryState(f.stateDir)).level).toBe("normal");
  },
);
it("keeps a failed cleanup blocking and can try the same discard again", async () => {
  const f = await fixture("placing");
  await rm(join(f.venueDir, "venue.db"));
  await mkdir(join(f.venueDir, "venue.db"));
  expect((await f.discard()).status).toBe(409);
  expect(await readFile(join(f.stateDir, "flows/restore/admin-verifiers"), "utf8")).toBe(
    JSON.stringify(hashes),
  );
  await rm(join(f.venueDir, "venue.db"), { recursive: true });
  expect((await f.discard()).status).toBe(200);
});

it("sets up again after a box with its own identity throws away a placed restore", async () => {
  const f = await fixture("placing");
  await writeFile(join(f.stateDir, "trading.env.replaced"), "WAITRON_NODE_ID=old-box\n");
  await rm(join(f.stateDir, "tls"), { recursive: true });
  await rm(join(f.stateDir, "secrets.env"));
  await ensureBoxSecrets({
    stateDir: f.stateDir,
    hostnames: BOX_LEAF_HOSTNAMES,
    listIpv4: () => [],
    now: () => new Date(),
  });
  const ca = await readFile(join(f.stateDir, "tls/ca.crt"));
  await mkdir(join(f.venueDir, ".venue.db-replaced-failed-move"));
  await writeFile(
    join(f.venueDir, ".venue.db-replaced-failed-move/venue.db"),
    "old database left by failed move",
  );
  expect((await f.discard()).status).toBe(200);
  const migrationsRoot = join(f.stateDir, "test-migrations");
  await copyMigrationsRoot(migrationsRoot);
  const held = await retainHttpListener();
  const adoption = adoptRetainedListeners([held]);
  const agent = new Agent({ connect: { ca } });
  let server: Awaited<ReturnType<typeof startServer>> | undefined;
  try {
    const baseEnv = {
      WAITRON_STATE_DIR: f.stateDir,
      WAITRON_VENUE_DIR: f.venueDir,
      WAITRON_HTTP_HOST: "127.0.0.1",
      WAITRON_HTTP_PORT: String(held.port),
      WAITRON_HTTP_LANDING_PORT: "0",
      WAITRON_MIGRATIONS_DIR: migrationsRoot,
      WAITRON_MANAGEMENT_RP_ID: "localhost",
      WAITRON_MANAGEMENT_ORIGIN: "https://localhost",
    };
    await runEntry({
      stateDir: f.stateDir,
      venueDir: f.venueDir,
      args: [],
      spareBytes: 0,
      baseEnv,
      loadBoxEnv,
      readRecoveryState,
      writeRecoveryState,
      withRecoveryLock,
      startServer: async (env, base) => {
        server = await startServer(env, base);
        return server;
      },
      serveRecovery: async () => {
        throw new Error("discarded restore still blocks setup");
      },
      scheduleStayedUp: () => {},
      installShutdownHandlers: () => {},
      log: () => {},
    });
    await adoption.bound;
    const answer = await fetch(`https://127.0.0.1:${held.port}/setup-api/status`, {
      dispatcher: agent,
    } as RequestInit);
    expect(answer.status).toBe(200);
    expect(await answer.json()).toMatchObject({ provisioned: false, needs: ["venue"] });
    expect(await readFile(join(f.stateDir, "tls/ca.crt"))).toEqual(ca);
  } finally {
    adoption.restore();
    await agent.close();
    await server?.close();
    if (held.server.listening) await held.close();
  }
}, 60_000);

it("keeps the recovery page usable when the restore folder cannot be read", async () => {
  const f = await fixture("unreadable");
  await rm(join(f.stateDir, "flows/restore"), { recursive: true });
  await writeFile(join(f.stateDir, "flows/restore"), "not a folder");
  const answer = await f.request("/");
  expect(answer.status).toBe(200);
  const body = await answer.text();
  expect(body).toContain("restore.flow_unreadable");
  expect(body).toContain('action="/recovery-api/retry"');
  expect(body).not.toContain('name="password"');
});

it("refuses to discard with a wrong password and keeps the database and request", async () => {
  const f = await fixture("placing");
  const record = await readFile(join(f.stateDir, "flows/restore/record.json"));
  const answer = await f.request("/recovery-api/restore/discard", "choice=move&password=wrong");
  expect(answer.status).toBe(403);
  expect(await readFile(join(f.venueDir, "venue.db"), "utf8")).toBe("destination database");
  expect(await readFile(join(f.stateDir, "flows/restore/record.json"))).toEqual(record);
});
