import type { PaperAllocation } from "../paper-protocol.js";

export const custodyPassphrase = "synthetic test passphrase";
export const custodyBases = [
  { code: "A", purpose: "standard" },
  { code: "FF", purpose: "full" },
  { code: "R", purpose: "rectificative" },
];
export async function custodyRequest() {
  const candidates: PaperAllocation[] = [1, 2].map((n) => ({
    version: 1,
    allocationId: `allocation-${n}`,
    taxpayerNif: "B12345674",
    softwareId: "W1",
    environment: "production",
    installationIdentity: `S00000${n}`,
    series: custodyBases.map(({ code, purpose }) => ({ code: `${code}-S00000${n}`, purpose })),
    source: "initial-paper",
    issuedAt: "2026-10-15T08:00:00.000Z",
  }));
  const hash = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(JSON.stringify(candidates)),
  );
  return {
    version: 1 as const,
    kind: "first-fiscal-setup" as const,
    attemptId: "attempt-1",
    binding: {
      module: "fiscal-verifactu",
      action: "setup" as const,
      eventId: "event-1",
      sourceId: "first-setup:attempt-1",
      targetNodeId: "node-1",
    },
    operatorId: "administrator-1",
    recipientVenueId: "first-setup:attempt-1",
    taxpayerNif: "B12345674",
    softwareId: "W1",
    environment: "production" as const,
    requiredBases: custodyBases,
    candidates,
    candidateDigest: Array.from(new Uint8Array(hash), (v) => v.toString(16).padStart(2, "0")).join(
      "",
    ),
  };
}
