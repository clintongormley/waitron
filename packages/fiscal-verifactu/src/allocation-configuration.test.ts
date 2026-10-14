import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { withOperationAuthority } from "@waitron/module";
import { FISCAL_OPERATIONS } from "./allocation-configuration.js";
const variables = [
  "WAITRON_FISCAL_CUSTODIAN_FILE",
  "WAITRON_FISCAL_CONFIRMATION_FILE",
  "WAITRON_FISCAL_CUSTODIAN_FINGERPRINT",
] as const;
const binding = {
  module: "fiscal-verifactu",
  action: "restore",
  eventId: "event",
  sourceId: "archive",
  targetNodeId: "target",
};
beforeEach(() => {
  for (const variable of variables) vi.stubEnv(variable, "unavailable-outside-file");
});
afterEach(() => vi.unstubAllEnvs());
function attempt(input: unknown = { allocation: {}, approval: {} }) {
  return withOperationAuthority(binding, "admin", (authority) =>
    FISCAL_OPERATIONS.prepare({ binding, authority, input }, async () => {
      throw new Error("unverified input admitted");
    }),
  );
}
it.each(variables)("requires the host to configure %s independently", async (variable) => {
  for (const value of [undefined, "", "  "]) {
    vi.stubEnv(variable, value);
    await expect(attempt()).rejects.toMatchObject({
      code: "sif.allocation_invalid",
      params: { reason: "outside_confirmation_missing" },
    });
  }
});
it("refuses an unavailable host custodian instead of accepting trust from input", async () => {
  await expect(attempt()).rejects.toMatchObject({
    code: "sif.allocation_invalid",
    params: { reason: "reservation_untrusted" },
  });
});
it("refuses outside trust fields injected into an otherwise shaped operation", async () => {
  await expect(
    attempt({ allocation: {}, approval: {}, trust: { forged: true } }),
  ).rejects.toMatchObject({
    code: "sif.allocation_invalid",
    params: { reason: "malformed_allocation" },
  });
});
