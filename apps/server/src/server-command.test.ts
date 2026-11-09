import { afterEach, expect, it, vi } from "vitest";
import { runServerCommand } from "./server-command.js";
import { TEST_PRODUCER } from "./testing/test-producer.js";

function output() {
  const log: string[] = [];
  const error: string[] = [];
  return {
    log,
    error,
    out: { log: (line: string) => log.push(line), error: (line: string) => error.push(line) },
  };
}

afterEach(() => {
  vi.unstubAllEnvs();
});

function stubProducer(values: Record<string, string>) {
  for (const [name, value] of Object.entries(values)) vi.stubEnv(name, value);
}

it("check-producer answers 0 when the real modules accept the process's settings", () => {
  stubProducer(TEST_PRODUCER);
  const { out, log, error } = output();
  expect(runServerCommand(["check-producer"], out)).toBe(0);
  expect(log).toEqual(["verifactu: the settings pass"]);
  expect(error).toEqual([]);
});

it("check-producer answers 1 and names the refusal when the real modules refuse", () => {
  stubProducer({ ...TEST_PRODUCER, WAITRON_PRODUCER_TAX_ID: "00000000A" });
  const { out, log, error } = output();
  expect(runServerCommand(["check-producer"], out)).toBe(1);
  expect(log).toEqual([]);
  expect(error).toEqual([
    "verifactu: sif.producer_invalid (setting WAITRON_PRODUCER_TAX_ID, reason check_failed)",
  ]);
});

const USAGE = "usage: waitron-server [check-producer]";

it.each([
  ["an unknown word", ["check-producers"]],
  ["a word after the command", ["check-producer", "extra"]],
  ["an empty word", [""]],
  ["nothing at all", []],
])("answers usage and 2 without checking anything, given %s", (_case, args) => {
  stubProducer(TEST_PRODUCER);
  const { out, log, error } = output();
  expect(runServerCommand(args, out)).toBe(2);
  expect(log).toEqual([]);
  expect(error).toEqual([USAGE]);
});

it.each([
  ["a first word", ["https://person:hunter2@bucket.example/x"]],
  ["a later word", ["check-producer", "https://person:hunter2@bucket.example/x"]],
])("does not print what was typed: %s can carry a secret", (_case, args) => {
  stubProducer(TEST_PRODUCER);
  const { out, log, error } = output();
  expect(runServerCommand(args, out)).toBe(2);
  expect([...log, ...error].join("\n")).not.toContain("hunter2");
  expect([...log, ...error].join("\n")).not.toContain("bucket.example");
});
