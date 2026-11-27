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
import {
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

