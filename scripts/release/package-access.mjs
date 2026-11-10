import assert from "node:assert/strict";

export async function checkPackageAccess(token, packageName, { published = false } = {}) {
  assert(token, "publishing token is missing");
  assert(["ui-core", "contract"].includes(packageName), "unexpected package");
  const request = async (path) => {
    try {
      return await globalThis.fetch(`https://api.github.com${path}`, {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/vnd.github+json",
          "X-GitHub-Api-Version": "2026-03-10",
        },
        signal: globalThis.AbortSignal.timeout(20_000),
      });
    } catch {
      throw new Error(`GitHub request failed: ${path}`);
    }
  };
  const user = await request("/user");
  assert(user.ok, `GitHub identity check returned ${user.status}`);
  const scopes = (user.headers.get("X-OAuth-Scopes") ?? "").split(",").map((s) => s.trim());
  assert(scopes.includes("write:packages"), "publishing token needs write:packages");
  const { login, id: userId } = await user.json();
  const response = await request(`/orgs/waitron-io/packages/npm/${packageName}`);
  const identity = { login, userId, package: `@waitron-io/${packageName}` };
  if (response.status === 404 && packageName === "contract" && !published)
    return { ...identity, visibility: "not published" };
  assert(response.ok, `GitHub package check returned ${response.status}`);
  const metadata = await response.json();
  assert.equal(metadata.visibility, "private", "package must be private");
  assert.equal(
    metadata.repository?.full_name,
    "waitron-io/waitron-cloud",
    "wrong Cloud repository association",
  );
  return {
    ...identity,
    visibility: metadata.visibility,
    repository: metadata.repository.full_name,
  };
}
