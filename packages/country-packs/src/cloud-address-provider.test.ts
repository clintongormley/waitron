import { assert, expect, it, vi } from "vitest";
import {
  cloudAddressProvider,
  type CloudAddressOperation,
  type CloudAddressReply,
} from "./index.js";

const addressFields = {
  addressLine1: "Main Street 2",
  addressLine2: null,
  postalCode: "46001",
  city: "Valencia",
  province: "Valencia",
  countryCode: "ES",
} satisfies NonNullable<CloudAddressReply["fields"]>;
const selection = { suggestionId: "Main Street 2, Valencia", sessionToken: "open" };
const searchRequest = { query: "Main", countryCode: "ES", sessionToken: selection.sessionToken };

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

it.each([
  {
    scenario: "a second line and a named province",
    addressLine2: "Unit 3",
    province: "Valencia",
    lines: ["Main Street 2", "Unit 3"],
    code: "46",
  },
  {
    scenario: "no second line or province",
    addressLine2: null,
    province: "",
    lines: ["Main Street 2"],
    code: undefined,
  },
  {
    scenario: "an empty second line",
    addressLine2: "",
    province: "Valencia",
    lines: ["Main Street 2"],
    code: "46",
  },
])("fills the selected address with $scenario", async ({ addressLine2, province, lines, code }) => {
  const read = vi.fn(async (operation: CloudAddressOperation): Promise<CloudAddressReply> => {
    if (operation.kind === "available") return { available: true };
    if (operation.kind === "suggest") return { candidates: [{ text: selection.suggestionId }] };
    return { fields: { ...addressFields, addressLine2, province } };
  });
  const provider = (await cloudAddressProvider(read, () => "en"))!;
  await provider.suggest(searchRequest);
  const suggestion = read.mock.calls[1]?.[0];
  assert(suggestion?.kind === "suggest");
  const address = await provider.resolve(selection);
  expect(read).toHaveBeenLastCalledWith({
    kind: "validate",
    workflowId: suggestion.workflowId,
    selectedText: selection.suggestionId,
  });
  expect(address).toMatchObject({
    lines,
    locality: "Valencia",
    postalCode: "46001",
    countryCode: "ES",
  });
  if (code === undefined) expect(address).not.toHaveProperty("administrativeAreaCode");
  else expect(address.administrativeAreaCode).toBe(code);
  await expect(provider.resolve(selection)).rejects.toThrow("No address search");
  expect(read).toHaveBeenCalledTimes(3);
});

it.each([
  { missing: "street", fields: { ...addressFields, addressLine1: " " } },
  { missing: "postal code", fields: { ...addressFields, postalCode: " " } },
  { missing: "city", fields: { ...addressFields, city: " " } },
  { missing: "all fields", fields: undefined },
])("refuses to fill a selected address missing $missing", async ({ fields }) => {
  const provider = (await cloudAddressProvider(
    async (operation) => {
      if (operation.kind === "available") return { available: true };
      if (operation.kind === "suggest") return { candidates: [{ text: selection.suggestionId }] };
      return fields ? { fields } : {};
    },
    () => "en",
  ))!;
  await provider.suggest(searchRequest);
  await expect(provider.resolve(selection)).rejects.toThrow("Incomplete address fields");
  await expect(provider.resolve(selection)).rejects.toThrow("No address search");
});

it("uses a fresh search after Cloud refuses to validate the selection", async () => {
  const refusal = { code: "cloud.unavailable" };
  const read = vi.fn(async (operation: CloudAddressOperation): Promise<CloudAddressReply> => {
    if (operation.kind === "available") return { available: true };
    if (operation.kind === "suggest") return { candidates: [{ text: selection.suggestionId }] };
    throw refusal;
  });
  const provider = (await cloudAddressProvider(read, () => "en"))!;
  await provider.suggest(searchRequest);
  const before = read.mock.calls[1]?.[0];
  assert(before?.kind === "suggest");
  await expect(provider.resolve(selection)).rejects.toBe(refusal);
  await provider.suggest(searchRequest);
  const after = read.mock.calls[3]?.[0];
  assert(after?.kind === "suggest");
  expect(after.workflowId).not.toBe(before.workflowId);
});

it("leaves the search hidden when Cloud says it is unavailable", async () => {
  const read = vi.fn(async () => ({ available: false }));
  expect(await cloudAddressProvider(read, () => "es")).toBeUndefined();
  expect(read).toHaveBeenCalledExactlyOnceWith({ kind: "available" });
});

it("credits Google Maps on the address the provider resolved", async () => {
  const provider = await cloudAddressProvider(
    async (operation) => {
      if (operation.kind === "available") return { available: true };
      if (operation.kind === "suggest") return { candidates: [{ text: "Main Street 2" }] };
      return {
        fields: {
          addressLine1: "Main Street 2",
          addressLine2: null,
          postalCode: "28013",
          city: "Madrid",
          province: "Madrid",
          countryCode: "ES",
        },
      };
    },
    () => "en",
  );
  await provider!.suggest({ query: "Main", countryCode: "ES", sessionToken: "open" });
  const result = await provider!.resolve({ suggestionId: "Main Street 2", sessionToken: "open" });
  expect(result).toMatchObject({ lines: ["Main Street 2"], attribution: "Google Maps" });
});
