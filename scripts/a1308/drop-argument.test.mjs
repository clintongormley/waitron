import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { expect, it, vi } from "vitest";
import { main, transformSources } from "./drop-argument.mjs";

const declaration = "export function advance(tx, cfg, id) { void cfg; return id; }";
const targets = new Map([["advance", 1]]);
const transform = (body, declared = declaration, path = "caller.ts") =>
  transformSources(
    new Map([
      ["writer.ts", declared],
      [path, body],
    ]),
    "writer.ts",
    targets,
  );

it("removes the discarded parameter and matching bare and property call arguments", () => {
  const result = transform("advance(tx, cfg, id); api.advance(tx, cfg, id);");
  expect(result.sources.get("writer.ts")).toBe("export function advance(tx, id) {  return id; }");
  expect(result.sources.get("caller.ts")).toBe("advance(tx, id); api.advance(tx, id);");
  expect(result.report).toEqual([]);
});

it("keeps comments on the argument that follows the removed argument", () => {
  const result = transform("advance(tx, cfg, /* the order */ id);");
  expect(result.sources.get("caller.ts")).toBe("advance(tx, /* the order */ id);");
});

it("leaves spreads, short calls, value uses and object members for hand editing", () => {
  const source = "advance(...args); advance(tx); consume(advance); const o = { advance: other };";
  const result = transform(source);
  expect(result.sources.get("caller.ts")).toBe(source);
  expect(result.report).toEqual([
    "caller.ts:1: advance: spread argument",
    "caller.ts:1: advance: too few arguments",
    "caller.ts:1: advance: used as a value",
    "caller.ts:1: advance: object member",
  ]);
});

it("leaves named imports alone and reports an aliased export", () => {
  const result = transform('import { advance } from "./writer.js"; export { advance as move };');
  expect(result.report).toEqual(["caller.ts:1: advance: used as a value"]);
});

it("does not remove another argument when run on its own output", () => {
  const first = transform("advance(tx, cfg, id);");
  const second = transformSources(first.sources, "writer.ts", targets);
  expect(second.sources).toEqual(first.sources);
  expect(second.report).toEqual([]);
});

it.each(["write-path.e2e", "inmutabilidad"])("never rewrites the protected %s file", (name) => {
  const path = `packages/fiscal-verifactu/src/${name}.test.ts`;
  const result = transform("advance(tx, cfg, id);", declaration, path);
  expect(result.sources.get(path)).toBe("advance(tx, cfg, id);");
  expect(result.report).toContain(`${path}: fiscal pair file: never rewritten`);
});

it("removes a last parameter and its whole-line discard without leaving a comma", () => {
  const result = transform(
    "advance(tx, cfg);",
    "function advance(tx, cfg) {\n  void cfg;\n  return tx;\n}\n",
  );
  expect(result.sources.get("writer.ts")).toBe("function advance(tx) {\n  return tx;\n}\n");
  expect(result.sources.get("caller.ts")).toBe("advance(tx);");
});

it.each(["", ","])("removes a sole argument with trailing punctuation %j", (comma) => {
  const writer = `function advance(cfg${comma}) { void cfg; return 1; }\nfunction other() { return 2; }`;
  const result = transformSources(
    new Map([
      ["writer.ts", writer],
      ["caller.ts", `advance(cfg${comma}); other();`],
    ]),
    "writer.ts",
    new Map([["advance", 0]]),
  );
  expect(result.sources.get("writer.ts")).toBe(
    "function advance() {  return 1; }\nfunction other() { return 2; }",
  );
  expect(result.sources.get("caller.ts")).toBe("advance(); other();");
});

it.each([[], ["--call", "advance#1"], ["--call", "advance#1", "--declared-in", "writer.ts"]])(
  "refuses incomplete command arguments %j",
  (args) => {
    expect(() => main(args)).toThrow("usage:");
  },
);

it.each(["advance#bad", "#1"])("refuses malformed argument selection %s", (call) => {
  expect(() => main(["--call", call, "--declared-in", "writer.ts", "writer.ts"])).toThrow(
    "call must be name#index",
  );
});

it("runs the command as a dry run, writes only with --write, and then changes nothing", () => {
  const dir = mkdtempSync(join(tmpdir(), "drop-argument-"));
  const log = vi.spyOn(console, "log").mockImplementation(() => {});
  try {
    const writer = join(dir, "writer.ts");
    const caller = join(dir, "caller.ts");
    writeFileSync(writer, declaration);
    writeFileSync(caller, "advance(tx, cfg, id);");
    const args = [
      "scripts/a1308/drop-argument.mjs",
      "--call",
      "advance#1",
      "--declared-in",
      writer,
      writer,
      caller,
    ];
    const run = (...extra) =>
      spawnSync(process.execPath, [...args, ...extra], { encoding: "utf8" });
    const dry = run();
    expect(dry.status, dry.stderr).toBe(0);
    expect(JSON.parse(dry.stdout).changed).toEqual([writer, caller]);
    expect(readFileSync(caller, "utf8")).toBe("advance(tx, cfg, id);");
    main([...args.slice(1), "--write"]);
    expect(readFileSync(caller, "utf8")).toBe("advance(tx, id);");
    main(args.slice(1));
    expect(JSON.parse(log.mock.calls.at(-1)[0]).changed).toEqual([]);
  } finally {
    log.mockRestore();
    rmSync(dir, { recursive: true, force: true });
  }
});
