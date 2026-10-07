import { describe, expect, it } from "vitest";
import { createClient } from "./client.js";

const id = "00000000-0000-4000-8000-000000000001";
const token = "00000000-0000-4000-8000-000000000002";
const inventory = { visible: [], scanned: [], pairedBluetooth: [], bluetoothOutcomes: [] };
function client(invoiceClaim: unknown) {
  return createClient({
    fetch: async () =>
      new Response(
        JSON.stringify({
          nodeId: "box",
          servers: [],
          discoveryUntil: null,
          jobs: [
            {
              id: "job",
              printerId: "printer",
              transport: "network_tcp",
              host: "printer.test",
              port: 9100,
              localKey: null,
              payload: "G0A=",
              invoiceClaim,
            },
          ],
        }),
        { headers: { "content-type": "application/json" } },
      ),
  });
}
describe("invoice claim wire validation", () => {
  it.each([
    null,
    [],
    1,
    {},
    { deliveryId: id, generation: 1 },
    { deliveryId: "", generation: 1, token },
    { deliveryId: "bad", generation: 1, token },
    { deliveryId: id, generation: 1, token: "bad" },
    { deliveryId: id, generation: 1, token: null },
    { deliveryId: id, generation: 0, token },
    { deliveryId: id, generation: -1, token },
    { deliveryId: id, generation: 1.1, token },
    { deliveryId: id, generation: "1", token },
    { deliveryId: id, generation: Number.MAX_SAFE_INTEGER + 1, token },
  ])("refuses malformed invoice identity before delivering bytes (%j)", async (invoiceClaim) => {
    expect(await client(invoiceClaim).pullJobs("http://box.test", "auth", inventory)).toMatchObject(
      { ok: false, failure: { kind: "bad_reply" } },
    );
  });
  it("preserves the valid identity alongside its decoded bytes", async () => {
    const result = await client({ deliveryId: id, generation: 2, token }).pullJobs(
      "http://box.test",
      "auth",
      inventory,
    );
    expect(result).toMatchObject({
      ok: true,
      value: {
        jobs: [
          {
            invoiceClaim: { deliveryId: id, generation: 2, token },
            payload: new Uint8Array([27, 64]),
          },
        ],
      },
    });
  });
  it("keeps ordinary jobs without invoice identity deliverable", async () => {
    const result = await client(undefined).pullJobs("http://box.test", "auth", inventory);
    expect(result).toMatchObject({
      ok: true,
      value: { jobs: [{ payload: new Uint8Array([27, 64]) }] },
    });
    if (result.ok) expect(result.value.jobs[0]).not.toHaveProperty("invoiceClaim");
  });
});
