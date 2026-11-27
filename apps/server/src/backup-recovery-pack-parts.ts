import type { KeyRing } from "@waitron/credentials";
import { credentialRevision } from "@waitron/credentials";
import { readNodePublicKeyTx, type RecoveryPackPartRecord, type Transaction } from "@waitron/db";
import {
  PART_WORDS,
  packDates,
  partFailure,
  type PackLocale,
  type PackPart,
  type RecoveryPackFile,
} from "@waitron/recovery-pack";
import { AppError, isAppError } from "@waitron/shared";
import { encodeRecoveryKit } from "@waitron/stream";
import { encodeArchiveRecoveryPack } from "./archive-recovery-pack.js";
import { archiveNamespace, readHeldArchiveSettingsIn } from "./archive-settings.js";
import {
  archiveDestinations,
  loadKeyRotatedAt,
  loadRecoveryKey,
  readHeldKey,
} from "./backup-config.js";
import { MIN_RECOVERY_KEY_LENGTH } from "./backup-config.js";
import { readStreamSettingsIn, STREAM_PURPOSE } from "./stream-host.js";
import "./errors.js";

/** What every part builder needs; the box env is read before the transaction opens. */
export type PartsContext = {
  readonly locale: PackLocale;
  readonly timeZone: string;
  /** The pack's own time, standing in for a backup key that was never changed. */
  readonly madeAt: string;
  readonly nodeId: string;
  readonly ring: KeyRing;
  readonly env: Readonly<Record<string, string | undefined>>;
};

type FileFields = Partial<Pick<RecoveryPackFile, "bucketCode" | "archiveCode" | "backupKey">>;

export type BuiltPart = {
  readonly part: PackPart;
  readonly record: RecoveryPackPartRecord;
  readonly file: FileFields;
  /** For the log only: a refusal's code, `unexpected` for any other error, never a message. */
  readonly failedWith?: string;
};

type Kind = PackPart["kind"];

function absent(kind: Kind): BuiltPart {
  return { part: { kind, state: "absent" }, record: { part: kind, state: "absent" }, file: {} };
}

export function notSetUp(kind: Kind): BuiltPart {
  return {
    part: { kind, state: "not-set-up" },
    record: { part: kind, state: "not-set-up" },
    file: {},
  };
}

/** A part whose read refused becomes a failed page keyed by the refusal's real code. */
async function orFailed(
  kind: Kind,
  context: PartsContext,
  build: () => Promise<BuiltPart>,
): Promise<BuiltPart> {
  try {
    return await build();
  } catch (error) {
    const code = isAppError(error) ? error.code : "";
    return {
      part: { kind, state: "failed", failure: partFailure(context.locale, code) },
      record: { part: kind, state: "failed" },
      file: {},
      failedWith: code === "" ? "unexpected" : code,
    };
  }
}

async function backupKey(env: PartsContext["env"]): Promise<string> {
  const { held, key } = await readHeldKey(async () => loadRecoveryKey(env));
  if (!held) throw new AppError("backup.recovery_key_missing", {});
  if (key === undefined) {
    throw new AppError("backup.recovery_key_too_short", { min: MIN_RECOVERY_KEY_LENGTH });
  }
  return key;
}

function keyFacts(context: PartsContext) {
  const rotatedAt = loadKeyRotatedAt(context.env);
  const keyChangedAt = rotatedAt ?? context.madeAt;
  const words = PART_WORDS[context.locale];
  const when = packDates(context.locale, context.timeZone);
  return {
    record: rotatedAt === undefined ? { keyChangedAt, keyNeverChanged: true } : { keyChangedAt },
    rows:
      rotatedAt === undefined
        ? []
        : [{ label: words.keyRow, value: words.keyChangedOn(when.longAt(rotatedAt)) }],
  };
}

function bucketPlace(bucket: { endpoint?: string; region: string; bucket: string }): string {
  return `${bucket.endpoint === undefined ? bucket.region : new URL(bucket.endpoint).host} · ${bucket.bucket}`;
}

export function buildBucketPart(tx: Transaction, context: PartsContext): Promise<BuiltPart> {
  return orFailed("bucket", context, async () => {
    const settings = await readStreamSettingsIn(tx, context.ring);
    if (settings === null) return absent("bucket");
    const recoveryKey = await backupKey(context.env);
    const pointerSignerPublicKey = await readNodePublicKeyTx(tx, context.nodeId);
    if (pointerSignerPublicKey === null) {
      throw new AppError("backup.stream_signer_missing", {});
    }
    const bucketCode = encodeRecoveryKit({
      version: 2,
      streamId: settings.streamId,
      bucket: settings.bucket,
      recoveryKey,
      pointerSignerPublicKey,
    });
    const revision = (await credentialRevision(tx, { purpose: STREAM_PURPOSE }))!;
    const facts = keyFacts(context);
    const words = PART_WORDS[context.locale].bucket;
    return {
      part: {
        kind: "bucket",
        state: "included",
        page: {
          title: words.title,
          intro: words.intro,
          secret: { label: words.codeLabel, text: bucketCode, qr: true },
          rows: [
            { label: words.bucketRow, value: bucketPlace(settings.bucket), mono: true },
            ...facts.rows,
          ],
          notes: [...words.steps],
        },
      },
      record: {
        part: "bucket",
        state: "included",
        ...facts.record,
        settingsRevision: revision,
      },
      file: { bucketCode },
    };
  });
}

export function buildArchivesPart(tx: Transaction, context: PartsContext): Promise<BuiltPart> {
  return orFailed("archives", context, async () => {
    const read = await readHeldArchiveSettingsIn(tx, context.ring);
    if ("unreadable" in read) {
      throw new AppError("backup.archive_settings_unreadable", { reason: read.unreadable });
    }
    const sealed = read.settings;
    if (sealed === null) return absent("archives");
    const destinations = archiveDestinations(sealed);
    const bucket = destinations.find((d) => d.kind === "s3");
    const folder = destinations.find((d) => d.kind === "local-fs");
    const recoveryKey = await backupKey(context.env);
    const revision = sealed.revision;
    const facts = keyFacts(context);
    const words = PART_WORDS[context.locale].archives;
    const record: RecoveryPackPartRecord = {
      part: "archives",
      state: "included",
      ...facts.record,
      settingsRevision: revision,
      destination: bucket === undefined ? "folder" : "bucket",
    };
    const part = {
      kind: "archives",
      state: "included",
    } as const;
    if (bucket !== undefined) {
      const archivePrefix = archiveNamespace(bucket.bucket.prefix);
      const archiveCode = encodeArchiveRecoveryPack({
        version: 1,
        format: "WBK1",
        bucket: bucket.bucket,
        archivePrefix,
        recoveryKey,
      });
      return {
        part: {
          ...part,
          page: {
            title: words.title,
            intro: words.introBucket,
            secret: { label: words.codeLabel, text: archiveCode, qr: true },
            rows: [
              {
                label: words.folderRow,
                value: `${bucket.bucket.bucket} / ${archivePrefix}`,
                mono: true,
              },
              ...facts.rows,
            ],
            notes: [...words.stepsBucket],
          },
        },
        record,
        file: { archiveCode },
      };
    }
    return {
      part: {
        ...part,
        page: {
          title: words.title,
          intro: words.introFolder,
          secret: { label: words.keyLabel, text: recoveryKey, qr: true, exactSpaces: true },
          rows: [{ label: words.folderRow, value: folder!.dir, mono: true }, ...facts.rows],
          notes: [...words.stepsFolder],
        },
      },
      record,
      file: { backupKey: recoveryKey },
    };
  });
}
