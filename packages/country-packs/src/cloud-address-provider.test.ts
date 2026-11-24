import { expect, it, vi } from "vitest";
import { cloudAddressProvider, type CloudAddressOperation } from "./index.js";

it("starts a new workflow after expiry while an ordinary refusal keeps the original workflow", async () => {
  const operations: CloudAddressOperation[] = [];
  const read = async (operation: CloudAddressOperation) => {
    operations.push(operation);
    switch (operations.length) {
      case 1:
        return { available: true };
      case 2:
        throw { code: "cloud.unavailable" };
      case 3:
        throw { code: "cloud.address_lookup_expired" };
      default:
        return { candidates: [{ text: "Main Street 2" }] };
    }
  };
  const provider = await cloudAddressProvider(read, () => "en");
  const search = (query: string) =>
    provider!.suggest({ query, sessionToken: "open", countryCode: "ES" });
  await expect(search("Main")).rejects.toMatchObject({ code: "cloud.unavailable" });
  await expect(search("Main Street")).rejects.toMatchObject({
    code: "cloud.address_lookup_expired",
  });
  await expect(search("Main Street 2")).resolves.toEqual([
    { id: "Main Street 2", label: "Main Street 2", secondaryLabel: "Google Maps" },
  ]);
  expect(operations[1]).toMatchObject({ kind: "suggest", query: "Main", language: "en" });
  const first = operations[1] as { workflowId: string };
  expect(operations[2]).toHaveProperty("workflowId", first.workflowId);
  expect(operations[3]).not.toHaveProperty("workflowId", first.workflowId);
});

it("leaves the search hidden when Cloud says it is unavailable", async () => {
  const read = vi.fn(async () => ({ available: false }));
  expect(await cloudAddressProvider(read, () => "es")).toBeUndefined();
  expect(read).toHaveBeenCalledExactlyOnceWith({ kind: "available" });
});
