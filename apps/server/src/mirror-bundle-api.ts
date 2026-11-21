import { type KeyRing, credentialRevision, writePairLinkTx } from "@waitron/credentials";
import { peerBodyLimit } from "./peer-route-limits.js";
// `POST /management-api/mirror-bundle`, on the singleton primary. The mirror calls it server-side, so
// the admin's sign-in email, password and code ride in the body.
import "./errors.js";
import { randomBytes, randomUUID } from "node:crypto";
import type { Hono } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { AppError, isAppError, type ErrorCode } from "@waitron/shared";
import {
  persistNodeMembershipIfNewerTx,
  readNodeMembership,
  withNodeTransaction,
  withTransaction,
  type Database,
  type NodeDatabase,
  type NodeTransaction,
  type Transaction,
} from "@waitron/db";
import {
  refuseUnverifiableChart,
  standingOf,
  withMember,
  type Endorsement,
  type SignedMembershipDocument,
} from "@waitron/membership";
import {
  authorizeManager,
  checkManagerPassword,
  endManagementSession,
  loginManagerById,
  personIdForLoginEmail,
  withInspectorAdmitted,
} from "@waitron/identity";

import { readPairLink } from "@waitron/node-db";
import type { AdoptResult } from "@waitron/provisioning";
import {
  assembleMirrorBundle,
  refuseFullChart,
  refuseRemovedStandby,
  type MirrorBundle,
  type PairStoreKey,
} from "./mirror-bundle.js";
import {
  CHART_MINT_REFUSALS,
  MAX_CHART_WRITE_ROUNDS,
  mintNextMembershipDocument,
} from "./membership-mint.js";
import {
  assertHeldDocumentReadable,
  assertHeldDocumentTrusted,
  HELD_DOCUMENT_REFUSALS,
  type StoredTrustDeps,
} from "./membership-trust.js";
import { readNodeIdentityKey } from "./node-identity.js";
import { withAuthenticatedOperation } from "./operation-authentication.js";
import { parseStandbyOperationInput } from "./recovery-module-operation.js";
import { createPasswordThrottle } from "./password-throttle.js";
import type { ModuleOperations } from "@waitron/module";
import { readModuleConfig } from "./module-config.js";
import { isBareOrigin } from "./config.js";
import { createErrorBoundary } from "@waitron/server-kit";
import { readJsonBody } from "@waitron/server-kit";
import { isUuid } from "./till-session.js";
import type { Logger } from "./logger.js";
import { ownContactUrl, sameBoxName } from "./box-name.js";
import { STREAM_PURPOSE } from "./stream-host.js";
import { checkedRecoveryKey, readHeldKey } from "./backup-config.js";
import { readBackupSettings } from "./backup-env-writer.js";

export interface MirrorBundleApiDeps {
  appDb: Database;
  node: NodeDatabase;
  ring: KeyRing;
  stateDir: string;
  boxHostname: string;
  /** This box's `advertisedOrigin`; its own chart row carries `ownContactUrl` of it. */
  advertisedOrigin: string;
  designated: AdoptResult;

  credentialKeyRing: KeyRing;
  /** Called once a join's pending pair link has committed. */
  wakeSpareJoin: () => void;
  now?: () => Date;
}

/**
 * Every request the main box sends the spare's store is signed by the main box's clock, and the
 * store accepted one 14 minutes off its own and refused one 16 minutes off (probe P36).
 */
export const MAX_CLOCK_GAP_MS = 10 * 60_000;

/**
 * This box's refusals of a join that the spare passes on to its wizard (`fetchMirrorBundle`), each
 * answered 409 here and by the spare's adopt route.
 */
export const JOIN_REFUSALS = [
  "mirror.spare_already_joined",
  "mirror.bucket_stream_active",
  "mirror.standby_name_taken",
  "mirror.clocks_apart",
  "backup.recovery_key_missing",
] as const satisfies readonly ErrorCode[];

export const JOIN_REFUSAL_STATUS = Object.fromEntries(
  JOIN_REFUSALS.map((code) => [code, 409]),
) as Record<(typeof JOIN_REFUSALS)[number], ContentfulStatusCode>;

/** What {@link issueMirrorBundle} refuses. `membership.write_contended` is transient, so the caller retries. */
export const ISSUE_STATUS: Record<string, ContentfulStatusCode> = {
  "authorization.not_permitted": 403,
  "mirror.standby_invalid": 400,
  "mirror.standby_removed": 409,
  "mirror.membership_full": 409,
  "mirror.not_provisioned": 409,
  "module.config_invalid": 500,
  ...JOIN_REFUSAL_STATUS,
  ...CHART_MINT_REFUSALS,
  ...HELD_DOCUMENT_REFUSALS,
  "membership.write_contended": 503,
};

const STATUS: Record<string, ContentfulStatusCode> = {
  "password.invalid": 401,
  "totp.required": 401,
  "password.throttled": 429,
  ...ISSUE_STATUS,
};

export function mountMirrorBundleApi(
  app: Hono,
  deps: MirrorBundleApiDeps,
  log: Logger = () => {},
): void {
  const run = createErrorBoundary(STATUS, "mirror.bundle_failed");
  const throttle = createPasswordThrottle();

  app.use("/management-api/mirror-bundle", peerBodyLimit(1048576, "management.request_invalid"));
  app.post("/management-api/mirror-bundle", (c) =>
    run(c, log, async () => {
      // Every malformed credential field answers `password.invalid`, so the response never says which.
      const body = await readJsonBody<{
        email?: unknown;
        password?: unknown;
        totp?: unknown;
        standbyNodeId?: string;
        standbyPublicKey?: string;
        standbyContactUrl?: unknown;
        standbyStoreUrl?: unknown;
        standbyAt?: unknown;
        moduleOperation?: unknown;
      }>(c);
      const { email, password, totp } = body;
      if (
        typeof email !== "string" ||
        typeof password !== "string" ||
        (totp !== undefined && typeof totp !== "string")
      ) {
        throw new AppError("password.invalid", {}, { reason: "malformed" });
      }

      // The contact URL is signed into the org chart and every till dials it, so the primary screens
      // it itself. Checked after the credential screen and before any database work.
      if (
        typeof body.standbyNodeId !== "string" ||
        !isUuid(body.standbyNodeId) ||
        typeof body.standbyPublicKey !== "string" ||
        body.standbyPublicKey === "" ||
        typeof body.standbyContactUrl !== "string" ||
        (body.standbyContactUrl !== "" && !isBareOrigin(body.standbyContactUrl)) ||
        typeof body.standbyAt !== "number" ||
        Number.isNaN(new Date(body.standbyAt).getTime()) ||
        !isStoreUrlOf(body.standbyStoreUrl, body.standbyContactUrl)
      ) {
        throw new AppError("mirror.standby_invalid", {});
      }
      const standby = { nodeId: body.standbyNodeId, publicKey: body.standbyPublicKey };
      const standbyContactUrl = body.standbyContactUrl;
      const standbyStoreUrl = body.standbyStoreUrl as string;
      const standbyAt = body.standbyAt;

      // An address with no active account gets an id no person holds, which the sign-in below
      // refuses after the same hashing work as a wrong password.
      const personId = await personIdForLoginEmail(deps.appDb, email);

      const assemble = async (moduleOperations?: ModuleOperations) =>
        c.json(
          await issueMirrorBundle(
            deps,
            { standby, contactUrl: standbyContactUrl, storeUrl: standbyStoreUrl, at: standbyAt },
            moduleOperations,
          ),
        );
      // By the id, which an address keeps whether or not it has an account, so the limit is reached
      // after the same attempts either way.
      const finishAttempt = throttle.begin(`person:${personId}`);
      let signedIn = false;
      const passed = (): void => {
        signedIn = true;
        finishAttempt("success");
      };
      try {
        if (body.moduleOperation !== undefined) {
          const operation = parseStandbyOperationInput(body.moduleOperation);
          if (operation === null)
            throw new AppError("module.operation_invalid", { module: "unknown" });
          if (
            operation.binding.action !== "reserve" ||
            operation.binding.sourceId !== deps.designated.nodeId ||
            operation.binding.targetNodeId !== standby.nodeId
          )
            throw new AppError("module.operation_invalid", { module: operation.binding.module });
          return await withAuthenticatedOperation(
            { db: deps.appDb, credentialKeyRing: deps.credentialKeyRing },
            { binding: operation.binding, permission: "node.manage" },
            { personId, password, totp },
            (authority) => {
              passed();
              return assemble(new Map([[operation.binding.module, { ...operation, authority }]]));
            },
          );
        }
        const checked = await checkManagerPassword(deps.appDb, { personId }, password);
        await withTransaction(deps.appDb, async (tx) => {
          const session = await loginManagerById(tx, {
            personId,
            password,
            totp,
            totpKeyRing: deps.credentialKeyRing,
            checked,
            askForCode: true,
          });
          await withInspectorAdmitted(() =>
            authorizeManager(tx, { managementSessionId: session.token, permission: "node.manage" }),
          );
          // The session only authorised this request.
          await endManagementSession(tx, session.token, "operation_finished");
        });
        passed();
        return await assemble();
      } catch (error) {
        if (!signedIn)
          finishAttempt(
            isAppError(error) && error.code === "password.invalid" ? "invalid" : "error",
          );
        throw error;
      }
    }),
  );
}

/** An `https` bare origin at the contact URL's host, so the pair's key goes to no other machine. */
export function isStoreUrlOf(storeUrl: unknown, contactUrl: string): boolean {
  if (typeof storeUrl !== "string" || contactUrl === "" || !isBareOrigin(storeUrl)) return false;
  const store = new URL(storeUrl);
  return store.protocol === "https:" && store.hostname === new URL(contactUrl).hostname;
}

export type MirrorBundleIssueDeps = Omit<MirrorBundleApiDeps, "credentialKeyRing">;

/** The joining box, as its own request named it. */
export interface JoiningSpare {
  standby: { nodeId: string; publicKey: string };
  contactUrl: string;
  storeUrl: string;
  /** The joining box's clock, for the clock check. */
  at: number;
}

/**
 * Reserves the spare's identity, lists it in the chart and records its pending pair link, then
 * answers its bundle. `moduleOperations` carry the caller's authority to each module.
 */
export async function issueMirrorBundle(
  deps: MirrorBundleIssueDeps,
  spare: JoiningSpare,
  moduleOperations?: ModuleOperations,
): Promise<MirrorBundle> {
  const { standby } = spare;
  // Before assembly, so a chart too broken to read, or one no stored key vouches for, spends no
  // reservation. Each mint round below checks the chart it re-reads again.
  const held = await readNodeMembership(deps.appDb);
  assertHeldDocumentReadable(held);
  // Unsealed once for the whole request: the check below, the bundle's endorsement and every
  // chart round sign or verify with it.
  const signingKey = await readNodeIdentityKey(deps.node, deps.ring, deps.designated.nodeId);
  await assertHeldDocumentTrusted(trustDeps(deps, signingKey), held);
  await refuseBeforeReserving(deps, held, standby.nodeId, spare.at);
  const moduleConfig = await readModuleConfig(deps.appDb);

  const store = mintPairStoreKey();
  // node.db's lock is taken before venue.db's and held to the link write, so no other link
  // turns streaming between this check and that write. venue.db commits first: a crash
  // before the link write leaves the chart listing a spare that was never sent its bundle.
  const bundle = await withNodeTransaction(deps.node, async (tx) => {
    // One pair link per box: a second spare would replace a joined one's.
    await refuseJoinedSpare(tx, deps, held);
    // Again, under node.db's lock: bucket Save checks for a link and stores its settings
    // under the same lock (`stream-api.ts`), so one of the two sees the other.
    await refuseWhileBucketStream(deps);
    const assembled = await assembleMirrorBundle({
      appDb: deps.appDb,
      node: deps.node,
      ring: deps.ring,
      stateDir: deps.stateDir,
      primaryUrl: ownContactUrl(deps.advertisedOrigin, deps.designated.nodeId),
      store,
      boxHostname: deps.boxHostname,
      designated: deps.designated,
      standby,

      moduleOperations,
      moduleConfig,
      primaryPrivateKey: signingKey,
      // With the reservation, so no bundle is handed out for a node the chart omits (a till
      // reroutes by the chart's `contactUrl`), and a chart write that gives up reserves nothing.
      reservationTransaction: (endorsement, reserve) =>
        listStandbyThenReserve(
          deps,
          signingKey,
          standby.nodeId,
          spare.contactUrl,
          endorsement,
          reserve,
        ),
    });
    await writePairLinkTx(tx, deps.ring, deps.designated.nodeId, {
      role: "streams",
      state: "pending",
      peerNodeId: standby.nodeId,
      peerPublicKey: standby.publicKey,
      storeUrl: spare.storeUrl,
      ...store,
    });
    return assembled;
  });
  deps.wakeSpareJoin();
  return bundle;
}

/**
 * The refusals of a join that need no writes, for a person about to approve one: those
 * {@link issueMirrorBundle} gives before reserving, except the box name, which the hello checked.
 */
export async function refuseJoinBeforeApproving(
  deps: MirrorBundleIssueDeps,
  standbyNodeId: string,
  standbyAt: number,
): Promise<void> {
  const held = await readNodeMembership(deps.appDb);
  assertHeldDocumentReadable(held);
  await refuseBeforeReserving(deps, held, standbyNodeId, standbyAt, { checkName: false });
  refuseRemovedStandby(held, standbyNodeId);
  refuseFullChart(held, standbyNodeId);
  await refuseJoinedSpare(deps.node, deps, held);
}

async function refuseJoinedSpare(
  node: NodeDatabase | NodeTransaction,
  deps: MirrorBundleIssueDeps,
  held: SignedMembershipDocument | null,
): Promise<void> {
  const link = await readPairLink(node, deps.designated.nodeId);
  if (
    link?.state === "streaming" &&
    !(held !== null && standingOf(held, link.peerNodeId) === "evicted")
  )
    throw new AppError("mirror.spare_already_joined", {});
}

/** A fresh key for each join; the access key id has the store's own shape. */
function mintPairStoreKey(): PairStoreKey {
  return {
    accessKeyId: `waitron${randomBytes(8).toString("hex")}`,
    secretAccessKey: randomBytes(32).toString("hex"),
    venueId: randomUUID(),
  };
}

/** The refusals a join gets before anything is reserved or listed. */
async function refuseBeforeReserving(
  deps: MirrorBundleIssueDeps,
  held: SignedMembershipDocument | null,
  standbyNodeId: string,
  standbyAt: number,
  { checkName = true }: { checkName?: boolean } = {},
): Promise<void> {
  const primaryAt = (deps.now ?? (() => new Date()))().getTime();
  if (Math.abs(primaryAt - standbyAt) >= MAX_CLOCK_GAP_MS) {
    throw new AppError("mirror.clocks_apart", {
      primaryAt: new Date(primaryAt).toISOString(),
      standbyAt: new Date(standbyAt).toISOString(),
    });
  }
  await refuseWhileBucketStream(deps);
  // From the file, not the box env: `backup.env` is what travels to the spare in its bundle.
  const { key } = await readHeldKey(async () =>
    checkedRecoveryKey((await readBackupSettings(deps.stateDir))?.WAITRON_BACKUP_RECOVERY_KEY),
  );
  if (key === undefined) throw new AppError("backup.recovery_key_missing", {});
  if (checkName) refuseTakenBoxName(deps.designated.nodeId, held, standbyNodeId);
  if (held !== null) refuseUnverifiableChart(held.body.nodes, held.body.revoked ?? []);
}

/**
 * Refuses a held chart that cannot be read, then a joining box whose name is the main box's or
 * another listed box's. Its own listing is no clash, so a box the chart lists can join again. The
 * hello and {@link issueMirrorBundle} both check through this, so the two cannot disagree.
 */
export function refuseTakenBoxName(
  mainNodeId: string,
  held: SignedMembershipDocument | null,
  standbyNodeId: string,
): void {
  assertHeldDocumentReadable(held);
  if (
    sameBoxName(mainNodeId, standbyNodeId) ||
    held?.body.nodes.some((n) => n.nodeId !== standbyNodeId && sameBoxName(n.nodeId, standbyNodeId))
  )
    throw new AppError("mirror.standby_name_taken", {});
}

async function refuseWhileBucketStream(deps: MirrorBundleIssueDeps): Promise<void> {
  if (
    (await withTransaction(deps.appDb, (tx) =>
      credentialRevision(tx, { purpose: STREAM_PURPOSE }),
    )) !== null
  )
    throw new AppError("mirror.bucket_stream_active", {});
}

/** The designated main box's own stored keys, which it trusts the held chart against. */
function trustDeps(deps: MirrorBundleIssueDeps, privateKey: string): StoredTrustDeps {
  return { node: deps.node, ring: deps.ring, nodeId: deps.designated.nodeId, privateKey };
}

/**
 * Lists the standby in the next chart and runs `reserve` after it in the same transaction, so the
 * two commit together. A refused write means this mint was built on a stale chart: re-read and
 * mint again, never force.
 */
async function listStandbyThenReserve<T>(
  deps: MirrorBundleIssueDeps,
  signingKey: string,
  standbyNodeId: string,
  standbyContactUrl: string,
  endorsement: Endorsement,
  reserve: (tx: Transaction) => Promise<T>,
): Promise<T> {
  const signerContactUrl = ownContactUrl(deps.advertisedOrigin, deps.designated.nodeId);
  for (let round = 1; round <= MAX_CHART_WRITE_ROUNDS; round += 1) {
    const held = await readNodeMembership(deps.appDb);
    assertHeldDocumentReadable(held);
    refuseRemovedStandby(held, standbyNodeId);
    refuseFullChart(held, standbyNodeId);
    const document = await mintNextMembershipDocument(
      { db: deps.appDb, node: deps.node, ring: deps.ring, signerPrivateKey: signingKey },
      {
        heldDocument: held,
        nodes: withMember(held?.body.nodes ?? [], standbyNodeId, standbyContactUrl).map((n) =>
          n.nodeId === deps.designated.nodeId ? { ...n, contactUrl: signerContactUrl } : n,
        ),
        signerNodeId: deps.designated.nodeId,
        verifyHeld: "stored-keys",
        endorsements: [endorsement],
      },
    );
    const reserved = await withTransaction(deps.appDb, async (tx) =>
      (await persistNodeMembershipIfNewerTx(tx, document)) ? { value: await reserve(tx) } : null,
    );
    if (reserved !== null) return reserved.value;
  }
  throw new AppError("membership.write_contended", { attempts: MAX_CHART_WRITE_ROUNDS });
}
