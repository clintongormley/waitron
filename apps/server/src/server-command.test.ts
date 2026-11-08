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
  expect(runServerCommand("check-producer", out)).toBe(0);
  expect(log).toEqual(["verifactu: the settings pass"]);
  expect(error).toEqual([]);
});

it("check-producer answers 1 and names the refusal when the real modules refuse", () => {
  stubProducer({ ...TEST_PRODUCER, WAITRON_PRODUCER_TAX_ID: "00000000A" });
  const { out, log, error } = output();
  expect(runServerCommand("check-producer", out)).toBe(1);
  expect(log).toEqual([]);
  expect(error).toEqual([
    "verifactu: sif.producer_invalid (setting WAITRON_PRODUCER_TAX_ID, reason check_failed)",
  ]);
});

it("refuses a command it does not know without checking anything", () => {
  stubProducer(TEST_PRODUCER);
  const { out, log, error } = output();
  expect(runServerCommand("check-producers", out)).toBe(1);
  expect(log).toEqual([]);
  expect(error).toEqual(["unknown command: check-producers"]);
});
