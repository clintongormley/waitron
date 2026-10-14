import { createHash, createPublicKey, generateKeyPairSync, verify } from "node:crypto";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import * as adapter from "./cloud-fiscal-allocation.js";
import { createCloudFiscalAllocationClient } from "./cloud-fiscal-allocation-client.js";

let directory: string;
beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), "fiscal-reconciliation-"));
});
afterEach(async () => {
  if (directory) await rm(directory, { recursive: true, force: true });
});
const operationId = "10000000-0000-4000-8000-000000000001";
const receiptId = "10000000-0000-4000-8000-000000000005";
const body = {
  venueId: "10000000-0000-4000-8000-000000000002",
  scope: { taxpayerNif: "89890001K", softwareId: "WT", environment: "preproduction" },
  receipt: { signed: "public-receipt" },
  paperHistory: null,
  activationEvidence: { eventId: "local-activation" },
};
const keys = generateKeyPairSync("ed25519");
const privateKey = keys.privateKey.export({ type: "pkcs8", format: "der" }).toString("base64url");
const authentication = {
  origin: "https://cloud.example",
  installationId: "10000000-0000-4000-8000-000000000007",
  privateKey,
  lease: { payload: "secret-live-lease", signature: "lease-signature" },
  now: 1700000000000,
};

function api() {
  const value = adapter as unknown as {
    signCloudFiscalReport: (input: unknown) => { payload: string; signature: string };
    reconcileCloudFiscalAllocation: (input: unknown) => Promise<unknown>;
  };
  expect(value.signCloudFiscalReport).toBeTypeOf("function");
  expect(value.reconcileCloudFiscalAllocation).toBeTypeOf("function");
  return value;
}
function proof(heldBody = body, id = operationId, auth = authentication) {
  return api().signCloudFiscalReport({ ...auth, operationId: id, body: heldBody });
}
async function reconcile(
  transport: unknown,
  heldBody: unknown = body,
  authenticate: unknown = async () => authentication,
) {
  return api().reconcileCloudFiscalAllocation({
    directory,
    transport,
    operation: { operationId, body: heldBody },
    authenticate,
  });
}
it("signs the exact domain, body digest and current authentication without changing the stable report identity", () => {
  const value = proof();
  const payload: unknown[] = JSON.parse(Buffer.from(value.payload, "base64url").toString("utf8"));
  expect(payload.slice(0, 8)).toEqual([
    "waitron.fiscal-machine-report",
    1,
    "https://cloud.example",
    "report",
    "10000000-0000-4000-8000-000000000007",
    operationId,
    1700000000000,
    JSON.stringify(authentication.lease),
  ]);
  expect(payload[8]).toBe("b282353acc36ded57f9719228274539d31809d1be80e58804649c077f0ba86cc");
  expect(payload[9]).toEqual(body);
  expect(
    verify(
      null,
      Buffer.from(value.payload, "base64url"),
      createPublicKey(keys.privateKey),
      Buffer.from(value.signature, "base64url"),
    ),
  ).toBe(true);
});
it.each(["operationId", "installationId", "origin", "privateKey", "lease", "now"])(
  "refuses invalid machine %s before sending",
  (field) => {
    const held = { ...authentication, operationId, body, [field]: field === "now" ? -1 : "" };
    expect(() => api().signCloudFiscalReport(held)).toThrowError(
      expect.objectContaining({ code: "cloud.request_invalid" }),
    );
  },
);
it("retains one successful report and makes no later request for the same result", async () => {
  const report = vi.fn(async () => ({ version: 1, state: "matched", receiptId }));
  expect(await reconcile({ report })).toEqual({ version: 1, state: "matched", receiptId });
  expect(await reconcile({ report })).toEqual({ version: 1, state: "matched", receiptId });
  expect(report).toHaveBeenCalledTimes(1);
  const text = (
    await Promise.all(
      (await readdir(directory)).map((name) => readFile(join(directory, name), "utf8")),
    )
  ).join("");
  expect(text).toContain("public-receipt");
  expect(text).not.toContain(privateKey);
  expect(text).not.toContain(authentication.lease.payload);
});
it("keeps a lost reply pending, then retries the same report with renewed authentication", async () => {
  let call = 0;
  const report = vi.fn(async (...args: unknown[]) => {
    void args;
    if (++call === 1) throw new Error("reply lost");
    return { version: 1, state: "matched", receiptId };
  });
  await expect(reconcile({ report })).rejects.toMatchObject({ code: "cloud.unavailable" });
  expect(
    await reconcile({ report }, body, async () => ({
      ...authentication,
      now: 1700000001000,
      lease: { payload: "renewed-live-lease", signature: "new" },
    })),
  ).toEqual({ version: 1, state: "matched", receiptId });
  const sent = report.mock.calls.map(
    ([value]) =>
      JSON.parse(
        Buffer.from((value as { payload: string }).payload, "base64url").toString("utf8"),
      ) as unknown[],
  );
  expect(sent.map((value) => value[5])).toEqual([operationId, operationId]);
  expect(sent[0]?.[9]).toEqual(sent[1]?.[9]);
  expect(sent[0]?.[7]).not.toBe(sent[1]?.[7]);
});
it("refuses changed evidence for an already retained operation without replacing its original", async () => {
  const report = vi.fn(async () => ({ version: 1, state: "matched", receiptId }));
  await reconcile({ report });
  const before = await Promise.all(
    (await readdir(directory)).sort().map((name) => readFile(join(directory, name), "utf8")),
  );
  await expect(
    reconcile({ report }, { ...body, activationEvidence: { eventId: "other-activation" } }),
  ).rejects.toMatchObject({ code: "cloud.binding_conflict" });
  expect(
    await Promise.all(
      (await readdir(directory)).sort().map((name) => readFile(join(directory, name), "utf8")),
    ),
  ).toEqual(before);
  expect(report).toHaveBeenCalledTimes(1);
});
it("retains a conflict as evidence without resubmitting or changing the operation", async () => {
  const report = vi.fn(async () => ({ version: 1, state: "conflict", receiptId }));
  expect(await reconcile({ report })).toEqual({ version: 1, state: "conflict", receiptId });
  expect(await reconcile({ report })).toEqual({ version: 1, state: "conflict", receiptId });
  expect(report).toHaveBeenCalledTimes(1);
});
it("reports an offline paper history once through the same opaque transport", async () => {
  const paper = {
    ...body,
    receipt: null,
    paperHistory: {
      version: 1,
      block: { payload: { blockId: "signed-paper-block" }, signature: "public-signature" },
      consumptions: [{ eventId: "offline-consumption" }],
    },
  };
  const report = vi.fn(async () => ({ version: 1, state: "recorded", receiptId: null }));
  expect(await reconcile({ report }, paper)).toEqual({
    version: 1,
    state: "recorded",
    receiptId: null,
  });
  await reconcile({ report }, paper);
  expect(report).toHaveBeenCalledTimes(1);
  const claims = JSON.parse(
    Buffer.from(
      (report.mock.calls[0] as unknown as [{ payload: string }])[0].payload,
      "base64url",
    ).toString("utf8"),
  ) as unknown[];
  expect(claims[9]).toEqual(paper);
});
it("keeps the bound report pending after an HTTP 409 instead of inventing a local success", async () => {
  const server = createServer((_request, response) => {
    response.writeHead(409, { "content-type": "application/json" });
    response.end(JSON.stringify({ version: 1, state: "matched", receiptId }));
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  try {
    const transport = createCloudFiscalAllocationClient({
      origin: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
      environment: "dev",
    });
    await expect(reconcile(transport)).rejects.toMatchObject({ code: "cloud.unavailable" });
    expect((await readdir(directory)).filter((name) => name.endsWith(".result.json"))).toEqual([]);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
});

it.each([undefined, { bad: undefined }, { at: new Date() }, { text: "x".repeat(17000) }])(
  "refuses non-JSON or oversized report evidence %#",
  (value) => {
    expect(() =>
      api().signCloudFiscalReport({ ...authentication, operationId, body: value }),
    ).toThrowError(expect.objectContaining({ code: "cloud.request_invalid" }));
  },
);
it("refuses a report whose encoded machine envelope exceeds the HTTP cap", () => {
  expect(() =>
    api().signCloudFiscalReport({
      ...authentication,
      operationId,
      body: { text: "x".repeat(12000) },
    }),
  ).toThrowError(expect.objectContaining({ code: "cloud.request_invalid" }));
});
it("refuses a machine key of a different algorithm", () => {
  const other = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  expect(() =>
    api().signCloudFiscalReport({
      ...authentication,
      operationId,
      body,
      privateKey: other.privateKey.export({ type: "pkcs8", format: "der" }).toString("base64url"),
    }),
  ).toThrowError(expect.objectContaining({ code: "cloud.request_invalid" }));
});
function pendingPath() {
  return join(directory, createHash("sha256").update(operationId).digest("hex") + ".json");
}
it("refuses malformed operation IDs without retaining or sending evidence", async () => {
  const report = vi.fn();
  await expect(
    api().reconcileCloudFiscalAllocation({
      directory,
      operation: { operationId: "invalid", body },
      transport: { report },
      authenticate: async () => authentication,
    }),
  ).rejects.toMatchObject({ code: "cloud.request_invalid" });
  expect(await readdir(directory)).toEqual([]);
  expect(report).toHaveBeenCalledTimes(0);
});
it("does not overlap a report held by another caller", async () => {
  let release = () => {};
  let reached = () => {};
  const waiting = new Promise<void>((resolve) => {
    reached = resolve;
  });
  const paused = new Promise<void>((resolve) => {
    release = resolve;
  });
  const report = vi.fn(async () => ({ version: 1, state: "matched", receiptId }));
  const first = reconcile({ report }, body, async () => {
    reached();
    await paused;
    return authentication;
  });
  await waiting;
  try {
    await expect(reconcile({ report })).rejects.toMatchObject({ code: "cloud.busy" });
  } finally {
    release();
    await first;
  }
  expect(report).toHaveBeenCalledTimes(1);
});
it.each(["json", "directory", "oversized", "shape"])(
  "retains evidence and refuses corrupted %s report state",
  async (variant) => {
    const report = vi.fn(async () => ({ version: 1, state: "matched", receiptId }));
    await reconcile({ report });
    const path = pendingPath() + ".result.json";
    await rm(path);
    if (variant === "directory") await mkdir(path);
    else
      await writeFile(
        path,
        variant === "json"
          ? "{"
          : variant === "oversized"
            ? " ".repeat(32769)
            : JSON.stringify({ version: 1, state: "unknown", receiptId }),
      );
    await expect(reconcile({ report })).rejects.toMatchObject({ code: "cloud.state_invalid" });
    expect(report).toHaveBeenCalledTimes(1);
  },
);
it("keeps the same pending operation if retaining the reply fails", async () => {
  const report = vi.fn(async () => {
    await mkdir(pendingPath() + ".result.json");
    return { version: 1, state: "matched", receiptId };
  });
  await expect(reconcile({ report })).rejects.toMatchObject({ code: "cloud.state_invalid" });
  expect(JSON.parse(await readFile(pendingPath(), "utf8"))).toEqual({
    version: 1,
    operationId,
    body,
  });
  expect((await readdir(directory)).filter((name) => name.endsWith(".lock"))).toEqual([]);
});
it("refuses a malformed success without marking its pending operation complete", async () => {
  await expect(
    reconcile({ report: async () => ({ version: 1, state: "matched", receiptId: "invalid" }) }),
  ).rejects.toMatchObject({ code: "cloud.unavailable" });
  expect((await readdir(directory)).filter((name) => name.endsWith(".result.json"))).toEqual([]);
});
