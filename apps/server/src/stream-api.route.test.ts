import { Hono } from "hono";
import { beforeAll, describe, expect, it, vi, type Mock } from "vitest";
import { eq } from "drizzle-orm";
import { nodes, setNodePublicKey, withTransaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import {
  deleteCredential,
  loadKeyRing,
  putCredential,
  tryGetCredential,
  type KeyRing,
} from "@waitron/credentials";
import { generateNodeKeyPair } from "@waitron/membership";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { hashPassword, hashPin, persons } from "@waitron/identity";
import { applyVenue, planVenue } from "@waitron/provisioning";
import { AppError } from "@waitron/shared";
import {
  parseRecoveryKit,
  type BucketConfig,
  type ProbeFailure,
  type StreamStatus,
} from "@waitron/stream";
import { keyFingerprint } from "./backup-supervisor.js";
import { createTurns, type Turns } from "./backup-turns.js";
import { mountManagementApi } from "./management-api.js";
import { ALL_MODULES } from "./modules.js";
import { mountStreamApi, type StreamApiDeps } from "./stream-api.js";
import { readStreamSettings, streamSettingsPayload, type StreamSettings } from "./stream-host.js";

// The route calls `putCredential` itself, so the harness sees the credential write through this
// pass-through wrapper.
const credentialWrites = vi.hoisted(() => ({ onPut: (): void => {} }));
vi.mock("@waitron/credentials", async (importOriginal) => {
  const real = await importOriginal<typeof import("@waitron/credentials")>();
  return {
    ...real,
    putCredential: (...args: Parameters<typeof real.putCredential>) => {
      credentialWrites.onPut();
      return real.putCredential(...args);
    },
  };
});

const RING: KeyRing = loadKeyRing({
  WAITRON_CREDENTIALS_KEY: Buffer.alloc(32, 7).toString("base64"),
  WAITRON_CREDENTIALS_KEY_VERSION: "1",
});
const suite = useVenueDb({
  migrations: migrationOptionsFor(manifestSets(), null),
  resetPerTest: false,
  timeoutMs: 60_000,
});

const LOCALE = "es-ES";
const PASSWORD = "correct horse";
const MANAGER_EMAIL = "manager@x.com";
const VENUE_ID = "c0000000-0000-4000-8000-000000000002";
const BUCKET: BucketConfig = {
  endpoint: "https://s3.example.net",
  region: "eu-west-1",
  bucket: "venue-copy",
  prefix: "",
  accessKeyId: "AKIAEXAMPLE",
  secretAccessKey: "not-a-real-secret-0123456789",
};
const BODY = { ...BUCKET };
const STREAMING: StreamStatus = {
  state: "streaming",
  generation: "gen-0-n-20260923T101500Z",
  reason: null,
  stateSince: "2026-09-23T10:15:30.000Z",
  bucketProblem: null,
  lagMs: 0,
  lastConfirmedUploadAt: "2026-09-23T10:16:00.000Z",
};

let nifCounter = 0;
function nextNif(): string {
  nifCounter += 1;
  return `${String(77_000_000 + nifCounter).padStart(8, "0")}K`;
}

async function setupTenant(): Promise<void> {
  await applyVenue(
    planVenue(
      {
        country: "ES",
        taxId: nextNif(),
        legalName: "Deli Test SL",
        location: {
          name: "Sala principal",
          fiscalTerritory: "ES-common",
          invoiceLocales: [LOCALE],
          operationDescription: "Venta en establecimiento",
          addressLine1: "Calle Mayor 1",
          addressLine2: null,
          postalCode: "28013",
          city: "Madrid",
          province: "Madrid",
          timeZone: "Europe/Madrid",
          dayCutover: "05:00",
        },
        tillName: "Caja 1",
        seriesCode: "A",
        rectificativeSeriesCode: "R",
        admin: {
          displayName: "Administradora",
          pinHash: hashPin("1234"),
          passwordHash: hashPassword("dashPass123"),
          email: "admin@x.com",
        },
      },
      ALL_MODULES,
    ),
    { db: suite.db, modules: ALL_MODULES },
  );
  await withTransaction(suite.db, async (tx) => {
    await tx.insert(persons).values({
      displayName: "The Manager",
      email: MANAGER_EMAIL,
      pinHash: hashPin("1234"),
      passwordHash: hashPassword(PASSWORD),
      role: "manager",
    });
  });
}

async function login(app: Hono): Promise<string> {
  const res = await app.request("/management-api/session", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: MANAGER_EMAIL, password: PASSWORD }),
  });
  expect(res.status).toBe(200);
  return res.headers.get("set-cookie")!.split(";")[0];
}

let nodeId: string;
let publicKey: string;

beforeAll(async () => {
  await setupTenant();
  const [node] = await withTransaction(suite.db, (tx) =>
    tx.select({ id: nodes.id }).from(nodes).limit(1),
  );
  nodeId = node!.id;
  publicKey = generateNodeKeyPair().publicKey;
  await setNodePublicKey(suite.db, nodeId, publicKey);
}, 180_000);

interface Harness {
  app: Hono;
  deps: StreamApiDeps;
  reload: Mock<() => Promise<void>>;
  key: { value: string | undefined };
  order: string[];
  /** The stored settings each reload found, read from inside the reload. */
  seenByReload: (StreamSettings | null)[];
}

function harness(overrides: Partial<StreamApiDeps> = {}, startKey?: string): Harness {
  const key = { value: startKey };
  const order: string[] = [];
  const seenByReload: (StreamSettings | null)[] = [];
  credentialWrites.onPut = () => order.push("put-credential");
  // The real host reads the settings at the start of each reload. Run inside the credential's
  // transaction, that read is refused: "write lock: a body asked for the lock it is already
  // holding".
  const reload = vi.fn(async () => {
    order.push("reload");
    seenByReload.push(await readStreamSettings(suite.db, RING));
  });
  const stream = {
    reload,
    status: () => STREAMING,
  };
  const deps: StreamApiDeps = {
    db: suite.db,
    ring: RING,
    stream,
    nodeId,
    venueId: VENUE_ID,
    isPrimary: () => true,
    isManagedByEnvironment: () => false,
    readRecoveryKey: async () => key.value,
    writeRecoveryKey: vi.fn(async (k: string) => {
      order.push("write-key");
      key.value = k;
    }),
    sealedState: {
      refresh: vi.fn(async () => {
        order.push("refresh");
        return "sealed" as const;
      }),
    },
    probe: vi.fn(async () => ({ ok: true as const })),
    turns: createTurns(),
    ...overrides,
  };
  const app = new Hono();
  mountManagementApi(
    app,
    {
      db: suite.db,
      cfg: { nodeId },
      secureCookies: false,
      rpId: "localhost",
      origin: "http://localhost",
    },
    () => {},
  );
  mountStreamApi(app, deps, () => {});
  return { app, deps, reload, key, order, seenByReload };
}

async function clearBucket(): Promise<void> {
  await withTransaction(suite.db, (tx) => deleteCredential(tx, { purpose: "backup.stream" }));
}

async function storedBucket(): Promise<Record<string, string> | null> {
  return withTransaction(suite.db, (tx) =>
    tryGetCredential(tx, RING, { purpose: "backup.stream" }),
  );
}

const json = (cookie: string, body: unknown) => ({
  headers: { cookie, "content-type": "application/json" },
  body: JSON.stringify(body),
});

describe("stream settings routes", () => {
  it("refuses every route without a manager session", async () => {
    const { app } = harness();
    for (const [method, path] of [
      ["GET", "/api/backup/stream"],
      ["PUT", "/api/backup/stream"],
      ["POST", "/api/backup/stream/test"],
      ["DELETE", "/api/backup/stream"],
      ["GET", "/api/backup/stream/kit"],
    ] as const) {
      const res = await app.request(path, { method });
      expect(res.status).toBe(401);
      expect(await res.json()).toMatchObject({ error: { code: "management_session.required" } });
    }
  });

  it("Test probes the bucket it was given and reports a pass", async () => {
    const { app, deps } = harness();
    const cookie = await login(app);
    const res = await app.request("/api/backup/stream/test", {
      method: "POST",
      ...json(cookie, BODY),
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(deps.probe).toHaveBeenCalledWith(BUCKET);
  });

  it("Test treats a blank endpoint as an Amazon bucket", async () => {
    const { app, deps } = harness();
    const cookie = await login(app);
    await app.request("/api/backup/stream/test", {
      method: "POST",
      ...json(cookie, { ...BODY, endpoint: "" }),
    });
    const amazon = { ...BUCKET };
    delete amazon.endpoint;
    expect(deps.probe).toHaveBeenCalledWith(amazon);
  });

  // Every reason the bucket check can give reaches the screen by name, where the dashboard words
  // it; a reason this list lacks would reach the owner as a bare tag.
  it.each([
    "access_denied",
    "conditional_write_unsupported",
    "write_failed",
    "read_mismatch",
    "list_failed",
    "create_only_ignored",
    "fresh_version_refused",
    "if_match_ignored",
    "delete_failed",
  ] satisfies ProbeFailure[])(
    "Test refuses a bucket that fails with %s, naming it",
    async (reason) => {
      const { app } = harness({
        probe: vi.fn(async () => ({ ok: false as const, reason, detail: "from the store" })),
      });
      const cookie = await login(app);
      const res = await app.request("/api/backup/stream/test", {
        method: "POST",
        ...json(cookie, BODY),
      });
      expect(res.status).toBe(422);
      expect(await res.json()).toMatchObject({
        error: { code: "backup.stream_test_failed", params: { reason } },
      });
    },
  );

  it("Test reports a bucket that gives no answer at all as unreachable, not as refused", async () => {
    const { app } = harness({
      probe: vi.fn(async () => {
        throw new AppError("backup.stream_request_failed", {
          operation: "put",
          key: "k",
          status: null,
          name: "ECONNREFUSED",
        });
      }),
    });
    const cookie = await login(app);
    const res = await app.request("/api/backup/stream/test", {
      method: "POST",
      ...json(cookie, BODY),
    });
    expect(res.status).toBe(502);
    expect(await res.json()).toMatchObject({ error: { code: "backup.stream_request_failed" } });
  });

  it("refuses a missing required field by name, before any probe", async () => {
    const { app, deps } = harness();
    const cookie = await login(app);
    const res = await app.request("/api/backup/stream/test", {
      method: "POST",
      ...json(cookie, { ...BODY, region: "" }),
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({
      error: { code: "backup.request_invalid", params: { field: "region" } },
    });
    expect(deps.probe).not.toHaveBeenCalled();
  });

  it("refuses an endpoint that is not an http(s) address, before any probe", async () => {
    const { app, deps } = harness();
    const cookie = await login(app);
    const res = await app.request("/api/backup/stream/test", {
      method: "POST",
      ...json(cookie, { ...BODY, endpoint: "s3.example.net" }),
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({
      error: { code: "backup.request_invalid", params: { field: "endpoint" } },
    });
    expect(deps.probe).not.toHaveBeenCalled();
  });

  // The vault stores an absent prefix as "-", so a prefix of "-" would read back as none at all.
  it("refuses a prefix of a single hyphen, which would be stored as no prefix", async () => {
    const { app, deps } = harness();
    const cookie = await login(app);
    const res = await app.request("/api/backup/stream/test", {
      method: "POST",
      ...json(cookie, { ...BODY, prefix: "-" }),
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({
      error: { code: "backup.request_invalid", params: { field: "prefix" } },
    });
    expect(deps.probe).not.toHaveBeenCalled();
  });

  // Litestream refuses these when the copy starts; Test and Save refuse them first, with no
  // bucket contacted.
  it.each([
    ["bucket", { bucket: "Venue_Copy" }],
    ["prefix", { prefix: "waitron/../other" }],
  ] as const)(
    "Test and Save refuse settings Litestream cannot use, naming the %s, before any probe",
    async (field, change) => {
      await clearBucket();
      const { app, deps } = harness();
      const cookie = await login(app);
      for (const [method, path] of [
        ["POST", "/api/backup/stream/test"],
        ["PUT", "/api/backup/stream"],
      ] as const) {
        const res = await app.request(path, { method, ...json(cookie, { ...BODY, ...change }) });
        expect(res.status).toBe(400);
        expect(await res.json()).toMatchObject({
          error: { code: "backup.stream_config_unsafe", params: { field } },
        });
      }
      expect(deps.probe).not.toHaveBeenCalled();
      expect(await storedBucket()).toBeNull();
    },
  );

  it("Save refuses a bucket that fails the probe and stores nothing", async () => {
    await clearBucket();
    const { app, deps, reload } = harness({
      probe: vi.fn(async () => ({
        ok: false as const,
        reason: "write_failed" as const,
        detail: "403",
      })),
    });
    const cookie = await login(app);
    const res = await app.request("/api/backup/stream", { method: "PUT", ...json(cookie, BODY) });
    expect(res.status).toBe(422);
    expect(deps.writeRecoveryKey).not.toHaveBeenCalled();
    expect(reload).not.toHaveBeenCalled();
    expect(await storedBucket()).toBeNull();
  });

  it("Save sets a recovery key when there is none, refreshes the locked row, seals the bucket, then starts streaming", async () => {
    await clearBucket();
    const { app, key, order, seenByReload } = harness();
    const cookie = await login(app);
    const res = await app.request("/api/backup/stream", { method: "PUT", ...json(cookie, BODY) });
    expect(res.status).toBe(200);
    // randomBytes(32).toString("base64url"), as /api/backup/mint-key mints (backup-api.ts).
    expect(key.value).toMatch(/^[A-Za-z0-9_-]{43}$/);
    // The row must be locked under the key BEFORE the first generation opens, or a rebuild from
    // that generation finds no row to unlock.
    expect(order).toEqual(["write-key", "refresh", "put-credential", "reload"]);
    // The reload found the new settings committed.
    expect(seenByReload).toEqual([{ venueId: VENUE_ID, bucket: BUCKET }]);
    const view = await res.json();
    expect(view).toEqual({
      isPrimary: true,
      configured: true,
      bucket: {
        endpoint: "https://s3.example.net",
        region: "eu-west-1",
        bucket: "venue-copy",
        prefix: "",
        accessKeyId: "AKIAEXAMPLE",
      },
      status: STREAMING,
      recoveryKeySet: true,
      keyFingerprint: keyFingerprint(key.value!),
    });
    expect(JSON.stringify(view)).not.toContain(BODY.secretAccessKey);
    // Stored with this node's location id as the venue, and the absent prefix as "-".
    expect(await storedBucket()).toMatchObject({
      venueId: VENUE_ID,
      secretAccessKey: BODY.secretAccessKey,
      endpoint: "https://s3.example.net",
      prefix: "-",
    });
  });

  it("Save keeps an existing recovery key", async () => {
    const { app, deps, key } = harness({}, "recovery-key-one-strong");
    const cookie = await login(app);
    const res = await app.request("/api/backup/stream", { method: "PUT", ...json(cookie, BODY) });
    expect(res.status).toBe(200);
    expect(deps.writeRecoveryKey).not.toHaveBeenCalled();
    expect(key.value).toBe("recovery-key-one-strong");
  });

  it("two Saves at once set one recovery key and both succeed", async () => {
    await clearBucket();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    let probes = 0;
    const { app, deps, reload } = harness({
      probe: vi.fn(async () => {
        probes += 1;
        if (probes === 2) release();
        await gate;
        return { ok: true as const };
      }),
    });
    // A reload still running when the other Save's reload arrives is refused by the real host.
    let reloading = false;
    reload.mockImplementation(async () => {
      if (reloading) throw new AppError("backup.reload_in_progress", {});
      reloading = true;
      await new Promise((resolve) => setTimeout(resolve, 20));
      reloading = false;
    });
    const cookie = await login(app);
    const [first, second] = await Promise.all([
      app.request("/api/backup/stream", { method: "PUT", ...json(cookie, BODY) }),
      app.request("/api/backup/stream", { method: "PUT", ...json(cookie, BODY) }),
    ]);
    expect([first.status, second.status]).toEqual([200, 200]);
    expect(deps.writeRecoveryKey).toHaveBeenCalledTimes(1);
  });

  // As `apply` and `rotate` refuse to write backup.env on such a box.
  it("Save that would set a recovery key is refused while backups are managed by the environment", async () => {
    await clearBucket();
    const { app, deps, reload } = harness({ isManagedByEnvironment: () => true });
    const cookie = await login(app);
    const res = await app.request("/api/backup/stream", { method: "PUT", ...json(cookie, BODY) });
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: { code: "backup.managed_by_environment" } });
    expect(deps.probe).not.toHaveBeenCalled();
    expect(deps.writeRecoveryKey).not.toHaveBeenCalled();
    expect(reload).not.toHaveBeenCalled();
    expect(await storedBucket()).toBeNull();
  });

  it("Save on a box whose backups the environment manages proceeds when a key is already held", async () => {
    await clearBucket();
    const { app, deps, reload } = harness(
      { isManagedByEnvironment: () => true },
      "recovery-key-one-strong",
    );
    const cookie = await login(app);
    const res = await app.request("/api/backup/stream", { method: "PUT", ...json(cookie, BODY) });
    expect(res.status).toBe(200);
    expect(deps.writeRecoveryKey).not.toHaveBeenCalled();
    expect(reload).toHaveBeenCalledTimes(1);
    expect(await storedBucket()).toMatchObject({ bucket: BUCKET.bucket });
  });

  /** A queue held shut by an earlier turn, and a promise that settles once a request joins it. */
  function heldTurns() {
    const inner = createTurns();
    let release!: () => void;
    const held = inner(() => new Promise<void>((resolve) => (release = resolve)));
    let joined!: () => void;
    const waiting = new Promise<void>((resolve) => (joined = resolve));
    const turns: Turns = (body) => {
      joined();
      return inner(body);
    };
    return { turns, waiting, release: () => (release(), held) };
  }

  it("Save is refused when the environment takes over backups while it waits its turn", async () => {
    await clearBucket();
    const queue = heldTurns();
    let managed = false;
    const { app, deps, reload } = harness({
      isManagedByEnvironment: () => managed,
      turns: queue.turns,
    });
    const cookie = await login(app);
    const pending = app.request("/api/backup/stream", { method: "PUT", ...json(cookie, BODY) });
    await Promise.race([queue.waiting, pending]);
    managed = true;
    await queue.release();
    const res = await pending;
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: { code: "backup.managed_by_environment" } });
    expect(deps.writeRecoveryKey).not.toHaveBeenCalled();
    expect(reload).not.toHaveBeenCalled();
    expect(await storedBucket()).toBeNull();
  });

  it("Save is refused when this node stops being the primary while it waits its turn", async () => {
    await clearBucket();
    const queue = heldTurns();
    let primary = true;
    const { app, deps, reload } = harness(
      { isPrimary: () => primary, turns: queue.turns },
      "recovery-key-one-strong",
    );
    const cookie = await login(app);
    const pending = app.request("/api/backup/stream", { method: "PUT", ...json(cookie, BODY) });
    await Promise.race([queue.waiting, pending]);
    primary = false;
    await queue.release();
    const res = await pending;
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: { code: "backup.not_primary" } });
    expect(deps.sealedState.refresh).not.toHaveBeenCalled();
    expect(reload).not.toHaveBeenCalled();
    expect(await storedBucket()).toBeNull();
  });

  it("switching off is refused when this node stops being the primary while it waits its turn", async () => {
    await withTransaction(suite.db, (tx) =>
      putCredential(tx, RING, {
        purpose: "backup.stream",
        value: streamSettingsPayload({ venueId: VENUE_ID, bucket: BUCKET }),
      }),
    );
    const queue = heldTurns();
    let primary = true;
    const { app, reload } = harness({ isPrimary: () => primary, turns: queue.turns });
    const cookie = await login(app);
    const pending = app.request("/api/backup/stream", { method: "DELETE", headers: { cookie } });
    await Promise.race([queue.waiting, pending]);
    primary = false;
    await queue.release();
    const res = await pending;
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: { code: "backup.not_primary" } });
    expect(reload).not.toHaveBeenCalled();
    expect(await storedBucket()).not.toBeNull();
  });

  it("Save is refused on a node that is not the primary, before any probe", async () => {
    const { app, deps } = harness({ isPrimary: () => false });
    const cookie = await login(app);
    const res = await app.request("/api/backup/stream", { method: "PUT", ...json(cookie, BODY) });
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: { code: "backup.not_primary" } });
    expect(deps.probe).not.toHaveBeenCalled();
  });

  it("the kit carries the bucket, the venue, the recovery key and this node's signing key", async () => {
    const { app } = harness({}, "recovery-key-one-strong");
    const cookie = await login(app);
    await app.request("/api/backup/stream", { method: "PUT", ...json(cookie, BODY) });
    const res = await app.request("/api/backup/stream/kit", { headers: { cookie } });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { kit: string; keyFingerprint: string };
    expect(parseRecoveryKit(body.kit)).toEqual({
      version: 1,
      venueId: VENUE_ID,
      bucket: BUCKET,
      recoveryKey: "recovery-key-one-strong",
      pointerSignerPublicKey: publicKey,
    });
    expect(body.keyFingerprint).toBe(keyFingerprint("recovery-key-one-strong"));
    // It carries the recovery key and the bucket's secret key.
    expect(res.headers.get("cache-control")).toBe("no-store");
  });

  it("the kit waits its turn, so it never pairs one Save's bucket with a later rotation's key", async () => {
    const other: BucketConfig = { ...BUCKET, bucket: "venue-copy-two" };
    await withTransaction(suite.db, (tx) =>
      putCredential(tx, RING, {
        purpose: "backup.stream",
        value: streamSettingsPayload({ venueId: VENUE_ID, bucket: BUCKET }),
      }),
    );
    const queue = heldTurns();
    const { app, key } = harness({ turns: queue.turns }, "recovery-key-one-strong");
    const cookie = await login(app);
    const pending = app.request("/api/backup/stream/kit", { headers: { cookie } });
    await Promise.race([queue.waiting, pending]);
    await withTransaction(suite.db, (tx) =>
      putCredential(tx, RING, {
        purpose: "backup.stream",
        value: streamSettingsPayload({ venueId: VENUE_ID, bucket: other }),
      }),
    );
    key.value = "recovery-key-two-strong";
    await queue.release();
    const res = await pending;
    expect(res.status).toBe(200);
    const kit = parseRecoveryKit(((await res.json()) as { kit: string }).kit);
    expect(kit).toMatchObject({ bucket: other, recoveryKey: "recovery-key-two-strong" });
  });

  it("offers no kit while no bucket is configured", async () => {
    await clearBucket();
    const { app } = harness({}, "recovery-key-one-strong");
    const cookie = await login(app);
    const res = await app.request("/api/backup/stream/kit", { headers: { cookie } });
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: { code: "backup.stream_not_configured" } });
  });

  it("offers no kit while the box holds no recovery key", async () => {
    const { app } = harness({}, "recovery-key-one-strong");
    const cookie = await login(app);
    await app.request("/api/backup/stream", { method: "PUT", ...json(cookie, BODY) });
    const keyless = harness();
    const res = await keyless.app.request("/api/backup/stream/kit", { headers: { cookie } });
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: { code: "backup.recovery_key_missing" } });
  });

  it("offers no kit when this node has no signing key, since no rebuild could verify the pointer", async () => {
    const { app } = harness({}, "recovery-key-one-strong");
    const cookie = await login(app);
    await app.request("/api/backup/stream", { method: "PUT", ...json(cookie, BODY) });
    await withTransaction(suite.db, (tx) =>
      tx.update(nodes).set({ publicKey: null }).where(eq(nodes.id, nodeId)),
    );
    try {
      const res = await app.request("/api/backup/stream/kit", { headers: { cookie } });
      expect(res.status).toBe(409);
      expect(await res.json()).toMatchObject({ error: { code: "backup.stream_signer_missing" } });
    } finally {
      await setNodePublicKey(suite.db, nodeId, publicKey);
    }
  });

  it("switching off removes the bucket and stops streaming", async () => {
    const { app, reload, seenByReload } = harness({}, "recovery-key-one-strong");
    const cookie = await login(app);
    await app.request("/api/backup/stream", { method: "PUT", ...json(cookie, BODY) });
    const res = await app.request("/api/backup/stream", { method: "DELETE", headers: { cookie } });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ configured: false, bucket: null });
    expect(reload).toHaveBeenCalledTimes(2);
    // The second reload found the settings already gone.
    expect(seenByReload.at(-1)).toBeNull();
    expect(await storedBucket()).toBeNull();
  });

  // A key under the archive's length floor still counts as held, as the backup routes count it.
  it("reads and switches off on a box whose recovery key is too short", async () => {
    const { app } = harness({
      readRecoveryKey: async () => {
        throw new AppError("backup.recovery_key_too_short", { min: 12 });
      },
    });
    const cookie = await login(app);
    const read = await app.request("/api/backup/stream", { headers: { cookie } });
    expect(read.status).toBe(200);
    expect(await read.json()).toMatchObject({ recoveryKeySet: true, keyFingerprint: null });
    const off = await app.request("/api/backup/stream", { method: "DELETE", headers: { cookie } });
    expect(off.status).toBe(200);
    expect(await off.json()).toMatchObject({ configured: false, recoveryKeySet: true });
  });

  it("Save on a box whose recovery key is too short is refused with that code, writing no key", async () => {
    await clearBucket();
    const { app, deps, reload } = harness({
      readRecoveryKey: async () => {
        throw new AppError("backup.recovery_key_too_short", { min: 12 });
      },
    });
    const cookie = await login(app);
    const res = await app.request("/api/backup/stream", { method: "PUT", ...json(cookie, BODY) });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({
      error: { code: "backup.recovery_key_too_short", params: { min: 12 } },
    });
    expect(deps.writeRecoveryKey).not.toHaveBeenCalled();
    expect(reload).not.toHaveBeenCalled();
    expect(await storedBucket()).toBeNull();
  });

  it("switching off is refused on a node that is not the primary", async () => {
    const { app, reload } = harness({ isPrimary: () => false });
    const cookie = await login(app);
    const res = await app.request("/api/backup/stream", { method: "DELETE", headers: { cookie } });
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: { code: "backup.not_primary" } });
    expect(reload).not.toHaveBeenCalled();
  });
});
