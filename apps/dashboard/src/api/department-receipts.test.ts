import { expect, it, vi } from "vitest";
import { createRequest, LiveData } from "@waitron/dashboard-kit";
import type { DepartmentReceiptWrite } from "@waitron/shared";
import { createDepartmentReceiptClient } from "./department-receipts.js";
import { receiptModel, preview } from "../testing/department-receipt-editor-fixture.js";

const input: DepartmentReceiptWrite = {
  receipt: {
    operationDescription: "Meals",
    footerMessage: { "ca-ES": "Gràcies", "eu-ES": "Retained" },
    printAddress: false,
  },
  policy: { receiptPrintMode: "on_request", printTradingName: false },
};
function fixture(answer: unknown = receiptModel, status = 200) {
  const fetchImpl = vi.fn<(path: string, init: RequestInit) => Promise<Response>>(async () =>
    status === 204
      ? new Response(null, { status })
      : new Response(JSON.stringify(answer), { status }),
  );
  const activity = vi.fn();
  const liveData = new LiveData();
  const request = createRequest({ baseUrl: "/box", fetchImpl, onSuccess: activity });
  const client = createDepartmentReceiptClient(request, liveData);
  return { client, fetchImpl, activity, liveData };
}
it("reads exact department receipt, policy and language metadata without global defaults", async () => {
  const { client, fetchImpl } = fixture();
  expect(await client.getDepartmentReceipt("dept")).toEqual(receiptModel);
  expect(fetchImpl.mock.calls[0]![0]).toBe(
    "/box/management-api/venue-service/departments/dept/receipt",
  );
  expect(fetchImpl.mock.calls[0]![1].method).toBe("GET");
  expect(fetchImpl.mock.calls[0]![1].credentials).toBe("include");
});
it("writes the exact receipt and policy envelope without nesting or altering authored values", async () => {
  const { client, fetchImpl } = fixture(undefined, 204);
  expect(await client.putDepartmentReceipt("dept", input)).toBeUndefined();
  expect(fetchImpl.mock.calls[0]![0]).toBe(
    "/box/management-api/venue-service/departments/dept/receipt",
  );
  expect(fetchImpl.mock.calls[0]![1].method).toBe("PUT");
  expect(JSON.parse(fetchImpl.mock.calls[0]![1].body as string)).toEqual(input);
  expect(input.receipt.footerMessage).toEqual({ "ca-ES": "Gràcies", "eu-ES": "Retained" });
});
it("previews only the selected department draft, including policy, width and locale", async () => {
  const drawn = preview();
  const { client, fetchImpl } = fixture(drawn);
  const draft = { ...input, departmentId: "dept", paperWidth: "58mm", language: "ca-ES" } as const;
  expect(await client.previewReceiptDraft(draft)).toEqual(drawn);
  expect(fetchImpl.mock.calls[0]![0]).toBe("/box/management-api/receipt-preview");
  expect(fetchImpl.mock.calls[0]![1].method).toBe("POST");
  expect(JSON.parse(fetchImpl.mock.calls[0]![1].body as string)).toEqual(draft);
});
it("marks automatic preview in the body and keeps the caller's draft unchanged", async () => {
  const { client, fetchImpl } = fixture(preview());
  const draft = { ...input, departmentId: "dept" };
  await client.previewReceiptDraft(draft, { passive: true });
  expect(JSON.parse(fetchImpl.mock.calls[0]![1].body as string)).toEqual({
    ...draft,
    passive: true,
  });
  expect(draft).not.toHaveProperty("passive");
});
it("keeps subsequent reads passive while background writes remain active", async () => {
  const { client, fetchImpl, activity } = fixture();
  await client.getDepartmentReceipt("dept");
  await client.background!.getDepartmentReceipt("dept");
  expect(new Headers(fetchImpl.mock.calls[0]![1].headers).has("x-waitron-live")).toBe(false);
  expect(new Headers(fetchImpl.mock.calls[1]![1].headers).get("x-waitron-live")).toBe("1");
  expect(activity).toHaveBeenCalledTimes(1);
  await client.background!.putDepartmentReceipt("dept", input);
  expect(new Headers(fetchImpl.mock.calls[2]![1].headers).has("x-waitron-live")).toBe(false);
  expect(activity).toHaveBeenCalledTimes(2);
});
it("shares the dialog's live sources and request primitive with its background and image picker", async () => {
  const { client, fetchImpl, liveData } = fixture({ images: [], total: 0 });
  expect(client.liveData).toBe(liveData);
  expect(client.background!.liveData).toBe(liveData);
  await client.imageLibraryRequest("/management-api/media/images", "GET");
  expect(fetchImpl.mock.calls[0]![0]).toBe("/box/management-api/media/images");
});
it("preserves a field refusal through the real request primitive", async () => {
  const { client } = fixture(
    { error: { code: "management.request_invalid", params: { field: "operationDescription" } } },
    400,
  );
  await expect(client.putDepartmentReceipt("dept", input)).rejects.toMatchObject({
    code: "management.request_invalid",
    params: { field: "operationDescription" },
    status: 400,
  });
});
