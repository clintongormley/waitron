import { describe, expect, it } from "vitest";
import { AppError } from "@waitron/shared";
import "./index.js";

// One assertion per sync.* code: each is constructible via `new AppError(code, params)` carrying the
// params errors.ts declares for it. The construction typechecks ONLY because errors.ts's
// `declare module "@waitron/shared"` augmentation is loaded — index.js imports it — which is what
// makes the codes and their param shapes real for a consumer, mirroring the construction in
// packages/credentials/src/errors.reachability.test.ts.
describe("the sync error codes carry their declared params", () => {
  it("constructs sync.peer_environment_mismatch", () => {
    const error = new AppError("sync.peer_environment_mismatch", {
      local: "production",
      peer: "preproduction",
    });
    expect(error.code).toBe("sync.peer_environment_mismatch");
    expect(error.params).toEqual({ local: "production", peer: "preproduction" });
  });

  it("constructs sync.table_not_enrolled", () => {
    const error = new AppError("sync.table_not_enrolled", { table: "sales" });
    expect(error.code).toBe("sync.table_not_enrolled");
    expect(error.params).toEqual({ table: "sales" });
  });

  it("constructs sync.stream_stalled with the TRANSPORT backoff-saturation params (pull.ts)", () => {
    const error = new AppError("sync.stream_stalled", {
      subscriberId: "cloud",
      originId: "00000000-0000-0000-0000-000000000000",
      backoffMs: 400,
      lane: "fast",
    });
    expect(error.code).toBe("sync.stream_stalled");
    expect(error.params).toEqual({
      subscriberId: "cloud",
      originId: "00000000-0000-0000-0000-000000000000",
      backoffMs: 400,
      lane: "fast",
    });
  });

  it("constructs sync.stream_stalled with the RETENTION lag params (retention.ts)", () => {
    const error = new AppError("sync.stream_stalled", {
      subscriberId: "cloud",
      originId: "00000000-0000-0000-0000-000000000000",
      lag: 6,
    });
    expect(error.code).toBe("sync.stream_stalled");
    expect(error.params).toEqual({
      subscriberId: "cloud",
      originId: "00000000-0000-0000-0000-000000000000",
      lag: 6,
    });
  });

  it("constructs sync.node_unauthorized with NO params (a uniform, oracle-free 401)", () => {
    const error = new AppError("sync.node_unauthorized", {});
    expect(error.code).toBe("sync.node_unauthorized");
    expect(error.params).toEqual({});
  });
});
