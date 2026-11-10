import { describe, expect, it } from "vitest";

const expected = {
  uuid: "5418a8bb-eeb9-4e94-832f-72629874781e",
  sha256: "original-root",
  images: { app: "app-config", "print-agent": "agent-config", mailpit: "mail-config" },
};
const complete = {
  uuid: expected.uuid,
  hashBefore: "original-root",
  hashAfter: "original-root",
  images: { app: "app-config", "print-agent": "agent-config", mailpit: "mail-config" },
  services: { app: "running", "print-agent": "running", mailpit: "running" },
  status: { provisioned: false, environment: "preproduction", needs: ["venue"] },
};

describe("recipe boot evidence", () => {
  it("accepts the built root serving fresh setup with all embedded services", async () => {
    await expect(
      import("./recipe-setup.mjs").then(({ recipeFailures }) => recipeFailures(expected, complete)),
    ).resolves.toEqual([]);
  });

  it.each([
    ["another root", { uuid: "another-root" }, ["root-uuid"]],
    ["a changed input", { hashBefore: "different" }, ["artifact"]],
    ["persistent boot writes", { hashAfter: "different" }, ["artifact"]],
    [
      "an absent inventory",
      { images: undefined },
      ["image:app", "image:print-agent", "image:mailpit"],
    ],
    [
      "an incomplete guest",
      { services: {} },
      ["service:app", "service:print-agent", "service:mailpit"],
    ],
    [
      "no service report",
      { services: undefined },
      ["service:app", "service:print-agent", "service:mailpit"],
    ],
    ["another app", { images: { ...complete.images, app: "wrong" } }, ["image:app"]],
    [
      "a stopped agent",
      { services: { ...complete.services, "print-agent": "exited" } },
      ["service:print-agent"],
    ],
  ])("refuses %s", async (_label, patch, failures) => {
    await expect(
      import("./recipe-setup.mjs").then(({ recipeFailures }) =>
        recipeFailures(expected, { ...complete, ...patch }),
      ),
    ).resolves.toEqual(failures);
  });

  it.each([
    undefined,
    null,
    "not JSON status",
    [],
    {},
    { ...complete.status, provisioned: true },
    { ...complete.status, environment: "production" },
    { ...complete.status, needs: [] },
    { ...complete.status, developmentMode: false },
    { ...complete.status, operation: {} },
    { ...complete.status, operationBlocked: false },
  ])("refuses an unusable setup response %#", async (status) => {
    await expect(
      import("./recipe-setup.mjs").then(({ recipeFailures }) =>
        recipeFailures(expected, { ...complete, status }),
      ),
    ).resolves.toEqual(["setup-status"]);
  });
});
