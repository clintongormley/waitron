import { describe, expect, it } from "vitest";
import * as helpers from "../../index.js";
const { withFoldedPersonChanges, withFoldedPersonKeys } = helpers;

describe("person comparison keys", () => {
  it("fills all three folded keys without changing the raw values", () => {
    const input = {
      displayName: " JOS\u00c9 GARC\u00cdA ",
      email: " ADA@X.COM ",
      pendingEmail: " NEXT@X.COM ",
    };
    expect(withFoldedPersonKeys(input)).toEqual({
      ...input,
      displayNameFolded: "jos\u00e9 garc\u00eda",
      emailFolded: "ada@x.com",
      pendingEmailFolded: "next@x.com",
    });
    expect(input).not.toHaveProperty("displayNameFolded");
  });
  it("leaves explicitly supplied folded keys alone", () => {
    const input = {
      displayName: "Ada",
      displayNameFolded: "given",
      email: "ADA@X.COM",
      emailFolded: "given-email",
      pendingEmail: "NEXT@X.COM",
      pendingEmailFolded: null,
    };
    expect(withFoldedPersonKeys(input)).toEqual(input);
  });
  it("fills null address twins and leaves absent address twins unset", () => {
    expect(withFoldedPersonKeys({ displayName: "Ada", email: null, pendingEmail: null })).toEqual({
      displayName: "Ada",
      displayNameFolded: "ada",
      email: null,
      emailFolded: null,
      pendingEmail: null,
      pendingEmailFolded: null,
    });
    expect(withFoldedPersonKeys({ displayName: "Ada" })).toEqual({
      displayName: "Ada",
      displayNameFolded: "ada",
    });
  });
  it("folds each row of an array", () => {
    expect(withFoldedPersonKeys([{ displayName: "ADA" }, { displayName: "BEGO\u00d1A" }])).toEqual([
      { displayName: "ADA", displayNameFolded: "ada" },
      { displayName: "BEGO\u00d1A", displayNameFolded: "bego\u00f1a" },
    ]);
  });
  it("updates supplied raw fields and leaves unrelated changes alone", () => {
    expect(
      withFoldedPersonChanges({ displayName: " JOSE\u0301 ", email: null, status: "active" }),
    ).toEqual({
      displayName: " JOSE\u0301 ",
      displayNameFolded: "jos\u00e9",
      email: null,
      emailFolded: null,
      status: "active",
    });
    expect(withFoldedPersonChanges({ pendingEmail: "NEXT@X.COM" })).toEqual({
      pendingEmail: "NEXT@X.COM",
      pendingEmailFolded: "next@x.com",
    });
    expect(withFoldedPersonChanges({ status: "suspended", displayNameFolded: "given" })).toEqual({
      status: "suspended",
      displayNameFolded: "given",
    });
  });
});
