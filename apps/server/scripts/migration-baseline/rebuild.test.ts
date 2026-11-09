import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  EPOCH_FILE,
  rebuildBaseline,
  readTriggers,
  splitStatements,
  updateEpochText,
  type Generate,
  type RebuildSet,
} from "./rebuild.js";

const SQL = "CREATE TABLE x (id integer, value text);";
const TRIGGER = "CREATE TRIGGER x_guard BEFORE INSERT ON x BEGIN SELECT RAISE(ABORT, 'no'); END;";
const scratch: string[] = [];
afterEach(() => {
  for (const dir of scratch.splice(0)) rmSync(dir, { recursive: true, force: true });
});
const hash = (text: string) => createHash("sha256").update(text).digest("hex");
function put(file: string, text: string) {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, text);
}
function json(file: string, value: unknown) {
  put(file, JSON.stringify(value, null, 2));
}
function journal(when = 1000) {
  return {
    version: "7",
    dialect: "sqlite",
    entries: [{ idx: 0, version: "6", tag: "0000_baseline", when, breakpoints: true }],
  };
}
function snapshot(id = "old", tables: unknown = { x: { columns: { id: {} } } }) {
  return { id, prevId: "", version: "6", dialect: "sqlite", tables };
}
function fixture(name = "core", empty = false) {
  const root = mkdtempSync(join(tmpdir(), "wt-rebuild-test-"));
  scratch.push(root);
  const set: RebuildSet = { name, folder: join(root, "drizzle"), packageDir: root };
  const epochFile = join(root, "epoch.json");
  json(epochFile, {
    version: 1,
    entries: empty ? [] : [{ name, tag: "0000_baseline", when: 1000, sha256: hash("old SQL") }],
    emptySets: empty ? [name] : [],
  });
  json(
    join(set.folder, "meta/_journal.json"),
    empty ? { version: "7", dialect: "sqlite", entries: [] } : journal(),
  );
  if (!empty) {
    put(join(set.folder, "0000_baseline.sql"), "old SQL");
    json(join(set.folder, "meta/0000_snapshot.json"), snapshot());
  }
  const generate = vi.fn<Generate>(async ({ outDir }) => {
    json(
      join(outDir, "meta/_journal.json"),
      empty ? { version: "7", dialect: "sqlite", entries: [] } : journal(1500),
    );
    if (!empty) {
      put(join(outDir, "0000_baseline.sql"), SQL);
      json(join(outDir, "meta/0000_snapshot.json"), snapshot("new"));
    }
    return {
      status: 0,
      signal: null,
      error: undefined,
      stdout: empty ? "No schema changes, nothing to migrate" : "Your SQL migration file",
      stderr: "",
    };
  });
  return { set, epochFile, generate };
}
function bytes(f: ReturnType<typeof fixture>) {
  return [
    readFileSync(f.epochFile, "utf8"),
    ...readdirSync(f.set.folder, { recursive: true, withFileTypes: true })
      .filter((e) => e.isFile())
      .map((e) => [
        join(e.parentPath, e.name).slice(f.set.folder.length),
        readFileSync(join(e.parentPath, e.name), "utf8"),
      ])
      .sort(),
  ];
}
function fold(f: ReturnType<typeof fixture>, tag = "0001_more") {
  const j = journal();
  j.entries.push({ idx: 1, version: "6", tag, when: 2000, breakpoints: true });
  json(join(f.set.folder, "meta/_journal.json"), j);
  put(
    join(f.set.folder, `${tag}.sql`),
    "ALTER TABLE x ADD value text;--> statement-breakpoint\nALTER TABLE x ADD other text;",
  );
  json(join(f.set.folder, "meta/0001_snapshot.json"), {
    ...snapshot("next", { x: { columns: { id: {}, value: {}, other: {} } } }),
    prevId: "old",
  });
}

describe("rebuilding starting migrations", () => {
  it.each(["core", "payments"])("rebuilds %s and appends its hand-written SQL", async (name) => {
    const f = fixture(name);
    put(join(f.set.packageDir, `triggers/${name}.sql`), TRIGGER + "\n");
    const result = await rebuildBaseline(f);
    expect(result.outcome).toBe("rebuilt");
    expect(readFileSync(join(f.set.folder, "0000_baseline.sql"), "utf8")).toBe(
      SQL + "\n--> statement-breakpoint\n" + TRIGGER,
    );
    expect(readdirSync(join(f.set.folder, "meta")).sort()).toEqual([
      "0000_snapshot.json",
      "_journal.json",
    ]);
    expect(JSON.parse(readFileSync(f.epochFile, "utf8")).entries[0]).toEqual({
      name,
      tag: "0000_baseline",
      when: 1500,
      sha256: hash(SQL + "\n--> statement-breakpoint\n" + TRIGGER),
    });
  });
  it("a second run changes no byte despite different generated ids and dates", async () => {
    const f = fixture();
    await rebuildBaseline(f);
    const before = bytes(f);
    const generate: Generate = async (input) => {
      const run = await f.generate(input);
      json(join(input.outDir, "meta/_journal.json"), journal(9999));
      json(join(input.outDir, "meta/0000_snapshot.json"), snapshot("another"));
      return run;
    };
    expect(await rebuildBaseline({ ...f, generate })).toMatchObject({
      outcome: "unchanged",
      differences: [],
    });
    expect(bytes(f)).toEqual(before);
  });
  it("check mode reports a changed trigger and writes nothing", async () => {
    const f = fixture();
    await rebuildBaseline(f);
    put(join(f.set.packageDir, "triggers/core.sql"), TRIGGER);
    const before = bytes(f);
    expect(await rebuildBaseline({ ...f, mode: "check" })).toMatchObject({
      outcome: "rebuilt",
      differences: expect.arrayContaining(["0000_baseline.sql differs"]),
    });
    expect(bytes(f)).toEqual(before);
  });
  it.each(["check", "write"] as const)(
    "%s mode corrects only the epoch when files match",
    async (mode) => {
      const f = fixture();
      await rebuildBaseline(f);
      const before = bytes(f);
      put(f.epochFile, readFileSync(f.epochFile, "utf8").replace(hash(SQL), "0".repeat(64)));
      const corrupt = bytes(f);
      expect(await rebuildBaseline({ ...f, mode })).toMatchObject({
        outcome: "epoch-only",
        differences: ["epoch sha256 differs"],
      });
      expect(bytes(f)).toEqual(mode === "check" ? corrupt : before);
    },
  );
  it("checks the whole snapshot while ignoring only its random id", async () => {
    const f = fixture();
    await rebuildBaseline(f);
    json(join(f.set.folder, "meta/0000_snapshot.json"), snapshot("another"));
    expect((await rebuildBaseline({ ...f, mode: "check" })).outcome).toBe("unchanged");
    json(join(f.set.folder, "meta/0000_snapshot.json"), snapshot("another", {}));
    const before = bytes(f);
    expect(await rebuildBaseline({ ...f, mode: "check" })).toMatchObject({
      outcome: "rebuilt",
      differences: ["meta/0000_snapshot.json differs"],
    });
    expect(bytes(f)).toEqual(before);
  });
  it.each(["0001_x.sql", "meta/0001_snapshot.json", "notes.txt", "journal"])(
    "refuses %s before generating",
    async (extra) => {
      const f = fixture();
      if (extra === "journal") fold(f);
      else put(join(f.set.folder, extra), "stray");
      const before = bytes(f);
      await expect(rebuildBaseline(f)).rejects.toThrow(/not the starting migration|journal/);
      expect(f.generate).not.toHaveBeenCalled();
      expect(bytes(f)).toEqual(before);
    },
  );
  it.each([1500, 5000])(
    "folds a generated migration and dates it after previous entries (%i)",
    async (generatedWhen) => {
      const f = fixture();
      fold(f);
      const generate: Generate = async (input) => {
        const run = await f.generate(input);
        json(join(input.outDir, "meta/_journal.json"), journal(generatedWhen));
        return run;
      };
      const result = await rebuildBaseline({ ...f, generate, foldGenerated: "0001_more" });
      expect(result.when).toBe(generatedWhen === 1500 ? 2001 : 5000);
      expect(readdirSync(f.set.folder).sort()).toEqual(["0000_baseline.sql", "meta"]);
      expect(readdirSync(join(f.set.folder, "meta")).sort()).toEqual([
        "0000_snapshot.json",
        "_journal.json",
      ]);
    },
  );
  it.each([
    ["unchanged", "does not change the schema"],
    ["trigger", "holds a CREATE TRIGGER"],
    ["prevId", "prevId"],
    ["missing", "snapshot"],
    ["baseline", "0000_baseline"],
    ["not last", "last entry"],
  ])("refuses a fold with %s", async (bad, message) => {
    const f = fixture();
    fold(f);
    let tag = "0001_more";
    if (bad === "unchanged")
      json(join(f.set.folder, "meta/0001_snapshot.json"), { ...snapshot("next"), prevId: "old" });
    if (bad === "trigger") put(join(f.set.folder, `${tag}.sql`), TRIGGER.toLowerCase());
    if (bad === "prevId")
      json(join(f.set.folder, "meta/0001_snapshot.json"), {
        ...snapshot("next", {}),
        prevId: "wrong",
      });
    if (bad === "missing") rmSync(join(f.set.folder, "meta/0001_snapshot.json"));
    if (bad === "baseline") tag = "0000_baseline";
    if (bad === "not last") {
      const j = journal();
      j.entries.push(
        { idx: 1, version: "6", tag, when: 2000, breakpoints: true },
        { idx: 2, version: "6", tag: "0002_more", when: 3000, breakpoints: true },
      );
      json(join(f.set.folder, "meta/_journal.json"), j);
    }
    const before = bytes(f);
    await expect(rebuildBaseline({ ...f, foldGenerated: tag })).rejects.toThrow(message);
    expect(bytes(f)).toEqual(before);
  });
  it.each(["import", "prompt", "exit", "no SQL", "extra"])(
    "leaves everything unchanged when generation fails: %s",
    async (failure) => {
      const f = fixture();
      const before = bytes(f);
      const generate: Generate = async (input) => {
        const run = await f.generate(input);
        if (failure === "import") return { ...run, stdout: "Error: schema import failed" };
        if (failure === "prompt") return { ...run, stdout: "Interactive prompts require a TTY" };
        if (failure === "exit") return { ...run, status: 1 };
        if (failure === "no SQL") rmSync(join(input.outDir, "0000_baseline.sql"));
        if (failure === "extra") put(join(input.outDir, "notes.txt"), "stray");
        return run;
      };
      await expect(rebuildBaseline({ ...f, generate })).rejects.toThrow(
        failure === "no SQL"
          ? /generated nothing/
          : failure === "extra"
            ? /notes.txt/
            : /did not report finishing/,
      );
      expect(bytes(f)).toEqual(before);
    },
  );
  it.each([
    [
      TRIGGER + "\n--> statement-breakpoint\nCREATE TABLE y(id);",
      "statement 2 is not a CREATE TRIGGER",
    ],
    [
      TRIGGER + "\n--> statement-breakpoint\n\n--> statement-breakpoint\n" + TRIGGER,
      "statement 2 is empty",
    ],
    [TRIGGER + "\n--> statement-breakpoint\n" + TRIGGER, "defined twice"],
    ["", "holds no CREATE TRIGGER"],
  ])("refuses invalid hand-written SQL (%s)", (sql, message) => {
    const f = fixture();
    const file = join(f.set.packageDir, "triggers/core.sql");
    put(file, sql);
    expect(() => readTriggers(file)).toThrow(message);
  });
  it("accepts lower-case triggers and refuses an unexpected trigger file", async () => {
    const f = fixture();
    const file = join(f.set.packageDir, "triggers/core.sql");
    expect(readTriggers(file)).toBeNull();
    put(file, TRIGGER.toLowerCase() + "\n");
    expect(readTriggers(file)).toBe(TRIGGER.toLowerCase());
    put(join(f.set.packageDir, "triggers/other.sql"), TRIGGER);
    const before = bytes(f);
    await expect(rebuildBaseline(f)).rejects.toThrow("unexpected file");
    expect(bytes(f)).toEqual(before);
  });
  it("splits both breakpoint forms without losing empty statements", () => {
    expect(splitStatements("a;--> statement-breakpoint\nb;\n--> statement-breakpoint\nc;")).toEqual(
      ["a;", "b;", "c;"],
    );
  });
  it("refuses sets absent from the epoch before generating", async () => {
    const f = fixture();
    json(f.epochFile, { entries: [], emptySets: [] });
    const before = bytes(f);
    await expect(rebuildBaseline(f)).rejects.toThrow("has no entry");
    expect(f.generate).not.toHaveBeenCalled();
    expect(bytes(f)).toEqual(before);
  });
  it("keeps an empty set empty", async () => {
    const f = fixture("fiscal-none", true);
    const before = bytes(f);
    expect(await rebuildBaseline(f)).toMatchObject({
      outcome: "unchanged",
      differences: [],
      when: null,
      sha256: null,
    });
    expect(bytes(f)).toEqual(before);
  });
  it("detects a hand-edited journal, including in an empty set", async () => {
    for (const empty of [false, true]) {
      const f = fixture(empty ? "fiscal-none" : "core", empty);
      await rebuildBaseline(f);
      const file = join(f.set.folder, "meta/_journal.json");
      put(file, readFileSync(file, "utf8").replace('"version": "7"', '"version": "8"'));
      const before = bytes(f);
      expect(await rebuildBaseline({ ...f, mode: "check" })).toMatchObject({
        outcome: "rebuilt",
        differences: expect.arrayContaining(["meta/_journal.json differs"]),
      });
      expect(bytes(f)).toEqual(before);
      await rebuildBaseline(f);
      expect(readFileSync(file, "utf8")).toContain('"version": "7"');
    }
  });
  it("refuses an empty set whose schema declares tables", async () => {
    const f = fixture("fiscal-none", true);
    const before = bytes(f);
    const generate: Generate = async (input) => {
      const run = await f.generate(input);
      put(join(input.outDir, "0000_baseline.sql"), SQL);
      return run;
    };
    await expect(rebuildBaseline({ ...f, generate })).rejects.toThrow("declares tables");
    expect(bytes(f)).toEqual(before);
  });
  it("updates only the named epoch's two values, preserving layout", () => {
    const text = readFileSync(EPOCH_FILE, "utf8");
    const changed = updateEpochText(text, "core", 123, "a".repeat(64));
    expect(changed.split("\n").filter((line, i) => line !== text.split("\n")[i])).toEqual([
      '      "when": 123,',
      '      "sha256": "' + "a".repeat(64) + '"',
    ]);
    expect(() => updateEpochText(text, "absent", 123, "a".repeat(64))).toThrow("has no entry");
  });
});
