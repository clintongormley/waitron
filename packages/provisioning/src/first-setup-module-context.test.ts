import { expect, it } from "vitest";
import { firstSetupModuleContext } from "./first-setup-module-context.js";
import type { FirstSetupFrozen } from "./first-setup-state.js";
import { request } from "../test/first-setup-request.js";

function frozen(): FirstSetupFrozen {
  const { password: _, pin: __, ...admin } = request.admin;
  void _;
  void __;
  return {
    attemptId: "attempt",
    nodeId: "target-node",
    administratorId: "administrator",
    sourceId: "source",
    environment: "preproduction",
    request: {
      ...request,
      admin: { ...admin, pinHash: "pin-verifier", passwordHash: "password-verifier" },
    },
    modules: [{ module: "test-module", version: "1", eventId: "event", request: { ready: true } }],
  };
}

it("refuses a module outside the frozen setup selection with the fiscal admission code", () => {
  expect(() => firstSetupModuleContext({ frozen: frozen() }, "another-module")).toThrowError(
    expect.objectContaining({
      code: "sif.allocation_invalid",
      params: { reason: "outside_confirmation_missing" },
    }),
  );
});

it.each([
  [undefined, "FF"],
  ["F/exact", "F/exact"],
] as const)("keeps the complete purpose set with full base %j", (full, expectedFull) => {
  const state = frozen();
  state.request.seriesCode = "standard.Exact";
  state.request.rectificativeSeriesCode = "rectified-Exact";
  if (full === undefined) delete state.request.fullSeriesCode;
  else state.request.fullSeriesCode = full;
  const context = firstSetupModuleContext({ frozen: state }, "test-module");
  expect(context).toEqual({
    attemptId: "attempt",
    binding: {
      module: "test-module",
      action: "setup",
      eventId: "event",
      sourceId: "source",
      targetNodeId: "target-node",
    },
    administratorId: "administrator",
    country: "ES",
    taxId: "50000000R",
    environment: "preproduction",
    recipientVenueId: "source",
    bases: [
      { code: "standard.Exact", purpose: "standard" },
      { code: expectedFull, purpose: "full" },
      { code: "rectified-Exact", purpose: "rectificative" },
    ],
    request: { ready: true },
  });
  (context.bases[0] as { code: string }).code = "changed caller base";
  expect(state.request.seriesCode).toBe("standard.Exact");
});
