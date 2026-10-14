import { Hono } from "hono";
import { expect, it, vi } from "vitest";
import { AppError } from "@waitron/shared";
import { mountSetup } from "./setup-api.js";

const pointId = "047bacd4-df70-4881-a835-c6dd75ae7ecf";
const selected = {
  sourceId: "copy",
  createdAt: "2026-10-01T08:00:00.000Z",
  environment: "preproduction" as const,
  nodeId: "d0000000-0000-4000-8000-000000000001",
  nodeRecoveryKeyName: "Amber Hill",
  taxpayer: { legalName: "Saved venue", taxId: "89890001K" },
  locationName: "Saved location",
};
const send = (app: Hono, kind: string, body: unknown) =>
  app.request(
    kind === "cloud" ? "/setup-api/cloud-recovery/preview" : "/setup-api/restore-bucket/preview",
    { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) },
  );
function fixture() {
  const app = new Hono();
  const readBucket = vi.fn(async () => selected);
  const readCloud = vi.fn(async () => selected);
  const stage = vi.fn();
  const restart = vi.fn();
  const log = vi.fn();
  mountSetup(
    app,
    {
      environment: "preproduction",
      previewBucketRestore: readBucket,
      previewCloudRestore: readCloud,
      stageRestore: stage,
      stageBucketRestore: stage,
      requestRestart: restart,
    },
    log,
  );
  return { app, readBucket, readCloud, stage, restart, log };
}
it.each(["bucket", "cloud"])(
  "previews the %s copy without staging, restart, cache or credentials in logs",
  async (kind) => {
    const f = fixture();
    const body =
      kind === "bucket"
        ? { kit: "private-kit", environment: "preproduction", oldBoxGone: true }
        : { pointId };
    const response = await send(f.app, kind, body);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(selected);
    expect(response.headers.get("cache-control")).toBe("no-store");
    if (kind === "bucket") expect(f.readBucket).toHaveBeenCalledWith(body);
    else expect(f.readCloud).toHaveBeenCalledWith(pointId);
    expect(f.stage).not.toHaveBeenCalled();
    expect(f.restart).not.toHaveBeenCalled();
    expect(JSON.stringify(f.log.mock.calls)).not.toContain("private-kit");
  },
);
it.each([
  [{ kit: "", environment: "preproduction" }, "kit"],
  [{ kit: "x".repeat(65537), environment: "preproduction" }, "kit"],
  [{ kit: "private", environment: null }, "environment"],
  [{ kit: "private", environment: "preproduction", oldBoxGone: null }, "oldBoxGone"],
  [{ kit: "private", environment: "preproduction", oldBoxGone: "yes" }, "oldBoxGone"],
] as const)("rejects invalid bucket preview input %j", async (body, field) => {
  const f = fixture();
  const response = await send(f.app, "bucket", body);
  expect(response.status).toBe(400);
  expect(await response.json()).toEqual({
    error: { code: "setup.request_invalid", params: { field } },
  });
  expect(f.readBucket).not.toHaveBeenCalled();
});
it.each([null, "wrong", 123])("rejects invalid Cloud point %j", async (pointId) => {
  const f = fixture();
  const response = await send(f.app, "cloud", { pointId });
  expect(response.status).toBe(400);
  expect(await response.json()).toEqual({
    error: { code: "setup.request_invalid", params: { field: "pointId" } },
  });
  expect(f.readCloud).not.toHaveBeenCalled();
});
it.each(["bucket", "cloud"])("releases %s preview's gate after failure", async (kind) => {
  const f = fixture();
  (kind === "bucket" ? f.readBucket : f.readCloud).mockRejectedValueOnce(
    new AppError("restore.environment_mismatch", { backup: "production", target: "preproduction" }),
  );
  const body = kind === "bucket" ? { kit: "private", environment: "preproduction" } : { pointId };
  const refused = await send(f.app, kind, body);
  expect(refused.status).toBe(409);
  expect(await refused.json()).toEqual({
    error: {
      code: "restore.environment_mismatch",
      params: { backup: "production", target: "preproduction" },
    },
  });
  expect((await send(f.app, kind, body)).status).toBe(200);
});
it("holds the shared setup gate while a copy is downloaded", async () => {
  let resolve!: (value: typeof selected) => void;
  const f = fixture();
  f.readBucket.mockImplementation(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  const pending = send(f.app, "bucket", { kit: "private", environment: "preproduction" });
  await vi.waitFor(() => expect(f.readBucket).toHaveBeenCalledOnce());
  const response = await send(f.app, "cloud", { pointId });
  expect(response.status).toBe(409);
  expect(await response.json()).toEqual({
    error: { code: "setup.already_provisioning", params: {} },
  });
  resolve(selected);
  expect((await pending).status).toBe(200);
  expect((await send(f.app, "cloud", { pointId })).status).toBe(200);
});
it.each(["bucket", "cloud"])("reports unavailable %s preview", async (kind) => {
  const app = new Hono();
  mountSetup(app, { environment: "preproduction" }, () => {});
  const response = await send(app, kind, {});
  expect(response.status).toBe(503);
  expect(await response.json()).toEqual({ error: { code: "setup.not_ready", params: {} } });
});
