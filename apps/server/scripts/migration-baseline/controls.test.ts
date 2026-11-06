import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { CONTROLS, formatOutcomes, runControls, type Control } from "./controls.js";
import { fixtureEntry, writeReference } from "./test-reference.js";

const SCHEMA = {
  name: "core",
  sql: `
CREATE TABLE incidents (
  id integer PRIMARY KEY,
  device_id text,
  code text NOT NULL DEFAULT 'none',
  CONSTRAINT incidents_code_ck CHECK (code in ('none', 'a b'))
);
CREATE INDEX incidents_code ON incidents (code);
CREATE TRIGGER incidents_guard BEFORE DELETE ON incidents BEGIN SELECT raise(abort, 'kept'); END;
`,
};

const at = { composition: "fiscal-verifactu", phase: "sql-only", database: "venue" } as const;

const PASSING: readonly Control[] = [
  { ...at, label: "unchanged copy", change: null, expect: [] },
  {
    ...at,
    label: "whitespace between tokens",
    change: { rewrite: { name: "incidents_guard", from: "BEFORE DELETE", to: "BEFORE\n  DELETE" } },
    expect: [],
  },
  {
    ...at,
    label: "drop the trigger",
    change: { sql: "DROP TRIGGER incidents_guard" },
    expect: ["missing trigger incidents_guard"],
  },
  {
    ...at,
    label: "whitespace inside quoted text",
    change: { rewrite: { name: "incidents", from: "'a b'", to: "'a  b'" } },
    expect: ["changed table incidents.checks[incidents_code_ck].expression"],
  },
  {
    ...at,
    label: "quoted expression",
    change: {
      refuses:
        'CREATE INDEX incidents_quoted ON incidents (`case when "device_id" is null then \'\' else "device_id" end`)',
      message: "no such column: case when",
    },
    expect: [],
  },
  {
    ...at,
    label: "seeded value",
    setup: "CREATE TABLE control_seed (value); INSERT INTO control_seed VALUES (x'00ff');",
    change: { sql: "UPDATE control_seed SET value = x'00fe'" },
    expect: ["changed table control_seed.rows[0]"],
  },
];

let dir: string;
let reference: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "wt-controls-"));
  reference = writeReference(join(dir, "reference"), [
    fixtureEntry(join(dir, "reference"), [SCHEMA]),
  ]);
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("runControls", () => {
  it("passes each control that fails, or is accepted, as it says", () => {
    const outcomes = runControls({ reference, out: join(dir, "out"), controls: PASSING });
    expect(outcomes.map((outcome) => [outcome.label, outcome.passed])).toEqual(
      PASSING.map((control) => [control.label, true]),
    );
  });

  it("fails a negative control whose change the comparison does not see", () => {
    const [outcome] = runControls({
      reference,
      out: join(dir, "out"),
      controls: [
        {
          ...at,
          label: "whitespace claimed as a change",
          change: {
            rewrite: { name: "incidents_guard", from: "BEFORE DELETE", to: "BEFORE  DELETE" },
          },
          expect: ["changed trigger incidents_guard.body"],
        },
      ],
    });
    expect(outcome?.passed).toBe(false);
    expect(outcome?.detail).toContain("EQUAL");
  });

  it("fails an accepting control whose change the comparison reports", () => {
    const [outcome] = runControls({
      reference,
      out: join(dir, "out"),
      controls: [
        { ...at, label: "dropped index", change: { sql: "DROP INDEX incidents_code" }, expect: [] },
      ],
    });
    expect(outcome?.passed).toBe(false);
    expect(outcome?.detail).toContain("missing index incidents_code");
  });

  it("fails a control that reports more than the changed object", () => {
    const [outcome] = runControls({
      reference,
      out: join(dir, "out"),
      controls: [
        {
          ...at,
          label: "two changes",
          change: { sql: "DROP INDEX incidents_code; DROP TRIGGER incidents_guard" },
          expect: ["missing index incidents_code"],
        },
      ],
    });
    expect(outcome?.passed).toBe(false);
  });

  it("fails a refusal control whose statement applies", () => {
    const [outcome] = runControls({
      reference,
      out: join(dir, "out"),
      controls: [
        {
          ...at,
          label: "applies",
          change: {
            refuses: "CREATE INDEX i2 ON incidents (device_id)",
            message: "no such column",
          },
          expect: [],
        },
      ],
    });
    expect(outcome?.passed).toBe(false);
  });

  it("refuses a rewrite whose text is not in the stored definition", () => {
    expect(() =>
      runControls({
        reference,
        out: join(dir, "out"),
        controls: [
          {
            ...at,
            label: "absent",
            change: { rewrite: { name: "incidents", from: "no such text", to: "x" } },
            expect: [],
          },
        ],
      }),
    ).toThrow("once");
  });

  it("refuses a control for an entry the reference does not hold", () => {
    expect(() =>
      runControls({
        reference,
        out: join(dir, "out"),
        controls: [{ ...at, phase: "change-feed", label: "absent", change: null, expect: [] }],
      }),
    ).toThrow("no entry");
  });

  it("prints PASS or FAIL for each control", () => {
    const text = formatOutcomes([
      { label: "a", passed: true, detail: "EQUAL" },
      { label: "b", passed: false, detail: "missing x" },
    ]);
    expect(text).toBe("PASS a\n  EQUAL\nFAIL b\n  missing x");
  });
});

describe("the real controls", () => {
  it("cover each kind the runbook names, and include accepting cases", () => {
    const labels = CONTROLS.map((control) => control.label).join("\n");
    for (const word of [
      "unchanged",
      "behavioural trigger",
      "media parent trigger",
      "append-only pair",
      "feed trigger",
      "ordinary index",
      "expression index",
      "CHECK",
      "foreign key",
      "unexpected",
      "seeded",
      "quoted",
    ]) {
      expect(labels).toContain(word);
    }
    expect(CONTROLS.filter((control) => control.expect.length === 0).length).toBeGreaterThan(1);
  });
});
