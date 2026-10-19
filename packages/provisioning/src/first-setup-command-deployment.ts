import { createHash, createHmac } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { parseEnv, isDeepStrictEqual } from "node:util";
import { loadKeyRing, putCredential, tryGetCredential } from "@waitron/credentials";
import {
  applicationVersion,
  readMembershipTrustSet,
  readNodeMembershipRow,
  setNodePublicKeyTx,
  stampDeployment,
  withTransaction,
  writeNodeMembership,
  type Database,
} from "@waitron/db";
import {
  buildNextMembershipDocument,
  generateNodeKeyPair,
  isMembershipDocument,
  signBytes,
  verifyBytes,
  verifyMembershipDocument,
} from "@waitron/membership";
import { appliedSchemaVersion } from "@waitron/migrations";
import { enabledModules, serializeModuleConfig } from "@waitron/module";
import { AppError } from "@waitron/shared";
import type { FirstSetupCommandDeployment } from "./first-setup-command-activation.js";
import type { createFirstSetupRuntime } from "./first-setup-runtime.js";
import { firstSetupPublicationDigest } from "./first-setup-publication-digest.js";
import { writeFileAtomic } from "./fs-atomic.js";
import { initialVenueApplyInput } from "./initial-venue-input.js";
import { applyVenue } from "./venue-apply.js";
import { planVenue } from "./venue-plan.js";
import { recoverProvisionedVenue } from "./recover-provisioned-venue.js";
import { readTenantIdentities } from "./tenant-guard.js";
import { venueFiscalSelection } from "./venue-fiscal.js";
import { createFiscalReadinessStore } from "./fiscal-readiness.js";
import { fiscalReadinessInput } from "./fiscal-readiness-input.js";
import { parseFirstSetupSettings, readFirstSetupSettings } from "./first-setup-settings.js";
import type { KeyRing } from "@waitron/credentials";
import type { TrustedClock } from "@waitron/fiscal";
import type { FirstSetupState } from "./first-setup-state.js";
import { submitFiscalReadiness } from "./fiscal-readiness-runner.js";
import {
  clearStagedConfigurationImport,
  readStagedConfigurationImport,
} from "./configuration-import.js";
import {
  importConfigurationTables,
  validateConfigurationBundle,
} from "./configuration-transfer.js";
import "./errors.js";

const keyPurpose = "membership.node_key";
function conflict(): never {
  throw new AppError("setup.attempt_uncertain", {});
}

export function createFirstSetupCommandDeployment(options: {
  runtime: ReturnType<typeof createFirstSetupRuntime>;
  db: Database;
  environment: Record<string, string | undefined>;
}): FirstSetupCommandDeployment {
  const { runtime, db } = options;
  const environment = Object.freeze({ ...options.environment });
  let publication:
    | {
        digest: string;
        settings: ReturnType<typeof parseFirstSetupSettings>;
        ring: KeyRing;
      }
    | undefined;
  async function configuration(state: FirstSetupState, ring: KeyRing) {
    const frozen = state.frozen.configurationImport;
    if (frozen === undefined) return undefined;
    const staged = await readStagedConfigurationImport(state.stateDir, ring);
    if (staged === null) throw new AppError("setup.not_ready", {});
    if (createHash("sha256").update(staged.artifact).digest("hex") !== frozen.digest)
      throw new AppError("setup.attempt_conflict", {});
    if (
      staged.bundle.venue.country !== state.frozen.request.country ||
      (!frozen.newTaxpayer && staged.bundle.venue.taxId !== state.frozen.request.taxId)
    )
      throw new AppError("setup.request_invalid", { field: "configurationImport" });
    if (frozen.newTaxpayer && staged.bundle.venue.taxId === state.frozen.request.taxId)
      throw new AppError("setup.request_invalid", { field: "taxId" });
    const modules = enabledModules(
      runtime.modules,
      venueFiscalSelection(runtime.modules, state.frozen.request.location.fiscalTerritory).config,
    );
    const versions: Record<string, number> = {};
    for (const module of modules)
      versions[module.name] = await appliedSchemaVersion(db, module.migrations);
    validateConfigurationBundle(staged.bundle, modules, versions);
    return { bundle: staged.bundle, versions };
  }
  async function readiness(state: FirstSetupState) {
    if (
      publication === undefined ||
      firstSetupPublicationDigest(state, publication.settings) !== publication.digest
    )
      throw new AppError("setup.not_ready", {});
    const selected = venueFiscalSelection(
      runtime.modules,
      state.frozen.request.location.fiscalTerritory,
    );
    if (selected.contribution === undefined) conflict();
    const modules = enabledModules(runtime.modules, selected.config);
    const versions: Record<string, number> = {};
    for (const module of modules)
      versions[module.name] = await appliedSchemaVersion(db, module.migrations);
    const input = fiscalReadinessInput({
      venue: state.frozen.request,
      contribution: selected.contribution,
      secret: publication.settings.aeatCert,
      moduleVersions: versions,
      applicationVersion: applicationVersion(environment),
    });
    const settings = publication.settings;
    const ring = publication.ring;
    const store = createFiscalReadinessStore(
      state.stateDir,
      (readinessInput) =>
        submitFiscalReadiness({
          stateDir: state.stateDir,
          migrationsRoot: environment.WAITRON_MIGRATIONS_DIR || undefined,
          modules,
          venue: state.frozen.request,
          contribution: selected.contribution!,
          secret: settings.aeatCert,
          ring,
          readinessInput,
          clock: sampleClock,
        }),
      ring.current.key,
    );
    return { store, input };
  }
  return {
    async runReadiness(state) {
      await this.publication(state);
      const { store, input } = await readiness(state);
      return store.run(input);
    },
    async publication(state) {
      const path = environment.WAITRON_SETUP_SETTINGS_FILE;
      if (!path && state.frozen.environment === "production")
        throw new AppError("setup.not_ready", {});
      const selection = venueFiscalSelection(
        runtime.modules,
        state.frozen.request.location.fiscalTerritory,
      );
      if (selection.contribution === undefined) conflict();
      const settings = parseFirstSetupSettings(
        selection.contribution,
        state.frozen.environment,
        path ? await readFirstSetupSettings(path) : {},
      );
      let storedEnvironment: Record<string, string | undefined> = {};
      try {
        storedEnvironment = parseEnv(await readFile(join(state.stateDir, "secrets.env"), "utf8"));
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
      const ring = loadKeyRing({ ...storedEnvironment, ...environment });
      if (["claimed", "consumption-intent"].includes(state.status))
        await configuration(state, ring);
      let contactUrl: string;
      try {
        const parsed = new URL(environment.WAITRON_ADVERTISED_ORIGIN ?? "");
        if (
          !["https:", "http:"].includes(parsed.protocol) ||
          parsed.username ||
          parsed.password ||
          parsed.search ||
          parsed.hash ||
          parsed.pathname !== "/"
        )
          throw new Error();
        contactUrl = parsed.origin;
      } catch {
        throw new AppError("setup.not_ready", {});
      }
      const config = selection.config;
      const identity = async () => ({
        trust: await readMembershipTrustSet(db),
        credential: await withTransaction(db, (tx) =>
          tryGetCredential(tx, ring, { purpose: keyPurpose }),
        ),
      });
      const digest = firstSetupPublicationDigest(state, settings);
      publication = { digest, settings, ring };
      return {
        digest,
        deps: {
          clearConfiguration: () => clearStagedConfigurationImport(state.stateDir),
          publishSelection: async () => {
            await writeFileAtomic(
              join(state.stateDir, "modules.json"),
              JSON.stringify({ modules: serializeModuleConfig(config) }, null, 2) + "\n",
              0o600,
            );
          },
          publishIdentity: async (result, current) => {
            let own = await identity();
            if (own.trust[result.nodeId] === undefined && own.credential === null) {
              const pair = generateNodeKeyPair();
              await withTransaction(db, async (tx) => {
                await putCredential(tx, ring, {
                  purpose: keyPurpose,
                  value: { privateKey: pair.privateKey },
                });
                await setNodePublicKeyTx(tx, result.nodeId, pair.publicKey);
              });
              own = await identity();
            }
            const publicKey = own.trust[result.nodeId];
            const privateKey = own.credential?.privateKey;
            if (publicKey === undefined || typeof privateKey !== "string") conflict();
            const challenge = JSON.stringify([
              "waitron.first-setup-node-check",
              current.frozen.attemptId,
              result.nodeId,
            ]);
            if (!verifyBytes(challenge, signBytes(challenge, privateKey), publicKey)) conflict();
            let membership = await readNodeMembershipRow(db);
            if (membership === null) {
              await writeNodeMembership(
                db,
                buildNextMembershipDocument({
                  heldDocument: null,
                  signerNodeId: result.nodeId,
                  signerPrivateKey: privateKey,
                  nodes: [{ nodeId: result.nodeId, contactUrl, standing: "serving-primary" }],
                }),
              );
              membership = await readNodeMembershipRow(db);
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
          sealSettings: async (result) => {
            if (settings.required)
              await settings.secret!.seal({ db, ring, nodeId: result.nodeId }, settings.aeatCert);
            if (settings.email !== undefined)
              await withTransaction(db, (tx) =>
                putCredential(tx, ring, { purpose: "email.smtp", value: settings.email! }),
              );
          },
          persistTrading: async (result, current) => {
            const accountKey = createHmac("sha256", ring.current.key)
              .update("waitron.account-key.v1")
              .digest("base64");
            const entries = {
              WAITRON_TILL_NODE_ID: result.nodeId,
              WAITRON_TILL_LOCATION_ID: result.locationId,
              WAITRON_ENV: environment.WAITRON_ENV === "dev" ? "dev" : current.frozen.environment,
              WAITRON_ONBOARDING_INTENT: "live",
              WAITRON_ACCOUNT_KEY: accountKey,
            };
            await writeFileAtomic(
              join(current.stateDir, "trading.env"),
              Object.entries(entries)
                .map(([name, value]) => `${name}=${value}\n`)
                .join(""),
              0o600,
            );
          },
        },
      };
    },
    async assertReady(state) {
      if (state.frozen.environment !== "production") return;
      const { store, input } = await readiness(state);
      await store.assertReady(input);
    },
    async provision(request, beforeTransaction) {
      const state = await runtime.store.read();
      if (state === null || !isDeepStrictEqual(request.venue, state.frozen.request)) conflict();
      if ((await readTenantIdentities(db)).length !== 0) conflict();
      if (publication === undefined) throw new AppError("setup.not_ready", {});
      const imported = await configuration(state, publication.ring);
      const config = venueFiscalSelection(
        runtime.modules,
        request.venue.location.fiscalTerritory,
      ).config;
      let remaining = request.initialOperations.inputs.length;
      if (remaining === 0) conflict();
      const modules = enabledModules(runtime.modules, config).map((module) => {
        if (
          module.operations === undefined ||
          !request.initialOperations.inputs.some((input) => input.module === module.name)
        )
          return module;
        const operations = module.operations;
        return {
          ...module,
          operations: {
            prepare: <T>(
              operation: Parameters<typeof operations.prepare>[0],
              run: (prepared: Parameters<typeof operations.prepare>[0]) => Promise<T>,
            ) =>
              operations.prepare(operation, async (prepared) => {
                if (--remaining === 0) await beforeTransaction();
                return run(prepared);
              }),
          },
        };
      });
      // A refused venue write retains the environment stamp, so its retry cannot change environments.
      await stampDeployment(db, request.environment);
      return applyVenue(planVenue(request.venue, modules), {
        db,
        modules,
        ...initialVenueApplyInput(request.initialOperations),
        ...(imported === undefined
          ? {}
          : {
              beforeCommit: (tx, result) =>
                importConfigurationTables(
                  tx,
                  imported.bundle,
                  { locationId: result.locationId },
                  modules,
                  imported.versions,
                ),
            }),
      });
    },
    recoverProvision: (request) => recoverProvisionedVenue(db, request, runtime.modules),
  };
}

function sampleClock(): TrustedClock {
  return {
    now: () => {
      const instant = new Date();
      return {
        instant,
        offsetMinutes: -instant.getTimezoneOffset(),
        confident: true,
        confidence: "anchored",
        anchorAgeSeconds: 0,
      };
    },
    anchor: () => {
      throw new Error("readiness sample does not anchor its clock");
    },
    currentAnchor: () => null,
  };
}
