import { mountSetupSpa } from "./setup-spa.js";
import { isUnset } from "./env-value.js";
import { access } from "node:fs/promises";
import { readModuleConfig } from "./module-config.js";
import { withFirstSetupPublication } from "./first-setup-publication.js";
import { Hono } from "hono";
import { isDeepStrictEqual } from "node:util";
import { deploymentEnvironmentFor, lockVenueDatabase } from "@waitron/db";
import { ALL_MODULES } from "@waitron/composition";
import {
  assertFirstSetupBootTarget,
  canonicalFirstSetupDirectory,
  firstSetupAnchorFor,
  resolveFirstSetupWorkspace,
  type FirstSetupBootTarget,
} from "@waitron/provisioning";
import { AppError } from "@waitron/shared";
import { createFirstSetupModuleHost } from "./module-operation-host.js";
import type { FirstSetupRoots } from "./first-setup-resolution-inspection.js";
import { createFirstSetupResolutionActions } from "./first-setup-resolution.js";
import { mountFirstSetupResolutionApi } from "./setup-first-fiscal-api.js";
import type { Logger } from "./logger.js";
import "./errors.js";
import { caCertPath } from "./box-secrets.js";

async function needsResolution(host: ReturnType<typeof createFirstSetupModuleHost>) {
  const pair = await host.store.readResumable();
  if (pair === null) return { claimed: false, unresolved: false };
  const inspection = await host.resolution.inspectFirstSetupResolution();
  const unresolved =
    inspection.pair !== "valid" ||
    (pair.publicationComplete
      ? inspection.database !== "occupied"
      : inspection.database !== "no-venue-rows" ||
        [
          "activation-started",
          "committed",
          "publication",
          "complete",
          "uncertain",
          "abandoned",
        ].includes(pair.state.status));
  return { claimed: true, unresolved };
}

export async function resolveFirstSetupEntry(
  roots: FirstSetupRoots,
  environment: Readonly<Record<string, string | undefined>>,
  requestRestart?: () => void,
  log: Logger = () => {},
) {
  try {
    roots = {
      venueDir: await canonicalFirstSetupDirectory(roots.venueDir),
      stateDir: await canonicalFirstSetupDirectory(roots.stateDir),
    };
  } catch {
    return {
      kind: "normal" as const,
      roots: { ...roots, binding: null },
      run: <T>(body: () => Promise<T>) => body(),
    };
  }
  let target: FirstSetupBootTarget;
  try {
    target = await resolveFirstSetupWorkspace(roots);
  } catch {
    return {
      kind: "resolution" as const,
      app: await resolutionApp(roots, environment, requestRestart, log),
      roots,
    };
  }
  const host = createFirstSetupModuleHost({ ...target, environment, modules: ALL_MODULES });
  let claimed = false;
  try {
    const admission = await needsResolution(host);
    claimed = admission.claimed;
    if (admission.unresolved)
      return {
        kind: "resolution" as const,
        app: await resolutionApp(target, environment, requestRestart, log),
        roots: target,
      };
  } catch {
    return {
      kind: "resolution" as const,
      app: await resolutionApp(target, environment, requestRestart, log),
      roots: target,
    };
  }
  return {
    kind: "normal" as const,
    roots: target,
    async run<T>(body: () => Promise<T>): Promise<T> {
      if (!claimed && target.binding === null) return body();
      const anchor = await firstSetupAnchorFor(target);
      const hold = await lockVenueDatabase(anchor.venueDir);
      let selected: Awaited<ReturnType<typeof lockVenueDatabase>> | undefined;
      try {
        if (anchor.venueDir !== target.venueDir)
          selected = await lockVenueDatabase(target.venueDir);
        const current = await resolveFirstSetupWorkspace(roots);
        if (!isDeepStrictEqual(current, target)) throw new AppError("setup.attempt_uncertain", {});
        await assertFirstSetupBootTarget(target);
        if ((await needsResolution(host)).unresolved)
          throw new AppError("setup.attempt_uncertain", {});
        return await body();
      } finally {
        selected?.release();
        hold.release();
      }
    },
  };
}

async function resolutionApp(
  roots: FirstSetupRoots,
  environment: Readonly<Record<string, string | undefined>>,
  requestRestart?: () => void,
  log: Logger = () => {},
) {
  const moduleConfig = await readModuleConfig(roots.stateDir).catch(() => undefined);
  const host = createFirstSetupModuleHost({
    ...roots,
    environment,
    modules: ALL_MODULES,
    moduleConfig,
  });
  const app = new Hono();
  app.get("/setup-api/status", async (c) => {
    const pair = await host.store.readResumable().catch(() => null);
    const frozenEnvironment = pair?.state.frozen.environment;
    const selectedEnvironment =
      frozenEnvironment ?? deploymentEnvironmentFor(environment.WAITRON_ENV) ?? "preproduction";
    return c.json(
      {
        provisioned: false,
        environment: selectedEnvironment,
        ...(environment.WAITRON_ENV === "dev" && selectedEnvironment === "preproduction"
          ? { developmentMode: true }
          : {}),
        needs: ["first-setup-resolution"],
      },
      200,
      { "Cache-Control": "no-store" },
    );
  });
  app.get("/setup-api/discovery", async (c) =>
    c.json(
      {
        caDownloadAvailable: await access(caCertPath(roots.stateDir)).then(
          () => true,
          () => false,
        ),
      },
      200,
      { "Cache-Control": "no-store" },
    ),
  );
  app.get("/setup-api/first-setup/status", (c) =>
    c.json({ claimed: true, resolution: true }, 200, { "Cache-Control": "no-store" }),
  );
  const actions = createFirstSetupResolutionActions({ ...roots, host });
  mountFirstSetupResolutionApi(app, host, log, {
    startAgain: actions.startAgainFirstSetup,
    selection: actions,
    ...(moduleConfig === undefined
      ? {}
      : {
          withPublication: <T>(body: (deps: import("./setup-api.js").SetupDeps) => Promise<T>) =>
            withFirstSetupPublication(roots, environment, host, body),
        }),
    ...(requestRestart === undefined ? {} : { requestRestart }),
  });
  if (!isUnset(environment.WAITRON_SETUP_APP_DIR))
    mountSetupSpa(app, environment.WAITRON_SETUP_APP_DIR!, log);
  return app;
}
