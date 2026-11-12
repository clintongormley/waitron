// `POST /management-api/mirror-bundle`, on the singleton primary. The mirror calls it server-side, so
// the admin credential rides in the body and is authenticated by person id, not email.
import "./errors.js";
import { randomBytes, randomUUID } from "node:crypto";
import type { Hono } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { AppError, type ErrorCode } from "@waitron/shared";
import {
  persistNodeMembershipIfNewer,
  readNodeMembership,
  withNodeTransaction,
  withTransaction,
  type Database,
  type NodeDatabase,
} from "@waitron/db";
import {
  refuseUnverifiableChart,
  withMember,
  type Endorsement,
  type SignedMembershipDocument,
} from "@waitron/membership";
import {
  authorizeManager,
  checkManagerPassword,
  endManagementSession,
  loginManagerById,
  type TotpKeyRing,
} from "@waitron/identity";
import { credentialRevision, writePairLinkTx, type KeyRing } from "@waitron/credentials";
import { readPairLink } from "@waitron/node-db";
import type { AdoptResult } from "@waitron/provisioning";
import {
  assembleMirrorBundle,
  refuseFullChart,
  refuseRemovedStandby,
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
import { enabledModules, type ModuleOperations } from "@waitron/module";
import { assertAdoptionModules } from "./finish-adoption.js";
import { readModuleConfig } from "./module-config.js";
import { ALL_MODULES } from "./modules.js";
import { isBareOrigin } from "./config.js";
import { createErrorBoundary } from "@waitron/server-kit";
import { readJsonBody } from "@waitron/server-kit";
import { isUuid } from "./till-session.js";
import type { Logger } from "./logger.js";
import { ownContactUrl, sameBoxName } from "./box-name.js";
import { STREAM_PURPOSE } from "./stream-host.js";

export interface MirrorBundleApiDeps {
  appDb: Database;
  node: NodeDatabase;
  ring: KeyRing;
  stateDir: string;
  boxHostname: string;
  /** This box's `advertisedOrigin`; its own chart row carries `ownContactUrl` of it. */
  advertisedOrigin: string;
  designated: AdoptResult;
  accountKey: string;
  credentialKeyRing: TotpKeyRing;
  now?: () => Date;
}

/**
 * Every request the main box sends the spare's store is signed by the main box's clock, and the
 * store accepted one 14 minutes off its own and refused one 16 minutes off (probe P36).
 */
const MAX_CLOCK_GAP_MS = 10 * 60_000;

/**
 * This box's refusals of a join that the spare passes on to its wizard (`fetchMirrorBundle`), each
 * answered 409 here and by the spare's adopt route.
 */
export const JOIN_REFUSALS = [
  "mirror.spare_already_joined",
  "mirror.bucket_stream_active",
  "mirror.standby_name_taken",
  "mirror.clocks_apart",
  "mirror.standby_series_unsupported",
] as const satisfies readonly ErrorCode[];

export const JOIN_REFUSAL_STATUS = Object.fromEntries(
  JOIN_REFUSALS.map((code) => [code, 409]),
) as Record<(typeof JOIN_REFUSALS)[number], ContentfulStatusCode>;

// `membership.write_contended` is transient, so the caller retries.
const STATUS: Record<string, ContentfulStatusCode> = {
  "password.invalid": 401,
  "authorization.not_permitted": 403,
  "mirror.standby_invalid": 400,
  "mirror.standby_removed": 409,
  "mirror.membership_full": 409,
  ...JOIN_REFUSAL_STATUS,
  ...CHART_MINT_REFUSALS,
  ...HELD_DOCUMENT_REFUSALS,
  "membership.write_contended": 503,
};

export function mountMirrorBundleApi(
  app: Hono,
  deps: MirrorBundleApiDeps,
  log: Logger = () => {},
): void {
  const run = createErrorBoundary(STATUS, "mirror.bundle_failed");

  app.post("/management-api/mirror-bundle", (c) =>
    run(c, log, async () => {
      // Every malformed credential field answers `password.invalid`, so the response never says which.
      const body = await readJsonBody<{
        personId?: string;
        password?: string;
        totp?: string;
        standbyNodeId?: string;
        standbyPublicKey?: string;
        standbyContactUrl?: unknown;
        standbyStoreUrl?: unknown;
        standbyAt?: unknown;
        moduleOperation?: unknown;
      }>(c);
      if (
        typeof body.personId !== "string" ||
        !isUuid(body.personId) ||
        typeof body.password !== "string" ||
        (body.totp !== undefined && typeof body.totp !== "string")
      ) {
        throw new AppError("password.invalid", {});
      }
      const { personId, password, totp } = body;

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

      const assemble = async (moduleOperations?: ModuleOperations) => {
        // Before assembly, so a chart too broken to read, or one no stored key vouches for, spends no
        // reservation. Each mint round below checks the chart it re-reads again.
        const held = await readNodeMembership(deps.appDb);
        assertHeldDocumentReadable(held);
        // Unsealed once for the whole request: the check below, the bundle's endorsement and every
        // chart round sign or verify with it.
        const signingKey = await readNodeIdentityKey(deps.node, deps.ring, deps.designated.nodeId);
        await assertHeldDocumentTrusted(trustDeps(deps, signingKey), held);
        await refuseBeforeReserving(deps, held, standby.nodeId, standbyAt);
        // modules.json is read fresh, not from boot, as the operator may have edited it since. The
        // spare would refuse the bundle for the same modules after the fetch, so the join is
        // refused here first (D12).
        const moduleConfig = await readModuleConfig(deps.stateDir);
        assertAdoptionModules(enabledModules(ALL_MODULES, moduleConfig));

        const store = mintPairStoreKey();
        // node.db's lock is taken before venue.db's and held to the link write, so no other link
        // turns streaming between this check and that write. venue.db commits first: a crash
        // before the link write leaves the chart listing a spare that was never sent its bundle.
        const bundle = await withNodeTransaction(deps.node, async (tx) => {
          // One pair link per box: a second spare would replace a joined one's.
          if ((await readPairLink(tx, deps.designated.nodeId))?.state === "streaming")
            throw new AppError("mirror.spare_already_joined", {});
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
            accountKey: deps.accountKey,
            moduleOperations,
            moduleConfig,
            primaryPrivateKey: signingKey,
          });
          // Before the response, so no bundle is handed out for a node the chart omits: a till
          // reroutes by the chart's `contactUrl`.
          await appendStandbyToChart(
            deps,
            signingKey,
            standby.nodeId,
            standbyContactUrl,
            assembled.reservedIdentity.endorsement,
          );
          await writePairLinkTx(tx, deps.ring, deps.designated.nodeId, {
            role: "streams",
            state: "pending",
            peerNodeId: standby.nodeId,
            peerPublicKey: standby.publicKey,
            storeUrl: standbyStoreUrl,
            ...store,
          });
          return assembled;
        });

        return c.json(bundle);
      };
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
        return withAuthenticatedOperation(
          { db: deps.appDb, credentialKeyRing: deps.credentialKeyRing },
          { binding: operation.binding, permission: "mirror.create" },
          body,
          (authority) =>
            assemble(new Map([[operation.binding.module, { ...operation, authority }]])),
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
        });
        await authorizeManager(tx, {
          managementSessionId: session.token,
          permission: "mirror.create",
        });
        // The session only authorised this request; ending it leaves no dead row behind.
        await endManagementSession(tx, session.token);
      });

      return assemble();
    }),
  );
}

/** An `https` bare origin at the contact URL's host, so the pair's key goes to no other machine. */
function isStoreUrlOf(storeUrl: unknown, contactUrl: string): boolean {
  if (typeof storeUrl !== "string" || contactUrl === "" || !isBareOrigin(storeUrl)) return false;
  const store = new URL(storeUrl);
  return store.protocol === "https:" && store.hostname === new URL(contactUrl).hostname;
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
  deps: MirrorBundleApiDeps,
  held: SignedMembershipDocument | null,
  standbyNodeId: string,
  standbyAt: number,
): Promise<void> {
  const primaryAt = (deps.now ?? (() => new Date()))().getTime();
  if (Math.abs(primaryAt - standbyAt) >= MAX_CLOCK_GAP_MS) {
    throw new AppError("mirror.clocks_apart", {
      primaryAt: new Date(primaryAt).toISOString(),
      standbyAt: new Date(standbyAt).toISOString(),
    });
  }
  await refuseWhileBucketStream(deps);
  if (
    sameBoxName(deps.designated.nodeId, standbyNodeId) ||
    held?.body.nodes.some((n) => n.nodeId !== standbyNodeId && sameBoxName(n.nodeId, standbyNodeId))
  )
    throw new AppError("mirror.standby_name_taken", {});
  if (held !== null) refuseUnverifiableChart(held.body.nodes, held.body.revoked ?? []);
}

async function refuseWhileBucketStream(deps: MirrorBundleApiDeps): Promise<void> {
  if (
    (await withTransaction(deps.appDb, (tx) =>
      credentialRevision(tx, { purpose: STREAM_PURPOSE }),
    )) !== null
  )
    throw new AppError("mirror.bucket_stream_active", {});
}

/** The designated main box's own stored keys, which it trusts the held chart against. */
function trustDeps(deps: MirrorBundleApiDeps, privateKey: string): StoredTrustDeps {
  return { node: deps.node, ring: deps.ring, nodeId: deps.designated.nodeId, privateKey };
}

// A refused write means this mint was built on a stale chart: re-read and mint again, never force.
async function appendStandbyToChart(
  deps: MirrorBundleApiDeps,
  signingKey: string,
  standbyNodeId: string,
  standbyContactUrl: string,
  endorsement: Endorsement,
): Promise<void> {
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
    if (await persistNodeMembershipIfNewer(deps.appDb, document)) return;
  }
  throw new AppError("membership.write_contended", { attempts: MAX_CHART_WRITE_ROUNDS });
}
