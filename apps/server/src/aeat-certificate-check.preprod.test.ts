import { describe, expect, it } from "vitest";
import type { DeploymentEnvironment } from "@waitron/db";
import {
  aeatEndpointFor,
  isCertKind,
  mtlsFetch,
  type CertKind,
} from "@waitron/fiscal-verifactu/src/aeat-transport.js";
import { openCertificateFile } from "@waitron/fiscal-verifactu/src/certificate-file.js";
import { checkWithAuthority } from "@waitron/fiscal-verifactu/src/certificate-check.js";
import { isUnset } from "./env-value.js";

const pfxBase64 = process.env.WAITRON_CERT_CHECK_PFX_BASE64;
const passphrase = process.env.WAITRON_CERT_CHECK_PASSPHRASE;
const kind = process.env.WAITRON_CERT_CHECK_KIND;
const environment = process.env.WAITRON_CERT_CHECK_ENVIRONMENT;
const nif = process.env.WAITRON_CERT_CHECK_NIF;
const legalName = process.env.WAITRON_CERT_CHECK_LEGAL_NAME;
const addressKind = process.env.WAITRON_CERT_CHECK_ADDRESS_KIND;

const configured = [pfxBase64, passphrase, kind, environment, nif, legalName].every(
  (value) => !isUnset(value),
);

function certKind(name: string, value: string): CertKind {
  if (!isCertKind(value)) throw new Error(`${name} must be sello or representante, not ${value}`);
  return value;
}

function deploymentEnvironment(value: string): DeploymentEnvironment {
  if (value !== "preproduction" && value !== "production") {
    throw new Error(
      `WAITRON_CERT_CHECK_ENVIRONMENT must be preproduction or production, not ${value}`,
    );
  }
  return value;
}

describe.runIf(configured)("a real AEAT certificate, checked with the shipped code", () => {
  it("opens the file and asks AEAT about it", async () => {
    const material = {
      pfx: Buffer.from(pfxBase64!, "base64"),
      passphrase: passphrase!,
      certKind: certKind("WAITRON_CERT_CHECK_KIND", kind!),
    };
    const env = deploymentEnvironment(environment!);
    const sendTo = isUnset(addressKind)
      ? material.certKind
      : certKind("WAITRON_CERT_CHECK_ADDRESS_KIND", addressKind);

    const opened = openCertificateFile(material.pfx, material.passphrase);
    if (opened.ok) {
      const { organisation, taxId, issuer, validFrom, validUntil } = opened.details;
      console.log("Certificate:", {
        organisation,
        taxId,
        issuer,
        validFrom: validFrom.toISOString(),
        validUntil: validUntil.toISOString(),
      });
    } else {
      console.log("Certificate could not be opened:", opened.reason);
    }

    const endpointFor = aeatEndpointFor(env);
    const result = await checkWithAuthority({
      material,
      taxpayer: { legalName: legalName!, taxId: nif! },
      timeZone: "Europe/Madrid",
      now: new Date(),
      transport: { endpointFor: () => endpointFor(sendTo), fetchFor: mtlsFetch },
    });

    console.log(`Sent ${material.certKind} certificate to the ${sendTo} address (${env}).`);
    if (result.ok) {
      console.log("AEAT answered:", { endpoint: result.endpoint });
    } else if (result.reason === "aeat_fault") {
      console.log("Refused, aeat_fault:", result.details);
    } else if (result.reason === "aeat_http") {
      console.log("Refused, aeat_http:", result.details);
    } else {
      console.log("Refused:", result.reason);
    }
    expect(result).toBeDefined();
  });
});
