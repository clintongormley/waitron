import { expect, it, vi } from "vitest";
import { SetupApi } from "./client.js";

const observation = { inspectionId: "a".repeat(64), revision: null, ownerGeneration: null };
const proof = {
  observation,
  nodeRecoverySecret: "selected-node-secret",
  context: { oldBoxGone: true, soleRecovery: true },
};
const root = "/setup-api/first-setup/resolution/backup";

it.each(["archive", "bucket", "cloud"] as const)(
  "authenticates the selected %s through repair multipart without exposing credentials in the URL",
  async (kind) => {
    let received: { url: string; init?: RequestInit } | undefined;
    const api = new SetupApi("", async (url, init) => {
      received = { url: String(url), init };
      return Response.json({ sessionId: "grant" });
    });
    const source =
      kind === "archive"
        ? {
            kind,
            artifact: new Blob(["encrypted-copy"]),
            recoveryKey: "archive-secret",
            environment: "production" as const,
          }
        : kind === "bucket"
          ? { kind, kit: "private-kit", environment: "preproduction" as const }
          : { kind, pointId: "00000000-0000-4000-8000-000000000001" };
    expect(await api.openFirstSetupBackup({ ...proof, source })).toEqual({ sessionId: "grant" });
    expect(received?.url).toBe(`${root}/open`);
    expect(received?.init?.method).toBe("POST");
    expect(received?.init?.credentials).toBe("include");
    expect(received?.init?.headers).toBeUndefined();
    const form = received!.init!.body as FormData;
    const { artifact, ...metadata } = { artifact: undefined, ...source };
    expect(JSON.parse(String(form.get("request")))).toEqual({ ...proof, source: metadata });
    expect([...form.keys()].sort()).toEqual(
      kind === "archive" ? ["artifact", "request"] : ["request"],
    );
    if (artifact) expect(await (form.get("artifact") as Blob).text()).toBe("encrypted-copy");
  },
);

it("keeps committed-target resume, preparation, completion and disposal on the repair endpoints", async () => {
  const transport = vi.fn<typeof fetch>(async () => Response.json({ restarting: true }));
  const api = new SetupApi("", transport);
  const recoveryId = "00000000-0000-4000-8000-000000000002";
  await api.resumeFirstSetupBackup({ ...proof, recoveryId });
  await api.prepareFirstSetupBackup("grant", { action: "clock-challenge" });
  await api.commitFirstSetupBackup("grant", { selected: "unchanged-module-input" });
  await api.closeFirstSetupBackup("grant");
  await api.firstSetupBackupStatus();
  expect(
    transport.mock.calls.map(([url, init]) => ({ url, method: init?.method, body: init?.body })),
  ).toEqual([
    { url: `${root}/resume`, method: "POST", body: JSON.stringify({ ...proof, recoveryId }) },
    {
      url: `${root}/prepare`,
      method: "POST",
      body: JSON.stringify({ sessionId: "grant", proposal: { action: "clock-challenge" } }),
    },
    {
      url: `${root}/commit`,
      method: "POST",
      body: JSON.stringify({ sessionId: "grant", input: { selected: "unchanged-module-input" } }),
    },
    { url: `${root}/close`, method: "POST", body: JSON.stringify({ sessionId: "grant" }) },
    { url: `${root}/status`, method: "GET", body: undefined },
  ]);
});

it("uses repair-only Cloud approval routes, including a POST for the private status", async () => {
  const transport = vi.fn<typeof fetch>(async () => Response.json({ status: "pending" }));
  const api = new SetupApi("", transport);
  await api.startFirstSetupBackupCloud();
  await api.firstSetupBackupCloudStatus();
  await api.startFirstSetupBackupCloudAgain();
  expect(transport.mock.calls.map(([url, init]) => [url, init?.method, init?.body])).toEqual([
    [`${root}/cloud/start`, "POST", "{}"],
    [`${root}/cloud/status`, "POST", "{}"],
    [`${root}/cloud/start-again`, "POST", "{}"],
  ]);
});

it.each(["open", "prepare", "resume", "commit", "close"])(
  "preserves a repair %s refusal's domain code and field",
  async (action) => {
    const api = new SetupApi("", async () =>
      Response.json(
        { error: { code: "setup.request_invalid", params: { field: "nodeRecoverySecret" } } },
        { status: 400 },
      ),
    );
    const invoke = () =>
      action === "open"
        ? api.openFirstSetupBackup({
            ...proof,
            source: { kind: "bucket", kit: "private", environment: "production" },
          })
        : action === "resume"
          ? api.resumeFirstSetupBackup({
              ...proof,
              recoveryId: "00000000-0000-4000-8000-000000000002",
            })
          : action === "prepare"
            ? api.prepareFirstSetupBackup("grant", {})
            : action === "commit"
              ? api.commitFirstSetupBackup("grant", {})
              : api.closeFirstSetupBackup("grant");
    await expect(invoke()).rejects.toEqual({
      code: "setup.request_invalid",
      params: { field: "nodeRecoverySecret" },
      status: 400,
    });
  },
);
