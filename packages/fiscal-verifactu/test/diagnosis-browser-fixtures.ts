import type { DashboardPermissionContinuation } from "@waitron/dashboard-kit";
import type {
  CertificateDiagnosisRequest,
  CertificateDiagnosisResult,
} from "../src/certificate-diagnosis-contract.js";
import type { CertificateCardView } from "../src/dashboard/client.js";

export const savedCard: CertificateCardView = {
  filing: true,
  revision: "revision-1",
  timeZone: "Europe/Madrid",
  installed: null,
};
export function evidence(
  request: CertificateDiagnosisRequest,
  over: Partial<CertificateDiagnosisResult> = {},
): CertificateDiagnosisResult {
  return {
    schemaVersion: 1,
    attemptLabel: "d01cf106-38b9-4df4-9d02-f44059a6c166",
    operation: request.operation,
    source: request.source,
    binding: {
      sourceGeneration: request.sourceGeneration,
      expectedRevision: request.expectedRevision,
    },
    environment: "preproduction",
    kind: "sello",
    endpointLabel: "preproduction-sello",
    saved: null,
    association: request.source === "installed" ? "unverified" : "not-applicable",
    startedAt: "2026-10-29T09:00:00.000Z",
    completedAt: "2026-10-29T09:00:01.000Z",
    durationMs: 1000,
    stage: "complete",
    category: request.operation === "inspect" ? "local-ready" : "query-completed",
    httpStatus: request.operation === "inspect" ? null : 200,
    localFinding: null,
    cause: "not-established",
    ...over,
  };
}
export function held<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
export function permission(permissions = ["system.manage"]) {
  let value = { accountGeneration: 1, authenticated: true, permissions };
  const listeners = new Set<(next: typeof value) => void>();
  const hook: DashboardPermissionContinuation = {
    snapshot: () => value,
    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    signIn: async () => "stopped",
  };
  return {
    hook,
    change(next = permissions) {
      value = { ...value, accountGeneration: value.accountGeneration + 1, permissions: next };
      for (const fn of listeners) fn(value);
    },
  };
}
