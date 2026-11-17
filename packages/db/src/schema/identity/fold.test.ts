import { describe, expect, it } from "vitest";
import * as helpers from "../../index.js";
const { foldForUniqueness, withFoldedPersonChanges, withFoldedPersonKeys } = helpers;

describe("person comparison keys", () => {
  it("fills all three folded keys without changing the raw values", () => {
    const input = {
      displayName: " JOSÉ GARCÍA ",
      email: " ADA@X.COM ",
      pendingEmail: " NEXT@X.COM ",
    };
    expect(withFoldedPersonKeys(input)).toEqual({
      ...input,
      displayNameFolded: "josé garcía",
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
    expect(withFoldedPersonKeys([{ displayName: "ADA" }, { displayName: "BEGOÑA" }])).toEqual([
      { displayName: "ADA", displayNameFolded: "ada" },
      { displayName: "BEGOÑA", displayNameFolded: "begoña" },
    ]);
  });
  it("updates supplied raw fields and leaves unrelated changes alone", () => {
    expect(
      withFoldedPersonChanges({ displayName: " JOSÉ ", email: null, status: "active" }),
    ).toEqual({
      displayName: " JOSÉ ",
      displayNameFolded: "josé",
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
  it("keeps accents while making case and equivalent Unicode spellings agree", () => {
    expect(foldForUniqueness(" JOSÉ GARCÍA ")).toBe("josé garcía");
    expect(foldForUniqueness("José García")).toBe("josé garcía");
    expect(foldForUniqueness("Lopez")).toBe("lopez");
    expect(foldForUniqueness("López")).toBe("lópez");
  });
});
