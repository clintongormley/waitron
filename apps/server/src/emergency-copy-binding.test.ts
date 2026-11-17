import { isAppError } from "@waitron/shared";
import { describe, expect, it } from "vitest";
import { parseEmergencyCopyBinding } from "./emergency-copy-binding.js";

const SOURCE_NODE = "6f1c2a3b-4d5e-4f60-8a71-92b3c4d5e6f7";
const COPY_NODE = "0a1b2c3d-4e5f-4a6b-9c7d-8e9f0a1b2c3d";

const valid = {
  copyOperationId: "d2e3f4a5-b6c7-4d8e-a9f0-a1b2c3d4e5f6",
  venueId: "11112222-3333-4444-8555-666677778888",
  environment: "production",
  sourceNodeId: SOURCE_NODE,
  sourceInstallationId: "source-installation",
  copyNodeId: COPY_NODE,
  installationId: "copy-installation",
  selectedStream: {
    streamId: "9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d",
    generation: `gen-3-${SOURCE_NODE}-20261117T101500Z`,
    databaseSha256: "a".repeat(64),
  },
  startedAt: "2026-11-17T10:20:00.000Z",
  expiresAt: "2026-11-17T10:50:00.000Z",
};

const NOW = new Date("2026-11-17T10:25:00.000Z");

function refusal(input: unknown, now: Date = NOW): { code: string; params: unknown } {
  try {
    parseEmergencyCopyBinding(input, now);
  } catch (error) {
    if (isAppError(error)) return { code: error.code, params: error.params };
    throw error;
  }
  throw new Error("the binding was accepted");
}

const invalid = (field: string) => ({
  code: "emergency_copy.binding_invalid",
  params: { field },
});

describe("parseEmergencyCopyBinding", () => {
  it("accepts a binding whose fields are well formed", () => {
    expect(parseEmergencyCopyBinding(valid, NOW)).toEqual(valid);
  });

  it("accepts preproduction as the environment", () => {
    expect(parseEmergencyCopyBinding({ ...valid, environment: "preproduction" }, NOW)).toEqual({
      ...valid,
      environment: "preproduction",
    });
  });

  it("refuses input that is not an object", () => {
    expect(refusal(null)).toEqual(invalid("binding"));
    expect(refusal("binding")).toEqual(invalid("binding"));
    expect(refusal([valid])).toEqual(invalid("binding"));
  });

  it("refuses a missing key", () => {
    const rest: Record<string, unknown> = { ...valid };
    delete rest.installationId;
    expect(refusal(rest)).toEqual(invalid("installationId"));
  });

  it("refuses a key present only on the prototype", () => {
    const rest: Record<string, unknown> = { ...valid };
    delete rest.installationId;
    const inherited = Object.assign(Object.create({ installationId: "copy-installation" }), rest);
    expect(refusal(inherited)).toEqual(invalid("installationId"));
  });

  it("refuses a node id whose variant digit is not 8, 9, a or b", () => {
    expect(refusal({ ...valid, copyNodeId: "0a1b2c3d-4e5f-4a6b-cc7d-8e9f0a1b2c3d" })).toEqual(
      invalid("copyNodeId"),
    );
  });

  it("refuses an extra key", () => {
    expect(refusal({ ...valid, recoveryKey: "x" })).toEqual(invalid("recoveryKey"));
  });

  it("refuses an extra or missing key in the selected stream", () => {
    expect(refusal({ ...valid, selectedStream: { ...valid.selectedStream, bucket: "b" } })).toEqual(
      invalid("selectedStream.bucket"),
    );
    const stream: Record<string, unknown> = { ...valid.selectedStream };
    delete stream.generation;
    expect(refusal({ ...valid, selectedStream: stream })).toEqual(
      invalid("selectedStream.generation"),
    );
    expect(refusal({ ...valid, selectedStream: "stream" })).toEqual(invalid("selectedStream"));
  });

  it("refuses an uppercase operation id", () => {
    expect(refusal({ ...valid, copyOperationId: valid.copyOperationId.toUpperCase() })).toEqual(
      invalid("copyOperationId"),
    );
  });

  it("refuses a version 1 node id", () => {
    expect(refusal({ ...valid, sourceNodeId: "6f1c2a3b-4d5e-1f60-8a71-92b3c4d5e6f7" })).toEqual(
      invalid("sourceNodeId"),
    );
    expect(refusal({ ...valid, copyNodeId: "0a1b2c3d-4e5f-1a6b-9c7d-8e9f0a1b2c3d" })).toEqual(
      invalid("copyNodeId"),
    );
  });

  it("refuses a copy node id equal to the source's", () => {
    expect(refusal({ ...valid, copyNodeId: SOURCE_NODE })).toEqual(invalid("copyNodeId"));
  });

  it("refuses an operation id equal to either node id", () => {
    expect(refusal({ ...valid, copyOperationId: SOURCE_NODE })).toEqual(invalid("copyOperationId"));
    expect(refusal({ ...valid, copyOperationId: COPY_NODE })).toEqual(invalid("copyOperationId"));
  });

  it("refuses a venue id that is not a UUID", () => {
    expect(refusal({ ...valid, venueId: "venue-1" })).toEqual(invalid("venueId"));
  });

  it("refuses an uppercase venue id", () => {
    const venueId = "aaaabbbb-cccc-4ddd-8eee-ffff00001111";
    expect(parseEmergencyCopyBinding({ ...valid, venueId }, NOW).venueId).toBe(venueId);
    expect(refusal({ ...valid, venueId: venueId.toUpperCase() })).toEqual(invalid("venueId"));
  });

  it("refuses a generation another machine wrote", () => {
    expect(
      refusal({
        ...valid,
        selectedStream: { ...valid.selectedStream, generation: `gen-3-${COPY_NODE}-20261117T101500Z` },
      }),
    ).toEqual(invalid("selectedStream.generation"));
  });

  it("refuses an environment the database cannot hold", () => {
    expect(refusal({ ...valid, environment: "dev" })).toEqual(invalid("environment"));
    expect(refusal({ ...valid, environment: "" })).toEqual(invalid("environment"));
  });

  it("refuses an empty installation id", () => {
    expect(refusal({ ...valid, sourceInstallationId: "" })).toEqual(
      invalid("sourceInstallationId"),
    );
    expect(refusal({ ...valid, installationId: 7 })).toEqual(invalid("installationId"));
  });

  it("refuses a stream id that is not a key segment", () => {
    expect(
      refusal({ ...valid, selectedStream: { ...valid.selectedStream, streamId: "a/b" } }),
    ).toEqual(invalid("selectedStream.streamId"));
  });

  it("refuses a generation name the stream would not write", () => {
    expect(
      refusal({
        ...valid,
        selectedStream: { ...valid.selectedStream, generation: `gen-3-${SOURCE_NODE}` },
      }),
    ).toEqual(invalid("selectedStream.generation"));
  });

  it("refuses an uppercase or short database hash", () => {
    expect(
      refusal({
        ...valid,
        selectedStream: { ...valid.selectedStream, databaseSha256: "A".repeat(64) },
      }),
    ).toEqual(invalid("selectedStream.databaseSha256"));
    expect(
      refusal({
        ...valid,
        selectedStream: { ...valid.selectedStream, databaseSha256: "a".repeat(63) },
      }),
    ).toEqual(invalid("selectedStream.databaseSha256"));
  });

  it("refuses an instant without milliseconds or with an offset", () => {
    expect(refusal({ ...valid, startedAt: "2026-11-17T10:20:00Z" })).toEqual(invalid("startedAt"));
    expect(refusal({ ...valid, startedAt: "2026-11-17T11:20:00.000+01:00" })).toEqual(
      invalid("startedAt"),
    );
    expect(refusal({ ...valid, expiresAt: "not a time" })).toEqual(invalid("expiresAt"));
    expect(refusal({ ...valid, startedAt: Date.parse(valid.startedAt) })).toEqual(
      invalid("startedAt"),
    );
  });

  it("refuses an expiry that is not exactly thirty minutes after the start", () => {
    expect(refusal({ ...valid, expiresAt: "2026-11-17T10:50:00.001Z" })).toEqual(
      invalid("expiresAt"),
    );
    expect(refusal({ ...valid, expiresAt: "2026-11-17T10:49:59.999Z" })).toEqual(
      invalid("expiresAt"),
    );
  });

  it("treats a binding as expired from the instant it expires, and valid one millisecond before", () => {
    expect(refusal(valid, new Date(valid.expiresAt))).toEqual({
      code: "emergency_copy.binding_expired",
      params: { expiresAt: valid.expiresAt },
    });
    expect(parseEmergencyCopyBinding(valid, new Date(Date.parse(valid.expiresAt) - 1))).toEqual(
      valid,
    );
  });

  it("throws rather than accept a binding when the clock it is given is not a time", () => {
    expect(() => parseEmergencyCopyBinding(valid, new Date("garbage"))).toThrow(
      "parseEmergencyCopyBinding needs a valid clock",
    );
  });
});
