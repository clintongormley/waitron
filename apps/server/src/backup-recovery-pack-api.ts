import { randomUUID } from "node:crypto";
import { TLSSocket } from "node:tls";
import { eq } from "drizzle-orm";
import type { Context, Hono } from "hono";
import type { KeyRing } from "@waitron/credentials";
import {
  insertRecoveryPack,
  locations,
  markRecoveryPackReceived,
  nextRecoveryPackNumber,
  readBreakGlassKeyName,
  readRecoveryPacks,
  readTenant,
  setBreakGlassVerifierTx,
  withTransaction,
  type Database,
  type RecoveryPackRecord,
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
import { inTurn } from "./attempt-turns.js";
import {
  buildArchivesPart,
  buildBucketPart,
  buildServerKeyPart,
  dayIn,
  withServerKeyPageNumber,
  type KeyHolder,
  type PartsContext,
} from "./backup-recovery-pack-parts.js";
import type { Turns } from "./backup-turns.js";
import { confirmFreshSignIn } from "./fresh-sign-in.js";
import type { Logger } from "./logger.js";
import { createPasswordThrottle } from "./password-throttle.js";
import type { RecoveryDocumentEvidence } from "./recovery-document-api.js";
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
  managedByEnvironment: () => boolean;
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
 * Where the key in force is printed: the pack that made it, else the sheet it was first printed on.
 * One pack at most: every key a pack makes gets a fresh name.
 */
function keyHolder(records: RecoveryPackRecord[], name: string, timeZone: string): KeyHolder {
  const pack = records.find((record) =>
    record.parts.some(
      (p) => p.part === "server-key" && p.carriedKey === true && p.keyName === name,
    ),
  );
  if (pack === undefined) return { kind: "sheet", keyName: name, madeOn: name.slice(0, 10) };
  return {
    kind: "pack",
    number: pack.number,
    madeOn: dayIn(timeZone, pack.madeAt.toISOString()),
    received: pack.receivedAt !== null,
  };
}

export function mountBackupRecoveryPackMakeApi(
  app: Hono,
  deps: BackupRecoveryPackMakeDeps,
  log: Logger,
): void {
  const throttle = createPasswordThrottle();
  const nodeId = deps.node.nodeId;

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
          const owner = deps.modules.find((m) => m.backup?.recoveryPackPage !== undefined);
          const evidence = owner === undefined ? {} : await deps.documentEvidence(owner);
          const madeAt = deps.now().toISOString();
          const newKey = request.newServerKey
            ? { name: `${madeAt.slice(0, 10)} · ${randomUUID()}`, secret: generatePassword() }
            : undefined;
          return withTransaction(deps.db, async (tx) => {
            await authorizeManager(tx, { managementSessionId: token, permission: "system.manage" });
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
              .where(eq(persons.id, personId));
            const number = await nextRecoveryPackNumber(tx, nodeId);
            const keyName = await readBreakGlassKeyName(tx, nodeId);
            const holder =
              keyName === null
                ? null
                : keyHolder(await readRecoveryPacks(tx, nodeId), keyName, venue.timeZone);
            const context: PartsContext = {
              locale: request.locale,
              timeZone: venue.timeZone,
              madeAt,
              nodeId,
              venueId: deps.venueId,
              ring: deps.ring,
              env,
              managedByEnvironment: deps.managedByEnvironment(),
            };
            const parts = withServerKeyPageNumber(
              [
                await buildBucketPart(tx, context),
                await buildArchivesPart(tx, context),
                await buildServerKeyPart(tx, context, {
                  modules: deps.modules,
                  node: deps.node,
                  evidence,
                  keyInForce: keyName === null ? null : { name: keyName, holder: holder! },
                  ...(newKey === undefined ? {} : { newKey }),
                }),
              ],
              request.locale,
            );
            const serverKey = parts[2]!;
            const carried = serverKey.record.carriedKey === true;
            const file = Object.assign({}, ...parts.map((p) => p.file));
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
                ...file,
                serverKeyHeldBy:
                  serverKey.part.state !== "absent" && !carried && holder?.kind === "pack"
                    ? { number: holder.number, madeOn: holder.madeOn, received: holder.received }
                    : null,
              },
            });
            if (carried) {
              await setBreakGlassVerifierTx(tx, nodeId, hashSecret(newKey!.secret), newKey!.name);
            }
            await insertRecoveryPack(tx, {
              nodeId,
              number,
              madeAt: new Date(madeAt),
              madeBy: personId,
              parts: parts.map((p) => p.record),
            });
            const key =
              serverKey.part.state === "failed" ? "failed" : carried ? "replaced" : "unchanged";
            return { number, pdf, key, records: parts.map((p) => p.record) };
          });
        }),
      );
      log("info", "recovery.pack_made", {
        personId,
        number: made.number,
        parts: made.records.map(({ part, state }) => ({ part, state })),
      });
      return c.body(made.pdf, 200, {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="waitron-recovery-pack-${made.number}.pdf"`,
        "X-Waitron-Recovery-Pack": String(made.number),
        "X-Waitron-Recovery-Pack-Key": made.key,
      });
    });
  });

  app.post("/api/backup/recovery-pack/:number/received", (c) => {
    c.header("Cache-Control", "no-store");
    return makeRun(c, log, async () => {
      requireSecurePackRequest(c);
      const token = requireManagementSession(c);
      await withTransaction(deps.db, async (tx) => {
        const { authorizedBy } = await authorizeManager(tx, {
          managementSessionId: token,
          permission: "system.manage",
        });
        const body = await readRawJsonBody<unknown>(c);
        if (body === null || typeof body !== "object" || Object.keys(body).length > 0) {
          invalid("shape");
        }
        const number = Number(c.req.param("number"));
        const pack = (await readRecoveryPacks(tx, nodeId)).find((p) => p.number === number);
        // Another person's pack answers as an unknown one: only the browser that asked for a
        // pack can have received it, and the answer does not say whether the number exists.
        if (pack === undefined || pack.madeBy !== authorizedBy) invalid("unknown_pack");
        await markRecoveryPackReceived(tx, nodeId, number, deps.now());
      });
      return c.body(null, 204);
    });
  });
}
