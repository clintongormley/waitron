import { beforeEach, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { credentialRevision, loadKeyRing, putCredential } from "@waitron/credentials";
import { locations, setNodePublicKey, withTransaction, type Transaction } from "@waitron/db";
import { seedNode, seedTenant } from "@waitron/db/testing/seed.js";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import type { WaitronModule } from "@waitron/module";
import { PART_WORDS, partFailure } from "@waitron/recovery-pack";
import { AppError, locationId, type NodeId } from "@waitron/shared";
import { parseRecoveryKit } from "@waitron/stream";
import { decodeArchiveRecoveryPack } from "./archive-recovery-pack.js";
import { ARCHIVE_PURPOSE, writeArchiveSettings, type ArchiveSettings } from "./archive-settings.js";
import {
  buildArchivesPart,
  buildBucketPart,
  buildServerKeyPart,
  withServerKeyPageNumber,
  type PartsContext,
  type ServerKeyInput,
} from "./backup-recovery-pack-parts.js";
import { STREAM_PURPOSE, streamSettingsPayload } from "./stream-host.js";

const RING = loadKeyRing({
  WAITRON_CREDENTIALS_KEY: Buffer.alloc(32, 9).toString("base64"),
  WAITRON_CREDENTIALS_KEY_VERSION: "1",
});
const KEY = "recovery-key-one-strong";
const VENUE = "c0000000-0000-4000-8000-000000000002";
const BUCKET = {
  region: "eu-west-1",
  bucket: "venue-bucket",
  prefix: "shop/",
  accessKeyId: "AKIASTREAM",
  secretAccessKey: "stream-secret-0123456789abcdef",
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

const suite = useVenueDb({ migrations: migrationOptionsFor(manifestSets(), null) });
let nodeId: NodeId;
let context: PartsContext;

beforeEach(async () => {
  await seedTenant(suite.db);
  const [location] = await suite.db
    .insert(locations)
    .values({ name: "Sala", invoiceLocales: ["es"], operationDescription: "Restaurant" })
    .returning({ id: locations.id });
  nodeId = await seedNode(suite.db, locationId(location!.id));
  await setNodePublicKey(suite.db, nodeId, "SIGNER_PUBLIC_KEY");
  context = {
    locale: "en",
    timeZone: "Europe/Madrid",
    madeAt: "2026-10-30T09:00:00.000Z",
    nodeId,
    venueId: VENUE,
    ring: RING,
    env: {
      WAITRON_BACKUP_RECOVERY_KEY: KEY,
      WAITRON_BACKUP_KEY_ROTATED_AT: "2026-09-20T08:00:00.000Z",
    },
    managedByEnvironment: false,
  };
});

const inTx = <T>(body: (tx: Transaction) => Promise<T>) => withTransaction(suite.db, body);
const storeStream = () =>
  inTx((tx) =>
    putCredential(tx, RING, {
      purpose: STREAM_PURPOSE,
      value: streamSettingsPayload({ venueId: VENUE, bucket: BUCKET }),
    }),
  );
const storeArchives = (settings: Omit<ArchiveSettings, "revision"> = ARCHIVES) =>
  inTx((tx) => writeArchiveSettings(tx, RING, settings));

describe("the bucket part", () => {
  it("carries the restore code for the stored bucket, the backup key and the server's signing key", async () => {
    await storeStream();
    const built = await inTx((tx) => buildBucketPart(tx, context));
    expect(parseRecoveryKit(built.file.bucketCode!)).toEqual({
      version: 1,
      venueId: VENUE,
      bucket: BUCKET,
      recoveryKey: KEY,
      pointerSignerPublicKey: "SIGNER_PUBLIC_KEY",
    });
    const revision = await inTx((tx) => credentialRevision(tx, { purpose: STREAM_PURPOSE }));
    expect(built.record).toEqual({
      part: "bucket",
      state: "included",
      keyChangedAt: "2026-09-20T08:00:00.000Z",
      settingsRevision: revision,
    });
    expect(built.part).toMatchObject({
      kind: "bucket",
      state: "included",
      lastChanged: "2026-09-20",
      check: `key of 20 Sept 2026 · rev ${revision!.slice(0, 8)}`,
    });
    const page = built.part.page!;
    expect(page.secret).toEqual({
      label: "Restore code for the bucket copy",
      text: built.file.bucketCode,
      qr: true,
    });
    expect(page.rows).toEqual([
      { label: "Bucket", value: "eu-west-1 · venue-bucket" },
      { label: "Backup key", value: "changed on 20 September 2026" },
    ]);
    expect(page.notes).toEqual(PART_WORDS.en.bucket.steps);
    expect(JSON.stringify(built.record)).not.toContain(KEY);
  });

  it("lets the pack's own time stand in for a key that was never changed", async () => {
    await storeStream();
    const built = await inTx((tx) =>
      buildBucketPart(tx, { ...context, env: { WAITRON_BACKUP_RECOVERY_KEY: KEY } }),
    );
    expect(built.record.keyChangedAt).toBe(context.madeAt);
    expect(built.part.page!.rows).toHaveLength(1);
  });

  it("names the bucket's own address when it has one, in Spanish", async () => {
    await inTx((tx) =>
      putCredential(tx, RING, {
        purpose: STREAM_PURPOSE,
        value: streamSettingsPayload({
          venueId: VENUE,
          bucket: { ...BUCKET, endpoint: "https://s3.example.net:9000" },
        }),
      }),
    );
    const built = await inTx((tx) => buildBucketPart(tx, { ...context, locale: "es" }));
    expect(built.part.page!.rows[0]).toEqual({
      label: "Bucket",
      value: "s3.example.net:9000 · venue-bucket",
    });
    expect(built.part.page!.title).toBe("Copia en el bucket");
  });

  it("is absent when the box has no bucket copy", async () => {
    expect(await inTx((tx) => buildBucketPart(tx, context))).toEqual({
      part: { kind: "bucket", state: "absent" },
      record: { part: "bucket", state: "absent" },
      file: {},
    });
  });

  it.each([
    ["backup.recovery_key_missing", {}],
    ["backup.recovery_key_too_short", { WAITRON_BACKUP_RECOVERY_KEY: "short" }],
  ] as const)("fails as %s with the Backups wording", async (code, env) => {
    await storeStream();
    const built = await inTx((tx) => buildBucketPart(tx, { ...context, env }));
    expect(built).toEqual({
      part: { kind: "bucket", state: "failed", failure: partFailure("en", code, {}) },
      record: { part: "bucket", state: "failed" },
      file: {},
    });
  });

  it("fails as backup.stream_signer_missing when the server has no signing key", async () => {
    await storeStream();
    await suite.db.execute(sql`update nodes set public_key = null`);
    const built = await inTx((tx) => buildBucketPart(tx, context));
    expect(built.part.failure).toEqual(partFailure("en", "backup.stream_signer_missing", {}));
  });
});

describe("the archives part", () => {
  it("carries the archive code for the first bucket destination", async () => {
    await storeArchives();
    const built = await inTx((tx) => buildArchivesPart(tx, context));
    expect(decodeArchiveRecoveryPack(built.file.archiveCode!)).toMatchObject({
      venueId: VENUE,
      recoveryKey: KEY,
      bucket: { bucket: "venue-bucket", prefix: "archives/" },
    });
    expect(built.file.backupKey).toBeUndefined();
    const [stored] = await suite.db.all<{ purpose: string }>(
      sql`select purpose from tenant_credentials where purpose = ${ARCHIVE_PURPOSE}`,
    );
    expect(stored).toBeDefined();
    expect(built.record).toMatchObject({
      part: "archives",
      state: "included",
      keyChangedAt: "2026-09-20T08:00:00.000Z",
      destination: "bucket",
    });
    expect(built.record.settingsRevision).toMatch(/.+/);
    expect(built.part.page!.secret).toEqual({
      label: "Restore code for the archives",
      text: built.file.archiveCode,
      qr: true,
    });
    expect(built.part.page!.notes).toEqual(PART_WORDS.en.archives.stepsBucket);
  });

  it("carries the backup key itself, spaces kept, for a local folder", async () => {
    const spaced = "  correct horse battery staple  ";
    await storeArchives({
      ...ARCHIVES,
      destinations: [{ kind: "local-fs", id: "primary", dir: "/var/backups/venue" }],
    });
    const built = await inTx((tx) =>
      buildArchivesPart(tx, { ...context, env: { WAITRON_BACKUP_RECOVERY_KEY: spaced } }),
    );
    expect(built.file).toEqual({ backupKey: spaced });
    expect(built.record.destination).toBe("folder");
    expect(built.part.page!.secret).toEqual({
      label: "Backup key",
      text: spaced,
      qr: true,
      exactSpaces: true,
    });
    expect(built.part.page!.rows[0]).toEqual({
      label: "Archive folder",
      value: "/var/backups/venue",
    });
    expect(built.part.page!.notes).toEqual(PART_WORDS.en.archives.stepsFolder);
  });

  it("is absent when the box makes no archives", async () => {
    expect((await inTx((tx) => buildArchivesPart(tx, context))).part).toEqual({
      kind: "archives",
      state: "absent",
    });
  });

  it("fails as backup.archive_settings_unreadable when the stored record cannot be read", async () => {
    await inTx((tx) =>
      putCredential(tx, RING, { purpose: ARCHIVE_PURPOSE, value: { settings: "{not json" } }),
    );
    const built = await inTx((tx) => buildArchivesPart(tx, context));
    expect(built.part.failure).toEqual(partFailure("en", "backup.archive_settings_unreadable", {}));
    expect(built.record).toEqual({ part: "archives", state: "failed" });
  });

  it("fails both bucket and archives with the Backups wording when the key is too short", async () => {
    await storeStream();
    await storeArchives();
    const short = { ...context, env: { WAITRON_BACKUP_RECOVERY_KEY: "short" } };
    const words = partFailure("en", "backup.recovery_key_too_short", {});
    expect((await inTx((tx) => buildBucketPart(tx, short))).part.failure).toEqual(words);
    expect((await inTx((tx) => buildArchivesPart(tx, short))).part.failure).toEqual(words);
  });

  it("reads archives the environment manages from the box env", async () => {
    const built = await inTx((tx) =>
      buildArchivesPart(tx, {
        ...context,
        managedByEnvironment: true,
        env: { ...context.env, WAITRON_BACKUP_DIR: "/srv/archives" },
      }),
    );
    expect(built.record).toMatchObject({ state: "included", destination: "folder" });
    expect(built.record).not.toHaveProperty("settingsRevision");
  });
});

describe("the server key part", () => {
  const page = { title: "Server key", rows: [{ label: "Key name", value: "x" }], notes: [] };
  const holder = { kind: "pack" as const, number: 2, madeOn: "2026-09-02", received: true };
  const keyInForce = { name: "2026-09-02 · OLD", holder };
  const newKey = { name: "2026-10-30 · NEW", secret: "AbCdEfGhIjKlMnOpQrStUvWxYz012345" };
  function fiscal(seat: NonNullable<NonNullable<WaitronModule["backup"]>["recoveryPackPage"]>) {
    return { backup: { recoveryPackPage: seat } } as unknown as WaitronModule;
  }
  const node = () => ({ nodeId, locationId: locationId(VENUE) });
  const server = (
    modules: WaitronModule[],
    options: { newKey?: typeof newKey; keyInForce?: ServerKeyInput["keyInForce"] } = {},
  ) => ({
    modules,
    node: node(),
    evidence: {},
    keyInForce: options.keyInForce === undefined ? keyInForce : options.keyInForce,
    ...(options.newKey ? { newKey: options.newKey } : {}),
  });

  it("is absent when no module files invoices", async () => {
    expect((await inTx((tx) => buildServerKeyPart(tx, context, server([])))).part).toEqual({
      kind: "server-key",
      state: "absent",
    });
  });

  it("without a new key, names the key in force and the pack that holds it", async () => {
    const calls: unknown[] = [];
    const built = await inTx((tx) =>
      buildServerKeyPart(
        tx,
        context,
        server([
          fiscal(async (_tx, _node, ctx) => {
            calls.push(ctx);
            return { page };
          }),
        ]),
      ),
    );
    expect(calls).toEqual([
      {
        keyInForce: { nodeId, name: keyInForce.name },
        createdAt: context.madeAt,
        locale: "en",
        evidence: {},
      },
    ]);
    expect(built).toEqual({
      part: {
        kind: "server-key",
        state: "included",
        page,
        lastChanged: "2026-09-02",
        check: keyInForce.name,
        serverKeyLocation: holder,
      },
      record: {
        part: "server-key",
        state: "included",
        keyName: keyInForce.name,
        carriedKey: false,
      },
      file: { serverKey: null, serverKeyName: keyInForce.name },
    });
  });

  it("with a new key, carries the seat's key file and says this pack holds the key", async () => {
    const keyFile = { kind: "waitron-recovery-document" };
    const built = await inTx((tx) =>
      buildServerKeyPart(
        tx,
        context,
        server([fiscal(async () => ({ page, keyFile }))], { newKey }),
      ),
    );
    expect(built.part).toMatchObject({
      state: "included",
      check: newKey.name,
      lastChanged: "2026-10-30",
      serverKeyLocation: { kind: "this-pack" },
    });
    expect(built.record).toEqual({
      part: "server-key",
      state: "included",
      keyName: newKey.name,
      carriedKey: true,
    });
    expect(built.file).toEqual({ serverKey: keyFile, serverKeyName: newKey.name });
  });

  it("refuses a seat that draws a new key but hands back no key file", async () => {
    await expect(
      inTx((tx) =>
        buildServerKeyPart(tx, context, server([fiscal(async () => ({ page }))], { newKey })),
      ),
    ).rejects.toThrow("the server key seat returned no key file");
  });

  it("with no key in force, fails without asking the module", async () => {
    let asked = false;
    const built = await inTx((tx) =>
      buildServerKeyPart(
        tx,
        context,
        server(
          [
            fiscal(async () => {
              asked = true;
              return { page };
            }),
          ],
          { keyInForce: null, newKey },
        ),
      ),
    );
    expect(asked).toBe(false);
    const missing = partFailure("en", "server_key.missing", {});
    expect(built.part).toEqual({
      kind: "server-key",
      state: "failed",
      failure: { what: missing.what, todo: `${missing.todo} ${PART_WORDS.en.keyNotReplaced}` },
    });
    expect(built.part.failure!.todo).not.toContain("still works");
    expect(built.record).toEqual({ part: "server-key", state: "failed", carriedKey: false });
  });

  const refusing = fiscal(async () => {
    throw new AppError("sif.allocation_invalid", { reason: "history_invalid" });
  });
  const cause = partFailure("en", "sif.allocation_invalid", { reason: "history_invalid" });

  it("a refusing seat with a new key ticked fails with its own cause, not replaced, and where the key still is", async () => {
    const built = await inTx((tx) =>
      buildServerKeyPart(tx, context, server([refusing], { newKey })),
    );
    expect(built.part).toEqual({
      kind: "server-key",
      state: "failed",
      failure: {
        what: cause.what,
        todo: `${cause.todo} The server key was not replaced. The current key, on recovery pack 2 made on 2 September 2026, still works.`,
      },
    });
    expect(built.record).toEqual({
      part: "server-key",
      state: "failed",
      keyName: keyInForce.name,
      carriedKey: false,
    });
    expect(built.file).toEqual({ serverKey: null, serverKeyName: keyInForce.name });
  });

  it("a refusing seat without a new key leaves out the not-replaced line", async () => {
    const built = await inTx((tx) => buildServerKeyPart(tx, context, server([refusing])));
    expect(built.part.failure!.todo).toBe(
      `${cause.todo} The current key, on recovery pack 2 made on 2 September 2026, still works.`,
    );
  });

  it.each([
    [
      { kind: "pack" as const, number: 4, madeOn: "2026-10-01", received: false },
      "The current server key is on recovery pack 4, made on 1 October 2026, which never reached a browser. If you do not have pack 4, make a new pack with Also make a new server key ticked.",
    ],
    [
      { kind: "sheet" as const, keyName: "2026-09-02 · OLD", madeOn: "2026-09-02" },
      "The current key, on the recovery sheet whose key name is 2026-09-02 · OLD, made on 2 September 2026, still works.",
    ],
  ])("a refusing seat names a holder of kind %j in its own words", async (where, line) => {
    const built = await inTx((tx) =>
      buildServerKeyPart(
        tx,
        context,
        server([refusing], { keyInForce: { name: keyInForce.name, holder: where } }),
      ),
    );
    expect(built.part.failure!.todo).toBe(`${cause.todo} ${line}`);
  });

  it("a seat that fails with something other than a refusal gets the general words", async () => {
    const built = await inTx((tx) =>
      buildServerKeyPart(
        tx,
        context,
        server([
          fiscal(async () => {
            throw new Error("boom");
          }),
        ]),
      ),
    );
    expect(built.part.failure!.what).toBe(PART_WORDS.en.general.what);
  });
});

describe("the server key's page number on the other pages", () => {
  const included = (kind: "bucket" | "archives" | "server-key") => ({
    part: {
      kind,
      state: "included" as const,
      page: { title: kind, intro: "Intro.", rows: [], notes: [] },
    },
    record: { part: kind, state: "included" as const },
    file: {},
  });

  it("tells the bucket and archive pages which page holds the server key", () => {
    const [bucket, archives] = withServerKeyPageNumber(
      [included("bucket"), included("archives"), included("server-key")],
      "en",
    );
    expect(bucket!.part.page!.intro).toBe(
      "Intro. It also needs the server key: page 4, or the pack it names.",
    );
    expect(archives!.part.page!.intro).toBe(bucket!.part.page!.intro);
  });

  it("counts only the parts that have a page", () => {
    const [, archives] = withServerKeyPageNumber(
      [
        {
          part: { kind: "bucket", state: "absent" },
          record: { part: "bucket", state: "absent" },
          file: {},
        },
        included("archives"),
        included("server-key"),
      ],
      "es",
    );
    expect(archives!.part.page!.intro).toBe(
      "Intro. También necesita la clave del servidor: página 3, o el paquete que esta indica.",
    );
  });

  it("adds nothing when the venue files no invoices", () => {
    const parts = [
      included("bucket"),
      {
        part: { kind: "server-key" as const, state: "absent" as const },
        record: { part: "server-key" as const, state: "absent" as const },
        file: {},
      },
    ];
    expect(withServerKeyPageNumber(parts, "en")[0]!.part.page!.intro).toBe("Intro.");
  });
});
