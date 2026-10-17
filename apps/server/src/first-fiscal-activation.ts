import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { readMembershipTrustSet, readNodeMembershipRow, withTransaction } from "@waitron/db";
import { initialSetupFor } from "@waitron/module";
import { AppError } from "@waitron/shared";
import type { FirstSetupHold, FirstSetupState, VenueResult } from "@waitron/provisioning";
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
import { prepareFirstSetupFinishAudit } from "./first-setup-finish-audit.js";

function conflict(): never {
  throw new AppError("setup.attempt_uncertain", {});
}
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (typeof value === "object" && value !== null)
    return Object.fromEntries(
      Object.entries(value)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, v]) => [k, canonical(v)]),
    );
  return value;
}
export function firstFiscalProvisionRequest(state: FirstSetupState) {
  const offering = state.frozen.modules.filter((module) => module.request !== null);
  return {
    environment: state.frozen.environment,
    ...(state.frozen.configurationImport === undefined
      ? {}
      : {
          configurationImport: true,
          configurationDigest: state.frozen.configurationImport.digest,
          newTaxpayer: state.frozen.configurationImport.newTaxpayer,
        }),
    venue: structuredClone(state.frozen.request),
    initialOperations: {
      nodeId: state.frozen.nodeId,
      administratorId: state.frozen.administratorId,
      inputs: offering.map((module) => ({
        module: module.module,
        eventId: module.eventId,
        sourceId: state.frozen.sourceId,
        input: state.inputs[module.module],
      })),
    },
  };
}
export async function checkedFirstFiscalCommit(
  host: FirstFiscalHost,
  deps: SetupDeps,
  state: FirstSetupState,
) {
  if (deps.db === undefined || deps.recoverProvision === undefined)
    throw new AppError("setup.not_ready", {});
  const offering = state.frozen.modules.filter(
    (module) => initialSetupFor(host.modules, module.module) !== undefined,
  );
  if (offering.length === 0) conflict();
  const results = await withTransaction(deps.db, async (tx) => {
    const checked: Record<string, unknown> = {};
    for (const module of offering) {
      const seat = initialSetupFor(host.modules, module.module)!;
      const result = await seat.committed(
        tx,
        firstSetupModuleContext(state, module.module),
        state.inputs[module.module],
      );
      if (result === null) return null;
      checked[module.module] = result;
    }
    return checked;
  });
  if (results === null) return null;
  const recovered = await deps.recoverProvision(firstFiscalProvisionRequest(state));
  const result = { venue: recovered, modules: results };
  if (state.result !== null && !isDeepStrictEqual(state.result, result)) conflict();
  return result;
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
  const digest = createHash("sha256")
    .update(
      JSON.stringify(
        canonical({
          attemptId: state.frozen.attemptId,
          nodeId: state.frozen.nodeId,
          administratorId: state.frozen.administratorId,
          modules: state.frozen.modules,
          configurationImport: state.frozen.configurationImport ?? null,
          inputs: Object.fromEntries(
            Object.entries(state.inputs).filter(([name]) => name !== "$publication"),
          ),
          mode: "live",
          aeatCert: body.aeatCert ?? null,
          email: email ?? null,
        }),
      ),
    )
    .digest("hex");
  return { contribution, secret, required, email, digest };
}
export async function activateFirstFiscal(
  host: FirstFiscalHost,
  deps: SetupDeps,
  owner: FirstSetupOwnerAttempt,
  body: Record<string, unknown>,
  hold: FirstSetupHold,
): Promise<VenueResult> {
  let state = await host.owner.authorize(owner);
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
  if (
    state.inputs.$publication !== undefined &&
    !isDeepStrictEqual(state.inputs.$publication, { digest: payload.digest })
  )
    throw new AppError("setup.attempt_conflict", {});
  const advance = async (change: Parameters<typeof host.store.update>[2]) => {
    state = await host.store.update(state.frozen.attemptId, state.revision, change, hold);
  };
  let checked: Awaited<ReturnType<typeof checkedFirstFiscalCommit>>;
  if (state.status === "consumption-intent") {
    if (state.frozen.environment === "production") {
      if (deps.assertFiscalReady === undefined)
        throw new AppError("setup.fiscal_test_required", { module: payload.contribution.id });
      await deps.assertFiscalReady({
        request: req,
        contribution: payload.contribution,
        secret: body.aeatCert,
      });
    }
    try {
      await deps.provision(req, async () => {
        if (state.inputs.$publication === undefined)
          await advance({ kind: "publication-binding", digest: payload.digest });
        await advance({ kind: "activation-started" });
      });
    } catch (error) {
      if ((state as FirstSetupState).status === "activation-started") {
        try {
          checked = await checkedFirstFiscalCommit(host, deps, state);
          if (checked !== null) await advance({ kind: "committed", result: checked });
          else await advance({ kind: "uncertain" });
        } catch {
          await advance({ kind: "uncertain" });
        }
      }
      throw error;
    }
    if ((state as FirstSetupState).status !== "activation-started") conflict();
    checked = await checkedFirstFiscalCommit(host, deps, state);
    if (checked === null) {
      await advance({ kind: "uncertain" });
      conflict();
    }
    await advance({ kind: "committed", result: checked });
  } else {
    try {
      checked = await checkedFirstFiscalCommit(host, deps, state);
    } catch {
      await advance({ kind: "uncertain" });
      conflict();
    }
    if (checked === null) {
      await advance({ kind: "uncertain" });
      conflict();
    }
    // A retained activation is read only; a new live consultation authorizes unfinished publication.
    for (const module of state.frozen.modules) {
      if (initialSetupFor(host.modules, module.module) === undefined) continue;
      const evidence = await host.evidence.read(
        firstSetupModuleContext(state, module.module).binding,
      );
      if (
        typeof evidence?.current !== "object" ||
        evidence.current === null ||
        !("priorActivation" in evidence.current) ||
        evidence.current.priorActivation !== "committed"
      )
        throw new AppError("sif.allocation_invalid", { reason: "outside_confirmation_missing" });
    }
    if (state.status === "activation-started")
      await advance({ kind: "committed", result: checked });
  }
  return publishCheckedFirstFiscal(host, deps, state, checked!, { owner, body, payload }, hold);
}

export async function finishFirstFiscalSetup(
  host: FirstFiscalHost,
  deps: SetupDeps,
  owner: FirstSetupOwnerAttempt,
  body: Record<string, unknown>,
  hold: FirstSetupHold,
): Promise<VenueResult> {
  let state = await host.owner.authorize(owner);
  const ownership = [...state.history]
    .reverse()
    .find((event) => ["claim", "resume", "recover"].includes(event.kind));
  if (ownership?.kind !== "recover" || ownership.ownerGeneration !== state.ownerGeneration)
    throw new AppError("setup.owner_required", {});
  if (!["activation-started", "committed", "publication"].includes(state.status)) conflict();
  host.assertSelection(state);
  const publication = firstFiscalPayload(host, state, body);
  if (!isDeepStrictEqual(state.inputs.$publication, { digest: publication.digest })) conflict();
  const checked = await checkedFirstFiscalCommit(host, deps, state);
  if (checked === null) conflict();
  const applyAudit = await prepareFirstSetupFinishAudit(host, state, checked);
  if (state.status === "activation-started")
    state = await host.store.update(
      state.frozen.attemptId,
      state.revision,
      { kind: "committed", result: checked },
      hold,
    );
  return publishCheckedFirstFiscal(
    host,
    deps,
    state,
    checked,
    { owner, body, payload: publication },
    hold,
    applyAudit,
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
  if (
    !["committed", "publication"].includes(state.status) ||
    !isDeepStrictEqual(state.result, checked)
  )
    conflict();
  const { owner, body, payload } = publication;
  if (!isDeepStrictEqual(state.inputs.$publication, { digest: payload.digest })) conflict();
  const advance = async (change: Parameters<typeof host.store.update>[2]) => {
    state = await host.store.update(state.frozen.attemptId, state.revision, change, hold);
  };
  const result = checked.venue;
  for (const module of state.frozen.modules) {
    const binding = firstSetupModuleContext(state, module.module).binding;
    if (!(await host.delivery.has(binding))) continue;
    const stage = await host.keys.readStage({ ...owner, revision: state.revision }, hold);
    await host.keys.installStagedNodeKey(deps.db, state, stage, hold);
  }
  await host.publishSelection(state);
  const identity = async () => ({
    trust: await readMembershipTrustSet(deps.db!),
    credential: await withTransaction(deps.db!, (tx) =>
      tryGetCredential(tx, deps.ring!, { purpose: NODE_KEY_PURPOSE }),
    ),
  });
  let own = await identity();
  if (own.trust[result.nodeId] === undefined && own.credential === null) {
    await deps.establishIdentity(result.nodeId);
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
  let membership = await readNodeMembershipRow(deps.db);
  if (membership === null) {
    await deps.seedMembership(result.nodeId);
    membership = await readNodeMembershipRow(deps.db);
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
  // Repeat only the seals and settings; the retained node key and membership stay unchanged.
  if (payload.required) await payload.secret!.seal({ db: deps.db, ring: deps.ring }, body.aeatCert);
  const email = payload.email;
  if (email !== undefined)
    await withTransaction(deps.db!, (tx) =>
      putCredential(tx, deps.ring!, { purpose: "email.smtp", value: email }),
    );
  await deps.persistTrading({
    nodeId: result.nodeId,
    locationId: result.locationId,
    environment: state.frozen.environment,
    ...(deps.devMode === true ? { developmentMode: true } : {}),
    onboardingIntent: "live",
  });
  await deps.clearConfiguration?.();
  if (state.status === "committed") await advance({ kind: "publication" });
  // Keep password recovery available until the publication audit is durable.
  await beforeComplete?.();
  await advance({ kind: "complete" });
  return result;
}
