import { randomUUID } from "node:crypto";
import { TLSSocket } from "node:tls";
import { eq, inArray } from "drizzle-orm";
import type { Context, Hono } from "hono";
import { credentialRevision, type KeyRing } from "@waitron/credentials";
import {
  insertRecoveryPack,
  locations,
  markRecoveryPackReceived,
  nextRecoveryPackNumber,
  readBreakGlassKeyName,
  readRecoveryPack,
  readRecoveryPacks,
  readTenant,
  setBreakGlassVerifierTx,
  withTransaction,
  type Database,
  type Transaction,
} from "@waitron/db";
import {
  authorizeManager,
  beginOwnPasskeyCheck,
  hashSecret,
  persons,
  type TotpKeyRing,
} from "@waitron/identity";
import type { ProvisionedNode, WaitronModule } from "@waitron/module";
import { generatePassword } from "@waitron/provisioning";
import { renderRecoveryPack, type PackLocale } from "@waitron/recovery-pack";
import {
  createErrorBoundary,
  readRawJsonBody,
  requireManagementSession,
} from "@waitron/server-kit";
import { AppError } from "@waitron/shared";
import { readHeldArchiveSettingsIn, type ArchiveSettings } from "./archive-settings.js";
import { inTurn } from "./attempt-turns.js";
import {
  archiveDestinations,
  loadKeyRotatedAt,
  loadRecoveryKey,
  readHeldKey,
} from "./backup-config.js";
import {
  archivesRevision,
  buildArchivesPart,
  buildBucketPart,
  buildServerKeyPart,
  dayIn,
  serverKeySeat,
  withServerKeyPageNumber,
  type BuiltPart,
  type KeyInForce,
  type PartsContext,
  type ServerKeySeat,
} from "./backup-recovery-pack-parts.js";
import { carriesServerKey, packStatus, type CurrentChecks } from "./backup-recovery-pack-status.js";
import type { BackupRuntimeStatus } from "./backup-supervisor.js";
import type { Turns } from "./backup-turns.js";
import { confirmFreshSignIn } from "./fresh-sign-in.js";
import type { Logger } from "./logger.js";
import { createPasswordThrottle } from "./password-throttle.js";
import type { RecoveryDocumentEvidence } from "./recovery-document-evidence.js";
import { STREAM_PURPOSE } from "./stream-host.js";
import "./errors.js";

export interface BackupRecoveryPackApiDeps {
  db: Database;
  /** The WebAuthn Relying Party ID passkeys are bound to (`config.ts`'s `managementRpId`). */
  rpId: string;
}

const run = createErrorBoundary(
  {
    "management_session.required": 401,
    "management_session.expired": 401,
    "person.suspended": 403,
    "authorization.not_permitted": 403,
    "passkey.not_registered": 404,
  },
  "backup.failed",
);

export function mountBackupRecoveryPackApi(
  app: Hono,
  deps: BackupRecoveryPackApiDeps,
  log: Logger,
): void {
  app.post("/api/backup/recovery-pack/passkey-options", (c) => {
    c.header("Cache-Control", "no-store");
    return run(c, log, async () => {
      const managementSessionId = requireManagementSession(c);
      const out = await withTransaction(deps.db, async (tx) => {
        await authorizeManager(tx, { managementSessionId, permission: "system.manage" });
        return beginOwnPasskeyCheck(tx, { managementSessionId, rpId: deps.rpId });
      });
      return c.json(out);
    });
  });
}

export interface BackupRecoveryPackMakeDeps extends BackupRecoveryPackApiDeps {
  /** The management origin a passkey response must name. */
  origin: string;
  keyRing: TotpKeyRing;
  ring: KeyRing;
  node: ProvisionedNode;
  venueId: string;
  modules: readonly WaitronModule[];
  /** The backup API's own turns, so a Save or a key change waits for a pack being made. */
  turns: Turns;
  readBoxEnv: () => Promise<Readonly<Record<string, string | undefined>>>;
  /** What the backup supervisor holds now; the key never leaves the server. */
  backups: () => Pick<
    BackupRuntimeStatus,
    "managedByEnvironment" | "schedule" | "retention" | "recoveryKey"
  >;
  documentEvidence: RecoveryDocumentEvidence;
  loadFont: () => Promise<Uint8Array>;
  now: () => Date;
}

const makeRun = createErrorBoundary(
  {
    "management_session.required": 401,
    "management_session.expired": 401,
    "person.suspended": 403,
    "authorization.not_permitted": 403,
    "recovery.pack_connection_insecure": 403,
    "recovery.pack_origin_refused": 403,
    "recovery.pack_invalid": 400,
    "management.request_invalid": 400,
    "password.invalid": 401,
    "password.throttled": 429,
    "totp.invalid": 401,
    "totp.required": 401,
    "passkey.not_registered": 401,
    "passkey.verification_failed": 401,
    "passkey.challenge_expired": 400,
  },
  "backup.failed",
);

function invalid(reason: "shape" | "unknown_pack"): never {
  throw new AppError("recovery.pack_invalid", { reason });
}

/** An encrypted connection, from the dashboard's own page, carrying JSON. */
function requireSecurePackRequest(c: Context): void {
  const socket = (c.env as { incoming?: { socket?: unknown } } | undefined)?.incoming?.socket;
  if (!(socket instanceof TLSSocket) || !socket.encrypted) {
    throw new AppError("recovery.pack_connection_insecure", {});
  }
  const origin = c.req.header("Origin");
  const site = c.req.header("Sec-Fetch-Site");
  if (
    (origin !== undefined && origin !== new URL(c.req.url).origin) ||
    (site !== undefined && site !== "same-origin" && site !== "none")
  ) {
    throw new AppError("recovery.pack_origin_refused", {});
  }
  if (c.req.header("Content-Type")?.split(";")[0]?.trim().toLowerCase() !== "application/json") {
    invalid("shape");
  }
}

type MakeRequest = { locale: PackLocale; newServerKey: boolean; signIn: unknown };

function makeRequest(body: unknown): MakeRequest {
  if (body === null || typeof body !== "object" || Array.isArray(body)) invalid("shape");
  const fields = body as Record<string, unknown>;
  const keys = Object.keys(fields).sort();
  if (
    keys.join(",") !== "locale,newServerKey,signIn" ||
    (fields.locale !== "en" && fields.locale !== "es") ||
    typeof fields.newServerKey !== "boolean"
  ) {
    invalid("shape");
  }
  return fields as MakeRequest;
}

/**
 * The key in force and where it is printed: the pack that made it, else the sheet it was first
 * printed on. One pack at most: every key a pack makes gets a fresh name.
 */
async function readKeyInForce(
  tx: Transaction,
  nodeId: string,
  timeZone: string,
): Promise<KeyInForce | null> {
  const name = await readBreakGlassKeyName(tx, nodeId);
  if (name === null) return null;
  const pack = (await readRecoveryPacks(tx, nodeId)).find((record) =>
    carriesServerKey(record, name),
  );
  if (pack === undefined) {
    return { name, holder: { kind: "sheet", keyName: name, madeOn: name.slice(0, 10) } };
  }
  return {
    name,
    holder: {
      kind: "pack",
      number: pack.number,
      madeOn: dayIn(timeZone, pack.madeAt.toISOString()),
      received: pack.receivedAt !== null,
    },
  };
}

async function currentArchives(
  tx: Transaction,
  deps: BackupRecoveryPackMakeDeps,
  env: Readonly<Record<string, string | undefined>>,
): Promise<CurrentChecks["archives"]> {
  const { managedByEnvironment } = deps.backups();
  let sealed: ArchiveSettings | null = null;
  if (!managedByEnvironment) {
    const read = await readHeldArchiveSettingsIn(tx, deps.ring);
    if ("unreadable" in read) return "unreadable";
    sealed = read.settings;
  }
  const destinations = archiveDestinations({
    managedByEnvironment,
    env,
    sealed,
    venueId: deps.venueId,
  });
  return destinations.length === 0 ? null : { revision: archivesRevision(sealed, destinations) };
}

async function currentChecks(
  tx: Transaction,
  deps: BackupRecoveryPackMakeDeps,
  env: Readonly<Record<string, string | undefined>>,
  filesInvoices: boolean,
): Promise<CurrentChecks> {
  const streamRevision = await credentialRevision(tx, { purpose: STREAM_PURPOSE });
  return {
    keyChangedAt: loadKeyRotatedAt(env),
    bucket: streamRevision === null ? null : { revision: streamRevision },
    archives: await currentArchives(tx, deps, env),
    serverKeyName: filesInvoices ? await readBreakGlassKeyName(tx, deps.node.nodeId) : undefined,
  };
}

type MakeInput = {
  token: string;
  personId: string;
  request: MakeRequest;
  env: Readonly<Record<string, string | undefined>>;
  seat: ServerKeySeat;
  madeAt: string;
  newKey: { name: string; secret: string } | undefined;
  verifier: string | undefined;
};

/** Builds, renders and records one pack inside the caller's transaction. */
async function makePack(
  tx: Transaction,
  deps: BackupRecoveryPackMakeDeps,
  input: MakeInput,
): Promise<{
  number: number;
  pdf: Uint8Array<ArrayBuffer>;
  key: "failed" | "replaced" | "unchanged";
  parts: BuiltPart[];
}> {
  const { request, madeAt, newKey } = input;
  const nodeId = deps.node.nodeId;
  await authorizeManager(tx, { managementSessionId: input.token, permission: "system.manage" });
  const tenant = await readTenant(tx);
  const [venue] = await tx
    .select({ name: locations.name, timeZone: locations.timeZone })
    .from(locations)
    .where(eq(locations.id, deps.node.locationId));
  if (tenant === null || venue === undefined) {
    throw new Error("the box has no taxpayer or venue to name on a recovery pack");
  }
  const [person] = await tx
    .select({ name: persons.displayName })
    .from(persons)
    .where(eq(persons.id, input.personId));
  const number = await nextRecoveryPackNumber(tx, nodeId);
  const keyInForce = await readKeyInForce(tx, nodeId, venue.timeZone);
  const context: PartsContext = {
    locale: request.locale,
    timeZone: venue.timeZone,
    madeAt,
    nodeId,
    venueId: deps.venueId,
    ring: deps.ring,
    env: input.env,
    managedByEnvironment: deps.backups().managedByEnvironment,
  };
  const bucket = await buildBucketPart(tx, context);
  const archives = await buildArchivesPart(tx, context);
  const serverKey = await buildServerKeyPart(tx, context, {
    seat: input.seat,
    node: deps.node,
    keyInForce,
    ...(newKey === undefined ? {} : { newKey }),
  });
  const parts = withServerKeyPageNumber([bucket, archives, serverKey], request.locale);
  const carried = serverKey.record.carriedKey === true;
  const pdf = await renderRecoveryPack({
    locale: request.locale,
    timeZone: venue.timeZone,
    loadFont: deps.loadFont,
    cover: {
      legalName: tenant.legalName,
      taxId: tenant.taxId,
      venueName: venue.name,
      madeAt,
      madeBy: person?.name ?? null,
      number,
    },
    parts: parts.map((p) => p.part),
    file: {
      kind: "waitron-recovery-pack",
      version: 1,
      number,
      madeAt,
      bucketCode: null,
      archiveCode: null,
      backupKey: null,
      serverKey: null,
      serverKeyName: null,
      serverKeyHeldBy: null,
      ...Object.assign({}, ...parts.map((p) => p.file)),
    },
  });
  if (carried) await setBreakGlassVerifierTx(tx, nodeId, input.verifier!, newKey!.name);
  await insertRecoveryPack(tx, {
    nodeId,
    number,
    madeAt: new Date(madeAt),
    madeBy: input.personId,
    parts: parts.map((p) => p.record),
  });
  const key = serverKey.part.state === "failed" ? "failed" : carried ? "replaced" : "unchanged";
  return { number, pdf, key, parts };
}

export function mountBackupRecoveryPackMakeApi(
  app: Hono,
  deps: BackupRecoveryPackMakeDeps,
  log: Logger,
): void {
  const throttle = createPasswordThrottle();
  const nodeId = deps.node.nodeId;
  const filesInvoices = deps.modules.some((m) => m.backup?.recoveryPackPage !== undefined);

  app.post("/api/backup/recovery-pack", (c) => {
    c.header("Cache-Control", "no-store");
    return makeRun(c, log, async () => {
      requireSecurePackRequest(c);
      const token = requireManagementSession(c);
      await authorizeManager(deps.db, {
        managementSessionId: token,
        permission: "system.manage",
        touch: false,
      });
      const request = makeRequest(await readRawJsonBody<unknown>(c));
      const personId = await confirmFreshSignIn(
        { db: deps.db, throttle, keyRing: deps.keyRing, rpId: deps.rpId, origin: deps.origin },
        token,
        request.signIn,
      );
      const made = await deps.turns(() =>
        inTurn(deps.db, `recovery-document:${nodeId}`, async () => {
          const env = await deps.readBoxEnv();
          const seat = await serverKeySeat(deps.modules, deps.documentEvidence);
          const madeAt = deps.now().toISOString();
          const newKey = request.newServerKey
            ? { name: `${madeAt.slice(0, 10)} · ${randomUUID()}`, secret: generatePassword() }
            : undefined;
          const verifier = newKey === undefined ? undefined : hashSecret(newKey.secret);
          return withTransaction(deps.db, (tx) =>
            makePack(tx, deps, { token, personId, request, env, seat, madeAt, newKey, verifier }),
          );
        }),
      );
      log("info", "recovery.pack_made", {
        personId,
        number: made.number,
        parts: made.parts.map(({ record: { part, state }, failedWith }) => ({
          part,
          state,
          ...(failedWith === undefined ? {} : { failedWith }),
        })),
      });
      return c.body(made.pdf, 200, {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="waitron-recovery-pack-${made.number}.pdf"`,
        "X-Waitron-Recovery-Pack": String(made.number),
        "X-Waitron-Recovery-Pack-Key": made.key,
      });
    });
  });

  app.get("/api/backup/recovery-pack", (c) => {
    c.header("Cache-Control", "no-store");
    return makeRun(c, log, async () => {
      const token = requireManagementSession(c);
      const env = await deps.readBoxEnv();
      const { key: fileKey } = await readHeldKey(async () => loadRecoveryKey(env));
      const status = await withTransaction(deps.db, async (tx) => {
        await authorizeManager(tx, { managementSessionId: token, permission: "system.manage" });
        const records = await readRecoveryPacks(tx, nodeId);
        const makers = [...new Set(records.flatMap((r) => (r.madeBy === null ? [] : [r.madeBy])))];
        const names = new Map(
          makers.length === 0
            ? []
            : (
                await tx
                  .select({ id: persons.id, name: persons.displayName })
                  .from(persons)
                  .where(inArray(persons.id, makers))
              ).map((p) => [p.id, p.name] as const),
        );
        const [venue] = await tx
          .select({ timeZone: locations.timeZone })
          .from(locations)
          .where(eq(locations.id, deps.node.locationId));
        if (venue === undefined)
          throw new Error("the box has no venue to date its recovery packs in");
        const loaded = deps.backups();
        const status = packStatus({
          records: records.map((r) => ({
            ...r,
            madeByName: r.madeBy === null ? null : (names.get(r.madeBy) ?? null),
          })),
          current: await currentChecks(tx, deps, env, filesInvoices),
          retention: loaded.retention,
          schedule: loaded.schedule,
          backupsUseOlderKey:
            loaded.recoveryKey !== undefined &&
            fileKey !== undefined &&
            loaded.recoveryKey !== fileKey,
          now: deps.now(),
        });
        return { ...status, timeZone: venue.timeZone };
      });
      return c.json(status);
    });
  });

  app.post("/api/backup/recovery-pack/:number/received", (c) => {
    c.header("Cache-Control", "no-store");
    return makeRun(c, log, async () => {
      requireSecurePackRequest(c);
      const token = requireManagementSession(c);
      await authorizeManager(deps.db, {
        managementSessionId: token,
        permission: "system.manage",
        touch: false,
      });
      // Read outside the write lock, which a slow client would otherwise hold against every sale.
      const body = await readRawJsonBody<unknown>(c);
      await withTransaction(deps.db, async (tx) => {
        const { authorizedBy } = await authorizeManager(tx, {
          managementSessionId: token,
          permission: "system.manage",
        });
        if (body === null || typeof body !== "object" || Object.keys(body).length > 0) {
          invalid("shape");
        }
        const number = Number(c.req.param("number"));
        const pack = Number.isSafeInteger(number)
          ? await readRecoveryPack(tx, nodeId, number)
          : null;
        // Another person's pack answers as an unknown one: only the person who asked for a
        // pack can have received it, and the answer does not say whether the number exists.
        if (pack === null || pack.madeBy !== authorizedBy) invalid("unknown_pack");
        await markRecoveryPackReceived(tx, nodeId, number, deps.now());
      });
      return c.body(null, 204);
    });
  });
}
