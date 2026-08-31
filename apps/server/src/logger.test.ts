import { describe, expect, it } from "vitest";
import { createLogger, LOG_LEVELS, type LogLevel } from "./logger.js";

const AT = new Date("2026-07-26T09:14:02.000Z");

describe("createLogger", () => {
  it("writes one JSON line per event, newline-terminated", () => {
    const lines: string[] = [];
    const log = createLogger(
      (line) => lines.push(line),
      () => AT,
    );

    log("info", "pass.complete", { sleepMs: 3600000, nextDueAt: null });

    expect(lines).toHaveLength(1);
    expect(lines[0]!.endsWith("\n")).toBe(true);
    expect(JSON.parse(lines[0]!)).toEqual({
      at: "2026-07-26T09:14:02.000Z",
      level: "info",
      event: "pass.complete",
      sleepMs: 3600000,
      nextDueAt: null,
    });
  });

  it("carries no fields when none are given", () => {
    const lines: string[] = [];
    createLogger(
      (line) => lines.push(line),
      () => AT,
    )("warn", "duty.failed");
    expect(JSON.parse(lines[0]!)).toEqual({
      at: "2026-07-26T09:14:02.000Z",
      level: "warn",
      event: "duty.failed",
    });
  });

  it("does not let a field overwrite at/level/event", () => {
    const lines: string[] = [];
    createLogger(
      (line) => lines.push(line),
      () => AT,
    )("error", "real.event", {
      event: "spoofed",
      level: "info",
    });
    const parsed = JSON.parse(lines[0]!) as Record<string, unknown>;
    expect(parsed.event).toBe("real.event");
    expect(parsed.level).toBe("error");
  });
});

describe("createLogger level filtering", () => {
  const at = () => new Date("2026-08-31T10:00:00.000Z");

  it("drops events below the default info threshold", () => {
    const lines: string[] = [];
    const log = createLogger((l) => lines.push(l), at);
    log("debug", "noisy");
    log("info", "kept");
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0]!).event).toBe("kept");
  });

  it("emits debug when the threshold source returns debug", () => {
    const lines: string[] = [];
    let level: LogLevel = "info";
    const log = createLogger(
      (l) => lines.push(l),
      at,
      () => level,
    );
    log("debug", "before");
    level = "debug";
    log("debug", "after");
    expect(lines.map((l) => JSON.parse(l).event)).toEqual(["after"]);
  });

  it("orders levels debug < info < warn < error", () => {
    expect(LOG_LEVELS.debug).toBeLessThan(LOG_LEVELS.info);
    expect(LOG_LEVELS.info).toBeLessThan(LOG_LEVELS.warn);
    expect(LOG_LEVELS.warn).toBeLessThan(LOG_LEVELS.error);
  });
});
