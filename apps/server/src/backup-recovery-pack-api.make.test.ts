import { randomInt } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { Socket } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { TLSSocket } from "node:tls";
import { eq, sql } from "drizzle-orm";
import { Hono } from "hono";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { afterEach, beforeEach, describe, expect, it, onTestFinished, vi } from "vitest";
import { loadKeyRing, putCredential } from "@waitron/credentials";
import {
  insertRecoveryPack,
  locations,
  readRecoveryPacks,
  setNodePublicKey,
  stampDeployment,
  withTransaction,
} from "@waitron/db";
import { seedNode, seedTenant } from "@waitron/db/testing/seed.js";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { persons, verifySecretAsync } from "@waitron/identity";
import { openManagementSession } from "@waitron/identity/test/fixtures.js";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { readRecoveryKeyName, readRecoveryKeyVerifier } from "@waitron/node-db";
import type { ProvisionedNode, WaitronModule } from "@waitron/module";
import { fakeModule } from "@waitron/module/src/testing/fake-module.js";
import { PART_WORDS, readRecoveryPackPdf, type RecoveryPackPage } from "@waitron/recovery-pack";
import { AppError, locationId } from "@waitron/shared";
import { parseRecoveryKit } from "@waitron/stream";
import { decodeArchiveRecoveryPack } from "./archive-recovery-pack.js";
import { ARCHIVE_PURPOSE, writeArchiveSettings, type ArchiveSettings } from "./archive-settings.js";
import { mountBackupRecoveryPackMakeApi } from "./backup-recovery-pack-api.js";
import { createTurns, type Turns } from "./backup-turns.js";
import { mintBreakGlassKey } from "./break-glass.js";
import { invoiceFontBytes } from "./invoice-font.js";
import { readRecoveryDocumentEvidence } from "./recovery-document-evidence.js";
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

vi.mock("node:crypto", async (original) => {
  const actual = await original<typeof import("node:crypto")>();
  return { ...actual, randomInt: vi.fn(actual.randomInt) };
});

const drawCodeIndex = vi.mocked(randomInt as (max: number) => number);

const suite = useVenueDb({ migrations: migrationOptionsFor(manifestSets(), null) });
let node: ProvisionedNode;
let keyInForce: { secret: string; name: string };
let admin: { personId: string; token: string };
let boxEnv: Record<string, string>;
let loadedKey: string | undefined;
let managed: boolean;
const sockets: TLSSocket[] = [];
const logs: unknown[][] = [];

afterEach(() => {
  for (const socket of sockets.splice(0)) socket.destroy();
  drawCodeIndex.mockReset();
});

beforeEach(async () => {
  logs.length = 0;
  managed = false;
  boxEnv = {
    WAITRON_BACKUP_RECOVERY_KEY: KEY,
    WAITRON_BACKUP_KEY_ROTATED_AT: "2026-09-20T08:00:00.000Z",
  };
  loadedKey = KEY;
  await seedTenant(suite.db);
  await stampDeployment(suite.db, "preproduction");
  const [location] = await suite.db
    .insert(locations)
    .values({ name: "Sala", invoiceLocales: ["es"], operationDescription: "Restaurant" })
    .returning({ id: locations.id });
  const nodeId = await seedNode(suite.db, locationId(location!.id));
  node = { nodeId, locationId: locationId(location!.id) };
  await setNodePublicKey(suite.db, nodeId, "SIGNER_PUBLIC_KEY");
  keyInForce = await mintBreakGlassKey({ venue: suite.db, node: suite.node }, nodeId);
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

function fixture(
  options: {
    seat?: Seat | null;
    seats?: number;
    turns?: Turns;
    now?: () => Date;
    evidence?: (module: WaitronModule) => Promise<Readonly<Record<string, unknown>>>;
    loadFont?: () => Promise<Uint8Array>;
    readBoxEnv?: () => Promise<Record<string, string | undefined>>;
  } = {},
) {
  const app = new Hono();
  const seat = options.seat === undefined ? drawingSeat : options.seat;
  const modules: WaitronModule[] =
    seat === null
      ? []
      : Array.from({ length: options.seats ?? 1 }, (_, n) => ({
          ...fakeModule(`test-regime-${n}`),
          backup: { recoveryPackPage: seat },
        }));
  mountBackupRecoveryPackMakeApi(
    app,
    {
      db: suite.db,
      nodeDb: suite.node,
      rpId: "box.test",
      origin: "https://box.test",
      keyRing: TOTP_KEY_RING,
      ring: RING,
      node,
      venueId: VENUE,
      modules,
      turns: options.turns ?? createTurns(),
      readBoxEnv: options.readBoxEnv ?? (async () => ({ ...boxEnv })),
      backups: () => ({
        managedByEnvironment: managed,
        schedule: ARCHIVES.schedule,
        retention: ARCHIVES.retention,
        recoveryKey: loadedKey,
      }),
      documentEvidence: options.evidence ?? (async () => ({})),
      loadFont: options.loadFont ?? (async () => invoiceFontBytes),
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
      stream,
    }: {
      token?: string | null;
      headers?: Record<string, string>;
      tls?: boolean;
      raw?: string;
      stream?: ReadableStream<Uint8Array>;
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
        body: stream ?? raw ?? JSON.stringify(body),
        ...(stream === undefined ? {} : { duplex: "half" }),
      } as RequestInit,
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
    status: (token: string | null = admin.token) =>
      app.request("https://box.test/api/backup/recovery-pack", {
        headers: token === null ? {} : { cookie: `waitron_management_session=${token}` },
      }),
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
    expect(await readRecoveryKeyName(suite.node, node.nodeId)).toBe(keyInForce.name);
  });

  it.each([
    [
      "a forwarded claim of HTTPS",
      { tls: false, headers: { "X-Forwarded-Proto": "https" } },
      403,
      "recovery.pack_connection_insecure",
    ],
    [
      "a same-site fetch",
      { headers: { "Sec-Fetch-Site": "same-site" } },
      403,
      "recovery.pack_origin_refused",
    ],
  ] as const)(
    "refuses %s, writing no record and keeping the key",
    async (_name, extra, status, code) => {
      const response = await fixture().make(true, extra);
      expect(response.status).toBe(status);
      expect((await codeOf(response)).code).toBe(code);
      expect(await packs()).toEqual([]);
      expect(await readRecoveryKeyName(suite.node, node.nodeId)).toBe(keyInForce.name);
    },
  );

  it.each(["unknown", "suspended"] as const)(
    "refuses the %s session, writing no record and keeping the key",
    async (who) => {
      let token = "not-a-session";
      if (who === "suspended") {
        const manager = await openManagementSession(suite.db, "admin");
        await suite.db
          .update(persons)
          .set({ status: "suspended" })
          .where(eq(persons.id, manager.personId));
        token = manager.token;
      }
      const response = await fixture().make(true, { token });
      expect(response.status).toBe(who === "unknown" ? 401 : 403);
      expect((await codeOf(response)).code).toBe(
        who === "unknown" ? "management_session.required" : "person.suspended",
      );
      expect(await packs()).toEqual([]);
      expect(await readRecoveryKeyName(suite.node, node.nodeId)).toBe(keyInForce.name);
    },
  );

  it("refuses a person without system.manage before reading the fiscal evidence", async () => {
    const supervisor = await openManagementSession(suite.db, "supervisor");
    let reads = 0;
    const response = await fixture({
      evidence: async () => {
        reads++;
        return {};
      },
    }).make(true, { token: supervisor.token });
    expect(response.status).toBe(403);
    expect(reads).toBe(0);
  });

  it("checks system.manage again after the fiscal evidence is read", async () => {
    const response = await fixture({
      evidence: async () => {
        await suite.db.update(persons).set({ role: "staff" }).where(eq(persons.id, admin.personId));
        return {};
      },
    }).make(true);
    expect(response.status).toBe(403);
    expect((await codeOf(response)).code).toBe("authorization.not_permitted");
    expect(await packs()).toEqual([]);
    expect(await readRecoveryKeyName(suite.node, node.nodeId)).toBe(keyInForce.name);
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
    expect(carried.name).toMatch(/^2026-10-30 · [34679ACDEFHJKMNPQRTUVWXY]{4}$/);
    expect(await readRecoveryKeyName(suite.node, node.nodeId)).toBe(carried.name);
    const verifier = (await readRecoveryKeyVerifier(suite.node, node.nodeId))!;
    expect(await verifySecretAsync(carried.secret, verifier)).toBe(true);
    expect(await verifySecretAsync(keyInForce.secret, verifier)).toBe(false);
    const [record] = await packs();
    expect(record!.parts[2]).toMatchObject({ keyName: carried.name, carriedKey: true });
    expect(JSON.stringify(record)).not.toContain(carried.secret);
  });

  it("never gives a new key the name of the key in force or of a key an earlier pack carried", async () => {
    const f = fixture();
    const keyName = async (response: Response) =>
      (await readRecoveryPackPdf(new Uint8Array(await response.arrayBuffer()))).serverKeyName;
    const draws = (...indexes: number[]) => {
      for (const index of indexes) drawCodeIndex.mockReturnValueOnce(index);
    };
    draws(0, 0, 0, 0);
    expect(await keyName(await f.make(true))).toBe("2026-10-30 · 3333");
    draws(0, 0, 0, 0, 1, 1, 1, 1);
    expect(await keyName(await f.make(true))).toBe("2026-10-30 · 4444");
    draws(0, 0, 0, 0, 2, 2, 2, 2);
    expect(await keyName(await f.make(true))).toBe("2026-10-30 · 6666");
  });

  it("names the received pack holding the key, and one no browser confirmed receiving", async () => {
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
      const verifier = await readRecoveryKeyVerifier(suite.node, node.nodeId);
      const response = await fixture({ seat: refusing }).make(ticked);
      expect(response.status).toBe(200);
      expect(response.headers.get("x-waitron-recovery-pack-key")).toBe("failed");
      const bytes = await response.arrayBuffer();
      const text = await pdfText(bytes);
      expect(text.includes("The server key was not replaced.")).toBe(ticked);
      expect(text).toContain("still works");
      expect(await readRecoveryKeyVerifier(suite.node, node.nodeId)).toBe(verifier);
      expect(await readRecoveryKeyName(suite.node, node.nodeId)).toBe(keyInForce.name);
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

  it("a damaged fiscal evidence file fails the server-key page alone, keeping the key", async () => {
    const scratch = await mkdtemp(join(tmpdir(), "pack-evidence-"));
    try {
      await writeFile(join(scratch, "module-preparation-state.json"), "{not valid JSON");
      const verifier = await readRecoveryKeyVerifier(suite.node, node.nodeId);
      const response = await fixture({
        evidence: (module) =>
          readRecoveryDocumentEvidence({ stateDir: scratch, venueDir: scratch }, module),
      }).make(true);
      expect(response.status).toBe(200);
      expect(response.headers.get("x-waitron-recovery-pack-key")).toBe("failed");
      const text = await pdfText(await response.arrayBuffer());
      expect(text).toContain("The server key was not replaced.");
      expect(await readRecoveryKeyVerifier(suite.node, node.nodeId)).toBe(verifier);
      expect(await readRecoveryKeyName(suite.node, node.nodeId)).toBe(keyInForce.name);
      expect((await packs())[0]!.parts.map((p) => [p.part, p.state])).toEqual([
        ["bucket", "included"],
        ["archives", "included"],
        ["server-key", "failed"],
      ]);
    } finally {
      await rm(scratch, { recursive: true, force: true });
    }
  });

  it.each([
    [
      "a refusal, in its own code's words",
      new AppError("sif.allocation_invalid", { reason: "history_invalid" }),
      PART_WORDS.en.historyInvalid.what,
    ],
    ["any other failure, in the general words", new Error("disk read failed"), "could not be read"],
  ])(
    "an evidence read that fails with %s fails only the server-key page",
    async (_n, error, words) => {
      const response = await fixture({
        evidence: async () => {
          throw error;
        },
      }).make();
      expect(response.status).toBe(200);
      expect(response.headers.get("x-waitron-recovery-pack-key")).toBe("failed");
      expect(await pdfText(await response.arrayBuffer())).toContain(words);
      expect((await packs())[0]!.parts.map((p) => p.state)).toEqual([
        "included",
        "included",
        "failed",
      ]);
    },
  );

  it("with two modules offering the server-key page, fails that page without asking either, keeping the key", async () => {
    let asked = 0;
    const response = await fixture({
      seats: 2,
      seat: async (...args) => {
        asked++;
        return drawingSeat(...args);
      },
    }).make(true);
    expect(response.status).toBe(200);
    expect(response.headers.get("x-waitron-recovery-pack-key")).toBe("failed");
    expect(asked).toBe(0);
    expect(await pdfText(await response.arrayBuffer())).toContain(
      "That is a fault in Waitron. A new pack will fail here the same way.",
    );
    expect(await readRecoveryKeyName(suite.node, node.nodeId)).toBe(keyInForce.name);
    const [record] = await packs();
    expect(record!.parts.map((p) => p.state)).toEqual(["included", "included", "failed"]);
    expect(record!.parts[2]).toMatchObject({ keyName: keyInForce.name, carriedKey: false });
  });

  it("with no key in force and the box ticked, fails the page and writes no key", async () => {
    suite.node.run(sql`delete from node_recovery_key`);
    const response = await fixture().make(true);
    expect(response.status).toBe(200);
    expect(response.headers.get("x-waitron-recovery-pack-key")).toBe("failed");
    expect(await readRecoveryKeyVerifier(suite.node, node.nodeId)).toBeNull();
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
    expect(await readRecoveryKeyName(suite.node, node.nodeId)).toBe(keyInForce.name);
    const [record] = await packs();
    expect(record!.number).toBe(2);
    expect(record!.parts[2]).toEqual({ part: "server-key", state: "absent" });
  });

  it("waits for a backup turn already running before it reads anything", async () => {
    const queue = createTurns();
    let handed = 0;
    const turns: Turns = (body) => {
      handed += 1;
      return queue(body);
    };
    let reads = 0;
    const readBoxEnv = async () => {
      reads += 1;
      return { ...boxEnv };
    };
    let release!: () => void;
    const held = turns(() => new Promise<void>((resolve) => (release = resolve)));
    const making = fixture({ turns, readBoxEnv }).make();
    await vi.waitFor(() => expect(handed).toBe(2), { timeout: 30_000 });
    expect(reads).toBe(0);
    expect(await packs()).toEqual([]);
    release();
    await held;
    expect((await making).status).toBe(200);
    expect(reads).toBe(1);
    expect(await packs()).toHaveLength(1);
  });

  it("logs the made pack's parts, why a part failed, and the person, and no code, key, secret or error message in the log or headers", async () => {
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
    await withTransaction(suite.db, (tx) =>
      putCredential(tx, RING, { purpose: ARCHIVE_PURPOSE, value: { settings: "{not json" } }),
    );
    const failing = await fixture({
      evidence: async () => {
        throw new Error("could not read /home/jane-doe/evidence.json");
      },
    }).make();
    expect(failing.status).toBe(200);
    expect(logs).toContainEqual([
      "info",
      "recovery.pack_made",
      {
        personId: admin.personId,
        number: 2,
        parts: [
          { part: "bucket", state: "included" },
          { part: "archives", state: "failed", failedWith: "backup.archive_settings_unreadable" },
          { part: "server-key", state: "failed", failedWith: "unexpected" },
        ],
      },
    ]);
    const seen = JSON.stringify([logs, [...response.headers], [...failing.headers]]);
    for (const value of [
      KEY,
      BUCKET.secretAccessKey,
      secret,
      file.bucketCode!,
      file.archiveCode!,
      "jane-doe",
    ])
      expect(seen).not.toContain(value);
  });

  it("a pack that cannot be drawn writes no record and keeps the key", async () => {
    const verifier = await readRecoveryKeyVerifier(suite.node, node.nodeId);
    const response = await fixture({
      loadFont: async () => {
        throw new Error("font missing");
      },
    }).make(true);
    expect(response.status).toBe(500);
    expect(await packs()).toEqual([]);
    expect(await readRecoveryKeyVerifier(suite.node, node.nodeId)).toBe(verifier);
    expect(await readRecoveryKeyName(suite.node, node.nodeId)).toBe(keyInForce.name);
  });

  it("makes two packs asked for at once one after the other, the later one's key in force", async () => {
    let active = 0;
    let peak = 0;
    let entered = 0;
    let bothIn!: () => void;
    const together = new Promise<void>((resolve) => (bothIn = resolve));
    const f = fixture({
      evidence: async () => {
        active++;
        peak = Math.max(peak, active);
        if (++entered === 2) bothIn();
        // Long enough for the other request's sign-in check to finish, were they not taking turns.
        await Promise.race([together, new Promise((resolve) => setTimeout(resolve, 500))]);
        active--;
        return {};
      },
    });
    const replies = await Promise.all([f.make(true), f.make(true)]);
    expect(replies.map((reply) => reply.status)).toEqual([200, 200]);
    expect(peak).toBe(1);
    const files = await Promise.all(
      replies.map(async (reply) => readRecoveryPackPdf(new Uint8Array(await reply.arrayBuffer()))),
    );
    const later = files.find((file) => file.number === 2)!;
    const carried = (later.serverKey as { nodeKey: { name: string; secret: string } }).nodeKey;
    expect(await readRecoveryKeyName(suite.node, node.nodeId)).toBe(carried.name);
    expect(
      await verifySecretAsync(
        carried.secret,
        (await readRecoveryKeyVerifier(suite.node, node.nodeId))!,
      ),
    ).toBe(true);
  });

  it("holds node.db's lock while it makes a pack with a new key, so a key replacement waits for the pack", async () => {
    const order: string[] = [];
    const original = suite.db.withWriteLock;
    const spy = vi.spyOn(suite.db, "withWriteLock").mockImplementation(async (body) => {
      const value = await original(body);
      order.push("venue write committed");
      return value;
    });
    onTestFinished(() => spy.mockRestore());
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    let arrived!: () => void;
    const inside = new Promise<void>((resolve) => (arrived = resolve));
    const response = fixture({
      seat: async (tx, seatNode, context) => {
        arrived();
        await gate;
        return drawingSeat(tx, seatNode, context);
      },
    }).make(true);
    await inside;
    let asked!: () => void;
    const lockRequested = new Promise<void>((resolve) => (asked = resolve));
    const nodeLock = suite.node.withWriteLock;
    const nodeSpy = vi.spyOn(suite.node, "withWriteLock").mockImplementation((body) => {
      asked();
      return nodeLock(body);
    });
    onTestFinished(() => nodeSpy.mockRestore());
    const replacement = mintBreakGlassKey({ venue: suite.db, node: suite.node }, node.nodeId).then(
      (replaced) => {
        order.push("key replaced");
        return replaced;
      },
    );
    // Once the replacement asks for node.db's lock, room for it to finish if nothing holds it back.
    await lockRequested;
    await Promise.race([replacement, new Promise((resolve) => setTimeout(resolve, 100))]);
    order.push("released");
    release();
    const answer = await response;
    expect(answer.status).toBe(200);
    const replaced = await replacement;
    expect(order.at(-1)).toBe("key replaced");
    expect(order.slice(0, -1)).toContain("venue write committed");
    expect(order.slice(order.indexOf("released"), -1)).toContain("venue write committed");
    const file = await readRecoveryPackPdf(new Uint8Array(await answer.arrayBuffer()));
    const carried = (file.serverKey as { nodeKey: { name: string } }).nodeKey;
    const [record] = await packs();
    expect(record!.parts[2]).toMatchObject({ keyName: carried.name, carriedKey: true });
    expect(replaced.name).not.toBe(carried.name);
    expect(await readRecoveryKeyName(suite.node, node.nodeId)).toBe(replaced.name);
  });

  it("takes the backup key from the box's settings file, never the key the backups loaded", async () => {
    boxEnv = {};
    const response = await fixture().make();
    expect(response.status).toBe(200);
    expect((await packs())[0]!.parts.map((p) => [p.part, p.state])).toEqual([
      ["bucket", "failed"],
      ["archives", "failed"],
      ["server-key", "included"],
    ]);
  });

  it("logs no session token", async () => {
    expect((await fixture().make(true)).status).toBe(200);
    expect(JSON.stringify(logs)).not.toContain(admin.token);
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
    for (const number of ["abc", "1.5"]) {
      const response = await f.post(`/api/backup/recovery-pack/${number}/received`, {});
      expect(await codeOf(response)).toEqual({
        code: "recovery.pack_invalid",
        params: { reason: "unknown_pack" },
      });
    }
    expect(await receivedAt()).toBeNull();
    const [theirs] = await readRecoveryPacks(suite.db, elsewhere.nodeId);
    expect(theirs!.receivedAt).toBeNull();
  });

  it("reads the body before it takes the venue's write turn, so a slow client holds up no sale", async () => {
    const f = await made();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        await gate;
        controller.enqueue(new TextEncoder().encode("{}"));
        controller.close();
      },
    });
    const answer = f.post("/api/backup/recovery-pack/1/received", undefined, { stream });
    await new Promise((resolve) => setTimeout(resolve, 50));
    const other = withTransaction(suite.db, async () => "written");
    const first = await Promise.race([
      other,
      new Promise((resolve) => setTimeout(() => resolve("waiting"), 1000)),
    ]);
    release();
    expect(first).toBe("written");
    expect((await answer).status).toBe(204);
    expect(await receivedAt()).not.toBeNull();
  });

  it("refuses a person without system.manage before judging the body", async () => {
    const f = await made();
    const supervisor = await openManagementSession(suite.db, "supervisor");
    const response = await f.post(
      "/api/backup/recovery-pack/1/received",
      { at: "now" },
      { token: supervisor.token },
    );
    expect(response.status).toBe(403);
    expect((await codeOf(response)).code).toBe("authorization.not_permitted");
  });

  it("never reads the body of a request from an unknown session or a person without system.manage", async () => {
    const f = await made();
    const supervisor = await openManagementSession(suite.db, "supervisor");
    for (const [token, status] of [
      ["0123456789abcdef0123456789abcdef", 401],
      [supervisor.token, 403],
    ] as const) {
      let pulled = 0;
      const stream = new ReadableStream<Uint8Array>(
        {
          pull(controller) {
            pulled++;
            controller.enqueue(new TextEncoder().encode("{}"));
            controller.close();
          },
        },
        { highWaterMark: 0 },
      );
      const response = await f.post("/api/backup/recovery-pack/1/received", undefined, {
        token,
        stream,
      });
      expect(response.status).toBe(status);
      expect(pulled).toBe(0);
    }
    expect(await receivedAt()).toBeNull();
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

describe("the status route", () => {
  type Answer = {
    latest: { number: number; madeByName: string | null; received: boolean } | null;
    upToDate: boolean;
    unreceived: { number: number; holdsCurrentServerKey: boolean } | null;
    reasons: { part: string; kind: string }[];
    keep: { number: number; why: string }[];
    backupsUseOlderKey: boolean;
  };
  const read = async (f: ReturnType<typeof fixture>) => {
    const response = await f.status();
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    return (await response.json()) as Answer;
  };

  it("needs a session and system.manage", async () => {
    const f = fixture();
    expect((await f.status(null)).status).toBe(401);
    const supervisor = await openManagementSession(suite.db, "supervisor");
    const response = await f.status(supervisor.token);
    expect(response.status).toBe(403);
    expect((await codeOf(response)).code).toBe("authorization.not_permitted");
  });

  it("names the venue's time zone, so the card dates a pack as the paper does", async () => {
    await suite.db
      .update(locations)
      .set({ timeZone: "Atlantic/Canary" })
      .where(eq(locations.id, node.locationId));
    expect(await read(fixture())).toMatchObject({ timeZone: "Atlantic/Canary" });
  });

  it("names UTC when the stored zone is one the runtime does not know, so the card can still format dates", async () => {
    await suite.db
      .update(locations)
      .set({ timeZone: "Mars/Olympus_Mons" })
      .where(eq(locations.id, node.locationId));
    expect(await read(fixture())).toMatchObject({ timeZone: "UTC" });
  });

  it("says no pack has been made, then up to date once one is received, then out of date when the key changes", async () => {
    const f = fixture();
    expect(await read(f)).toMatchObject({ latest: null, upToDate: false });
    await (await f.make()).arrayBuffer();
    expect(await read(f)).toMatchObject({
      latest: { number: 1, received: false },
      upToDate: false,
    });
    await f.received(1);
    const fresh = await read(f);
    expect(fresh).toMatchObject({ upToDate: true, reasons: [], backupsUseOlderKey: false });
    const [person] = await suite.db
      .select({ name: persons.displayName })
      .from(persons)
      .where(eq(persons.id, admin.personId));
    expect(fresh.latest!.madeByName).toBe(person!.name);
    boxEnv = { ...boxEnv, WAITRON_BACKUP_KEY_ROTATED_AT: "2026-10-29T08:00:00.000Z" };
    expect((await read(f)).reasons).toEqual([
      { part: "bucket", kind: "key_changed", at: "2026-10-29T08:00:00.000Z" },
      { part: "archives", kind: "key_changed", at: "2026-10-29T08:00:00.000Z" },
    ]);
  });

  it("names a lost pack as the only copy of the server key, until a newer ticked pack replaces it", async () => {
    const f = fixture();
    // The answer is never read: the record and the new key are committed all the same.
    await f.make(true);
    const [record] = await packs();
    expect(record).toMatchObject({ receivedAt: null });
    expect(record!.parts[2]).toMatchObject({ carriedKey: true });
    expect(await readRecoveryKeyName(suite.node, node.nodeId)).toBe(record!.parts[2]!.keyName);
    expect(await read(f)).toMatchObject({
      upToDate: false,
      unreceived: { number: 1, holdsCurrentServerKey: true },
      keep: [],
    });
    await (await f.make(true)).arrayBuffer();
    expect((await read(f)).unreceived).toEqual({
      number: 2,
      madeAt: "2026-10-30T09:00:00.000Z",
      holdsCurrentServerKey: true,
    });
    await f.received(2);
    expect(await read(f)).toMatchObject({
      upToDate: true,
      unreceived: null,
      keep: [{ number: 2, why: "server_key" }],
    });
  });

  it("a key replacement whose verifier save fails keeps the old key working and reports the new pack out of date", async () => {
    const f = fixture();
    suite.node.run(
      sql`create trigger refuse_recovery_key before update on node_recovery_key begin select raise(abort, 'recovery key save refused'); end`,
    );
    try {
      const response = await f.make(true);
      expect(response.status).toBe(500);
    } finally {
      suite.node.run(sql`drop trigger refuse_recovery_key`);
    }
    const [record] = await packs();
    expect(record!.parts[2]).toMatchObject({ carriedKey: true });
    expect(record!.parts[2]!.keyName).not.toBe(keyInForce.name);
    expect(await readRecoveryKeyName(suite.node, node.nodeId)).toBe(keyInForce.name);
    const verifier = (await readRecoveryKeyVerifier(suite.node, node.nodeId))!;
    expect(await verifySecretAsync(keyInForce.secret, verifier)).toBe(true);
    await f.received(1);
    expect(await read(f)).toMatchObject({
      upToDate: false,
      reasons: [{ part: "server-key", kind: "key_replaced" }],
    });
  });

  it("says the box's backups still use the older key when the loaded key differs from the settings file's", async () => {
    const f = fixture();
    loadedKey = "the-key-before-the-change";
    const answer = await read(f);
    expect(answer.backupsUseOlderKey).toBe(true);
    expect(JSON.stringify(answer)).not.toContain(loadedKey);
    expect(JSON.stringify(answer)).not.toContain(KEY);
    loadedKey = undefined;
    expect((await read(f)).backupsUseOlderKey).toBe(false);
  });

  it("answers when the backup key is too short; a pack made under it is incomplete", async () => {
    boxEnv = { ...boxEnv, WAITRON_BACKUP_RECOVERY_KEY: "short" };
    const f = fixture();
    expect((await f.make()).status).toBe(200);
    expect((await f.received(1)).status).toBe(204);
    const response = await f.status();
    expect(response.status).toBe(200);
    const answer = (await response.json()) as Answer & { incomplete: boolean };
    expect(answer).toMatchObject({ incomplete: true, upToDate: false, backupsUseOlderKey: false });
    for (const key of [KEY, "short"]) expect(JSON.stringify(answer)).not.toContain(key);
  });

  it("counts archives as changed when their record cannot be read, even after the environment managed them", async () => {
    managed = true;
    boxEnv = { ...boxEnv, WAITRON_BACKUP_DIR: "/srv/archives" };
    const f = fixture();
    await (await f.make()).arrayBuffer();
    await f.received(1);
    expect((await read(f)).upToDate).toBe(true);
    managed = false;
    await withTransaction(suite.db, (tx) =>
      putCredential(tx, RING, { purpose: ARCHIVE_PURPOSE, value: { settings: "{not json" } }),
    );
    const answer = await read(f);
    expect(answer.upToDate).toBe(false);
    expect(answer.reasons).toContainEqual({ part: "archives", kind: "settings_changed" });
  });

  it("says a pack is out of date when the environment's archive bucket changes, recording none of its credentials", async () => {
    const destinations = (bucket: string) =>
      JSON.stringify([{ kind: "s3", id: "archive", ...BUCKET, bucket }]);
    managed = true;
    boxEnv = { ...boxEnv, WAITRON_BACKUP_DESTINATIONS: destinations("old-bucket") };
    const f = fixture();
    const file = await readRecoveryPackPdf(new Uint8Array(await (await f.make()).arrayBuffer()));
    expect(decodeArchiveRecoveryPack(file.archiveCode!).bucket.bucket).toBe("old-bucket");
    await f.received(1);
    expect((await read(f)).upToDate).toBe(true);
    const stored = JSON.stringify(await packs());
    for (const value of [BUCKET.accessKeyId, BUCKET.secretAccessKey, KEY])
      expect(stored).not.toContain(value);
    boxEnv = { ...boxEnv, WAITRON_BACKUP_DESTINATIONS: destinations("new-bucket") };
    const answer = await read(f);
    expect(answer.upToDate).toBe(false);
    expect(answer.reasons).toEqual([{ part: "archives", kind: "settings_changed" }]);
  });

  it("keeps one pack for a backup key that was never changed before its first change", async () => {
    delete boxEnv.WAITRON_BACKUP_KEY_ROTATED_AT;
    let instant = "2026-10-01T09:00:00.000Z";
    const f = fixture({ now: () => new Date(instant) });
    await (await f.make()).arrayBuffer();
    await f.received(1);
    instant = "2026-10-02T09:00:00.000Z";
    await (await f.make()).arrayBuffer();
    await f.received(2);
    boxEnv = { ...boxEnv, WAITRON_BACKUP_KEY_ROTATED_AT: "2026-10-03T09:00:00.000Z" };
    instant = "2026-10-04T09:00:00.000Z";
    expect((await read(f)).keep).toEqual([
      expect.objectContaining({ number: 2, why: "backup_key" }),
    ]);
  });

  it("answers for this node only", async () => {
    await withTransaction(suite.db, (tx) =>
      insertRecoveryPack(tx, {
        nodeId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
        number: 1,
        madeAt: new Date("2026-10-29T09:00:00.000Z"),
        madeBy: admin.personId,
        parts: [],
      }),
    );
    expect((await read(fixture())).latest).toBeNull();
  });
});
