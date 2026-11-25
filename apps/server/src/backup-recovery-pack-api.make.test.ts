import { storeArchivePart } from "./testing/backup-settings.js";
import { nodeHandoverEvents } from "@waitron/node-db";
import { ensureStreamId, withFoldedPersonChanges } from "@waitron/db";
import { setBuiltInRoleForTest } from "@waitron/identity/test/person-rows.js";
import { setFreshManagementSignIn } from "./testing/fresh-management-sign-in.js";
import { mountMeApi } from "./me-api.js";
import { Socket } from "node:net";
import { TLSSocket } from "node:tls";
import { eq, sql } from "drizzle-orm";
import { Hono } from "hono";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { afterEach, beforeEach, describe, expect, it, onTestFinished, vi } from "vitest";
import {
  loadKeyRing,
  masterKeyCheckValue,
  masterKeyName,
  sealingPublicKey,
} from "@waitron/credentials";
import {
  CORE_CHANGE_SOURCES,
  insertRecoveryPack,
  installChangeFeed,
  insertMasterKey,
  masterKeys,
  readCurrentMasterKey,
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
import { beginOwnPasskeyCheck, persons, webauthnCredentials } from "@waitron/identity";
import { verifyAuthenticationResponse } from "@simplewebauthn/server";
import { openManagementSession } from "@waitron/identity/test/fixtures.js";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import type { ProvisionedNode } from "@waitron/module";
import { PART_WORDS } from "@waitron/recovery-pack";
import { readRecoveryPackPdf } from "@waitron/recovery-pack/src/read-pack-pdf.js";
import {
  AppError,
  decodeMasterKeyCode,
  encodeMasterKeyCode,
  type ResourceIdentity,
} from "@waitron/shared";
import { parseRecoveryKit } from "@waitron/stream";
import { decodeArchiveRecoveryPack } from "./archive-recovery-pack.js";
import { writeArchiveSettings, type ArchiveSettings } from "./archive-settings.js";
import {
  mountBackupRecoveryPackMakeApi,
  type BackupRecoveryPackMakeDeps,
} from "./backup-recovery-pack-api.js";
import { createTurns, type Turns } from "./backup-turns.js";
import { loadRecoveryPackFonts } from "./invoice-font.js";
import { requestIdMiddleware } from "./request-id.js";
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
  cloud: false,
  destinations: [{ kind: "s3", id: "bucket", bucket: { ...BUCKET, prefix: "archives/" } }],
  schedule: { kind: "wall-clock", days: "daily", at: { hour: 3, minute: 30 } },
  retention: { count: 7, days: 30 },
  destinationTimeoutMs: 15 * 60 * 1000,
};
const suite = useVenueDb({ migrations: migrationOptionsFor(manifestSets(), null) });
let node: ProvisionedNode;
let admin: { personId: string; token: string };
let boxEnv: Record<string, string>;
let loadedKey: string | undefined;
const sockets: TLSSocket[] = [];
const logs: unknown[][] = [];

afterEach(() => {
  for (const socket of sockets.splice(0)) socket.destroy();
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
  await withTransaction(suite.db, async (tx) => {
    await ensureStreamId(tx);
    await writeStreamSettings(tx, RING, BUCKET, null);
    await writeArchiveSettings(tx, RING, ARCHIVES, null);
  });
  admin = await openManagementSession(suite.db, "admin");
  await withTransaction(suite.db, (tx) => setFreshManagementSignIn(tx, admin.token));
});

function fixture(
  options: {
    cloud?: BackupRecoveryPackMakeDeps["cloud"];
    remote?: boolean;
    turns?: Turns;
    now?: () => Date;
    loadFonts?: typeof loadRecoveryPackFonts;
    readBoxEnv?: () => Promise<Record<string, string | undefined>>;
    requestLog?: boolean;
  } = {},
) {
  const local = new Hono();
  if (options.requestLog === true)
    local.use(requestIdMiddleware((...values) => logs.push(values), Date.now));
  const app = options.remote
    ? createStaffApp(local, async () => "https://staff.example.test")
    : local;
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
      ring: RING,
      node,
      turns: options.turns ?? createTurns(),
      readBoxEnv: options.readBoxEnv ?? (async () => ({ ...boxEnv })),
      backups: () => ({
        schedule: ARCHIVES.schedule,
        retention: ARCHIVES.retention,
        recoveryKey: loadedKey,
      }),
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
      newMasterKey = false,
      extra: Parameters<typeof post>[2] = {},
      body: unknown = { locale: "en", newMasterKey },
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

async function firstPageText(bytes: ArrayBuffer): Promise<string> {
  const loading = getDocument({ data: new Uint8Array(bytes.slice(0)), useSystemFonts: false });
  try {
    const content = await (await (await loading.promise).getPage(1)).getTextContent();
    return content.items
      .flatMap((item) => ("str" in item ? [item.str] : []))
      .join(" ")
      .replace(/\s+/g, " ")
      .trim();
  } finally {
    await loading.destroy();
  }
}

const codeOf = async (response: Response) =>
  ((await response.json()) as { error: { code: string; params?: unknown } }).error;
const packs = () => readRecoveryPacks(suite.db, node.nodeId);
const storedMasterKeys = () => suite.db.select().from(masterKeys).orderBy(masterKeys.number);
const shownMasterKey = (response: Response) => ({
  masterKey: response.headers.get("x-waitron-master-key"),
  masterKeyName: decodeURIComponent(response.headers.get("x-waitron-master-key-name") ?? ""),
});

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
    ["an extra field", { locale: "en", newMasterKey: false, more: 1 }],
    ["an unknown language", { locale: "fr", newMasterKey: false }],
    ["a tick that is not a boolean", { locale: "en", newMasterKey: "yes" }],
    ["no language", { newMasterKey: false }],
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
    expect(await storedMasterKeys()).toEqual([]);
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
      expect(await storedMasterKeys()).toEqual([]);
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
      expect(await storedMasterKeys()).toEqual([]);
    },
  );

  it("refuses a person without system.manage before reading the box's settings file", async () => {
    const supervisor = await openManagementSession(suite.db, "supervisor");
    let reads = 0;
    const response = await fixture({
      readBoxEnv: async () => {
        reads++;
        return { ...boxEnv };
      },
    }).make(true, { token: supervisor.token });
    expect(response.status).toBe(403);
    expect(reads).toBe(0);
  });

  it("checks system.manage again after the box's settings file is read", async () => {
    const response = await fixture({
      readBoxEnv: async () => {
        await setBuiltInRoleForTest(suite.db, admin.personId, "staff");
        return { ...boxEnv };
      },
    }).make(true);
    expect(response.status).toBe(403);
    expect((await codeOf(response)).code).toBe("authorization.not_permitted");
    expect(await packs()).toEqual([]);
    expect(await storedMasterKeys()).toEqual([]);
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
    expect(response.headers.has("x-waitron-recovery-pack-key")).toBe(false);
    expect(response.headers.get("x-waitron-recovery-pack-made-at")).toBe(
      "2026-10-30T09:00:00.000Z",
    );
    const file = await readRecoveryPackPdf(new Uint8Array(await response.arrayBuffer()));
    expect(file.number).toBe(1);
    expect(file.madeAt).toBe("2026-10-30T09:00:00.000Z");
    expect(parseRecoveryKit(file.bucketCode!).recoveryKey).toBe(KEY);
    expect(decodeArchiveRecoveryPack(file.archiveCode!).recoveryKey).toBe(KEY);
    expect([file.serverKey, file.serverKeyName, file.serverKeyHeldBy]).toEqual([null, null, null]);
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
    ]);
    const stored = JSON.stringify(record);
    for (const secret of [KEY, BUCKET.secretAccessKey]) expect(stored).not.toContain(secret);
    expect((await f.make()).headers.get("x-waitron-recovery-pack")).toBe("2");
  });

  const oldMasterKey = {
    name: "2026-10-01 · AAAA",
    checkValue: "a".repeat(64),
    publicKey: Buffer.alloc(44, 1),
    madeAt: new Date("2026-10-01T09:00:00.000Z"),
    madeBy: null,
  };

  it("a refused master_keys save writes no pack and keeps the old master key current", async () => {
    await withTransaction(suite.db, (tx) => insertMasterKey(tx, oldMasterKey));
    suite.db.run(
      sql`create trigger refuse_master_key before insert on master_keys begin select raise(abort, 'refused'); end`,
    );
    let refused: Response;
    try {
      refused = await fixture().make(true);
    } finally {
      suite.db.run(sql`drop trigger refuse_master_key`);
    }
    expect(refused.status).toBe(500);
    expect(await refused.json()).toEqual({ error: { code: "server.internal" } });
    expect(refused.headers.has("x-waitron-master-key")).toBe(false);
    expect(await packs()).toEqual([]);
    expect(await storedMasterKeys()).toMatchObject([{ number: 1, name: oldMasterKey.name }]);
    const retried = await fixture().make(true);
    expect(retried.status).toBe(200);
    expect(await storedMasterKeys()).toMatchObject([
      { number: 1, name: oldMasterKey.name },
      { number: 2, name: shownMasterKey(retried).masterKeyName, madeBy: admin.personId },
    ]);
    expect(await packs()).toMatchObject([{ number: 1 }]);
  });

  it("a refused pack save writes no master key and keeps the old master key current", async () => {
    await withTransaction(suite.db, (tx) => insertMasterKey(tx, oldMasterKey));
    suite.db.run(
      sql`create trigger refuse_pack before insert on recovery_packs begin select raise(abort, 'refused'); end`,
    );
    let refused: Response;
    try {
      refused = await fixture().make(true);
    } finally {
      suite.db.run(sql`drop trigger refuse_pack`);
    }
    expect(refused.status).toBe(500);
    expect(await refused.json()).toEqual({ error: { code: "server.internal" } });
    expect(refused.headers.has("x-waitron-master-key")).toBe(false);
    expect(await packs()).toEqual([]);
    expect(await storedMasterKeys()).toEqual([
      expect.objectContaining({ number: 1, name: oldMasterKey.name }),
    ]);
    expect(await withTransaction(suite.db, (tx) => readCurrentMasterKey(tx))).toMatchObject({
      name: oldMasterKey.name,
    });
  });

  it("Make a new master key writes its pack and its master_keys row, and nothing in node.db", async () => {
    const boxRows = () => suite.node.all(sql`select * from box`);
    const handoverEvents = () => suite.node.select().from(nodeHandoverEvents);
    const [boxBefore, eventsBefore] = [boxRows(), await handoverEvents()];
    const response = await fixture().make(true);
    expect(response.status).toBe(200);
    const shown = shownMasterKey(response);
    await response.arrayBuffer();
    expect(await packs()).toMatchObject([{ number: 1, madeBy: admin.personId }]);
    expect(await storedMasterKeys()).toMatchObject([
      { number: 1, name: shown.masterKeyName, madeBy: admin.personId },
    ]);
    expect(boxRows()).toEqual(boxBefore);
    expect(await handoverEvents()).toEqual(eventsBefore);
  });

  it.each([true, false])(
    "a pack has no server-key part and no box-key page (new master key %s)",
    async (newMasterKey) => {
      const response = await fixture().make(newMasterKey);
      expect(response.status).toBe(200);
      expect(response.headers.has("x-waitron-recovery-pack-key")).toBe(false);
      const bytes = await response.arrayBuffer();
      const file = await readRecoveryPackPdf(new Uint8Array(bytes));
      expect([file.serverKey, file.serverKeyName, file.serverKeyHeldBy]).toEqual([
        null,
        null,
        null,
      ]);
      const text = await pdfText(bytes);
      expect(text).not.toMatch(/server key|box key/i);
      const [record] = await packs();
      expect(record!.parts.map((p) => p.part)).toEqual(["emergency", "bucket", "archives"]);
    },
  );

  it("Make a new master key answers the master key it saved", async () => {
    const f = fixture();
    const response = await f.make(true);
    const { masterKey, masterKeyName: name } = shownMasterKey(response);
    const bytes = decodeMasterKeyCode(masterKey!);
    expect(masterKey).toBe(encodeMasterKeyCode(bytes));
    const publicKey = sealingPublicKey(bytes);
    expect(name).toBe(masterKeyName(publicKey, "2026-10-30"));
    expect(await storedMasterKeys()).toEqual([
      {
        number: 1,
        name,
        checkValue: masterKeyCheckValue(bytes),
        publicKey: new Uint8Array(publicKey),
        madeAt: new Date("2026-10-30T09:00:00.000Z"),
        madeBy: admin.personId,
      },
    ]);
    expect(JSON.stringify(logs)).not.toContain(masterKey!.slice(0, 9));
    const again = shownMasterKey(await f.make(true));
    const rows = await storedMasterKeys();
    expect(rows.map((row) => [row.number, row.name])).toEqual([
      [1, name],
      [2, again.masterKeyName],
    ]);
  });

  it("the request log line for Make a new master key does not carry the key", async () => {
    const response = await fixture({ requestLog: true }).make(true);
    const masterKey = response.headers.get("x-waitron-master-key")!;
    expect(masterKey).toMatch(/^(?:\S{4} ){6}\S{4}$/);
    const requestLines = logs.filter(([, event]) => event === "http.request");
    expect(requestLines).toMatchObject([
      [expect.any(String), "http.request", { routePath: "/api/backup/recovery-pack", status: 200 }],
    ]);
    const logged = JSON.stringify(logs);
    expect(logged).not.toContain(masterKey.slice(0, 9));
    expect(logged).not.toContain(masterKey.replaceAll(" ", "").slice(0, 8));
  });

  it("a plain pack makes no master key", async () => {
    const response = await fixture().make(false);
    expect(response.status).toBe(200);
    expect(response.headers.has("x-waitron-master-key")).toBe(false);
    expect(await storedMasterKeys()).toEqual([]);
  });

  it("Make a new master key's pack shows the master key", async () => {
    const response = await fixture().make(true);
    const shown = shownMasterKey(response);
    const bytes = await response.arrayBuffer();
    const file = await readRecoveryPackPdf(new Uint8Array(bytes));
    expect([file.masterKey, file.masterKeyName, file.masterKeyHeldBy]).toEqual([
      shown.masterKey,
      shown.masterKeyName,
      null,
    ]);
    expect(await firstPageText(bytes)).toBe(
      `Waitron recovery pack · Sala Master key · ${shown.masterKeyName} ${shown.masterKey} Master key`,
    );
  });

  it("a pack made without a new master key names the pack that holds the current one", async () => {
    const f = fixture();
    const first = shownMasterKey(await f.make(true));
    const plain = await f.make(false);
    expect(plain.headers.get("x-waitron-recovery-pack")).toBe("2");
    const bytes = await plain.arrayBuffer();
    const file = await readRecoveryPackPdf(new Uint8Array(bytes));
    expect([file.masterKey, file.masterKeyName, file.masterKeyHeldBy]).toEqual([
      null,
      first.masterKeyName,
      1,
    ]);
    expect(await firstPageText(bytes)).toBe(
      `Waitron recovery pack · Sala Master key ${first.masterKeyName}: in pack 1`,
    );
    expect(await pdfText(bytes)).not.toContain(first.masterKey!);
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
        ],
      },
    ]);
    await withTransaction(suite.db, (tx) => storeArchivePart(tx, {}));
    const failing = await fixture().make();
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
        ],
      },
    ]);
    const cloudFailing = await fixture({
      cloud: cloudPack(async () => {
        throw new Error("could not read /home/jane-doe/cloud.json");
      }),
    }).make();
    expect(cloudFailing.status).toBe(200);
    expect(logs).toContainEqual([
      "info",
      "recovery.pack_made",
      expect.objectContaining({
        number: 3,
        parts: expect.arrayContaining([
          { part: "emergency", state: "failed", failedWith: "unexpected" },
        ]),
      }),
    ]);
    const seen = JSON.stringify([
      logs,
      [...response.headers],
      [...failing.headers],
      [...cloudFailing.headers],
    ]);
    for (const value of [
      KEY,
      BUCKET.secretAccessKey,
      file.bucketCode!,
      file.archiveCode!,
      "jane-doe",
    ])
      expect(seen).not.toContain(value);
  });

  it("a pack that cannot be drawn writes no record and no master key", async () => {
    const response = await fixture({
      loadFonts: async () => {
        throw new Error("font missing");
      },
    }).make(true);
    expect(response.status).toBe(500);
    expect(await packs()).toEqual([]);
    expect(await storedMasterKeys()).toEqual([]);
  });

  it("makes two packs asked for at once one after the other, the later one's master key current", async () => {
    let active = 0;
    let peak = 0;
    let entered = 0;
    let bothIn!: () => void;
    const together = new Promise<void>((resolve) => (bothIn = resolve));
    const f = fixture({
      readBoxEnv: async () => {
        active++;
        peak = Math.max(peak, active);
        if (++entered === 2) bothIn();
        // Long enough for the other request's sign-in check to finish, were they not taking turns.
        await Promise.race([together, new Promise((resolve) => setTimeout(resolve, 500))]);
        active--;
        return { ...boxEnv };
      },
    });
    const replies = await Promise.all([f.make(true), f.make(true)]);
    expect(replies.map((reply) => reply.status)).toEqual([200, 200]);
    expect(peak).toBe(1);
    const files = await Promise.all(
      replies.map(async (reply) => readRecoveryPackPdf(new Uint8Array(await reply.arrayBuffer()))),
    );
    const later = files.find((file) => file.number === 2)!;
    expect((await storedMasterKeys()).at(-1)!.name).toBe(later.masterKeyName);
  });

  it("takes the backup key from the box's settings file, never the key the backups loaded", async () => {
    boxEnv = {};
    const response = await fixture().make();
    expect(response.status).toBe(200);
    expect((await packs())[0]!.parts.map((p) => [p.part, p.state])).toEqual([
      ["emergency", "absent"],
      ["bucket", "failed"],
      ["archives", "failed"],
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
    unreceived: { number: number } | null;
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

  it("names the current master key and the pack that showed it, which a plain make does not change", async () => {
    let at = Date.parse("2026-10-30T09:00:00.000Z");
    const f = fixture({ now: () => new Date((at += 60_000)) });
    expect(await read(f)).toMatchObject({ masterKey: null });
    const response = await f.make(true);
    const name = decodeURIComponent(response.headers.get("x-waitron-master-key-name")!);
    await response.arrayBuffer();
    expect(await read(f)).toMatchObject({ masterKey: { name, pack: 1 } });
    await (await f.make(false)).arrayBuffer();
    expect(await read(f)).toMatchObject({ masterKey: { name, pack: 1 } });
  });

  it("still names the unconfirmed pack that showed the master key after a later plain pack is received", async () => {
    let at = Date.parse("2026-10-30T09:00:00.000Z");
    const f = fixture({ now: () => new Date((at += 60_000)) });
    await (await f.make(true)).arrayBuffer();
    await (await f.make(false)).arrayBuffer();
    expect((await f.received(2)).status).toBe(204);
    expect(await read(f)).toMatchObject({
      latest: { number: 2, received: true },
      unreceived: { number: 1, holdsCurrentMasterKey: true },
      masterKey: { pack: 1 },
    });
  });

  it("names the received pack that showed the master key once a later plain pack is made, and adds no keep entry for it", async () => {
    let at = Date.parse("2026-10-30T09:00:00.000Z");
    const f = fixture({ now: () => new Date((at += 60_000)) });
    await (await f.make(true)).arrayBuffer();
    expect((await f.received(1)).status).toBe(204);
    await (await f.make(false)).arrayBuffer();
    expect((await f.received(2)).status).toBe(204);
    expect(await read(f)).toMatchObject({ unreceived: null, keep: [], masterKey: { pack: 1 } });
  });

  it("names no pack for a master key when a plain pack was made at the same instant as the pack that showed it", async () => {
    const f = fixture({ now: () => new Date("2026-10-30T09:00:00.000Z") });
    const response = await f.make(true);
    const name = decodeURIComponent(response.headers.get("x-waitron-master-key-name")!);
    await response.arrayBuffer();
    await (await f.make(false)).arrayBuffer();
    const third = await f.make(false);
    expect(third.headers.get("x-waitron-recovery-pack")).toBe("3");
    const file = await readRecoveryPackPdf(new Uint8Array(await third.arrayBuffer()));
    expect([file.masterKey, file.masterKeyName, file.masterKeyHeldBy]).toEqual([null, name, null]);
    expect(await read(f)).toMatchObject({ masterKey: { name, pack: null } });
  });

  it("names no pack for a master key no pack on this box showed", async () => {
    await withTransaction(suite.db, (tx) =>
      insertMasterKey(tx, {
        name: "2026-10-01 · AAAA",
        checkValue: "a".repeat(64),
        publicKey: Buffer.alloc(44, 1),
        madeAt: new Date("2026-10-01T09:00:00.000Z"),
        madeBy: null,
      }),
    );
    expect(await read(fixture())).toMatchObject({
      masterKey: { name: "2026-10-01 · AAAA", pack: null },
    });
  });

  it("names the day the old pack is kept until if a new master key is made now", async () => {
    // Daily archives keeping 7: the last one made before now is gone 8 days from now.
    expect(await read(fixture())).toMatchObject({ keepOldPackUntil: "2026-11-07T09:00:00.000Z" });
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
      { locale, newMasterKey: false },
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
  if (closed) expect(text).toContain("Page 2 of 3");
  else expect(text).toContain("new pack");
  const record = (await packs())[0]!;
  expect(record.parts[0]).toEqual({ part: "emergency", state: closed ? "absent" : "failed" });
  expect(record.parts.slice(1).map((p) => p.state)).toEqual(["included", "included"]);
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
    expect(text).toContain("Page 2 of 3");
    expect(text).not.toContain("Emergency start");
    expect(fetchCode).not.toHaveBeenCalled();
    expect((await packs())[0]!.parts[0]).toEqual({ part: "emergency", state: "absent" });
  },
);

it.each(["code permission", "maker permission", "cancelled"] as const)(
  "rechecks %s after the Cloud wait before writing a pack or a master key",
  async (change) => {
    const controller = new AbortController();
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
      expect(await storedMasterKeys()).toEqual([]);
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
