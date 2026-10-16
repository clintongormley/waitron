import { Hono } from "hono";
import { isDeepStrictEqual } from "node:util";
import { lockVenueDatabase } from "@waitron/db";
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
      app: resolutionApp(roots, environment, requestRestart, log),
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
        app: resolutionApp(target, environment, requestRestart, log),
        roots: target,
      };
  } catch {
    return {
      kind: "resolution" as const,
      app: resolutionApp(target, environment, requestRestart, log),
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

function resolutionApp(
  roots: FirstSetupRoots,
  environment: Readonly<Record<string, string | undefined>>,
  requestRestart?: () => void,
  log: Logger = () => {},
) {
  const host = createFirstSetupModuleHost({ ...roots, environment, modules: ALL_MODULES });
  const app = new Hono();
  app.get("/setup-api/first-setup/status", (c) =>
    c.json({ claimed: true, resolution: true }, 200, { "Cache-Control": "no-store" }),
  );
  const actions = createFirstSetupResolutionActions({ ...roots, host });
  mountFirstSetupResolutionApi(app, host, log, {
    startAgain: actions.startAgainFirstSetup,
    ...(requestRestart === undefined ? {} : { requestRestart }),
  });
  return app;
}
