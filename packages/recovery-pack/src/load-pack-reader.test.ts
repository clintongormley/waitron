import { expect, test } from "vitest";
import { loadRecoveryPackReader } from "./load-pack-reader.js";
import { readRecoveryPackPdf } from "./read-pack-pdf.js";

test("loads the recovery pack PDF reader", async () => {
  expect(await loadRecoveryPackReader()).toBe(readRecoveryPackPdf);
});
