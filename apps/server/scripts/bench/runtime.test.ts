import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { describeRuntime, runtime } from "./runtime.js";

describe("runtime", () => {
  it("names this process's Node, the SQLite node:sqlite runs and whether it has STAT4", () => {
    const db = new DatabaseSync(":memory:");
    try {
      const { version } = db.prepare("select sqlite_version() as version").get() as {
        version: string;
      };
      const options = (
        db.prepare("pragma compile_options").all() as { compile_options: string }[]
      ).map((row) => row.compile_options);

      expect(runtime()).toEqual({
        node: process.version,
        sqlite: version,
        sqliteStat4: options.includes("ENABLE_STAT4"),
      });
    } finally {
      db.close();
    }
  });

  it.each([
    [true, "Node v26.13.0, SQLite 3.54.1 with STAT4"],
    [false, "Node v26.13.0, SQLite 3.54.0 without STAT4"],
  ])("describes STAT4 %s in words", (sqliteStat4, words) => {
    const sqlite = sqliteStat4 ? "3.54.1" : "3.54.0";
    expect(describeRuntime({ node: "v26.13.0", sqlite, sqliteStat4 })).toBe(words);
  });
});
