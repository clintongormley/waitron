import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync, chmodSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, URL } from "node:url";

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
  it.each(["", undefined])("names a missing image setting before using a path (%s)", (value) => {
    const root = mkdtempSync(join(tmpdir(), "b3-image-argument-"));
    const env = { ...process.env };
    if (value === undefined) delete env.B3_RECIPE_IMAGE;
    else env.B3_RECIPE_IMAGE = value;
    try {
      const result = spawnSync(
        process.execPath,
        [
          fileURLToPath(new URL("../../bench/box-installer/run.mjs", import.meta.url)),
          "--case",
          "recipe-setup",
          "--run-dir",
          join(root, "check"),
        ],
        { env, encoding: "utf8", timeout: 5000 },
      );
      expect(result.status).toBe(1);
      expect(result.stderr).toContain("B3_RECIPE_IMAGE");
      expect(result.stderr).not.toContain("EISDIR");
      expect(result.stderr).not.toContain("ERR_INVALID_ARG_TYPE");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("identifies a guest that exits before the preload success marker", () => {
    const root = mkdtempSync(join(tmpdir(), "b3-guest-exit-"));
    try {
      writeFileSync(join(root, "uuid"), expected.uuid);
      const qemu = join(root, "qemu-system-x86_64");
      writeFileSync(qemu, "#!/bin/sh\nsleep 0.1\nexit 0\n");
      chmodSync(qemu, 0o700);
      const result = spawnSync(
        process.execPath,
        [
          fileURLToPath(new URL("../../bench/box-installer/run.mjs", import.meta.url)),
          "--case",
          "recipe-setup",
          "--run-dir",
          join(root, "check"),
        ],
        {
          env: {
            ...process.env,
            PATH: `${root}:${process.env.PATH}`,
            B3_POPULATE: "1",
            B3_RECIPE_IMAGE: join(root, "image"),
          },
          encoding: "utf8",
          timeout: 5000,
        },
      );
      expect(result.status).toBe(1);
      expect(result.stderr).toContain("guest exited before B3_PRELOAD_OK");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

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
      "an absent guest image report",
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
