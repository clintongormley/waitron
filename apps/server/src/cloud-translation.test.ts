import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { jobFingerprint, submitSignedBody, translationEnvelope } from "./cloud-translation.js";

const read = (name: string) =>
  JSON.parse(readFileSync(new URL(`../test/${name}`, import.meta.url), "utf8"));
const v = read("cloud-translation-vector.json") as {
  origin: string;
  installationId: string;
  operationId: string;
  issuedAt: number;
  lease: unknown;
  cases: {
    name: string;
    expect: string;
    envelope: { payload: string; signature: string; body: string };
  }[];
};
const keys = read("cloud-installation-vector.json") as { privateKey: string };
const state = {
  origin: v.origin,
  privateKey: keys.privateKey,
  view: { registration: { installationId: v.installationId } },
} as Parameters<typeof translationEnvelope>[0];
const byName = (name: string) => v.cases.find((c) => c.name === name)!.envelope;
const signed = (signedBody: string) =>
  translationEnvelope(
    state,
    "translation-submit",
    { operationId: v.operationId, lease: JSON.stringify(v.lease), signedBody },
    v.issuedAt,
  );
const sent = (e: { payload: string; signature: string }) => ({
  payload: e.payload,
  signature: e.signature,
});

describe("translation submit signing matches the shared vectors", () => {
  it("has the four cases the contract names, each with its outcome", () => {
    expect(v.cases.map((c) => [c.name, c.expect])).toEqual([
      ["valid", "accepted"],
      ["changed_body", "401 invalid_proof"],
      ["wrong_length", "401 invalid_proof"],
      ["replayed_operation", "409 conflict after valid"],
    ]);
  });
  it("signs the fingerprint of the valid body, keys in the contract's order", () => {
    const body = byName("valid").body;
    const { jobSha256, jobBytes } = jobFingerprint(body);
    expect(submitSignedBody(body)).toBe(JSON.stringify({ version: 1, jobSha256, jobBytes }));
  });
  it("reproduces the valid envelope byte for byte", () => {
    const e = byName("valid");
    expect(signed(submitSignedBody(e.body))).toEqual(sent(e));
  });
  it("reproduces the wrong-length envelope, whose jobBytes is one more than the body's", () => {
    const e = byName("wrong_length");
    const f = jobFingerprint(e.body);
    expect(e.body).toBe(byName("valid").body);
    expect(
      signed(JSON.stringify({ version: 1, jobSha256: f.jobSha256, jobBytes: f.jobBytes + 1 })),
    ).toEqual(sent(e));
  });
  it("reproduces the replayed envelope: the valid case's operation ID, another fingerprint", () => {
    const e = byName("replayed_operation");
    expect(signed(submitSignedBody(e.body))).toEqual(sent(e));
    expect(jobFingerprint(e.body).jobSha256).not.toBe(
      jobFingerprint(byName("valid").body).jobSha256,
    );
  });
  it("a changed byte keeps the valid envelope and changes the hash, not the length", () => {
    const valid = byName("valid");
    const changed = byName("changed_body");
    expect(sent(changed)).toEqual(sent(valid));
    expect(jobFingerprint(changed.body).jobBytes).toBe(jobFingerprint(valid.body).jobBytes);
    expect(jobFingerprint(changed.body).jobSha256).not.toBe(jobFingerprint(valid.body).jobSha256);
  });
  it("counts bytes, not characters", () => {
    expect(jobFingerprint("Cigaló").jobBytes).toBe(7);
  });
});
