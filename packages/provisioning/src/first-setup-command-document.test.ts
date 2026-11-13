import { readSetupFlowRecord } from "./setup-flow-record.js";
import { createHash } from "node:crypto";
import {
  chmod,
  mkdtemp,
  readFile,
  rename,
  rm,
  stat,
  writeFile,
  mkdir,
  symlink,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ALL_MODULES } from "@waitron/composition";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { TEST_MIGRATIONS } from "@waitron/fiscal-verifactu/test/migrations.js";
import { createFirstSetupRuntime } from "./first-setup-runtime.js";
import { prepareCommandPastWaits } from "../test/settle-wait.js";
import { firstFiscalPublicDigest } from "./first-setup-public-digest.js";
import { MODULE, PASSWORD, request } from "../test/first-setup-request.js";

const NOW = Date.parse("2026-10-16T11:40:00Z");
const asRoot = process.getuid?.() === 0;
const external = vi.hoisted(() => ({ internet: vi.fn() }));
const packWrite = vi.hoisted(() => ({
  failing: undefined as undefined | "stat" | "writeFile" | "sync",
  beforeFailing: async () => {},
}));
vi.mock("node:fs/promises", async (original) => {
  const actual = await original<typeof import("node:fs/promises")>();
  return {
    ...actual,
    open: async (...args: Parameters<typeof actual.open>) => {
      const file = await actual.open(...args);
      const step = packWrite.failing;
      if (step === undefined || !String(args[0]).endsWith(".pdf")) return file;
      const writeFile = file.writeFile.bind(file);
      const fail = async () => {
        await packWrite.beforeFailing();
        throw Object.assign(new Error("no space left on device"), { code: "ENOSPC" });
      };
      file.writeFile = async (data, options) => {
        await writeFile(Buffer.from(data as Uint8Array).subarray(0, 16), options);
        if (step === "writeFile") await fail();
      };
      if (step === "sync") file.sync = fail;
      if (step === "stat") file.stat = fail;
      return file;
    },
  };
});
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
  packWrite.failing = undefined;
  packWrite.beforeFailing = async () => {};
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
  const claim = await runtime.owner.claimFirstSetup({ environment: "preproduction", request });
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
  const prepared = await prepareCommandPastWaits(
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
    JSON.stringify((await readSetupFlowRecord(f.options.stateDir))?.recoveryManifests?.[MODULE]),
  );
  expect(manifest).toMatchObject({
    module: MODULE,
    documentDigest: createHash("sha256").update(pdf).digest("hex"),
    inputDigest: firstFiscalPublicDigest(before!.inputs[MODULE]),
    statement: {
      kind: "waitron-recovery-document",
      version: 1,
      scope: { taxpayerNif: request.taxId, softwareId: "W1", environment: "preproduction" },
      taxpayerName: request.legalName,
      venueName: request.name,
      createdAt: "2026-10-16T11:42:01.000Z",
      nodeKey: { nodeId: before!.frozen.nodeId },
    },
  });
  expect(manifest.bindingDigest).toBe(firstFiscalPublicDigest(manifest.statement));
  expect(Object.keys(manifest.statement.nodeKey).sort()).toEqual(["name", "nodeId"]);
  expect(f.prompts).toEqual([
    "Confirm setup password: ",
    "Have you kept this recovery pack? [y/N]: ",
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

it.each([
  "state",
  "venue",
  "relative",
  "blank",
  "symlink",
  "missing folder",
  "parent is a file",
  "folder below a file",
  ...(asRoot ? [] : ["read-only folder", "folder it cannot enter"]),
  "not a pdf",
])("refuses %s output before staging a secret, saying why", async (location) => {
  const f = await fixture();
  await symlink(f.options.stateDir, join(f.root, "state-alias"));
  await writeFile(join(f.root, "a-file"), "not a folder");
  await mkdir(join(f.root, "read-only"), { mode: 0o555 });
  await mkdir(join(f.root, "cannot-enter"));
  await chmod(join(f.root, "cannot-enter"), 0o666);
  const inside = (path: string) =>
    `${path} is inside the box's own state or venue folder. Name a file outside both, so the pack is kept apart from the box.`;
  const shape = (path: string) =>
    `--recovery-pdf must name a .pdf file by its full path, starting with /; ${path} does not.`;
  const cases = {
    state: [join(f.options.stateDir, "key.pdf"), inside],
    venue: [join(f.options.venueDir, "key.pdf"), inside],
    relative: ["key.pdf", shape],
    blank: [
      "",
      () =>
        "--recovery-pdf was left empty. It must name a .pdf file by its full path, starting with /.",
    ],
    symlink: [join(f.root, "state-alias", "key.pdf"), inside],
    "missing folder": [
      join(f.root, "no-such-folder", "key.pdf"),
      () =>
        `The folder ${join(f.root, "no-such-folder")} does not exist. Name a file in a folder that exists.`,
    ],
    "parent is a file": [
      join(f.root, "a-file", "key.pdf"),
      () => `${join(f.root, "a-file")} is not a folder. Name a file in a folder that exists.`,
    ],
    "folder below a file": [
      join(f.root, "a-file", "below", "key.pdf"),
      () =>
        `${join(f.root, "a-file", "below")} is not a folder. Name a file in a folder that exists.`,
    ],
    "read-only folder": [
      join(f.root, "read-only", "key.pdf"),
      () =>
        `The setup cannot write to the folder ${join(f.root, "read-only")}. Name a file in a folder it can write to.`,
    ],
    "folder it cannot enter": [
      join(f.root, "cannot-enter", "key.pdf"),
      () =>
        `The setup cannot write to the folder ${join(f.root, "cannot-enter")}. Name a file in a folder it can write to.`,
    ],
    "not a pdf": [join(f.root, "key.txt"), shape],
  } as const;
  const [path, words] = cases[location as keyof typeof cases];
  f.output.length = 0;
  await expect(f.runtime.commandDelivery.deliver(f.owner, f.io, path, "en")).rejects.toMatchObject({
    code: "setup.not_ready",
  });
  expect((await readSetupFlowRecord(f.options.stateDir))?.nodeKey).toBeUndefined();
  expect(f.prompts).toEqual([]);
  expect(f.output).toEqual([
    words(path),
    "The setup stopped here and cannot carry on. Open the box's setup page in a browser and choose Start again, then run the command again.",
  ]);
});

it.skipIf(asRoot)(
  "the early check refuses a read-only folder before anything is recorded, saying nothing changed",
  async () => {
    const f = await fixture();
    const folder = join(f.root, "read-only");
    await mkdir(folder);
    await chmod(folder, 0o555);
    f.output.length = 0;
    await expect(
      f.runtime.commandDelivery.checkDestination(join(folder, "key.pdf"), f.io),
    ).rejects.toMatchObject({ code: "setup.not_ready" });
    expect(f.output).toEqual([
      `The setup cannot write to the folder ${folder}. Name a file in a folder it can write to.`,
      "Nothing was changed, so you can run the command again straight away.",
    ]);
  },
);

const STOPPED =
  "The setup stopped here and cannot carry on. Open the box's setup page in a browser and choose Start again, then run the command again.";
const cannotWrite = (path: string) =>
  `The setup could not write the recovery pack to ${path}, and has left no file there. Make sure its folder can be written to and has free space.`;

it.each(["writeFile", "sync"] as const)(
  "a failed %s leaves no partial file to block the next run, and says so",
  async (step) => {
    const f = await fixture();
    packWrite.failing = step;
    f.output.length = 0;
    await expect(
      f.runtime.commandDelivery.deliver(f.owner, f.io, f.path, "en"),
    ).rejects.toMatchObject({ code: "setup.not_ready" });
    expect(f.output).toEqual([cannotWrite(f.path), STOPPED]);
    await expect(stat(f.path)).rejects.toMatchObject({ code: "ENOENT" });
    packWrite.failing = undefined;
    await expect(f.runtime.commandDelivery.checkDestination(f.path, f.io)).resolves.toBeUndefined();
    await expect(f.runtime.recoveryDelivery.consume(f.owner, MODULE)).rejects.toMatchObject({
      code: "setup.not_ready",
    });
  },
);

it.each(["writeFile", "sync"] as const)(
  "a failed %s leaves alone another file put at the path in place of the partial one",
  async (step) => {
    const f = await fixture();
    const movedAside = join(f.root, "moved-aside.pdf");
    packWrite.failing = step;
    packWrite.beforeFailing = async () => {
      await rename(f.path, movedAside);
      await writeFile(f.path, "another setup's recovery pack");
    };
    f.output.length = 0;
    await expect(
      f.runtime.commandDelivery.deliver(f.owner, f.io, f.path, "en"),
    ).rejects.toMatchObject({ code: "setup.not_ready" });
    expect(await readFile(f.path, "utf8")).toBe("another setup's recovery pack");
    expect((await stat(movedAside)).size).toBe(16);
    expect(f.output).toEqual([cannotWrite(f.path), STOPPED]);
  },
);

it("a partial file it cannot identify as its own is left in place, and says so", async () => {
  const f = await fixture();
  packWrite.failing = "stat";
  f.output.length = 0;
  await expect(
    f.runtime.commandDelivery.deliver(f.owner, f.io, f.path, "en"),
  ).rejects.toMatchObject({ code: "setup.not_ready" });
  expect(f.output).toEqual([
    `The setup could not write the recovery pack to ${f.path}, and an incomplete file is left there. Name a different file when you run the command again.`,
    STOPPED,
  ]);
  expect((await stat(f.path)).size).toBe(0);
});

it.skipIf(asRoot)("a folder made read-only during the password prompt gets words", async () => {
  const f = await fixture();
  const folder = join(f.root, "goes-read-only");
  await mkdir(folder);
  const path = join(folder, "key.pdf");
  f.io.promptSecret = async (question) => {
    f.prompts.push(question);
    await chmod(folder, 0o555);
    return PASSWORD;
  };
  f.output.length = 0;
  await expect(f.runtime.commandDelivery.deliver(f.owner, f.io, path, "en")).rejects.toMatchObject({
    code: "setup.not_ready",
  });
  expect(f.output).toEqual([cannotWrite(path), STOPPED]);
  await expect(stat(path)).rejects.toMatchObject({ code: "ENOENT" });
});

it.skipIf(asRoot)("says so when the partial file cannot be removed either", async () => {
  const f = await fixture();
  const folder = join(f.root, "stuck");
  await mkdir(folder);
  const path = join(folder, "key.pdf");
  packWrite.failing = "writeFile";
  packWrite.beforeFailing = () => chmod(folder, 0o555);
  f.output.length = 0;
  await expect(f.runtime.commandDelivery.deliver(f.owner, f.io, path, "en")).rejects.toMatchObject({
    code: "setup.not_ready",
  });
  expect(f.output).toEqual([
    `The setup could not write the recovery pack to ${path}, and an incomplete file is left there. Name a different file when you run the command again.`,
    STOPPED,
  ]);
  await chmod(folder, 0o755);
  expect((await stat(path)).size).toBe(16);
});

it("does not replace an existing unrelated file or grant activation", async () => {
  const f = await fixture();
  await writeFile(f.path, "keep this original");
  f.output.length = 0;
  await expect(
    f.runtime.commandDelivery.deliver(f.owner, f.io, f.path, "en"),
  ).rejects.toMatchObject({ code: "setup.not_ready" });
  expect(await readFile(f.path, "utf8")).toBe("keep this original");
  expect(f.prompts).toEqual([]);
  expect(f.output).toEqual([
    `A file already exists at ${f.path}, and the setup never writes over one: it may be an earlier setup's recovery pack, the only copy of that setup's keys. Name a file that does not exist yet, or move the existing file to another folder first.`,
    "The setup stopped here and cannot carry on. Open the box's setup page in a browser and choose Start again, then run the command again.",
  ]);
  await expect(f.runtime.recoveryDelivery.consume(f.owner, MODULE)).rejects.toMatchObject({
    code: "setup.not_ready",
  });
});

it("a file appearing after the last check is not replaced, and the person is told why", async () => {
  const f = await fixture();
  f.output.length = 0;
  f.io.promptSecret = async (question) => {
    f.prompts.push(question);
    await writeFile(f.path, "raced in");
    return PASSWORD;
  };
  await expect(
    f.runtime.commandDelivery.deliver(f.owner, f.io, f.path, "en"),
  ).rejects.toMatchObject({ code: "setup.not_ready" });
  expect(await readFile(f.path, "utf8")).toBe("raced in");
  expect(f.output).toEqual([
    `A file already exists at ${f.path}, and the setup never writes over one: it may be an earlier setup's recovery pack, the only copy of that setup's keys. Name a file that does not exist yet, or move the existing file to another folder first.`,
    "The setup stopped here and cannot carry on. Open the box's setup page in a browser and choose Start again, then run the command again.",
  ]);
  await expect(f.runtime.recoveryDelivery.consume(f.owner, MODULE)).rejects.toMatchObject({
    code: "setup.not_ready",
  });
});

it("a setup stopped during the kept confirmation cannot authorise the stale command", async () => {
  const f = await fixture();
  f.io.prompt = async () => {
    await f.runtime.store.update(f.owner.attemptId, f.owner.revision, { kind: "abandoned" });
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
  expect((await readSetupFlowRecord(f.options.stateDir))?.nodeKey).toBeUndefined();
});

it("a command without a document contribution refuses before staging any key", async () => {
  const f = await fixture();
  const seat = f.runtime.modules.find((module) => module.name === MODULE)!.provisioning!
    .initialSetup!;
  seat.commandRecoveryDocument = undefined;
  await expect(
    f.runtime.commandDelivery.deliver(f.owner, f.io, f.path, "en"),
  ).rejects.toMatchObject({ code: "setup.not_ready" });
  expect((await readSetupFlowRecord(f.options.stateDir))?.nodeKey).toBeUndefined();
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

it("a renderer cannot write its PDF after the setup is stopped", async () => {
  const f = await fixture();
  const seat = f.runtime.modules.find((module) => module.name === MODULE)!.provisioning!
    .initialSetup!;
  const render = seat.commandRecoveryDocument!;
  vi.spyOn(seat, "commandRecoveryDocument").mockImplementation(async (...args) => {
    const document = await render(...args);
    await f.runtime.store.update(f.owner.attemptId, f.owner.revision, { kind: "abandoned" });
    return document;
  });
  await expect(
    f.runtime.commandDelivery.deliver(f.owner, f.io, f.path, "en"),
  ).rejects.toMatchObject({ code: "setup.owner_required" });
  await expect(readFile(f.path)).rejects.toMatchObject({ code: "ENOENT" });
});
