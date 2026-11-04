import { createHash } from "node:crypto";
import { AppError } from "@waitron/shared";
import { describe, expect, it } from "vitest";
import { bindingFingerprint, isOperationId, parseBinding } from "./binding.js";
import type { HandoverBinding } from "./binding.js";

const binding: HandoverBinding = {
  operationId: "3f1c2a4e-8b7d-4c6a-9e2f-0a1b2c3d4e5f",
  scenario: "controlled",
  venue: { country: "ES", taxId: "B12345678", environment: "production" },
  sourceNodeId: "node-m1",
  destinationNodeId: "node-m2",
  membership: { term: 3, digest: "a".repeat(64) },
};

function json(value: unknown): Record<string, unknown> {
  return JSON.parse(JSON.stringify(value)) as Record<string, unknown>;
}

function refusal(raw: unknown): { code: string; params: unknown } {
  try {
    parseBinding(raw);
  } catch (error) {
    expect(error).toBeInstanceOf(AppError);
    const appError = error as AppError;
    return { code: appError.code, params: appError.params };
  }
  throw new Error("parseBinding accepted the input");
}

function invalid(field: string) {
  return { code: "handover.request_invalid", params: { field } };
}

describe("parseBinding", () => {
  it("a binding round-trips through parse", () => {
    expect(parseBinding(json(binding))).toEqual(binding);
    const emergency = { ...binding, scenario: "emergency" as const };
    expect(parseBinding(json(emergency))).toEqual(emergency);
    const preproduction = { ...binding, venue: { ...binding.venue, environment: "preproduction" } };
    expect(parseBinding(json(preproduction))).toEqual(preproduction);
    const termOne = { ...binding, membership: { term: 1, digest: "0123456789abcdef".repeat(4) } };
    expect(parseBinding(json(termOne))).toEqual(termOne);
  });

  it("returns a copy that holds only the binding's fields", () => {
    const raw = json(binding);
    const parsed = parseBinding(raw);
    expect(parsed).not.toBe(raw);
    expect(parsed.venue).not.toBe(raw.venue);
    expect(parsed.membership).not.toBe(raw.membership);
  });

  it.each([null, undefined, "binding", 7, [binding]])("refuses a binding that is %j", (raw) => {
    expect(refusal(raw)).toEqual(invalid("binding"));
  });

  it("refuses an operation id that is not a UUID", () => {
    for (const operationId of [
      "op-1",
      "",
      7,
      null,
      "3F1C2A4E-8B7D-4C6A-9E2F-0A1B2C3D4E5F",
      "3f1c2a4e-8b7d-1c6a-9e2f-0a1b2c3d4e5f",
      "3f1c2a4e-8b7d-4c6a-7e2f-0a1b2c3d4e5f",
      "3f1c2a4e8b7d4c6a9e2f0a1b2c3d4e5f",
      " 3f1c2a4e-8b7d-4c6a-9e2f-0a1b2c3d4e5f",
      "3f1c2a4e-8b7d-4c6a-9e2f-0a1b2c3d4e5f ",
      "3f1c2a4e-8b7d-4c6a-9e2f-0a1b2c3d4e5",
    ]) {
      expect(refusal({ ...binding, operationId }), String(operationId)).toEqual(
        invalid("operationId"),
      );
    }
  });

  it("accepts each of the four UUID v4 variant letters", () => {
    for (const variant of ["8", "9", "a", "b"]) {
      const operationId = `3f1c2a4e-8b7d-4c6a-${variant}e2f-0a1b2c3d4e5f`;
      expect(parseBinding({ ...binding, operationId }).operationId).toBe(operationId);
    }
  });

  it("refuses a source equal to the destination", () => {
    expect(refusal({ ...binding, destinationNodeId: "node-m1" })).toEqual(
      invalid("destinationNodeId"),
    );
  });

  it.each([
    ["sourceNodeId", ""],
    ["sourceNodeId", 1],
    ["destinationNodeId", ""],
    ["destinationNodeId", null],
  ])("refuses a %s of %j", (field, value) => {
    expect(refusal({ ...binding, [field]: value })).toEqual(invalid(field));
  });

  it("refuses a term below 1", () => {
    for (const term of [0, -1]) {
      expect(refusal({ ...binding, membership: { ...binding.membership, term } })).toEqual(
        invalid("membership.term"),
      );
    }
  });

  it.each([1.5, "3", null, Number.MAX_SAFE_INTEGER + 1, Number.NaN])(
    "refuses a term of %j",
    (term) => {
      expect(refusal({ ...binding, membership: { ...binding.membership, term } })).toEqual(
        invalid("membership.term"),
      );
    },
  );

  it.each([
    "",
    "A".repeat(64),
    "a".repeat(63),
    "a".repeat(65),
    "g".repeat(64),
    7,
    ` ${"a".repeat(63)}`,
  ])("refuses a membership digest of %j", (digest) => {
    expect(refusal({ ...binding, membership: { ...binding.membership, digest } })).toEqual(
      invalid("membership.digest"),
    );
  });

  it("refuses a scenario outside the two", () => {
    for (const scenario of ["handover", "", "Controlled", null]) {
      expect(refusal({ ...binding, scenario }), String(scenario)).toEqual(invalid("scenario"));
    }
  });

  it.each([
    ["venue.country", { ...binding.venue, country: "" }],
    ["venue.country", { ...binding.venue, country: 34 }],
    ["venue.taxId", { ...binding.venue, taxId: "" }],
    ["venue.taxId", { ...binding.venue, taxId: null }],
    ["venue.environment", { ...binding.venue, environment: "dev" }],
    ["venue.environment", { ...binding.venue, environment: undefined }],
  ])("refuses a bad %s", (field, venue) => {
    expect(refusal({ ...binding, venue })).toEqual(invalid(field));
  });

  it.each([
    ["venue", null],
    ["venue", "ES"],
    ["venue", []],
    ["membership", null],
    ["membership", 3],
    ["membership", []],
  ])("refuses a %s that is %j", (field, value) => {
    expect(refusal({ ...binding, [field]: value })).toEqual(invalid(field));
  });

  it("refuses an extra field", () => {
    expect(refusal({ ...binding, locationId: "loc-1" })).toEqual(invalid("locationId"));
    expect(refusal({ ...binding, venue: { ...binding.venue, legalName: "Bar" } })).toEqual(
      invalid("venue.legalName"),
    );
    expect(refusal({ ...binding, membership: { ...binding.membership, revision: 2 } })).toEqual(
      invalid("membership.revision"),
    );
  });

  it("refuses a missing field", () => {
    for (const field of Object.keys(binding)) {
      const raw = json(binding);
      delete raw[field];
      expect(refusal(raw), field).toEqual(invalid(field));
    }
    const noTerm = json(binding);
    delete (noTerm.membership as Record<string, unknown>).term;
    expect(refusal(noTerm)).toEqual(invalid("membership.term"));
  });
  it("names a missing field before an extra one", () => {
    const raw = json(binding);
    delete raw.venue;
    expect(refusal({ ...raw, extra: 1 })).toEqual(invalid("venue"));
    const noDigest = json(binding.membership);
    delete noDigest.digest;
    expect(refusal({ ...binding, membership: { ...noDigest, extra: 1 } })).toEqual(
      invalid("membership.digest"),
    );
  });

  it("refuses an id or a digest wrapped in a list, even though its text would match", () => {
    expect(refusal({ ...binding, operationId: [binding.operationId] })).toEqual(
      invalid("operationId"),
    );
    expect(
      refusal({ ...binding, membership: { ...binding.membership, digest: ["a".repeat(64)] } }),
    ).toEqual(invalid("membership.digest"));
  });
});

describe("bindingFingerprint", () => {
  it("is the SHA-256 of the binding's canonical form", () => {
    const canonical =
      `{"destinationNodeId":"node-m2","membership":{"digest":"${"a".repeat(64)}","term":3},` +
      `"operationId":"3f1c2a4e-8b7d-4c6a-9e2f-0a1b2c3d4e5f","scenario":"controlled",` +
      `"sourceNodeId":"node-m1","venue":{"country":"ES","environment":"production",` +
      `"taxId":"B12345678"}}`;
    expect(bindingFingerprint(binding)).toBe(
      createHash("sha256").update(Buffer.from(canonical, "utf8")).digest("hex"),
    );
  });

  it("two bindings differing only in the membership digest have different fingerprints", () => {
    const other = { ...binding, membership: { ...binding.membership, digest: "b".repeat(64) } };
    expect(bindingFingerprint(other)).not.toBe(bindingFingerprint(binding));
  });

  it("does not depend on key order", () => {
    const reordered = parseBinding({
      membership: { digest: binding.membership.digest, term: binding.membership.term },
      venue: { environment: "production", taxId: "B12345678", country: "ES" },
      destinationNodeId: "node-m2",
      sourceNodeId: "node-m1",
      scenario: "controlled",
      operationId: binding.operationId,
    });
    expect(bindingFingerprint(reordered)).toBe(bindingFingerprint(binding));
  });
});

describe("isOperationId", () => {
  it("accepts what parseBinding accepts and nothing else", () => {
    expect(isOperationId(binding.operationId)).toBe(true);
    for (const value of [binding.operationId.toUpperCase(), "../x", "", 7, null, undefined]) {
      expect(isOperationId(value), String(value)).toBe(false);
      expect(refusal({ ...binding, operationId: value })).toEqual(invalid("operationId"));
    }
  });
});
