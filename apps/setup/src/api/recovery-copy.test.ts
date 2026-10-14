import { expect, it, vi } from "vitest";
import { SetupApi } from "./client.js";

it("uploads the selected archive to preview without putting its key in the URL", async () => {
  const selected = {
    sourceId: "selected-copy",
    createdAt: "2026-10-01T08:00:00.000Z",
    environment: "preproduction",
    nodeId: "saved-node",
    nodeRecoveryKeyName: "Amber Hill",
    taxpayer: { legalName: "Saved venue", taxId: "89890001K" },
    locationName: "Saved location",
  };
  const transport = vi.fn(async () => new Response(JSON.stringify(selected), { status: 200 }));
  const api = new SetupApi("", transport);
  const archive = new Blob(["encrypted-copy"]);
  expect(await api.previewRestore(archive, "archive-key", "preproduction")).toEqual(selected);
  expect(transport).toHaveBeenCalledWith("/setup-api/restore/preview", {
    method: "POST",
    credentials: "include",
    headers: {
      "content-type": "application/octet-stream",
      "x-waitron-recovery-key": "archive-key",
      "x-waitron-restore-environment": "preproduction",
    },
    body: archive,
  });
});

it("preserves the preview refusal code, field and HTTP status", async () => {
  const api = new SetupApi(
    "",
    async () =>
      new Response(
        JSON.stringify({ error: { code: "setup.request_invalid", params: { field: "artifact" } } }),
        { status: 400 },
      ),
  );
  await expect(
    api.previewRestore(new Blob(["invalid"]), "archive-key", "preproduction"),
  ).rejects.toEqual({ code: "setup.request_invalid", params: { field: "artifact" }, status: 400 });
});

it.each(["bucket", "cloud"])(
  "reviews the %s source with secret inputs only in the request body",
  async (kind) => {
    const metadata = { nodeRecoveryKeyName: "Amber Hill" };
    const transport = vi.fn(async () => Response.json(metadata));
    const api = new SetupApi("", transport);
    const outcome =
      kind === "bucket"
        ? await api.previewBucketRestore("private-kit", "preproduction", true)
        : await api.previewCloudRestore("selected-point");
    expect(outcome).toEqual(metadata);
    expect(transport).toHaveBeenCalledWith(
      kind === "bucket" ? "/setup-api/restore-bucket/preview" : "/setup-api/cloud-recovery/preview",
      {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(
          kind === "bucket"
            ? { kit: "private-kit", environment: "preproduction", oldBoxGone: true }
            : { pointId: "selected-point" },
        ),
      },
    );
  },
);
