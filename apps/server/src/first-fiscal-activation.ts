import { readMembershipTrustSet, readNodeMembershipRow, withTransaction } from "@waitron/db";
import { initialSetupFor } from "@waitron/module";
import { AppError } from "@waitron/shared";
import {
  activateFirstSetup,
  firstSetupPublicationDigest,
  finishFirstSetup,
  publishCheckedFirstSetup,
  checkedFirstSetupCommit,
  firstSetupProvisionRequest as firstFiscalProvisionRequest,
  type FirstSetupHold,
  type FirstSetupState,
  type VenueResult,
} from "@waitron/provisioning";
import type { SetupDeps } from "./setup-api.js";
import type { FirstFiscalHost } from "./setup-first-fiscal-api.js";
import { firstSetupModuleContext } from "./first-fiscal-evidence.js";
import type { FirstSetupOwnerAttempt } from "./first-setup-owner.js";
import { parseEmailSettings } from "./email-settings-api.js";
import { NODE_KEY_PURPOSE } from "./node-identity.js";
import {
  isMembershipDocument,
  signBytes,
  verifyBytes,
  verifyMembershipDocument,
} from "@waitron/membership";
import { putCredential, tryGetCredential } from "@waitron/credentials";
import { venueFiscalSelection } from "@waitron/provisioning";
import "./errors.js";

function conflict(): never {
  throw new AppError("setup.attempt_uncertain", {});
}

export { firstSetupProvisionRequest as firstFiscalProvisionRequest } from "@waitron/provisioning";
export async function checkedFirstFiscalCommit(
  host: FirstFiscalHost,
  deps: SetupDeps,
  state: FirstSetupState,
) {
  return checkedFirstSetupCommit(host, deps, state);
}
export function firstFiscalPayload(
  host: FirstFiscalHost,
  state: FirstSetupState,
  body: Record<string, unknown>,
) {
  if (
    Object.keys(body).some((key) => !["mode", "aeatCert", "email", "firstSetup"].includes(key)) ||
    body.mode !== "live"
  )
    throw new AppError("setup.request_invalid", { field: "body" });
  if (body.firstSetup !== undefined) {
    const reference = body.firstSetup;
    if (
      typeof reference !== "object" ||
      reference === null ||
      Array.isArray(reference) ||
      Object.keys(reference).length !== 2 ||
      !("attemptId" in reference) ||
      !("revision" in reference)
    )
      throw new AppError("setup.request_invalid", { field: "firstSetup" });
    if (reference.attemptId !== state.frozen.attemptId || reference.revision !== state.revision)
      throw new AppError("setup.owner_required", {});
  }
  const contribution = venueFiscalSelection(
    host.modules,
    state.frozen.request.location.fiscalTerritory,
  ).contribution;
  if (contribution === undefined) conflict();
  const secret = contribution.provisioningSecret;
  const required = secret?.required(state.frozen.environment) ?? false;
  if (required) {
    if (body.aeatCert === undefined)
      throw new AppError("setup.provisioning_secret_required", { module: contribution.id });
    secret!.validate(body.aeatCert);
  } else if (body.aeatCert !== undefined)
    throw new AppError("setup.request_invalid", { field: "aeatCert" });
  if (
    body.email !== undefined &&
    (typeof body.email !== "object" ||
      body.email === null ||
      Array.isArray(body.email) ||
      Object.keys(body.email).some(
        (key) => !["server", "port", "encryption", "user", "password", "from"].includes(key),
      ))
  )
    throw new AppError("setup.request_invalid", { field: "email" });
  for (const value of [body.email, body.aeatCert])
    if (value !== undefined && Buffer.byteLength(JSON.stringify(value)) > 65536)
      throw new AppError("setup.request_invalid", { field: "body" });
  const email =
    body.email === undefined
      ? undefined
      : parseEmailSettings(body.email as Record<string, unknown>);
  const digest = firstSetupPublicationDigest(state, { aeatCert: body.aeatCert, email });
  return { contribution, secret, required, email, digest };
}
export async function activateFirstFiscal(
  host: FirstFiscalHost,
  deps: SetupDeps,
  owner: FirstSetupOwnerAttempt,
  body: Record<string, unknown>,
  hold: FirstSetupHold,
): Promise<VenueResult> {
  const state = await host.owner.authorize(owner);
  if (["uncertain", "abandoned", "claimed"].includes(state.status)) conflict();
  for (const module of state.frozen.modules)
    if (initialSetupFor(host.modules, module.module) !== undefined)
      await host.assertFreshAssignment(state, module.module);
  if (
    deps.provision === undefined ||
    deps.db === undefined ||
    deps.ring === undefined ||
    deps.establishIdentity === undefined ||
    deps.seedMembership === undefined ||
    deps.persistTrading === undefined
  )
    throw new AppError("setup.not_ready", {});
  host.assertSelection(state);
  const payload = firstFiscalPayload(host, state, body),
    req = firstFiscalProvisionRequest(state);
  if (state.frozen.environment === "production" && payload.email === undefined)
    throw new AppError("setup.email_required", { field: "email" });
  return activateFirstSetup(
    host,
    {
      provision: (beforeTransaction) => deps.provision!(req, beforeTransaction),
      check: (current) => checkedFirstFiscalCommit(host, deps, current),
      assertReady: async () => {
        if (state.frozen.environment !== "production") return;
        if (deps.assertFiscalReady === undefined)
          throw new AppError("setup.fiscal_test_required", { module: payload.contribution.id });
        await deps.assertFiscalReady({
          request: req,
          contribution: payload.contribution,
          secret: body.aeatCert,
        });
      },
      confirmCommitted: async (current) => {
        for (const module of current.frozen.modules) {
          if (initialSetupFor(host.modules, module.module) === undefined) continue;
          const evidence = await host.evidence.read(
            firstSetupModuleContext(current, module.module).binding,
          );
          if (
            typeof evidence?.current !== "object" ||
            evidence.current === null ||
            !("priorActivation" in evidence.current) ||
            evidence.current.priorActivation !== "committed"
          )
            throw new AppError("sif.allocation_invalid", {
              reason: "outside_confirmation_missing",
            });
        }
      },
      publish: (current, checked) =>
        publishCheckedFirstFiscal(host, deps, current, checked, { owner, body, payload }, hold),
    },
    owner,
    payload.digest,
    hold,
  );
}

export async function finishFirstFiscalSetup(
  host: FirstFiscalHost,
  deps: SetupDeps,
  owner: FirstSetupOwnerAttempt,
  body: Record<string, unknown>,
  hold: FirstSetupHold,
): Promise<VenueResult> {
  let publication: ReturnType<typeof firstFiscalPayload>;
  return finishFirstSetup(
    host,
    {
      check: (state) => checkedFirstFiscalCommit(host, deps, state),
      publish: (state, checked, applyAudit) =>
        publishCheckedFirstFiscal(
          host,
          deps,
          state,
          checked,
          { owner, body, payload: publication },
          hold,
          applyAudit,
        ),
    },
    owner,
    (state) => {
      publication = firstFiscalPayload(host, state, body);
      return publication.digest;
    },
    hold,
  );
}

export async function publishCheckedFirstFiscal(
  host: FirstFiscalHost,
  deps: SetupDeps,
  state: FirstSetupState,
  checked: NonNullable<Awaited<ReturnType<typeof checkedFirstFiscalCommit>>>,
  publication: {
    owner: FirstSetupOwnerAttempt;
    body: Record<string, unknown>;
    payload: ReturnType<typeof firstFiscalPayload>;
  },
  hold: FirstSetupHold,
  beforeComplete?: () => Promise<unknown>,
): Promise<VenueResult> {
  if (
    deps.db === undefined ||
    deps.ring === undefined ||
    deps.establishIdentity === undefined ||
    deps.seedMembership === undefined ||
    deps.persistTrading === undefined
  )
    throw new AppError("setup.not_ready", {});
  const { owner, body, payload } = publication;
  return publishCheckedFirstSetup(
    host,
    {
      db: deps.db,
      publishSelection: async (current) => {
        await host.publishSelection(current);
      },
      publishIdentity: async (result, state) => {
        const identity = async () => ({
          trust: await readMembershipTrustSet(deps.db!),
          credential: await withTransaction(deps.db!, (tx) =>
            tryGetCredential(tx, deps.ring!, { purpose: NODE_KEY_PURPOSE }),
          ),
        });
        let own = await identity();
        if (own.trust[result.nodeId] === undefined && own.credential === null) {
          await deps.establishIdentity!(result.nodeId);
          own = await identity();
        }
        const publicKey = own.trust[result.nodeId];
        if (publicKey === undefined || own.credential === null) conflict();
        const challenge = JSON.stringify([
          "waitron.first-setup-node-check",
          state.frozen.attemptId,
          result.nodeId,
        ]);
        if (!verifyBytes(challenge, signBytes(challenge, own.credential.privateKey!), publicKey))
          conflict();
        let membership = await readNodeMembershipRow(deps.db!);
        if (membership === null) {
          await deps.seedMembership!(result.nodeId);
          membership = await readNodeMembershipRow(deps.db!);
        }
        if (
          membership === null ||
          !isMembershipDocument(membership.document) ||
          membership.document.body.term !== 0 ||
          membership.document.signerNodeId !== result.nodeId ||
          membership.document.body.nodes.length !== 1 ||
          membership.document.body.nodes[0]?.nodeId !== result.nodeId ||
          membership.document.body.nodes[0]?.standing !== "serving-primary" ||
          !verifyMembershipDocument(membership.document, own.trust).valid
        )
          conflict();
      },
      installLegacyKey: async (current, owner, module, hold) => {
        const binding = firstSetupModuleContext(current, module).binding;
        if (!(await host.delivery.has(binding))) return;
        const stage = await host.keys.readStage({ ...owner, revision: current.revision }, hold);
        await host.keys.installStagedNodeKey(deps.db!, current, stage, hold);
      },
      sealSettings: async (result) => {
        if (payload.required)
          await payload.secret!.seal(
            { db: deps.db!, ring: deps.ring!, nodeId: result.nodeId },
            body.aeatCert,
          );
        const email = payload.email;
        if (email !== undefined)
          await withTransaction(deps.db!, (tx) =>
            putCredential(tx, deps.ring!, { purpose: "email.smtp", value: email }),
          );
      },
      persistTrading: (result, current) =>
        deps.persistTrading!({
          nodeId: result.nodeId,
          locationId: result.locationId,
          environment: current.frozen.environment,
          ...(deps.devMode === true ? { developmentMode: true } : {}),
          onboardingIntent: "live",
        }),
      ...(deps.clearConfiguration === undefined
        ? {}
        : { clearConfiguration: deps.clearConfiguration }),
    },
    state,
    checked,
    owner,
    payload.digest,
    hold,
    beforeComplete,
  );
}
