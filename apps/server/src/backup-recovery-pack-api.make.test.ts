import { storeArchivePart } from "./testing/backup-settings.js";
import { nodeHandoverEvents } from "@waitron/node-db";
import { withFoldedPersonChanges } from "@waitron/db";
import { setBuiltInRoleForTest } from "@waitron/identity/test/person-rows.js";
import { setFreshManagementSignIn } from "./testing/fresh-management-sign-in.js";
import { mountMeApi } from "./me-api.js";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { TLSSocket } from "node:tls";
import { eq, sql } from "drizzle-orm";
import { Hono } from "hono";
import { createCanvas } from "@napi-rs/canvas";
import jsQR from "jsqr";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { afterEach, beforeEach, describe, expect, it, onTestFinished, vi } from "vitest";
import {
  makeMasterKey,
  masterKeyCheckValue,
  masterKeyName,
  sealingPublicKey,
} from "@waitron/credentials";
import {
  CORE_CHANGE_SOURCES,
  insertRecoveryPack,
  installChangeFeed,
  insertMasterKey,
  markRecoveryPackReceived,
  masterKeys,
  readCurrentMasterKey,
  readRecoveryPacks,
  removeChangeFeed,
  subscribeToChanges,
  withTransaction,
  withNodeTransaction,
} from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { beginOwnPasskeyCheck, persons, webauthnCredentials } from "@waitron/identity";
import { verifyAuthenticationResponse } from "@simplewebauthn/server";
import { openManagementSession } from "@waitron/identity/test/fixtures.js";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import type { ProvisionedNode } from "@waitron/module";
import { PACK_WORDS } from "@waitron/recovery-pack";
import { readRecoveryPackPdf } from "@waitron/recovery-pack/src/read-pack-pdf.js";
import {
  AppError,
  decodeMasterKeyCode,
  encodeMasterKeyCode,
  type ResourceIdentity,
} from "@waitron/shared";
import { parseRecoveryKit } from "@waitron/stream";
import { writeArchiveSettings, type ArchiveSettings } from "./archive-settings.js";
import {
  mountBackupRecoveryPackMakeApi,
  type BackupRecoveryPackMakeDeps,
} from "./backup-recovery-pack-api.js";
import { makeMasterKeyRecoveryPack } from "./backup-recovery-pack-output.js";
import { createTurns, type Turns } from "./backup-turns.js";
import { saveNewMasterKey } from "./master-key-record.js";
import { mintMasterKey, WRONG_MASTER_KEY } from "./testing/master-key.js";
import { makeNewMasterKey } from "@waitron/provisioning";
import { WaitingMasterKeyHolder } from "./waiting-master-key.js";
import { loadRecoveryPackFonts } from "./invoice-font.js";
import { requestIdMiddleware } from "./request-id.js";
import { TOTP_KEY_RING } from "./testing/authenticator.js";
import {
  PACK_ARCHIVES,
  PACK_BUCKET,
  PACK_RING,
  packRequests,
  type PackPostOptions,
  seedPackVenue,
} from "./testing/recovery-pack-make.js";
import { emergencyReply } from "../test/cloud-emergency-fixture.js";
import type { EmergencyDisplay } from "./cloud-emergency.js";
import { createStaffApp } from "./cloud-remote.js";

vi.mock("@simplewebauthn/server", async (original) => ({
  ...(await original<typeof import("@simplewebauthn/server")>()),
  verifyAuthenticationResponse: vi.fn(),
}));

const RING = PACK_RING;
const KEY = "recovery-key-recognisable-SECRET";
const BUCKET = PACK_BUCKET;
const ARCHIVES = PACK_ARCHIVES;
const suite = useVenueDb({ migrations: migrationOptionsFor(manifestSets(), null) });
let node: ProvisionedNode;
let admin: { personId: string; token: string };
let boxEnv: Record<string, string>;
let loadedKey: string | undefined;
/** Where a new master key's backup key is written; the fixture's `readBoxEnv` does not read it. */
let stateDir: string;
const sockets: TLSSocket[] = [];
const logs: unknown[][] = [];

afterEach(async () => {
  for (const socket of sockets.splice(0)) socket.destroy();
  await rm(stateDir, { recursive: true, force: true });
});

beforeEach(async () => {
  logs.length = 0;
  stateDir = await mkdtemp(join(tmpdir(), "pack-make-state-"));
  boxEnv = {
    WAITRON_BACKUP_RECOVERY_KEY: KEY,
    WAITRON_BACKUP_KEY_ROTATED_AT: "2026-09-20T08:00:00.000Z",
  };
  loadedKey = KEY;
  heldKey = undefined;
  ({ node, admin } = await seedPackVenue(suite.db));
});

let heldKey: string | undefined;
const KEY_MADE = new Date("2026-10-01T09:00:00.000Z");
/** Prints with the venue's current master key, made before this test's first pack. */
async function print(f: ReturnType<typeof fixture>, extra: PackPostOptions = {}) {
  heldKey ??= (await mintMasterKey(suite.db, { madeAt: KEY_MADE })).secret;
  return f.make(heldKey, extra);
}

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
      waitingMasterKey: new WaitingMasterKeyHolder(),
      readBoxEnv: options.readBoxEnv ?? (async () => ({ ...boxEnv })),
      backups: () => ({
        schedule: ARCHIVES.schedule,
        retention: ARCHIVES.retention,
        recoveryKey: loadedKey,
      }),
      loadFonts: options.loadFonts ?? loadRecoveryPackFonts,
      now: options.now ?? (() => new Date("2026-10-30T09:00:00.000Z")),
      stateDir,
      stream: { reload: async (write) => void (await write?.()) },
      sealedState: { refresh: async () => "sealed" },
      reloadBackups: async () => {},
    },
    (...values) => logs.push(values),
  );
  return packRequests(app, {
    token: () => admin.token,
    sockets,
    host: options.remote ? "staff.example.test" : "box.test",
  });
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
  const response = await remote.make(true);
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
    const read = vi.fn(async () => display());
    const response = await fixture({ cloud: cloudPack(read) }).make(true, extra);
    expect(read).not.toHaveBeenCalled();
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
    ["an extra field", { locale: "en", newMasterKey: true, more: 1 }],
    ["an unknown language", { locale: "fr", newMasterKey: true }],
    ["a tick that is not a boolean", { locale: "en", newMasterKey: "yes" }],
    ["no language", { newMasterKey: true }],
    ["`newMasterKey: false`", { locale: "en", newMasterKey: false }],
    ["a master key that is not text", { locale: "en", masterKey: 42 }],
    ["a master key and a new one", { locale: "en", masterKey: "ABCD", newMasterKey: true }],
    ["neither a master key nor a new one", { locale: "en" }],
  ])("refuses %s as the request's shape", async (_name, body) => {
    const response = await fixture().make(true, {}, body);
    expect(response.status).toBe(400);
    expect(await codeOf(response)).toEqual({
      code: "recovery.pack_invalid",
      params: { reason: "shape" },
    });
    expect(await packs()).toEqual([]);
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
    const response = await print(f);
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
    for (const key of ["serverKey", "serverKeyName", "serverKeyHeldBy", "archiveCode", "backupKey"])
      expect(file).not.toHaveProperty(key);
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
      ["master-key", "included"],
    ]);
    const stored = JSON.stringify(record);
    for (const secret of [KEY, BUCKET.secretAccessKey, heldKey!])
      expect(stored).not.toContain(secret);
    expect((await print(f)).headers.get("x-waitron-recovery-pack")).toBe("2");
  });

  const oldMasterKey = {
    name: "2026-10-01 · AAAA",
    checkValue: "a".repeat(64),
    publicKey: Buffer.alloc(44, 1),
    madeAt: new Date("2026-10-01T09:00:00.000Z"),
    madeBy: null,
  };

  it("a refused master_keys save leaves the pack unreceived and the old master key current", async () => {
    await withTransaction(suite.db, (tx) => insertMasterKey(tx, oldMasterKey));
    const f = fixture();
    const made = await f.make(true);
    expect(made.status).toBe(200);
    await made.arrayBuffer();
    suite.db.run(
      sql`create trigger refuse_master_key before insert on master_keys begin select raise(abort, 'refused'); end`,
    );
    let refused: Response;
    try {
      refused = await f.confirm(made);
    } finally {
      suite.db.run(sql`drop trigger refuse_master_key`);
    }
    expect(refused.status).toBe(500);
    expect(await refused.json()).toEqual({ error: { code: "server.internal" } });
    expect(await packs()).toMatchObject([{ number: 1, receivedAt: null }]);
    expect(await storedMasterKeys()).toMatchObject([{ number: 1, name: oldMasterKey.name }]);
    const retried = await f.confirm(made);
    expect(retried.status).toBe(204);
    const shown = shownMasterKey(made);
    expect(await storedMasterKeys()).toMatchObject([
      { number: 1, name: oldMasterKey.name },
      {
        number: 2,
        name: shown.masterKeyName,
        madeBy: admin.personId,
        checkValue: masterKeyCheckValue(decodeMasterKeyCode(shown.masterKey!)),
      },
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

  it("Make a new master key writes its pack, its confirm the master_keys row, and neither anything in node.db", async () => {
    const boxRows = () => suite.node.all(sql`select * from box`);
    const handoverEvents = () => suite.node.select().from(nodeHandoverEvents);
    const [boxBefore, eventsBefore] = [boxRows(), await handoverEvents()];
    const f = fixture();
    const response = await f.make(true);
    expect(response.status).toBe(200);
    const shown = shownMasterKey(response);
    await response.arrayBuffer();
    expect(await packs()).toMatchObject([{ number: 1, madeBy: admin.personId }]);
    expect((await f.confirm(response)).status).toBe(204);
    expect(await storedMasterKeys()).toMatchObject([
      { number: 1, name: shown.masterKeyName, madeBy: admin.personId },
    ]);
    expect(boxRows()).toEqual(boxBefore);
    expect(await handoverEvents()).toEqual(eventsBefore);
  });

  it.each([true, false])(
    "a pack has no server-key part and no box-key page (new master key %s)",
    async (newMasterKey) => {
      const response = newMasterKey ? await fixture().make(true) : await print(fixture());
      expect(response.status).toBe(200);
      expect(response.headers.has("x-waitron-recovery-pack-key")).toBe(false);
      const bytes = await response.arrayBuffer();
      const file = await readRecoveryPackPdf(new Uint8Array(bytes));
      for (const key of ["serverKey", "serverKeyName", "serverKeyHeldBy"])
        expect(file).not.toHaveProperty(key);
      const text = await pdfText(bytes);
      expect(text).not.toMatch(/server key|box key/i);
      const [record] = await packs();
      expect(record!.parts.map((p) => p.part)).toEqual(["emergency", "bucket", "master-key"]);
    },
  );

  it("Make a new master key answers the key that its confirm saves", async () => {
    const f = fixture();
    const response = await f.make(true);
    const { masterKey, masterKeyName: name } = shownMasterKey(response);
    expect((await f.confirm(response)).status).toBe(204);
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
    const againResponse = await f.make(true);
    expect((await f.confirm(againResponse)).status).toBe(204);
    const again = shownMasterKey(againResponse);
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

  it("Print's answer has no master-key headers, and Print makes no master key", async () => {
    const response = await print(fixture());
    expect(response.status).toBe(200);
    expect(response.headers.has("x-waitron-master-key")).toBe(false);
    expect(response.headers.has("x-waitron-master-key-name")).toBe(false);
    expect(await storedMasterKeys()).toHaveLength(1);
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

  it("Print with the master key makes the next pack with the same key name, and the status names it", async () => {
    let at = Date.parse("2026-10-30T09:00:00.000Z");
    const f = fixture({ now: () => new Date((at += 60_000)) });
    const firstResponse = await f.make(true);
    expect((await f.confirm(firstResponse)).status).toBe(204);
    const first = shownMasterKey(firstResponse);
    // Typed as a person might: lower case, without its spaces.
    const typed = first.masterKey!.replaceAll(" ", "").toLowerCase();
    const printed = await f.make(typed);
    expect(printed.status).toBe(200);
    expect(printed.headers.get("x-waitron-recovery-pack")).toBe("2");
    const bytes = await printed.arrayBuffer();
    const file = await readRecoveryPackPdf(new Uint8Array(bytes));
    expect([file.masterKey, file.masterKeyName, file.masterKeyHeldBy]).toEqual([
      first.masterKey,
      first.masterKeyName,
      null,
    ]);
    expect(await firstPageText(bytes)).toBe(
      `Waitron recovery pack · Sala Master key · ${first.masterKeyName} ${first.masterKey} Master key`,
    );
    expect(await storedMasterKeys()).toMatchObject([{ number: 1, name: first.masterKeyName }]);
    // The confirm marked pack 1 received, and a received pack is named over an unreceived Print.
    expect((await f.received(2)).status).toBe(204);
    expect(await (await f.status()).json()).toMatchObject({
      masterKey: { name: first.masterKeyName, pack: 2 },
    });
  });

  it("a wrong key prints nothing, writes no row and names the key", async () => {
    const f = fixture();
    const made = await f.make(true);
    expect((await f.confirm(made)).status).toBe(204);
    const first = shownMasterKey(made);
    const response = await f.make(WRONG_MASTER_KEY);
    expect(response.status).toBe(403);
    expect(response.headers.get("content-type")).not.toBe("application/pdf");
    expect(await codeOf(response)).toEqual({
      code: "promotion.break_glass_invalid",
      params: { keyName: first.masterKeyName },
    });
    expect(await packs()).toMatchObject([{ number: 1 }]);
    expect(await storedMasterKeys()).toHaveLength(1);
  });

  it.each(["not a master key", "", " ".repeat(40)])(
    "a malformed key (%j) is refused as a wrong one",
    async (typed) => {
      const f = fixture();
      const made = await f.make(true);
      expect((await f.confirm(made)).status).toBe(204);
      const first = shownMasterKey(made);
      const response = await f.make(typed);
      expect(response.status).toBe(403);
      expect(await codeOf(response)).toEqual({
        code: "promotion.break_glass_invalid",
        params: { keyName: first.masterKeyName },
      });
      expect(await packs()).toMatchObject([{ number: 1 }]);
    },
  );

  it("with no master key, Print is refused with no key name", async () => {
    const response = await fixture().make(WRONG_MASTER_KEY);
    expect(response.status).toBe(403);
    expect(await codeOf(response)).toEqual({ code: "promotion.break_glass_invalid", params: {} });
    expect(await packs()).toEqual([]);
    expect(await storedMasterKeys()).toEqual([]);
  });

  it("Print takes the live-operation limiter's turn: a third print while two are being made is refused", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    let reads = 0;
    const f = fixture({
      readBoxEnv: async () => {
        reads += 1;
        await gate;
        return { ...boxEnv };
      },
    });
    const key = (await mintMasterKey(suite.db)).secret;
    const held = [f.make(key), f.make(key)];
    let third: Promise<Response> | Response | undefined;
    try {
      await vi.waitFor(() => expect(reads).toBe(1));
      third = f.make(key);
      // Without the limiter the third print waits for the held turn, which only `release` ends.
      const answered = await Promise.race([
        third,
        new Promise<"still waiting">((resolve) =>
          setTimeout(() => resolve("still waiting"), 5_000),
        ),
      ]);
      expect(answered).not.toBe("still waiting");
      const refused = answered as Response;
      expect(refused.status).toBe(429);
      expect((await codeOf(refused)).code).toBe("recovery.rate_limited");
    } finally {
      release();
      await third;
    }
    expect((await Promise.all(held)).map((r) => r.status)).toEqual([200, 200]);
    expect(await packs()).toHaveLength(2);
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
    const making = print(fixture({ turns, readBoxEnv }));
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
    const f = fixture();
    const response = await f.make(true);
    const file = await readRecoveryPackPdf(new Uint8Array(await response.arrayBuffer()));
    expect((await f.confirm(response)).status).toBe(204);
    expect(logs).toContainEqual([
      "info",
      "recovery.pack_made",
      {
        personId: admin.personId,
        number: 1,
        parts: [
          { part: "emergency", state: "absent" },
          { part: "bucket", state: "included" },
          { part: "master-key", state: "included" },
        ],
      },
    ]);
    boxEnv = { ...boxEnv, WAITRON_BACKUP_RECOVERY_KEY: "short" };
    const failing = await fixture().make(file.masterKey!);
    expect(failing.status).toBe(200);
    expect(logs).toContainEqual([
      "info",
      "recovery.pack_made",
      {
        personId: admin.personId,
        number: 2,
        parts: [
          { part: "emergency", state: "absent" },
          { part: "bucket", state: "failed", failedWith: "backup.recovery_key_too_short" },
          { part: "master-key", state: "included" },
        ],
      },
    ]);
    const cloudFailing = await fixture({
      cloud: cloudPack(async () => {
        throw new Error("could not read /home/jane-doe/cloud.json");
      }),
    }).make(file.masterKey!);
    expect(cloudFailing.status).toBe(200);
    expect(logs).toContainEqual([
      "info",
      "recovery.pack_made",
      expect.objectContaining({
        number: 3,
        parts: expect.arrayContaining([{ part: "emergency", state: "absent" }]),
      }),
    ]);
    const seen = JSON.stringify([
      logs,
      [...response.headers],
      [...failing.headers],
      [...cloudFailing.headers],
    ]);
    for (const value of [KEY, BUCKET.secretAccessKey, file.bucketCode!, "jane-doe"])
      expect(seen).not.toContain(value);
    const printed = JSON.stringify([logs, [...failing.headers], [...cloudFailing.headers]]);
    expect(printed).not.toContain(file.masterKey!);
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
    const laterReply = replies.find(
      (reply) => reply.headers.get("x-waitron-recovery-pack") === "2",
    )!;
    expect((await f.confirm(laterReply)).status).toBe(204);
    expect((await storedMasterKeys()).at(-1)!.name).toBe(later.masterKeyName);
  });

  it("takes the backup key from the box's settings file, never the key the backups loaded", async () => {
    boxEnv = {};
    const response = await print(fixture());
    expect(response.status).toBe(200);
    expect((await packs())[0]!.parts.map((p) => [p.part, p.state])).toEqual([
      ["emergency", "absent"],
      ["bucket", "failed"],
      ["master-key", "included"],
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
    await (await print(f)).arrayBuffer();
    return f;
  }
  const receivedAt = async () => (await packs())[0]!.receivedAt;

  it("the request log lines for a confirm, refused or taken, do not carry the key it sends", async () => {
    const f = fixture({ requestLog: true });
    const response = await f.make(true);
    await response.arrayBuffer();
    const masterKey = response.headers.get("x-waitron-master-key")!;
    const wrong = encodeMasterKeyCode(makeMasterKey());
    expect((await f.received(1, {}, { masterKey: wrong })).status).toBe(400);
    expect((await f.confirm(response)).status).toBe(204);
    const route = "/api/backup/recovery-pack/:number/received";
    expect(logs.filter(([, event]) => event === "http.request")).toMatchObject([
      [expect.any(String), "http.request", { routePath: "/api/backup/recovery-pack", status: 200 }],
      [expect.any(String), "http.request", { routePath: route, status: 400 }],
      [expect.any(String), "http.request", { routePath: route, status: 204 }],
    ]);
    const logged = JSON.stringify(logs);
    for (const sent of [masterKey, wrong]) {
      expect(logged).not.toContain(sent.slice(0, 9));
      expect(logged).not.toContain(sent.replaceAll(" ", "").slice(0, 8));
    }
  });

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
      const made = await f.make(true);
      await made.arrayBuffer();
      afterMake = [...seen];
      expect((await f.confirm(made)).status).toBe(204);
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

  /** A row written before packs recorded the master key: it has no `master-key` entry. */
  const olderPack = (number: number, madeAt: Date, receivedAt: Date | null = null) =>
    withTransaction(suite.db, async (tx) => {
      await insertRecoveryPack(tx, {
        nodeId: node.nodeId,
        number,
        madeAt,
        madeBy: null,
        parts: [
          { part: "bucket", state: "not-set-up" },
          { part: "archives", state: "not-set-up" },
        ],
      });
      if (receivedAt !== null) await markRecoveryPackReceived(tx, node.nodeId, number, receivedAt);
    });

  it("names the current master key and the newest pack that showed it", async () => {
    let at = Date.parse("2026-10-30T09:00:00.000Z");
    const f = fixture({ now: () => new Date((at += 60_000)) });
    expect(await read(f)).toMatchObject({ masterKey: null });
    const response = await f.make(true);
    const name = decodeURIComponent(response.headers.get("x-waitron-master-key-name")!);
    await response.arrayBuffer();
    expect((await f.confirm(response)).status).toBe(204);
    expect(await read(f)).toMatchObject({ masterKey: { name, pack: 1 } });
    await (await f.make(shownMasterKey(response).masterKey!)).arrayBuffer();
    expect((await f.received(2)).status).toBe(204);
    expect(await read(f)).toMatchObject({ masterKey: { name, pack: 2 } });
  });

  it("names a Print made after the box's clock moved back as the pack holding the master key", async () => {
    let at = Date.parse("2026-10-30T14:00:00.000Z");
    const f = fixture({ now: () => new Date(at) });
    const response = await f.make(true);
    const { masterKey, masterKeyName: name } = shownMasterKey(response);
    await response.arrayBuffer();
    expect((await f.confirm(response)).status).toBe(204);
    at = Date.parse("2026-10-30T13:01:00.000Z");
    await (await f.make(masterKey!)).arrayBuffer();
    expect((await f.received(2)).status).toBe(204);
    expect((await packs()).map((p) => [p.madeAt.toISOString(), p.parts.at(-1)])).toEqual([
      [
        "2026-10-30T13:01:00.000Z",
        { part: "master-key", state: "included", masterKeyNumber: 1, masterKeyName: name },
      ],
      [
        "2026-10-30T14:00:00.000Z",
        { part: "master-key", state: "included", masterKeyNumber: 1, masterKeyName: name },
      ],
    ]);
    expect(await read(f)).toMatchObject({ masterKey: { name, pack: 2 } });
  });

  it("names no later pack whose entry names an earlier master key", async () => {
    let at = Date.parse("2026-10-30T09:00:00.000Z");
    const f = fixture({ now: () => new Date((at += 60_000)) });
    const first = await f.make(true);
    const { masterKeyName: firstName } = shownMasterKey(first);
    await first.arrayBuffer();
    expect((await f.confirm(first)).status).toBe(204);
    const second = await f.make(true);
    const { masterKeyName: name } = shownMasterKey(second);
    await second.arrayBuffer();
    expect((await f.confirm(second)).status).toBe(204);
    expect((await packs()).map((p) => p.parts.at(-1))).toEqual([
      { part: "master-key", state: "included", masterKeyNumber: 2, masterKeyName: name },
      { part: "master-key", state: "included", masterKeyNumber: 1, masterKeyName: firstName },
    ]);
    await withTransaction(suite.db, (tx) =>
      insertRecoveryPack(tx, {
        nodeId: node.nodeId,
        number: 3,
        madeAt: new Date(at + 60_000),
        madeBy: null,
        parts: [
          { part: "master-key", state: "included", masterKeyNumber: 1, masterKeyName: firstName },
        ],
      }),
    );
    expect(await read(f)).toMatchObject({ masterKey: { name, pack: 2 } });
  });

  it("names the received pack as holding the master key, and an unreceived reprint of it plainly", async () => {
    let at = Date.parse("2026-10-30T09:00:00.000Z");
    const f = fixture({ now: () => new Date((at += 60_000)) });
    const response = await f.make(true);
    const { masterKey, masterKeyName: name } = shownMasterKey(response);
    await response.arrayBuffer();
    expect((await f.confirm(response)).status).toBe(204);
    await (await f.make(masterKey!)).arrayBuffer();
    const answer = await read(f);
    expect(answer).toMatchObject({ masterKey: { name, pack: 1 } });
    expect(answer.unreceived).toEqual({ number: 2, madeAt: expect.any(String) });
  });

  it("setup's pack is still named before any Print", async () => {
    const made = makeNewMasterKey("2026-10-30");
    const madeAt = "2026-10-30T08:00:00.000Z";
    // The setup route's order: the pack, then the key's row.
    const pdf = await makeMasterKeyRecoveryPack(suite.db, node.nodeId, "en", () => {}, {
      made: made.made,
      madeAt,
    });
    await saveNewMasterKey(suite.db, made, new Date(madeAt), null);
    expect(pdf).toEqual(expect.any(String));
    expect((await packs())[0]!.parts).toContainEqual({
      part: "master-key",
      state: "included",
      masterKeyNumber: 1,
      masterKeyName: made.made.masterKeyName,
    });
    expect(await read(fixture())).toMatchObject({
      masterKey: { name: made.made.masterKeyName, pack: 1 },
    });
  });

  it("still names an older unconfirmed pack that showed the master key after a later one without it is received", async () => {
    const { name } = await mintMasterKey(suite.db, { madeAt: KEY_MADE });
    await olderPack(1, KEY_MADE);
    await olderPack(2, new Date("2026-10-02T09:00:00.000Z"), new Date("2026-10-02T10:00:00.000Z"));
    expect(await read(fixture())).toMatchObject({
      latest: { number: 2, received: true },
      unreceived: { number: 1, holdsCurrentMasterKey: true, offeredAtSetup: true },
      masterKey: { name, pack: 1 },
    });
  });

  it("names an older received pack that showed the master key past a later one without it, and adds no keep entry for it", async () => {
    await mintMasterKey(suite.db, { madeAt: KEY_MADE });
    await olderPack(1, KEY_MADE, KEY_MADE);
    await olderPack(2, new Date("2026-10-02T09:00:00.000Z"), new Date("2026-10-02T10:00:00.000Z"));
    expect(await read(fixture())).toMatchObject({
      unreceived: null,
      keep: [],
      masterKey: { pack: 1 },
    });
  });

  it("names no older pack for a master key when two were made at the instant the key was", async () => {
    const { name } = await mintMasterKey(suite.db, { madeAt: KEY_MADE });
    await olderPack(1, KEY_MADE);
    await olderPack(2, KEY_MADE);
    expect(await read(fixture())).toMatchObject({ masterKey: { name, pack: null } });
  });

  it("names a Print over an older pack made at the key's instant", async () => {
    const { secret, name } = await mintMasterKey(suite.db, { madeAt: KEY_MADE });
    await olderPack(1, KEY_MADE);
    const f = fixture();
    await (await f.make(secret)).arrayBuffer();
    expect(await read(f)).toMatchObject({ masterKey: { name, pack: 2 } });
  });

  it("names no pack that showed an earlier master key", async () => {
    const f = fixture({ now: () => new Date("2026-10-02T09:00:00.000Z") });
    const made = await f.make(true);
    await made.arrayBuffer();
    expect((await f.confirm(made)).status).toBe(204);
    await withTransaction(suite.db, (tx) =>
      insertMasterKey(tx, {
        name: "2026-10-03 · AAAA",
        checkValue: "a".repeat(64),
        publicKey: Buffer.alloc(44, 1),
        madeAt: new Date("2026-10-03T09:00:00.000Z"),
        madeBy: null,
      }),
    );
    expect(await read(f)).toMatchObject({ masterKey: { name: "2026-10-03 · AAAA", pack: null } });
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
    await (await print(f)).arrayBuffer();
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
    expect((await print(f)).status).toBe(200);
    expect((await f.received(1)).status).toBe(204);
    const response = await f.status();
    expect(response.status).toBe(200);
    const answer = (await response.json()) as Answer & { incomplete: boolean };
    expect(answer).toMatchObject({ incomplete: true, upToDate: false, backupsUseOlderKey: false });
    for (const key of [KEY, "short"]) expect(JSON.stringify(answer)).not.toContain(key);
  });

  it("does not count archives as changed when their record cannot be read", async () => {
    const f = fixture();
    await (await print(f)).arrayBuffer();
    await f.received(1);
    expect((await read(f)).upToDate).toBe(true);
    await withTransaction(suite.db, (tx) => storeArchivePart(tx, {}));
    expect(await read(f)).toMatchObject({ upToDate: true, reasons: [] });
  });

  it("keeps a pack up to date when the archive bucket changes, recording none of its credentials", async () => {
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
    await (await print(f)).arrayBuffer();
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
    expect(await read(f)).toMatchObject({ upToDate: true, reasons: [] });
  });

  it("keeps one pack for a backup key that was never changed before its first change", async () => {
    delete boxEnv.WAITRON_BACKUP_KEY_ROTATED_AT;
    let instant = "2026-10-01T09:00:00.000Z";
    const f = fixture({ now: () => new Date(instant) });
    await (await print(f)).arrayBuffer();
    await f.received(1);
    instant = "2026-10-02T09:00:00.000Z";
    await (await print(f)).arrayBuffer();
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

const CLOUD_ADDRESS = "https://rescue.venue.example/";
type Display = EmergencyDisplay & { stale: boolean };
const display = (
  facts: Partial<Extract<EmergencyDisplay["emergency"], { status: "ready" }>> = {},
  stale = false,
): Display => {
  const reply = emergencyReply("installation", "venue", "2026-10-30T09:00:00.000Z");
  return {
    ...reply,
    emergency: { ...reply.emergency, address: CLOUD_ADDRESS, ...facts },
    stale,
  } as Display;
};
const cloudPack = (
  read: () => Promise<Display> = async () => display(),
  isPrimary = () => true,
): NonNullable<BackupRecoveryPackMakeDeps["cloud"]> => ({
  connection: {
    status: async () => ({ state: "complete", code: "" }),
    emergency: read,
  },
  managementOrigin: "https://box.test",
  isPrimary,
});

/** The QR code read from the left and the right half of the pack's first page. */
async function firstPageCodes(bytes: ArrayBuffer): Promise<[string | null, string | null]> {
  const loading = getDocument({ data: new Uint8Array(bytes.slice(0)), useSystemFonts: false });
  try {
    const page = await (await loading.promise).getPage(1);
    const viewport = page.getViewport({ scale: 3 });
    const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
    const context = canvas.getContext("2d");
    await page.render({ canvas: canvas as never, canvasContext: context as never, viewport })
      .promise;
    const half = Math.floor(canvas.width / 2);
    const read = (left: number) =>
      jsQR(context.getImageData(left, 0, half, canvas.height).data, half, canvas.height)?.data ??
      null;
    return [read(0), read(half)];
  } finally {
    await loading.destroy();
  }
}

it.each(["en", "es"] as const)(
  "a pack made while connected has the Cloud QR code on its first page, reading back as the address (%s)",
  async (locale) => {
    const caption = PACK_WORDS[locale].cloudQr("rescue.venue.example");
    const response = await fixture({ cloud: cloudPack() }).make(
      true,
      {},
      { locale, newMasterKey: true },
    );
    expect(response.status).toBe(200);
    const bytes = await response.arrayBuffer();
    const { masterKey } = shownMasterKey(response);
    expect(await firstPageText(bytes)).toContain(caption);
    expect(await firstPageCodes(bytes)).toEqual([masterKey, CLOUD_ADDRESS]);
    const text = await pdfText(bytes);
    expect(text).not.toMatch(/emergenc/i);
    expect(text).toContain(PACK_WORDS[locale].page(2, 2));
    const [record] = await packs();
    expect(record!.parts[0]).toEqual({ part: "emergency", state: "included" });
    for (const value of [
      JSON.stringify(record),
      JSON.stringify(logs),
      JSON.stringify(await readRecoveryPackPdf(new Uint8Array(bytes))),
    ])
      expect(value).not.toContain("rescue.venue.example");
  },
);

it("a pack made while not connected has the key and its QR code only", async () => {
  const read = vi.fn(async () => display());
  const cloud = cloudPack(read);
  cloud.connection.status = async () => ({ state: "not_connected", code: "" });
  for (const deps of [{}, { cloud }]) {
    const response = await fixture(deps).make(true);
    expect(response.status).toBe(200);
    const bytes = await response.arrayBuffer();
    expect(await firstPageCodes(bytes)).toEqual([shownMasterKey(response).masterKey, null]);
    expect(await firstPageText(bytes)).not.toContain("Waitron Cloud");
    expect((await packs())[0]!.parts[0]).toEqual({ part: "emergency", state: "absent" });
  }
  expect(read).not.toHaveBeenCalled();
});

it.each([
  ["closed", async () => display({ open: false, closedReason: "setting_off", address: null })],
  ["closed with an address", async () => display({ open: false, closedReason: "setting_off" })],
  ["stale", async () => display({}, true)],
  [
    "not ready",
    async () =>
      ({
        ...display(),
        emergency: { status: "unavailable", reason: "state_not_ready" },
      }) as Display,
  ],
  [
    "unreadable",
    async () => {
      throw new AppError("cloud.unavailable", {});
    },
  ],
  [
    "failing",
    async () => {
      throw new Error("could not read /home/jane-doe/cloud.json");
    },
  ],
] as const)(
  "closed or stale Cloud prints no Cloud QR code, and says nothing of it (%s)",
  async (_name, read) => {
    const response = await fixture({ cloud: cloudPack(read) }).make(true);
    expect(response.status).toBe(200);
    const bytes = await response.arrayBuffer();
    expect(await firstPageCodes(bytes)).toEqual([shownMasterKey(response).masterKey, null]);
    const text = await pdfText(bytes);
    expect(text).not.toMatch(/Cloud|emergency|jane-doe/i);
    expect(text).toContain("Page 2 of 2");
    expect((await packs())[0]!.parts.map((p) => [p.part, p.state])).toEqual([
      ["emergency", "absent"],
      ["bucket", "included"],
      ["master-key", "included"],
    ]);
    expect(JSON.stringify(logs)).not.toContain("jane-doe");
  },
);

it("a secondary box prints no Cloud QR code and does not ask Cloud", async () => {
  const read = vi.fn(async () => display());
  const response = await fixture({ cloud: cloudPack(read, () => false) }).make(true);
  expect(await firstPageCodes(await response.arrayBuffer())).toEqual([
    shownMasterKey(response).masterKey,
    null,
  ]);
  expect(read).not.toHaveBeenCalled();
  expect((await packs())[0]!.parts[0]).toEqual({ part: "emergency", state: "absent" });
});

it("prints the Cloud QR code for a person without node.manage, since the address is not secret", async () => {
  await setBuiltInRoleForTest(suite.db, admin.personId, "manager");
  const response = await fixture({ cloud: cloudPack() }).make(true);
  expect(response.status).toBe(200);
  expect((await firstPageCodes(await response.arrayBuffer()))[1]).toBe(CLOUD_ADDRESS);
  expect((await packs())[0]!.parts[0]).toEqual({ part: "emergency", state: "included" });
});

it("waits for Cloud before the backup turn or either write lock, then rechecks that the box is primary", async () => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => (release = resolve));
  const requested = vi.fn(async () => {
    await gate;
    return display();
  });
  const enteredTurn = vi.fn();
  const queue = createTurns();
  const turns: Turns = (body) => {
    enteredTurn();
    return queue(body);
  };
  let primary = true;
  const pending = print(fixture({ cloud: cloudPack(requested, () => primary), turns }));
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
  expect(await pdfText(await response.arrayBuffer())).not.toContain("Waitron Cloud");
  expect((await packs())[0]!.parts[0]).toEqual({ part: "emergency", state: "absent" });
});

it.each(["maker permission", "cancelled"] as const)(
  "rechecks %s after the Cloud wait before writing a pack or a master key",
  async (change) => {
    const controller = new AbortController();
    const read = async () => {
      if (change === "cancelled") controller.abort();
      else await setBuiltInRoleForTest(suite.db, admin.personId, "supervisor");
      return display();
    };
    const response = await fixture({ cloud: cloudPack(read) }).make(true, {
      signal: controller.signal,
    });
    expect(response.status).toBe(change === "cancelled" ? 500 : 403);
    if (change === "maker permission")
      expect((await codeOf(response)).code).toBe("authorization.not_permitted");
    expect(await packs()).toEqual([]);
    expect(await storedMasterKeys()).toEqual([]);
  },
);

describe("the status's Cloud reason", () => {
  async function madeWithout(f: ReturnType<typeof fixture>) {
    await (await print(f)).arrayBuffer();
    await f.received(1);
  }

  it("a pack without the Cloud QR code is out of date once Cloud is open", async () => {
    const cloud = cloudPack(async () =>
      display({ open: false, closedReason: "setting_off", address: null }),
    );
    const f = fixture({ cloud });
    await madeWithout(f);
    expect(await (await f.status()).json()).toMatchObject({ upToDate: true, reasons: [] });
    cloud.connection.emergency = async () => display();
    const value = await (await f.status()).json();
    expect(value).toMatchObject({
      upToDate: false,
      reasons: [{ part: "emergency", kind: "set_up_after" }],
    });
    expect(value.latest.parts[0]).toEqual({ part: "emergency", state: "absent" });
    expect(JSON.stringify(value)).not.toContain("rescue.venue.example");
  });

  it("a pack with the Cloud QR code stays up to date, Cloud open or closed", async () => {
    const cloud = cloudPack();
    const f = fixture({ cloud });
    await madeWithout(f);
    expect(await (await f.status()).json()).toMatchObject({ upToDate: true, reasons: [] });
    cloud.connection.emergency = async () => display({ open: false, closedReason: "setting_off" });
    expect(await (await f.status()).json()).toMatchObject({ upToDate: true, reasons: [] });
  });

  it.each([
    ["stale", async () => display({}, true)],
    [
      "unreadable",
      async () => {
        throw new AppError("cloud.unavailable", {});
      },
    ],
  ] as const)("says nothing of Cloud when its read is %s", async (_name, read) => {
    const cloud = cloudPack(async () =>
      display({ open: false, closedReason: "setting_off", address: null }),
    );
    const f = fixture({ cloud });
    await madeWithout(f);
    cloud.connection.emergency = read;
    expect(await (await f.status()).json()).toMatchObject({ upToDate: true, reasons: [] });
  });
});

it("reads Cloud outside the write transaction for pack status", async () => {
  const cloud = cloudPack();
  const f = fixture({ cloud });
  let release!: () => void;
  const gate = new Promise<void>((resolve) => (release = resolve));
  const read = vi.fn(async () => {
    await gate;
    return display();
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
  expect((await pending).status).toBe(200);
});

it("bounds a status read to eight seconds and then says nothing of Cloud", async () => {
  const cloud = cloudPack(async () =>
    display({ open: false, closedReason: "setting_off", address: null }),
  );
  const f = fixture({ cloud });
  await (await print(f)).arrayBuffer();
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
    expect(await response!.json()).toMatchObject({ upToDate: true, reasons: [] });
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
