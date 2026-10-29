import { Socket } from "node:net";
import { TLSSocket } from "node:tls";
import { sql } from "drizzle-orm";
import { Hono } from "hono";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadKeyRing, putCredential } from "@waitron/credentials";
import {
  insertRecoveryPack,
  locations,
  readBreakGlassKeyName,
  readBreakGlassVerifier,
  readRecoveryPacks,
  setNodePublicKey,
  stampDeployment,
  withTransaction,
} from "@waitron/db";
import { seedNode, seedTenant } from "@waitron/db/testing/seed.js";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { verifySecretAsync } from "@waitron/identity";
import { openManagementSession } from "@waitron/identity/test/fixtures.js";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import type { ProvisionedNode, WaitronModule } from "@waitron/module";
import { fakeModule } from "@waitron/module/src/testing/fake-module.js";
import { readRecoveryPackPdf, type RecoveryPackPage } from "@waitron/recovery-pack";
import { AppError, locationId } from "@waitron/shared";
import { parseRecoveryKit } from "@waitron/stream";
import { decodeArchiveRecoveryPack } from "./archive-recovery-pack.js";
import { writeArchiveSettings, type ArchiveSettings } from "./archive-settings.js";
import { mountBackupRecoveryPackMakeApi } from "./backup-recovery-pack-api.js";
import { createTurns, type Turns } from "./backup-turns.js";
import { mintBreakGlassKey } from "./break-glass.js";
import { invoiceFontBytes } from "./invoice-font.js";
import { STREAM_PURPOSE, streamSettingsPayload } from "./stream-host.js";
import { TOTP_KEY_RING } from "./testing/authenticator.js";

const RING = loadKeyRing({
  WAITRON_CREDENTIALS_KEY: Buffer.alloc(32, 9).toString("base64"),
  WAITRON_CREDENTIALS_KEY_VERSION: "1",
});
const KEY = "recovery-key-recognisable-SECRET";
const VENUE = "c0000000-0000-4000-8000-000000000002";
const BUCKET = {
  region: "eu-west-1",
  bucket: "venue-bucket",
  prefix: "shop/",
  accessKeyId: "AKIASTREAMRECOGNISABLE",
  secretAccessKey: "stream-secret-recognisable-0123456789",
};
const ARCHIVES: Omit<ArchiveSettings, "revision"> = {
  enabled: true,
  destinations: [
    { kind: "s3", id: "bucket", bucket: { ...BUCKET, prefix: "archives/" }, venueId: VENUE },
  ],
  schedule: { kind: "wall-clock", days: "daily", at: { hour: 3, minute: 30 } },
  retention: { count: 7, days: 30 },
  destinationTimeoutMs: 15 * 60 * 1000,
};
const PAGE: RecoveryPackPage = { title: "Server key", rows: [], notes: [] };

const suite = useVenueDb({ migrations: migrationOptionsFor(manifestSets(), null) });
let node: ProvisionedNode;
let keyInForce: { secret: string; name: string };
let admin: { personId: string; token: string };
const sockets: TLSSocket[] = [];
const logs: unknown[][] = [];

afterEach(() => {
  for (const socket of sockets.splice(0)) socket.destroy();
});

beforeEach(async () => {
  logs.length = 0;
  await seedTenant(suite.db);
  await stampDeployment(suite.db, "preproduction");
  const [location] = await suite.db
    .insert(locations)
    .values({ name: "Sala", invoiceLocales: ["es"], operationDescription: "Restaurant" })
    .returning({ id: locations.id });
  const nodeId = await seedNode(suite.db, locationId(location!.id));
  node = { nodeId, locationId: locationId(location!.id) };
  await setNodePublicKey(suite.db, nodeId, "SIGNER_PUBLIC_KEY");
  keyInForce = await mintBreakGlassKey(suite.db, nodeId);
  await withTransaction(suite.db, async (tx) => {
    await putCredential(tx, RING, {
      purpose: STREAM_PURPOSE,
      value: streamSettingsPayload({ venueId: VENUE, bucket: BUCKET }),
    });
    await writeArchiveSettings(tx, RING, ARCHIVES);
  });
  admin = await openManagementSession(suite.db, "admin");
});

type Seat = NonNullable<NonNullable<WaitronModule["backup"]>["recoveryPackPage"]>;

/** The key file a real seat hands back carries the new key; this one carries it the same way. */
const drawingSeat: Seat = async (_tx, _node, context) =>
  context.newKey === undefined
    ? { page: PAGE }
    : { page: PAGE, keyFile: { kind: "test-key-file", nodeKey: context.newKey } };

function fixture(options: { seat?: Seat | null; turns?: Turns; now?: () => Date } = {}) {
  const app = new Hono();
  const seat = options.seat === undefined ? drawingSeat : options.seat;
  const modules: WaitronModule[] =
    seat === null ? [] : [{ ...fakeModule("test-regime"), backup: { recoveryPackPage: seat } }];
  mountBackupRecoveryPackMakeApi(
    app,
    {
      db: suite.db,
      rpId: "box.test",
      origin: "https://box.test",
      keyRing: TOTP_KEY_RING,
      ring: RING,
      node,
      venueId: VENUE,
      modules,
      turns: options.turns ?? createTurns(),
      readBoxEnv: async () => ({
        WAITRON_BACKUP_RECOVERY_KEY: KEY,
        WAITRON_BACKUP_KEY_ROTATED_AT: "2026-09-20T08:00:00.000Z",
      }),
      managedByEnvironment: () => false,
      documentEvidence: async () => ({}),
      loadFont: async () => invoiceFontBytes,
      now: options.now ?? (() => new Date("2026-10-30T09:00:00.000Z")),
    },
    (...values) => logs.push(values),
  );
  function post(
    path: string,
    body: unknown,
    {
      token = admin.token,
      headers = {},
      tls = true,
      raw,
    }: {
      token?: string | null;
      headers?: Record<string, string>;
      tls?: boolean;
      raw?: string;
    } = {},
  ) {
    const socket = tls ? new TLSSocket(new Socket()) : undefined;
    if (socket) sockets.push(socket);
    return app.request(
      `https://box.test${path}`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token === null ? {} : { cookie: `waitron_management_session=${token}` }),
          ...headers,
        },
        body: raw ?? JSON.stringify(body),
      },
      socket ? { incoming: { socket } } : undefined,
    );
  }
  const signIn = { method: "password", password: "correct horse" };
  return {
    post,
    make: (
      newServerKey = false,
      extra: Parameters<typeof post>[2] = {},
      body: unknown = { locale: "en", newServerKey, signIn },
    ) => post("/api/backup/recovery-pack", body, extra),
    received: (number: number, extra: Parameters<typeof post>[2] = {}) =>
      post(`/api/backup/recovery-pack/${number}/received`, {}, extra),
  };
}

async function pdfText(bytes: ArrayBuffer): Promise<string> {
  const loading = getDocument({ data: new Uint8Array(bytes.slice(0)), useSystemFonts: false });
  const pdf = await loading.promise;
  try {
    const words: string[] = [];
    for (let n = 1; n <= pdf.numPages; n++) {
      const content = await (await pdf.getPage(n)).getTextContent();
      for (const item of content.items) if ("str" in item) words.push(item.str);
    }
    return words.join(" ").replace(/\s+/g, " ");
  } finally {
    await loading.destroy();
  }
}

const codeOf = async (response: Response) =>
  ((await response.json()) as { error: { code: string; params?: unknown } }).error;
const packs = () => readRecoveryPacks(suite.db, node.nodeId);

describe("the make route's refusals", () => {
  it.each([
    ["a plain connection", { tls: false }, 403, "recovery.pack_connection_insecure"],
    [
      "another site's Origin",
      { headers: { Origin: "https://evil.test" } },
      403,
      "recovery.pack_origin_refused",
    ],
    [
      "a cross-site fetch",
      { headers: { "Sec-Fetch-Site": "cross-site" } },
      403,
      "recovery.pack_origin_refused",
    ],
    [
      "a body that is not JSON",
      { headers: { "Content-Type": "text/plain" } },
      400,
      "recovery.pack_invalid",
    ],
    ["no session", { token: null }, 401, "management_session.required"],
  ] as const)("refuses %s before reading anything", async (_name, extra, status, code) => {
    const response = await fixture().make(true, extra);
    expect(response.status).toBe(status);
    expect((await codeOf(response)).code).toBe(code);
    expect(await packs()).toEqual([]);
  });

  it("refuses a person without system.manage", async () => {
    const supervisor = await openManagementSession(suite.db, "supervisor");
    const response = await fixture().make(true, { token: supervisor.token });
    expect(response.status).toBe(403);
    expect((await codeOf(response)).code).toBe("authorization.not_permitted");
    expect(await packs()).toEqual([]);
  });

  it.each([
    ["an extra field", { locale: "en", newServerKey: false, signIn: {}, more: 1 }],
    ["an unknown language", { locale: "fr", newServerKey: false, signIn: {} }],
    ["a tick that is not a boolean", { locale: "en", newServerKey: "yes", signIn: {} }],
    ["no sign-in", { locale: "en", newServerKey: false }],
  ])("refuses %s as the request's shape", async (_name, body) => {
    const response = await fixture().make(false, {}, body);
    expect(response.status).toBe(400);
    expect(await codeOf(response)).toEqual({
      code: "recovery.pack_invalid",
      params: { reason: "shape" },
    });
  });

  it("refuses a wrong password, writing no record and keeping the key", async () => {
    const response = await fixture().make(
      true,
      {},
      {
        locale: "en",
        newServerKey: true,
        signIn: { method: "password", password: "wrong horse" },
      },
    );
    expect(response.status).toBe(401);
    expect((await codeOf(response)).code).toBe("password.invalid");
    expect(await packs()).toEqual([]);
    expect(await readBreakGlassKeyName(suite.db, node.nodeId)).toBe(keyInForce.name);
  });
});

describe("a made pack", () => {
  it("answers the PDF with its number, codes the readers accept, and a record with no secret", async () => {
    const f = fixture();
    const response = await f.make();
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/pdf");
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("content-disposition")).toBe(
      'attachment; filename="waitron-recovery-pack-1.pdf"',
    );
    expect(response.headers.get("x-waitron-recovery-pack")).toBe("1");
    expect(response.headers.get("x-waitron-recovery-pack-key")).toBe("unchanged");
    const file = await readRecoveryPackPdf(new Uint8Array(await response.arrayBuffer()));
    expect(file.number).toBe(1);
    expect(file.madeAt).toBe("2026-10-30T09:00:00.000Z");
    expect(parseRecoveryKit(file.bucketCode!).recoveryKey).toBe(KEY);
    expect(decodeArchiveRecoveryPack(file.archiveCode!).recoveryKey).toBe(KEY);
    expect(file.serverKey).toBeNull();
    expect(file.serverKeyName).toBe(keyInForce.name);
    // The key in force was made outside any pack, so it is on a sheet, not a pack.
    expect(file.serverKeyHeldBy).toBeNull();
    const [record] = await packs();
    expect(record).toMatchObject({
      number: 1,
      madeBy: admin.personId,
      receivedAt: null,
      madeAt: new Date("2026-10-30T09:00:00.000Z"),
    });
    expect(record!.parts.map((p) => [p.part, p.state])).toEqual([
      ["bucket", "included"],
      ["archives", "included"],
      ["server-key", "included"],
    ]);
    expect(record!.parts[2]).toMatchObject({ keyName: keyInForce.name, carriedKey: false });
    const stored = JSON.stringify(record);
    for (const secret of [KEY, BUCKET.secretAccessKey, keyInForce.secret])
      expect(stored).not.toContain(secret);
    expect((await f.make()).headers.get("x-waitron-recovery-pack")).toBe("2");
  });

  it("with the box ticked, replaces the key and carries the new one", async () => {
    const response = await fixture().make(true);
    expect(response.headers.get("x-waitron-recovery-pack-key")).toBe("replaced");
    const file = await readRecoveryPackPdf(new Uint8Array(await response.arrayBuffer()));
    const carried = (file.serverKey as { nodeKey: { name: string; secret: string } }).nodeKey;
    expect(carried.name).toBe(file.serverKeyName);
    expect(carried.name).toMatch(/^2026-10-30 · [0-9a-f-]{36}$/);
    expect(await readBreakGlassKeyName(suite.db, node.nodeId)).toBe(carried.name);
    const verifier = (await readBreakGlassVerifier(suite.db, node.nodeId))!;
    expect(await verifySecretAsync(carried.secret, verifier)).toBe(true);
    expect(await verifySecretAsync(keyInForce.secret, verifier)).toBe(false);
    const [record] = await packs();
    expect(record!.parts[2]).toMatchObject({ keyName: carried.name, carriedKey: true });
    expect(JSON.stringify(record)).not.toContain(carried.secret);
  });

  it("names the received pack holding the key, and an unreceived one as never reaching a browser", async () => {
    const f = fixture();
    await (await f.make(true)).arrayBuffer();
    const unreceived = await readRecoveryPackPdf(
      new Uint8Array(await (await f.make()).arrayBuffer()),
    );
    expect(unreceived.serverKeyHeldBy).toEqual({
      number: 1,
      madeOn: "2026-10-30",
      received: false,
    });
    expect((await f.received(1)).status).toBe(204);
    const held = await readRecoveryPackPdf(new Uint8Array(await (await f.make()).arrayBuffer()));
    expect(held.serverKeyHeldBy).toEqual({ number: 1, madeOn: "2026-10-30", received: true });
    const carrying = await readRecoveryPackPdf(
      new Uint8Array(await (await f.make(true)).arrayBuffer()),
    );
    expect(carrying.serverKeyHeldBy).toBeNull();
  });

  it.each([true, false])(
    "a seat that refuses (ticked %s) still makes the pack, keeping the key",
    async (ticked) => {
      const refusing: Seat = async () => {
        throw new AppError("sif.allocation_invalid", { reason: "history_invalid" });
      };
      const verifier = await readBreakGlassVerifier(suite.db, node.nodeId);
      const response = await fixture({ seat: refusing }).make(ticked);
      expect(response.status).toBe(200);
      expect(response.headers.get("x-waitron-recovery-pack-key")).toBe("failed");
      const bytes = await response.arrayBuffer();
      const text = await pdfText(bytes);
      expect(text.includes("The server key was not replaced.")).toBe(ticked);
      expect(text).toContain("still works");
      expect(await readBreakGlassVerifier(suite.db, node.nodeId)).toBe(verifier);
      expect(await readBreakGlassKeyName(suite.db, node.nodeId)).toBe(keyInForce.name);
      const [record] = await packs();
      expect(record!.parts[2]).toEqual({
        part: "server-key",
        state: "failed",
        keyName: keyInForce.name,
        carriedKey: false,
      });
      expect((await readRecoveryPackPdf(new Uint8Array(bytes))).serverKey).toBeNull();
    },
  );

  it("with no key in force and the box ticked, fails the page and writes no key", async () => {
    await suite.db.execute(
      sql`update node_roles set break_glass_verifier = null, break_glass_key_name = null`,
    );
    const response = await fixture().make(true);
    expect(response.status).toBe(200);
    expect(response.headers.get("x-waitron-recovery-pack-key")).toBe("failed");
    expect(await readBreakGlassVerifier(suite.db, node.nodeId)).toBeNull();
    const [record] = await packs();
    expect(record!.parts[2]).toEqual({ part: "server-key", state: "failed", carriedKey: false });
  });

  it("on a venue that files no invoices, has no server-key part and says the key is unchanged", async () => {
    await withTransaction(suite.db, (tx) =>
      insertRecoveryPack(tx, {
        nodeId: node.nodeId,
        number: 1,
        madeAt: new Date("2026-10-29T09:00:00.000Z"),
        madeBy: admin.personId,
        parts: [
          { part: "server-key", state: "included", keyName: keyInForce.name, carriedKey: true },
        ],
      }),
    );
    const response = await fixture({ seat: null }).make(true);
    const file = await readRecoveryPackPdf(new Uint8Array(await response.clone().arrayBuffer()));
    expect(file.serverKeyHeldBy).toBeNull();
    expect(response.headers.get("x-waitron-recovery-pack-key")).toBe("unchanged");
    expect(await readBreakGlassKeyName(suite.db, node.nodeId)).toBe(keyInForce.name);
    const [record] = await packs();
    expect(record!.number).toBe(2);
    expect(record!.parts[2]).toEqual({ part: "server-key", state: "absent" });
  });

  it("waits for a backup turn already running before it reads anything", async () => {
    const turns = createTurns();
    let release!: () => void;
    const held = turns(() => new Promise<void>((resolve) => (release = resolve)));
    const making = fixture({ turns }).make();
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(await packs()).toEqual([]);
    release();
    await held;
    expect((await making).status).toBe(200);
    expect(await packs()).toHaveLength(1);
  });

  it("logs the made pack's parts and person, and no code, key or secret in the log or headers", async () => {
    const response = await fixture().make(true);
    const file = await readRecoveryPackPdf(new Uint8Array(await response.arrayBuffer()));
    const secret = (file.serverKey as { nodeKey: { secret: string } }).nodeKey.secret;
    expect(logs).toContainEqual([
      "info",
      "recovery.pack_made",
      {
        personId: admin.personId,
        number: 1,
        parts: [
          { part: "bucket", state: "included" },
          { part: "archives", state: "included" },
          { part: "server-key", state: "included" },
        ],
      },
    ]);
    const seen = JSON.stringify([logs, [...response.headers]]);
    for (const value of [KEY, BUCKET.secretAccessKey, secret, file.bucketCode!, file.archiveCode!])
      expect(seen).not.toContain(value);
  });
});

describe("the received route", () => {
  async function made() {
    const f = fixture();
    await (await f.make(true)).arrayBuffer();
    return f;
  }
  const receivedAt = async () => (await packs())[0]!.receivedAt;

  it("marks the maker's own pack received", async () => {
    const f = await made();
    const response = await f.received(1);
    expect(response.status).toBe(204);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await receivedAt()).toEqual(new Date("2026-10-30T09:00:00.000Z"));
  });

  it.each([
    ["a plain connection", { tls: false }, 403, "recovery.pack_connection_insecure"],
    [
      "another site",
      { headers: { Origin: "https://evil.test" } },
      403,
      "recovery.pack_origin_refused",
    ],
    ["no session", { token: null }, 401, "management_session.required"],
  ] as const)("refuses %s, leaving it unreceived", async (_name, extra, status, code) => {
    const f = await made();
    const response = await f.received(1, extra);
    expect(response.status).toBe(status);
    expect((await codeOf(response)).code).toBe(code);
    expect(await receivedAt()).toBeNull();
  });

  it("refuses a person without system.manage", async () => {
    const f = await made();
    const supervisor = await openManagementSession(suite.db, "supervisor");
    const response = await f.received(1, { token: supervisor.token });
    expect(response.status).toBe(403);
    expect((await codeOf(response)).code).toBe("authorization.not_permitted");
    expect(await receivedAt()).toBeNull();
  });

  it("answers another person's pack and an unknown number alike", async () => {
    const f = await made();
    const other = await openManagementSession(suite.db, "admin");
    const elsewhere = { nodeId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd", number: 5 };
    await withTransaction(suite.db, (tx) =>
      insertRecoveryPack(tx, {
        ...elsewhere,
        madeAt: new Date("2026-10-29T09:00:00.000Z"),
        madeBy: admin.personId,
        parts: [],
      }),
    );
    for (const [number, token] of [
      [1, other.token],
      [2, admin.token],
      [elsewhere.number, admin.token],
    ] as const) {
      const response = await f.received(number, { token });
      expect(response.status).toBe(400);
      expect(await codeOf(response)).toEqual({
        code: "recovery.pack_invalid",
        params: { reason: "unknown_pack" },
      });
    }
    expect(await receivedAt()).toBeNull();
    const [theirs] = await readRecoveryPacks(suite.db, elsewhere.nodeId);
    expect(theirs!.receivedAt).toBeNull();
  });

  it("refuses a body that is not empty", async () => {
    const f = await made();
    const response = await f.post("/api/backup/recovery-pack/1/received", { at: "now" });
    expect(response.status).toBe(400);
    expect(await codeOf(response)).toEqual({
      code: "recovery.pack_invalid",
      params: { reason: "shape" },
    });
    expect(await receivedAt()).toBeNull();
  });
});
