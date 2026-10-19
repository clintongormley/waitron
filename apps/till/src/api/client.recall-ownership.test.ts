import { describe, expect, expectTypeOf, it, vi } from "vitest";
import { TillApi, type BillEditExpected, type BillEditState, type Draft } from "./client.js";

describe("Recall ownership contracts", () => {
  it("requires an explicit bill observation or counter null on line Recall", () => {
    type Arguments = Parameters<TillApi["recallLines"]>;
    expectTypeOf<Arguments>().toEqualTypeOf<[string, number[], BillEditExpected | null]>();
    expectTypeOf<[string, number[]]>().not.toMatchTypeOf<Arguments>();
  });

  it.each([null, { billId: "bill-4", editorVersion: 8, draftId: "draft-2", draftRevision: 3 }])(
    "carries the original line Recall observation: %j",
    async (expectedEdit) => {
      const fetcher = vi.fn().mockResolvedValue(new Response(null, { status: 200 }));
      await expect(
        new TillApi("", fetcher).recallLines("bill-4", [2, 3], expectedEdit),
      ).resolves.toBeUndefined();
      expect(fetcher).toHaveBeenCalledExactlyOnceWith("/api/working-orders/bill-4/lines/recall", {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ lineNos: [2, 3], expectedEdit }),
      });
    },
  );

  it("exposes the authoritative editing state returned by Recall to New order", () => {
    type Answer = Awaited<ReturnType<TillApi["recallToDraft"]>>;
    expectTypeOf<Answer>().toEqualTypeOf<{
      revision: number;
      draft: Draft;
      edit: BillEditState;
    }>();
  });
});
