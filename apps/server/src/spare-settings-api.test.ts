import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Hono } from "hono";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  CORE_MIGRATIONS,
  readNodeMembership,
  stampDeployment,
  writeNodeMembership,
} from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { seedNode, seedVenue } from "@waitron/db/testing/seed.js";
import { loadKeyRing, type KeyRing } from "@waitron/credentials";
import { signEnvelope, type HandoverKind } from "@waitron/handover";
import {
  endorseKey,
  generateNodeKeyPair,
  signDocumentBody,
  type CanonicalValue,
  type MembershipDocumentBody,
} from "@waitron/membership";
import { NODE_MIGRATIONS, setNodeMode } from "@waitron/node-db";
import { replaceBackupSettings } from "./backup-env-writer.js";
import { createTurns, type Turns } from "./backup-turns.js";
import { readOfferSettings } from "./handover-manifest.js";
import { createLogger, type Logger } from "./logger.js";
import { establishNodeIdentity, readNodeIdentityKey } from "./node-identity.js";
import { mountSpareSettingsApi } from "./spare-settings-api.js";
import { pinMainBoxKey } from "./testing/pinned-main-box.js";

const RING: KeyRing = loadKeyRing({
  WAITRON_CREDENTIALS_KEY: Buffer.alloc(32, 0x9).toString("base64"),
  WAITRON_CREDENTIALS_KEY_VERSION: "1",
});

const MAIN = { nodeId: "11111111-1111-4111-8111-111111111111", ...generateNodeKeyPair() };
const STANDBY = { nodeId: "22222222-2222-4222-8222-222222222222", ...generateNodeKeyPair() };
const STRANGER = { nodeId: "33333333-3333-4333-8333-333333333333", ...generateNodeKeyPair() };

const RECOVERY_KEY = "spare-settings-recovery-key-5d1c8e0b7a";
const SETTINGS = {
  WAITRON_BACKUP_RECOVERY_KEY: RECOVERY_KEY,
  WAITRON_BACKUP_BUCKET: "venue-copies",
};
const SPARES_OWN = "WAITRON_BACKUP_BUCKET=spares-own\n";

const suite = useVenueDb({
  migrations: [CORE_MIGRATIONS, NODE_MIGRATIONS],
});

let self: string;
let stateDir: string;
let mainDir: string;
let lines: string[];

beforeEach(async () => {
  stateDir = await mkdtemp(join(tmpdir(), "spare-settings-"));
  mainDir = await mkdtemp(join(tmpdir(), "spare-settings-main-"));
  lines = [];
  await seedVenue(suite.db);
  self = await seedNode(suite.db);
  await stampDeployment(suite.db, "preproduction");
  await establishNodeIdentity({ ownerDb: suite.db, node: suite.node, ring: RING }, self);
  await setNodeMode({ venue: suite.db, node: suite.node }, self, "mirror");
  await pinMainBoxKey(suite.node, self, MAIN);
  const selfKey = await readNodeIdentityKey(suite.node, RING, self);
  const body: MembershipDocumentBody = {
    term: 2,
    nodes: [
      { nodeId: MAIN.nodeId, contactUrl: "https://box-0", standing: "serving-primary" },
      { nodeId: self, contactUrl: "https://box-1", standing: "serving-secondary" },
      { nodeId: STANDBY.nodeId, contactUrl: "https://box-2", standing: "serving-secondary" },
    ],
  };
  await writeNodeMembership(suite.db, {
    body,
    signerNodeId: self,
    signature: signDocumentBody(body, selfKey),
    endorsements: [endorseKey(STANDBY.nodeId, STANDBY.publicKey, self, selfKey)],
  });
});

afterEach(async () => {
  await rm(stateDir, { recursive: true, force: true });
  await rm(mainDir, { recursive: true, force: true });
});

function appFor(turns: Turns = createTurns()): Hono {
  const app = new Hono();
  const log: Logger = createLogger(
    (line) => lines.push(line),
    () => new Date(),
    () => "debug",
  );
  mountSpareSettingsApi(
    app,
    { db: suite.db, node: suite.node, ring: RING, nodeId: self, stateDir, turns },
    log,
  );
  return app;
}

function envelopeOf(
  body: Record<string, unknown> = { toNodeId: self, settings: SETTINGS },
  signer: { nodeId: string; privateKey: string } = MAIN,
  kind: HandoverKind = "backup-settings",
) {
  return signEnvelope(kind, body as CanonicalValue, signer);
}

async function send(raw: unknown, app = appFor()): Promise<{ status: number; body: unknown }> {
  const response = await app.request("/api/node/backup-settings", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: typeof raw === "string" ? raw : JSON.stringify(raw),
  });
  return { status: response.status, body: await response.json() };
}

function refusal(status: number, code: string, params: object = {}) {
  return { status, body: { error: { code, params } } };
}

async function backupEnv(): Promise<string | null> {
  return readFile(join(stateDir, "backup.env"), "utf8").catch(() => null);
}

async function holdOwnSettings(): Promise<void> {
  await writeFile(join(stateDir, "backup.env"), SPARES_OWN, { mode: 0o600 });
}

describe("POST /api/node/backup-settings", () => {
  it("a mirror writes the settings its main box signed, and answers their digest", async () => {
    await holdOwnSettings();
    await replaceBackupSettings(mainDir, SETTINGS);
    const mains = await readOfferSettings(mainDir, RING, "handover.settings_unreadable");
    expect(mains.backupSettings).not.toBeNull();
    expect(await send(envelopeOf())).toEqual({
      status: 200,
      body: { backupSettings: mains.backupSettings },
    });
    expect(await backupEnv()).toBe(await readFile(join(mainDir, "backup.env"), "utf8"));
  });

  it("null settings remove the spare's file", async () => {
    await holdOwnSettings();
    expect(await send(envelopeOf({ toNodeId: self, settings: null }))).toEqual({
      status: 200,
      body: { backupSettings: null },
    });
    expect(await backupEnv()).toBeNull();
  });

  it("refuses settings another key signed, writing nothing", async () => {
    await holdOwnSettings();
    expect(await send(envelopeOf(undefined, STRANGER))).toEqual(
      refusal(403, "spare.settings_sender_unknown"),
    );
    const forged = { ...envelopeOf(undefined, STRANGER), signerNodeId: MAIN.nodeId };
    expect(await send(forged)).toEqual(refusal(403, "spare.settings_sender_unknown"));
    expect(await backupEnv()).toBe(SPARES_OWN);
  });

  it("refuses settings a listed standby signed, writing nothing", async () => {
    await holdOwnSettings();
    expect(await send(envelopeOf(undefined, STANDBY))).toEqual(
      refusal(403, "spare.settings_sender_unknown"),
    );
    expect(await backupEnv()).toBe(SPARES_OWN);
  });

  it("refuses on a box that is not a mirror, writing nothing", async () => {
    await holdOwnSettings();
    await setNodeMode({ venue: suite.db, node: suite.node }, self, "primary");
    expect(await send(envelopeOf())).toEqual(refusal(409, "spare.settings_not_a_spare"));
    expect(await backupEnv()).toBe(SPARES_OWN);
  });

  it("refuses an envelope naming another box", async () => {
    await holdOwnSettings();
    expect(await send(envelopeOf({ toNodeId: STANDBY.nodeId, settings: SETTINGS }))).toEqual(
      refusal(400, "spare.settings_invalid", { reason: "body" }),
    );
    expect(await backupEnv()).toBe(SPARES_OWN);
  });

  it("refuses a body with another shape", async () => {
    for (const body of [
      { settings: SETTINGS },
      { toNodeId: self },
      { toNodeId: self, settings: SETTINGS, extra: 1 },
    ]) {
      expect(await send(envelopeOf(body))).toEqual(
        refusal(400, "spare.settings_invalid", { reason: "body" }),
      );
    }
    expect(await backupEnv()).toBeNull();
  });

  it("refuses a malformed envelope or one of another kind", async () => {
    for (const raw of ["not json", {}, envelopeOf(undefined, MAIN, "status")]) {
      expect(await send(raw)).toEqual(
        refusal(400, "spare.settings_invalid", { reason: "envelope" }),
      );
    }
    expect(await backupEnv()).toBeNull();
  });

  it("refuses a name outside WAITRON_BACKUP_, writing nothing", async () => {
    await holdOwnSettings();
    expect(
      await send(envelopeOf({ toNodeId: self, settings: { ...SETTINGS, OTHER_SETTING: "x" } })),
    ).toEqual(refusal(400, "spare.settings_invalid", { reason: "name" }));
    expect(await backupEnv()).toBe(SPARES_OWN);
  });

  it("refuses a sender the chart stopped naming while its body was on the way, writing nothing", async () => {
    await holdOwnSettings();
    let bodyAsked!: () => void;
    let sendBody!: () => void;
    const asked = new Promise<void>((resolve) => (bodyAsked = resolve));
    const released = new Promise<void>((resolve) => (sendBody = resolve));
    const bytes = new TextEncoder().encode(JSON.stringify(envelopeOf()));
    const body = new ReadableStream<Uint8Array>(
      {
        async pull(controller) {
          bodyAsked();
          await released;
          controller.enqueue(bytes);
          controller.close();
        },
      },
      { highWaterMark: 0 },
    );
    // With its length named, as a box's request has, the body is read by the route itself.
    const answer = appFor().request("/api/node/backup-settings", {
      method: "POST",
      headers: { "content-type": "application/json", "content-length": String(bytes.length) },
      body,
      duplex: "half",
    } as RequestInit);
    await asked;
    const held = (await readNodeMembership(suite.db))!;
    const selfKey = await readNodeIdentityKey(suite.node, RING, self);
    const changed: MembershipDocumentBody = {
      term: held.body.term + 1,
      nodes: held.body.nodes.map((n) => ({
        ...n,
        standing: n.nodeId === STANDBY.nodeId ? "serving-primary" : "serving-secondary",
      })),
    };
    await writeNodeMembership(suite.db, {
      ...held,
      body: changed,
      signerNodeId: self,
      signature: signDocumentBody(changed, selfKey),
    });
    sendBody();
    const response = await answer;
    expect({ status: response.status, body: await response.json() }).toEqual(
      refusal(403, "spare.settings_sender_unknown"),
    );
    expect(await backupEnv()).toBe(SPARES_OWN);
  });

  it("answers every one of several requests sent at once, and leaves the file whole", async () => {
    await holdOwnSettings();
    await replaceBackupSettings(mainDir, SETTINGS);
    const app = appFor();
    const envelope = envelopeOf();
    const answers = await Promise.all(Array.from({ length: 12 }, () => send(envelope, app)));
    expect(answers.map((a) => a.status)).toEqual(Array(12).fill(200));
    expect(await backupEnv()).toBe(await readFile(join(mainDir, "backup.env"), "utf8"));
  });

  it("writes only in its turn in the queue it is given", async () => {
    await holdOwnSettings();
    const shared = createTurns();
    let release!: () => void;
    const held = shared(() => new Promise<void>((resolve) => (release = resolve)));
    const asked = vi.fn();
    const turns: Turns = (body) => {
      asked();
      return shared(body);
    };
    const answer = send(envelopeOf(), appFor(turns));
    await vi.waitFor(() => expect(asked).toHaveBeenCalledOnce(), { timeout: 5_000 });
    expect(await backupEnv()).toBe(SPARES_OWN);

    release();
    await held;
    expect((await answer).status).toBe(200);
    expect(await backupEnv()).not.toBe(SPARES_OWN);
  });

  it("refuses a body larger than any settings message, writing nothing", async () => {
    await holdOwnSettings();
    const large = envelopeOf({
      toNodeId: self,
      settings: { ...SETTINGS, WAITRON_BACKUP_PADDING: "x".repeat(70_000) },
    });
    expect(await send(large)).toEqual(refusal(413, "spare.settings_invalid", { reason: "size" }));
    const text = JSON.stringify(large);
    const named = await appFor().request("/api/node/backup-settings", {
      method: "POST",
      headers: { "content-type": "application/json", "content-length": String(text.length) },
      body: text,
    });
    expect({ status: named.status, body: await named.json() }).toEqual(
      refusal(413, "spare.settings_invalid", { reason: "size" }),
    );
    expect(await backupEnv()).toBe(SPARES_OWN);
  });

  it("no log line carries the recovery key", async () => {
    const app = appFor();
    await send(envelopeOf(undefined, STRANGER), app);
    await send(envelopeOf({ toNodeId: self, settings: { ...SETTINGS, OTHER: "x" } }), app);
    await send(
      envelopeOf({ toNodeId: self, settings: { ...SETTINGS, WAITRON_BACKUP_X: "\n" } }),
      app,
    );
    expect((await send(envelopeOf(), app)).status).toBe(200);
    expect(lines.length).toBeGreaterThan(0);
    for (const line of lines) expect(line).not.toContain(RECOVERY_KEY);
  });
});
