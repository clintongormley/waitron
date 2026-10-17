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

it("the command refuses a retained configuration import while its import adapter is unavailable", async () => {
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
