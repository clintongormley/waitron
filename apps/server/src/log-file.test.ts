import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createLogReader, createRotatingFileSink, tee } from "./log-file.js";

describe("rotating file sink", () => {
  const dirs: string[] = [];
  const mkdir = () => {
    const d = mkdtempSync(join(tmpdir(), "diag-"));
    dirs.push(d);
    return d;
  };
  afterEach(() => {
    for (const d of dirs) rmSync(d, { recursive: true, force: true });
    dirs.length = 0;
  });

  it("appends lines to the current file", () => {
    const dir = mkdir();
    const sink = createRotatingFileSink({ dir, maxBytes: 1000, maxFiles: 3 });
    sink("a\n");
    sink("b\n");
    expect(readFileSync(join(dir, "waitron.log"), "utf8")).toBe("a\nb\n");
  });

  it("rotates when the size cap is exceeded and prunes to maxFiles", () => {
    const dir = mkdir();
    const sink = createRotatingFileSink({ dir, maxBytes: 8, maxFiles: 2 });
    sink("1234567\n"); // 8 bytes → fills current
    sink("aaa\n"); // triggers rotate → waitron.log.1 holds the first line
    sink("bbb\n");
    sink("ccc\n"); // more rotations; only current + maxFiles rotated kept
    const files = readdirSync(dir).sort();
    // current + at most maxFiles rotated
    expect(files.filter((f) => f.startsWith("waitron.log")).length).toBeLessThanOrEqual(3);
    expect(files).toContain("waitron.log");
    expect(files).not.toContain("waitron.log.3");
  });

  it("degrades to a no-op (never throws) when the directory is unwritable", () => {
    const errors: unknown[] = [];
    const sink = createRotatingFileSink(
      { dir: "/nonexistent/definitely/not/writable", maxBytes: 10, maxFiles: 2 },
      (e) => errors.push(e),
    );
    expect(() => {
      sink("x\n");
      sink("y\n");
    }).not.toThrow();
    expect(errors.length).toBeGreaterThanOrEqual(1); // reported once
  });

  it("never throws even when onError itself throws", () => {
    const sink = createRotatingFileSink(
      { dir: "/nonexistent/definitely/not/writable", maxBytes: 10, maxFiles: 2 },
      () => {
        throw new Error("onError blew up");
      },
    );
    expect(() => sink("x\n")).not.toThrow();
  });

  it("tee fans a line to every sink", () => {
    const a: string[] = [];
    const b: string[] = [];
    const t = tee(
      (l) => a.push(l),
      (l) => b.push(l),
    );
    t("hi\n");
    expect(a).toEqual(["hi\n"]);
    expect(b).toEqual(["hi\n"]);
  });
});

describe("log reader", () => {
  const dirs: string[] = [];
  const mkdir = () => {
    const d = mkdtempSync(join(tmpdir(), "diag-r-"));
    dirs.push(d);
    return d;
  };
  afterEach(() => {
    for (const d of dirs) rmSync(d, { recursive: true, force: true });
    dirs.length = 0;
  });

  it("returns the most recent N events across rotated files, oldest first", () => {
    const dir = mkdir();
    const sink = createRotatingFileSink({ dir, maxBytes: 30, maxFiles: 5 });
    for (let i = 0; i < 10; i++)
      sink(`${JSON.stringify({ at: `t${i}`, level: "info", event: `e${i}` })}\n`);
    const reader = createLogReader({ dir, maxFiles: 5 });
    const recent = reader.recent({ limit: 3 });
    expect(recent.map((e) => e.event)).toEqual(["e7", "e8", "e9"]);
  });

  it("filters by request ids", () => {
    const dir = mkdir();
    const sink = createRotatingFileSink({ dir, maxBytes: 10_000, maxFiles: 2 });
    sink(
      `${JSON.stringify({ at: "t1", level: "info", event: "http.request", requestId: "r1" })}\n`,
    );
    sink(
      `${JSON.stringify({ at: "t2", level: "info", event: "http.request", requestId: "r2" })}\n`,
    );
    const reader = createLogReader({ dir, maxFiles: 2 });
    expect(reader.byRequestIds(["r2"]).map((e) => e.requestId)).toEqual(["r2"]);
  });

  it("returns [] when no log file exists yet", () => {
    expect(createLogReader({ dir: mkdir(), maxFiles: 2 }).recent()).toEqual([]);
  });

  it("skips unparseable lines rather than throwing", () => {
    const dir = mkdir();
    const sink = createRotatingFileSink({ dir, maxBytes: 10_000, maxFiles: 2 });
    sink("not json\n");
    sink(`${JSON.stringify({ at: "t", level: "info", event: "ok" })}\n`);
    expect(
      createLogReader({ dir, maxFiles: 2 })
        .recent()
        .map((e) => e.event),
    ).toEqual(["ok"]);
  });
});
