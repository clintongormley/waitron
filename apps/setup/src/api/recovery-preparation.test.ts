import { expect, it, vi } from "vitest";
import { SetupApi } from "./client.js";
const input = {
  binding: {
    module: "fiscal-verifactu",
    action: "restore",
    eventId: "browser-restore",
    sourceId: "selected-copy",
    targetNodeId: "00000000-0000-4000-8000-000000000001",
  },
  context: { selectedSourceId: "selected-copy", oldBoxGone: true, soleRecovery: true },
  nodeRecoverySecret: "node secret",
  proposal: { action: "clock-challenge" },
};
it.each([
  { kind: "bucket" as const, kit: "private kit", environment: "production" as const },
  { kind: "cloud" as const, pointId: "00000000-0000-4000-8000-000000000002" },
])("prepares the selected $kind through the authenticated source endpoint", async (source) => {
  const transport = vi.fn<typeof fetch>(async () => Response.json({ id: "clock-comparison" }));
  const api = new SetupApi("", transport);
  expect(await api.prepareRecovery(source, input)).toEqual({ id: "clock-comparison" });
  expect(transport).toHaveBeenCalledWith("/setup-api/recovery/preparation", {
    method: "POST",
    credentials: "include",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ source, preparation: input }),
  });
});
it("sends the actual archive with separate backup and node credentials in multipart fields", async () => {
  const transport = vi.fn<typeof fetch>(async () => Response.json({ id: "clock-comparison" }));
  const api = new SetupApi("", transport);
  expect(
    await api.prepareRecovery(
      {
        kind: "archive",
        artifact: new Blob(["encrypted copy"]),
        recoveryKey: "archive password",
        environment: "production",
      },
      input,
    ),
  ).toEqual({ id: "clock-comparison" });
  const [url, init] = transport.mock.calls[0]!;
  expect(url).toBe("/setup-api/recovery/preparation");
  expect(init?.credentials).toBe("include");
  expect(init?.headers).toBeUndefined();
  const form = init?.body as FormData;
  expect(await (form.get("artifact") as Blob).text()).toBe("encrypted copy");
  expect(JSON.parse(String(form.get("request")))).toEqual({
    source: { kind: "archive", recoveryKey: "archive password", environment: "production" },
    preparation: input,
  });
});
it.each(["archive", "cloud"])(
  "preserves a %s preparation refusal for the real form",
  async (kind) => {
    const transport = vi.fn<typeof fetch>(async () =>
      Response.json(
        {
          error: {
            code: "setup.request_invalid",
            params: { field: "nodeRecoverySecret" },
          },
        },
        { status: 400 },
      ),
    );
    const api = new SetupApi("", transport);
    const source =
      kind === "archive"
        ? {
            kind: "archive" as const,
            artifact: new Blob(["copy"]),
            recoveryKey: "password",
            environment: "production" as const,
          }
        : { kind: "cloud" as const, pointId: "selected-point" };
    await expect(api.prepareRecovery(source, input)).rejects.toEqual({
      code: "setup.request_invalid",
      params: { field: "nodeRecoverySecret" },
      status: 400,
    });
  },
);
