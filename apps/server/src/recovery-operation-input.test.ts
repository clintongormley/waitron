import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import * as api from "./recovery-module-operation.js";

const NODE = "c0000000-0000-4000-8000-000000000001";
const valid = {
  binding: {
    module: "test-regime",
    action: "re-register",
    eventId: "event-42",
    sourceId: "box-42",
    targetNodeId: NODE,
  },
  input: { signed: "opaque", nested: { value: 42 } },
};
const pending = api as typeof api & {
  parseRecoveryOperationInput(value: unknown): typeof valid | null;
  readRecoveryOperationFile(path: string): Promise<typeof valid>;
};
const dirs: string[] = [];
afterEach(async () => {
  for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true });
});

it.each(["restore", "re-register", "promote"])(
  "parses and detaches %s input while normalising the target UUID",
  (action) => {
    expect(pending.parseRecoveryOperationInput).toBeTypeOf("function");
    const value = structuredClone(valid);
    value.binding.action = action;
    value.binding.targetNodeId = NODE.toUpperCase();
    const parsed = pending.parseRecoveryOperationInput(value);
    expect(parsed).toEqual({ ...valid, binding: { ...valid.binding, action } });
    value.binding.eventId = "changed";
    value.input.nested.value = 99;
    expect(parsed!.binding.eventId).toBe("event-42");
    expect(parsed!.input).toEqual({ signed: "opaque", nested: { value: 42 } });
  },
);

it.each([
  null,
  undefined,
  [],
  42,
  {},
  { ...valid, password: "never accepted" },
  { binding: valid.binding },
  { ...valid, binding: null },
  { ...valid, binding: [] },
  { ...valid, binding: { ...valid.binding, authority: "submitted" } },
  ...["", "setup", "reserve", "establish", 42, null].map((action) => ({
    ...valid,
    binding: { ...valid.binding, action },
  })),
  ...["", "Not a module", "_invalid", null].map((module) => ({
    ...valid,
    binding: { ...valid.binding, module },
  })),
  ...["", " space", "line\nfeed", "x".repeat(257), 42].map((eventId) => ({
    ...valid,
    binding: { ...valid.binding, eventId },
  })),
  ...["", " space", "line\nfeed", "x".repeat(257), null].map((sourceId) => ({
    ...valid,
    binding: { ...valid.binding, sourceId },
  })),
  ...["", "other-node", 42, null].map((targetNodeId) => ({
    ...valid,
    binding: { ...valid.binding, targetNodeId },
  })),
  { ...valid, input: () => {} },
])("refuses malformed or credential-bearing input %#", (value) => {
  expect(pending.parseRecoveryOperationInput).toBeTypeOf("function");
  expect(pending.parseRecoveryOperationInput(value)).toBeNull();
});

it("accepts a boundary-length event/source and opaque primitive module input", () => {
  expect(pending.parseRecoveryOperationInput).toBeTypeOf("function");
  const value = {
    ...valid,
    binding: { ...valid.binding, eventId: "x".repeat(256), sourceId: "y".repeat(256) },
    input: null,
  };
  expect(pending.parseRecoveryOperationInput(value)).toEqual(value);
});

it("reads a regular JSON file within the 128-KiB boundary", async () => {
  expect(pending.readRecoveryOperationFile).toBeTypeOf("function");
  const dir = await mkdtemp(join(tmpdir(), "recovery-input-"));
  dirs.push(dir);
  const path = join(dir, "input.json");
  const raw = JSON.stringify(valid);
  await writeFile(path, raw.padEnd(131072, " "));
  await expect(pending.readRecoveryOperationFile(path)).resolves.toEqual(valid);
});

it.each(["oversized", "malformed-json", "wrong-shape", "missing", "directory", "empty"])(
  "refuses %s input without echoing its contents or path",
  async (kind) => {
    expect(pending.readRecoveryOperationFile).toBeTypeOf("function");
    const dir = await mkdtemp(join(tmpdir(), "recovery-input-"));
    dirs.push(dir);
    const path =
      kind === "directory" ? dir : kind === "empty" ? "" : join(dir, "synthetic-secret-path.json");
    if (!["missing", "directory", "empty"].includes(kind))
      await writeFile(
        path,
        kind === "oversized"
          ? JSON.stringify(valid).padEnd(131073, " ")
          : kind === "malformed-json"
            ? "synthetic secret {"
            : JSON.stringify({ key: "synthetic-secret" }),
      );
    await expect(pending.readRecoveryOperationFile(path)).rejects.toMatchObject({
      code: "server.config_invalid",
      params: { variable: "WAITRON_RECOVERY_OPERATION_FILE", reason: "invalid_operation" },
    });
  },
);

it.each([
  undefined,
  { missing: undefined },
  [undefined],
  new Map([["signed", "value"]]),
  new Date("2026-10-13T09:00:00.000Z"),
  { count: Number.NaN },
  1n,
])("refuses module input that a restart cannot retain exactly %#", (input) => {
  expect(pending.parseRecoveryOperationInput({ ...valid, input })).toBeNull();
});
it("refuses circular module input before staging can erase an earlier request", () => {
  const input: { self?: unknown } = {};
  input.self = input;
  expect(pending.parseRecoveryOperationInput({ ...valid, input })).toBeNull();
});
