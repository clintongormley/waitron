import { storeArchivePart } from "./testing/backup-settings.js";
import { nodeHandoverEvents } from "@waitron/node-db";
import { ensureStreamId, withFoldedPersonChanges } from "@waitron/db";
import { setBuiltInRoleForTest } from "@waitron/identity/test/person-rows.js";
import { setFreshManagementSignIn } from "./testing/fresh-management-sign-in.js";
import { mountMeApi } from "./me-api.js";
import { randomInt } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { Socket } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { TLSSocket } from "node:tls";
import { eq, sql } from "drizzle-orm";
import { Hono } from "hono";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { afterEach, beforeEach, describe, expect, it, onTestFinished, vi } from "vitest";
import { loadKeyRing } from "@waitron/credentials";
import {
  CORE_CHANGE_SOURCES,
  insertRecoveryPack,
  installChangeFeed,
  readRecoveryPacks,
  removeChangeFeed,
  setNodePublicKey,
  stampDeployment,
  subscribeToChanges,
  withTransaction,
  withNodeTransaction,
} from "@waitron/db";
import { seedNode, seedTaxpayer, seedVenue } from "@waitron/db/testing/seed.js";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import {
  beginOwnPasskeyCheck,
  persons,
  verifySecretAsync,
  webauthnCredentials,
} from "@waitron/identity";
import { verifyAuthenticationResponse } from "@simplewebauthn/server";
import { openManagementSession } from "@waitron/identity/test/fixtures.js";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { readRecoveryKeyName, readRecoveryKeyVerifier } from "@waitron/node-db";
import type { ProvisionedNode, WaitronModule } from "@waitron/module";
import { fakeModule } from "@waitron/module/src/testing/fake-module.js";
import { PART_WORDS, readRecoveryPackPdf, type RecoveryPackPage } from "@waitron/recovery-pack";
import { AppError, type ResourceIdentity } from "@waitron/shared";
import { parseRecoveryKit } from "@waitron/stream";
import { decodeArchiveRecoveryPack } from "./archive-recovery-pack.js";
import { writeArchiveSettings, type ArchiveSettings } from "./archive-settings.js";
import {
  mountBackupRecoveryPackMakeApi,
  type BackupRecoveryPackMakeDeps,
} from "./backup-recovery-pack-api.js";
import { createTurns, type Turns } from "./backup-turns.js";
import { mintBreakGlassKey } from "./break-glass.js";
import { loadRecoveryPackFonts } from "./invoice-font.js";
import { readRecoveryDocumentEvidence } from "./recovery-document-evidence.js";
import { writeStreamSettings } from "./stream-host.js";
import { TOTP_KEY_RING } from "./testing/authenticator.js";
import { emergencyReply } from "../test/cloud-emergency-fixture.js";
import type { EmergencyDisplay } from "./cloud-emergency.js";
import { createStaffApp } from "./cloud-remote.js";

vi.mock("@simplewebauthn/server", async (original) => ({
  ...(await original<typeof import("@simplewebauthn/server")>()),
  verifyAuthenticationResponse: vi.fn(),
}));

const RING = loadKeyRing({
  WAITRON_CREDENTIALS_KEY: Buffer.alloc(32, 9).toString("base64"),
  WAITRON_CREDENTIALS_KEY_VERSION: "1",
});
const KEY = "recovery-key-recognisable-SECRET";
const BUCKET = {
  region: "eu-west-1",
  bucket: "venue-bucket",
  prefix: "shop/",
  accessKeyId: "AKIASTREAMRECOGNISABLE",
  secretAccessKey: "stream-secret-recognisable-0123456789",
};
const ARCHIVES: Omit<ArchiveSettings, "revision"> = {
  enabled: true,
  destinations: [{ kind: "s3", id: "bucket", bucket: { ...BUCKET, prefix: "archives/" } }],
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
const sockets: TLSSocket[] = [];
const logs: unknown[][] = [];

afterEach(() => {
  for (const socket of sockets.splice(0)) socket.destroy();
  drawCodeIndex.mockReset();
});

beforeEach(async () => {
  logs.length = 0;
  boxEnv = {
    WAITRON_BACKUP_RECOVERY_KEY: KEY,
    WAITRON_BACKUP_KEY_ROTATED_AT: "2026-09-20T08:00:00.000Z",
  };
  loadedKey = KEY;
  await seedTaxpayer(suite.db);
  await stampDeployment(suite.db, "preproduction");
  await seedVenue(suite.db, {
    name: "Sala",
    invoiceLocales: ["es"],
  });
  const nodeId = await seedNode(suite.db);
  node = { nodeId };
  await setNodePublicKey(suite.db, nodeId, "SIGNER_PUBLIC_KEY");
  keyInForce = await mintBreakGlassKey({ venue: suite.db, node: suite.node }, nodeId);
  await withTransaction(suite.db, async (tx) => {
    await ensureStreamId(tx);
    await writeStreamSettings(tx, RING, BUCKET, null);
    await writeArchiveSettings(tx, RING, ARCHIVES, null);
  });
  admin = await openManagementSession(suite.db, "admin");
  await withTransaction(suite.db, (tx) => setFreshManagementSignIn(tx, admin.token));
});

type Seat = NonNullable<NonNullable<WaitronModule["backup"]>["recoveryPackPage"]>;

/** The key file a real seat hands back carries the new key; this one carries it the same way. */
const drawingSeat: Seat = async (_tx, _node, context) =>
  context.newKey === undefined
    ? { page: PAGE }
    : { page: PAGE, keyFile: { kind: "test-key-file", nodeKey: context.newKey } };

function fixture(
  options: {
    cloud?: BackupRecoveryPackMakeDeps["cloud"];
    remote?: boolean;
    seat?: Seat | null;
    seats?: number;
    turns?: Turns;
    now?: () => Date;
    evidence?: (module: WaitronModule) => Promise<Readonly<Record<string, unknown>>>;
    loadFonts?: typeof loadRecoveryPackFonts;
    readBoxEnv?: () => Promise<Record<string, string | undefined>>;
  } = {},
) {
  const local = new Hono();
  const app = options.remote
    ? createStaffApp(local, async () => "https://staff.example.test")
    : local;
  const seat = options.seat === undefined ? drawingSeat : options.seat;
  const modules: WaitronModule[] =
    seat === null
      ? []
      : Array.from({ length: options.seats ?? 1 }, (_, n) => ({
          ...fakeModule(`test-regime-${n}`),
          backup: { recoveryPackPage: seat },
        }));
  mountMeApi(
    local,
    {
      db: suite.db,
      venueLocale: "en-GB",
      modules: [],
      credentialKeyRing: TOTP_KEY_RING,
      rpId: "box.test",
      origin: "https://box.test",
    },
    () => {},
  );
  mountBackupRecoveryPackMakeApi(
    local,
    {
      cloud: options.cloud,
      db: suite.db,
      nodeDb: suite.node,
      ring: RING,
      node,
      modules,
      turns: options.turns ?? createTurns(),
      readBoxEnv: options.readBoxEnv ?? (async () => ({ ...boxEnv })),
      backups: () => ({
        schedule: ARCHIVES.schedule,
        retention: ARCHIVES.retention,
        recoveryKey: loadedKey,
      }),
      documentEvidence: options.evidence ?? (async () => ({})),
      loadFonts: options.loadFonts ?? loadRecoveryPackFonts,
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
      signal,
    }: {
      token?: string | null;
      headers?: Record<string, string>;
      tls?: boolean;
      raw?: string;
      stream?: ReadableStream<Uint8Array>;
      signal?: AbortSignal;
    } = {},
  ) {
    const socket = tls ? new TLSSocket(new Socket()) : undefined;
    if (socket) sockets.push(socket);
    return app.request(
      `https://${options.remote ? "staff.example.test" : "box.test"}${path}`,
      {
        method: "POST",
        signal,
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
  return {
    post,
    make: (
      newServerKey = false,
      extra: Parameters<typeof post>[2] = {},
      body: unknown = { locale: "en", newServerKey },
    ) => post("/api/backup/recovery-pack", body, extra),
    received: (number: number, extra: Parameters<typeof post>[2] = {}) =>
      post(`/api/backup/recovery-pack/${number}/received`, {}, extra),
    status: (token: string | null = admin.token) =>
      app.request("https://box.test/api/backup/recovery-pack", {
        headers: token === null ? {} : { cookie: `waitron_management_session=${token}` },
      }),
  };
}

it("verifies remote recovery-pack passkeys against the staff origin and hostname", async () => {
  await suite.db.insert(webauthnCredentials).values({
    personId: admin.personId,
    credentialId: "cred-remote",
    publicKey: "AQID",
    counter: 0,
  });
  const { challengeHandle } = await withTransaction(suite.db, (tx) =>
    beginOwnPasskeyCheck(tx, { managementSessionId: admin.token, rpId: "staff.example.test" }),
  );
  const verify = vi.mocked(verifyAuthenticationResponse);
  verify.mockImplementation(async (input) => {
    if (
      input.expectedRPID !== "staff.example.test" ||
      input.expectedOrigin !== "https://staff.example.test"
    )
      throw new Error("wrong passkey site");
    return {
      verified: true,
      authenticationInfo: {
        credentialID: "cred-remote",
        newCounter: 1,
        userVerified: true,
        credentialDeviceType: "singleDevice",
        credentialBackedUp: false,
        origin: "https://staff.example.test",
        rpID: "staff.example.test",
      },
    };
  });
  onTestFinished(() => {
    verify.mockReset();
  });
  const remote = fixture({ remote: true });
  const confirmation = await remote.post("/management-api/session/me/fresh-sign-in", {
    method: "passkey",
    challengeHandle,
    response: { id: "cred-remote" },
  });
  expect(confirmation.status).toBe(204);
  const response = await remote.make();
  expect(response.status).toBe(200);
  expect(response.headers.get("content-type")).toBe("application/pdf");
  await response.arrayBuffer();
});

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
    const fetchCode = vi.fn(async () => EMERGENCY);
    const response = await fixture({ cloud: cloudPack(fetchCode) }).make(true, extra);
    expect(fetchCode).not.toHaveBeenCalled();
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
    ["an extra field", { locale: "en", newServerKey: false, more: 1 }],
    ["an unknown language", { locale: "fr", newServerKey: false }],
    ["a tick that is not a boolean", { locale: "en", newServerKey: "yes" }],
    ["no language", { newServerKey: false }],
  ])("refuses %s as the request's shape", async (_name, body) => {
    const response = await fixture().make(false, {}, body);
    expect(response.status).toBe(400);
    expect(await codeOf(response)).toEqual({
      code: "recovery.pack_invalid",
      params: { reason: "shape" },
    });
  });

  it("requires fresh proof, writing no record and keeping the key", async () => {
    await withTransaction(suite.db, (tx) => setFreshManagementSignIn(tx, admin.token, false));
    const response = await fixture().make(true);
    expect(response.status).toBe(400);
    expect((await codeOf(response)).code).toBe("management_session.proof_required");
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
          .set(withFoldedPersonChanges({ status: "suspended" }))
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
        await setBuiltInRoleForTest(suite.db, admin.personId, "staff");
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
    expect(response.headers.get("x-waitron-recovery-pack-made-at")).toBe(
      "2026-10-30T09:00:00.000Z",
    );
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
      ["emergency", "absent"],
      ["bucket", "included"],
      ["archives", "included"],
      ["server-key", "included"],
    ]);
    expect(record!.parts[3]).toMatchObject({ keyName: keyInForce.name, carriedKey: false });
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
    expect(record!.parts[3]).toMatchObject({ keyName: carried.name, carriedKey: true });
    expect(JSON.stringify(record)).not.toContain(carried.secret);
    expect(
      await suite.node
        .select({
          nodeId: nodeHandoverEvents.nodeId,
          operationId: nodeHandoverEvents.operationId,
          kind: nodeHandoverEvents.kind,
          detail: nodeHandoverEvents.detail,
          envelope: nodeHandoverEvents.envelope,
        })
        .from(nodeHandoverEvents),
    ).toEqual([
      {
        nodeId: node.nodeId,
        operationId: null,
        kind: "box.recovery_key_replaced",
        detail: { keyName: carried.name, personId: admin.personId },
        envelope: null,
      },
    ]);
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
      expect(record!.parts[3]).toEqual({
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
      await mkdir(join(scratch, "module-records"), { recursive: true });
      await writeFile(join(scratch, "module-records/fiscal-verifactu.json"), "{not valid JSON");
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
        ["emergency", "absent"],
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
        "absent",
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
    expect(record!.parts.map((p) => p.state)).toEqual(["absent", "included", "included", "failed"]);
    expect(record!.parts[3]).toMatchObject({ keyName: keyInForce.name, carriedKey: false });
  });

  it("with no key in force and the box ticked, counts the page as not set up and writes no key", async () => {
    suite.node.run(sql`delete from box`);
    const response = await fixture().make(true);
    expect(response.status).toBe(200);
    expect(response.headers.get("x-waitron-recovery-pack-key")).toBe("unchanged");
    expect(await pdfText(await response.arrayBuffer())).toContain(
      "This box has no server key yet.",
    );
    expect(await readRecoveryKeyVerifier(suite.node, node.nodeId)).toBeNull();
    const [record] = await packs();
    expect(record!.parts[3]).toEqual({ part: "server-key", state: "not-set-up" });
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
    expect(record!.parts[3]).toEqual({ part: "server-key", state: "absent" });
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
          { part: "emergency", state: "absent" },
          { part: "bucket", state: "included" },
          { part: "archives", state: "included" },
          { part: "server-key", state: "included" },
        ],
      },
    ]);
    await withTransaction(suite.db, (tx) => storeArchivePart(tx, {}));
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
          { part: "emergency", state: "absent" },
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
      loadFonts: async () => {
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
    expect(record!.parts[3]).toMatchObject({ keyName: carried.name, carriedKey: true });
    expect(replaced.name).not.toBe(carried.name);
    expect(await readRecoveryKeyName(suite.node, node.nodeId)).toBe(replaced.name);
  });

  it("takes the backup key from the box's settings file, never the key the backups loaded", async () => {
    boxEnv = {};
    const response = await fixture().make();
    expect(response.status).toBe(200);
    expect((await packs())[0]!.parts.map((p) => [p.part, p.state])).toEqual([
      ["emergency", "absent"],
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

describe("the live change", () => {
  /** The `recovery_packs` changes the venue database's change feed delivers while `run` runs. */
  async function packChanges(
    run: (seen: readonly ResourceIdentity[]) => Promise<void>,
  ): Promise<ResourceIdentity[]> {
    await installChangeFeed(suite.db, CORE_CHANGE_SOURCES);
    const heard: ResourceIdentity[] = [];
    const unsubscribe = subscribeToChanges((change) =>
      heard.push(...change.resources.filter((r) => r.type === "recovery_packs")),
    );
    // The reset between cases does not remove the feed's triggers, so this case does.
    try {
      await run(heard);
      return heard;
    } finally {
      unsubscribe();
      await removeChangeFeed(suite.db);
      await suite.db.execute(sql`delete from change_log`);
    }
  }

  it("comes from the table after a pack is made and again after it is marked received", async () => {
    const f = fixture();
    let afterMake: ResourceIdentity[] = [];
    const heard = await packChanges(async (seen) => {
      await (await f.make(true)).arrayBuffer();
      afterMake = [...seen];
      expect((await f.received(1)).status).toBe(204);
    });
    expect(afterMake).toEqual([{ type: "recovery_packs" }]);
    // An update is announced as the row before and the row after.
    expect(heard).toEqual(Array.from({ length: 3 }, () => ({ type: "recovery_packs" })));
  });

  it("does not come for a refused make or a refused receipt", async () => {
    const f = fixture();
    await (await f.make(true)).arrayBuffer();
    const heard = await packChanges(async () => {
      expect((await f.make(true, { tls: false })).status).toBe(403);
      expect((await f.post("/api/backup/recovery-pack/1/received", { at: "now" })).status).toBe(
        400,
      );
      expect((await f.received(2)).status).toBe(400);
    });
    expect(heard).toEqual([]);
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
    serverKey: string;
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
    await suite.db.run(
      sql`update settings set doc = json_set(doc, '$.timeZone', ${"Atlantic/Canary"}) where module = 'business_day'`,
    );
    expect(await read(fixture())).toMatchObject({ timeZone: "Atlantic/Canary" });
  });

  it("names UTC when the stored zone is one the runtime does not know, so the card can still format dates", async () => {
    await suite.db.run(
      sql`update settings set doc = json_set(doc, '$.timeZone', ${"Mars/Olympus_Mons"}) where module = 'business_day'`,
    );
    expect(await read(fixture())).toMatchObject({ timeZone: "UTC" });
  });

  it("names the box's server key as set, not yet made, or not kept by this venue", async () => {
    expect(await read(fixture())).toMatchObject({ serverKey: "set" });
    expect(await read(fixture({ seat: null }))).toMatchObject({ serverKey: "none" });
    suite.node.run(sql`delete from box`);
    expect(await read(fixture())).toMatchObject({ serverKey: "not_yet" });
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
    expect(record!.parts[3]).toMatchObject({ carriedKey: true });
    expect(await readRecoveryKeyName(suite.node, node.nodeId)).toBe(record!.parts[3]!.keyName);
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
      sql`create trigger refuse_recovery_key before update on box begin select raise(abort, 'recovery key save refused'); end`,
    );
    try {
      const response = await f.make(true);
      expect(response.status).toBe(500);
    } finally {
      suite.node.run(sql`drop trigger refuse_recovery_key`);
    }
    const [record] = await packs();
    expect(record!.parts[3]).toMatchObject({ carriedKey: true });
    expect(record!.parts[3]!.keyName).not.toBe(keyInForce.name);
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

  it("counts archives as changed when their record cannot be read", async () => {
    const f = fixture();
    await (await f.make()).arrayBuffer();
    await f.received(1);
    expect((await read(f)).upToDate).toBe(true);
    await withTransaction(suite.db, (tx) => storeArchivePart(tx, {}));
    const answer = await read(f);
    expect(answer.upToDate).toBe(false);
    expect(answer.reasons).toContainEqual({ part: "archives", kind: "settings_changed" });
  });

  it("says a pack is out of date when the archive bucket changes, recording none of its credentials", async () => {
    const destinations = (bucket: string): ArchiveSettings["destinations"] => [
      { kind: "s3", id: "bucket", bucket: { ...BUCKET, bucket } },
    ];
    await withTransaction(suite.db, (tx) =>
      writeArchiveSettings(
        tx,
        RING,
        { ...ARCHIVES, destinations: destinations("old-bucket") },
        null,
      ),
    );
    const f = fixture();
    const file = await readRecoveryPackPdf(new Uint8Array(await (await f.make()).arrayBuffer()));
    expect(decodeArchiveRecoveryPack(file.archiveCode!).bucket.bucket).toBe("old-bucket");
    await f.received(1);
    expect((await read(f)).upToDate).toBe(true);
    const stored = JSON.stringify(await packs());
    for (const value of [BUCKET.accessKeyId, BUCKET.secretAccessKey, KEY])
      expect(stored).not.toContain(value);
    await withTransaction(suite.db, (tx) =>
      writeArchiveSettings(
        tx,
        RING,
        { ...ARCHIVES, destinations: destinations("new-bucket") },
        null,
      ),
    );
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

const EMERGENCY = {
  version: 1 as const,
  installationId: "installation",
  venueId: "venue",
  countryCode: "ES" as const,
  asOf: "2026-10-30T09:00:00.000Z",
  codeIssuedAt: "2026-10-20T08:00:00.000Z",
  address: "https://rescue.venue.example/",
  code: "ABCD-EFGH-JKLM-NPQR-STUV-WXYZ",
};
const cloudPack = (
  code = async () => EMERGENCY,
  isPrimary = () => true,
): NonNullable<BackupRecoveryPackMakeDeps["cloud"]> => ({
  connection: {
    status: async () => ({ state: "complete", code: "" }),
    emergencyCode: code,
    emergency: async () =>
      ({
        ...emergencyReply("installation", "venue", EMERGENCY.asOf),
        emergency: {
          status: "ready",
          open: true,
          closedReason: null,
          address: EMERGENCY.address,
          codeIssuedAt: EMERGENCY.codeIssuedAt,
        },
        stale: false,
      }) as EmergencyDisplay & { stale: boolean },
  },
  managementOrigin: "https://box.test",
  isPrimary,
});

it.each(["en", "es"] as const)(
  "prints Cloud's returned address and code, storing only the issue date (%s)",
  async (locale) => {
    const response = await fixture({ cloud: cloudPack() }).make(
      false,
      {},
      { locale, newServerKey: false },
    );
    expect(response.status).toBe(200);
    const bytes = await response.arrayBuffer();
    const text = await pdfText(bytes);
    expect(text).toContain(EMERGENCY.address);
    expect(text.replace(/\s+/g, "")).toContain(EMERGENCY.code);
    expect(text).toContain(PART_WORDS[locale].emergency.intro);
    const [record] = await packs();
    expect(record!.parts[0]).toEqual({
      part: "emergency",
      state: "included",
      codeIssuedAt: EMERGENCY.codeIssuedAt,
    });
    for (const value of [
      JSON.stringify(record),
      JSON.stringify(logs),
      JSON.stringify(await readRecoveryPackPdf(new Uint8Array(bytes))),
    ]) {
      expect(value).not.toContain(EMERGENCY.code);
      expect(value).not.toContain(EMERGENCY.address);
    }
  },
);

it("waits for Cloud before the backup turn or either write lock, then rechecks code authority", async () => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => (release = resolve));
  const requested = vi.fn(async () => {
    await gate;
    return EMERGENCY;
  });
  const enteredTurn = vi.fn();
  const queue = createTurns();
  const turns: Turns = (body) => {
    enteredTurn();
    return queue(body);
  };
  let primary = true;
  const pending = fixture({ cloud: cloudPack(requested, () => primary), turns }).make();
  try {
    await vi.waitFor(() => expect(requested).toHaveBeenCalledOnce());
    expect(enteredTurn).not.toHaveBeenCalled();
    await withTransaction(suite.db, async () => {
      primary = false;
    });
    expect(await withNodeTransaction(suite.node, async () => "written")).toBe("written");
  } finally {
    release();
  }
  const response = await pending;
  expect(response.status).toBe(200);
  expect(await pdfText(await response.arrayBuffer())).not.toContain(EMERGENCY.code);
  expect((await packs())[0]!.parts[0]).toEqual({ part: "emergency", state: "absent" });
});

it.each([
  "setting_off",
  "level_inactive",
  "no_payment_method",
  "not_provisioned",
  "unavailable",
  "rate_limited",
  "unknown",
] as const)("prints a usable partial pack when emergency is %s", async (reason) => {
  const closed = ["setting_off", "level_inactive", "no_payment_method", "not_provisioned"].includes(
    reason,
  );
  const response = await fixture({
    cloud: cloudPack(async () => {
      if (closed) throw new AppError("cloud.emergency_hosting_closed", { reason } as never);
      if (reason === "rate_limited")
        throw new AppError("cloud.emergency_code_rate_limited", { seconds: 99 });
      if (reason === "unknown") throw new Error("SECRET-error-message");
      throw new AppError("cloud.unavailable", {});
    }),
  }).make();
  expect(response.status).toBe(200);
  const text = await pdfText(await response.arrayBuffer());
  expect(text).not.toContain(EMERGENCY.code);
  expect(text).not.toContain("SECRET-error-message");
  expect(text).not.toContain("99 seconds");
  expect(text).toContain("new pack");
  const record = (await packs())[0]!;
  expect(record.parts[0]).toEqual({ part: "emergency", state: closed ? "absent" : "failed" });
  expect(record.parts.slice(1).map((p) => p.state)).toEqual(["included", "included", "included"]);
});

it.each(["disconnected", "secondary", "permission"] as const)(
  "omits the emergency code without fetching it when %s",
  async (reason) => {
    const fetchCode = vi.fn(async () => EMERGENCY);
    const cloud = cloudPack(fetchCode, () => reason !== "secondary");
    if (reason === "disconnected")
      cloud.connection.status = async () => ({ state: "not_connected", code: "" });
    if (reason === "permission") await setBuiltInRoleForTest(suite.db, admin.personId, "manager");
    const response = await fixture({ cloud }).make();
    expect(response.status).toBe(200);
    const text = await pdfText(await response.arrayBuffer());
    expect(text).not.toContain(EMERGENCY.code);
    expect(text).toContain(
      reason === "permission"
        ? "administrator"
        : reason === "secondary"
          ? "main box"
          : "not connected",
    );
    expect(fetchCode).not.toHaveBeenCalled();
    expect((await packs())[0]!.parts[0]).toEqual({ part: "emergency", state: "absent" });
  },
);

it.each(["code permission", "maker permission", "cancelled"] as const)(
  "rechecks %s after the Cloud wait before writing a pack or replacing a key",
  async (change) => {
    const controller = new AbortController();
    const before = await readRecoveryKeyVerifier(suite.node, node.nodeId);
    const code = async () => {
      if (change === "cancelled") controller.abort();
      else
        await setBuiltInRoleForTest(
          suite.db,
          admin.personId,
          change === "code permission" ? "manager" : "supervisor",
        );
      return EMERGENCY;
    };
    const response = await fixture({ cloud: cloudPack(code) }).make(true, {
      signal: controller.signal,
    });
    if (change === "code permission") {
      expect(response.status).toBe(200);
      expect(await pdfText(await response.arrayBuffer())).not.toContain(EMERGENCY.code);
      expect((await packs())[0]!.parts[0]).toEqual({ part: "emergency", state: "absent" });
    } else {
      expect(response.status).toBe(change === "cancelled" ? 500 : 403);
      if (change === "maker permission")
        expect((await codeOf(response)).code).toBe("authorization.not_permitted");
      expect(await packs()).toEqual([]);
      expect(await readRecoveryKeyVerifier(suite.node, node.nodeId)).toBe(before);
    }
  },
);

it("reads code status outside the write transaction and returns the printed issue date", async () => {
  const cloud = cloudPack();
  const f = fixture({ cloud });
  await (await f.make()).arrayBuffer();
  await f.received(1);
  const issued = "2026-10-30T09:00:30.000Z";
  let release!: () => void;
  const gate = new Promise<void>((resolve) => (release = resolve));
  const read = vi.fn(async () => {
    await gate;
    return {
      ...emergencyReply("installation", "venue", "2026-10-30T09:01:00.000Z"),
      emergency: {
        status: "ready",
        open: true,
        closedReason: null,
        address: EMERGENCY.address,
        codeIssuedAt: issued,
      },
      stale: false,
    } as EmergencyDisplay & { stale: boolean };
  });
  cloud.connection.emergency = read;
  const pending = f.status();
  try {
    await vi.waitFor(() => expect(read).toHaveBeenCalledOnce());
    expect(
      await Promise.race([
        withTransaction(suite.db, async () => "written"),
        new Promise((resolve) => setTimeout(() => resolve("waiting"), 1000)),
      ]),
    ).toBe("written");
  } finally {
    release();
  }
  const response = await pending;
  const value = await response.json();
  expect(value).toMatchObject({
    upToDate: false,
    reasons: [{ part: "emergency", kind: "code_changed", at: issued }],
  });
  expect(value.latest.parts[0]).toEqual({
    part: "emergency",
    state: "included",
    codeIssuedAt: EMERGENCY.codeIssuedAt,
  });
  expect(JSON.stringify(value)).not.toContain(EMERGENCY.code);
});

it("bounds a status read to eight seconds and reports an unknown code", async () => {
  const cloud = cloudPack();
  const f = fixture({ cloud });
  await (await f.make()).arrayBuffer();
  await f.received(1);
  const deadline = new AbortController();
  const timeout = vi.spyOn(AbortSignal, "timeout").mockReturnValue(deadline.signal);
  let rejectRead!: (error: unknown) => void;
  cloud.connection.emergency = vi.fn<typeof cloud.connection.emergency>(
    (_origin, signal) =>
      new Promise((_resolve, reject) => {
        rejectRead = reject;
        signal!.addEventListener("abort", () => reject(signal!.reason), { once: true });
      }),
  );
  const pending = f.status();
  try {
    await vi.waitFor(() => expect(rejectRead).toBeTypeOf("function"));
    expect(timeout).toHaveBeenCalledWith(8000);
    deadline.abort();
    const response = await Promise.race([
      pending,
      new Promise<null>((resolve) => setTimeout(() => resolve(null), 1000)),
    ]);
    expect(response).not.toBeNull();
    expect(await response!.json()).toMatchObject({
      upToDate: false,
      reasons: [{ part: "emergency", kind: "cannot_check" }],
    });
  } finally {
    rejectRead(new Error("test cleanup"));
    await pending;
    timeout.mockRestore();
  }
});

it("checks system.manage before contacting Cloud for pack status", async () => {
  const supervisor = await openManagementSession(suite.db, "supervisor");
  const cloud = cloudPack();
  const read = vi.fn(cloud.connection.emergency);
  cloud.connection.emergency = read;
  const response = await fixture({ cloud }).status(supervisor.token);
  expect(response.status).toBe(403);
  expect((await codeOf(response)).code).toBe("authorization.not_permitted");
  expect(read).not.toHaveBeenCalled();
});

it("refuses pack status when permission is removed during the Cloud read", async () => {
  const cloud = cloudPack();
  const read = cloud.connection.emergency;
  cloud.connection.emergency = async (...args) => {
    const answer = await read(...args);
    await setBuiltInRoleForTest(suite.db, admin.personId, "staff");
    return answer;
  };
  const response = await fixture({ cloud }).status();
  expect(response.status).toBe(403);
  expect((await codeOf(response)).code).toBe("authorization.not_permitted");
});
