// Prints the contract's "Shared test vectors" document from the fixed keys of
// test/cloud-installation-vector.json. Run once; commit the output as test/cloud-translation-vector.json.
import { readFileSync } from "node:fs";
import { jobFingerprint, submitSignedBody, translationEnvelope } from "../src/cloud-translation.js";

const base = JSON.parse(
  readFileSync(new URL("../test/cloud-installation-vector.json", import.meta.url), "utf8"),
);
const origin = base.claims.origin as string;
const installationId = base.claims.installationId as string;
const issuedAt = base.claims.issuedAt as number;
const lease = base.lease as object;
const operationId = "52345678-1234-4234-8234-123456789abc";
const state = {
  origin,
  privateKey: base.privateKey,
  view: { registration: { installationId } },
} as never;
const job = (staffName: string) =>
  JSON.stringify({
    version: 1,
    country: "ES",
    languages: { default: "ca", enabled: ["ca", "es", "en"] },
    items: [
      {
        ref: "variant:812",
        kind: "variant",
        family: "product:640",
        category: "TAP BEERS",
        staffName,
        existing: { en: "Pint" },
        missing: ["ca", "es"],
      },
    ],
    houseStyle: [
      { kind: "product", staffName: "CARAJILLO", names: { ca: "Cigaló", es: "Carajillo" } },
    ],
  });
const envelope = (signedBody: string, body: string) => ({
  ...translationEnvelope(
    state,
    "translation-submit",
    { operationId, lease: JSON.stringify(lease), signedBody },
    issuedAt,
  ),
  body,
});
const valid = job("PINTA");
const f = jobFingerprint(valid);
const other = job("CANYA");
console.log(
  JSON.stringify(
    {
      origin,
      installationId,
      operationId,
      issuedAt,
      publicKey: base.publicKey,
      issuerPublicKey: base.issuerPublicKey,
      issuerKeyId: base.issuerKeyId,
      lease,
      cases: [
        { name: "valid", expect: "accepted", envelope: envelope(submitSignedBody(valid), valid) },
        {
          name: "changed_body",
          expect: "401 invalid_proof",
          envelope: {
            ...envelope(submitSignedBody(valid), valid),
            body: valid.replace("PINTA", "PINTO"),
          },
        },
        {
          name: "wrong_length",
          expect: "401 invalid_proof",
          envelope: envelope(
            JSON.stringify({ version: 1, jobSha256: f.jobSha256, jobBytes: f.jobBytes + 1 }),
            valid,
          ),
        },
        {
          name: "replayed_operation",
          expect: "409 conflict after valid",
          envelope: envelope(submitSignedBody(other), other),
        },
      ],
      source: "waitron",
    },
    null,
    2,
  ),
);
