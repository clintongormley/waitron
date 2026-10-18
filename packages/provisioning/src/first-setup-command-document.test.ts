import { randomBytes, createHash } from "node:crypto";
import { mkdtemp, readFile, rm, stat, writeFile, mkdir, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ALL_MODULES } from "@waitron/composition";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { TEST_MIGRATIONS } from "@waitron/fiscal-verifactu/test/migrations.js";
import { createFirstSetupRuntime } from "./first-setup-runtime.js";
import { prepareFirstSetupCommand } from "./first-setup-command.js";
import { firstFiscalPublicDigest } from "./first-setup-public-digest.js";
import { MODULE, PASSWORD, request } from "../test/first-setup-request.js";

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

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "command-document-"));
  roots.push(root);
  const options = {
    stateDir: join(root, "state"),
    venueDir: join(root, "venue"),
    modules: ALL_MODULES,
    environment: {},
    database: () => venue.db,
  };
  await mkdir(options.venueDir);
  const runtime = createFirstSetupRuntime(options);
  const claim = await runtime.owner.claimFirstSetup(
    { environment: "preproduction", request },
    randomBytes(32).toString("base64url"),
  );
  const output: string[] = [],
    prompts: string[] = [];
  const io = {
    stdout: (line: string) => {
      output.push(line);
    },
    stderr: (line: string) => {
      output.push(line);
    },
    prompt: async (question: string) => {
      prompts.push(question);
      return "no";
    },
    promptSecret: async (question: string) => {
      prompts.push(question);
      return PASSWORD;
    },
    clearScreen() {},
  };
  const prepared = await prepareFirstSetupCommand(
    runtime,
    { ...claim.state, capability: claim.capability },
    io,
  );
  expect(prepared.status).toBe("ready");
  prompts.length = 0;
  io.prompt = async (question) => {
    prompts.push(question);
    return "yes";
  };
  const path = join(root, "recovery.pdf");
  return { root, options, runtime, owner: prepared.owner, io, output, prompts, path };
}

it("saves the real module PDF privately and grants activation only for its exact public reference", async () => {
  const f = await fixture();
  const before = await f.runtime.store.read();
  const result = await f.runtime.commandDelivery.deliver(f.owner, f.io, f.path, "es");
  expect(result.status).toBe("ready");
  const pdf = await readFile(f.path);
  expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
  expect((await stat(f.path)).mode & 0o777).toBe(0o600);
  const manifest = JSON.parse(
    await readFile(
      join(f.options.stateDir, "first-fiscal-documents", `${MODULE}.recovery.json`),
      "utf8",
    ),
  );
  expect(manifest).toMatchObject({
    module: MODULE,
    documentDigest: createHash("sha256").update(pdf).digest("hex"),
    inputDigest: firstFiscalPublicDigest(before!.inputs[MODULE]),
    statement: {
      kind: "waitron-recovery-document",
      installationCodes: ["06RB"],
      version: 1,
      scope: { taxpayerNif: request.taxId, softwareId: "W1", environment: "preproduction" },
      taxpayerName: request.legalName,
      venueName: request.location.name,
      createdAt: "2026-10-16T11:40:00.000Z",
      nodeKey: { nodeId: before!.frozen.nodeId },
    },
  });
  expect(manifest.bindingDigest).toBe(firstFiscalPublicDigest(manifest.statement));
  expect(Object.keys(manifest.statement.nodeKey).sort()).toEqual(["name", "nodeId"]);
  expect(f.prompts).toEqual([
    "Confirm setup password: ",
    "Have you kept this recovery PDF? [y/N]: ",
    "Confirm setup password: ",
  ]);
  expect(f.output.join("\n")).not.toContain(PASSWORD);
  expect(await f.runtime.store.read()).toEqual(before);
  await expect(f.runtime.recoveryDelivery.consume(f.owner, MODULE)).resolves.toBeUndefined();
  await expect(f.runtime.recoveryDelivery.consume(f.owner, MODULE)).rejects.toMatchObject({
    code: "setup.not_ready",
  });
  expect(await venue.db.execute("select count(*) as count from registro_sif")).toMatchObject({
    rows: [{ count: 0 }],
  });
});

it.each(["", "no", "maybe"])(
  "a %j kept answer leaves the PDF but grants no activation",
  async (answer) => {
    const f = await fixture();
    f.io.prompt = async () => answer;
    expect(await f.runtime.commandDelivery.deliver(f.owner, f.io, f.path, "en")).toEqual({
      status: "cancelled",
    });
    expect((await readFile(f.path)).subarray(0, 5).toString()).toBe("%PDF-");
    await expect(f.runtime.recoveryDelivery.consume(f.owner, MODULE)).rejects.toMatchObject({
      code: "setup.not_ready",
    });
    expect(f.prompts).toEqual(["Confirm setup password: "]);
  },
);

it("a wrong kept-confirmation password leaves the saved PDF without granting activation", async () => {
  const f = await fixture();
  let passwords = 0;
  f.io.promptSecret = async () => (++passwords === 1 ? PASSWORD : "SYNTHETIC-wrong-password");
  await expect(
    f.runtime.commandDelivery.deliver(f.owner, f.io, f.path, "en"),
  ).rejects.toMatchObject({ code: "setup.owner_required" });
  expect((await readFile(f.path)).subarray(0, 5).toString()).toBe("%PDF-");
  await expect(f.runtime.recoveryDelivery.consume(f.owner, MODULE)).rejects.toMatchObject({
    code: "setup.not_ready",
  });
});

it.each(["state", "venue", "relative", "blank", "symlink"])(
  "refuses %s output before staging a secret",
  async (location) => {
    const f = await fixture();
    await symlink(f.options.stateDir, join(f.root, "state-alias"));
    const paths = {
      state: join(f.options.stateDir, "key.pdf"),
      venue: join(f.options.venueDir, "key.pdf"),
      relative: "key.pdf",
      blank: "",
      symlink: join(f.root, "state-alias", "key.pdf"),
    };
    await expect(
      f.runtime.commandDelivery.deliver(f.owner, f.io, paths[location as keyof typeof paths], "en"),
    ).rejects.toMatchObject({ code: "setup.not_ready" });
    await expect(
      readFile(join(f.options.stateDir, "first-setup-node-key.json")),
    ).rejects.toMatchObject({ code: "ENOENT" });
    expect(f.prompts).toEqual([]);
  },
);

it("does not replace an existing unrelated file or grant activation", async () => {
  const f = await fixture();
  await writeFile(f.path, "keep this original");
  await expect(
    f.runtime.commandDelivery.deliver(f.owner, f.io, f.path, "en"),
  ).rejects.toMatchObject({ code: "setup.not_ready" });
  expect(await readFile(f.path, "utf8")).toBe("keep this original");
  expect(f.prompts).toEqual([]);
  await expect(f.runtime.recoveryDelivery.consume(f.owner, MODULE)).rejects.toMatchObject({
    code: "setup.not_ready",
  });
});

it("a password-recovered command confirms the exact saved PDF without rotating its key or hour", async () => {
  const f = await fixture();
  f.io.prompt = async () => "no";
  await f.runtime.commandDelivery.deliver(f.owner, f.io, f.path, "es");
  const original = await readFile(f.path);
  const staged = await readFile(join(f.options.stateDir, "first-setup-node-key.json"));
  const runtime = createFirstSetupRuntime(f.options);
  const recovered = await runtime.owner.recoverFirstSetup(randomBytes(32).toString("base64url"), {
    password: PASSWORD,
  });
  const owner = { ...recovered.state, capability: recovered.capability };
  f.io.prompt = async () => "yes";
  f.prompts.length = 0;
  expect(await runtime.commandDelivery.deliver(owner, f.io, f.path, "es")).toEqual({
    status: "ready",
  });
  expect(await readFile(f.path)).toEqual(original);
  expect(await readFile(join(f.options.stateDir, "first-setup-node-key.json"))).toEqual(staged);
  expect((await runtime.store.read())!.inputs[MODULE]).toEqual(
    (await f.runtime.store.read())!.inputs[MODULE],
  );
  expect(f.prompts).toEqual(["Confirm setup password: "]);
  await expect(runtime.recoveryDelivery.consume(owner, MODULE)).resolves.toBeUndefined();
});

it("rejects a changed saved PDF after password recovery without replacing it", async () => {
  const f = await fixture();
  f.io.prompt = async () => "no";
  await f.runtime.commandDelivery.deliver(f.owner, f.io, f.path, "en");
  await writeFile(f.path, "changed PDF");
  const recovered = await f.runtime.owner.recoverFirstSetup(randomBytes(32).toString("base64url"), {
    password: PASSWORD,
  });
  const owner = { ...recovered.state, capability: recovered.capability };
  await expect(f.runtime.commandDelivery.deliver(owner, f.io, f.path, "en")).rejects.toMatchObject({
    code: "setup.not_ready",
  });
  expect(await readFile(f.path, "utf8")).toBe("changed PDF");
  await expect(f.runtime.recoveryDelivery.consume(owner, MODULE)).rejects.toMatchObject({
    code: "setup.not_ready",
  });
});

it("ownership recovery during kept confirmation cannot authorise the stale command", async () => {
  const f = await fixture();
  f.io.prompt = async () => {
    await f.runtime.owner.recoverFirstSetup(randomBytes(32).toString("base64url"), {
      password: PASSWORD,
    });
    return "yes";
  };
  await expect(
    f.runtime.commandDelivery.deliver(f.owner, f.io, f.path, "en"),
  ).rejects.toMatchObject({ code: "setup.owner_required" });
  await expect(f.runtime.recoveryDelivery.consume(f.owner, MODULE)).rejects.toMatchObject({
    code: "setup.owner_required",
  });
});

it("a PDF changed while the kept question is open cannot grant activation", async () => {
  const f = await fixture();
  f.io.prompt = async () => {
    await writeFile(f.path, "changed while answering");
    return "yes";
  };
  await expect(
    f.runtime.commandDelivery.deliver(f.owner, f.io, f.path, "en"),
  ).rejects.toMatchObject({ code: "setup.not_ready" });
  await expect(f.runtime.recoveryDelivery.consume(f.owner, MODULE)).rejects.toMatchObject({
    code: "setup.not_ready",
  });
});

it("a wrong staging password creates no PDF or retained key", async () => {
  const f = await fixture();
  f.io.promptSecret = async () => "SYNTHETIC-wrong-password";
  await expect(
    f.runtime.commandDelivery.deliver(f.owner, f.io, f.path, "en"),
  ).rejects.toMatchObject({ code: "setup.owner_required" });
  await expect(readFile(f.path)).rejects.toMatchObject({ code: "ENOENT" });
  await expect(
    readFile(join(f.options.stateDir, "first-setup-node-key.json")),
  ).rejects.toMatchObject({ code: "ENOENT" });
});

it("a command without a document contribution refuses before staging any key", async () => {
  const f = await fixture();
  const seat = f.runtime.modules.find((module) => module.name === MODULE)!.provisioning!
    .initialSetup!;
  seat.commandRecoveryDocument = undefined;
  await expect(
    f.runtime.commandDelivery.deliver(f.owner, f.io, f.path, "en"),
  ).rejects.toMatchObject({ code: "setup.not_ready" });
  await expect(
    readFile(join(f.options.stateDir, "first-setup-node-key.json")),
  ).rejects.toMatchObject({ code: "ENOENT" });
  expect(f.prompts).toEqual([]);
});

it.each([0, 8 * 1024 * 1024 + 1])(
  "refuses a %i-byte module document before creating an output file",
  async (size) => {
    const f = await fixture();
    const seat = f.runtime.modules.find((module) => module.name === MODULE)!.provisioning!
      .initialSetup!;
    vi.spyOn(seat, "commandRecoveryDocument").mockResolvedValue({
      bytes: new Uint8Array(size),
      statement: null,
    });
    await expect(
      f.runtime.commandDelivery.deliver(f.owner, f.io, f.path, "en"),
    ).rejects.toMatchObject({ code: "setup.not_ready" });
    await expect(readFile(f.path)).rejects.toMatchObject({ code: "ENOENT" });
    await expect(f.runtime.recoveryDelivery.consume(f.owner, MODULE)).rejects.toMatchObject({
      code: "setup.not_ready",
    });
  },
);

it("a renderer cannot write its PDF after ownership changes", async () => {
  const f = await fixture();
  const seat = f.runtime.modules.find((module) => module.name === MODULE)!.provisioning!
    .initialSetup!;
  const render = seat.commandRecoveryDocument!;
  vi.spyOn(seat, "commandRecoveryDocument").mockImplementation(async (...args) => {
    const document = await render(...args);
    await f.runtime.owner.recoverFirstSetup(randomBytes(32).toString("base64url"), {
      password: PASSWORD,
    });
    return document;
  });
  await expect(
    f.runtime.commandDelivery.deliver(f.owner, f.io, f.path, "en"),
  ).rejects.toMatchObject({ code: "setup.owner_required" });
  await expect(readFile(f.path)).rejects.toMatchObject({ code: "ENOENT" });
});
