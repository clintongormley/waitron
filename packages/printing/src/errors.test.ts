import { describe, expect, it } from "vitest";
import { AppError } from "@waitron/shared";
import "./index.js";

// One assertion per printer.* / agent.* code: each is constructible via `new AppError(code, params)`
// carrying the params errors.ts declares for it, and so resolves to a status through a per-surface map
// (Task 6's print-api.ts owns that map — createErrorBoundary keys it on exactly this `.code`). The
// construction typechecks ONLY because errors.ts's `declare module "@waitron/shared"` augmentation is
// loaded — index.js imports it — which is what makes the codes and their param shapes real for a
// consumer, mirroring packages/sync/src/errors.test.ts and packages/layouts/src/errors.test.ts.
describe("the printer / agent error codes carry their declared params", () => {
  it("constructs printer.not_found with the printer id", () => {
    const error = new AppError("printer.not_found", { id: "prn_123" });
    expect(error.code).toBe("printer.not_found");
    expect(error.params).toEqual({ id: "prn_123" });
  });

  it("constructs printer.invalid_config with a stable English reason discriminator", () => {
    const error = new AppError("printer.invalid_config", { reason: "missing_transport_fields" });
    expect(error.code).toBe("printer.invalid_config");
    expect(error.params).toEqual({ reason: "missing_transport_fields" });
  });

  it("constructs agent.not_found with the agent id", () => {
    const error = new AppError("agent.not_found", { id: "agt_123" });
    expect(error.code).toBe("agent.not_found");
    expect(error.params).toEqual({ id: "agt_123" });
  });

  it("constructs agent.unauthorized with NO params (a uniform, oracle-free 401)", () => {
    const error = new AppError("agent.unauthorized", {});
    expect(error.code).toBe("agent.unauthorized");
    expect(error.params).toEqual({});
  });

  it("constructs agent.pairing_invalid with NO params (mistyped vs unknown is not disclosed)", () => {
    const error = new AppError("agent.pairing_invalid", {});
    expect(error.code).toBe("agent.pairing_invalid");
    expect(error.params).toEqual({});
  });

  it("constructs agent.pairing_expired with NO params (the code lapsed past its TTL)", () => {
    const error = new AppError("agent.pairing_expired", {});
    expect(error.code).toBe("agent.pairing_expired");
    expect(error.params).toEqual({});
  });
});
