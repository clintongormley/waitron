import { afterEach, describe, expect, it, vi } from "vitest";
import type { LegalAbout } from "@waitron/shared";
import { aboutHeading, readLegalAbout } from "./legal-about.js";
import { currentLocale, setLocale, t } from "./i18n/t.js";

const originalLocale = currentLocale();

afterEach(() => setLocale(originalLocale));

const RELEASED: LegalAbout = {
  release: { version: "1.2.3", releasedOn: "2026-10-22" },
  build: "test-build",
};
const UNRELEASED: LegalAbout = { release: null, build: "test-build" };

describe("readLegalAbout", () => {
  it("reads /legal/about", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => Response.json(RELEASED));
    await expect(readLegalAbout(fetchImpl)).resolves.toEqual(RELEASED);
    expect(fetchImpl).toHaveBeenCalledWith("/legal/about", { method: "GET" });
  });

  it.each<[string, () => Promise<Response>]>([
    ["status 500", async () => Response.json(RELEASED, { status: 500 })],
    ["invalid JSON", async () => new Response("<html>not json</html>", { status: 200 })],
    [
      "a network error",
      async () => {
        throw new TypeError("Failed to fetch");
      },
    ],
  ])("answers null for a refused or unreadable answer (%s)", async (_, answer) => {
    await expect(readLegalAbout(vi.fn<typeof fetch>(answer))).resolves.toBeNull();
  });
});

describe("aboutHeading", () => {
  it("names the release when there is one, and only the title otherwise, in English", () => {
    setLocale("en");
    expect(aboutHeading(RELEASED)).toBe("About Waitron · 1.2.3");
    expect(aboutHeading(UNRELEASED)).toBe("About Waitron");
    expect(aboutHeading(null)).toBe("About Waitron");
  });

  it("follows the till's language", () => {
    setLocale("es");
    const title = t("about.title");
    expect(title).not.toBe("About Waitron");
    expect(aboutHeading(RELEASED)).toBe(`${title} · 1.2.3`);
    expect(aboutHeading(UNRELEASED)).toBe(title);
    expect(aboutHeading(null)).toBe(title);
  });
});
