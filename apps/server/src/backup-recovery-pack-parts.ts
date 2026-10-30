import { createHash } from "node:crypto";
import type { KeyRing } from "@waitron/credentials";
import { credentialRevision } from "@waitron/credentials";
import { readNodePublicKeyTx, type RecoveryPackPartRecord, type Transaction } from "@waitron/db";
import type { ProvisionedNode, RecoveryPackPageResult, WaitronModule } from "@waitron/module";
import {
  PART_WORDS,
  packDates,
  packPageNumbers,
  partFailure,
  type PackLocale,
  type PackPart,
  type PartFailure,
  type RecoveryPackFile,
  type ServerKeyHolder,
  type ServerKeyLocation,
} from "@waitron/recovery-pack";
import { AppError, isAppError } from "@waitron/shared";
import { encodeRecoveryKit } from "@waitron/stream";
import { encodeArchiveRecoveryPack } from "./archive-recovery-pack.js";
import {
  archiveNamespace,
  readHeldArchiveSettingsIn,
  type ArchiveSettings,
} from "./archive-settings.js";
import {
  archiveDestinations,
  loadKeyRotatedAt,
  loadRecoveryKey,
  readHeldKey,
} from "./backup-config.js";
import { MIN_PASSPHRASE_LENGTH } from "./recovery-bundle.js";
import type { BackupDestination } from "./storage-backend.js";
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
  Pick<
    RecoveryPackFile,
    "bucketCode" | "archiveCode" | "backupKey" | "serverKey" | "serverKeyName" | "serverKeyHeldBy"
  >
>;

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
      failedWith: code === "" ? "unexpected" : code,
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
    record: rotatedAt === undefined ? { keyChangedAt, keyNeverChanged: true } : { keyChangedAt },
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
    const pointerSignerPublicKey = await readNodePublicKeyTx(tx, context.nodeId);
    if (pointerSignerPublicKey === null) {
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
        ...facts.record,
        settingsRevision: revision,
      },
      file: { bucketCode },
    };
  });
}

/**
 * What a pack's archive check compares: the stored record's revision, or, for archives the
 * environment manages, a digest of where they go. Weaker than it looks for the environment's: the
 * record travels into every backup, so credentials stay out of the digest and a change of access key
 * alone is not seen.
 */
export function archivesRevision(
  sealed: ArchiveSettings | null,
  destinations: readonly BackupDestination[],
): string {
  if (sealed !== null) return sealed.revision;
  const where = destinations.map((d) =>
    d.kind === "local-fs"
      ? { kind: d.kind, dir: d.dir }
      : {
          kind: d.kind,
          venueId: d.venueId,
          endpoint: d.bucket.endpoint ?? null,
          region: d.bucket.region,
          bucket: d.bucket.bucket,
          prefix: d.bucket.prefix,
        },
  );
  // The prefix keeps it apart from a stored record's revision, which is a UUID.
  return `env:${createHash("sha256").update(JSON.stringify(where)).digest("hex").slice(0, 16)}`;
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
    const revision = archivesRevision(sealed, destinations);
    const facts = keyFacts(context, sealed?.revision);
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

/** The key in force and where it is printed. */
export type KeyInForce = { readonly name: string; readonly holder: KeyHolder };

function heldBy(holder: KeyHolder): ServerKeyHolder | null {
  return holder.kind === "pack"
    ? { number: holder.number, madeOn: holder.madeOn, received: holder.received }
    : null;
}

/**
 * The module that draws the server-key page and its evidence, read before the transaction; `null`
 * when no module draws it; a refusal fails that page alone.
 */
export type ServerKeySeat =
  | null
  | { readonly module: WaitronModule; readonly evidence: Readonly<Record<string, unknown>> }
  | { readonly refused: unknown };

export async function serverKeySeat(
  modules: readonly WaitronModule[],
  readEvidence: (module: WaitronModule) => Promise<Readonly<Record<string, unknown>>>,
): Promise<ServerKeySeat> {
  const owners = modules.filter((m) => m.backup?.recoveryPackPage !== undefined);
  if (owners.length === 0) return null;
  try {
    if (owners.length > 1) {
      throw new AppError("recovery.pack_invalid", { reason: "module_unsupported" });
    }
    return { module: owners[0]!, evidence: await readEvidence(owners[0]!) };
  } catch (error) {
    return { refused: error };
  }
}

export type ServerKeyInput = {
  readonly seat: ServerKeySeat;
  readonly node: ProvisionedNode;
  /** `null` when the box has no server key. */
  readonly keyInForce: KeyInForce | null;
  readonly newKey?: { readonly name: string; readonly secret: string };
};

export async function buildServerKeyPart(
  tx: Transaction,
  context: PartsContext,
  input: ServerKeyInput,
): Promise<BuiltPart> {
  const { seat } = input;
  if (seat === null) return absent("server-key");
  const words = PART_WORDS[context.locale];
  const { keyInForce, newKey } = input;
  const failed = (cause: PartFailure, failedWith: string): BuiltPart => {
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
      file:
        keyInForce === null
          ? {}
          : {
              serverKey: null,
              serverKeyName: keyInForce.name,
              serverKeyHeldBy: heldBy(keyInForce.holder),
            },
      failedWith,
    };
  };
  const refused = (error: unknown): BuiltPart => {
    const { code, params } = refusal(error);
    return failed(partFailure(context.locale, code, params), code === "" ? "unexpected" : code);
  };
  if (keyInForce === null) return failed(words.noServerKey, "no_server_key");
  if ("refused" in seat) return refused(seat.refused);
  let drawn: RecoveryPackPageResult;
  try {
    drawn = await seat.module.backup!.recoveryPackPage!(tx, input.node, {
      keyInForce: { nodeId: context.nodeId, name: keyInForce.name },
      ...(newKey === undefined ? {} : { newKey }),
      createdAt: context.madeAt,
      locale: context.locale,
      evidence: seat.evidence,
    });
  } catch (error) {
    return refused(error);
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
      serverKeyHeldBy: newKey === undefined ? heldBy(keyInForce.holder) : null,
    },
  };
}

/** Tells the bucket and archive pages which page holds the server key, once every part is built. */
export function withServerKeyPageNumber(parts: BuiltPart[], locale: PackLocale): BuiltPart[] {
  const serverKeyPage = [...packPageNumbers(parts.map((p) => p.part))].find(
    ([part]) => part.kind === "server-key",
  )?.[1];
  if (serverKeyPage === undefined) return parts;
  const sentence = PART_WORDS[locale].alsoServerKey(serverKeyPage);
  return parts.map((built) => {
    const page = built.part.page;
    if (built.part.kind === "server-key" || page === undefined) return built;
    const intro = page.intro === undefined ? sentence : `${page.intro} ${sentence}`;
    return { ...built, part: { ...built.part, page: { ...page, intro } } };
  });
}
