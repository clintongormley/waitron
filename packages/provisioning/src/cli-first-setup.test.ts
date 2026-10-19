import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { AppError } from "@waitron/shared";
import { ALL_MODULES } from "@waitron/composition";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { TEST_MIGRATIONS } from "@waitron/fiscal-verifactu/test/migrations.js";
import {
  deploymentTableExists,
  readDeploymentEnvironment,
  stampDeployment,
  invoiceSeries,
  type VenueDatabase,
} from "@waitron/db";
import { runCli, type CliDeps } from "./cli.js";
import { applyVenue, type VenueResult } from "./venue-apply.js";
import { planVenue } from "./venue-plan.js";
import { venueFiscalSelection } from "./venue-fiscal.js";
import { enabledModules } from "@waitron/module";
import { initialVenueApplyInput } from "./initial-venue-input.js";
import { readTenantIdentities } from "./tenant-guard.js";
import { createFirstSetupRuntime } from "./first-setup-runtime.js";
import { MODULE, PASSWORD, request } from "../test/first-setup-request.js";
import { randomBytes, randomUUID } from "node:crypto";
import { createFirstSetupCoordinator } from "./first-setup-state.js";
import { createFirstSetupResolutionStore } from "./first-setup-resolution.js";
import { selectFirstSetupWorkspace } from "./first-setup-workspace.js";

const NOW = Date.parse("2026-10-16T11:40:00Z");
const external = vi.hoisted(() => ({ internet: vi.fn() }));
vi.mock("@waitron/fiscal-verifactu/src/hour-clock-internet.js", () => ({
  observeInternetHourClock: external.internet,
}));
vi.mock("@waitron/fiscal-verifactu/src/hour-release.js", () => ({
  readHourRelease: () => ({ instantMs: Date.parse("2026-10-15T00:00:00Z") }),
}));
const venue = useVenueDb({ migrations: TEST_MIGRATIONS });
const roots: string[] = [];
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date", "performance"] });
  vi.setSystemTime(NOW);
  external.internet.mockImplementation(async () => ({
    source: "internet",
    result: "usable",
    instantMs: NOW,
    uncertaintyMs: 500,
    wallStartedMs: NOW,
    wallFinishedMs: NOW,
    monotonicStartedMs: performance.now(),
    monotonicFinishedMs: performance.now(),
  }));
});
afterEach(async () => {
  vi.useRealTimers();
  external.internet.mockReset();
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function fixture(answer = "yes") {
  const root = await mkdtemp(join(tmpdir(), "owned-cli-"));
  roots.push(root);
  const output: string[] = [];
  const prompts: string[] = [];
  const args = [
    "venue",
    "--venue-dir",
    join(root, "venue"),
    "--country",
    request.country,
    "--tax-id",
    request.taxId,
    "--legal-name",
    request.legalName,
    "--taxpayer-domicile",
    request.taxpayerDomicile,
    "--location-name",
    request.location.name,
    "--territory",
    request.location.fiscalTerritory,
    "--locale",
    "es-ES",
    "--operation-description",
    request.location.operationDescription,
    "--address-line1",
    request.location.addressLine1,
    "--address-line2",
    "Local 2",
    "--postal-code",
    request.location.postalCode,
    "--city",
    request.location.city,
    "--province",
    request.location.province,
    "--time-zone",
    request.location.timeZone,
    "--day-cutover",
    request.location.dayCutover,
    "--series-code",
    "A",
    "--full-series-code",
    "FF",
    "--rectificative-code",
    "R",
    "--admin-name",
    request.admin.displayName,
    "--admin-email",
    request.admin.email,
    "--yes",
  ];
  const runtime = createFirstSetupRuntime({
    stateDir: join(root, "state"),
    venueDir: join(root, "venue"),
    environment: {},
    modules: ALL_MODULES,
    database: () => venue.db,
  });
  const deps: CliDeps & { configureFirstSetup: () => typeof runtime } = {
    io: {
      stdout: (line) => void output.push(line),
      stderr: (line) => void output.push(line),
      prompt: async (question) => {
        prompts.push(question);
        return answer;
      },
      promptSecret: async (question) => {
        prompts.push(question);
        return PASSWORD;
      },
      clearScreen() {},
    },
    env: { WAITRON_ADMIN_PIN: request.admin.pin, WAITRON_ADMIN_PASSWORD: PASSWORD },
    openVenue: vi.fn(
      async () => ({ venue: venue.db, node: venue.db, close: async () => {} }) as VenueDatabase,
    ),
    applyVenue,
    modules: ALL_MODULES,
    configureFirstSetup: () => runtime,
    readEnvironment: readDeploymentEnvironment,
    readDeploymentTable: deploymentTableExists,
    stampEnvironment: stampDeployment,
    readTenants: readTenantIdentities,
  };
  return { root, args, deps, runtime, output, prompts };
}

it("the venue command claims ownership and retains an hour wait before any venue write", async () => {
  const f = await fixture();
  expect(await runCli(f.args, f.deps)).toBe(1);
  const state = await f.runtime.store.read();
  expect(state).toMatchObject({ status: "claimed", consumptionIntent: false, ownerGeneration: 1 });
  expect(state!.inputs).toEqual({});
  const journal = JSON.parse(
    await readFile(join(f.root, "state/module-preparation-state.json"), "utf8"),
  );
  expect(journal.revisions.at(-1).value.entries).toMatchObject([
    { kind: "wait", answer: "yes", targetMs: Date.parse("2026-10-16T12:00:00Z") },
  ]);
  expect(f.output.join("\n")).toContain("2026-10-16T12:00:00.000Z");
  expect(f.output.join("\n")).not.toContain(PASSWORD);
  expect(await readTenantIdentities(venue.db)).toEqual([]);
  expect(await readDeploymentEnvironment(venue.db)).toBeNull();
});

it("the venue command imports selected module input but cannot skip unfinished publication", async () => {
  const f = await fixture("no");
  expect(await runCli(f.args, f.deps)).toBe(1);
  const state = await f.runtime.store.read();
  expect(state).toMatchObject({ status: "consumption-intent", consumptionIntent: true });
  expect(state!.inputs[MODULE]).toMatchObject({ allocation: { installationIdentity: "06RB" } });
  expect(f.output, JSON.stringify(f.output)).toContain("setup.not_ready {}");
  expect(await readTenantIdentities(venue.db)).toEqual([]);
  expect(await readDeploymentEnvironment(venue.db)).toBeNull();
});

it("a restarted command recovers its original wait using the setup password", async () => {
  const f = await fixture();
  expect(await runCli(f.args, f.deps)).toBe(1);
  const before = (await f.runtime.store.read())!;
  const restarted = createFirstSetupRuntime({
    stateDir: join(f.root, "state"),
    venueDir: join(f.root, "venue"),
    environment: {},
    modules: ALL_MODULES,
    database: () => venue.db,
  });
  f.deps.configureFirstSetup = () => restarted;
  f.prompts.length = 0;
  expect(await runCli(f.args, f.deps)).toBe(1);
  const after = (await restarted.store.read())!;
  expect(after.frozen).toEqual(before.frozen);
  expect(after.ownerGeneration).toBe(2);
  expect(after.status).toBe("claimed");
  expect(f.prompts).not.toContain(
    "Has anyone set up a Waitron box for this business in the last hour? [no/yes/unknown]: ",
  );
  expect(f.output.join("\n")).toContain("2026-10-16T12:00:00.000Z");
  expect(await readTenantIdentities(venue.db)).toEqual([]);
});

it("a wrong setup password leaves the retained attempt unchanged and does not open it", async () => {
  const f = await fixture();
  await runCli(f.args, f.deps);
  const before = await f.runtime.store.read();
  f.deps.env.WAITRON_ADMIN_PASSWORD = "SYNTHETIC-wrong-password";
  vi.mocked(f.deps.openVenue).mockClear();
  expect(await runCli(f.args, f.deps)).toBe(1);
  expect(f.output).toContain("setup.owner_required {}");
  expect(await f.runtime.store.read()).toEqual(before);
  expect(f.deps.openVenue).not.toHaveBeenCalled();
});

it("a changed frozen series set cannot take over an interrupted command", async () => {
  const f = await fixture();
  await runCli(f.args, f.deps);
  const before = await f.runtime.store.read();
  const args = [...f.args];
  args[args.indexOf("--series-code") + 1] = "B";
  expect(await runCli(args, f.deps)).toBe(1);
  expect(f.output).toContain("setup.attempt_conflict {}");
  expect(await f.runtime.store.read()).toEqual(before);
});

it("JSON activation input cannot become owned preparation authority", async () => {
  const f = await fixture("no");
  f.deps.env.WAITRON_INITIAL_VENUE_INPUT = join(f.root, "unread-input.json");
  expect(await runCli(f.args, f.deps)).toBe(1);
  expect(f.output).toContain("provisioning.initial_input_invalid {}");
  expect(await f.runtime.store.read()).toBeNull();
  expect(await readDeploymentEnvironment(venue.db)).toBeNull();
});

it("a differently stamped database is refused before recording a new setup attempt", async () => {
  const f = await fixture();
  await stampDeployment(venue.db, "preproduction");
  f.deps.env.WAITRON_ENV = "production";
  expect(await runCli(f.args, f.deps)).toBe(1);
  expect(f.output).toContain(
    'deployment.already_stamped {"stamped":"preproduction","requested":"production"}',
  );
  expect(await f.runtime.store.read()).toBeNull();
  expect(await readDeploymentEnvironment(venue.db)).toBe("preproduction");
});

it("a command without a retired-evidence adapter refuses a successor workspace", async () => {
  const f = await fixture();
  await runCli(f.args, f.deps);
  const snapshot = await f.runtime.resolution.captureFirstSetupOriginals();
  const state = (await f.runtime.store.read())!;
  const resolutionId = randomUUID();
  const workspaceId = randomUUID();
  const roots = { stateDir: state.stateDir, venueDir: state.venueDir };
  const base = join(state.stateDir, "first-setup-workspaces", workspaceId);
  const binding = {
    workspaceId,
    resolutionId,
    anchorVenueDir: state.venueDir,
    anchorStateDir: state.stateDir,
    venueDir: join(base, "venue"),
    stateDir: join(base, "state"),
    selectionGeneration: 1,
  };
  const records = createFirstSetupResolutionStore({
    ...roots,
    coordinator: createFirstSetupCoordinator(),
  });
  const prepared = await records.prepare(
    {
      resolutionId,
      attemptId: state.frozen.attemptId,
      observedRevision: state.revision,
      observedOwnerGeneration: state.ownerGeneration,
      database: "missing",
      authority: "original-password",
      action: "retire",
      nextWorkspace: binding,
      register: {
        kind: "current-master",
        status: "Unknown",
        custodian: "Elena",
        reference: "c".repeat(64),
        consultedAt: "2026-10-16T11:40:00.000Z",
      },
    },
    snapshot.originals,
  );
  await selectFirstSetupWorkspace(roots, await records.apply(prepared));
  const runtime = createFirstSetupRuntime({
    stateDir: binding.stateDir,
    venueDir: binding.venueDir,
    environment: {},
    modules: ALL_MODULES,
    database: () => venue.db,
  });
  f.deps.configureFirstSetup = () => runtime;
  const args = [...f.args];
  args[args.indexOf("--venue-dir") + 1] = binding.venueDir;
  expect(await runCli(args, f.deps)).toBe(1);
  expect(f.output).toContain("setup.not_ready {}");
  expect((await runtime.store.read())!.inputs).toEqual({});
  expect(await readTenantIdentities(venue.db)).toEqual([]);
});

it("declining a resumed plan does not rotate ownership or open the database", async () => {
  const f = await fixture();
  await runCli(f.args, f.deps);
  const before = await f.runtime.store.read();
  f.deps.io.prompt = async () => "no";
  vi.mocked(f.deps.openVenue).mockClear();
  expect(
    await runCli(
      f.args.filter((arg) => arg !== "--yes"),
      f.deps,
    ),
  ).toBe(1);
  expect(f.output).toContain("Nothing was applied.");
  expect(await f.runtime.store.read()).toEqual(before);
  expect(f.deps.openVenue).not.toHaveBeenCalled();
});

it("a changed module version cannot recover a retained command", async () => {
  const f = await fixture();
  await runCli(f.args, f.deps);
  const before = await f.runtime.store.read();
  const changed = createFirstSetupRuntime({
    stateDir: join(f.root, "state"),
    venueDir: join(f.root, "venue"),
    environment: {},
    modules: ALL_MODULES.map((module) =>
      module.name === MODULE ? { ...module, version: "99.0.0" } : module,
    ),
    database: () => venue.db,
  });
  f.deps.configureFirstSetup = () => changed;
  vi.mocked(f.deps.openVenue).mockClear();
  expect(await runCli(f.args, f.deps)).toBe(1);
  expect(f.output).toContain("setup.attempt_conflict {}");
  expect(await f.runtime.store.read()).toEqual(before);
  expect(f.deps.openVenue).not.toHaveBeenCalled();
});

it("ownership lost during open refuses before the command reads the opened database", async () => {
  const f = await fixture();
  await runCli(f.args, f.deps);
  const { randomBytes } = await import("node:crypto");
  const readEnvironment = vi.fn(readDeploymentEnvironment);
  f.deps.readEnvironment = readEnvironment;
  let closes = 0;
  f.deps.openVenue = async () => {
    await f.runtime.owner.recoverFirstSetup(randomBytes(32).toString("base64url"), {
      password: PASSWORD,
    });
    return {
      venue: venue.db,
      node: venue.db,
      close: async () => {
        closes++;
      },
    };
  };
  expect(await runCli(f.args, f.deps)).toBe(1);
  expect(f.output).toContain("setup.owner_required {}");
  expect(readEnvironment).not.toHaveBeenCalled();
  expect(closes).toBe(1);
  expect((await f.runtime.store.read())!.ownerGeneration).toBe(3);
  expect((await f.runtime.store.read())!.inputs).toEqual({});
});

it("ownership lost after recovery refuses before opening the database", async () => {
  const f = await fixture();
  await runCli(f.args, f.deps);
  const { randomBytes } = await import("node:crypto");
  const recover = f.runtime.owner.recoverFirstSetupOwner;
  f.runtime.owner.recoverFirstSetupOwner = async (request) => {
    const recovered = await recover(request);
    await f.runtime.owner.recoverFirstSetup(randomBytes(32).toString("base64url"), {
      password: PASSWORD,
    });
    return recovered;
  };
  vi.mocked(f.deps.openVenue).mockClear();
  expect(await runCli(f.args, f.deps)).toBe(1);
  expect(f.output).toContain("setup.owner_required {}");
  expect(f.deps.openVenue).not.toHaveBeenCalled();
  expect((await f.runtime.store.read())!.ownerGeneration).toBe(3);
});

it("the actual venue command saves its selected recovery PDF and asks for kept despite --yes", async () => {
  const f = await fixture("no");
  const path = join(f.root, "selected-recovery.pdf");
  f.deps.io.prompt = async (question) => {
    f.prompts.push(question);
    return question.startsWith("Have you kept") ? "yes" : "no";
  };
  expect(await runCli([...f.args, "--recovery-pdf", path], f.deps)).toBe(1);
  await expect(readFile(path)).resolves.toBeInstanceOf(Buffer);
  const pdf = await readFile(path);
  expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
  expect(f.prompts).toContain("Have you kept this recovery PDF? [y/N]: ");
  const state = (await f.runtime.store.read())!;
  expect(state.status).toBe("consumption-intent");
  expect(f.output).toContain("setup.not_ready {}");
  expect(await readTenantIdentities(venue.db)).toEqual([]);
  expect(await readDeploymentEnvironment(venue.db)).toBeNull();
});

it("declining kept in the actual venue command preserves the saved PDF and leaves setup unactivated", async () => {
  const f = await fixture("no");
  const path = join(f.root, "declined-recovery.pdf");
  expect(await runCli([...f.args, "--recovery-pdf", path], f.deps)).toBe(1);
  await expect(readFile(path)).resolves.toBeInstanceOf(Buffer);
  expect(f.prompts).toContain("Have you kept this recovery PDF? [y/N]: ");
  expect(f.output).not.toContain("setup.not_ready {}");
  expect(await readTenantIdentities(venue.db)).toEqual([]);
  expect((await f.runtime.store.read())!.status).toBe("consumption-intent");
});

async function activationFixture() {
  const f = await fixture("no");
  const calls: string[] = [];
  let written: VenueResult | undefined;
  let failPublication = false;
  f.deps.io.prompt = async (question) => {
    f.prompts.push(question);
    return question.startsWith("Have you kept") ? "yes" : "no";
  };
  f.deps.firstSetupDeployment = ({ runtime, db }) => ({
    publication: async () => ({
      digest: "a".repeat(64),
      deps: {
        publishSelection: async () => {
          calls.push("selection");
        },
        publishIdentity: async () => {
          calls.push("identity");
        },
        sealSettings: async () => {
          calls.push("settings");
        },
        persistTrading: async () => {
          calls.push("trading");
          if (failPublication) throw new Error("synthetic publication interrupted");
        },
      },
    }),
    assertReady: async () => {
      calls.push("readiness");
    },
    provision: async (request, beforeTransaction) => {
      calls.push("provision");
      await stampDeployment(db, request.environment);
      const initial = request.initialOperations;
      const modules = runtime.modules
        .filter((module) => stateModules(request).includes(module.name))
        .map((module) => {
          if (
            module.operations === undefined ||
            !initial.inputs.some((input) => input.module === module.name)
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
                  await beforeTransaction();
                  calls.push((await runtime.store.read())!.status);
                  return run(prepared);
                }),
            },
          };
        });
      written = await applyVenue(planVenue(request.venue, modules), {
        ...initialVenueApplyInput(initial),
        db,
        modules,
      });
      return written;
    },
    recoverProvision: async () => {
      calls.push("check");
      if (written === undefined) throw new Error("no committed venue");
      return structuredClone(written);
    },
  });
  function stateModules(request: { venue: { location: { fiscalTerritory: string } } }) {
    return enabledModules(
      f.runtime.modules,
      venueFiscalSelection(f.runtime.modules, request.venue.location.fiscalTerritory).config,
    ).map((module) => module.name);
  }
  const args = [...f.args, "--recovery-pdf", join(f.root, "recovery.pdf")];
  return {
    ...f,
    args,
    calls,
    interrupt: (value: boolean) => {
      failPublication = value;
    },
  };
}

it("the venue command activates its kept hour and completes checked publication", async () => {
  const f = await activationFixture();
  expect(await runCli(f.args, f.deps), JSON.stringify(f.output)).toBe(0);
  const state = (await f.runtime.store.read())!;
  expect(state.status).toBe("complete");
  expect(f.calls).toEqual([
    "readiness",
    "provision",
    "activation-started",
    "check",
    "selection",
    "identity",
    "settings",
    "trading",
  ]);
  const series = await venue.db
    .select({ code: invoiceSeries.code, nextNumber: invoiceSeries.nextNumber })
    .from(invoiceSeries);
  expect(series.map((row) => row.code).sort()).toEqual(["A-06RB", "FF-06RB", "R-06RB"]);
  expect(series.map((row) => row.nextNumber)).toEqual([1, 1, 1]);
  expect(f.output).toContain(`node:     ${state.frozen.nodeId}`);
  expect(await readDeploymentEnvironment(venue.db)).toBe("preproduction");
});

it("a restarted venue command finishes the exact commit without preparing or activating again", async () => {
  const f = await activationFixture();
  f.interrupt(true);
  await expect(runCli(f.args, f.deps)).rejects.toThrow("synthetic publication interrupted");
  const before = (await f.runtime.store.read())!;
  expect(before.status).toBe("committed");
  const seriesBefore = await venue.db.select().from(invoiceSeries);
  f.interrupt(false);
  f.calls.length = 0;
  f.prompts.length = 0;
  expect(
    await runCli(
      f.args.filter(
        (arg, index, all) => arg !== "--recovery-pdf" && all[index - 1] !== "--recovery-pdf",
      ),
      f.deps,
    ),
    JSON.stringify(f.output),
  ).toBe(0);
  const after = (await f.runtime.store.read())!;
  expect(after.status).toBe("complete");
  expect(after.frozen).toEqual(before.frozen);
  expect(after.ownerGeneration).toBe(before.ownerGeneration + 1);
  expect(after.history.at(-1)?.kind).toBe("complete");
  expect(after.inputs).toEqual(before.inputs);
  expect(await venue.db.select().from(invoiceSeries)).toEqual(seriesBefore);
  expect(f.calls).toEqual(["check", "selection", "identity", "settings", "trading"]);
  expect(f.prompts).toEqual([]);
});

it("the real preproduction deployment adapter completes publication through the venue command", async () => {
  const f = await activationFixture();
  const { createFirstSetupCommandDeployment } = await import("./first-setup-command-deployment.js");
  f.deps.firstSetupDeployment = ({ runtime, db }) =>
    createFirstSetupCommandDeployment({
      runtime,
      db,
      environment: {
        WAITRON_ADVERTISED_ORIGIN: "https://olivo.example.test:3443",
        WAITRON_CREDENTIALS_KEY: Buffer.alloc(32, 73).toString("base64"),
      },
    });
  expect(await runCli(f.args, f.deps), JSON.stringify(f.output)).toBe(0);
  expect((await f.runtime.store.read())!.status).toBe("complete");
});

it("a configured deployment cannot activate without a kept recovery document", async () => {
  const f = await activationFixture();
  const args = f.args.filter(
    (arg, index, all) => arg !== "--recovery-pdf" && all[index - 1] !== "--recovery-pdf",
  );
  expect(await runCli(args, f.deps)).toBe(1);
  expect(f.calls).toEqual([]);
  expect(f.output).toContain("setup.not_ready {}");
  expect(await readTenantIdentities(venue.db)).toEqual([]);
  expect(await readDeploymentEnvironment(venue.db)).toBeNull();
});

it("a deployment readiness refusal leaves the kept attempt unactivated", async () => {
  const f = await activationFixture();
  const factory = f.deps.firstSetupDeployment!;
  f.deps.firstSetupDeployment = (context) => ({
    ...factory(context),
    assertReady: async () => {
      throw new AppError("setup.not_ready", {});
    },
  });
  expect(await runCli(f.args, f.deps)).toBe(1);
  expect(f.calls).toEqual([]);
  expect(f.output).toContain("setup.not_ready {}");
  expect((await f.runtime.store.read())!.status).toBe("consumption-intent");
  expect(await readTenantIdentities(venue.db)).toEqual([]);
  expect(await readDeploymentEnvironment(venue.db)).toBeNull();
});

it("changed publication settings cannot finish a committed command", async () => {
  const f = await activationFixture();
  f.interrupt(true);
  await expect(runCli(f.args, f.deps)).rejects.toThrow("synthetic publication interrupted");
  const before = (await f.runtime.store.read())!;
  f.calls.length = 0;
  const factory = f.deps.firstSetupDeployment!;
  f.deps.firstSetupDeployment = (context) => {
    const deployment = factory(context);
    const publication = deployment.publication;
    return {
      ...deployment,
      publication: async (state) => ({ ...(await publication(state)), digest: "b".repeat(64) }),
    };
  };
  expect(await runCli(f.args, f.deps)).toBe(1);
  expect(f.output).toContain("setup.attempt_uncertain {}");
  expect(f.calls).toEqual([]);
  const after = (await f.runtime.store.read())!;
  expect(after.status).toBe("committed");
  expect(after.frozen).toEqual(before.frozen);
  expect(after.inputs).toEqual(before.inputs);
});

it("stale command ownership refuses before loading publication settings", async () => {
  const f = await activationFixture();
  const authorize = vi.spyOn(f.runtime.owner, "authorize");
  f.interrupt(true);
  await expect(runCli(f.args, f.deps)).rejects.toThrow("synthetic publication interrupted");
  const state = (await f.runtime.store.read())!;
  const owner = { ...authorize.mock.calls.at(-1)![0], revision: state.revision };
  const recovered = await f.runtime.owner.recoverFirstSetup(randomBytes(32).toString("base64url"), {
    password: PASSWORD,
  });
  expect(recovered.state.ownerGeneration).toBe(owner.ownerGeneration + 1);
  const deployment = f.deps.firstSetupDeployment!({ runtime: f.runtime, db: venue.db });
  const publication = vi.spyOn(deployment, "publication");
  const { completeFirstSetupCommand } = await import("./first-setup-command-activation.js");
  await expect(
    completeFirstSetupCommand(f.runtime, venue.db, owner, deployment),
  ).rejects.toMatchObject({ code: "setup.owner_required" });
  expect(publication).not.toHaveBeenCalled();
  expect((await f.runtime.store.read())!.status).toBe("committed");
});

it("the real command deployment refuses production before committing any venue", async () => {
  const f = await activationFixture();
  f.deps.env.WAITRON_ENV = "production";
  const { createFirstSetupCommandDeployment } = await import("./first-setup-command-deployment.js");
  f.deps.firstSetupDeployment = ({ runtime, db }) =>
    createFirstSetupCommandDeployment({ runtime, db, environment: {} });
  expect(await runCli(f.args, f.deps)).toBe(1);
  expect(f.output).toContain("setup.not_ready {}");
  expect((await f.runtime.store.read())!.status).toBe("consumption-intent");
  expect(await readTenantIdentities(venue.db)).toEqual([]);
  expect(await readDeploymentEnvironment(venue.db)).toBeNull();
});

it("a command Finish checks recovered ownership before loading publication secrets", async () => {
  const f = await activationFixture();
  const authorize = vi.spyOn(f.runtime.owner, "authorize");
  f.interrupt(true);
  await expect(runCli(f.args, f.deps)).rejects.toThrow("synthetic publication interrupted");
  const state = (await f.runtime.store.read())!;
  const owner = { ...authorize.mock.calls.at(-1)![0], revision: state.revision };
  const deployment = f.deps.firstSetupDeployment!({ runtime: f.runtime, db: venue.db });
  const publication = vi.spyOn(deployment, "publication");
  const { completeFirstSetupCommand } = await import("./first-setup-command-activation.js");
  await expect(
    completeFirstSetupCommand(f.runtime, venue.db, owner, deployment),
  ).rejects.toMatchObject({ code: "setup.owner_required" });
  expect(publication).not.toHaveBeenCalled();
  expect((await f.runtime.store.read())!).toEqual(state);
});

async function realActivationFixture(environment: Record<string, string | undefined> = {}) {
  const f = await activationFixture();
  const { createFirstSetupCommandDeployment } = await import("./first-setup-command-deployment.js");
  let interrupted = false;
  const env: Record<string, string | undefined> = {
    WAITRON_ADVERTISED_ORIGIN: "https://olivo.example.test:3443",
    WAITRON_CREDENTIALS_KEY: Buffer.alloc(32, 73).toString("base64"),
    ...environment,
  };
  f.deps.firstSetupDeployment = ({ runtime, db }) => {
    const deployment = createFirstSetupCommandDeployment({ runtime, db, environment: env });
    const publication = deployment.publication;
    return {
      ...deployment,
      publication: async (state) => {
        const result = await publication(state);
        const persistTrading = result.deps.persistTrading;
        return {
          ...result,
          deps: {
            ...result.deps,
            persistTrading: async (...args) => {
              if (interrupted) throw new Error("synthetic before trading publication");
              await persistTrading(...args);
            },
          },
        };
      },
    };
  };
  return {
    ...f,
    env,
    interrupt: (value: boolean) => {
      interrupted = value;
    },
  };
}

it.each([
  "",
  "javascript:alert(1)",
  "https://olivo.example.test/path",
  "https://user:pass@olivo.example.test",
  "https://olivo.example.test/?q=1",
  "https://olivo.example.test/#fragment",
])("an unusable membership origin (%s) refuses before venue creation", async (origin) => {
  const f = await realActivationFixture({ WAITRON_ADVERTISED_ORIGIN: origin });
  expect(await runCli(f.args, f.deps)).toBe(1);
  expect(f.output).toContain("setup.not_ready {}");
  expect(await readTenantIdentities(venue.db)).toEqual([]);
  expect(await readDeploymentEnvironment(venue.db)).toBeNull();
});

it("an absent vault key refuses before venue creation", async () => {
  const f = await realActivationFixture({ WAITRON_CREDENTIALS_KEY: "" });
  expect(await runCli(f.args, f.deps)).toBe(1);
  expect(f.output).toContain('credentials.key_missing {"variable":"WAITRON_CREDENTIALS_KEY"}');
  expect(await readTenantIdentities(venue.db)).toEqual([]);
  expect(await readDeploymentEnvironment(venue.db)).toBeNull();
});

it("the command can load its existing vault key from the selected state directory", async () => {
  const f = await realActivationFixture();
  const { writeFile, mkdir } = await import("node:fs/promises");
  await mkdir(join(f.root, "state"));
  await writeFile(
    join(f.root, "state/secrets.env"),
    `WAITRON_CREDENTIALS_KEY=${f.env.WAITRON_CREDENTIALS_KEY}\nWAITRON_CREDENTIALS_KEY_VERSION=1\n`,
  );
  delete f.env.WAITRON_CREDENTIALS_KEY;
  expect(await runCli(f.args, f.deps), JSON.stringify(f.output)).toBe(0);
  expect((await f.runtime.store.read())!.status).toBe("complete");
});

it("a mismatched stored node key cannot finish interrupted command publication", async () => {
  const f = await realActivationFixture();
  f.interrupt(true);
  await expect(runCli(f.args, f.deps)).rejects.toThrow("synthetic before trading publication");
  const before = (await f.runtime.store.read())!;
  const series = await venue.db.select().from(invoiceSeries);
  const { setNodePublicKey, writeNodeMembership } = await import("@waitron/db");
  const { generateNodeKeyPair, buildNextMembershipDocument } = await import("@waitron/membership");
  const pair = generateNodeKeyPair();
  await setNodePublicKey(venue.db, before.frozen.nodeId, pair.publicKey);
  await writeNodeMembership(
    venue.db,
    buildNextMembershipDocument({
      heldDocument: null,
      signerNodeId: before.frozen.nodeId,
      signerPrivateKey: pair.privateKey,
      nodes: [
        {
          nodeId: before.frozen.nodeId,
          contactUrl: "https://olivo.example.test:3443",
          standing: "serving-primary",
        },
      ],
    }),
  );
  f.interrupt(false);
  expect(await runCli(f.args, f.deps)).toBe(1);
  expect(f.output).toContain("setup.attempt_uncertain {}");
  expect((await f.runtime.store.read())!.status).toBe("committed");
  expect(await venue.db.select().from(invoiceSeries)).toEqual(series);
  await expect(readFile(join(f.root, "state/trading.env"))).rejects.toMatchObject({
    code: "ENOENT",
  });
});

it("an altered signed membership cannot finish interrupted command publication", async () => {
  const f = await realActivationFixture();
  f.interrupt(true);
  await expect(runCli(f.args, f.deps)).rejects.toThrow("synthetic before trading publication");
  const { readNodeMembershipRow, writeNodeMembership } = await import("@waitron/db");
  const { isMembershipDocument } = await import("@waitron/membership");
  const membership = (await readNodeMembershipRow(venue.db))!;
  if (!isMembershipDocument(membership.document)) throw new Error("invalid fixture membership");
  const altered = {
    ...membership.document,
    body: {
      ...membership.document.body,
      nodes: membership.document.body.nodes.map((node) => ({
        ...node,
        contactUrl: "https://changed.example.test",
      })),
    },
  };
  await writeNodeMembership(venue.db, altered);
  f.interrupt(false);
  expect(await runCli(f.args, f.deps)).toBe(1);
  expect(f.output).toContain("setup.attempt_uncertain {}");
  expect((await f.runtime.store.read())!.status).toBe("committed");
  await expect(readFile(join(f.root, "state/trading.env"))).rejects.toMatchObject({
    code: "ENOENT",
  });
});

it("the command refuses a retained configuration import when its staged material is unavailable", async () => {
  const f = await realActivationFixture();
  const runtime = createFirstSetupRuntime({
    stateDir: join(f.root, "state"),
    venueDir: join(f.root, "venue"),
    modules: ALL_MODULES,
    database: () => venue.db,
    environment: {},
    freezeConfiguration: async () => ({ digest: "c".repeat(64), newTaxpayer: false }),
  });
  f.deps.configureFirstSetup = () => runtime;
  await runtime.owner.claimFirstSetup(
    {
      environment: "preproduction",
      configurationImport: true,
      request: {
        ...request,
        admin: { ...request.admin, firstNames: null, lastNames: null, locale: null },
        location: { ...request.location, addressLine2: "Local 2" },
      },
    },
    randomBytes(32).toString("base64url"),
  );
  expect(await runCli(f.args, f.deps), JSON.stringify(f.output)).toBe(1);
  expect(f.output).toContain("setup.not_ready {}");
  expect((await runtime.store.read())!.status).toBe("consumption-intent");
  expect(await readTenantIdentities(venue.db)).toEqual([]);
  expect(await readDeploymentEnvironment(venue.db)).toBeNull();
});

it("a refusal after stamping retains the environment without writing the venue", async () => {
  const f = await realActivationFixture();
  const factory = f.deps.firstSetupDeployment!;
  f.deps.firstSetupDeployment = (context) => {
    const deployment = factory(context);
    const provision = deployment.provision;
    return {
      ...deployment,
      provision: (request) =>
        provision(request, async () => {
          throw new AppError("setup.not_ready", {});
        }),
    };
  };
  expect(await runCli(f.args, f.deps)).toBe(1);
  expect(f.output).toContain("setup.not_ready {}");
  expect(await readDeploymentEnvironment(venue.db)).toBe("preproduction");
  expect(await readTenantIdentities(venue.db)).toEqual([]);
  expect(await venue.db.select().from(invoiceSeries)).toEqual([]);
  expect((await f.runtime.store.read())!.status).toBe("consumption-intent");
});

const productionCertificate = {
  pfxBase64: "c3ludGhldGlj",
  passphrase: "SYNTHETIC-production-cert",
  certKind: "sello",
};
const productionEmail = {
  server: "smtp.example.test",
  port: 587,
  encryption: "starttls",
  user: "elena",
  password: "SYNTHETIC-production-smtp",
  from: "elena@example.test",
};

async function productionFixture(accepted: boolean, certificate = productionCertificate) {
  const { mkdir, writeFile } = await import("node:fs/promises");
  const f = await realActivationFixture({ WAITRON_BUILD_ID: "synthetic-production-build" });
  f.deps.env.WAITRON_ENV = "production";
  f.env.WAITRON_ENV = "production";
  const settingsPath = join(f.root, "publication-settings.json");
  f.env.WAITRON_SETUP_SETTINGS_FILE = settingsPath;
  await writeFile(settingsPath, JSON.stringify({ aeatCert: certificate, email: productionEmail }), {
    mode: 0o600,
  });
  const selected = venueFiscalSelection(ALL_MODULES, "ES-common");
  const modules = enabledModules(ALL_MODULES, selected.config);
  const versions: Record<string, number> = {};
  const { appliedSchemaVersion } = await import("@waitron/migrations");
  for (const module of modules)
    versions[module.name] = await appliedSchemaVersion(venue.db, module.migrations);
  const { fiscalReadinessInput } = await import("./fiscal-readiness-input.js");
  const readiness = fiscalReadinessInput({
    venue: {
      ...request,
      admin: {
        displayName: request.admin.displayName,
        email: request.admin.email,
        pinHash: "synthetic",
        passwordHash: "synthetic",
      },
    },
    contribution: selected.contribution!,
    secret: certificate,
    moduleVersions: versions,
    applicationVersion: "synthetic-production-build",
  });
  if (accepted) {
    await mkdir(join(f.root, "state"), { recursive: true });
    const { createFiscalReadinessStore } = await import("./fiscal-readiness.js");
    await createFiscalReadinessStore(
      join(f.root, "state"),
      async () => ({ status: "accepted" }),
      Buffer.alloc(32, 73),
    ).run(readiness);
  }
  return { ...f, settingsPath, readiness };
}

it("the production venue command checks accepted readiness and seals its exact publication settings", async () => {
  const f = await productionFixture(true);
  expect(await runCli(f.args, f.deps), JSON.stringify(f.output)).toBe(0);
  const state = (await f.runtime.store.read())!;
  expect(state.status).toBe("complete");
  expect(await readDeploymentEnvironment(venue.db)).toBe("production");
  const series = await venue.db.select().from(invoiceSeries);
  expect(series.map((row) => row.code).sort()).toEqual(["A-06RB", "FF-06RB", "R-06RB"]);
  expect(series.map((row) => row.nextNumber)).toEqual([1, 1, 1]);
  const { loadKeyRing, tryGetCredential } = await import("@waitron/credentials");
  const { withTransaction } = await import("@waitron/db");
  const ring = loadKeyRing(f.env);
  expect(
    await withTransaction(venue.db, (tx) => tryGetCredential(tx, ring, { purpose: "fiscal.aeat" })),
  ).toEqual(productionCertificate);
  expect(
    await withTransaction(venue.db, (tx) => tryGetCredential(tx, ring, { purpose: "email.smtp" })),
  ).toEqual({
    url: "smtp://elena:SYNTHETIC-production-smtp@smtp.example.test:587?requireTLS=true",
    from: "elena@example.test",
  });
  const trading = await readFile(join(f.root, "state/trading.env"), "utf8");
  expect(trading).toContain("WAITRON_ENV=production\n");
  for (const secret of [
    productionCertificate.passphrase,
    productionEmail.password,
    productionCertificate.pfxBase64,
  ]) {
    expect(JSON.stringify(state)).not.toContain(secret);
    expect(f.output.join("\n")).not.toContain(secret);
    expect(trading).not.toContain(secret);
  }
});

it("the production venue command refuses missing readiness before stamping or activating", async () => {
  const f = await productionFixture(false);
  expect(await runCli(f.args, f.deps), JSON.stringify(f.output)).toBe(1);
  expect(f.output).toContain('setup.fiscal_test_required {"module":"verifactu"}');
  expect(await readDeploymentEnvironment(venue.db)).toBeNull();
  expect(await readTenantIdentities(venue.db)).toEqual([]);
  expect(await venue.db.select().from(invoiceSeries)).toEqual([]);
  expect((await f.runtime.store.read())!.status).toBe("consumption-intent");
});

it.each(["certificate", "build", "key"] as const)(
  "the production command refuses readiness bound to a different %s",
  async (change) => {
    const f = await productionFixture(true);
    const { writeFile } = await import("node:fs/promises");
    if (change === "certificate")
      await writeFile(
        f.settingsPath,
        JSON.stringify({
          aeatCert: { ...productionCertificate, pfxBase64: "YW5vdGhlcg==" },
          email: productionEmail,
        }),
      );
    if (change === "build") f.env.WAITRON_BUILD_ID = "another-build";
    if (change === "key") f.env.WAITRON_CREDENTIALS_KEY = Buffer.alloc(32, 74).toString("base64");
    expect(await runCli(f.args, f.deps), JSON.stringify(f.output)).toBe(1);
    expect(f.output).toContain('setup.fiscal_test_required {"module":"verifactu"}');
    expect(await readDeploymentEnvironment(venue.db)).toBeNull();
    expect(await readTenantIdentities(venue.db)).toEqual([]);
  },
);

it.each([false, true])(
  "production command Finish keeps its original settings and counters (change settings=%s)",
  async (changed) => {
    const f = await productionFixture(true);
    f.interrupt(true);
    await expect(runCli(f.args, f.deps)).rejects.toThrow("synthetic before trading publication");
    const before = (await f.runtime.store.read())!;
    expect(before.status).toBe("committed");
    const counters = await venue.db.select().from(invoiceSeries);
    const { rm, writeFile } = await import("node:fs/promises");
    await rm(join(f.root, "state/fiscal-readiness.json"));
    if (changed)
      await writeFile(
        f.settingsPath,
        JSON.stringify({
          aeatCert: productionCertificate,
          email: { ...productionEmail, password: "SYNTHETIC-changed" },
        }),
      );
    f.interrupt(false);
    f.prompts.length = 0;
    const result = await runCli(f.args, f.deps);
    expect(result, JSON.stringify(f.output)).toBe(changed ? 1 : 0);
    expect((await f.runtime.store.read())!.status).toBe(changed ? "committed" : "complete");
    if (changed) expect(f.output).toContain("setup.attempt_uncertain {}");
    expect(await venue.db.select().from(invoiceSeries)).toEqual(counters);
    expect((await f.runtime.store.read())!.frozen).toEqual(before.frozen);
    expect(f.prompts).toEqual([]);
  },
);

it("production activation seals the checked settings snapshot if its source file changes before readiness", async () => {
  const f = await productionFixture(true);
  const factory = f.deps.firstSetupDeployment!;
  f.deps.firstSetupDeployment = (context) => {
    const deployment = factory(context);
    return {
      ...deployment,
      assertReady: async (state) => {
        const { writeFile } = await import("node:fs/promises");
        await writeFile(
          f.settingsPath,
          JSON.stringify({
            aeatCert: { ...productionCertificate, pfxBase64: "YW5vdGhlcg==" },
            email: { ...productionEmail, password: "SYNTHETIC-raced" },
          }),
        );
        await deployment.assertReady(state);
      },
    };
  };
  expect(await runCli(f.args, f.deps), JSON.stringify(f.output)).toBe(0);
  const { tryGetCredential, loadKeyRing } = await import("@waitron/credentials");
  const { withTransaction } = await import("@waitron/db");
  expect(
    await withTransaction(venue.db, (tx) =>
      tryGetCredential(tx, loadKeyRing(f.env), { purpose: "fiscal.aeat" }),
    ),
  ).toEqual(productionCertificate);
  const { firstSetupPublicationDigest } = await import("./first-setup-publication-digest.js");
  const state = (await f.runtime.store.read())!;
  expect(state.inputs.$publication).toEqual({
    digest: firstSetupPublicationDigest(state, {
      aeatCert: productionCertificate,
      email: {
        url: "smtp://elena:SYNTHETIC-production-smtp@smtp.example.test:587?requireTLS=true",
        from: "elena@example.test",
      },
    }),
  });
});

it.each(["taxpayer", "schema", "target"] as const)(
  "production readiness from another %s cannot authorise the command",
  async (change) => {
    const f = await productionFixture(true);
    const { createFiscalReadinessStore } = await import("./fiscal-readiness.js");
    const altered = {
      ...f.readiness,
      ...(change === "taxpayer" ? { taxId: "B12345674" } : {}),
      ...(change === "schema"
        ? { moduleVersions: { ...f.readiness.moduleVersions, core: 0 } }
        : {}),
      ...(change === "target" ? { submissionTarget: "https://different.example.test/soap" } : {}),
    };
    await createFiscalReadinessStore(
      join(f.root, "state"),
      async () => ({ status: "accepted" }),
      Buffer.alloc(32, 73),
    ).run(altered);
    expect(await runCli(f.args, f.deps), JSON.stringify(f.output)).toBe(1);
    expect(f.output).toContain('setup.fiscal_test_required {"module":"verifactu"}');
    expect(await readDeploymentEnvironment(venue.db)).toBeNull();
    expect(await venue.db.select().from(invoiceSeries)).toEqual([]);
  },
);

it.each([
  [{ email: productionEmail }, 'setup.provisioning_secret_required {"module":"verifactu"}'],
  [{ aeatCert: productionCertificate }, 'setup.email_required {"field":"email"}'],
  [
    { aeatCert: { ...productionCertificate, pfxBase64: "!" }, email: productionEmail },
    'setup.request_invalid {"field":"pfxBase64"}',
  ],
  [
    { aeatCert: productionCertificate, email: { ...productionEmail, encryption: "none" } },
    'email.settings_invalid {"field":"encryption"}',
  ],
] as const)(
  "invalid production publication settings refuse before any venue write %#",
  async (settings, message) => {
    const f = await productionFixture(true);
    const { writeFile } = await import("node:fs/promises");
    await writeFile(f.settingsPath, JSON.stringify(settings));
    expect(await runCli(f.args, f.deps)).toBe(1);
    expect(f.output).toContain(message);
    expect(await readDeploymentEnvironment(venue.db)).toBeNull();
    expect(await readTenantIdentities(venue.db)).toEqual([]);
    expect(await venue.db.select().from(invoiceSeries)).toEqual([]);
    expect((await f.runtime.store.read())!.status).toBe("consumption-intent");
    expect(f.output.join("\n")).not.toContain(productionCertificate.passphrase);
    expect(f.output.join("\n")).not.toContain(productionEmail.password);
  },
);

it("a refusal after stamping retains that environment and can retry the original kept hour", async () => {
  const f = await realActivationFixture();
  const factory = f.deps.firstSetupDeployment!;
  let refused = true;
  f.deps.firstSetupDeployment = (context) => {
    const deployment = factory(context);
    const provision = deployment.provision;
    return {
      ...deployment,
      provision: (request, beforeTransaction) =>
        provision(request, async () => {
          if (refused) throw new AppError("setup.not_ready", {});
          await beforeTransaction();
        }),
    };
  };
  expect(await runCli(f.args, f.deps)).toBe(1);
  expect(f.output).toContain("setup.not_ready {}");
  expect(await readDeploymentEnvironment(venue.db)).toBe("preproduction");
  expect(await readTenantIdentities(venue.db)).toEqual([]);
  const before = (await f.runtime.store.read())!;
  expect(before.status).toBe("consumption-intent");
  refused = false;
  expect(await runCli(f.args, f.deps), JSON.stringify(f.output)).toBe(0);
  const after = (await f.runtime.store.read())!;
  expect(after.status).toBe("complete");
  expect(after.frozen).toEqual(before.frozen);
  expect(after.inputs[MODULE]).toEqual(before.inputs[MODULE]);
  expect(
    (await venue.db.select({ code: invoiceSeries.code }).from(invoiceSeries))
      .map((row) => row.code)
      .sort(),
  ).toEqual(["A-06RB", "FF-06RB", "R-06RB"]);
});

async function commandReadinessFixture(answer = "yes") {
  const f = await productionFixture(false);
  const contribution = venueFiscalSelection(f.runtime.modules, "ES-common").contribution!;
  const { emptyDrainResult } = await import("@waitron/fiscal");
  const drain = vi.spyOn(contribution, "drain").mockResolvedValue({
    ...emptyDrainResult(),
    recordsAccepted: 1,
  });
  const prompt = f.deps.io.prompt;
  f.deps.io.prompt = async (question) => {
    if (question.startsWith("Send a preproduction fiscal test?")) {
      f.prompts.push(question);
      return answer;
    }
    return prompt(question);
  };
  return { ...f, drain, emptyDrainResult };
}

it("the owned production command runs an explicitly confirmed isolated readiness test before activation", async () => {
  const f = await commandReadinessFixture();
  try {
    expect(await runCli([...f.args, "--test-fiscal"], f.deps), JSON.stringify(f.output)).toBe(0);
    expect(f.prompts).toContain("Send a preproduction fiscal test? [y/N]: ");
    expect((await f.runtime.store.read())!.status).toBe("complete");
    expect(await readDeploymentEnvironment(venue.db)).toBe("production");
    const { sql } = await import("drizzle-orm");
    expect(
      (await venue.db.execute<{ n: number }>(sql`select count(*) as n from sales`)).rows,
    ).toEqual([{ n: 0 }]);
    expect((await venue.db.select().from(invoiceSeries)).map((row) => row.nextNumber)).toEqual([
      1, 1, 1,
    ]);
    const { createFiscalReadinessStore, fiscalReadinessBinding } =
      await import("./fiscal-readiness.js");
    await expect(
      createFiscalReadinessStore(
        join(f.root, "state"),
        async () => ({ status: "uncertain" }),
        Buffer.alloc(32, 73),
      ).assertReady(f.readiness),
    ).resolves.toBeUndefined();
    const { DatabaseSync } = await import("node:sqlite");
    const sample = new DatabaseSync(
      join(
        f.root,
        "state",
        `fiscal-readiness-db-${fiscalReadinessBinding(f.readiness)}`,
        "venue.db",
      ),
      { readOnly: true },
    );
    try {
      expect(sample.prepare("select source, device_id from sales").all()).toEqual([
        { source: "readiness_test", device_id: null },
      ]);
      expect(sample.prepare("select environment from deployment").get()).toEqual({
        environment: "preproduction",
      });
    } finally {
      sample.close();
    }
    expect(f.drain).toHaveBeenCalledOnce();
    expect(f.drain.mock.calls[0]![0].environment).toBe("preproduction");
  } finally {
    f.drain.mockRestore();
  }
});

it("an unreadable retained vault file refuses before command activation", async () => {
  const f = await realActivationFixture();
  const { mkdir } = await import("node:fs/promises");
  await mkdir(join(f.root, "state/secrets.env"), { recursive: true });
  await expect(runCli(f.args, f.deps)).rejects.toMatchObject({ code: "EISDIR" });
  expect(await readTenantIdentities(venue.db)).toEqual([]);
  expect(await readDeploymentEnvironment(venue.db)).toBeNull();
  expect((await f.runtime.store.read())!.status).toBe("consumption-intent");
  await expect(readFile(join(f.root, "state/trading.env"))).rejects.toMatchObject({
    code: "ENOENT",
  });
});

it("a missing private node key cannot finish interrupted command publication", async () => {
  const f = await realActivationFixture();
  f.interrupt(true);
  await expect(runCli(f.args, f.deps)).rejects.toThrow("synthetic before trading publication");
  const before = (await f.runtime.store.read())!;
  const counters = await venue.db.select().from(invoiceSeries);
  const { deleteCredential } = await import("@waitron/credentials");
  const { withTransaction, readMembershipTrustSet } = await import("@waitron/db");
  await withTransaction(venue.db, (tx) => deleteCredential(tx, { purpose: "membership.node_key" }));
  const trust = await readMembershipTrustSet(venue.db);
  expect(trust[before.frozen.nodeId]).toEqual(expect.any(String));
  f.interrupt(false);
  expect(await runCli(f.args, f.deps)).toBe(1);
  expect(f.output).toContain("setup.attempt_uncertain {}");
  expect(await readMembershipTrustSet(venue.db)).toEqual(trust);
  expect(await venue.db.select().from(invoiceSeries)).toEqual(counters);
  expect((await f.runtime.store.read())!.status).toBe("committed");
  await expect(readFile(join(f.root, "state/trading.env"))).rejects.toMatchObject({
    code: "ENOENT",
  });
});

async function unpreparedDeploymentFixture(
  environment: "production" | "preproduction" = "preproduction",
) {
  const f = await realActivationFixture();
  await f.runtime.owner.claimFirstSetup(
    { environment, request },
    randomBytes(32).toString("base64url"),
  );
  const state = (await f.runtime.store.read())!;
  const deployment = f.deps.firstSetupDeployment!({ runtime: f.runtime, db: venue.db });
  const { firstSetupProvisionRequest } = await import("./first-setup-activation.js");
  const provision = firstSetupProvisionRequest(state);
  return { ...f, state, deployment, provision };
}

it.each([false, true])(
  "command deployment requires publication and prepared inputs before stamping (published %s)",
  async (published) => {
    const f = await unpreparedDeploymentFixture();
    if (published) await f.deployment.publication(f.state);
    let began = false;
    await expect(
      f.deployment.provision(f.provision, async () => {
        began = true;
      }),
    ).rejects.toMatchObject({ code: published ? "setup.attempt_uncertain" : "setup.not_ready" });
    expect(began).toBe(false);
    expect(await f.runtime.store.read()).toEqual(f.state);
    expect(await readTenantIdentities(venue.db)).toEqual([]);
    expect(await readDeploymentEnvironment(venue.db)).toBeNull();
  },
);

it("command deployment refuses a changed frozen venue before stamping", async () => {
  const f = await unpreparedDeploymentFixture();
  await f.deployment.publication(f.state);
  let began = false;
  await expect(
    f.deployment.provision(
      {
        ...f.provision,
        venue: { ...f.provision.venue, legalName: "Different business" },
      },
      async () => {
        began = true;
      },
    ),
  ).rejects.toMatchObject({ code: "setup.attempt_uncertain" });
  expect(began).toBe(false);
  expect(await f.runtime.store.read()).toEqual(f.state);
  expect(await readTenantIdentities(venue.db)).toEqual([]);
  expect(await readDeploymentEnvironment(venue.db)).toBeNull();
});

it("production readiness cannot run before publication has loaded its settings", async () => {
  const f = await unpreparedDeploymentFixture("production");
  await expect(f.deployment.assertReady(f.state)).rejects.toMatchObject({
    code: "setup.not_ready",
  });
  expect(await f.runtime.store.read()).toEqual(f.state);
  expect(await readTenantIdentities(venue.db)).toEqual([]);
  expect(await readDeploymentEnvironment(venue.db)).toBeNull();
});

it("command deployment refuses to provision over its already completed venue", async () => {
  const f = await realActivationFixture();
  expect(await runCli(f.args, f.deps), JSON.stringify(f.output)).toBe(0);
  const state = (await f.runtime.store.read())!;
  const before = await venue.db.select().from(invoiceSeries);
  const tenants = await readTenantIdentities(venue.db);
  const deployment = f.deps.firstSetupDeployment!({ runtime: f.runtime, db: venue.db });
  await deployment.publication(state);
  const { firstSetupProvisionRequest } = await import("./first-setup-activation.js");
  await expect(
    deployment.provision(firstSetupProvisionRequest(state), async () => {
      throw new Error("must not enter activation");
    }),
  ).rejects.toMatchObject({ code: "setup.attempt_uncertain" });
  expect(await readTenantIdentities(venue.db)).toEqual(tenants);
  expect(await venue.db.select().from(invoiceSeries)).toEqual(before);
  expect(await f.runtime.store.read()).toEqual(state);
});

it("--yes does not send a fiscal test when its separate confirmation is declined", async () => {
  const f = await commandReadinessFixture("no");
  try {
    expect(await runCli([...f.args, "--test-fiscal"], f.deps)).toBe(1);
    expect(f.prompts).toContain("Send a preproduction fiscal test? [y/N]: ");
    expect(f.drain).not.toHaveBeenCalled();
    expect(await readDeploymentEnvironment(venue.db)).toBeNull();
    expect(await readTenantIdentities(venue.db)).toEqual([]);
    await expect(readFile(join(f.root, "state/fiscal-readiness.json"))).rejects.toMatchObject({
      code: "ENOENT",
    });
  } finally {
    f.drain.mockRestore();
  }
});

it.each(["rejected", "uncertain"] as const)(
  "a %s command readiness result leaves production unactivated without accepted evidence",
  async (status) => {
    const f = await commandReadinessFixture();
    f.drain.mockResolvedValue({
      ...f.emptyDrainResult(),
      ...(status === "rejected" ? { recordsHalted: 1 } : {}),
    });
    try {
      expect(await runCli([...f.args, "--test-fiscal"], f.deps), JSON.stringify(f.output)).toBe(1);
      expect(f.output).toContain(`Fiscal test: ${status}`);
      expect(f.drain).toHaveBeenCalledOnce();
      expect(await readDeploymentEnvironment(venue.db)).toBeNull();
      expect(await readTenantIdentities(venue.db)).toEqual([]);
      await expect(readFile(join(f.root, "state/fiscal-readiness.json"))).rejects.toMatchObject({
        code: "ENOENT",
      });
    } finally {
      f.drain.mockRestore();
    }
  },
);

it("an ordinary production command never submits readiness without --test-fiscal", async () => {
  const f = await commandReadinessFixture();
  try {
    expect(await runCli(f.args, f.deps)).toBe(1);
    expect(f.output).toContain('setup.fiscal_test_required {"module":"verifactu"}');
    expect(f.drain).not.toHaveBeenCalled();
    expect(
      f.prompts.some((question) => question.startsWith("Send a preproduction fiscal test?")),
    ).toBe(false);
  } finally {
    f.drain.mockRestore();
  }
});

it("the readiness option refuses an unowned command before opening the venue", async () => {
  const f = await fixture();
  const deps: CliDeps = { ...f.deps };
  delete deps.configureFirstSetup;
  expect(await runCli([...f.args, "--test-fiscal"], deps)).toBe(1);
  expect(f.output).toContain("setup.not_ready {}");
  expect(f.deps.openVenue).not.toHaveBeenCalled();
});

it("an uncertain command readiness retry reuses its one isolated sample and then activates", async () => {
  const f = await commandReadinessFixture();
  f.drain.mockResolvedValueOnce(f.emptyDrainResult());
  try {
    expect(await runCli([...f.args, "--test-fiscal"], f.deps)).toBe(1);
    const before = (await f.runtime.store.read())!;
    const pdf = await readFile(join(f.root, "recovery.pdf"));
    expect(await runCli([...f.args, "--test-fiscal"], f.deps), JSON.stringify(f.output)).toBe(0);
    const after = (await f.runtime.store.read())!;
    expect(after.inputs[MODULE]).toEqual(before.inputs[MODULE]);
    expect(Object.keys(after.inputs).sort()).toEqual(["$publication", MODULE]);
    expect(await readFile(join(f.root, "recovery.pdf"))).toEqual(pdf);
    expect(f.drain).toHaveBeenCalledTimes(2);
    const { fiscalReadinessBinding } = await import("./fiscal-readiness.js");
    const { DatabaseSync } = await import("node:sqlite");
    const sample = new DatabaseSync(
      join(
        f.root,
        "state",
        `fiscal-readiness-db-${fiscalReadinessBinding(f.readiness)}`,
        "venue.db",
      ),
      { readOnly: true },
    );
    try {
      expect(sample.prepare("select count(*) as n from sales").get()).toEqual({ n: 1 });
    } finally {
      sample.close();
    }
    expect((await venue.db.select().from(invoiceSeries)).map((row) => row.nextNumber)).toEqual([
      1, 1, 1,
    ]);
  } finally {
    f.drain.mockRestore();
  }
});

it("exact command Finish ignores --test-fiscal and preserves the accepted sample and series", async () => {
  const f = await commandReadinessFixture();
  f.interrupt(true);
  try {
    await expect(runCli([...f.args, "--test-fiscal"], f.deps)).rejects.toThrow(
      "synthetic before trading publication",
    );
    const before = await venue.db.select().from(invoiceSeries);
    expect((await f.runtime.store.read())!.status).toBe("committed");
    f.interrupt(false);
    f.prompts.length = 0;
    expect(await runCli([...f.args, "--test-fiscal"], f.deps), JSON.stringify(f.output)).toBe(0);
    expect(f.prompts).toEqual([]);
    expect(f.drain).toHaveBeenCalledOnce();
    expect(await venue.db.select().from(invoiceSeries)).toEqual(before);
  } finally {
    f.drain.mockRestore();
  }
});

it("the production command records a readable certificate against the committed setup node", async () => {
  const { makeAuthority } = await import("@waitron/fiscal-verifactu/test/certificate-fixtures.js");
  const { fiscalCertificateInstalls } =
    await import("@waitron/fiscal-verifactu/src/schema/index.js");
  const candidate = makeAuthority().issue();
  const certificate = {
    pfxBase64: candidate.pfx.toString("base64"),
    passphrase: candidate.passphrase,
    certKind: "sello",
  };
  const f = await productionFixture(true, certificate);
  expect(await runCli(f.args, f.deps), JSON.stringify(f.output)).toBe(0);
  const state = (await f.runtime.store.read())!;
  const rows = await venue.db.select().from(fiscalCertificateInstalls);
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({
    nodeId: state.frozen.nodeId,
    fingerprint: candidate.fingerprint,
    source: "setup",
    personId: null,
    kind: "sello",
  });
});
