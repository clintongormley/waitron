import { describe, expect, it } from "vitest";
import {
  maskPersonalData,
  PERSONAL_LOG_KEYS,
  PERSONAL_LOG_PATHS,
  stringifyMasked,
} from "./log-personal-data.js";
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
    ["email", "martha.spencer@example.test", "m***r@e***e.test"],
    ["displayName", "Martha Spencer", "M***a S***r"],
    ["ownerName", "Martha Spencer", "M***a S***r"],
    ["editorName", "Martha Spencer", "M***a S***r"],
    ["holderPersonName", "Martha Spencer", "M***a S***r"],
    ["person", "Martha Spencer", "M***a S***r"],
    ["supplierTaxId", "12345678Z", "1***Z"],
    ["legalName", "Jamie King Foster", "J***e K***g F***r"],
    ["taxId", "12345678Z", "1***Z"],
    ["idEmisorFactura", "12345678Z", "1***Z"],
    ["todayName", "Spencer", "S***r"],
  ])("masks %s %j as %j", (key, value, masked) => {
    const line = writeLine({ [key]: value });
    expect(JSON.parse(line)).toEqual({ [key]: masked, at, level: "warn", event: "x" });
    expect(line).not.toContain(value);
  });

  it("masks a listed key nested in objects and arrays", () => {
    const line = writeLine({
      edit: { editorName: "Martha Spencer", editorVersion: 3 },
      conflicts: [{ editorName: "Jamie King" }],
    });
    expect(JSON.parse(line)).toEqual({
      edit: { editorName: "M***a S***r", editorVersion: 3 },
      conflicts: [{ editorName: "J***e K***g" }],
      at,
      level: "warn",
      event: "x",
    });
    expect(line).not.toContain("Martha Spencer");
    expect(line).not.toContain("Jamie King");
  });

  it("keeps null under a listed key and the names of things", () => {
    const fields = {
      ownerName: null,
      name: "Patio",
      label: "T4",
      holderDeviceName: "Bar till",
      venueName: "Bar del Port",
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
        { code: "MC1", name: "Jamie King Foster" },
        { code: "MC2", name: null },
      ],
      name: "Patio",
      other: { merchants: "Jamie King Foster" },
    });
    expect(JSON.parse(first)).toEqual({
      merchants: [
        { code: "MC1", name: "J***e K***g F***r" },
        { code: "MC2", name: null },
      ],
      name: "Patio",
      other: { merchants: "Jamie King Foster" },
      at,
      level: "warn",
      event: "x",
    });

    const second = writeLine({
      merchants: [{ code: "MC1", name: "Jamie King Foster", email: "jamie.king@example.test" }],
    });
    expect(JSON.parse(second)).toEqual({
      merchants: [{ code: "MC1", name: "J***e K***g F***r", email: "j***g@e***e.test" }],
      at,
      level: "warn",
      event: "x",
    });
    expect(second).not.toContain("Jamie King");
    expect(second).not.toContain("jamie.king@example.test");
  });

  it("keeps a merchants element that is not an object as it is", () => {
    expect(JSON.parse(writeLine({ merchants: ["Jamie King Foster", null, ["MC1"]] }))).toEqual({
      merchants: ["Jamie King Foster", null, ["MC1"]],
      at,
      level: "warn",
      event: "x",
    });
  });
});

describe("stringifyMasked", () => {
  const cyclic: Record<string, unknown> = { id: "p1" };
  cyclic.self = cyclic;
  class Named {
    toJSON(): unknown {
      return { email: "martha.spencer@example.test", kind: "named" };
    }
  }
  const nested = Array.from({ length: 20 }, (_, i) => ({
    id: `t${i}`,
    seats: i,
    open: i % 2 === 0,
  }));
  const inputs: [string, unknown][] = [
    ["no listed key", { sleepMs: 3600000, nextDueAt: null, label: "T4", ok: true }],
    ["a nested list and no listed key", { zone: "Patio", tables: nested, count: 20 }],
    ["a listed key at the top", { email: "martha.spencer@example.test", id: 1 }],
    ["a listed key nested", { edit: { editorName: "Martha Spencer", editorVersion: 3 } }],
    ["a listed key inside an array", { conflicts: [{ editorName: "Jamie King" }, { id: 2 }] }],
    [
      "the merchants path",
      { merchants: [{ code: "MC1", name: "Jamie King Foster" }, "MC2", null] },
    ],
    ["merchants that is not a list", { merchants: "Jamie King Foster", name: "Patio" }],
    ["a string value carrying a listed key's text", { note: '{"email":"x"}', other: '"person":' }],
    ["null and undefined under listed keys", { email: null, person: undefined, taxId: null }],
    ["a BigInt under a listed key", { email: 12n, id: "p1" }],
    ["a cyclic object under a listed key", { person: cyclic }],
    ["a function and a symbol under listed keys", { email: () => "x", person: Symbol("p"), id: 1 }],
    ["a toJSON result carrying a listed key", { who: new Named() }],
    ["a toJSON value under a listed key", { person: new Named(), at: new Date(0) }],
    ["a toJSON giving undefined under a listed key", { email: { toJSON: () => undefined } }],
    ["a top-level array", [{ email: "martha.spencer@example.test" }, 1, "email"]],
    ["a string", "email"],
    ["undefined", undefined],
  ];

  it.each(inputs)("writes what the replacer writes for %s", (_label, value) => {
    expect(stringifyMasked(value)).toBe(JSON.stringify(value, maskPersonalData));
  });

  it.each([
    ["a BigInt under no listed key", { id: 12n }],
    ["a cyclic object under no listed key", { holder: cyclic }],
    ["a BigInt under merchants", { merchants: [{ name: "x", code: 1n }] }],
  ] as [string, unknown][])("throws what the replacer throws for %s", (_label, value) => {
    let expected: unknown;
    try {
      JSON.stringify(value, maskPersonalData);
    } catch (error) {
      expected = error;
    }
    expect(expected).toBeInstanceOf(TypeError);
    expect(() => stringifyMasked(value)).toThrow((expected as TypeError).message);
  });

  // A key added to the list without an entry here fails, so its rule is chosen on purpose.
  const MARTHA_SPENCER_UNDER: Record<string, string> = {
    email: "M***r",
    displayName: "M***a S***r",
    ownerName: "M***a S***r",
    editorName: "M***a S***r",
    holderPersonName: "M***a S***r",
    person: "M***a S***r",
    supplierTaxId: "M***r",
    legalName: "M***a S***r",
    taxId: "M***r",
    idEmisorFactura: "M***r",
    todayName: "M***a S***r",
  };

  it.each([...PERSONAL_LOG_KEYS])("masks the listed key %s", (key) => {
    expect(MARTHA_SPENCER_UNDER[key]).toBeDefined();
    expect(stringifyMasked({ [key]: "Martha Spencer" })).toBe(
      `{"${key}":"${MARTHA_SPENCER_UNDER[key]}"}`,
    );
  });

  it.each(
    [...PERSONAL_LOG_PATHS].flatMap(([parent, children]) =>
      [...children].map((child) => [parent, child]),
    ),
  )("masks %s[].%s", (parent, child) => {
    expect(stringifyMasked({ [parent]: [{ [child]: "Martha Spencer" }] })).toBe(
      `{"${parent}":[{"${child}":"M***a S***r"}]}`,
    );
  });

  it("writes a line with no listed key exactly as plain JSON.stringify does", () => {
    const line = { zone: "Patio", tables: nested, count: 20 };
    expect(stringifyMasked(line)).toBe(JSON.stringify(line));
  });

  it("serialises a line with no listed key once, and one with a listed key twice", () => {
    let calls = 0;
    const counted = { toJSON: () => (calls += 1) };
    stringifyMasked({ zone: "Patio", tables: nested, counted });
    expect(calls).toBe(1);
    stringifyMasked({ email: "martha.spencer@example.test", counted });
    expect(calls).toBe(3);
  });
});

describe("maskPersonalData keeps the first and last character of each piece", () => {
  it.each([
    ["martha.spencer@example.test", "m***r@e***e.test"],
    ["jamie.king@example.test", "j***g@e***e.test"],
    ["martha@mail.example.co.uk", "m***a@m***o.uk"],
    ["ana@bo.es", "***@***.es"],
    ["Àngel@cafè.cat", "À***l@c***è.cat"],
  ])("writes the email %j as %j", (value, masked) => {
    expect(maskPersonalData("email", value)).toBe(masked);
  });

  // Not an address: one whole-value mask, so nothing is kept verbatim.
  it.each([
    ["martha.spencer", "m***r"],
    ["martha@localhost", "m***t"],
    ["a@b@c.test", "a***t"],
    ["martha spencer@example.test", "m***t"],
    ["@example.test", "@***t"],
    ["martha@.test", "m***t"],
    ["martha@example.", "m***."],
    ["martha@example.com1", "m***1"],
    ["martha@example.xn--p1ai", "m***i"],
    ["Martha Spencer", "M***r"],
  ])("writes the email-key value %j, which is not an address, as %j", (value, masked) => {
    expect(maskPersonalData("email", value)).toBe(masked);
  });

  it.each([
    ["Jamie King Foster", "J***e K***g F***r"],
    ["Martha Spencer", "M***a S***r"],
    ["Spencer", "S***r"],
    ["  Jamie   King\tFoster\n", "J***e K***g F***r"],
    ["Martha Parker-Foster", "M***a P***r"],
    ["Àngel", "À***l"],
    ["Ann Bo", "*** ***"],
    ["Bar del Port", "*** *** P***t"],
    ["\u{1D49C}lex", "\u{1D49C}***x"],
    ["\u{1D49C}na", "***"],
  ])("writes the name %j as %j", (value, masked) => {
    expect(maskPersonalData("displayName", value)).toBe(masked);
    expect(maskPersonalData("legalName", value)).toBe(masked);
  });

  it.each([
    ["12345678Z", "1***Z"],
    ["ESB12345678", "E***8"],
    ["B 1234567 8", "B***8"],
    ["B12", "***"],
  ])("writes the tax number %j as %j", (value, masked) => {
    for (const key of ["taxId", "supplierTaxId", "idEmisorFactura"]) {
      expect(maskPersonalData(key, value)).toBe(masked);
    }
  });

  it.each(["email", "displayName", "taxId"])("writes an empty or blank %s as ***", (key) => {
    expect(maskPersonalData(key, "")).toBe("***");
    expect(maskPersonalData(key, "   ")).toBe("***");
  });

  it.each([
    ["an object", { id: "p1", displayName: "Martha Spencer" }],
    ["an array", ["Martha", "Spencer"]],
    ["a number", 12345678],
    ["a boolean", true],
    ["a BigInt", 12n],
  ])("writes %s under a listed key as ***, without looking inside", (_label, value) => {
    for (const key of PERSONAL_LOG_KEYS) expect(maskPersonalData(key, value)).toBe("***");
  });

  it("keeps null and undefined, and returns a function or symbol for JSON to drop", () => {
    const fn = () => "Martha Spencer";
    const sym = Symbol("Martha Spencer");
    expect(maskPersonalData("email", null)).toBeNull();
    expect(maskPersonalData("email", undefined)).toBeUndefined();
    expect(maskPersonalData("person", fn)).toBe(fn);
    expect(maskPersonalData("person", sym)).toBe(sym);
  });

  it("writes a merchant's name by the name rule, and any other value there as ***", () => {
    expect(
      maskPersonalData("merchants", [
        { code: "MC1", name: "Jamie King Foster" },
        { code: "MC2", name: 7 },
        { code: "MC3", name: { first: "Martha" } },
      ]),
    ).toEqual([
      { code: "MC1", name: "J***e K***g F***r" },
      { code: "MC2", name: "***" },
      { code: "MC3", name: "***" },
    ]);
  });

  it("leaves a key on neither list as it is", () => {
    expect(maskPersonalData("venueName", "Bar del Port")).toBe("Bar del Port");
  });
});
