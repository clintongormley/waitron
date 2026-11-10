import { afterEach, describe, expect, it, vi } from "vitest";
import { checkPackageAccess } from "./package-access.mjs";

afterEach(() => vi.unstubAllGlobals());

const associated = {
  name: "contract",
  package_type: "npm",
  visibility: "private",
  repository: { full_name: "waitron-io/waitron-cloud" },
};

function api({
  scopes = "read:packages, write:packages",
  metadata = associated,
  status = 200,
  userStatus = 200,
  broken = false,
} = {}) {
  vi.stubGlobal("fetch", async (url, options) => {
    expect(options.headers.Authorization).toBe("Bearer test-secret");
    if (broken) throw new Error("test-secret should never be logged");
    if (url.endsWith("/user"))
      return globalThis.Response.json(
        { login: "publisher", id: 17 },
        { status: userStatus, headers: scopes === null ? {} : { "X-OAuth-Scopes": scopes } },
      );
    expect(url).toBe("https://api.github.com/orgs/waitron-io/packages/npm/contract");
    return globalThis.Response.json(metadata, { status });
  });
}

describe("the publishing token's package authority", () => {
  it("reports authenticated identity and the existing private Cloud association", async () => {
    api();
    await expect(checkPackageAccess("test-secret")).resolves.toEqual({
      login: "publisher",
      userId: 17,
      package: "@waitron-io/contract",
      visibility: "private",
      repository: "waitron-io/waitron-cloud",
    });
  });

  it.each([
    [{ userStatus: 401 }, /GitHub.*401/],
    [{ scopes: "read:packages" }, /write:packages/],
    [{ scopes: null }, /write:packages/],
    [{ metadata: { ...associated, repository: undefined } }, /association/],
    [{ metadata: { ...associated, visibility: "public" } }, /private/],
    [{ metadata: { ...associated, repository: { full_name: "other/repository" } } }, /association/],
    [{ status: 403 }, /GitHub.*403/],
    [{ broken: true }, /GitHub request failed/],
  ])("refuses unusable authority or association %j", async (input, message) => {
    api(input);
    await expect(checkPackageAccess("test-secret")).rejects.toThrow(message);
    await expect(checkPackageAccess("test-secret")).rejects.not.toThrow("test-secret");
  });

  it("allows the new contract's absent metadata only before publication", async () => {
    api({ status: 404 });
    await expect(checkPackageAccess("test-secret")).resolves.toMatchObject({
      package: "@waitron-io/contract",
      visibility: "not published",
    });
    await expect(checkPackageAccess("test-secret", { published: true })).rejects.toThrow(/404/);
  });

  it("refuses a missing token before any request", async () => {
    vi.stubGlobal("fetch", () => {
      throw new Error("must not request");
    });
    await expect(checkPackageAccess("")).rejects.toThrow(/token/);
  });
});
