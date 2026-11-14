import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Hono } from "hono";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  deletePairLinkTx,
  loadKeyRing,
  sealNodeSigningKeyTx,
  writePairLinkTx,
  type KeyRing,
} from "@waitron/credentials";
import {
  CORE_MIGRATIONS,
  stampDeployment,
  withNodeTransaction,
  writeNodeMembership,
} from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { seedNode, seedVenue } from "@waitron/db/testing/seed.js";
import {
  generateNodeKeyPair,
  signDocumentBody,
  type MembershipDocumentBody,
} from "@waitron/membership";
import { NODE_MIGRATIONS, setNodeMode } from "@waitron/node-db";
import {
  backupSettingsDigestOf,
  readBackupSettings,
  replaceBackupSettings,
  writeRecoveryKey,
} from "./backup-env-writer.js";
import { createLogger, type Logger } from "./logger.js";
import { establishNodeIdentity, readNodeIdentityKey } from "./node-identity.js";
import { runSpareSettings, sendBackupSettings } from "./spare-settings.js";
import { mountSpareSettingsApi } from "./spare-settings-api.js";
import { pinMainBoxKey } from "./testing/pinned-main-box.js";

const RING: KeyRing = loadKeyRing({
  WAITRON_CREDENTIALS_KEY: Buffer.alloc(32, 0x5).toString("base64"),
  WAITRON_CREDENTIALS_KEY_VERSION: "1",
});
const MAIN = { nodeId: "11111111-1111-4111-8111-111111111111", ...generateNodeKeyPair() };
const SPARE_URL = "https://spare.test";
const RECOVERY_KEY = "spare-settings-sender-recovery-key-7f3a9c";
const NEW_RECOVERY_KEY = "spare-settings-sender-rotated-key-2b6e14";
const SETTINGS = {
  WAITRON_BACKUP_RECOVERY_KEY: RECOVERY_KEY,
  WAITRON_BACKUP_BUCKET: "venue-copies",
};
const SPARES_OWN = "WAITRON_BACKUP_BUCKET=spares-own\n";
const CHECK_MS = 5_000;
const RETRY_MS = 30_000;

const mainBox = useVenueDb({ migrations: [CORE_MIGRATIONS, NODE_MIGRATIONS], timeoutMs: 60_000 });
const spareBox = useVenueDb({ migrations: [CORE_MIGRATIONS, NODE_MIGRATIONS], timeoutMs: 60_000 });

let spareId: string;
let mainDir: string;
let spareDir: string;
let lines: string[];
let requests: string[];
let spareAnswers: "yes" | "not-started" | "off";
let spareApp: Hono;
const running: { stop(): Promise<void> }[] = [];

function logger(): Logger {
  return createLogger(
    (line) => lines.push(line),
    () => new Date(),
    () => "debug",
  );
}

const exchangeFetch = (async (url: string | URL | Request, init?: RequestInit) => {
  requests.push(String(url));
  if (spareAnswers === "off") throw new TypeError("fetch failed");
  if (spareAnswers === "not-started") return new Response("404 Not Found", { status: 404 });
  return spareApp.request(String(url), init);
}) as typeof fetch;

function chartBody(spareContactUrl: string | null): MembershipDocumentBody {
  return {
    term: 2,
    nodes: [
      { nodeId: MAIN.nodeId, contactUrl: "https://main.test", standing: "serving-primary" },
      ...(spareContactUrl === null
        ? []
        : [
            {
              nodeId: spareId,
              contactUrl: spareContactUrl,
              standing: "serving-secondary" as const,
            },
          ]),
    ],
  };
}

async function holdMainChart(spareContactUrl: string | null): Promise<void> {
  const body = chartBody(spareContactUrl);
  await writeNodeMembership(mainBox.db, {
    body,
    signerNodeId: MAIN.nodeId,
    signature: signDocumentBody(body, MAIN.privateKey),
    endorsements: [],
  });
}

async function link(state: "pending" | "streaming"): Promise<void> {
  await withNodeTransaction(mainBox.node, (tx) =>
    writePairLinkTx(tx, RING, MAIN.nodeId, {
      role: "streams",
      state,
      peerNodeId: spareId,
      peerPublicKey: "unused",
      storeUrl: "https://spare.test:7443",
      venueId: "venue-7",
      accessKeyId: "waitron0123456789abcdef",
      secretAccessKey: "ab".repeat(32),
    }),
  );
}

beforeEach(async () => {
  mainDir = await mkdtemp(join(tmpdir(), "spare-settings-main-"));
  spareDir = await mkdtemp(join(tmpdir(), "spare-settings-spare-"));
  lines = [];
  requests = [];
  spareAnswers = "yes";

  await seedVenue(spareBox.db);
  spareId = await seedNode(spareBox.db);
  await stampDeployment(spareBox.db, "preproduction");
  await establishNodeIdentity({ ownerDb: spareBox.db, node: spareBox.node, ring: RING }, spareId);
  await setNodeMode({ venue: spareBox.db, node: spareBox.node }, spareId, "mirror");
  await pinMainBoxKey(spareBox.node, spareId, MAIN);
  const spareKey = await readNodeIdentityKey(spareBox.node, RING, spareId);
  const body = chartBody(SPARE_URL);
  await writeNodeMembership(spareBox.db, {
    body,
    signerNodeId: spareId,
    signature: signDocumentBody(body, spareKey),
    endorsements: [],
  });
  await writeFile(join(spareDir, "backup.env"), SPARES_OWN, { mode: 0o600 });
  spareApp = new Hono();
  mountSpareSettingsApi(
    spareApp,
    { db: spareBox.db, node: spareBox.node, ring: RING, nodeId: spareId, stateDir: spareDir },
    logger(),
  );

  await withNodeTransaction(mainBox.node, (tx) =>
    sealNodeSigningKeyTx(tx, RING, MAIN.nodeId, MAIN.privateKey),
  );
  await holdMainChart(SPARE_URL);
  await replaceBackupSettings(mainDir, SETTINGS);
});

afterEach(async () => {
  for (const duty of running.splice(0)) await duty.stop();
  vi.useRealTimers();
  await rm(mainDir, { recursive: true, force: true });
  await rm(spareDir, { recursive: true, force: true });
});

/** Waits, in real time, until the duty is asleep on the fake clock again. */
async function idle(): Promise<void> {
  const deadline = performance.now() + 10_000;
  while (vi.getTimerCount() === 0) {
    if (performance.now() > deadline) throw new Error("the duty never went back to sleep");
    await new Promise((resolve) => setImmediate(resolve));
  }
}

async function tick(ms: number): Promise<void> {
  for (let left = ms; left > 0; left -= CHECK_MS) {
    await vi.advanceTimersByTimeAsync(Math.min(CHECK_MS, left));
    await idle();
  }
}

async function start(): Promise<{ stop(): Promise<void> }> {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
  const duty = runSpareSettings({
    db: mainBox.db,
    node: mainBox.node,
    ring: RING,
    nodeId: MAIN.nodeId,
    stateDir: mainDir,
    exchange: { timeoutMs: 5_000, fetch: exchangeFetch },
    checkMs: CHECK_MS,
    retryMs: RETRY_MS,
    log: logger(),
  });
  running.push(duty);
  await idle();
  return duty;
}

async function digestIn(stateDir: string): Promise<string | null> {
  return backupSettingsDigestOf(await readBackupSettings(stateDir));
}

function events(event: string): { level: string; peerNodeId?: string; reason?: string }[] {
  return lines
    .map((line) => JSON.parse(line) as { event: string; level: string })
    .filter((entry) => entry.event === event);
}

describe("runSpareSettings", () => {
  it("sends the settings once the pair link is streaming, and the spare then holds the same digest", async () => {
    await link("streaming");
    await start();
    expect(await digestIn(spareDir)).toBe(await digestIn(mainDir));
    expect(requests).toEqual([`${SPARE_URL}/api/node/backup-settings`]);
    expect(events("spare-settings.sent")).toEqual([
      expect.objectContaining({ level: "info", peerNodeId: spareId }),
    ]);
    await tick(CHECK_MS * 4);
    expect(requests).toHaveLength(1);
  });

  it("sends nothing while the link is pending", async () => {
    await link("pending");
    await start();
    await tick(CHECK_MS * 4);
    expect(requests).toEqual([]);
    expect(await readFile(join(spareDir, "backup.env"), "utf8")).toBe(SPARES_OWN);
  });

  it("fails quietly until the first delivery", async () => {
    await link("streaming");
    spareAnswers = "not-started";
    await start();
    await tick(RETRY_MS * 2);
    // One at the start, then one at each 30-second retry: never at the 5-second checks between.
    expect(requests).toHaveLength(3);
    expect(events("spare-settings.send_failed")).toEqual([
      expect.objectContaining({ level: "info", peerNodeId: spareId, reason: "404" }),
    ]);

    spareAnswers = "yes";
    await tick(RETRY_MS);
    expect(await digestIn(spareDir)).toBe(await digestIn(mainDir));
    expect(events("spare-settings.sent")).toHaveLength(1);

    spareAnswers = "not-started";
    await writeRecoveryKey(mainDir, { recoveryKey: NEW_RECOVERY_KEY, keyRotatedAt: undefined });
    await tick(RETRY_MS * 3);
    expect(events("spare-settings.send_failed")).toEqual([
      expect.objectContaining({ level: "info" }),
      expect.objectContaining({ level: "warn", peerNodeId: spareId, reason: "404" }),
    ]);
  });

  it("a change on this box reaches the spare within one check", async () => {
    await link("streaming");
    await start();
    await writeRecoveryKey(mainDir, { recoveryKey: NEW_RECOVERY_KEY, keyRotatedAt: undefined });
    const changed = await digestIn(mainDir);
    expect(await digestIn(spareDir)).not.toBe(changed);
    await tick(CHECK_MS);
    expect(await digestIn(spareDir)).toBe(changed);
  });

  it("a spare that was off catches up once it answers again, logging one failure for the whole time it was off", async () => {
    await link("streaming");
    await start();
    spareAnswers = "off";
    await writeRecoveryKey(mainDir, { recoveryKey: NEW_RECOVERY_KEY, keyRotatedAt: undefined });
    await tick(120_000);
    expect(events("spare-settings.send_failed")).toEqual([
      expect.objectContaining({ level: "warn", peerNodeId: spareId, reason: "unreachable" }),
    ]);

    spareAnswers = "yes";
    await tick(35_000);
    expect(await digestIn(spareDir)).toBe(await digestIn(mainDir));
    expect(events("spare-settings.send_failed")).toHaveLength(1);
  });

  it("sends nothing with no link, or with no address for the spare", async () => {
    const duty = await start();
    await tick(CHECK_MS * 2);
    await link("streaming");
    await holdMainChart(null);
    await tick(CHECK_MS * 2);
    await holdMainChart("");
    await tick(CHECK_MS * 2);
    expect(requests).toEqual([]);

    await holdMainChart(SPARE_URL);
    await tick(CHECK_MS);
    expect(requests).toHaveLength(1);
    await withNodeTransaction(mainBox.node, (tx) => deletePairLinkTx(tx, MAIN.nodeId));
    await writeRecoveryKey(mainDir, { recoveryKey: NEW_RECOVERY_KEY, keyRotatedAt: undefined });
    await tick(CHECK_MS * 2);
    expect(requests).toHaveLength(1);
    await duty.stop();
  });

  it("a file this box cannot read sends nothing, and the spare keeps its settings", async () => {
    await rm(join(mainDir, "backup.env"));
    await mkdir(join(mainDir, "backup.env"));
    await link("streaming");
    await start();
    await tick(RETRY_MS * 2);
    expect(requests).toEqual([]);
    expect(await readFile(join(spareDir, "backup.env"), "utf8")).toBe(SPARES_OWN);
    expect(events("spare-settings.send_failed")).toEqual([
      expect.objectContaining({ level: "info", reason: "unreadable" }),
    ]);
  });

  it("a file that exists but holds no settings sends nothing, and the spare keeps its settings", async () => {
    await writeFile(join(mainDir, "backup.env"), "\0\u0001garbage-without-equals\n");
    await link("streaming");
    await start();
    await tick(RETRY_MS * 2);
    expect(requests).toEqual([]);
    expect(await readFile(join(spareDir, "backup.env"), "utf8")).toBe(SPARES_OWN);
    expect(events("spare-settings.send_failed")).toEqual([
      expect.objectContaining({ level: "info", reason: "unreadable" }),
    ]);
  });

  it("no file on this box removes the spare's settings", async () => {
    await rm(join(mainDir, "backup.env"));
    await link("streaming");
    await start();
    expect(requests).toHaveLength(1);
    expect(await readBackupSettings(spareDir)).toBeNull();
  });

  it("a check that keeps failing is logged once per run of failures", async () => {
    await link("streaming");
    let broken = true;
    const node = new Proxy(mainBox.node, {
      get(target, property, receiver) {
        if (broken) throw new Error("node.db is unreadable");
        return Reflect.get(target, property, receiver) as unknown;
      },
    });
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    running.push(
      runSpareSettings({
        db: mainBox.db,
        node,
        ring: RING,
        nodeId: MAIN.nodeId,
        stateDir: mainDir,
        exchange: { timeoutMs: 5_000, fetch: exchangeFetch },
        checkMs: CHECK_MS,
        retryMs: RETRY_MS,
        log: logger(),
      }),
    );
    await idle();
    await tick(CHECK_MS * 6);
    expect(events("spare-settings.check_failed")).toHaveLength(1);

    broken = false;
    await tick(CHECK_MS);
    expect(requests).toHaveLength(1);
    broken = true;
    await tick(CHECK_MS * 6);
    expect(events("spare-settings.check_failed")).toHaveLength(2);
  });

  it("a new start sends once even when nothing changed", async () => {
    await link("streaming");
    const first = await start();
    expect(requests).toHaveLength(1);
    await first.stop();
    vi.useRealTimers();

    await start();
    await tick(CHECK_MS * 3);
    expect(requests).toHaveLength(2);
  });

  it("a box that is no longer the main box sends nothing", async () => {
    await link("streaming");
    const duty = await start();
    expect(requests).toHaveLength(1);
    await duty.stop();
    await writeRecoveryKey(mainDir, { recoveryKey: NEW_RECOVERY_KEY, keyRotatedAt: undefined });
    await vi.advanceTimersByTimeAsync(RETRY_MS * 4);
    expect(requests).toHaveLength(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("no log line carries the recovery key", async () => {
    await link("streaming");
    spareAnswers = "not-started";
    await start();
    spareAnswers = "yes";
    await tick(RETRY_MS);
    await writeRecoveryKey(mainDir, { recoveryKey: NEW_RECOVERY_KEY, keyRotatedAt: undefined });
    spareAnswers = "off";
    await tick(RETRY_MS);
    spareAnswers = "yes";
    await tick(RETRY_MS + CHECK_MS);
    expect(await digestIn(spareDir)).toBe(await digestIn(mainDir));
    expect(events("spare-settings.sent")).toHaveLength(2);
    expect(events("spare-settings.send_failed")).toHaveLength(2);
    for (const line of lines) {
      expect(line).not.toContain(RECOVERY_KEY);
      expect(line).not.toContain(NEW_RECOVERY_KEY);
    }
  });
});

describe("sendBackupSettings", () => {
  const deps = () => ({
    node: mainBox.node,
    ring: RING,
    nodeId: MAIN.nodeId,
    stateDir: mainDir,
  });

  it("is delivered with the digest the spare answers", async () => {
    const outcome = await sendBackupSettings(
      { ...deps(), exchange: { timeoutMs: 5_000, fetch: exchangeFetch } },
      { nodeId: spareId, contactUrl: SPARE_URL },
    );
    expect(outcome).toEqual({ delivered: true, digest: await digestIn(mainDir) });
  });

  it("names the spare's refusal by its code", async () => {
    const outcome = await sendBackupSettings(
      { ...deps(), exchange: { timeoutMs: 5_000, fetch: exchangeFetch } },
      { nodeId: "44444444-4444-4444-8444-444444444444", contactUrl: SPARE_URL },
    );
    expect(outcome).toEqual({ delivered: false, reason: "spare.settings_invalid" });
  });

  it("is not delivered when the answered digest differs", async () => {
    const fetchWrongDigest = (async () =>
      new Response(JSON.stringify({ backupSettings: "0".repeat(64) }), {
        status: 200,
      })) as unknown as typeof fetch;
    const outcome = await sendBackupSettings(
      { ...deps(), exchange: { timeoutMs: 5_000, fetch: fetchWrongDigest } },
      { nodeId: spareId, contactUrl: SPARE_URL },
    );
    expect(outcome).toEqual({ delivered: false, reason: "digest_differs" });
  });

  it("an http contact URL sends nothing", async () => {
    let received = 0;
    const server = createServer((_req, res) => {
      received++;
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ backupSettings: null }));
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    try {
      const { port } = server.address() as AddressInfo;
      const outcome = await sendBackupSettings(
        { ...deps(), exchange: { timeoutMs: 5_000, authorityOf: () => undefined } },
        { nodeId: spareId, contactUrl: `http://127.0.0.1:${port}` },
      );
      expect(outcome).toEqual({ delivered: false, reason: "not_https" });
      expect(received).toBe(0);
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  });
});
