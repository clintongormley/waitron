import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { describe, expect, it } from "vitest";
import {
  copyCertificateDiagnosis,
  parseCertificateDiagnosisRequest,
  parseCertificateDiagnosisResult,
} from "./certificate-diagnosis-contract.js";

const installed = {
  schemaVersion: 1,
  operation: "inspect",
  source: "installed",
  sourceGeneration: 0,
  expectedRevision: null,
} as const;
const candidate = {
  ...installed,
  operation: "check",
  source: "candidate",
  pfxBase64: "AQID",
  passphrase: "candidate-secret",
  certKind: "sello",
} as const;
const result = {
  schemaVersion: 1,
  attemptLabel: "f97f6b7b-870a-4a98-aec7-1e7b942396d7",
  operation: "check",
  source: "installed",
  binding: { sourceGeneration: 7, expectedRevision: "private-revision" },
  environment: "preproduction",
  kind: "sello",
  endpointLabel: "preproduction-sello",
  saved: { kind: "sello", installedAt: "2026-10-28T10:00:00.000Z" },
  association: "verified",
  startedAt: "2026-10-29T10:00:00.000Z",
  completedAt: "2026-10-29T10:00:00.500Z",
  durationMs: 500,
  stage: "response",
  category: "http-response",
  httpStatus: 403,
  localFinding: null,
  cause: "not-established",
} as const;

function without(value: object, key: string): Record<string, unknown> {
  return Object.fromEntries(Object.entries(value).filter(([name]) => name !== key));
}

describe("certificate diagnosis request", () => {
  it.each(["inspect", "check"] as const)("accepts %s with either explicit source", (operation) => {
    expect(parseCertificateDiagnosisRequest({ ...installed, operation })).toEqual({
      ...installed,
      operation,
    });
    expect(parseCertificateDiagnosisRequest({ ...candidate, operation })).toEqual({
      ...candidate,
      operation,
    });
  });

  it.each(["sello", "representante"] as const)("keeps the candidate's %s kind", (certKind) => {
    expect(parseCertificateDiagnosisRequest({ ...candidate, certKind })).toEqual({
      ...candidate,
      certKind,
    });
  });

  it("preserves opaque revision, generation and whitespace in a nonempty passphrase", () => {
    const value = {
      ...candidate,
      expectedRevision: "",
      sourceGeneration: 2147483647,
      passphrase: " ",
    };
    expect(parseCertificateDiagnosisRequest(value)).toEqual(value);
  });

  it.each([null, [], "secret-input", 1, false, undefined])(
    "refuses a non-object body %j",
    (raw) => {
      expect(() => parseCertificateDiagnosisRequest(raw)).toThrowError(
        expect.objectContaining({
          code: "fiscal.certificate_request_invalid",
          params: { field: "body" },
        }),
      );
    },
  );

  it.each(Object.keys(candidate))("requires %s rather than defaulting it", (key) => {
    expect(() => parseCertificateDiagnosisRequest(without(candidate, key))).toThrowError();
  });

  it.each([
    ["schemaVersion", null],
    ["schemaVersion", 2],
    ["schemaVersion", "1"],
    ["operation", null],
    ["operation", "install"],
    ["operation", ["check"]],
    ["source", null],
    ["source", "fallback"],
    ["sourceGeneration", null],
    ["sourceGeneration", -1],
    ["sourceGeneration", 0.5],
    ["sourceGeneration", 2147483648],
    ["sourceGeneration", Infinity],
    ["sourceGeneration", NaN],
    ["sourceGeneration", "0"],
    ["expectedRevision", 1],
    ["expectedRevision", []],
    ["expectedRevision", {}],
    ["pfxBase64", null],
    ["pfxBase64", ""],
    ["pfxBase64", "AQI"],
    ["pfxBase64", "AQI=\n"],
    ["pfxBase64", "AQI-"],
    ["pfxBase64", "A==="],
    ["pfxBase64", "AB=="],
    ["pfxBase64", "AAB="],
    ["pfxBase64", 1234],
    ["passphrase", null],
    ["passphrase", ""],
    ["passphrase", []],
    ["certKind", null],
    ["certKind", "other"],
    ["certKind", ["sello"]],
  ])("refuses invalid %s=%j without echoing input", (key, value) => {
    expect(() => parseCertificateDiagnosisRequest({ ...candidate, [key]: value })).toThrowError(
      expect.objectContaining({
        code: "fiscal.certificate_request_invalid",
        params: { field: key },
      }),
    );
  });

  it.each(["url", "host", "port", "environment", "timeoutMs", "__proto__"])(
    "refuses caller %s",
    (key) => {
      expect(() =>
        parseCertificateDiagnosisRequest({ ...candidate, [key]: "secret-input" }),
      ).toThrowError(
        expect.objectContaining({
          code: "fiscal.certificate_request_invalid",
          params: { field: "body" },
        }),
      );
    },
  );

  it.each(["pfxBase64", "passphrase", "certKind"])("rejects %s on installed source", (key) => {
    expect(() =>
      parseCertificateDiagnosisRequest({
        ...installed,
        [key]: candidate[key as keyof typeof candidate],
      }),
    ).toThrowError();
  });

  it.each([1, 2, 3, 102399, 102400])("accepts exactly %i decoded bytes", (size) => {
    const raw = { ...candidate, pfxBase64: Buffer.alloc(size, 1).toString("base64") };
    expect(parseCertificateDiagnosisRequest(raw)).toEqual(raw);
  });

  it("refuses the first byte beyond 100 KiB", () => {
    expect(() =>
      parseCertificateDiagnosisRequest({
        ...candidate,
        pfxBase64: Buffer.alloc(102401, 1).toString("base64"),
      }),
    ).toThrowError(
      expect.objectContaining({
        code: "fiscal.certificate_request_invalid",
        params: { field: "pfxBase64" },
      }),
    );
  });
});

describe("certificate diagnosis evidence", () => {
  it("projects a complete response into independent nested objects", () => {
    const parsed = parseCertificateDiagnosisResult(result);
    expect(parsed).toEqual(result);
    expect(parsed).not.toBe(result);
    expect(parsed.saved).not.toBe(result.saved);
    expect(parsed.binding).not.toBe(result.binding);
  });

  it.each([
    ["production", "sello", "production-sello"],
    ["production", "representante", "production-representante"],
    ["preproduction", "sello", "preproduction-sello"],
    ["preproduction", "representante", "preproduction-representante"],
  ])("accepts the configured %s/%s destination", (environment, kind, endpointLabel) => {
    const raw = { ...result, environment, kind, endpointLabel, saved: { ...result.saved, kind } };
    expect(parseCertificateDiagnosisResult(raw)).toEqual(raw);
  });

  it("represents unavailable local material without inventing a kind, destination or saved row", () => {
    const raw = {
      ...result,
      operation: "inspect",
      kind: null,
      endpointLabel: null,
      saved: null,
      association: "unverified",
      stage: "local",
      category: "local-finding",
      httpStatus: null,
      localFinding: "missing",
    };
    expect(parseCertificateDiagnosisResult(raw)).toEqual(raw);
  });

  it("keeps a candidate separate from saved installation facts", () => {
    const raw = { ...result, source: "candidate", association: "not-applicable" };
    expect(parseCertificateDiagnosisResult(raw)).toEqual(raw);
  });

  it("keeps observed wall-clock times when the clock moves back during an attempt", () => {
    const raw = { ...result, completedAt: "2026-10-29T09:59:59.000Z", durationMs: 500 };
    expect(parseCertificateDiagnosisResult(raw)).toEqual(raw);
  });

  it.each([
    "local-finding",
    "local-ready",
    "name-lookup-failed",
    "connection-refused",
    "deadline-elapsed",
    "connection-closed",
    "tls-protocol-failed",
    "http-response",
    "soap-fault",
    "reply-unparseable",
    "reply-too-large",
    "query-completed",
    "cancelled",
    "unknown",
  ])("preserves the fixed observation %s", (category) => {
    expect(parseCertificateDiagnosisResult({ ...result, category }).category).toBe(category);
  });

  it.each([
    "missing",
    "unusable",
    "too_large",
    "unreadable",
    "old_encryption",
    "no_private_key",
    "passphrase_wrong",
    "expired",
    "not_yet_valid",
    "other_taxpayer",
  ])("preserves local finding %s", (localFinding) => {
    expect(
      parseCertificateDiagnosisResult({ ...result, category: "local-finding", localFinding })
        .localFinding,
    ).toBe(localFinding);
  });

  it.each(["secret-provider-text", { message: "secret-provider-text" }, 42, null])(
    "projects unknown observations %j to fixed unknown",
    (category) => {
      expect(parseCertificateDiagnosisResult({ ...result, category }).category).toBe("unknown");
    },
  );

  it("drops an unknown local finding and labels the observation unknown", () => {
    const parsed = parseCertificateDiagnosisResult({ ...result, localFinding: "secret-subject" });
    expect(parsed.category).toBe("unknown");
    expect(parsed.localFinding).toBeNull();
    expect(JSON.stringify(parsed)).not.toContain("secret-subject");
  });

  it.each(Object.keys(result))("requires the response's %s field", (key) => {
    expect(() => parseCertificateDiagnosisResult(without(result, key))).toThrowError();
  });

  it.each([
    null,
    [],
    {},
    "secret-result",
    { ...result, schemaVersion: 2 },
    { ...result, attemptLabel: "secret-label" },
    { ...result, operation: "install" },
    { ...result, source: "fallback" },
    { ...result, environment: "test" },
    { ...result, kind: "secret-kind" },
    { ...result, endpointLabel: "https://secret-host" },
    { ...result, endpointLabel: "production-sello" },
    { ...result, kind: null },
    { ...result, saved: [] },
    { ...result, saved: { kind: "secret-kind", installedAt: result.saved.installedAt } },
    { ...result, saved: { kind: "sello", installedAt: "2026-02-30T00:00:00.000Z" } },
    { ...result, saved: { ...result.saved, subject: "secret-subject" } },
    { ...result, saved: null },
    { ...result, association: "guess" },
    { ...result, source: "candidate" },
    { ...result, association: "not-applicable" },
    { ...result, saved: { ...result.saved, kind: "representante" } },
    { ...result, binding: null },
    { ...result, binding: { sourceGeneration: 1 } },
    { ...result, binding: { ...result.binding, sourceGeneration: -1 } },
    { ...result, binding: { ...result.binding, expectedRevision: 1 } },
    { ...result, binding: { ...result.binding, secret: "hidden" } },
    { ...result, startedAt: "2026-10-29" },
    { ...result, startedAt: "invalid" },
    { ...result, completedAt: "2026-10-29T11:00:00+01:00" },
    { ...result, durationMs: -1 },
    { ...result, durationMs: Infinity },
    { ...result, durationMs: NaN },
    { ...result, durationMs: "500" },
    { ...result, stage: "secret-stage" },
    { ...result, httpStatus: 99 },
    { ...result, httpStatus: 600 },
    { ...result, httpStatus: 403.5 },
    { ...result, httpStatus: "403" },
    { ...result, cause: "secret-exception" },
    { ...result, rawBody: "secret-body" },
  ])("refuses malformed or unbound evidence %# without reflecting it", (raw) => {
    expect(() => parseCertificateDiagnosisResult(raw)).toThrowError(
      "Invalid certificate diagnosis result",
    );
  });

  it.each([100, 599, null])("retains the observed status boundary %j", (httpStatus) => {
    expect(parseCertificateDiagnosisResult({ ...result, httpStatus }).httpStatus).toBe(httpStatus);
  });

  it("copies only the explicit public projection, even from an augmented object", () => {
    const raw = {
      ...result,
      passphrase: "secret-passphrase",
      rawBody: "secret-soap",
      toJSON: () => ({ leaked: "secret-toJSON" }),
      saved: { ...result.saved, taxId: "secret-tax-id", subject: "secret-subject" },
    };
    expect(JSON.parse(copyCertificateDiagnosis(raw))).toEqual({
      schemaVersion: 1,
      attemptLabel: "f97f6b7b-870a-4a98-aec7-1e7b942396d7",
      operation: "check",
      source: "installed",
      environment: "preproduction",
      kind: "sello",
      endpointLabel: "preproduction-sello",
      saved: { kind: "sello", installedAt: "2026-10-28T10:00:00.000Z" },
      association: "verified",
      startedAt: "2026-10-29T10:00:00.000Z",
      completedAt: "2026-10-29T10:00:00.500Z",
      durationMs: 500,
      stage: "response",
      category: "http-response",
      httpStatus: 403,
      localFinding: null,
      cause: "not-established",
    });
    expect(copyCertificateDiagnosis(raw)).not.toMatch(
      /secret|private-revision|sourceGeneration|binding/,
    );
  });

  it("does not copy unknown observation text", () => {
    const raw = { ...result, category: "secret-observation" };
    expect(JSON.parse(copyCertificateDiagnosis(raw)).category).toBe("unknown");
    expect(copyCertificateDiagnosis(raw)).not.toContain("secret-observation");
  });

  it("bundles and executes the contract with only browser dependencies", async () => {
    const bundle = await build({
      absWorkingDir: fileURLToPath(new URL("../", import.meta.url)),
      entryPoints: ["src/certificate-diagnosis-contract.ts"],
      bundle: true,
      write: false,
      platform: "browser",
      format: "esm",
      metafile: true,
      logLevel: "silent",
    });
    const inputs = Object.keys(bundle.metafile!.inputs);
    expect(inputs).toContain("src/certificate-diagnosis-contract.ts");
    expect(inputs.some((path) => /(?:node:|\/db\/|\/store\/|\/credentials\/)/.test(path))).toBe(
      false,
    );
    const code = bundle.outputFiles[0]!.text;
    expect(code).not.toMatch(/\bBuffer\b|node:|require\(/);
    const contract = await import(
      `data:text/javascript;base64,${Buffer.from(code).toString("base64")}`
    );
    expect(contract.parseCertificateDiagnosisRequest(installed)).toEqual(installed);
    expect(contract.parseCertificateDiagnosisResult(result)).toEqual(result);
    expect(JSON.parse(contract.copyCertificateDiagnosis(result)).binding).toBeUndefined();
  });
});
