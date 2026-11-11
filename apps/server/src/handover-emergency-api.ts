import "./errors.js";
import { isDeepStrictEqual } from "node:util";
import { eq } from "drizzle-orm";
import type { Hono } from "hono";
import {
  readNodeMembership,
  withNodeTransaction,
  withTransaction,
  type Database,
  type NodeDatabase,
} from "@waitron/db";
import type { KeyRing } from "@waitron/credentials";
import {
  ACTIVATED_OR_LATER,
  isOperationId,
  refuseRequest,
  type HandoverBinding,
  type SignedHandoverEnvelope,
} from "@waitron/handover";
import {
  authorizeManager,
  checkManagerPassword,
  endManagementSession,
  loginManagerById,
  persons,
  type TotpKeyRing,
} from "@waitron/identity";
import { servingPrimaryNodeId, type CanonicalValue } from "@waitron/membership";
import type { WaitronModule } from "@waitron/module";
import {
  readHandoverOperation,
  readMirrorLink,
  readNodeMode,
  readOpenHandoverOperation,
  type HandoverOperation,
} from "@waitron/node-db";
import { inTurn } from "@waitron/provisioning";
import { createErrorBoundary, readJsonBody } from "@waitron/server-kit";
import { AppError } from "@waitron/shared";
import {
  askPeerStatus,
  isRecord,
  isRestriction,
  type AskPeerStatusDeps,
  type SilentReason,
} from "./boot-peer-check.js";
import { checkEmergencyCopy, type EmergencyCopy } from "./handover-emergency-check.js";
import { handoverSignInAttempt, signInCredentials } from "./handover-preparation.js";
import { currentBinding, peerKeyOf, signAsThisBox } from "./handover-signing.js";
import { advanceHandoverTx, beginHandoverTx, readHandoverEnvelope } from "./handover-store.js";
import type { Logger } from "./logger.js";
import { assertHeldDocumentReadable } from "./membership-trust.js";
import { requireNodeOperationHttps } from "./node-operation-https.js";
import { createPasswordThrottle, type PasswordThrottle } from "./password-throttle.js";

interface Declaration {
  binding: HandoverBinding;
  wordingVersion: "a1018-emergency-v1";
  locale: "en" | "es";
  statements: { sourceSwitchedOff: true; noParallelRecovery: true; missingTailAccepted: true };
  reason: string;
  lastCopy: EmergencyCopy;
  provider: null;
  actor: { personId: string; method: "password" | "password+totp" };
  declaredAtMs: number;
  replaces: string | null;
}
interface Deps {
  db: Database;
  node: NodeDatabase;
  nodeId: string;
  ring: KeyRing;
  venueDir: string;
  modules: readonly WaitronModule[];
  origin: string;
  credentialKeyRing: TotpKeyRing;
  passwordThrottle?: PasswordThrottle;
  fetch?: AskPeerStatusDeps["fetch"];
}

export interface EmergencyHandover {
  assertMayActivate(operation: HandoverOperation): Promise<void>;
}

const STATUS = {
  "password.invalid": 401,
  "password.throttled": 429,
  "totp.required": 401,
  "authorization.not_permitted": 403,
  "handover.request_invalid": 400,
  "handover.copy_damaged": 409,
  "handover.chain_broken": 409,
  "handover.copy_check_failed": 409,
  "handover.copy_mismatch": 409,
  "handover.controlled_unresolved": 409,
  "handover.source_still_answering": 409,
  "handover.source_not_established": 409,
  "handover.step_out_of_order": 409,
  "node.read_only": 409,
} as const;

function parse(raw: unknown) {
  if (!isRecord(raw)) refuseRequest("body");
  const { operationId, statements, reason, locale, provider } = raw;
  if (!isOperationId(operationId)) refuseRequest("operationId");
  for (const key of ["sourceSwitchedOff", "noParallelRecovery", "missingTailAccepted"])
    if (!isRecord(statements) || statements[key] !== true) refuseRequest(`statements.${key}`);
  if (typeof reason !== "string" || reason.trim() === "" || reason.length > 500)
    refuseRequest("reason");
  if (locale !== "en" && locale !== "es") refuseRequest("locale");
  if (provider !== undefined && provider !== null) refuseRequest("provider");
  return {
    operationId,
    statements: {
      sourceSwitchedOff: true,
      noParallelRecovery: true,
      missingTailAccepted: true,
    } as const,
    reason,
    locale: locale as "en" | "es",
    signIn: raw.signIn,
  };
}

/** The mark dies with the process; after a restart the declaration must check this copy again. */
export function mountHandoverEmergencyApi(
  app: Hono,
  deps: Deps,
  log: Logger = () => {},
): EmergencyHandover {
  const checked = new Set<string>();
  const throttle = deps.passwordThrottle ?? createPasswordThrottle();
  const boundary = createErrorBoundary(STATUS, "handover-emergency.failed");
  async function sourceSilent(sourceNodeId: string, activating: boolean) {
    const held = await readNodeMembership(deps.db);
    const source = held?.body.nodes.find((n) => n.nodeId === sourceNodeId);
    const own = held?.body.nodes.find((n) => n.nodeId === deps.nodeId);
    const link = await readMirrorLink(deps.node, deps.nodeId);
    let reason: SilentReason | undefined;
    const answer = await askPeerStatus({
      sign: (body) => signAsThisBox(deps, "query", body),
      publicKeyOf: await peerKeyOf(deps),
      ownOrigin: own?.contactUrl || deps.origin,
      authorityOf: (id) => (link?.originNodeId === id ? link.boxCaPem : undefined),
      onSilent: (_id, why) => {
        reason = why;
      },
      ...(deps.fetch === undefined ? {} : { fetch: deps.fetch }),
    })({ nodeId: sourceNodeId, url: source?.contactUrl ?? "", standing: "serving-primary" });
    if (answer === null && reason === "unreachable") return;
    if (answer === null) throw new AppError("handover.source_not_established", {});
    if (
      activating &&
      isRestriction(answer.restriction) &&
      answer.restriction?.successorNodeId === deps.nodeId
    )
      return;
    throw new AppError("handover.source_still_answering", {});
  }
  async function declare(raw: unknown) {
    const request = parse(raw);
    const credentials = await signInCredentials(deps.db, request.signIn);
    if (
      typeof credentials.password !== "string" ||
      (credentials.totp !== undefined && typeof credentials.totp !== "string")
    )
      throw new AppError("password.invalid", {});
    const { personId, password, totp } = credentials as {
      personId: string;
      password: string;
      totp: string | undefined;
    };
    const actor = await handoverSignInAttempt(throttle, credentials, () =>
      inTurn(deps.db, personId, async () => {
        const secret = await checkManagerPassword(deps.db, { personId }, password);
        return withTransaction(deps.db, async (tx) => {
          const session = await loginManagerById(tx, {
            personId,
            password,
            ...(totp === undefined ? {} : { totp }),
            totpKeyRing: deps.credentialKeyRing,
            checked: secret,
          });
          await authorizeManager(tx, {
            managementSessionId: session.token,
            permission: "node.promote",
          });
          await endManagementSession(tx, session.token);
          const [person] = await tx
            .select({ totpSecret: persons.totpSecret })
            .from(persons)
            .where(eq(persons.id, personId));
          return {
            personId,
            method:
              person!.totpSecret === null ? ("password" as const) : ("password+totp" as const),
          };
        });
      }),
    );
    const stored = await readHandoverOperation(deps.node, deps.nodeId, request.operationId);
    if (stored !== null) {
      if (stored.scenario !== "emergency" || stored.role !== "destination")
        refuseRequest("operationId");
      const declaration = JSON.parse(
        await readHandoverEnvelope(deps, request.operationId, "emergency_declared"),
      ) as SignedHandoverEnvelope<Declaration>;
      const old = declaration.body;
      if (
        !isDeepStrictEqual(
          {
            operationId: old.binding.operationId,
            statements: old.statements,
            reason: old.reason,
            locale: old.locale,
          },
          {
            operationId: request.operationId,
            statements: request.statements,
            reason: request.reason,
            locale: request.locale,
          },
        )
      )
        refuseRequest("operationId");
      if (!checked.has(request.operationId) && !ACTIVATED_OR_LATER.includes(stored.state)) {
        if (!isDeepStrictEqual(await checkEmergencyCopy(deps), old.lastCopy))
          throw new AppError("handover.copy_mismatch", {});
        checked.add(request.operationId);
      }
      return { declaration };
    }
    if ((await readNodeMode(deps.node, deps.nodeId)).mode !== "mirror")
      throw new AppError("node.read_only", {});
    const held = await readNodeMembership(deps.db);
    assertHeldDocumentReadable(held);
    const sourceNodeId = held === null ? undefined : servingPrimaryNodeId(held);
    if (sourceNodeId === undefined || sourceNodeId === deps.nodeId)
      throw new AppError("handover.source_not_established", {});
    const binding = await currentBinding(
      deps,
      "emergency",
      sourceNodeId,
      deps.nodeId,
      request.operationId,
    );
    const previous = await readOpenHandoverOperation(deps.node, deps.nodeId);
    const replaceable = (old: HandoverOperation | null) => {
      if (
        old !== null &&
        (old.role !== "destination" ||
          old.scenario !== "controlled" ||
          old.state !== "prepared" ||
          old.sourceNodeId !== sourceNodeId)
      )
        throw new AppError("handover.controlled_unresolved", {});
    };
    replaceable(previous);
    const lastCopy = await checkEmergencyCopy(deps);
    const body: Declaration = {
      binding,
      wordingVersion: "a1018-emergency-v1",
      locale: request.locale,
      statements: request.statements,
      reason: request.reason,
      lastCopy,
      provider: null,
      actor,
      declaredAtMs: Date.now(),
      replaces: previous?.operationId ?? null,
    };
    const declaration = await signAsThisBox(deps, "declaration", body as unknown as CanonicalValue);
    await sourceSilent(sourceNodeId, false);
    await withNodeTransaction(deps.node, async (tx) => {
      const open = await readOpenHandoverOperation(tx, deps.nodeId);
      replaceable(open);
      if (open?.operationId !== previous?.operationId)
        throw new AppError("handover.controlled_unresolved", {});
      if (open !== null)
        await advanceHandoverTx(tx, deps.nodeId, open.operationId, "replaced", {
          replacedBy: request.operationId,
        });
      await beginHandoverTx(tx, deps.nodeId, binding, "destination");
      await advanceHandoverTx(
        tx,
        deps.nodeId,
        request.operationId,
        "emergency_declared",
        {},
        declaration,
      );
    });
    checked.add(request.operationId);
    return { declaration };
  }
  app.post("/api/node/handover/emergency/declare", (c) =>
    boundary(c, log, async () => {
      c.header("Cache-Control", "no-store");
      requireNodeOperationHttps(c);
      const body = await readJsonBody<unknown>(c);
      return c.json(await inTurn(deps.node, "handover-emergency", () => declare(body)));
    }),
  );
  return {
    async assertMayActivate(operation) {
      if (!checked.has(operation.operationId)) throw new AppError("handover.copy_mismatch", {});
      await sourceSilent(operation.sourceNodeId, true);
    },
  };
}
