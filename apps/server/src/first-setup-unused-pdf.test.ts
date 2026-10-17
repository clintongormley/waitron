import { randomBytes } from "node:crypto";
import { readFile, writeFile, rm } from "node:fs/promises";
import * as filesystem from "node:fs/promises";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { Agent } from "undici";
import { afterEach, expect, it, vi } from "vitest";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import {
  createFirstSetupCoordinator,
  createFirstSetupResolutionStore,
  inspectFirstSetupWorkspaceSelection,
  type RegisterAnswer,
} from "@waitron/provisioning";
import { hourFirstFiscalFixture } from "../test/hour-first-fiscal.js";
import { firstFiscalPublicDigest as publicDigest } from "./first-fiscal-delivery.js";
import { hourSetupInput } from "@waitron/fiscal-verifactu/src/hour-preparation.js";
import { request } from "../test/first-fiscal.js";
import { createFirstSetupModuleHost } from "./module-operation-host.js";
import { createFirstSetupResolutionActions } from "./first-setup-resolution.js";
import { firstSetupModuleContext } from "./first-fiscal-evidence.js";
import { startServerOrFirstSetupResolution } from "./node-entry.js";
import { ensureBoxSecrets } from "./box-secrets.js";
import { freePorts } from "./testing/free-ports.js";

vi.mock("node:fs/promises", { spy: true });
const suite = useVenueDb({ migrations: migrationOptionsFor(manifestSets(), null) });
vi.mock("@waitron/fiscal-verifactu/src/hour-clock-internet.js", () => ({
  observeInternetHourClock: async () => ({
    source: "internet",
    result: "usable",
    instantMs: Date.now(),
    uncertaintyMs: 500,
    wallStartedMs: Date.now(),
    wallFinishedMs: Date.now(),
    monotonicStartedMs: performance.now(),
    monotonicFinishedMs: performance.now(),
  }),
}));
vi.mock("@waitron/fiscal-verifactu/src/hour-release.js", () => ({
  readHourRelease: () => ({ instantMs: Date.parse("2026-10-15T00:00:00Z") }),
}));
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date", "performance"] });
  vi.setSystemTime("2026-10-16T11:40:00Z");
});
const fixtures: Awaited<ReturnType<typeof hourFirstFiscalFixture>>[] = [];
afterEach(async () => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  await Promise.all(fixtures.splice(0).map((f) => f.dispose()));
});
async function fixture(workspace?: { root: string; stateDir: string; venueDir: string }) {
  if (workspace !== undefined) vi.setSystemTime(new Date(Date.now() + 3_600_000));
  const f = await hourFirstFiscalFixture({
    database: () => suite.db,
    ...(workspace === undefined ? {} : { workspace }),
  });
  fixtures.push(f);
  await suite.db.archiveTo(join(f.venueDir, "venue.db"));
  const host = f.host;
  const actions = createFirstSetupResolutionActions({ ...f, host });
  const answer = (status: "Consumed" | "Not consumed" | "Unknown" = "Consumed") => ({
    kind: "current-master" as const,
    status,
    custodian: "Elena",
    reference: f.staged.ref.bindingDigest,
    consultedAt: "2026-10-16T12:20:00.000Z",
  });
  const start = async (register: RegisterAnswer = answer()) => {
    const inspected = await host.resolution.inspectFirstSetupResolution();
    return actions.startAgainFirstSetup({
      inspectionId: inspected.inspectionId,
      revision: inspected.revision!,
      ownerGeneration: inspected.ownerGeneration!,
      register,
    });
  };
  return { ...f, host, actions, start, answer };
}
it.each(["Consumed", "Not consumed", "Unknown"] as const)(
  "a never-activated box with a delivered PDF can start again after answering %s",
  async (status) => {
    const f = await fixture();
    const before = await f.host.resolution.captureFirstSetupOriginals();
    const binding = await f.start(f.answer(status));
    expect(binding.venueDir).not.toBe(f.venueDir);
    const records = createFirstSetupResolutionStore({
      ...f,
      coordinator: createFirstSetupCoordinator(),
    });
    const all = await records.read(binding.resolutionId);
    expect(all.map((r) => [r.action, r.phase, r.authority, r.database])).toEqual([
      ["retire", "prepared", "local-empty-unused-assignment", "empty-preactivation"],
      ["retire", "applied", "local-empty-unused-assignment", "empty-preactivation"],
      ["select-workspace", "prepared", "local-empty-unused-assignment", "empty-preactivation"],
      ["select-workspace", "applied", "local-empty-unused-assignment", "empty-preactivation"],
    ]);
    expect(all[1]!.register).toEqual(f.answer(status));
    expect(await records.readOriginals(binding.resolutionId)).toEqual(before.originals);
    for (const original of before.originals) {
      if (original.bytes === null || !/^(state|venue)\//.test(original.name)) continue;
      const [root, ...parts] = original.name.split("/");
      expect(await readFile(join(root === "state" ? f.stateDir : f.venueDir, ...parts))).toEqual(
        original.bytes,
      );
    }
    expect((await f.store.readForRepair())?.state.consumptionIntent).toBe(true);
    await expect(readFile(join(binding.venueDir, "venue.db"))).rejects.toMatchObject({
      code: "ENOENT",
    });
    await expect(f.host.owner.status(f.ownerAttempt)).rejects.toMatchObject({
      code: "setup.attempt_uncertain",
    });
  },
);
it.each([
  { identity: "06R9", issuedAt: "2026-10-16T09:40:00.000Z", spent: true },
  { identity: "06RA", issuedAt: "2026-10-16T10:40:00.000Z", spent: true },
  { identity: "06RB", issuedAt: "2026-10-16T11:40:00.000Z", spent: true },
  { identity: "06RC", issuedAt: "2026-10-16T12:40:00.000Z", spent: false },
])(
  "retiring the unused PDF excludes hour $identity across changed bases, spent=$spent",
  async ({ identity, issuedAt, spent }) => {
    const f = await fixture();
    const binding = await f.start();
    const next = createFirstSetupModuleHost({ ...binding, modules: f.modules, environment: {} });
    await next.owner.claimFirstSetup(
      {
        environment: "production",
        request: {
          ...request,
          seriesCode: "B",
          fullSeriesCode: "BFF",
          rectificativeSeriesCode: "BR",
        },
      },
      randomBytes(32).toString("base64url"),
    );
    let state = (await next.store.read())!;
    const context = firstSetupModuleContext(state, f.module);
    const input = hourSetupInput(
      {
        binding: context.binding,
        scope: { taxpayerNif: context.taxId, environment: context.environment },
        bases: [...context.bases].sort((a, b) => (a.code < b.code ? -1 : a.code > b.code ? 1 : 0)),
        identity,
        issuedAt,
      },
      context.administratorId,
    );
    state = await next.store.update(state.frozen.attemptId, state.revision, {
      kind: "candidates",
      module: f.module,
      request: { kind: "waitron-hour-setup", status: "selected", identity, input },
    });
    if (spent)
      await expect(next.assertFreshAssignment(state, f.module)).rejects.toMatchObject({
        code: "setup.attempt_conflict",
      });
    else await expect(next.assertFreshAssignment(state, f.module)).resolves.toBeUndefined();
  },
);
it.each(["activation-started", "uncertain"] as const)(
  "a retained %s event keeps the PDF reset unavailable even beside an empty database",
  async (kind) => {
    const f = await fixture();
    const changed = await f.store.update(f.ownerAttempt.attemptId, f.ownerAttempt.revision, {
      kind,
    });
    await f.store.update(f.ownerAttempt.attemptId, changed.revision, { kind: "abandoned" });
    await expect(f.start()).rejects.toMatchObject({ code: "setup.not_ready" });
  },
);
it("an unused PDF remains eligible after a publication binding was staged but activation never started", async () => {
  const f = await fixture();
  await f.store.update(f.ownerAttempt.attemptId, f.ownerAttempt.revision, {
    kind: "publication-binding",
    digest: "a".repeat(64),
  });
  await expect(f.start()).resolves.toMatchObject({ selectionGeneration: 1 });
});
it("successive never-activated PDFs retain every old block while allowing a third replacement", async () => {
  const first = await fixture();
  const secondBinding = await first.start();
  const second = await fixture({
    root: first.root,
    venueDir: secondBinding.venueDir,
    stateDir: secondBinding.stateDir,
  });
  const thirdBinding = await second.start();
  const third = await fixture({
    root: first.root,
    venueDir: thirdBinding.venueDir,
    stateDir: thirdBinding.stateDir,
  });
  await expect(third.start()).resolves.toMatchObject({
    anchorStateDir: secondBinding.anchorStateDir,
    selectionGeneration: 3,
  });
});
it("an earlier abandoned activation with a missing database does not become empty because a replacement has an unused PDF", async () => {
  const f = await fixture();
  const state = await f.store.update(f.ownerAttempt.attemptId, f.ownerAttempt.revision, {
    kind: "activation-started",
  });
  await f.store.update(f.ownerAttempt.attemptId, state.revision, { kind: "abandoned" });
  await rm(join(f.venueDir, "venue.db"));
  const inspected = await f.host.resolution.inspectFirstSetupResolution();
  const recovered = await f.host.owner.recoverFirstSetupOwner({
    inspectionId: inspected.inspectionId,
    revision: inspected.revision!,
    ownerGeneration: inspected.ownerGeneration!,
    clientClaimNonce: randomBytes(32).toString("base64url"),
    password: f.password,
  });
  const current = await f.host.resolution.inspectFirstSetupResolution();
  const binding = await f.actions.startAgainFirstSetup({
    inspectionId: current.inspectionId,
    revision: current.revision!,
    ownerGeneration: current.ownerGeneration!,
    register: f.answer(),
    owner: {
      attemptId: recovered.state.attemptId,
      revision: recovered.state.revision,
      ownerGeneration: recovered.state.ownerGeneration,
      capability: recovered.capability,
    },
  });
  const replacement = await fixture({
    root: f.root,
    venueDir: binding.venueDir,
    stateDir: binding.stateDir,
  });
  await expect(replacement.start()).rejects.toMatchObject({ code: "setup.not_ready" });
});
it.each([
  "no-master",
  "key",
  "stage",
  "manifest",
  "binding",
  "modules",
  "missing-db",
  "unknown-input",
  "orphan-document",
] as const)("unused-PDF reset refuses %s evidence", async (why) => {
  const f = await fixture();
  const directory = join(f.stateDir, "first-fiscal-documents");
  if (why === "key") await writeFile(join(f.stateDir, "first-setup-node-key.json"), "{}");
  if (why === "stage") {
    const path = join(f.stateDir, "first-setup-node-key.json");
    const key = JSON.parse(await readFile(path, "utf8"));
    key.stageId = "11111111-1111-4111-8111-111111111111";
    await writeFile(path, JSON.stringify(key));
  }
  if (why === "manifest") await writeFile(join(directory, `${f.module}.recovery.json`), "{}");
  if (why === "binding") {
    const path = join(directory, `${f.module}.recovery.json`);
    const manifest = JSON.parse(await readFile(path, "utf8"));
    manifest.bindingDigest = "0".repeat(64);
    await writeFile(path, JSON.stringify(manifest));
  }
  if (why === "modules") await writeFile(join(f.stateDir, "modules.json"), "{}");
  if (why === "missing-db") await rm(join(f.venueDir, "venue.db"));
  if (why === "unknown-input") {
    const path = join(f.stateDir, "first-setup.json");
    const state = JSON.parse(await readFile(path, "utf8"));
    state.inputs.unknown = { evidence: "not understood" };
    await writeFile(path, JSON.stringify(state));
  }
  if (why === "orphan-document") await writeFile(join(directory, "unknown.json"), "{}");
  await expect(
    f.start(why === "no-master" ? { kind: "no-current-master", confirmed: true } : f.answer()),
  ).rejects.toMatchObject({ code: "setup.not_ready" });
  await expect(readFile(join(f.venueDir, "first-setup-retirement.json"))).rejects.toMatchObject({
    code: "ENOENT",
  });
});
it.each([
  [
    "catalogue",
    "insert into catalogues(id, name, created_at, updated_at) values ('menu', 'Retained', '2026-10-16', '2026-10-16')",
  ],
  [
    "used invoice name",
    "insert into invoice_series(id, node_id, code, next_number) values ('series', 'node', 'A', 2)",
  ],
  [
    "sale",
    "insert into sales(id, source, series_id, node_id, invoice_number, issued_at, issued_offset_minutes, total, vat_breakdown, locale, invoice_locales, fiscal_backend, fiscal_state) values ('sale', 'operator_script', 'series', 'node', 1, '2026-10-16T12:00:00Z', 0, 100, '[]', 'en', '[\"en\"]', 'none', 'not_applicable')",
  ],
  [
    "filing",
    "insert into filing_cases(id, registro_id, cause, evidence, opened_at) values ('filing', 'registro', 'retained', '{}', 1)",
  ],
])("a retained %s independently refuses password-free unused-PDF reset", async (_name, sql) => {
  const f = await fixture();
  const connection = new DatabaseSync(join(f.venueDir, "venue.db"), {
    enableForeignKeyConstraints: false,
  });
  try {
    connection.exec(sql);
  } finally {
    connection.close();
  }
  const before = await readFile(join(f.venueDir, "venue.db"));
  await expect(f.start()).rejects.toMatchObject({ code: "setup.not_ready" });
  expect(await readFile(join(f.venueDir, "venue.db"))).toEqual(before);
});
it("a rehashed document with an invalid module confirmation cannot authorise unused-PDF reset", async () => {
  const f = await fixture();
  const directory = join(f.stateDir, "first-fiscal-documents");
  const manifestPath = join(directory, `${f.module}.recovery.json`);
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  expect(manifest.kind).toBe("recovery-key-delivery");
  manifest.statement.nodeKey.name = "different-recovery-key";
  manifest.bindingDigest = publicDigest(manifest.statement);
  await writeFile(manifestPath, JSON.stringify(manifest));
  await expect(f.start()).rejects.toMatchObject({ code: "setup.not_ready" });
});
it.each(["first-setup-workspace.json", "first-setup-selection.json"])(
  "an interrupted unused-PDF selection at %s resumes the same binding without a password",
  async (point) => {
    const f = await fixture();
    const actual = (await vi.importActual<typeof filesystem>("node:fs/promises")).rename;
    let interrupted = false;
    vi.spyOn(filesystem, "rename").mockImplementation(async (from, to) => {
      if (!interrupted && String(to).endsWith(point)) {
        interrupted = true;
        throw new Error("unused-PDF selection interruption");
      }
      await actual(from, to);
    });
    await expect(f.start()).rejects.toMatchObject({ code: "setup.attempt_uncertain" });
    expect(interrupted).toBe(true);
    vi.mocked(filesystem.rename).mockRestore();
    const pending = (await inspectFirstSetupWorkspaceSelection(f))!;
    const fresh = createFirstSetupModuleHost({ ...f, environment: {} });
    const actions = createFirstSetupResolutionActions({ ...f, host: fresh });
    const observed = (await actions.inspectWorkspaceSelection())!;
    await expect(
      actions.resumeWorkspaceSelection({
        ...observed,
        register: { kind: "no-current-master", confirmed: true },
      }),
    ).rejects.toMatchObject({ code: "setup.not_ready" });
    await expect(
      actions.resumeWorkspaceSelection({ ...observed, register: f.answer() }),
    ).resolves.toEqual(pending.binding);
    expect(await inspectFirstSetupWorkspaceSelection(f)).toBeNull();
  },
);
it("HTTPS accepts a fresh consulted-register answer for the same interrupted unused-PDF selection", async () => {
  const f = await fixture();
  const actual = (await vi.importActual<typeof filesystem>("node:fs/promises")).rename;
  let interrupted = false;
  vi.spyOn(filesystem, "rename").mockImplementation(async (from, to) => {
    if (!interrupted && String(to).endsWith("first-setup-workspace.json")) {
      interrupted = true;
      throw new Error("unused-PDF selection interruption");
    }
    await actual(from, to);
  });
  await expect(f.start()).rejects.toMatchObject({ code: "setup.attempt_uncertain" });
  expect(interrupted).toBe(true);
  vi.mocked(filesystem.rename).mockRestore();
  const pending = (await inspectFirstSetupWorkspaceSelection(f))!;
  await ensureBoxSecrets({
    stateDir: f.stateDir,
    hostnames: ["localhost"],
    now: () => new Date(),
    listIpv4: () => ["127.0.0.1"],
  });
  const [port] = await freePorts(1);
  const restart = vi.fn();
  const agent = new Agent({ connect: { ca: await readFile(join(f.stateDir, "tls/ca.crt")) } });
  let server: Awaited<ReturnType<typeof startServerOrFirstSetupResolution>> | undefined;
  try {
    server = await startServerOrFirstSetupResolution(
      {
        WAITRON_STATE_DIR: f.stateDir,
        WAITRON_VENUE_DIR: f.venueDir,
        WAITRON_HTTP_HOST: "127.0.0.1",
        WAITRON_HTTP_PORT: String(port),
      },
      {},
      { requestRestart: restart },
    );
    const origin = `https://127.0.0.1:${port}`;
    const observed = await fetch(`${origin}/setup-api/first-setup/resolution/selection`, {
      dispatcher: agent,
    } as RequestInit).then((r) => r.json());
    const register = { ...f.answer(), consultedAt: "2026-10-16T14:00:00.000Z" };
    const post = (body: unknown) =>
      fetch(`${origin}/setup-api/first-setup/resolution/resume-selection`, {
        method: "POST",
        dispatcher: agent,
        headers: { "Content-Type": "application/json", Origin: origin },
        body: JSON.stringify(body),
      } as RequestInit);
    const refused = await post({
      ...observed,
      register: { ...register, reference: "b".repeat(64) },
    });
    expect(refused.status).toBe(503);
    expect((await refused.json()).error.code).toBe("setup.not_ready");
    const accepted = await post({ ...observed, register });
    expect(accepted.status).toBe(200);
    expect(await accepted.json()).toEqual({
      workspaceId: pending.binding.workspaceId,
      selectionGeneration: pending.binding.selectionGeneration,
      restarting: true,
    });
    await vi.waitFor(() => expect(restart).toHaveBeenCalledTimes(1));
  } finally {
    await server?.close();
    await agent.close();
  }
});
