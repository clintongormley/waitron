import { makeAuthority as makeCertificateAuthority } from "@waitron/fiscal-verifactu/test/certificate-fixtures.js";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
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
  readNodeMembership,
  stampDeployment,
  invoiceSeries,
  type VenueDatabase,
} from "@waitron/db";
import { runCli, type CliDeps } from "./cli.js";
import { applyVenue, type VenueResult } from "./venue-apply.js";
import { planVenue } from "./venue-plan.js";
import { venueFiscalSelection } from "./venue-fiscal.js";
import { enabledModules, modulesWithSets } from "@waitron/module";
import { initialVenueApplyInput } from "./initial-venue-input.js";
import { readTenantIdentities } from "./tenant-guard.js";
import { createFirstSetupRuntime } from "./first-setup-runtime.js";
import { MODULE, PASSWORD, request } from "../test/first-setup-request.js";
import { moveFakeClock, STOPPED_DURING_WAIT, stopDuringWait } from "../test/settle-wait.js";

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
    instantMs: Date.now(),
    uncertaintyMs: 500,
    wallStartedMs: Date.now(),
    wallFinishedMs: Date.now(),
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
    "--venue-name",
    request.name,
    "--territory",
    request.fiscalTerritory,
    "--locale",
    "es-ES",
    "--operation-description",
    request.operationDescription,
    "--address-line1",
    request.addressLine1,
    "--address-line2",
    "Local 2",
    "--postal-code",
    request.postalCode,
    "--city",
    request.city,
    "--province",
    request.province,
    "--time-zone",
    request.timeZone,
    "--day-cutover",
    request.dayCutover,
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
      async () => ({ venue: venue.db, node: venue.node, close: async () => {} }) as VenueDatabase,
    ),
    applyVenue,
    modules: ALL_MODULES,
    configureFirstSetup: () => runtime,
    readEnvironment: readDeploymentEnvironment,
    readDeploymentTable: deploymentTableExists,
    stampEnvironment: stampDeployment,
    readTenants: readTenantIdentities,
    sleep: stopDuringWait,
  };
  return { root, args, deps, runtime, output, prompts };
}

/** Runs the command until the stand-in stop ends it during its wait. */
async function stopsAtWait(args: string[], deps: Parameters<typeof runCli>[1]) {
  await expect(runCli(args, deps)).rejects.toBe(STOPPED_DURING_WAIT);
}

/** Runs the command once, letting it wait out its settle wait on the faked clock. */
async function runCliPastWait(args: string[], deps: Parameters<typeof runCli>[1]) {
  const sleep = deps.sleep;
  deps.sleep = moveFakeClock;
  try {
    return await runCli(args, deps);
  } finally {
    deps.sleep = sleep;
  }
}

it("the venue command claims ownership, waits out its settle wait saying why and until when, before any venue write, and carries on in the same run", async () => {
  const f = await fixture();
  let atWait: Awaited<ReturnType<typeof f.runtime.store.read>> | undefined;
  let journalAtWait: { prepared: { value: { entries: unknown[] } }[] } | undefined;
  let outputAtWait: string[] = [];
  let writesAtWait: unknown[] | undefined;
  let promptsAtWait: string[] = [];
  f.deps.sleep = async (ms) => {
    promptsAtWait = [...f.prompts];
    atWait = await f.runtime.store.read();
    journalAtWait = JSON.parse(
      await readFile(join(f.root, "state/module-records/fiscal-verifactu.json"), "utf8"),
    );
    outputAtWait = [...f.output];
    writesAtWait = [
      await readTenantIdentities(venue.db),
      await readDeploymentEnvironment(venue.db),
    ];
    await moveFakeClock(ms);
  };
  expect(await runCli(f.args, f.deps)).toBe(1);
  expect(atWait).toMatchObject({ status: "claimed", consumptionIntent: false, ownerGeneration: 1 });
  expect(atWait!.inputs).toEqual({});
  expect(journalAtWait!.prepared.at(-1)!.value.entries).toMatchObject([
    { kind: "wait", targetMs: Date.parse("2026-10-16T11:42:00Z") },
  ]);
  expect(journalAtWait!.prepared.at(-1)!.value.entries[0]).not.toHaveProperty("answer");
  expect(outputAtWait).toContain(
    "Waiting to confirm the time, so no invoice series is ever repeated.",
  );
  expect(outputAtWait).toContain(
    "Waiting until 2026-10-16T11:42:00.000Z; it carries on by itself, so keep the command running.",
  );
  expect(writesAtWait).toEqual([[], null]);
  const state = await f.runtime.store.read();
  expect(state).toMatchObject({ status: "consumption-intent", ownerGeneration: 1 });
  expect(state!.inputs[MODULE]).toMatchObject({ allocation: { installationIdentity: "0CNNY" } });
  expect(promptsAtWait).toEqual(["Confirm setup password: "]);
  expect(f.prompts).toEqual(promptsAtWait);
  expect(f.output.join("\n")).not.toContain("run the command again");
  expect(f.output.join("\n")).not.toContain(PASSWORD);
  expect(await readTenantIdentities(venue.db)).toEqual([]);
  expect(await readDeploymentEnvironment(venue.db)).toBeNull();
});

it("a command whose time is still not confirmed after its wait is refused rather than waiting again", async () => {
  const f = await fixture();
  const sleep = vi.fn(async () => {});
  f.deps.sleep = sleep;
  expect(await runCli(f.args, f.deps)).toBe(1);
  expect(sleep).toHaveBeenCalledTimes(1);
  expect(f.output).toContain('sif.allocation_invalid {"reason":"clock_unconfirmed"}');
  expect((await f.runtime.store.read())!.inputs).toEqual({});
  expect(await readTenantIdentities(venue.db)).toEqual([]);
});

it("a wait that runs over until the kept password confirmation expires says so", async () => {
  const f = await fixture();
  f.deps.sleep = async (ms) => moveFakeClock(ms + 200_000);
  expect(await runCli(f.args, f.deps)).toBe(1);
  expect(f.prompts).toEqual(["Confirm setup password: "]);
  expect(f.output.slice(-2)).toEqual([
    "The command waited so long that the password confirmation expired, so the setup stopped before anything was chosen.",
    "setup.owner_required {}",
  ]);
  expect(await f.runtime.store.read()).toMatchObject({ status: "claimed", inputs: {} });
  expect(await readTenantIdentities(venue.db)).toEqual([]);
});

it("a setup stopped just before the overrun selection keeps its own refusal, not the expired-confirmation words", async () => {
  const f = await fixture();
  let waited = false;
  const prepare = f.runtime.preparation.prepare;
  f.runtime.preparation.prepare = async (...args) => {
    const prepared = await prepare(...args);
    if (waited && (args[2] as { action: string }).action === "selection") {
      const held = (await f.runtime.store.read())!;
      await f.runtime.store.update(held.frozen.attemptId, held.revision, { kind: "abandoned" });
    }
    return prepared;
  };
  f.deps.sleep = async (ms) => {
    await moveFakeClock(ms + 200_000);
    waited = true;
  };
  expect(await runCli(f.args, f.deps)).toBe(1);
  expect(f.output.at(-1)).toBe("setup.owner_required {}");
  expect(f.output.join("\n")).not.toContain("password confirmation expired");
  expect((await f.runtime.store.read())!.status).toBe("abandoned");
});

it("the venue command imports selected module input but cannot skip unfinished publication", async () => {
  const f = await fixture("no");
  expect(await runCliPastWait(f.args, f.deps)).toBe(1);
  const state = await f.runtime.store.read();
  expect(state).toMatchObject({ status: "consumption-intent", consumptionIntent: true });
  expect(state!.inputs[MODULE]).toMatchObject({ allocation: { installationIdentity: "0CNNY" } });
  expect(f.output, JSON.stringify(f.output)).toContain("setup.not_ready {}");
  expect(await readTenantIdentities(venue.db)).toEqual([]);
  expect(await readDeploymentEnvironment(venue.db)).toBeNull();
});

async function folderSnapshot(dir: string): Promise<Record<string, string> | null> {
  const { readdir } = await import("node:fs/promises");
  let entries;
  try {
    entries = await readdir(dir, { recursive: true, withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
  const files: Record<string, string> = {};
  for (const entry of entries) {
    const path = join(entry.parentPath, entry.name);
    files[path] = entry.isFile()
      ? (await readFile(path)).toString("base64")
      : entry.isDirectory()
        ? "dir"
        : "other";
  }
  return files;
}

const START_AGAIN =
  "Open the box's setup page in a browser and choose Start again. It deletes what this setup entered; if the setup already recorded something that must be kept, such as an invoice, or the box cannot confirm that deleting it is safe, it deletes nothing and the page says why. Then run the command again.";
const STOPPED = [
  "This setup stopped part way, so the command will not carry on with it. Nothing was changed.",
  START_AGAIN,
  "setup.attempt_conflict {}",
];

/** Leaves the retained attempt at `status` the way an earlier run, or the setup page, does. */
async function retainAt(f: Awaited<ReturnType<typeof activationFixture>>, status: string) {
  const { cp } = await import("node:fs/promises");
  const factory = f.deps.firstSetupDeployment!;
  const failProvision = (afterBeforeTransaction: () => Promise<void>) => {
    f.deps.firstSetupDeployment = (context) => {
      const deployment = factory(context);
      return {
        ...deployment,
        provision: (request, beforeTransaction) =>
          deployment.provision(request, async () => {
            await beforeTransaction();
            await afterBeforeTransaction();
            throw new Error("synthetic stop during activation");
          }),
      };
    };
  };
  const advance = async (kind: "publication" | "abandoned") => {
    const state = (await f.runtime.store.read())!;
    await f.runtime.store.update(state.frozen.attemptId, state.revision, { kind });
  };
  if (status === "claimed" || status === "abandoned") {
    await stopsAtWait(f.args, f.deps);
    if (status === "abandoned") await advance("abandoned");
  } else if (status === "activation-started") {
    const kept = join(f.root, "state-at-activation");
    failProvision(async () => {
      // The process is killed here: the copy is what the next run finds.
      await cp(join(f.root, "state"), kept, { recursive: true });
    });
    await expect(runCliPastWait(f.args, f.deps)).rejects.toThrow(
      "synthetic stop during activation",
    );
    await rm(join(f.root, "state"), { recursive: true });
    await cp(kept, join(f.root, "state"), { recursive: true });
    await rm(kept, { recursive: true });
  } else if (status === "uncertain") {
    failProvision(async () => {});
    await expect(runCliPastWait(f.args, f.deps)).rejects.toThrow(
      "synthetic stop during activation",
    );
  } else if (status === "committed" || status === "publication") {
    f.interrupt(true);
    await expect(runCliPastWait(f.args, f.deps)).rejects.toThrow(
      "synthetic publication interrupted",
    );
    f.interrupt(false);
    if (status === "publication") await advance("publication");
  } else expect(await runCliPastWait(f.args, f.deps)).toBe(0);
  f.deps.firstSetupDeployment = factory;
  expect((await f.runtime.store.read())!.status).toBe(status);
}

it.each([
  ["claimed", STOPPED],
  ["activation-started", STOPPED],
  ["committed", STOPPED],
  ["publication", STOPPED],
  [
    "uncertain",
    [
      "This setup stopped during activation, and the box could not tell whether activation finished, so the command will not carry on with it. Nothing was changed.",
      START_AGAIN,
      "setup.attempt_uncertain {}",
    ],
  ],
  [
    "abandoned",
    [
      "This setup was stopped on the box's setup page, so the command will not carry on with it. Nothing was changed.",
      START_AGAIN,
      "setup.attempt_conflict {}",
    ],
  ],
  [
    "complete",
    [
      "This box's setup already finished, so the command sets nothing up. Nothing was changed.",
      "setup.already_provisioned {}",
    ],
  ],
] as const)(
  "a retained setup (%s) is refused before any question, and nothing on disk changes",
  async (status, words) => {
    const f = await activationFixture();
    await retainAt(f, status);
    const before = {
      state: await folderSnapshot(join(f.root, "state")),
      venue: await folderSnapshot(join(f.root, "venue")),
      tenants: await readTenantIdentities(venue.db),
      environment: await readDeploymentEnvironment(venue.db),
      series: await venue.db.select().from(invoiceSeries),
    };
    const restarted = createFirstSetupRuntime({
      stateDir: join(f.root, "state"),
      venueDir: join(f.root, "venue"),
      environment: {},
      modules: ALL_MODULES,
      database: () => venue.db,
    });
    f.deps.configureFirstSetup = () => restarted;
    f.prompts.length = 0;
    f.output.length = 0;
    f.calls.length = 0;
    vi.mocked(f.deps.openVenue).mockClear();
    expect(
      await runCliPastWait(
        f.args.filter((arg) => arg !== "--yes"),
        f.deps,
      ),
    ).toBe(1);
    expect(f.output).toEqual(words);
    expect(f.prompts).toEqual([]);
    expect(f.calls).toEqual([]);
    expect(f.deps.openVenue).not.toHaveBeenCalled();
    expect({
      state: await folderSnapshot(join(f.root, "state")),
      venue: await folderSnapshot(join(f.root, "venue")),
      tenants: await readTenantIdentities(venue.db),
      environment: await readDeploymentEnvironment(venue.db),
      series: await venue.db.select().from(invoiceSeries),
    }).toEqual(before);
  },
);

it.each([
  ["claimed", "venue details", STOPPED],
  ["claimed", "secrets", STOPPED],
  [
    "abandoned",
    "venue details",
    [
      "This setup was stopped on the box's setup page, so the command will not carry on with it. Nothing was changed.",
      START_AGAIN,
      "setup.attempt_conflict {}",
    ],
  ],
  [
    "uncertain",
    "secrets",
    [
      "This setup stopped during activation, and the box could not tell whether activation finished, so the command will not carry on with it. Nothing was changed.",
      START_AGAIN,
      "setup.attempt_uncertain {}",
    ],
  ],
] as const)(
  "a retained setup (%s) is refused before asking for omitted %s",
  async (status, omitted, words) => {
    const f = await activationFixture();
    await retainAt(f, status);
    const before = {
      state: await folderSnapshot(join(f.root, "state")),
      venue: await folderSnapshot(join(f.root, "venue")),
    };
    f.deps.configureFirstSetup = () =>
      createFirstSetupRuntime({
        stateDir: join(f.root, "state"),
        venueDir: join(f.root, "venue"),
        environment: {},
        modules: ALL_MODULES,
        database: () => venue.db,
      });
    const args =
      omitted === "venue details" ? ["venue", "--venue-dir", join(f.root, "venue")] : f.args;
    if (omitted === "secrets") f.deps.env = {};
    f.deps.io.prompt = async (question) => {
      f.prompts.push(question);
      return "";
    };
    f.prompts.length = 0;
    f.output.length = 0;
    f.calls.length = 0;
    vi.mocked(f.deps.openVenue).mockClear();
    expect(await runCliPastWait(args, f.deps)).toBe(1);
    expect(f.prompts).toEqual([]);
    expect(f.output).toEqual(words);
    expect(f.calls).toEqual([]);
    expect(f.deps.openVenue).not.toHaveBeenCalled();
    expect({
      state: await folderSnapshot(join(f.root, "state")),
      venue: await folderSnapshot(join(f.root, "venue")),
    }).toEqual(before);
  },
);

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

it("the actual venue command saves its selected recovery PDF and asks for kept despite --yes", async () => {
  const f = await fixture("no");
  const path = join(f.root, "selected-recovery.pdf");
  f.deps.io.prompt = async (question) => {
    f.prompts.push(question);
    return question.startsWith("Have you kept") ? "yes" : "no";
  };
  expect(await runCliPastWait([...f.args, "--recovery-pdf", path], f.deps)).toBe(1);
  await expect(readFile(path)).resolves.toBeInstanceOf(Buffer);
  const pdf = await readFile(path);
  expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
  expect(f.prompts).toContain("Have you kept this recovery pack? [y/N]: ");
  const state = (await f.runtime.store.read())!;
  expect(state.status).toBe("consumption-intent");
  expect(f.output).toContain("setup.not_ready {}");
  expect(await readTenantIdentities(venue.db)).toEqual([]);
  expect(await readDeploymentEnvironment(venue.db)).toBeNull();
});

it("a recovery-pack path that already holds a file is refused, with what to do, before any wait or setup record", async () => {
  const f = await fixture();
  const path = join(f.root, "earlier-recovery.pdf");
  await writeFile(path, "an earlier setup's pack");
  const sleep = vi.fn(stopDuringWait);
  f.deps.sleep = sleep;
  expect(await runCli([...f.args, "--recovery-pdf", path], f.deps)).toBe(1);
  expect(sleep).not.toHaveBeenCalled();
  expect(f.deps.openVenue).not.toHaveBeenCalled();
  expect(await f.runtime.store.read()).toBeNull();
  expect(f.prompts).toEqual([]);
  expect(await readFile(path, "utf8")).toBe("an earlier setup's pack");
  expect(f.output).toEqual([
    `A file already exists at ${path}, and the setup never writes over one: it may be an earlier setup's recovery pack, the only copy of that setup's keys. Name a file that does not exist yet, or move the existing file to another folder first.`,
    "Nothing was changed, so you can run the command again straight away.",
    "setup.not_ready {}",
  ]);
});

it("declining kept in the actual venue command preserves the saved PDF and leaves setup unactivated", async () => {
  const f = await fixture("no");
  const path = join(f.root, "declined-recovery.pdf");
  expect(await runCliPastWait([...f.args, "--recovery-pdf", path], f.deps)).toBe(1);
  await expect(readFile(path)).resolves.toBeInstanceOf(Buffer);
  expect(f.prompts).toContain("Have you kept this recovery pack? [y/N]: ");
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
  function stateModules(request: { venue: { fiscalTerritory: string } }) {
    return enabledModules(
      f.runtime.modules,
      venueFiscalSelection(f.runtime.modules, request.venue.fiscalTerritory).config,
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
  expect(await runCliPastWait(f.args, f.deps), JSON.stringify(f.output)).toBe(0);
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
  expect(series.map((row) => row.code).sort()).toEqual(["A-0CNNY", "FF-0CNNY", "R-0CNNY"]);
  expect(series.map((row) => row.nextNumber)).toEqual([1, 1, 1]);
  expect(f.output).toContain(`node:     ${state.frozen.nodeId}`);
  expect(await readDeploymentEnvironment(venue.db)).toBe("preproduction");
});

it("the real preproduction deployment adapter completes publication through the venue command", async () => {
  const f = await activationFixture();
  const { createFirstSetupCommandDeployment } = await import("./first-setup-command-deployment.js");
  f.deps.firstSetupDeployment = ({ runtime, db, node }) =>
    createFirstSetupCommandDeployment({
      runtime,
      db,
      node,
      environment: {
        WAITRON_MANAGEMENT_ORIGIN: "https://olivo.example.test:3443",
        WAITRON_CREDENTIALS_KEY: Buffer.alloc(32, 73).toString("base64"),
      },
    });
  expect(await runCliPastWait(f.args, f.deps), JSON.stringify(f.output)).toBe(0);
  expect((await f.runtime.store.read())!.status).toBe("complete");
  expect((await readNodeMembership(venue.db))?.body.nodes[0]?.contactUrl).toBe(
    "https://olivo.example.test:3443",
  );
});

it("a person who answers each recovery-pack question a minute late still completes the setup", async () => {
  const f = await activationFixture();
  const { createFirstSetupCommandDeployment } = await import("./first-setup-command-deployment.js");
  f.deps.firstSetupDeployment = ({ runtime, db, node }) =>
    createFirstSetupCommandDeployment({
      runtime,
      db,
      node,
      environment: {
        WAITRON_MANAGEMENT_ORIGIN: "https://olivo.example.test:3443",
        WAITRON_CREDENTIALS_KEY: Buffer.alloc(32, 73).toString("base64"),
      },
    });
  let waited = false;
  const late =
    <T extends unknown[], R>(answer: (...args: T) => Promise<R>) =>
    async (...args: T) => {
      if (waited) vi.advanceTimersByTime(60_000);
      return answer(...args);
    };
  f.deps.io.prompt = late(f.deps.io.prompt);
  f.deps.io.promptSecret = late(f.deps.io.promptSecret);
  f.deps.sleep = async (ms) => {
    await moveFakeClock(ms);
    waited = true;
  };
  expect(await runCli(f.args, f.deps), JSON.stringify(f.output)).toBe(0);
  expect(f.prompts.slice(1)).toEqual([
    "Confirm setup password: ",
    "Have you kept this recovery pack? [y/N]: ",
    "Confirm setup password: ",
  ]);
  expect((await f.runtime.store.read())!.status).toBe("complete");
});

it("a first setup password typed 31 seconds late still completes the setup without asking for it again", async () => {
  const f = await activationFixture();
  let beforeWait = 0;
  const promptSecret = f.deps.io.promptSecret;
  f.deps.io.promptSecret = async (question) => {
    if (!f.output.some((line) => line.startsWith("Waiting until ")) && beforeWait++ === 0)
      vi.advanceTimersByTime(31_000);
    return promptSecret(question);
  };
  expect(await runCliPastWait(f.args, f.deps), JSON.stringify(f.output)).toBe(0);
  expect(beforeWait).toBe(1);
  expect(f.output.join("\n")).not.toContain("out of date");
  expect((await f.runtime.store.read())!.status).toBe("complete");
});

it("a command whose internet time is gone by activation stops before activating", async () => {
  const f = await activationFixture();
  const prompt = f.deps.io.prompt;
  f.deps.io.prompt = async (question) => {
    if (question.startsWith("Have you kept"))
      external.internet.mockResolvedValue({
        source: "internet",
        result: "unavailable",
        reason: "tls",
      });
    return prompt(question);
  };
  expect(await runCliPastWait(f.args, f.deps)).toBe(1);
  expect(f.output.slice(-3)).toEqual([
    "internet: unavailable",
    "No series is made without a confirmed time, so none is ever repeated.",
    "Connect the box to the internet, or set up from a phone or laptop on the venue's network.",
  ]);
  expect(f.calls).toEqual([]);
  expect((await f.runtime.store.read())!.status).toBe("consumption-intent");
  expect(await readDeploymentEnvironment(venue.db)).toBeNull();
});

it("a configured deployment cannot activate without a kept recovery document", async () => {
  const f = await activationFixture();
  const args = f.args.filter(
    (arg, index, all) => arg !== "--recovery-pdf" && all[index - 1] !== "--recovery-pdf",
  );
  expect(await runCliPastWait(args, f.deps)).toBe(1);
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
  expect(await runCliPastWait(f.args, f.deps)).toBe(1);
  expect(f.calls).toEqual([]);
  expect(f.output).toContain("setup.not_ready {}");
  expect((await f.runtime.store.read())!.status).toBe("consumption-intent");
  expect(await readTenantIdentities(venue.db)).toEqual([]);
  expect(await readDeploymentEnvironment(venue.db)).toBeNull();
});

it("stale command ownership refuses before loading publication settings", async () => {
  const f = await activationFixture();
  const authorize = vi.spyOn(f.runtime.owner, "authorize");
  f.interrupt(true);
  await expect(runCliPastWait(f.args, f.deps)).rejects.toThrow("synthetic publication interrupted");
  const state = (await f.runtime.store.read())!;
  const owner = { ...authorize.mock.calls.at(-1)![0], revision: state.revision - 1 };
  const deployment = f.deps.firstSetupDeployment!({
    runtime: f.runtime,
    db: venue.db,
    node: venue.node,
  });
  const publication = vi.spyOn(deployment, "publication");
  const { completeFirstSetupCommand } = await import("./first-setup-command-activation.js");
  await expect(
    completeFirstSetupCommand(f.runtime, { venue: venue.db, node: venue.node }, owner, deployment),
  ).rejects.toMatchObject({ code: "setup.owner_required" });
  expect(publication).not.toHaveBeenCalled();
  expect((await f.runtime.store.read())!.status).toBe("committed");
});

it("the real command deployment refuses production before committing any venue", async () => {
  const f = await activationFixture();
  f.deps.env.WAITRON_ENV = "production";
  const { createFirstSetupCommandDeployment } = await import("./first-setup-command-deployment.js");
  f.deps.firstSetupDeployment = ({ runtime, db, node }) =>
    createFirstSetupCommandDeployment({ runtime, db, node, environment: {} });
  expect(await runCliPastWait(f.args, f.deps)).toBe(1);
  expect(f.output).toContain("setup.not_ready {}");
  expect((await f.runtime.store.read())!.status).toBe("consumption-intent");
  expect(await readTenantIdentities(venue.db)).toEqual([]);
  expect(await readDeploymentEnvironment(venue.db)).toBeNull();
});

async function realActivationFixture(environment: Record<string, string | undefined> = {}) {
  const f = await activationFixture();
  const { createFirstSetupCommandDeployment } = await import("./first-setup-command-deployment.js");
  let interrupted = false;
  const env: Record<string, string | undefined> = {
    WAITRON_MANAGEMENT_ORIGIN: "https://olivo.example.test:3443",
    WAITRON_CREDENTIALS_KEY: Buffer.alloc(32, 73).toString("base64"),
    ...environment,
  };
  f.deps.firstSetupDeployment = ({ runtime, db, node }) => {
    const deployment = createFirstSetupCommandDeployment({ runtime, db, node, environment: env });
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

it("the real command publishes the box's own address for the shared venue name", async () => {
  const f = await realActivationFixture({ WAITRON_MANAGEMENT_ORIGIN: "https://waitron.local" });
  expect(await runCliPastWait(f.args, f.deps), JSON.stringify(f.output)).toBe(0);
  const state = (await f.runtime.store.read())!;
  const chart = await readNodeMembership(venue.db);
  expect(chart?.body.nodes).toEqual([
    {
      nodeId: state.frozen.nodeId,
      contactUrl: `https://box-${state.frozen.nodeId.slice(0, 4).toLowerCase()}.waitron.local`,
      standing: "serving-primary",
    },
  ]);
});

it.each([
  "",
  "javascript:alert(1)",
  "https://olivo.example.test/path",
  "https://user:pass@olivo.example.test",
  "https://olivo.example.test/?q=1",
  "https://olivo.example.test/#fragment",
])("an unusable membership origin (%s) refuses before venue creation", async (origin) => {
  const f = await realActivationFixture({ WAITRON_MANAGEMENT_ORIGIN: origin });
  expect(await runCliPastWait(f.args, f.deps)).toBe(1);
  expect(f.output).toContain("setup.not_ready {}");
  expect(await readTenantIdentities(venue.db)).toEqual([]);
  expect(await readDeploymentEnvironment(venue.db)).toBeNull();
});

it("an absent vault key refuses before venue creation", async () => {
  const f = await realActivationFixture({ WAITRON_CREDENTIALS_KEY: "" });
  expect(await runCliPastWait(f.args, f.deps)).toBe(1);
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
  expect(await runCliPastWait(f.args, f.deps), JSON.stringify(f.output)).toBe(0);
  expect((await f.runtime.store.read())!.status).toBe("complete");
});

it("a refusal before activation starts leaves no environment stamp and no venue", async () => {
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
  expect(await runCliPastWait(f.args, f.deps)).toBe(1);
  expect(f.output).toContain("setup.not_ready {}");
  expect(await readDeploymentEnvironment(venue.db)).toBeNull();
  expect(await readTenantIdentities(venue.db)).toEqual([]);
  expect(await venue.db.select().from(invoiceSeries)).toEqual([]);
  expect((await f.runtime.store.read())!.status).toBe("consumption-intent");
});

it("a venue database already holding another node's membership is refused at publication, and no trading file is written", async () => {
  const f = await realActivationFixture();
  const { writeNodeMembership } = await import("@waitron/db");
  const { generateNodeKeyPair, buildNextMembershipDocument } = await import("@waitron/membership");
  const other = generateNodeKeyPair();
  await writeNodeMembership(
    venue.db,
    buildNextMembershipDocument({
      heldDocument: null,
      signerNodeId: "other-node",
      signerPrivateKey: other.privateKey,
      nodes: [
        {
          nodeId: "other-node",
          contactUrl: "https://other.example.test:3443",
          standing: "serving-primary",
        },
      ],
    }),
  );
  expect(await runCliPastWait(f.args, f.deps)).toBe(1);
  expect(f.output.at(-1)).toBe("setup.attempt_uncertain {}");
  expect((await f.runtime.store.read())!.status).toBe("committed");
  await expect(readFile(join(f.root, "state/trading.env"))).rejects.toMatchObject({
    code: "ENOENT",
  });
});

const certificateAuthority = makeCertificateAuthority();
const productionMaterial = certificateAuthority.issue({ passphrase: "SYNTHETIC-production-cert" });
const replacementMaterial = certificateAuthority.issue({ passphrase: "SYNTHETIC-production-cert" });
const productionCertificate = {
  pfxBase64: productionMaterial.pfx.toString("base64"),
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
  for (const module of modulesWithSets(modules))
    versions[module.name] = await appliedSchemaVersion(
      { venue: venue.db, node: venue.node },
      module.migrations,
    );
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
  expect(await runCliPastWait(f.args, f.deps), JSON.stringify(f.output)).toBe(0);
  const state = (await f.runtime.store.read())!;
  expect(state.status).toBe("complete");
  expect(await readDeploymentEnvironment(venue.db)).toBe("production");
  const series = await venue.db.select().from(invoiceSeries);
  expect(series.map((row) => row.code).sort()).toEqual(["A-0CNNY", "FF-0CNNY", "R-0CNNY"]);
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
  expect(await runCliPastWait(f.args, f.deps), JSON.stringify(f.output)).toBe(1);
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
          aeatCert: {
            ...productionCertificate,
            pfxBase64: replacementMaterial.pfx.toString("base64"),
          },
          email: productionEmail,
        }),
      );
    if (change === "build") f.env.WAITRON_BUILD_ID = "another-build";
    if (change === "key") f.env.WAITRON_CREDENTIALS_KEY = Buffer.alloc(32, 74).toString("base64");
    expect(await runCliPastWait(f.args, f.deps), JSON.stringify(f.output)).toBe(1);
    expect(f.output).toContain('setup.fiscal_test_required {"module":"verifactu"}');
    expect(await readDeploymentEnvironment(venue.db)).toBeNull();
    expect(await readTenantIdentities(venue.db)).toEqual([]);
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
            aeatCert: {
              ...productionCertificate,
              pfxBase64: replacementMaterial.pfx.toString("base64"),
            },
            email: { ...productionEmail, password: "SYNTHETIC-raced" },
          }),
        );
        await deployment.assertReady(state);
      },
    };
  };
  expect(await runCliPastWait(f.args, f.deps), JSON.stringify(f.output)).toBe(0);
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
    expect(await runCliPastWait(f.args, f.deps), JSON.stringify(f.output)).toBe(1);
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
    expect(await runCliPastWait(f.args, f.deps)).toBe(1);
    expect(f.output).toContain(message);
    expect(await readDeploymentEnvironment(venue.db)).toBeNull();
    expect(await readTenantIdentities(venue.db)).toEqual([]);
    expect(await venue.db.select().from(invoiceSeries)).toEqual([]);
    expect((await f.runtime.store.read())!.status).toBe("consumption-intent");
    expect(f.output.join("\n")).not.toContain(productionCertificate.passphrase);
    expect(f.output.join("\n")).not.toContain(productionEmail.password);
  },
);

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
    expect(
      await runCliPastWait([...f.args, "--test-fiscal"], f.deps),
      JSON.stringify(f.output),
    ).toBe(0);
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

it("a fiscal test question answered more than five minutes late still completes, because it is asked before the recovery pack", async () => {
  const f = await commandReadinessFixture();
  const prompt = f.deps.io.prompt;
  f.deps.io.prompt = async (question) => {
    if (question.startsWith("Send a preproduction fiscal test?")) vi.advanceTimersByTime(360_000);
    return prompt(question);
  };
  try {
    expect(
      await runCliPastWait([...f.args, "--test-fiscal"], f.deps),
      JSON.stringify(f.output),
    ).toBe(0);
    expect(f.prompts.filter((question) => !question.startsWith("Confirm setup password"))).toEqual([
      "Send a preproduction fiscal test? [y/N]: ",
      "Have you kept this recovery pack? [y/N]: ",
    ]);
    expect((await f.runtime.store.read())!.status).toBe("complete");
  } finally {
    f.drain.mockRestore();
  }
});

it("an unreadable retained vault file refuses before command activation", async () => {
  const f = await realActivationFixture();
  const { mkdir } = await import("node:fs/promises");
  await mkdir(join(f.root, "state/secrets.env"), { recursive: true });
  await expect(runCliPastWait(f.args, f.deps)).rejects.toMatchObject({ code: "EISDIR" });
  expect(await readTenantIdentities(venue.db)).toEqual([]);
  expect(await readDeploymentEnvironment(venue.db)).toBeNull();
  expect((await f.runtime.store.read())!.status).toBe("consumption-intent");
  await expect(readFile(join(f.root, "state/trading.env"))).rejects.toMatchObject({
    code: "ENOENT",
  });
});

it("a setup whose node.db refuses to seal the key stamps no public key in venue.db", async () => {
  const f = await realActivationFixture();
  const { sql } = await import("drizzle-orm");
  const { readMembershipTrustSet } = await import("@waitron/db");
  await venue.node.execute(
    sql.raw(`create trigger refuse_signing_key before insert on node_signing_key
      begin select raise(abort, 'refused by test'); end`),
  );
  try {
    await expect(runCliPastWait(f.args, f.deps)).rejects.toThrow("refused by test");
    const nodeId = (await f.runtime.store.read())!.frozen.nodeId;
    expect((await readMembershipTrustSet(venue.db))[nodeId]).toBeUndefined();
  } finally {
    await venue.node.execute(sql`drop trigger if exists refuse_signing_key`);
  }
});

async function unpreparedDeploymentFixture(
  environment: "production" | "preproduction" = "preproduction",
) {
  const f = await realActivationFixture();
  await f.runtime.owner.claimFirstSetup({ environment, request });
  const state = (await f.runtime.store.read())!;
  const deployment = f.deps.firstSetupDeployment!({
    runtime: f.runtime,
    db: venue.db,
    node: venue.node,
  });
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
  expect(await runCliPastWait(f.args, f.deps), JSON.stringify(f.output)).toBe(0);
  const state = (await f.runtime.store.read())!;
  const before = await venue.db.select().from(invoiceSeries);
  const tenants = await readTenantIdentities(venue.db);
  const deployment = f.deps.firstSetupDeployment!({
    runtime: f.runtime,
    db: venue.db,
    node: venue.node,
  });
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
    expect(await runCliPastWait([...f.args, "--test-fiscal"], f.deps)).toBe(1);
    expect(f.prompts).toContain("Send a preproduction fiscal test? [y/N]: ");
    expect(f.drain).not.toHaveBeenCalled();
    expect(await readDeploymentEnvironment(venue.db)).toBeNull();
    expect(await readTenantIdentities(venue.db)).toEqual([]);
    await expect(readFile(join(f.root, "state/flows/setup/readiness.json"))).rejects.toMatchObject({
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
      expect(
        await runCliPastWait([...f.args, "--test-fiscal"], f.deps),
        JSON.stringify(f.output),
      ).toBe(1);
      expect(f.output).toContain(`Fiscal test: ${status}`);
      expect(f.drain).toHaveBeenCalledOnce();
      expect(await readDeploymentEnvironment(venue.db)).toBeNull();
      expect(await readTenantIdentities(venue.db)).toEqual([]);
      await expect(
        readFile(join(f.root, "state/flows/setup/readiness.json")),
      ).rejects.toMatchObject({
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
    expect(await runCliPastWait(f.args, f.deps)).toBe(1);
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
  expect(await runCliPastWait([...f.args, "--test-fiscal"], deps)).toBe(1);
  expect(f.output).toContain("setup.not_ready {}");
  expect(f.deps.openVenue).not.toHaveBeenCalled();
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
  expect(await runCliPastWait(f.args, f.deps), JSON.stringify(f.output)).toBe(0);
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
