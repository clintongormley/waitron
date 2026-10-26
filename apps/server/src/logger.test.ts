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

describe("createLogger personal data", () => {
  const at = AT.toISOString();
  function writeLine(fields: Record<string, unknown>, event = "x"): string {
    const lines: string[] = [];
    createLogger(
      (line) => lines.push(line),
      () => AT,
    )("warn", event, fields);
    return lines[0]!;
  }

  it.each([
    "email",
    "displayName",
    "ownerName",
    "editorName",
    "holderPersonName",
    "person",
    "supplierTaxId",
    "legalName",
    "taxId",
    "idEmisorFactura",
    "todayName",
  ])("masks %s", (key) => {
    const line = writeLine({ [key]: "Marta Soler" });
    expect(JSON.parse(line)).toEqual({ [key]: "***", at, level: "warn", event: "x" });
    expect(line).not.toContain("Marta Soler");
  });

  it("masks a listed key nested in objects and arrays", () => {
    const line = writeLine({
      edit: { editorName: "Marta Soler", editorVersion: 3 },
      conflicts: [{ editorName: "Jordi Puig" }],
    });
    expect(JSON.parse(line)).toEqual({
      edit: { editorName: "***", editorVersion: 3 },
      conflicts: [{ editorName: "***" }],
      at,
      level: "warn",
      event: "x",
    });
    expect(line).not.toContain("Marta Soler");
    expect(line).not.toContain("Jordi Puig");
  });

  it("keeps null under a listed key and the names of things", () => {
    const fields = {
      ownerName: null,
      name: "Patio",
      label: "T4",
      holderDeviceName: "Bar till",
      locationName: "Bar del Port",
      personId: "p1",
      ownerId: "p2",
    };
    expect(JSON.parse(writeLine(fields))).toEqual({ ...fields, at, level: "warn", event: "x" });
  });

  it("masks a non-string value under a listed key", () => {
    expect(JSON.parse(writeLine({ person: { id: "p1" } }))).toEqual({
      person: "***",
      at,
      level: "warn",
      event: "x",
    });
  });

  it("never masks at, level or event, even an event named email", () => {
    expect(JSON.parse(writeLine({}, "email"))).toEqual({ at, level: "warn", event: "email" });
  });

  it("masks a merchant's name under merchants and only there", () => {
    const first = writeLine({
      merchants: [
        { code: "MC1", name: "Jordi Puig Ferrer" },
        { code: "MC2", name: null },
      ],
      name: "Patio",
      other: { merchants: "Jordi Puig Ferrer" },
    });
    expect(JSON.parse(first)).toEqual({
      merchants: [
        { code: "MC1", name: "***" },
        { code: "MC2", name: null },
      ],
      name: "Patio",
      other: { merchants: "Jordi Puig Ferrer" },
      at,
      level: "warn",
      event: "x",
    });

    const second = writeLine({
      merchants: [{ code: "MC1", name: "Jordi Puig Ferrer", email: "jordi.puig@example.test" }],
    });
    expect(JSON.parse(second)).toEqual({
      merchants: [{ code: "MC1", name: "***", email: "***" }],
      at,
      level: "warn",
      event: "x",
    });
    expect(second).not.toContain("Jordi Puig");
  });

  it("keeps a merchants element that is not an object as it is", () => {
    expect(JSON.parse(writeLine({ merchants: ["Jordi Puig Ferrer", null, ["MC1"]] }))).toEqual({
      merchants: ["Jordi Puig Ferrer", null, ["MC1"]],
      at,
      level: "warn",
      event: "x",
    });
  });
});
