import type { KeyRing } from "@waitron/credentials";
import { credentialRevision } from "@waitron/credentials";
import {
  readMembershipTrustSetIn,
  type RecoveryPackPartRecord,
  type Transaction,
} from "@waitron/db";
import type { ProvisionedNode, WaitronModule } from "@waitron/module";
import {
  PART_WORDS,
  packDates,
  partFailure,
  type PackLocale,
  type PackPart,
  type RecoveryPackFile,
  type ServerKeyLocation,
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
import { MIN_PASSPHRASE_LENGTH } from "./recovery-bundle.js";
import { readStreamSettingsIn, STREAM_PURPOSE } from "./stream-host.js";
import "./errors.js";

/** What every part builder needs; the box env is read before the transaction opens. */
export type PartsContext = {
  readonly locale: PackLocale;
  readonly timeZone: string;
  /** The pack's own time, standing in for a backup key that was never changed. */
  readonly madeAt: string;
  readonly nodeId: string;
  readonly venueId: string;
  readonly ring: KeyRing;
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly managedByEnvironment: boolean;
};

type FileFields = Partial<
  Pick<RecoveryPackFile, "bucketCode" | "archiveCode" | "backupKey" | "serverKey" | "serverKeyName">
>;

export type BuiltPart = {
  readonly part: PackPart;
  readonly record: RecoveryPackPartRecord;
  readonly file: FileFields;
};

type Kind = PackPart["kind"];

function absent(kind: Kind): BuiltPart {
  return { part: { kind, state: "absent" }, record: { part: kind, state: "absent" }, file: {} };
}

function refusal(error: unknown): { code: string; params: Readonly<Record<string, unknown>> } {
  return isAppError(error)
    ? { code: error.code, params: (error.params ?? {}) as Record<string, unknown> }
    : { code: "", params: {} };
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
    const { code, params } = refusal(error);
    return {
      part: { kind, state: "failed", failure: partFailure(context.locale, code, params) },
      record: { part: kind, state: "failed" },
      file: {},
    };
  }
}

/** The day `instant` falls on in the venue's zone, `YYYY-MM-DD`. */
export function dayIn(timeZone: string, instant: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone, dateStyle: "short" }).format(
    new Date(instant),
  );
}

async function backupKey(env: PartsContext["env"]): Promise<string> {
  const { held, key } = await readHeldKey(async () => loadRecoveryKey(env));
  if (!held) throw new AppError("backup.recovery_key_missing", {});
  if (key === undefined) {
    throw new AppError("backup.recovery_key_too_short", { min: MIN_PASSPHRASE_LENGTH });
  }
  return key;
}

function keyFacts(context: PartsContext, revision: string | undefined) {
  const rotatedAt = loadKeyRotatedAt(context.env);
  const keyChangedAt = rotatedAt ?? context.madeAt;
  const words = PART_WORDS[context.locale];
  const when = packDates(context.locale, context.timeZone);
  const lastChanged = dayIn(context.timeZone, keyChangedAt);
  return {
    keyChangedAt,
    lastChanged,
    check: words.check(when.shortDay(lastChanged), revision),
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
    const pointerSignerPublicKey = (await readMembershipTrustSetIn(tx))[context.nodeId];
    if (pointerSignerPublicKey === undefined) {
      throw new AppError("backup.stream_signer_missing", {});
    }
    const bucketCode = encodeRecoveryKit({
      version: 1,
      venueId: settings.venueId,
      bucket: settings.bucket,
      recoveryKey,
      pointerSignerPublicKey,
    });
    const revision = (await credentialRevision(tx, { purpose: STREAM_PURPOSE }))!;
    const facts = keyFacts(context, revision);
    const words = PART_WORDS[context.locale].bucket;
    return {
      part: {
        kind: "bucket",
        state: "included",
        lastChanged: facts.lastChanged,
        check: facts.check,
        page: {
          title: words.title,
          intro: words.intro,
          secret: { label: words.codeLabel, text: bucketCode, qr: true },
          rows: [{ label: words.bucketRow, value: bucketPlace(settings.bucket) }, ...facts.rows],
          notes: [...words.steps],
        },
      },
      record: {
        part: "bucket",
        state: "included",
        keyChangedAt: facts.keyChangedAt,
        settingsRevision: revision,
      },
      file: { bucketCode },
    };
  });
}

export function buildArchivesPart(tx: Transaction, context: PartsContext): Promise<BuiltPart> {
  return orFailed("archives", context, async () => {
    let sealed = null;
    if (!context.managedByEnvironment) {
      const read = await readHeldArchiveSettingsIn(tx, context.ring);
      if ("unreadable" in read) {
        throw new AppError("backup.archive_settings_unreadable", { reason: read.unreadable });
      }
      sealed = read.settings;
    }
    const destinations = archiveDestinations({
      managedByEnvironment: context.managedByEnvironment,
      env: context.env,
      sealed,
      venueId: context.venueId,
    });
    const bucket = destinations.find((d) => d.kind === "s3");
    const folder = destinations.find((d) => d.kind === "local-fs");
    if (bucket === undefined && folder === undefined) return absent("archives");
    const recoveryKey = await backupKey(context.env);
    const facts = keyFacts(context, sealed?.revision);
    const words = PART_WORDS[context.locale].archives;
    const record: RecoveryPackPartRecord = {
      part: "archives",
      state: "included",
      keyChangedAt: facts.keyChangedAt,
      ...(sealed === null ? {} : { settingsRevision: sealed.revision }),
      destination: bucket === undefined ? "folder" : "bucket",
    };
    const part = {
      kind: "archives",
      state: "included",
      lastChanged: facts.lastChanged,
      check: facts.check,
    } as const;
    if (bucket !== undefined) {
      const archivePrefix = archiveNamespace(bucket.bucket.prefix, bucket.venueId);
      const archiveCode = encodeArchiveRecoveryPack({
        version: 1,
        format: "WBK1",
        venueId: bucket.venueId,
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
              { label: words.folderRow, value: `${bucket.bucket.bucket} / ${archivePrefix}` },
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
          rows: [{ label: words.folderRow, value: folder!.dir }, ...facts.rows],
          notes: [...words.stepsFolder],
        },
      },
      record,
      file: { backupKey: recoveryKey },
    };
  });
}

export type KeyHolder = Exclude<ServerKeyLocation, { kind: "this-pack" }>;

export type ServerKeyInput = {
  readonly modules: readonly WaitronModule[];
  readonly node: ProvisionedNode;
  readonly evidence: Readonly<Record<string, unknown>>;
  /** The key the box holds now and where it is printed; `null` when the box has none. */
  readonly keyInForce: { readonly name: string; readonly holder: KeyHolder } | null;
  readonly newKey?: { readonly name: string; readonly secret: string };
};

export async function buildServerKeyPart(
  tx: Transaction,
  context: PartsContext,
  input: ServerKeyInput,
): Promise<BuiltPart> {
  const owner = input.modules.find((m) => m.backup?.recoveryPackPage !== undefined);
  if (owner === undefined) return absent("server-key");
  const words = PART_WORDS[context.locale];
  const { keyInForce, newKey } = input;
  const failed = (code: string, params: Readonly<Record<string, unknown>>): BuiltPart => {
    const cause = partFailure(context.locale, code, params);
    const lines = [cause.todo];
    if (newKey !== undefined) lines.push(words.keyNotReplaced);
    if (keyInForce !== null) {
      const { holder } = keyInForce;
      const day = packDates(context.locale, context.timeZone).longDay(holder.madeOn);
      lines.push(
        holder.kind === "sheet"
          ? words.currentKeyOnSheet(holder.keyName, day)
          : (holder.received ? words.currentKeyOnPack : words.currentKeyOnUnreceivedPack)(
              holder.number,
              day,
            ),
      );
    }
    return {
      part: {
        kind: "server-key",
        state: "failed",
        failure: { what: cause.what, todo: lines.join(" ") },
      },
      record: {
        part: "server-key",
        state: "failed",
        ...(keyInForce === null ? {} : { keyName: keyInForce.name }),
        carriedKey: false,
      },
      file: keyInForce === null ? {} : { serverKey: null, serverKeyName: keyInForce.name },
    };
  };
  if (keyInForce === null) return failed("server_key.missing", {});
  let drawn: Awaited<
    ReturnType<NonNullable<NonNullable<WaitronModule["backup"]>["recoveryPackPage"]>>
  >;
  try {
    drawn = await owner.backup!.recoveryPackPage!(tx, input.node, {
      keyInForce: { nodeId: context.nodeId, name: keyInForce.name },
      ...(newKey === undefined ? {} : { newKey }),
      createdAt: context.madeAt,
      locale: context.locale,
      evidence: input.evidence,
    });
  } catch (error) {
    const { code, params } = refusal(error);
    return failed(code, params);
  }
  if (newKey !== undefined && drawn.keyFile === undefined) {
    throw new Error("the server key seat returned no key file");
  }
  const name = newKey?.name ?? keyInForce.name;
  return {
    part: {
      kind: "server-key",
      state: "included",
      page: drawn.page,
      lastChanged: name.slice(0, 10),
      check: name,
      serverKeyLocation: newKey === undefined ? keyInForce.holder : { kind: "this-pack" },
    },
    record: {
      part: "server-key",
      state: "included",
      keyName: name,
      carriedKey: newKey !== undefined,
    },
    file: {
      serverKey: (drawn.keyFile as Record<string, unknown> | undefined) ?? null,
      serverKeyName: name,
    },
  };
}

/** Tells the bucket and archive pages which page holds the server key, once every part is built. */
export function withServerKeyPageNumber(parts: BuiltPart[], locale: PackLocale): BuiltPart[] {
  const paged = parts.filter((p) => p.part.state === "included" || p.part.state === "failed");
  const serverKey = paged.findIndex((p) => p.part.kind === "server-key");
  if (serverKey === -1) return parts;
  const sentence = PART_WORDS[locale].alsoServerKey(serverKey + 2);
  return parts.map((built) => {
    const page = built.part.page;
    if (built.part.kind === "server-key" || page === undefined) return built;
    const intro = page.intro === undefined ? sentence : `${page.intro} ${sentence}`;
    return { ...built, part: { ...built.part, page: { ...page, intro } } };
  });
}
