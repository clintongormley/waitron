// `POST /management-api/mirror-bundle`, on the singleton primary. The mirror calls it server-side, so
// the admin credential rides in the body and is authenticated by person id, not email.
import "./errors.js";
import type { Hono } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { AppError } from "@waitron/shared";
import {
  persistNodeMembershipIfNewer,
  readNodeMembership,
  withTransaction,
  type Database,
} from "@waitron/db";
import { withMember } from "@waitron/membership";
import { authorizeManager, endManagementSession, loginManagerById } from "@waitron/identity";
import type { KeyRing } from "@waitron/credentials";
import type { AdoptResult } from "@waitron/provisioning";
import { assembleMirrorBundle } from "./mirror-bundle.js";
import { mintNextMembershipDocument, readSignerEndorsements } from "./membership-mint.js";
import { isBareOrigin } from "./config.js";
import { createErrorBoundary } from "@waitron/server-kit";
import { readJsonBody } from "@waitron/server-kit";
import { isUuid } from "./till-session.js";
import type { Logger } from "./logger.js";

// `relayUrl` is `undefined` when no tunnel is configured; the route then refuses `mirror.no_relay`.
export interface MirrorBundleApiDeps {
  appDb: Database;
  ring: KeyRing;
  stateDir: string;
  relayUrl: string | undefined;
  boxHostname: string;
  designated: AdoptResult;
  accountKey: string;
}

// `person.not_found` is a 404, unlike the email login, which folds an unknown person into
// `password.invalid`: this server-to-server path has no enumeration surface to hide.
// `membership.write_contended` is transient, so the caller retries.
const STATUS: Record<string, ContentfulStatusCode> = {
  "password.invalid": 401,
  "totp.invalid": 401,
  "person.suspended": 403,
  "person.not_found": 404,
  "authorization.not_permitted": 403,
  "mirror.no_relay": 400,
  "mirror.standby_invalid": 400,
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
        (body.standbyContactUrl !== "" && !isBareOrigin(body.standbyContactUrl))
      ) {
        throw new AppError("mirror.standby_invalid", {});
      }
      const standby = { nodeId: body.standbyNodeId, publicKey: body.standbyPublicKey };
      const standbyContactUrl = body.standbyContactUrl;

      await withTransaction(deps.appDb, async (tx) => {
        const session = await loginManagerById(tx, {
          personId,
          password,
          totp,
        });
        await authorizeManager(tx, {
          managementSessionId: session.token,
          permission: "mirror.create",
        });
        // The session only authorised this request; ending it leaves no dead row behind.
        await endManagementSession(tx, session.token);
      });

      if (deps.relayUrl === undefined) throw new AppError("mirror.no_relay", {});

      const bundle = await assembleMirrorBundle({
        appDb: deps.appDb,
        ring: deps.ring,
        stateDir: deps.stateDir,
        relayUrl: deps.relayUrl,
        boxHostname: deps.boxHostname,
        designated: deps.designated,
        standby,
        accountKey: deps.accountKey,
      });
      // Before the response, so no bundle is handed out for a node the chart omits: a till reroutes by
      // the chart's `contactUrl`. Deliberately a separate transaction: assembly's reservation has already
      // committed.
      await appendStandbyToChart(deps, standby.nodeId, standbyContactUrl);

      return c.json(bundle);
    }),
  );
}

// A round is lost only to a writer that committed a newer term.
const MAX_CHART_WRITE_ROUNDS = 8;

// A refused write means this mint was built on a stale chart: re-read and mint again, never force.
async function appendStandbyToChart(
  deps: MirrorBundleApiDeps,
  standbyNodeId: string,
  standbyContactUrl: string,
): Promise<void> {
  for (let round = 1; round <= MAX_CHART_WRITE_ROUNDS; round += 1) {
    const held = await readNodeMembership(deps.appDb);
    const document = await mintNextMembershipDocument(
      { db: deps.appDb, ring: deps.ring },
      {
        heldDocument: held,
        nodes: withMember(held?.body.nodes ?? [], standbyNodeId, standbyContactUrl),
        signerNodeId: deps.designated.nodeId,
        endorsements: await readSignerEndorsements(deps.appDb, deps.designated.nodeId),
      },
    );
    if (await persistNodeMembershipIfNewer(deps.appDb, document)) return;
  }
  throw new AppError("membership.write_contended", { attempts: MAX_CHART_WRITE_ROUNDS });
}
