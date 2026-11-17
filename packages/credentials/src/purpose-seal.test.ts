import { describe, expect, it } from "vitest";
import * as credentials from "./index.js";
import type { KeyEntry, KeyRing } from "./keyring.js";

const { purposeKey, purposeKeys, sealText, openText } = credentials;
const previous = { version: 1, key: Buffer.alloc(32, 1) };
const current = { version: 2, key: Buffer.alloc(32, 2) };
const ring: KeyRing = { current, previous };
const firstKey = "479a4818435668c1a3f3f30ad7204823ef6c5cbc1328bcacc9d45f315ee16036";
const secondKey = "db0016a1eb32c44082ba76462d0a6873fdd76240f89bd2e8d25f7d3f42094737";

describe("text sealed for a purpose", () => {
  it.each(["02", "+2", " 2", "0x2", "2e0"])("refuses a noncanonical key version: %s", (version) => {
    const parts = sealText(ring, "totp", "synthetic-value").split(".");
    parts[1] = version;
    expect(openText(ring, "totp", parts.join("."))).toBeNull();
  });

  it("seals and opens text under the same purpose", () => {
    expect(openText(ring, "totp", sealText(ring, "totp", "synthetic-value"))).toEqual({
      value: "synthetic-value",
      keyVersion: 2,
    });
  });
  it.each([
    ["totp", "account-action-code"],
    ["account-action-code", "totp"],
  ])("refuses moving %s text to %s", (from, to) => {
    expect(openText(ring, to, sealText(ring, from, "synthetic-value"))).toBeNull();
  });
  it("opens the previous version while the ring holds its key", () => {
    const stored = sealText({ current: previous }, "totp", "synthetic-value");
    expect(openText(ring, "totp", stored)).toEqual({ value: "synthetic-value", keyVersion: 1 });
    expect(openText({ current }, "totp", stored)).toBeNull();
  });
  it("returns null when authenticated ciphertext is tampered with", () => {
    const parts = sealText(ring, "totp", "synthetic-value").split(".");
    const body = Buffer.from(parts[4]!, "base64url");
    body[0]! ^= 1;
    parts[4] = body.toString("base64url");
    expect(openText(ring, "totp", parts.join("."))).toBeNull();
  });
  it.each(["v1.2.a.b.c", "v2.2.a.b", "v2.invalid.a.b.c", "v2.2.a.b.c"])(
    "returns null for an unusable stored value %s",
    (stored) => {
      expect(openText(ring, "totp", stored)).toBeNull();
    },
  );
  it("stamps the current key version and refuses a v1 prefix on valid ciphertext", () => {
    const stored = sealText(ring, "totp", "synthetic-value");
    expect(stored.split(".").slice(0, 2)).toEqual(["v2", "2"]);
    expect(openText(ring, "totp", stored.replace(/^v2/, "v1"))).toBeNull();
  });
  it("derives purpose-separated keys from each version's key bytes", () => {
    expect(purposeKey(previous, "totp").toString("hex")).toBe(firstKey);
    expect(purposeKey(current, "totp").toString("hex")).toBe(secondKey);
    expect(purposeKey(current, "account-action-code").equals(purposeKey(current, "totp"))).toBe(
      false,
    );
  });
  it("lists the previous purpose key after the current one only when present", () => {
    expect(purposeKeys(ring, "totp").map((key) => key.toString("hex"))).toEqual([
      secondKey,
      firstKey,
    ]);
    expect(purposeKeys({ current }, "totp").map((key) => key.toString("hex"))).toEqual([secondKey]);
  });
});

describe("text opened with already derived purpose keys", () => {
  const source: KeyRing = {
    current: { version: 7, key: Buffer.alloc(32, 2) },
    previous: { version: 3, key: Buffer.alloc(32, 1) },
  };
  const keys: KeyEntry[] = [source.current, source.previous!].map((entry) => ({
    version: entry.version,
    key: purposeKey(entry, "totp"),
  }));
  const reader = () => credentials.openTextWithPurposeKeys;

  it("opens current and previous original versions without deriving the supplied keys again", () => {
    const vectors = [
      [7, "v2.7.gXWBJDSAdhLuvxpE.qmjCaN1x9i11ugMxhMTEBA.AjdnlO7_9cei9FScYL_ngA"],
      [3, "v2.3.qwQzN_pSqIwkrqBP.ZJNoHtoL-FVvloeoEe3jvg.nTUvwNhi4m3XuILtrU2Qyg"],
    ] as const;
    for (const [keyVersion, stored] of vectors)
      expect(reader()(keys, "totp", stored)).toEqual({ value: "JBSWY3DPEHPK3PXP", keyVersion });
    expect(
      reader()(
        [{ version: 1, key: purposeKey(source.previous!, "totp") }],
        "totp",
        "v2.1.i5AiyWwbKPxP1T9s.nkXQF6k35i853zbrXbPj9w.qDLPH9WDL9XbHO5G7SPjwQ",
      ),
    ).toEqual({ value: "JBSWY3DPEHPK3PXP", keyVersion: 1 });
  });
  it("refuses absent, mismatched and raw vault keys, and another purpose", () => {
    const stored = sealText(source, "totp", "synthetic-value");
    for (const rejected of [
      [],
      [keys[1]!],
      [{ ...keys[0]!, version: 1 }],
      [source.current],
      [{ ...keys[0]!, key: Buffer.alloc(32) }],
    ])
      expect(reader()(rejected, "totp", stored)).toBeNull();
    expect(reader()(keys, "account-action-code", stored)).toBeNull();
  });
  it.each(["v1.7.a.b.c", "v2.07.a.b.c", "v2.7.a.b", "v2.7.a.b.c"])(
    "refuses unusable ciphertext %s",
    (stored) => {
      expect(reader()(keys, "totp", stored)).toBeNull();
    },
  );
});
