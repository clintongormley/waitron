import { afterEach, expect, it, vi } from "vitest";
import { TEST_PRODUCER } from "./testing/test-producer.js";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  process.exitCode = undefined;
});

it("sets the exit status from the real modules' checks of the process's settings", async () => {
  for (const [name, value] of Object.entries(TEST_PRODUCER)) vi.stubEnv(name, value);
  vi.stubEnv("WAITRON_PRODUCER_TAX_ID", "00000000A");
  const error = vi.spyOn(console, "error").mockImplementation(() => {});
  await import("./producer-check-entry.js");
  expect(process.exitCode).toBe(1);
  expect(error).toHaveBeenCalledExactlyOnceWith(
    "verifactu: sif.producer_invalid (setting WAITRON_PRODUCER_TAX_ID, reason check_failed)",
  );
});
