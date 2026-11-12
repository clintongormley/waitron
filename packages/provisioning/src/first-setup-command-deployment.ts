import { MODULES_FILE, SECRETS_ENV_FILE, TRADING_ENV_FILE } from "@waitron/store";
import { createHmac } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { parseEnv, isDeepStrictEqual } from "node:util";
import {
  establishNodeSigningKey,
  loadKeyRing,
  putCredential,
  readNodeIdentity,
} from "@waitron/credentials";
import {
  applicationVersion,
  readNodeMembershipRow,
  stampDeployment,
  withTransaction,
  writeNodeMembership,
  type Database,
  type NodeDatabase,
} from "@waitron/db";
import {
  buildNextMembershipDocument,
  isMembershipDocument,
  signBytes,
  verifyBytes,
  verifyMembershipDocument,
} from "@waitron/membership";
import { appliedSchemaVersion } from "@waitron/migrations";
import { enabledModules, modulesWithSets, serializeModuleConfig } from "@waitron/module";
import { AppError } from "@waitron/shared";
import type { FirstSetupCommandDeployment } from "./first-setup-command-activation.js";
import type { createFirstSetupRuntime } from "./first-setup-runtime.js";
import { firstSetupPublicationDigest } from "./first-setup-publication-digest.js";
import { writeFileDurable } from "./fs-atomic.js";
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
import { clearStagedConfigurationImport } from "./configuration-import.js";
import "./errors.js";

function conflict(): never {
  throw new AppError("setup.attempt_uncertain", {});
}

export function createFirstSetupCommandDeployment(options: {
  runtime: ReturnType<typeof createFirstSetupRuntime>;
  db: Database;
  node: NodeDatabase;
  environment: Record<string, string | undefined>;
}): FirstSetupCommandDeployment {
  const { runtime, db, node } = options;
  const environment = Object.freeze({ ...options.environment });
  let publication:
    | {
        digest: string;
        settings: ReturnType<typeof parseFirstSetupSettings>;
        ring: KeyRing;
      }
    | undefined;
  async function readiness(state: FirstSetupState) {
    if (
      publication === undefined ||
      firstSetupPublicationDigest(state, publication.settings) !== publication.digest
    )
      throw new AppError("setup.not_ready", {});
    const selected = venueFiscalSelection(runtime.modules, state.frozen.request.fiscalTerritory);
    if (selected.contribution === undefined) conflict();
    const modules = enabledModules(runtime.modules, selected.config);
    const versions: Record<string, number> = {};
    for (const module of modulesWithSets(modules))
      versions[module.name] = await appliedSchemaVersion({ venue: db, node }, module.migrations);
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
      const selection = venueFiscalSelection(runtime.modules, state.frozen.request.fiscalTerritory);
      if (selection.contribution === undefined) conflict();
      const settings = parseFirstSetupSettings(
        selection.contribution,
        state.frozen.environment,
        path ? await readFirstSetupSettings(path) : {},
      );
      let storedEnvironment: Record<string, string | undefined> = {};
      try {
        storedEnvironment = parseEnv(
          await readFile(join(state.stateDir, SECRETS_ENV_FILE), "utf8"),
        );
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
      const ring = loadKeyRing({ ...storedEnvironment, ...environment });
      let contactUrl: string;
      try {
        const parsed = new URL(environment.WAITRON_MANAGEMENT_ORIGIN ?? "");
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
      const digest = firstSetupPublicationDigest(state, settings);
      publication = { digest, settings, ring };
      return {
        digest,
        deps: {
          clearConfiguration: () => clearStagedConfigurationImport(state.stateDir),
          publishSelection: async () => {
            await writeFileDurable(
              join(state.stateDir, MODULES_FILE),
              JSON.stringify({ modules: serializeModuleConfig(config) }, null, 2) + "\n",
              0o600,
            );
          },
          publishIdentity: async (result, current) => {
            let own = await readNodeIdentity(db, node, ring, result.nodeId);
            if (own.trust[result.nodeId] === undefined) {
              await establishNodeSigningKey(db, node, ring, result.nodeId);
              own = await readNodeIdentity(db, node, ring, result.nodeId);
            }
            const publicKey = own.trust[result.nodeId];
            const privateKey = own.privateKey;
            if (publicKey === undefined || privateKey === null) conflict();
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
              WAITRON_NODE_ID: result.nodeId,
              WAITRON_ENV: environment.WAITRON_ENV === "dev" ? "dev" : current.frozen.environment,
              WAITRON_ONBOARDING_INTENT: "live",
              WAITRON_ACCOUNT_KEY: accountKey,
            };
            await writeFileDurable(
              join(current.stateDir, TRADING_ENV_FILE),
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
      const config = venueFiscalSelection(runtime.modules, request.venue.fiscalTerritory).config;
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
                if (--remaining === 0) {
                  await beforeTransaction();
                  // Only once activation has started: a refusal before then leaves the venue
                  // database empty, which Start again can delete.
                  await stampDeployment(db, request.environment);
                }
                return run(prepared);
              }),
          },
        };
      });
      return applyVenue(planVenue(request.venue, modules), {
        db,
        modules,
        ...initialVenueApplyInput(request.initialOperations),
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
