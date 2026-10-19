import { describe, expect, expectTypeOf, it, vi } from "vitest";
import { TillApi, type BillEditExpected } from "./client.js";

describe("stored station-choice ownership", () => {
  it("requires the bill observation or explicit counter null", () => {
    type Arguments = Parameters<TillApi["setMakeAt"]>;
    expectTypeOf<Arguments>().toEqualTypeOf<
      [string, number, Record<string, string>, BillEditExpected | null]
    >();
    expectTypeOf<[string, number, Record<string, string>]>().not.toMatchTypeOf<Arguments>();
  });

  it.each([null, { billId: "bill-4", editorVersion: 8, draftId: "draft-2", draftRevision: 3 }])(
    "serializes the original observation: %j",
    async (expectedEdit) => {
      const fetcher = vi.fn().mockResolvedValue(Response.json({ revision: 6 }));
      await expect(
        new TillApi("", fetcher).setMakeAt("bill-4", 5, { "line-1": "kitchen" }, expectedEdit),
      ).resolves.toEqual({ revision: 6 });
      expect(fetcher).toHaveBeenCalledExactlyOnceWith("/api/working-orders/bill-4/make-at", {
        method: "PUT",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ revision: 5, lines: { "line-1": "kitchen" }, expectedEdit }),
      });
    },
  );
});
