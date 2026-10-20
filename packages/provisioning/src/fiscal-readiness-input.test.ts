import { expect, it } from "vitest";
import { ALL_MODULES } from "@waitron/composition";
import { fiscalReadinessInput } from "./fiscal-readiness-input.js";
import { venueFiscalSelection } from "./venue-fiscal.js";
import { request } from "../test/first-setup-request.js";

const contribution = venueFiscalSelection(ALL_MODULES, "ES-common").contribution!;
const base = {
  venue: {
    ...request,
    admin: {
      displayName: "Elena",
      email: "elena@example.test",
      pinHash: "synthetic",
      passwordHash: "synthetic",
    },
  },
  moduleVersions: { core: 1 },
  applicationVersion: "synthetic-build",
};

it.each([undefined, { pfxBase64: 42, certKind: { kind: "sello" } }])(
  "does not invent certificate identity for a certificate-free readiness input %#",
  (secret) => {
    expect(
      fiscalReadinessInput({
        ...base,
        contribution: { ...contribution, activationReadinessTarget: undefined },
        secret,
      }),
    ).toEqual({
      requirement: "accepted-test-submission",
      fiscalModule: "verifactu",
      country: "ES",
      taxId: "50000000R",
      legalName: "Olivo SL",
      fiscalTerritory: "ES-common",
      submissionTarget: null,
      certificateFingerprint: null,
      certificateKind: null,
      moduleVersions: { core: 1 },
      applicationVersion: "synthetic-build",
    });
  },
);
