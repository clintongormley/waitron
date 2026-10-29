import { expect, it, vi } from "vitest";
import type { DashboardRequest } from "@waitron/dashboard-kit";
import { AeatCertificateClient } from "./client.js";
import { evidence } from "../../test/diagnosis-browser-fixtures.js";
import type { CertificateDiagnosisRequest } from "../certificate-diagnosis-contract.js";
const body: CertificateDiagnosisRequest = {
  schemaVersion: 1,
  operation: "inspect",
  source: "installed",
  expectedRevision: "rev-1",
  sourceGeneration: 2,
};
it("diagnosis opts into bounded quiet cancellation and validates the evidence", async () => {
  const request = vi.fn(async () => evidence(body));
  const signal = new AbortController().signal;
  const client = new AeatCertificateClient(request as unknown as DashboardRequest);
  await expect(client.diagnose(body, signal)).resolves.toEqual(evidence(body));
  expect(request).toHaveBeenCalledWith(
    "/management-api/fiscal-certificate/diagnose",
    "POST",
    body,
    { signal, timeLimitMs: 35000, sessionErrors: "caller", activity: "none" },
  );
  request.mockResolvedValueOnce({ ...evidence(body), rawFault: "PRIVATE_FAULT" } as never);
  await expect(client.diagnose(body, signal)).rejects.toThrow();
});
