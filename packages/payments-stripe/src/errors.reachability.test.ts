import { describe, expect, it } from "vitest";
import { AppError } from "@waitron/shared";
import "./index.js";

describe("errors reachable from the barrel", () => {
  it("registers stripe.collect_timeout", () => {
    const e = new AppError("stripe.collect_timeout", { paymentRef: "p", readerId: "r" });
    expect(e.code).toBe("stripe.collect_timeout");
  });

  it("registers stripe.tenant_mismatch", () => {
    const e = new AppError("stripe.tenant_mismatch", { expected: "a", supplied: "b" });
    expect(e.code).toBe("stripe.tenant_mismatch");
  });
});
