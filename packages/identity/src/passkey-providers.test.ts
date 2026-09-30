import { describe, expect, it } from "vitest";
import { PASSKEY_PROVIDER_NAMES, passkeyProviderName } from "./passkey-providers.js";

const GOOGLE = "ea9b8d66-4d01-1d21-3ce4-b6b48cb575d4";

describe("passkey provider names", () => {
  it("names the password manager an authenticator identifier belongs to", () => {
    expect(passkeyProviderName(GOOGLE)).toBe("Google Password Manager");
    expect(passkeyProviderName("bada5566-a7aa-401f-bd96-45619a55120d")).toBe("1Password");
  });

  it("reads an identifier written in capitals the same way", () => {
    expect(passkeyProviderName(GOOGLE.toUpperCase())).toBe("Google Password Manager");
  });

  it.each([
    [
      "the all-zero identifier registration reports when nothing names a provider",
      "00000000-0000-0000-0000-000000000000",
    ],
    ["an identifier the list does not hold", "12345678-1234-1234-1234-123456789abc"],
    ["no identifier at all", null],
  ])("names nobody for %s", (_case, aaguid) => {
    expect(passkeyProviderName(aaguid)).toBeNull();
  });

  it("holds only lowercase identifiers with a name", () => {
    const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
    for (const [aaguid, name] of Object.entries(PASSKEY_PROVIDER_NAMES)) {
      expect(aaguid).toMatch(uuid);
      expect(name.trim()).not.toBe("");
    }
  });
});
