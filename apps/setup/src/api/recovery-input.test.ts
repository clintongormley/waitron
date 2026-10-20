import { expect, it, vi } from "vitest";
import { SetupApi } from "./client.js";

const credentials = {
  recoveryOperation: {
    binding: {
      module: "test-regime",
      action: "restore",
      eventId: "paper-42",
      sourceId: "selected-digest",
      targetNodeId: "d0000000-0000-4000-8000-000000000001",
    },
    input: { signed: "outside-allocation" },
  },
  nodeRecoverySecret: "node-key-separate",
};

it("sends the archive and separate recovery credentials in multipart fields, leaving Content-Type to the browser", async () => {
  const transport = vi.fn<typeof fetch>(async () =>
    Response.json({ restoreStaged: true, restarting: true }, { status: 202 }),
  );
  const api = new SetupApi("", transport);
  await api.restore(
    new Blob(["encrypted-copy"]),
    "archive-key",
    "preproduction",
    true,
    credentials,
  );
  expect(transport.mock.calls[0]![0]).toBe("/setup-api/restore");
  const init = transport.mock.calls[0]![1]!;
  expect(init.headers).toBeUndefined();
  expect(init.credentials).toBe("include");
  const form = init.body as FormData;
  expect(form).toBeInstanceOf(FormData);
  expect(form.get("recoveryKey")).toBe("archive-key");
  expect(form.get("environment")).toBe("preproduction");
  expect(form.get("oldBoxGone")).toBe("1");
  expect(form.get("nodeRecoverySecret")).toBe("node-key-separate");
  expect(JSON.parse(String(form.get("recoveryOperation")))).toEqual(credentials.recoveryOperation);
  expect(await (form.get("artifact") as Blob).text()).toBe("encrypted-copy");
});

it("forwards Cloud recovery credentials in JSON, with no credential in the URL", async () => {
  const transport = vi.fn<typeof fetch>(async () =>
    Response.json({ restoreStaged: true, restarting: true }, { status: 202 }),
  );
  const api = new SetupApi("", transport);
  await api.restoreFromCloud("selected-point", true, credentials);
  expect(transport).toHaveBeenCalledWith("/setup-api/cloud-recovery/restore", {
    method: "POST",
    credentials: "include",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ pointId: "selected-point", oldBoxGone: true, ...credentials }),
  });
});

it("preserves the refusal and its field when a multipart recovery is rejected", async () => {
  const api = new SetupApi("", async () =>
    Response.json(
      { error: { code: "setup.request_invalid", params: { field: "nodeRecoverySecret" } } },
      { status: 400 },
    ),
  );
  await expect(
    api.restore(new Blob(["encrypted-copy"]), "archive-key", "preproduction", true, credentials),
  ).rejects.toEqual({
    code: "setup.request_invalid",
    params: { field: "nodeRecoverySecret" },
    status: 400,
  });
});

it("keeps the selected source and isolation declarations in archive multipart recovery", async () => {
  let submitted: FormData | undefined;
  const api = new SetupApi("", async (_url, init) => {
    submitted = init?.body as FormData;
    return Response.json({ restoreStaged: true, restarting: true }, { status: 202 });
  });
  const recoveryContext = {
    selectedSourceId: "selected-digest",
    oldBoxGone: true,
    soleRecovery: true,
  };
  await api.restore(new Blob(["encrypted-copy"]), "archive-key", "preproduction", true, {
    ...credentials,
    recoveryContext,
  });
  expect(submitted?.get("recoveryContext")).toBe(JSON.stringify(recoveryContext));
  expect(submitted?.get("nodeRecoverySecret")).toBe("node-key-separate");
  expect(JSON.parse(String(submitted?.get("recoveryOperation")))).toEqual(
    credentials.recoveryOperation,
  );
});
