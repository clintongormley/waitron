import { expect, it, vi } from "vitest";
import { withOperationAuthority } from "@waitron/module";
import {
  configuredOperations,
  type HistoricalAllocationPaths,
} from "./allocation-configuration.js";
const paths = {
  custodianFile: "unavailable-outside-file",
  confirmationFile: "unavailable-outside-file",
  custodianFingerprint: "unavailable-outside-file",
};
const fields = ["custodianFile", "confirmationFile", "custodianFingerprint"] as const;
const binding = {
  module: "fiscal-verifactu",
  action: "restore",
  eventId: "event",
  sourceId: "archive",
  targetNodeId: "target",
};
function attempt(
  input: unknown = { allocation: {}, approval: {} },
  operationBinding = binding,
  options: HistoricalAllocationPaths = paths,
) {
  return withOperationAuthority(operationBinding, "admin", (authority) =>
    configuredOperations(options).prepare(
      { binding: operationBinding, authority, input },
      async () => {
        throw new Error("unverified input admitted");
      },
    ),
  );
}
it.each(fields)("requires the host to configure %s independently", async (field) => {
  for (const value of [undefined, "", "  "]) {
    await expect(attempt(undefined, binding, { ...paths, [field]: value })).rejects.toMatchObject({
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
it("refuses a setup whose configured custodian file does not exist", async () => {
  await expect(
    attempt(
      undefined,
      { ...binding, action: "setup" },
      {
        ...paths,
        custodianFile: "/nonexistent/custodian.json",
      },
    ),
  ).rejects.toMatchObject({
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
it.each(["symbol", "non-enumerable", "function"])(
  "refuses an input carrying a %s field before any later check reads it",
  async (which) => {
    const input = { allocation: {}, approval: {} };
    Object.defineProperty(input, which === "symbol" ? Symbol("injected") : "injected", {
      value: which === "function" ? () => true : true,
      enumerable: which !== "non-enumerable",
    });
    const readPublicEvidence = vi.fn(async () => undefined);
    const configured = configuredOperations({}, { environment: {}, readPublicEvidence });
    await expect(
      withOperationAuthority(binding, "admin", (authority) =>
        configured.prepare({ binding, authority, input }, async () => "admitted"),
      ),
    ).rejects.toMatchObject({
      code: "sif.allocation_invalid",
      params: { reason: "malformed_allocation" },
    });
    expect(readPublicEvidence).not.toHaveBeenCalled();
  },
);

it("binds the settings supplied when the historical host is configured", async () => {
  const options = {};
  const configured = configuredOperations(options, {
    environment: {},
    readPublicEvidence: async () => undefined,
  });
  Object.assign(options, paths);
  await withOperationAuthority(binding, "admin", async (authority) => {
    for (const input of [{ allocation: {}, approval: {} }, { receipt: {} }, { emergency: {} }]) {
      await expect(
        configured.prepare({ binding, authority, input }, async () => "admitted"),
      ).rejects.toMatchObject({
        code: "sif.allocation_invalid",
        params: { reason: "outside_confirmation_missing" },
      });
    }
  });
});
