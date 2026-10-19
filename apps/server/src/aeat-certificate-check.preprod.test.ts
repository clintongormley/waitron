// Checks a real AEAT certificate with the code an install runs, and prints what it finds. It asks
// AEAT a read-only `consultar` question and files nothing.
//
//   WAITRON_CERT_CHECK_PFX_BASE64   the .p12/.pfx file, base64-encoded
//   WAITRON_CERT_CHECK_PASSPHRASE   its passphrase
//   WAITRON_CERT_CHECK_KIND         sello | representante
//   WAITRON_CERT_CHECK_ENVIRONMENT  preproduction | production
//   WAITRON_CERT_CHECK_NIF          the taxpayer's tax ID
//   WAITRON_CERT_CHECK_NOMBRE       the taxpayer's legal name
//   WAITRON_CERT_CHECK_ADDRESS_KIND optional, sello | representante: send to that type's address
//                                   instead, to see how AEAT answers the wrong type
//
//   pnpm --filter @waitron/server test:preprod src/aeat-certificate-check.preprod.test.ts
//
// With any required variable unset the suite is skipped and makes no network call.
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

const pfxBase64 = process.env.WAITRON_CERT_CHECK_PFX_BASE64;
const passphrase = process.env.WAITRON_CERT_CHECK_PASSPHRASE;
const kind = process.env.WAITRON_CERT_CHECK_KIND;
const environment = process.env.WAITRON_CERT_CHECK_ENVIRONMENT;
const nif = process.env.WAITRON_CERT_CHECK_NIF;
const nombre = process.env.WAITRON_CERT_CHECK_NOMBRE;
const addressKind = process.env.WAITRON_CERT_CHECK_ADDRESS_KIND;

const configured =
  pfxBase64 !== undefined &&
  passphrase !== undefined &&
  kind !== undefined &&
  environment !== undefined &&
  nif !== undefined &&
  nombre !== undefined;

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
    const sendTo =
      addressKind === undefined || addressKind === ""
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
      taxpayer: { legalName: nombre!, taxId: nif! },
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
