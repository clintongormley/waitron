import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { testProducer } from "../../test/declaration.js";
import { nodeIo, runDeclarationCommand } from "./command.js";

const PACKAGE = fileURLToPath(new URL("../../", import.meta.url));

const PRODUCER_ENV = {
  WAITRON_PRODUCER_NAME: testProducer.name,
  WAITRON_PRODUCER_TAX_ID: testProducer.taxId,
  WAITRON_PRODUCER_ADDRESS: testProducer.address,
};

const SIGNING = ["--version", "1.0.0", "--place", "Elche", "--date", "2026-10-22"];

let real: string;
let unblocked: string;

beforeEach(async () => {
  real = await mkdtemp(join(tmpdir(), "declaration-real-"));
  unblocked = await mkdtemp(join(tmpdir(), "declaration-unblocked-"));
  for (const root of [real, unblocked]) {
    await cp(join(PACKAGE, "declarations"), join(root, "declarations"), { recursive: true });
  }
  const template = join(unblocked, "declarations/template.md");
  const text = await readFile(template, "utf8");
  await writeFile(template, text.replace(/^<!-- release-blocker: .* -->\n/gm, ""));
});

afterEach(async () => {
  await rm(real, { recursive: true, force: true });
  await rm(unblocked, { recursive: true, force: true });
});

async function run(root: string, argv: string[], env: Record<string, string> = PRODUCER_ENV) {
  let stdout = "";
  let stderr = "";
  const status = await runDeclarationCommand(argv, {
    root,
    env,
    stdout: (text) => (stdout += text),
    stderr: (text) => (stderr += text),
  });
  return { status, stdout, stderr };
}

function code(stderr: string): string | undefined {
  return stderr.trim().split("\n").at(-1)?.split(" ")[0];
}

describe("runDeclarationCommand", () => {
  it("prints a refusal's code and params to stderr and answers 1", async () => {
    const result = await run(real, ["show", ...SIGNING], {});

    expect(result).toEqual({
      status: 1,
      stdout: "",
      stderr: 'declaration.release_blocked {"count":2}\n',
    });
  });

  it("shows a draft with the producer's values and every blocker", async () => {
    const result = await run(real, ["show", "--draft", ...SIGNING]);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("DECLARACIÓN RESPONSABLE");
    expect(result.stdout).toContain("00000000T");
    expect(result.stdout).toContain("Elche – España");
    const blockers = result.stderr.trim().split("\n");
    expect(blockers).toHaveLength(2);
    expect(blockers[0]).toMatch(/^release-blocker: Item 1\.d\)/);
    expect(blockers[1]).toMatch(/^release-blocker: A940 slice 4/);
  });

  it("writes a version that check accepts, leaving the producer's slots", async () => {
    const library = JSON.parse(
      readFileSync(join(PACKAGE, "node_modules/@waitron/verifactu/package.json"), "utf8"),
    ) as { version: string };

    expect((await run(unblocked, ["write", ...SIGNING], {})).status).toBe(0);
    const written = await readFile(join(unblocked, "declarations/v1.0.0.md"), "utf8");
    expect(written).toContain("‹NIF›");
    expect(written).toContain(`(versión ${library.version})`);
    expect(await run(unblocked, ["check", "--version", "1.0.0"], {})).toMatchObject({
      status: 0,
    });
  });

  it("refuses a written version whose 1.a has been edited", async () => {
    await run(unblocked, ["write", ...SIGNING]);
    const file = join(unblocked, "declarations/v1.0.0.md");
    const text = await readFile(file, "utf8");
    await writeFile(file, text.replace(/(\*\*1\.a\)[^*]*\*\*)\s*Waitron/, "$1\nOtro"));

    const result = await run(unblocked, ["check", "--version", "1.0.0"]);

    expect(result.status).toBe(1);
    expect(result.stderr).toBe('declaration.disagrees {"item":"1.a"}\n');
  });

  it("refuses a written version that still carries a blocker", async () => {
    const template = await readFile(join(real, "declarations/template.md"), "utf8");
    await writeFile(join(real, "declarations/v1.0.0.md"), template);

    expect(code((await run(real, ["check", "--version", "1.0.0"])).stderr)).toBe(
      "declaration.release_blocked",
    );
  });

  it("refuses to write while a blocker remains", async () => {
    const result = await run(real, ["write", ...SIGNING]);

    expect(code(result.stderr)).toBe("declaration.release_blocked");
  });

  it("takes a place with accents and an apostrophe whole", async () => {
    const result = await run(unblocked, [
      "show",
      "--version",
      "1.0.0",
      "--place",
      "L'Alfàs del Pi",
      "--date",
      "2026-10-22",
    ]);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("L'Alfàs del Pi – España");
  });

  it.each([
    ["no subcommand", [], "declaration.argument_invalid"],
    ["an unknown subcommand", ["sign", ...SIGNING], "declaration.argument_invalid"],
    [
      "an option the subcommand lacks",
      ["write", "--draft", ...SIGNING],
      "declaration.argument_invalid",
    ],
    ["a missing option", ["check"], "declaration.argument_invalid"],
    [
      "a version with a leading zero",
      ["check", "--version", "1.01.0"],
      "declaration.argument_invalid",
    ],
    [
      "a version with a suffix",
      ["check", "--version", "1.0.0-rc.1"],
      "declaration.argument_invalid",
    ],
    [
      "an empty place",
      ["show", "--version", "1.0.0", "--place", " ", "--date", "2026-10-22"],
      "declaration.argument_invalid",
    ],
    [
      "a place with a line break",
      ["show", "--version", "1.0.0", "--place", "A\nB", "--date", "2026-10-22"],
      "declaration.argument_invalid",
    ],
    [
      "a place holding a slot",
      ["show", "--version", "1.0.0", "--place", "‹x›", "--date", "2026-10-22"],
      "declaration.argument_invalid",
    ],
    [
      "a place holding bold markup",
      ["show", "--version", "1.0.0", "--place", "A**B", "--date", "2026-10-22"],
      "declaration.argument_invalid",
    ],
    [
      "a date in another form",
      ["show", "--version", "1.0.0", "--place", "Elche", "--date", "22/10/2026"],
      "declaration.date_invalid",
    ],
  ])("refuses %s before reading any blocker", async (_name, argv, expected) => {
    const result = await run(real, argv);

    expect(result.status).toBe(1);
    expect(code(result.stderr)).toBe(expected);
  });

  it("lets an error that is not a refusal through", async () => {
    await expect(run(real, ["check", "--version", "9.9.9"])).rejects.toMatchObject({
      code: "ENOENT",
    });
  });
});

describe("nodeIo", () => {
  it("names the package folder and process.env, and writes to the process's streams", () => {
    const out = vi.spyOn(process.stdout, "write").mockReturnValue(true);
    const err = vi.spyOn(process.stderr, "write").mockReturnValue(true);
    try {
      const io = nodeIo();
      io.stdout("to stdout");
      io.stderr("to stderr");

      expect(io.root).toBe(PACKAGE.replace(/\/$/, ""));
      expect(io.env).toBe(process.env);
      expect(out).toHaveBeenCalledWith("to stdout");
      expect(err).toHaveBeenCalledWith("to stderr");
    } finally {
      out.mockRestore();
      err.mockRestore();
    }
  });
});
