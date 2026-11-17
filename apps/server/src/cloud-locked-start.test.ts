import { spawn, spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { purposeKey, sealText } from "@waitron/credentials";
import { ensureBuiltInRoles, hashPassword } from "@waitron/identity";
import { generateSync } from "otplib";
import { CORE_MIGRATIONS, withTransaction, persons, personRoles, recoveryCodes } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { FISCAL_MIGRATIONS } from "@waitron/fiscal-verifactu";
import { NODE_MIGRATIONS } from "@waitron/node-db";
import type { BackupQuery, BackupRow } from "@waitron/store";
import { createLockedCloudControl, openLockedCopy, startLockedCopy } from "./cloud-locked-start.js";
import { lockedCloudFixture } from "./testing/cloud-locked-fixture.js";
import {
  retainHttpListener,
  retainedHttpPreload,
  transferRetainedListeners,
} from "./testing/retained-http-listener.js";
import { adoptRetainedListeners } from "./testing/retained-http-adoption.mjs";
import { bindingFor, copyId, seedEmergencyCopySource } from "./testing/emergency-copy-source.js";
import { sha } from "./testing/place-copy-box.js";

const suite = useVenueDb({ migrations: [CORE_MIGRATIONS, FISCAL_MIGRATIONS, NODE_MIGRATIONS] });
let root: string;
let venueDir: string;
let stateDir: string;
let opened: Awaited<ReturnType<typeof openLockedCopy>> | undefined;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "cloud-locked-start-"));
  venueDir = join(root, "venue");
  stateDir = join(root, "state");
  await mkdir(venueDir);
  await mkdir(stateDir);
  await seedEmergencyCopySource(suite.db);
});
afterEach(async () => {
  await opened?.close();
  opened = undefined;
  await rm(root, { recursive: true, force: true });
});

async function placement() {
  const path = join(venueDir, "venue.db");
  await suite.db.archiveTo(path);
  return {
    binding: bindingFor(sha(path)),
    venueDir,
    stateDir,
    environment: "preproduction" as const,
    processEnv: {},
    migrationsRoot: null,
    modules: [],
    now: () => new Date("2026-11-17T10:10:00.000Z"),
  };
}

async function rows(query: BackupQuery, sql: string) {
  const result: BackupRow[] = [];
  for await (const row of query.rows(sql)) result.push(row);
  return result;
}

function outsideLock() {
  const result = spawnSync(
    process.execPath,
    [
      "--input-type=module",
      "-e",
      `
    import { DatabaseSync } from "node:sqlite";
    const db = new DatabaseSync(process.argv[1]);
    try { db.exec("pragma busy_timeout=0; begin immediate"); console.log("acquired"); }
    catch (error) { if (error.errcode !== 5) throw error; console.log("held"); }
    finally { db.close(); }
  `,
      join(venueDir, "venue.lock"),
    ],
    { encoding: "utf8", timeout: 10000 },
  );
  expect(result.error).toBeUndefined();
  expect(result.status, result.stderr).toBe(0);
  return result.stdout.trim();
}

async function snapshot() {
  const files: Record<string, string> = {};
  for (const [prefix, dir] of [
    ["venue", venueDir],
    ["state", stateDir],
  ]) {
    for (const name of (await readdir(dir!)).sort()) {
      if (
        name === "scratch" ||
        name === "venue.lock" ||
        name === "venue.lock-journal" ||
        name === "venue.holder.json"
      )
        continue;
      files[`${prefix}/${name}`] = sha(join(dir!, name));
    }
  }
  return files;
}

it("keeps the placed copy immutable and its folder held until both readers close", async () => {
  const deps = await placement();
  opened = await openLockedCopy(deps);
  const before = await snapshot();
  expect(outsideLock()).toBe("held");
  expect(await rows(opened.venue, "select id from nodes")).toEqual([
    { id: deps.binding.sourceNodeId },
  ]);
  expect(await rows(opened.node, "select node_id, mode from box")).toEqual([
    { node_id: copyId, mode: "mirror" },
  ]);
  await opened.close();
  expect(outsideLock()).toBe("acquired");
  expect(await snapshot()).toEqual(before);
  expect(sha(join(venueDir, "venue.db"))).toBe(deps.binding.selectedStream.databaseSha256);
  await expect(rows(opened.venue, "select 1")).rejects.toThrow();
  await expect(rows(opened.node, "select 1")).rejects.toThrow();
  opened = await openLockedCopy(deps);
  expect(outsideLock()).toBe("held");
  await opened.close();
  expect(await snapshot()).toEqual(before);
});

it("releases its folder hold when placement refuses an expired copy", async () => {
  const deps = await placement();
  await expect(
    openLockedCopy({ ...deps, now: () => new Date(deps.binding.expiresAt) }),
  ).rejects.toMatchObject({ code: "emergency_copy.binding_expired" });
  expect(outsideLock()).toBe("acquired");
});

it("uses only renewal and accepts a deadline-capped lease through the last ten minutes", async () => {
  const binding = bindingFor("a".repeat(64));
  const f = await lockedCloudFixture(binding);
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-17T10:10:00.000Z"));
  try {
    const control = createLockedCloudControl(f.state, binding);
    expect(await control.check()).toBe(Date.parse("2026-11-17T10:30:00.000Z"));
    expect(f.requests.map((v) => [v[2], v[3], v[7]])).toEqual([
      ["renew", binding.installationId, "{}"],
    ]);
    expect(f.proofs).toEqual([true]);
    vi.setSystemTime(new Date("2026-11-17T10:29:59.999Z"));
    expect(await control.check()).toBe(Date.parse("2026-11-17T10:30:00.000Z"));
    expect(f.requests).toHaveLength(1);
    vi.setSystemTime(new Date(binding.expiresAt));
    await expect(control.check()).rejects.toMatchObject({ code: "emergency_copy.binding_expired" });
    expect(f.requests).toHaveLength(1);
  } finally {
    vi.useRealTimers();
    await f.close();
  }
});

it("renews an earlier lease and refuses an overlong renewal or a failed control check", async () => {
  const binding = bindingFor("a".repeat(64));
  const f = await lockedCloudFixture(binding);
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-17T10:10:00.000Z"));
  try {
    f.expireAt(Date.parse("2026-11-17T10:25:00.000Z"));
    const control = createLockedCloudControl(f.state, binding);
    expect(await control.check()).toBe(Date.parse("2026-11-17T10:25:00.000Z"));
    vi.setSystemTime(new Date("2026-11-17T10:15:00.000Z"));
    f.expireAt(Date.parse("2026-11-17T10:30:00.001Z"));
    await expect(control.check()).rejects.toMatchObject({ code: "cloud.unavailable" });
    delete f.state.lifecycle;
    f.refuse(503);
    await expect(createLockedCloudControl(f.state, binding).check()).rejects.toMatchObject({
      code: "cloud.unavailable",
    });
    delete f.state.lifecycle;
    f.refuse(403);
    await expect(createLockedCloudControl(f.state, binding).check()).rejects.toMatchObject({
      code: "cloud.not_configured",
    });
    expect(f.requests.map((v) => v[2])).toEqual(["renew", "renew", "renew", "renew"]);
  } finally {
    vi.useRealTimers();
    await f.close();
  }
});

it.each(["installation", "venue", "environment", "http", "pending"] as const)(
  "refuses credentials before exchange: %s",
  async (kind) => {
    const binding = bindingFor("a".repeat(64));
    const f = await lockedCloudFixture(binding);
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-17T10:10:00.000Z"));
    try {
      const registration = f.state.view!.registration!;
      const patch = {
        installation: {
          view: { registration: { ...registration, installationId: "another-copy" } },
        },
        venue: { view: { registration: { ...registration, venueId: "another-venue" } } },
        environment: { environment: "production" as const },
        http: { origin: f.state.origin.replace("https:", "http:") },
        pending: {
          lifecycle: {
            unavailable: false,
            revoked: false,
            pending: {
              action: "configuration" as const,
              operationId: "e7000000-0000-4000-8000-00000000000a",
              lease: "",
              body: "{}",
            },
          },
        },
      }[kind];
      await expect(
        createLockedCloudControl({ ...f.state, ...patch }, binding).check(),
      ).rejects.toMatchObject({ code: "cloud.unavailable" });
      expect(f.fetches()).toBe(0);
      expect(f.requests).toEqual([]);
    } finally {
      vi.useRealTimers();
      await f.close();
    }
  },
);

it("serves only locked probes over TLS and stops on control failure or the original deadline after restart", async () => {
  const deps = await placement();
  const f = await lockedCloudFixture(deps.binding);
  const certFile = join(root, "copy.crt"),
    keyFile = join(root, "copy.key");
  await writeFile(certFile, f.material.serverCertPem);
  await writeFile(keyFile, f.material.serverKeyPem);
  f.expireAt(Date.parse("2026-11-17T10:25:00.000Z"));
  vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] });
  vi.setSystemTime(deps.now());
  let running: Awaited<ReturnType<typeof startLockedCopy>> | undefined;
  let adoption: ReturnType<typeof adoptRetainedListeners> | undefined;
  const holders: Awaited<ReturnType<typeof retainHttpListener>>[] = [];
  async function launch() {
    const held = await retainHttpListener();
    holders.push(held);
    adoption = adoptRetainedListeners([held]);
    const origin = `https://127.0.0.1:${held.port}`;
    try {
      running = await startLockedCopy({
        ...deps,
        cloud: f.state,
        tls: { certFile, keyFile },
        origin,
        hostname: held.host,
        port: held.port,
        log: () => {},
        totpPurposeKeys: [],
      });
      await adoption.bound;
    } finally {
      adoption.restore();
    }
    return origin;
  }
  try {
    let origin = await launch();
    const before = await snapshot();
    expect(outsideLock()).toBe("held");
    expect(await (await fetch(origin + "/health")).json()).toEqual({
      ok: true,
      tradingAvailable: false,
    });
    expect(await (await fetch(origin + "/api/node")).json()).toEqual({
      nodeId: copyId,
      term: 1,
      standing: null,
      acceptingSales: false,
      environment: "preproduction",
    });
    for (const path of ["/", "/api/start", "/api/me", "/api/till", "/setup"]) {
      const response = await fetch(origin + path);
      await response.text();
      expect(response.status, path).toBe(404);
    }
    let stopped = false;
    void running!.closed.then(() => {
      stopped = true;
    });
    f.refuse(503);
    await vi.advanceTimersByTimeAsync(300000);
    await vi.waitFor(() => expect(stopped).toBe(true), { timeout: 3000 });
    expect(f.requests.map((v) => v[2])).toEqual(["renew", "renew"]);
    await holders[0]!.close();
    expect(outsideLock()).toBe("acquired");
    expect(await snapshot()).toEqual(before);
    delete f.state.lifecycle;
    f.refuse(200);
    f.expireAt(Date.parse(deps.binding.expiresAt));
    vi.setSystemTime(new Date("2026-11-17T10:29:59.999Z"));
    origin = await launch();
    await vi.advanceTimersByTimeAsync(1);
    await running!.closed;
    expect(outsideLock()).toBe("acquired");
    await expect(fetch(origin + "/health")).rejects.toThrow();
    expect(await snapshot()).toEqual(before);
  } finally {
    vi.useRealTimers();
    adoption?.restore();
    await running?.close();
    for (const held of holders) if (held.server.listening) await held.close();
    await f.close();
  }
});

it("closes at the copy deadline while a control renewal is still waiting for Cloud", async () => {
  const deps = await placement();
  const f = await lockedCloudFixture(deps.binding);
  const certFile = join(root, "copy.crt"),
    keyFile = join(root, "copy.key");
  await writeFile(certFile, f.material.serverCertPem);
  await writeFile(keyFile, f.material.serverKeyPem);
  const held = await retainHttpListener();
  const adoption = adoptRetainedListeners([held]);
  let running: Awaited<ReturnType<typeof startLockedCopy>> | undefined;
  let release!: () => void, reached!: () => void;
  const waiting = new Promise<void>((resolve) => {
    release = resolve;
  });
  const entered = new Promise<void>((resolve) => {
    reached = resolve;
  });
  vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] });
  vi.setSystemTime(new Date("2026-11-17T10:29:50.000Z"));
  f.expireAt(Date.parse("2026-11-17T10:29:59.000Z"));
  try {
    running = await startLockedCopy({
      ...deps,
      cloud: f.state,
      tls: { certFile, keyFile },
      origin: `https://127.0.0.1:${held.port}`,
      hostname: held.host,
      port: held.port,
      log: () => {},
      totpPurposeKeys: [],
    });
    await adoption.bound;
    f.delay(async () => {
      reached();
      await waiting;
    });
    let stopped = false;
    void running.closed.then(() => {
      stopped = true;
    });
    await vi.advanceTimersByTimeAsync(9000);
    await entered;
    expect(outsideLock()).toBe("held");
    await vi.advanceTimersByTimeAsync(1000);
    await vi.waitFor(() => expect(stopped).toBe(true), { timeout: 3000 });
    expect(outsideLock()).toBe("acquired");
    expect(f.requests.map((v) => v[2])).toEqual(["renew", "renew"]);
  } finally {
    release();
    adoption.restore();
    await running?.close();
    vi.useRealTimers();
    if (held.server.listening) await held.close();
    await f.close();
  }
});

it("authenticates through TLS using source-only purpose keys and keeps sessions and recovery use in memory", async () => {
  const secret = "JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP";
  const sourceRing = { current: { version: 7, key: Buffer.alloc(32, 7) } };
  const personId = crypto.randomUUID();
  await withTransaction(suite.db, async (tx) => {
    const roleIds = await ensureBuiltInRoles(tx);
    await tx.insert(persons).values({
      id: personId,
      displayName: "Copy administrator",
      displayNameFolded: "copy administrator",
      email: "copy@example.test",
      emailFolded: "copy@example.test",
      passwordHash: hashPassword("correct horse"),
      totpSecret: sealText(sourceRing, "totp", secret),
    });
    await tx.insert(personRoles).values({ personId, roleId: roleIds.admin });
    await tx.insert(recoveryCodes).values({
      personId,
      codeHash: (await import("node:crypto"))
        .createHash("sha256")
        .update("ABCD0123ABCD0123")
        .digest("hex"),
    });
  });
  const deps = await placement();
  const f = await lockedCloudFixture(deps.binding);
  const certFile = join(root, "copy.crt"),
    keyFile = join(root, "copy.key");
  await writeFile(certFile, f.material.serverCertPem);
  await writeFile(keyFile, f.material.serverKeyPem);
  const held = await retainHttpListener();
  const adoption = adoptRetainedListeners([held]);
  const origin = `https://127.0.0.1:${held.port}`;
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(deps.now());
  let running: Awaited<ReturnType<typeof startLockedCopy>> | undefined;
  try {
    running = await startLockedCopy({
      ...deps,
      cloud: f.state,
      tls: { certFile, keyFile },
      origin,
      hostname: held.host,
      port: held.port,
      log: () => {},
      totpPurposeKeys: [{ version: 7, key: purposeKey(sourceRing.current, "totp") }],
    } as Parameters<typeof startLockedCopy>[0]);
    await adoption.bound;
    const before = await snapshot();
    async function request(method: string, body?: unknown, cookie?: string, page = origin) {
      const response = await fetch(origin + "/locked-api/session", {
        method,
        headers: {
          origin: page,
          "content-type": "application/json",
          ...(cookie ? { cookie } : {}),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      return {
        status: response.status,
        body: response.headers.get("content-type")?.includes("application/json")
          ? await response.json()
          : await response.text(),
        cookie: response.headers.get("set-cookie"),
      };
    }
    expect((await request("GET")).body).toMatchObject({
      error: { code: "management_session.required" },
    });
    const input = {
      email: " COPY@example.test ",
      password: "correct horse",
      totp: generateSync({ secret }),
    };
    expect((await request("POST", input, undefined, "https://foreign.example")).body).toMatchObject(
      { error: { code: "node.operation_page_required" } },
    );
    expect((await request("POST", { ...input, password: "wrong" })).body).toMatchObject({
      error: { code: "password.invalid" },
    });
    const signed = await request("POST", input);
    expect(signed.status).toBe(200);
    expect(signed.cookie).toContain("Secure");
    expect(signed.cookie).toContain("HttpOnly");
    expect(signed.cookie).toContain("SameSite=Strict");
    const cookie = signed.cookie!.split(";")[0]!;
    expect(signed.body).toEqual({
      personId,
      copyOperationId: deps.binding.copyOperationId,
      signedInAt: deps.now().toISOString(),
      expiresAt: "2026-11-17T10:20:00.000Z",
      copyExpiresAt: deps.binding.expiresAt,
    });
    expect((await request("GET", undefined, cookie)).body).toEqual(signed.body);
    vi.setSystemTime(new Date("2026-11-17T10:20:00.000Z"));
    expect((await request("GET", undefined, cookie)).body).toMatchObject({
      error: { code: "management_session.expired" },
    });
    const recovery = { ...input, totp: undefined, recoveryCode: "abcd-0123-abcd-0123" };
    const recovered = await request("POST", recovery);
    expect(recovered.status).toBe(200);
    expect((await request("POST", recovery)).body).toMatchObject({
      error: { code: "password.invalid" },
    });
    const recoveredCookie = recovered.cookie!.split(";")[0]!;
    expect((await request("DELETE", undefined, recoveredCookie)).status).toBe(200);
    expect((await request("GET", undefined, recoveredCookie)).body).toMatchObject({
      error: { code: "management_session.expired" },
    });
    for (let n = 0; n < 4; n++) await request("POST", { ...input, email: "unknown@example.test" });
    expect((await request("POST", { ...input, email: "unknown@example.test" })).body).toMatchObject(
      { error: { code: "password.throttled" } },
    );
    await running.close();
    expect(await snapshot()).toEqual(before);
  } finally {
    adoption.restore();
    await running?.close();
    vi.useRealTimers();
    if (held.server.listening) await held.close();
    await f.close();
  }
});

it.each(["signal", "expiry"])(
  "the separate locked process exits on %s and releases its folder",
  async (stop) => {
    const deps = await placement();
    const f = await lockedCloudFixture(deps.binding);
    const certFile = join(root, "copy.crt"),
      keyFile = join(root, "copy.key"),
      caFile = join(root, "ca.crt");
    await writeFile(certFile, f.material.serverCertPem);
    await writeFile(keyFile, f.material.serverKeyPem);
    await writeFile(caFile, f.material.caPem);
    const held = await retainHttpListener();
    const origin = `https://127.0.0.1:${held.port}`;
    const instant = stop === "expiry" ? "2026-11-17T10:29:57.000Z" : "2026-11-17T10:10:00.000Z";
    const launch = {
      ...deps,
      cloud: f.state,
      tls: { certFile, keyFile },
      origin,
      hostname: held.host,
      port: held.port,
    };
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(deps.now());
    await createLockedCloudControl(f.state, deps.binding).check();
    const child = spawn(
      process.execPath,
      [
        "--import",
        "tsx",
        "--input-type=module",
        "-e",
        `
    await import(${JSON.stringify(retainedHttpPreload)});
    const RealDate = Date, instant = ${JSON.stringify(instant)};
    globalThis.Date = class extends RealDate { constructor(...args) { super(...(args.length ? args : [instant])); } static now() { return new RealDate(instant).getTime(); } };
    Object.defineProperty(performance, 'now', {value: () => 0});
    await import('./src/cloud-locked-entry.ts');
  `,
      ],
      {
        env: {
          ...process.env,
          NODE_EXTRA_CA_CERTS: caFile,
          WAITRON_LOCKED_COPY: JSON.stringify(launch),
          WAITRON_LOCKED_TOTP_KEYS: JSON.stringify({
            current: { version: 7, key: Buffer.alloc(32, 7).toString("base64") },
            previous: null,
          }),
        },
        stdio: ["ignore", "pipe", "pipe", "ipc"],
      },
    );
    let output = "",
      errors = "";
    child.stdout!.on("data", (chunk) => {
      output += String(chunk);
    });
    child.stderr!.on("data", (chunk) => {
      errors += String(chunk);
    });
    const exit = new Promise<number | null>((resolve, reject) => {
      child.once("error", reject);
      child.once("exit", resolve);
    });
    try {
      await transferRetainedListeners(child, [held], 30000);
      await expect
        .poll(() => output.includes("cloud-locked.ready") || child.exitCode !== null, {
          timeout: 30000,
        })
        .toBe(true);
      expect(output, errors).toContain("cloud-locked.ready");
      const before = await snapshot();
      if (stop === "signal") {
        expect(outsideLock()).toBe("held");
        child.kill("SIGTERM");
      }
      expect(await exit, errors).toBe(0);
      expect(outsideLock()).toBe("acquired");
      expect(await snapshot()).toEqual(before);
      expect(output).not.toContain("WAITRON_LOCKED_TOTP_KEYS");
    } finally {
      if (child.exitCode === null && child.signalCode === null) {
        child.kill("SIGKILL");
        await exit;
      }
      if (held.server.listening) await held.close();
      vi.useRealTimers();
      await f.close();
    }
  },
  75000,
);
