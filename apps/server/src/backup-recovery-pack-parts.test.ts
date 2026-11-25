import { storeArchivePart } from "./testing/backup-settings.js";
import { beforeEach, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { credentialRevision, loadKeyRing } from "@waitron/credentials";
import { saveVenueFields, setNodePublicKey, withTransaction, type Transaction } from "@waitron/db";
import { seedNode, seedVenue } from "@waitron/db/testing/seed.js";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { PART_WORDS, partFailure } from "@waitron/recovery-pack";
import type { NodeId } from "@waitron/shared";
import { parseRecoveryKit } from "@waitron/stream";
import { decodeArchiveRecoveryPack } from "./archive-recovery-pack.js";
import { ARCHIVE_PURPOSE, writeArchiveSettings, type ArchiveSettings } from "./archive-settings.js";
import {
  buildEmergencyPart,
  buildArchivesPart,
  buildBucketPart,
  type PartsContext,
} from "./backup-recovery-pack-parts.js";
import { STREAM_PURPOSE, writeStreamSettings } from "./stream-host.js";

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
  cloud: false,
  destinations: [{ kind: "s3", id: "bucket", bucket: { ...BUCKET, prefix: "archives/" } }],
  schedule: { kind: "wall-clock", days: "daily", at: { hour: 3, minute: 30 } },
  retention: { count: 7, days: 30 },
  destinationTimeoutMs: 15 * 60 * 1000,
};

const suite = useVenueDb({ migrations: migrationOptionsFor(manifestSets(), null) });
let nodeId: NodeId;
let context: PartsContext;

beforeEach(async () => {
  await seedVenue(suite.db, {
    name: "Sala",
    invoiceLocales: ["es"],
  });
  await withTransaction(suite.db, (tx) => saveVenueFields(tx, { streamId: VENUE }, null));
  nodeId = await seedNode(suite.db);
  await setNodePublicKey(suite.db, nodeId, "SIGNER_PUBLIC_KEY");
  context = {
    locale: "en",
    timeZone: "Europe/Madrid",
    madeAt: "2026-10-30T09:00:00.000Z",
    nodeId,
    ring: RING,
    env: {
      WAITRON_BACKUP_RECOVERY_KEY: KEY,
      WAITRON_BACKUP_KEY_ROTATED_AT: "2026-09-20T08:00:00.000Z",
    },
  };
});

const inTx = <T>(body: (tx: Transaction) => Promise<T>) => withTransaction(suite.db, body);
const storeStream = () => inTx((tx) => writeStreamSettings(tx, RING, BUCKET, null));
const storeArchives = (settings: Omit<ArchiveSettings, "revision"> = ARCHIVES) =>
  inTx((tx) => writeArchiveSettings(tx, RING, settings, null));

describe("the bucket part", () => {
  it("carries the restore code for the stored bucket, the backup key and the server's signing key", async () => {
    await storeStream();
    const built = await inTx((tx) => buildBucketPart(tx, context));
    expect(parseRecoveryKit(built.file.bucketCode!)).toEqual({
      version: 2 as const,
      streamId: VENUE,
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
    });
    const page = built.part.page!;
    expect(page.secret).toEqual({
      label: "Restore code for the bucket copy",
      text: built.file.bucketCode,
      qr: true,
    });
    expect(page.rows).toEqual([
      { label: "Bucket", value: "eu-west-1 · venue-bucket", mono: true },
      { label: "Backup encryption key", value: "changed on 20 September 2026" },
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
    expect(built.record.keyNeverChanged).toBe(true);
    expect(built.part.page!.rows).toHaveLength(1);
  });

  it("names the bucket's own address when it has one, in Spanish", async () => {
    await inTx((tx) =>
      writeStreamSettings(tx, RING, { ...BUCKET, endpoint: "https://s3.example.net:9000" }, null),
    );
    const built = await inTx((tx) => buildBucketPart(tx, { ...context, locale: "es" }));
    expect(built.part.page!.rows[0]).toEqual({
      label: "Bucket",
      value: "s3.example.net:9000 · venue-bucket",
      mono: true,
    });
    expect(built.part.page!.title).toBe("Copia en el bucket");
    expect(built.part.page!.rows[1]?.label).toBe("Clave de cifrado de copias");
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
      part: { kind: "bucket", state: "failed", failure: partFailure("en", code) },
      record: { part: "bucket", state: "failed" },
      file: {},
      failedWith: code,
    });
  });

  it("fails as backup.stream_signer_missing when the server has no signing key", async () => {
    await storeStream();
    await suite.db.execute(sql`update nodes set public_key = null`);
    const built = await inTx((tx) => buildBucketPart(tx, context));
    expect(built.part.failure).toEqual(partFailure("en", "backup.stream_signer_missing"));
  });
});

describe("the archives part", () => {
  it("carries the archive code for the first bucket destination", async () => {
    await storeArchives();
    const built = await inTx((tx) => buildArchivesPart(tx, context));
    expect(decodeArchiveRecoveryPack(built.file.archiveCode!)).toMatchObject({
      recoveryKey: KEY,
      archivePrefix: "archives/",
      bucket: { bucket: "venue-bucket", prefix: "archives/" },
    });
    expect(built.file.backupKey).toBeUndefined();
    const [stored] = await suite.db.all<{ purpose: string }>(
      sql`select purpose from venue_credentials where purpose = ${ARCHIVE_PURPOSE}`,
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
      label: "Backup encryption key",
      text: spaced,
      qr: true,
      exactSpaces: true,
    });
    expect(built.part.page!.rows[0]).toEqual({
      label: "Archive folder",
      value: "/var/backups/venue",
      mono: true,
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
    await inTx((tx) => storeArchivePart(tx, {}));
    const built = await inTx((tx) => buildArchivesPart(tx, context));
    expect(built.part.failure).toEqual(partFailure("en", "backup.archive_settings_unreadable"));
    expect(built.record).toEqual({ part: "archives", state: "failed" });
    expect(built.failedWith).toBe("backup.archive_settings_unreadable");
  });

  it("fails both bucket and archives with the Backups wording when the key is too short", async () => {
    await storeStream();
    await storeArchives();
    const short = { ...context, env: { WAITRON_BACKUP_RECOVERY_KEY: "short" } };
    const words = partFailure("en", "backup.recovery_key_too_short");
    expect((await inTx((tx) => buildBucketPart(tx, short))).part.failure).toEqual(words);
    expect((await inTx((tx) => buildArchivesPart(tx, short))).part.failure).toEqual(words);
  });

  it("carries the whole archive code for a switched-off record's bucket, listed after its folder", async () => {
    const bucket = { ...BUCKET, prefix: "archives/" };
    await storeArchives({
      ...ARCHIVES,
      enabled: false,
      destinations: [
        { kind: "local-fs", id: "primary", dir: "/var/backups/venue" },
        { kind: "s3", id: "bucket", bucket },
      ],
    });
    const built = await inTx((tx) => buildArchivesPart(tx, context));
    expect(built.record.destination).toBe("bucket");
    expect(decodeArchiveRecoveryPack(built.file.archiveCode!)).toEqual({
      version: 1,
      format: "WBK1",
      bucket,
      archivePrefix: "archives/",
      recoveryKey: KEY,
    });
  });

  it("with no backup key, says archives are absent when there are none and names an unreadable record", async () => {
    const keyless = { ...context, env: {} };
    expect((await inTx((tx) => buildArchivesPart(tx, keyless))).part.state).toBe("absent");
    await inTx((tx) => storeArchivePart(tx, {}));
    expect((await inTx((tx) => buildArchivesPart(tx, keyless))).failedWith).toBe(
      "backup.archive_settings_unreadable",
    );
  });
});

it("keeps both authenticator groups", async () => {
  const emergency = buildEmergencyPart(
    context,
    {
      state: "included",
      code: {
        version: 1,
        installationId: "i",
        venueId: "v",
        countryCode: "ES",
        asOf: context.madeAt,
        codeIssuedAt: "2026-10-20T08:00:00.000Z",
        address: "https://rescue.venue.example/",
        code: "ABCD-EFGH-JKLM-NPQR-STUV-WXYZ",
      },
    },
    [
      { personId: "ready", displayName: "Alex Smith", hasAuthenticator: true },
      { personId: "not-enrolled", displayName: "Robin Jones", hasAuthenticator: false },
    ],
  );
  expect(emergency.part.page!.rows).toEqual([
    { label: "Code issued", value: "20 October 2026 10:00" },
    { label: "Have permission and an authenticator", value: "Alex Smith" },
    { label: "Need to set up an authenticator first", value: "Robin Jones" },
  ]);
  expect(emergency.part.page!.intro).toBe(
    "This code starts a locked copy of the venue. Sign in with your password and your authenticator or a recovery code. Passkeys do not work there.",
  );
});
