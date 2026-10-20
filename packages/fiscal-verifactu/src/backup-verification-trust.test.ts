import { createHash } from "node:crypto";
import { expect, it } from "vitest";
import { fiscalBackupPublicEvidenceDigest } from "./backup-verification-trust.js";

it("binds an unconfigured release to explicit absent trust", () => {
  expect(fiscalBackupPublicEvidenceDigest()).toBe(
    createHash("sha256").update("[null,[]]").digest("hex"),
  );
});
it("binds all public root fields in canonical order rather than serialising a Map", () => {
  const input = {
    cloud: {
      issuer: "reviewed-issuer",
      keys: new Map([
        ["b", "key-b"],
        ["a", "key-a"],
      ]),
    },
    paper: [
      { custodianId: "y", publicKey: "pem-y", fingerprint: "fingerprint-y" },
      { custodianId: "x", publicKey: "pem-x", fingerprint: "fingerprint-x" },
    ],
  };
  const expected = createHash("sha256")
    .update(
      '[["reviewed-issuer",[["a","key-a"],["b","key-b"]]],[["x","pem-x","fingerprint-x"],["y","pem-y","fingerprint-y"]]]',
    )
    .digest("hex");
  expect(fiscalBackupPublicEvidenceDigest(input)).toBe(expected);
  expect(
    fiscalBackupPublicEvidenceDigest({
      ...input,
      cloud: { ...input.cloud, keys: new Map([...input.cloud.keys].reverse()) },
      paper: [...input.paper].reverse(),
    }),
  ).toBe(expected);
  expect(
    fiscalBackupPublicEvidenceDigest({ ...input, cloud: { ...input.cloud, issuer: "other" } }),
  ).not.toBe(expected);
  expect(
    fiscalBackupPublicEvidenceDigest({
      ...input,
      paper: [{ ...input.paper[0]!, fingerprint: "other" }, input.paper[1]!],
    }),
  ).not.toBe(expected);
});
