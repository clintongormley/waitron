import { mkdtemp, mkdir, readFile, rm, stat, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { request as httpsRequest } from "node:https";
import { afterEach, beforeAll, expect, it, vi } from "vitest";
import type { Hono } from "hono";
import * as entry from "./node-entry.js";
import { FRESH } from "./recovery-state.js";
import { firstFiscalFixture } from "../test/first-fiscal.js";
import {
  START_AGAIN_MARKER_FILE,
  startAgainMarkerFor,
  writeStartAgainMarker,
} from "@waitron/provisioning";
import { CORE_MIGRATIONS, LOG_FILE_NAME } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { resolveFirstSetupEntry } from "./first-setup-entry.js";
import { spawnSync } from "node:child_process";
import { serveRecovery } from "./recovery-listener.js";
import { closeListener } from "./close-listener.js";
import { freePorts } from "./testing/free-ports.js";
import { escapeHtml, OPERATOR_TEXT } from "./recovery-surface.js";
import { mintSelfSignedServerCert, type SelfSignedMaterial } from "./self-signed-cert.js";
const suite = useVenueDb({ migrations: [CORE_MIGRATIONS] });

const dirs: string[] = [];
const closes: (() => Promise<void>)[] = [];
afterEach(async () => {
  await Promise.all(closes.splice(0).map((close) => close()));
  await Promise.all(dirs.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});
async function torn() {
  const root = await mkdtemp(join(tmpdir(), "resolution-entry-"));
  dirs.push(root);
  const stateDir = join(root, "state"),
    venueDir = join(root, "venue");
  await mkdir(stateDir);
  await mkdir(venueDir);
  await writeFile(join(venueDir, "first-setup-claim.json"), "{}");
  await writeFile(join(stateDir, "restore-request.json"), "retained restore");
  await writeFile(join(stateDir, "reset-request.json"), "retained reset");
  return { root, stateDir, venueDir };
}
const stopped = () => Promise.resolve({ close: async () => {} });
/** Keeps the start's free-space step out of cases that do not test it, whatever the temp folder holds. */
const plentyOfSpace = async () => ({ bavail: Number.MAX_SAFE_INTEGER, frsize: 1 });

it("direct entry serves resolution before strict boot or creating a missing database", async () => {
  const f = await torn();
  const boot = vi.fn(stopped);
  let app: Hono | undefined;
  const server = await entry.startServerOrFirstSetupResolution(
    {
      WAITRON_STATE_DIR: f.stateDir,
      WAITRON_VENUE_DIR: f.venueDir,
    },
    {},
    {
      startServer: boot,
      serveResolution: async (surface: Hono) => {
        app = surface;
        return stopped();
      },
    },
  );
  await server.close();
  expect(boot).not.toHaveBeenCalled();
  expect((await app!.request("/setup-api/first-setup/resolution")).status).toBe(200);
  expect(await (await app!.request("/setup-api/first-setup/status")).json()).toEqual({
    claimed: true,
    resolution: true,
  });
  for (const path of [
    "/setup-api/provision",
    "/setup-api/restore",
    "/setup-api/first-setup/claim",
    "/retry",
    "/api/till/session",
  ])
    expect((await app!.request(path, { method: "POST" })).status).toBe(404);
  await expect(stat(join(f.venueDir, "venue.db"))).rejects.toMatchObject({ code: "ENOENT" });
  expect(await readFile(join(f.stateDir, "restore-request.json"), "utf8")).toBe("retained restore");
});

it.each([FRESH, { ...FRESH, level: "recovery" as const, failures: 3 }])(
  "supervised entry gives resolution precedence over level $level and all staged work",
  async (recovery) => {
    const f = await torn();
    const forbidden = vi.fn(async () => {
      throw new Error("ordinary boot reached");
    });
    let app: Hono | undefined;
    await entry.runEntry({
      ...f,
      args: [],
      statfs: plentyOfSpace,
      baseEnv: {},
      readRecoveryState: async () => recovery,
      writeRecoveryState: forbidden,
      loadBoxEnv: forbidden,
      runStagedRestore: forbidden,
      runStagedReset: forbidden,
      clearReplacedDatabases: forbidden,
      assertNotAhead: forbidden,
      startServer: forbidden,
      serveRecovery: async (surface) => {
        app = surface;
      },
      scheduleStayedUp: forbidden,
      installShutdownHandlers: forbidden,
      log: () => {},
    });
    expect(forbidden).not.toHaveBeenCalled();
    expect((await app!.request("/setup-api/first-setup/resolution")).status).toBe(200);
    expect((await app!.request("/retry", { method: "POST" })).status).toBe(404);
    await expect(stat(join(f.venueDir, "venue.db"))).rejects.toMatchObject({ code: "ENOENT" });
    expect(await readFile(join(f.stateDir, "reset-request.json"), "utf8")).toBe("retained reset");
  },
);

it("a strictly paired attempt with a missing database reaches resolution without creating it", async () => {
  const f = await firstFiscalFixture();
  try {
    let app: Hono | undefined;
    const boot = vi.fn(stopped);
    await entry.startServerOrFirstSetupResolution(
      { WAITRON_STATE_DIR: f.stateDir, WAITRON_VENUE_DIR: f.venueDir },
      {},
      {
        startServer: boot,
        serveResolution: async (surface: Hono) => {
          app = surface;
          return stopped();
        },
      },
    );
    expect(boot).not.toHaveBeenCalled();
    expect(await (await app!.request("/setup-api/first-setup/resolution")).json()).toMatchObject({
      pair: "valid",
      database: "missing",
      password: "checkable",
    });
    await expect(stat(join(f.venueDir, "venue.db"))).rejects.toMatchObject({ code: "ENOENT" });
  } finally {
    await f.dispose();
  }
});

it("direct entry still boots a normal unclaimed workspace", async () => {
  const f = await torn();
  await rm(join(f.venueDir, "first-setup-claim.json"));
  const boot = vi.fn(stopped);
  await entry.startServerOrFirstSetupResolution(
    { WAITRON_STATE_DIR: f.stateDir, WAITRON_VENUE_DIR: f.venueDir },
    {},
    { startServer: boot },
  );
  expect(boot).toHaveBeenCalledOnce();
});

it("an ordinary filesystem refusal still belongs to strict boot", async () => {
  const f = await torn();
  const file = join(f.root, "file");
  await writeFile(file, "ordinary path error");
  const boot = vi.fn(async () => {
    throw new Error("strict filesystem refusal");
  });
  await expect(
    entry.startServerOrFirstSetupResolution(
      { WAITRON_STATE_DIR: f.stateDir, WAITRON_VENUE_DIR: join(file, "venue") },
      {},
      { startServer: boot },
    ),
  ).rejects.toThrow("strict filesystem refusal");
  expect(boot).toHaveBeenCalledOnce();
});

it("rechecks the unfinished database after taking the startup locks", async () => {
  const f = await firstFiscalFixture();
  try {
    const path = join(f.venueDir, "venue.db");
    await suite.db.archiveTo(path);
    const admission = await resolveFirstSetupEntry(f, {});
    expect(admission.kind).toBe("normal");
    if (admission.kind !== "normal") throw new Error("expected ordinary owner setup");
    await rm(path);
    const boot = vi.fn(stopped);
    await expect(admission.run(boot)).rejects.toMatchObject({ code: "setup.attempt_uncertain" });
    expect(boot).not.toHaveBeenCalled();
    await expect(stat(path)).rejects.toMatchObject({ code: "ENOENT" });
  } finally {
    await f.dispose();
  }
});

it("a completed marker cannot make a missing committed database look like a new installation", async () => {
  const f = await firstFiscalFixture();
  try {
    let state = (await f.store.read())!;
    for (const change of [
      { kind: "activation-started" },
      { kind: "committed", result: {} },
      { kind: "publication" },
      { kind: "complete" },
    ] as const)
      state = await f.store.update(state.frozen.attemptId, state.revision, change);
    expect((await f.store.readResumable())?.publicationComplete).toBe(true);
    let app: Hono | undefined;
    const boot = vi.fn(stopped);
    await entry.startServerOrFirstSetupResolution(
      { WAITRON_STATE_DIR: f.stateDir, WAITRON_VENUE_DIR: f.venueDir },
      {},
      {
        startServer: boot,
        serveResolution: async (surface) => {
          app = surface;
          return stopped();
        },
      },
    );
    expect(boot).not.toHaveBeenCalled();
    expect((await app!.request("/setup-api/first-setup/resolution")).status).toBe(200);
    await expect(stat(join(f.venueDir, "venue.db"))).rejects.toMatchObject({ code: "ENOENT" });
  } finally {
    await f.dispose();
  }
});

function startupLockFromAnotherProcess(venueDir: string) {
  const result = spawnSync(
    process.execPath,
    [
      "--input-type=module",
      "-e",
      `import { DatabaseSync } from "node:sqlite";
const db = new DatabaseSync(process.argv[1]);
try {
  db.exec("pragma busy_timeout = 0");
  try { db.exec("begin immediate"); process.stdout.write("AVAILABLE"); }
  catch (error) {
    if (error.errcode !== 5) throw error;
    process.stdout.write("HELD");
  }
} finally { db.close(); }`,
      join(venueDir, "venue.lock"),
    ],
    { encoding: "utf8", timeout: 10_000 },
  );
  expect(result.status, result.stderr).toBe(0);
  return result.stdout;
}

it.each([
  { selected: false, failure: false },
  { selected: false, failure: true },
])(
  "startup holds and releases its real locks: selected=$selected failure=$failure",
  async ({ failure }) => {
    const f = await firstFiscalFixture();
    try {
      await suite.db.archiveTo(join(f.venueDir, "venue.db"));
      const paths = [f.venueDir];
      const originals = await readFile(join(f.stateDir, "first-setup.json"));
      const admission = await resolveFirstSetupEntry(f, {});
      expect(admission.kind).toBe("normal");
      if (admission.kind !== "normal") throw new Error("expected startup admission");
      const sentinel = new Error("synthetic startup failure");
      const start = admission.run(async () => {
        for (const path of paths) expect(startupLockFromAnotherProcess(path)).toBe("HELD");
        if (failure) throw sentinel;
        return "startup completed";
      });
      if (failure) await expect(start).rejects.toBe(sentinel);
      else await expect(start).resolves.toBe("startup completed");
      for (const path of paths) expect(startupLockFromAnotherProcess(path)).toBe("AVAILABLE");
      expect(await readFile(join(f.stateDir, "first-setup.json"))).toEqual(originals);
    } finally {
      await f.dispose();
    }
  },
);

it.each(["activation-started", "abandoned", "uncertain"] as const)(
  "startup rechecks a newly %s attempt before entering its callback",
  async (kind) => {
    const f = await firstFiscalFixture();
    try {
      await suite.db.archiveTo(join(f.venueDir, "venue.db"));
      const admission = await resolveFirstSetupEntry(f, {});
      expect(admission.kind).toBe("normal");
      if (admission.kind !== "normal") throw new Error("expected startup admission");
      const state = (await f.store.read())!;
      await f.store.update(state.frozen.attemptId, state.revision, { kind });
      const retained = await readFile(join(f.stateDir, "first-setup.json"));
      let entered = false;
      await expect(
        admission.run(async () => {
          entered = true;
        }),
      ).rejects.toMatchObject({ code: "setup.attempt_uncertain" });
      expect(entered).toBe(false);
      expect(await readFile(join(f.stateDir, "first-setup.json"))).toEqual(retained);
      expect(startupLockFromAnotherProcess(f.venueDir)).toBe("AVAILABLE");
    } finally {
      await f.dispose();
    }
  },
);

let material: SelfSignedMaterial;
beforeAll(() => {
  material = mintSelfSignedServerCert({
    hostnames: ["waitron.local", "localhost"],
    ipAddresses: ["127.0.0.1"],
    now: new Date(),
  });
});

type Box = "archive" | "interrupted" | "unfinishable";

/** A box with healthy TLS, so a real recovery listener serves the page rather than connection repair. */
async function startingBox(box: Box) {
  const root = await mkdtemp(join(tmpdir(), "refused-start-"));
  dirs.push(root);
  const stateDir = join(root, "state"),
    venueDir = join(root, "venue");
  await mkdir(join(stateDir, "tls"), { recursive: true });
  await mkdir(venueDir);
  for (const [name, value] of Object.entries({
    "ca.crt": material.caCertPem,
    "ca.key": material.caKeyPem,
    "server.crt": material.serverCertPem,
    "server.key": material.serverKeyPem,
  }))
    await writeFile(join(stateDir, "tls", name), value);
  const roots = { stateDir, venueDir };
  if (box === "archive") {
    await writeFile(join(venueDir, "first-setup-retirement.json"), '{"version":1}');
    return { root, ...roots };
  }
  await writeFile(join(stateDir, "first-setup.json"), '{"synthetic":"attempt"}');
  await writeFile(join(venueDir, "first-setup-claim.json"), '{"synthetic":"claim"}');
  await writeStartAgainMarker(
    roots,
    await startAgainMarkerFor(roots, {
      attemptId: "33333333-3333-4333-8333-333333333333",
      frozenDigest: "a".repeat(64),
    }),
  );
  if (box === "unfinishable")
    await writeFile(join(stateDir, "first-setup.json"), '{"changed":"after the marker"}');
  return { root, ...roots };
}

const MODES = ["supervised", "direct"] as const;
type Mode = (typeof MODES)[number];

/** Starts the box in `mode` on a real listener; `restart` is what Try again reaches in either mode. */
async function startIn(mode: Mode, roots: { stateDir: string; venueDir: string }) {
  const [port] = (await freePorts(1)) as [number];
  const listenerEnv = {
    WAITRON_HTTP_HOST: "127.0.0.1",
    WAITRON_HTTP_PORT: String(port),
    WAITRON_HTTP_LANDING_PORT: "0",
  };
  const restart = vi.fn();
  const writes = vi.fn(async () => {});
  const startServer = vi.fn(stopped);
  if (mode === "supervised") {
    await entry.runEntry({
      ...roots,
      args: [],
      statfs: plentyOfSpace,
      baseEnv: listenerEnv,
      readRecoveryState: async () => FRESH,
      writeRecoveryState: writes,
      withRecoveryLock: async (_path, body) => body(),
      loadBoxEnv: async (base) => base,
      runStagedRestore: async () => false,
      runStagedReset: async () => false,
      clearReplacedDatabases: async () => {},
      assertNotAhead: async () => {},
      startServer,
      serveRecovery: async (app, options) => {
        const server = await serveRecovery(app, options);
        closes.push(() => closeListener(server));
      },
      scheduleStayedUp: () => {},
      installShutdownHandlers: () => {},
      log: () => {},
      exit: restart,
    });
  } else {
    const server = await entry.startServerOrFirstSetupResolution(
      { WAITRON_STATE_DIR: roots.stateDir, WAITRON_VENUE_DIR: roots.venueDir, ...listenerEnv },
      {},
      { startServer, requestRestart: restart },
    );
    closes.push(() => server.close());
  }
  return { port, restart, writes, startServer };
}

function overHttps(
  port: number,
  path: string,
  language = "en-GB",
  method = "GET",
): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = httpsRequest(
      {
        hostname: "127.0.0.1",
        servername: "waitron.local",
        port,
        path,
        method,
        ca: material.caCertPem,
        headers: { "Accept-Language": language },
        timeout: 5000,
      },
      (res) => {
        let body = "";
        res.on("data", (chunk: Buffer) => {
          body += chunk.toString();
        });
        res.on("end", () => resolve({ status: res.statusCode!, body }));
      },
    );
    req.on("error", reject);
    req.on("timeout", () => req.destroy(new Error("HTTPS test deadline")));
    req.end();
  });
}

const STATUS_EN = "Level: recovery. This start was refused before it began, and was not counted.";
// The Spanish status line has no exported table to read it from; the titles and actions do.
const STATUS_ES = "Nivel: recovery. Este arranque se rechazó antes de empezar y no se ha contado.";
const REFUSED_TEXT = {
  "setup.workspace_unsupported": {
    title: "This box holds a first setup kept by an older Waitron.",
    action: "Ask whoever installed this box to reinstall Waitron on it.",
  },
  "setup.start_again_incomplete": {
    title: "Start again did not finish, and the box found files it did not expect.",
    action:
      "Ask whoever installed this box to look at its setup folders before anything else: the files it found may be a restored venue.",
  },
} as const;

/** The page names `code` in both languages, with the refused-start status line and no disk line. */
async function expectRefusedPage(port: number, code: keyof typeof REFUSED_TEXT) {
  const en = await overHttps(port, "/", "en-GB");
  expect(en.status).toBe(200);
  for (const text of [REFUSED_TEXT[code].title, REFUSED_TEXT[code].action, STATUS_EN])
    expect(en.body).toContain(escapeHtml(text));
  expect(en.body).not.toMatch(/disk/i);
  const es = await overHttps(port, "/", "es-ES");
  expect(es.status).toBe(200);
  const spanish = OPERATOR_TEXT[code]!["es-ES"];
  for (const text of [spanish.title, spanish.action, STATUS_ES])
    expect(es.body).toContain(escapeHtml(text));
  expect(es.body).not.toMatch(/disco/i);
  const status = await overHttps(port, "/recovery-api/status");
  expect(JSON.parse(status.body)).toMatchObject({
    failures: 0,
    level: "recovery",
    lastErrorCode: code,
  });
}

const gone = (path: string) => expect(stat(path)).rejects.toMatchObject({ code: "ENOENT" });

it.each(MODES)(
  "a box holding a pre-A1042 archive serves the recovery page naming it, in every entry mode (%s)",
  async (mode) => {
    const f = await startingBox("archive");
    const started = await startIn(mode, f);
    await expectRefusedPage(started.port, "setup.workspace_unsupported");
    expect(started.startServer).not.toHaveBeenCalled();
    expect(started.writes).not.toHaveBeenCalled();
    await gone(join(f.stateDir, "recovery.json"));
  },
);

it.each(MODES)(
  "the start finishes an interrupted Start again before serving setup (%s)",
  async (mode) => {
    const f = await startingBox("interrupted");
    const started = await startIn(mode, f);
    expect(started.startServer).toHaveBeenCalledOnce();
    await gone(join(f.stateDir, "first-setup.json"));
    await gone(join(f.venueDir, "first-setup-claim.json"));
    await gone(join(f.venueDir, START_AGAIN_MARKER_FILE));
  },
);

it.each(MODES)(
  "an unfinishable deletion serves the recovery page naming it, and Try again exits (%s)",
  async (mode) => {
    const f = await startingBox("unfinishable");
    const started = await startIn(mode, f);
    await expectRefusedPage(started.port, "setup.start_again_incomplete");
    expect(started.startServer).not.toHaveBeenCalled();
    expect(await readFile(join(f.stateDir, "first-setup.json"), "utf8")).toBe(
      '{"changed":"after the marker"}',
    );
    expect(await readFile(join(f.venueDir, "first-setup-claim.json"), "utf8")).toBe(
      '{"synthetic":"claim"}',
    );
    expect(await stat(join(f.venueDir, START_AGAIN_MARKER_FILE))).toBeTruthy();
    expect(started.restart).not.toHaveBeenCalled();
    const retry = await overHttps(started.port, "/recovery-api/retry", "en-GB", "POST");
    expect(retry).toEqual({ status: 200, body: JSON.stringify({ ok: true }) });
    await vi.waitFor(() => expect(started.restart).toHaveBeenCalledOnce());
    if (mode === "supervised") expect(started.restart).toHaveBeenCalledWith(0);
    expect(started.writes).not.toHaveBeenCalled();
    await gone(join(f.stateDir, "recovery.json"));
  },
);

it("a refused start after an earlier failed start shows the new code under 'Why the last start failed'", async () => {
  const f = await startingBox("archive");
  await mkdir(join(f.stateDir, "logs"));
  await writeFile(
    join(f.stateDir, "logs", LOG_FILE_NAME),
    [
      { at: "2026-10-20T10:00:00.000Z", level: "info", event: "server.boot_started" },
      {
        errorCode: "migrations.incomplete",
        detail: "the detail of an older start",
        at: "2026-10-20T10:00:01.000Z",
        level: "error",
        event: "server.boot_failed",
      },
    ]
      .map((line) => `${JSON.stringify(line)}\n`)
      .join(""),
  );
  const started = await startIn("supervised", f);
  const page = (await overHttps(started.port, "/", "en-GB")).body;
  const heading = page.indexOf("Why the last start failed (");
  expect(heading).toBeGreaterThan(-1);
  const section = page.slice(heading, page.indexOf("</pre>", heading));
  expect(section).toContain("setup.workspace_unsupported");
  expect(section).not.toContain("the detail of an older start");
  expect(section).not.toContain("2026-10-20T10:00:01.000Z");
});

it.each(MODES)(
  "folders reached through a symbolic link still finish an interrupted Start again (%s)",
  async (mode) => {
    const f = await startingBox("interrupted");
    const link = `${f.root}-link`;
    await symlink(f.root, link);
    dirs.push(link);
    const started = await startIn(mode, {
      stateDir: join(link, "state"),
      venueDir: join(link, "venue"),
    });
    expect(started.startServer).toHaveBeenCalledOnce();
    await gone(join(f.stateDir, "first-setup.json"));
    await gone(join(f.venueDir, "first-setup-claim.json"));
    await gone(join(f.venueDir, START_AGAIN_MARKER_FILE));
  },
);
