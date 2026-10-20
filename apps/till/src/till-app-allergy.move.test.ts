import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import type { AllergyMoveRead } from "@waitron/module";
import type { WtInput } from "@waitron/ui";
import { codeMessage } from "./i18n/codes.js";
import type { TillApi } from "./api/client.js";
import { cleanupWidgets, expectNoA11yViolations, measured } from "./widgets/test-helpers.js";
import { currentLocale, setLocale, t } from "./i18n/t.js";
import {
  api,
  mountApp,
  flush,
  emit,
  shell,
  signIn,
  table,
  party,
  dialog,
  resetAllergyFixture,
  till,
} from "../test/allergy-app-fixture.js";

const locale = currentLocale();
beforeEach(() => {
  setLocale("en");
  resetAllergyFixture();
});
afterEach(async () => {
  cleanupWidgets();
  setLocale(locale);
  await page.viewport(1280, 768);
});

function preview(answer: null | "none" | "allergies" = null): AllergyMoveRead {
  return {
    billId: "counter-bill",
    tableId: "destination",
    partyId: answer === null ? null : "v1",
    snapshot:
      answer === null
        ? null
        : {
            answer,
            revision: 3,
            guests:
              answer === "allergies"
                ? [
                    {
                      id: "guest",
                      position: 0,
                      who: "Blue shirt",
                      allergens: { milk: {} },
                      note: "Severe",
                    },
                  ]
                : [],
            ticks: [],
            changedAt: null,
            changedBy: null,
          },
    dishes: [
      {
        line: { kind: "working", id: "arriving-line" },
        billId: "counter-bill",
        name: "Soup",
        quantity: "2.000",
        allergens: { milk: {} },
        extras: [],
        sentAt: "2026-10-20T10:00:00Z",
        offeredBefore: false,
      },
    ],
  };
}
const sourceEdit = {
  billId: "counter-bill",
  editorId: null,
  editorName: null,
  editorVersion: 8,
  draftId: null,
  draftRevision: null,
};

async function counter(
  overrides: Record<string, unknown> = {},
  answer: null | "none" | "allergies" = null,
  theme?: "light" | "dark",
) {
  const destination = table("destination", "9", answer === null ? null : party());
  const mounted = await mountApp(
    {
      getTablesState: vi.fn().mockResolvedValue([destination]),
      getFindBill: vi
        .fn()
        .mockResolvedValue({ workingOrderId: "counter-bill", partyId: null, edit: sourceEdit }),
      listDrafts: vi.fn().mockResolvedValue({ drafts: [], billEdits: [] }),
      previewBillMoveAllergy: vi.fn().mockResolvedValue(preview(answer)),
      moveBill: vi.fn().mockResolvedValue({ partyId: "v1", billId: "counter-bill", merged: false }),
      ...overrides,
    },
    undefined,
    theme,
  );
  await flush(mounted.el);
  await signIn(mounted.el);
  emit(shell(mounted.el), "screen-select", { screen: "counter" });
  await flush(mounted.el);
  const screen = mounted.el.shadowRoot!.querySelector("till-counter-screen")!;
  expect(screen).not.toBeNull();
  const move = () =>
    emit(mounted.el.shadowRoot!.querySelector("till-counter-screen")!, "move-held-order", {
      orderId: "counter-bill",
      tableId: "destination",
      seated: destination.party,
      bills: "separate",
    });
  return { ...mounted, screen, move };
}

describe("A669 counter move refusal recovery", () => {
  it("shows a repeated guest refusal after correcting and retrying a move", async () => {
    const write = vi.fn().mockRejectedValue({ code: "allergy.invalid", field: "guests.0.who" });
    const { el, move } = await counter({ moveBill: write }, "allergies");
    move();
    await vi.waitFor(() => expect(dialog(el)).not.toBeNull());
    const form = dialog(el)!;
    await userEvent.click(form.shadowRoot!.querySelector<HTMLElement>("[data-primary]")!);
    await vi.waitFor(() => expect(form.refusal).toBe(codeMessage("allergy.invalid")));
    const who = form.shadowRoot!.querySelector<WtInput>('wt-input[name="guest-0-who"]')!;
    await who.updateComplete;
    await userEvent.fill(who.shadowRoot!.querySelector("input")!, "Corrected guest");
    await userEvent.click(form.shadowRoot!.querySelector<HTMLElement>("[data-primary]")!);
    await form.updateComplete;
    await userEvent.click(form.shadowRoot!.querySelector<HTMLElement>("[data-primary]")!);
    await vi.waitFor(() => expect(write).toHaveBeenCalledTimes(2));
    await vi.waitFor(() => expect(form.refusal).toBe(codeMessage("allergy.invalid")));
    expect(dialog(el)).toBe(form);
    expect(who.value).toBe("Corrected guest");
  });

  it("corrects a refused guest without reusing the rejected move payload", async () => {
    const write = vi
      .fn()
      .mockRejectedValueOnce({ code: "allergy.invalid", field: "guests.0.who" })
      .mockResolvedValue({ partyId: "v1", billId: "counter-bill", merged: false });
    const { el, move } = await counter({ moveBill: write }, "allergies");
    move();
    await vi.waitFor(() => expect(dialog(el)).not.toBeNull());
    const form = dialog(el)!;
    await userEvent.click(form.shadowRoot!.querySelector<HTMLInputElement>("[data-tick]")!);
    await userEvent.click(form.shadowRoot!.querySelector<HTMLElement>("[data-primary]")!);
    await vi.waitFor(() => expect(form.busy).toBe(false));
    await vi.waitFor(() =>
      expect(form.shadowRoot!.querySelector('wt-input[name="guest-0-who"]')).not.toBeNull(),
    );
    const who = form.shadowRoot!.querySelector<WtInput>('wt-input[name="guest-0-who"]')!;
    expect(who).not.toBeNull();
    expect(who.error).not.toBe("");
    await who.updateComplete;
    await userEvent.fill(who.shadowRoot!.querySelector("input")!, "Corrected guest");
    await userEvent.click(form.shadowRoot!.querySelector<HTMLElement>("[data-primary]")!);
    await form.updateComplete;
    expect(form.shadowRoot!.querySelector("[data-tick]")).not.toBeNull();
    expect(write).toHaveBeenCalledOnce();
    await userEvent.click(form.shadowRoot!.querySelector<HTMLElement>("[data-primary]")!);
    await vi.waitFor(() => expect(dialog(el)).toBeNull(), { timeout: 5000 });
    expect(write).toHaveBeenCalledTimes(2);
    expect(write.mock.calls[1]![4].submissionId).not.toBe(write.mock.calls[0]![4].submissionId);
    expect(write.mock.calls[1]![4].allergy).toEqual({
      party: {
        answer: "allergies",
        guests: [{ id: "guest", who: "Corrected guest", allergens: { milk: {} }, note: "Severe" }],
      },
      ticks: [{ line: { kind: "working", id: "arriving-line" }, guestIndex: 0 }],
    });
  }, 15_000);

  it("does not retry an uncertain move through a replacement API", async () => {
    const write = vi.fn().mockRejectedValue(new TypeError("Failed to fetch"));
    const { el, move } = await counter({ moveBill: write }, "allergies");
    move();
    await vi.waitFor(() => expect(dialog(el)).not.toBeNull());
    await userEvent.click(dialog(el)!.shadowRoot!.querySelector<HTMLElement>("[data-primary]")!);
    await vi.waitFor(() => expect(dialog(el)?.retryOnly).toBe(true), { timeout: 5000 });
    expect(write).toHaveBeenCalledTimes(3);
    const replacement = vi.fn();
    el.api = { ...api, moveBill: replacement } as unknown as TillApi;
    await flush(el, 6);
    expect(dialog(el)).toBeNull();
    expect(write).toHaveBeenCalledTimes(3);
    expect(replacement).not.toHaveBeenCalled();
  });

  it("does not move a bill when the destination disappears during preview recovery", async () => {
    const { el, move } = await counter({
      previewBillMoveAllergy: vi
        .fn()
        .mockResolvedValue({ ...preview(), tableId: "a-different-table" }),
    });
    api.getTablesState!.mockResolvedValue([]);
    move();
    await vi.waitFor(() => expect(api.previewBillMoveAllergy).toHaveBeenCalledOnce());
    await vi.waitFor(() =>
      expect(el.shadowRoot!.textContent).toContain(codeMessage("table.not_found")),
    );
    expect(api.moveBill).not.toHaveBeenCalled();
    expect(dialog(el)).toBeNull();
  });

  it("does not adopt a source bill that joined a party during preview recovery", async () => {
    const find = vi
      .fn()
      .mockResolvedValueOnce({ workingOrderId: "counter-bill", partyId: null, edit: sourceEdit })
      .mockResolvedValue({
        workingOrderId: "counter-bill",
        partyId: "another-party",
        edit: sourceEdit,
      });
    const { el, move } = await counter({
      getFindBill: find,
      previewBillMoveAllergy: vi
        .fn()
        .mockResolvedValue({ ...preview(), tableId: "a-different-table" }),
    });
    move();
    await vi.waitFor(() => expect(find).toHaveBeenCalledTimes(2));
    await flush(el, 6);
    expect(api.moveBill).not.toHaveBeenCalled();
    expect(dialog(el)).toBeNull();
  });

  it("ignores a destination refresh completed after changing the API", async () => {
    let finish!: (rows: ReturnType<typeof table>[]) => void;
    const { el, move } = await counter({
      previewBillMoveAllergy: vi
        .fn()
        .mockResolvedValue({ ...preview(), tableId: "a-different-table" }),
    });
    const tables = vi.fn(
      () =>
        new Promise<ReturnType<typeof table>[]>((resolve) => {
          finish = resolve;
        }),
    );
    api.getTablesState = tables;
    move();
    await vi.waitFor(() => expect(tables).toHaveBeenCalledOnce());
    const replacement = vi.fn();
    el.api = { ...api, moveBill: replacement } as unknown as TillApi;
    finish([table("destination", "9", null)]);
    await flush(el, 6);
    expect(api.moveBill).not.toHaveBeenCalled();
    expect(replacement).not.toHaveBeenCalled();
    expect(dialog(el)).toBeNull();
  });
});

describe("A669 counter-to-table allergy confirmation", () => {
  it("asks before moving to a free table and sends the explicit answer with the original observations", async () => {
    const { el, move } = await counter();
    move();
    await vi.waitFor(() => expect(dialog(el)).not.toBeNull());
    expect(api.moveBill).not.toHaveBeenCalled();
    expect(api.previewBillMoveAllergy).toHaveBeenCalledWith(
      "counter-bill",
      { tableId: "destination" },
      "separate",
      {
        partyId: null,
        otherPartyId: null,
        expectedEdits: [
          { billId: "counter-bill", editorVersion: 8, draftId: null, draftRevision: null },
        ],
      },
      { signal: expect.any(AbortSignal) },
    );
    await userEvent.click(dialog(el)!.shadowRoot!.querySelector<HTMLElement>("[data-none]")!);
    await vi.waitFor(() => expect(api.moveBill).toHaveBeenCalledOnce());
    expect(api.moveBill!.mock.calls[0]!.slice(0, 5)).toEqual([
      "counter-bill",
      { tableId: "destination" },
      "separate",
      {
        partyId: null,
        otherPartyId: null,
        expectedEdits: [
          { billId: "counter-bill", editorVersion: 8, draftId: null, draftRevision: null },
        ],
      },
      {
        submissionId: expect.any(String),
        allergy: { party: { answer: "none", guests: [] }, ticks: [] },
      },
    ]);
    await vi.waitFor(() => expect(dialog(el)).toBeNull());
  });

  it("Cancel sends no move", async () => {
    const { el, move } = await counter();
    move();
    await vi.waitFor(() => expect(dialog(el)).not.toBeNull());
    await userEvent.click(dialog(el)!.shadowRoot!.querySelector<HTMLElement>("[data-cancel]")!);
    await vi.waitFor(() => expect(dialog(el)).toBeNull());
    expect(api.moveBill).not.toHaveBeenCalled();
    expect(
      el.shadowRoot!.querySelector<HTMLElement & { open: boolean }>(
        "wt-toast[data-submitted-toast]",
      )!.open,
    ).toBe(false);
  });

  it("offers already-sent counter dishes for an existing guest and carries the clash assignment", async () => {
    const { el, move } = await counter({}, "allergies");
    move();
    await vi.waitFor(() => expect(dialog(el)).not.toBeNull());
    const form = dialog(el)!;
    await userEvent.click(form.shadowRoot!.querySelector<HTMLInputElement>("[data-tick]")!);
    await userEvent.click(form.shadowRoot!.querySelector<HTMLElement>("[data-primary]")!);
    await vi.waitFor(() => expect(api.moveBill).toHaveBeenCalledOnce());
    expect(api.moveBill!.mock.calls[0]![4]).toEqual({
      submissionId: expect.any(String),
      allergy: {
        ticks: [{ line: { kind: "working", id: "arriving-line" }, guestIndex: 0 }],
      },
    });
  });

  it("keeps an unknown move immutable for automatic and explicit retries", async () => {
    const write = vi.fn().mockRejectedValue(new TypeError("Failed to fetch"));
    const { el, move } = await counter({ moveBill: write }, "allergies");
    move();
    await vi.waitFor(() => expect(dialog(el)).not.toBeNull());
    const form = dialog(el)!;
    await userEvent.click(form.shadowRoot!.querySelector<HTMLInputElement>("[data-tick]")!);
    await userEvent.click(form.shadowRoot!.querySelector<HTMLElement>("[data-primary]")!);
    await vi.waitFor(() => expect(form.refusal).not.toBe(""), { timeout: 5000 });
    expect(write).toHaveBeenCalledTimes(3);
    const original = structuredClone(write.mock.calls[0]!.slice(0, 5));
    expect(write.mock.calls.slice(1).map((call) => call.slice(0, 5))).toEqual([original, original]);
    expect(form.shadowRoot!.querySelector<HTMLInputElement>("[data-tick]")!.disabled).toBe(true);
    write.mockResolvedValue({ partyId: "v1", billId: "counter-bill", merged: false });
    await userEvent.click(form.shadowRoot!.querySelector<HTMLElement>("[data-primary]")!);
    await vi.waitFor(() => expect(write).toHaveBeenCalledTimes(4));
    expect(write.mock.calls[3]!.slice(0, 5)).toEqual(original);
    await vi.waitFor(() => expect(dialog(el)).toBeNull());
  });

  it("refreshes an occupied destination after refusal and requires a separate confirmation", async () => {
    const write = vi
      .fn()
      .mockImplementationOnce(async () => {
        api.getTablesState!.mockResolvedValue([table("destination", "9", party())]);
        api.previewBillMoveAllergy!.mockResolvedValue(preview("allergies"));
        throw { code: "party.out_of_date" };
      })
      .mockResolvedValue({ partyId: "v1", billId: "counter-bill", merged: false });
    const { el, move } = await counter({ moveBill: write });
    move();
    await vi.waitFor(() => expect(dialog(el)).not.toBeNull());
    await userEvent.click(dialog(el)!.shadowRoot!.querySelector<HTMLElement>("[data-none]")!);
    await vi.waitFor(() => expect(dialog(el)?.view.partyId).toBe("v1"));
    expect(write).toHaveBeenCalledOnce();
    const form = dialog(el)!;
    await userEvent.click(form.shadowRoot!.querySelector<HTMLInputElement>("[data-tick]")!);
    await userEvent.click(form.shadowRoot!.querySelector<HTMLElement>("[data-primary]")!);
    await vi.waitFor(() => expect(write).toHaveBeenCalledTimes(2));
    expect(write.mock.calls[1]![3]).toMatchObject({
      otherPartyId: "v1",
      expectedOtherPartyRevision: 3,
    });
    expect(write.mock.calls[1]![4].submissionId).not.toBe(write.mock.calls[0]![4].submissionId);
  });

  it("a changed destination during the preview is reread before a separate answer", async () => {
    const read = vi
      .fn()
      .mockImplementationOnce(async () => {
        api.getTablesState!.mockResolvedValue([table("destination", "9", party())]);
        throw { code: "party.out_of_date" };
      })
      .mockResolvedValue(preview("allergies"));
    const { el, move } = await counter({ previewBillMoveAllergy: read });
    move();
    await vi.waitFor(() => expect(dialog(el)?.view.partyId).toBe("v1"));
    expect(api.moveBill).not.toHaveBeenCalled();
    expect(dialog(el)!.refusal).not.toBe("");
    await userEvent.click(dialog(el)!.shadowRoot!.querySelector<HTMLElement>("[data-primary]")!);
    await vi.waitFor(() => expect(api.moveBill).toHaveBeenCalledOnce());
  });

  it("a recorded No allergies answer moves without asking again but keeps the replay command", async () => {
    const { el, move } = await counter({}, "none");
    move();
    await vi.waitFor(() => expect(api.moveBill).toHaveBeenCalledOnce());
    expect(dialog(el)).toBeNull();
    expect(api.moveBill!.mock.calls[0]![4]).toEqual({
      submissionId: expect.any(String),
      allergy: { ticks: [] },
    });
  });

  it("a duplicate Move cannot replace the current allergy opening", async () => {
    const { el, move } = await counter();
    move();
    await vi.waitFor(() => expect(dialog(el)).not.toBeNull());
    const form = dialog(el)!;
    move();
    await flush(el);
    expect(dialog(el)).toBe(form);
    expect(api.previewBillMoveAllergy).toHaveBeenCalledOnce();
    await userEvent.click(form.shadowRoot!.querySelector<HTMLElement>("[data-cancel]")!);
    await vi.waitFor(() => expect(dialog(el)).toBeNull());
    expect(api.moveBill).not.toHaveBeenCalled();
  });

  it("a failed preview cannot be treated as an unanswered or No allergies table", async () => {
    const { el, move } = await counter({
      previewBillMoveAllergy: vi.fn().mockRejectedValue(new TypeError("Failed to fetch")),
    });
    move();
    await vi.waitFor(() => expect(api.previewBillMoveAllergy).toHaveBeenCalledOnce());
    await flush(el);
    expect(dialog(el)).toBeNull();
    expect(api.moveBill).not.toHaveBeenCalled();
  });

  it.each(["party.out_of_date", "allergy.out_of_date"] as const)(
    "refreshes the same party and source editor on %s while retaining a reviewed line assignment",
    async (code) => {
      const write = vi
        .fn()
        .mockImplementationOnce(async () => {
          api.getTablesState!.mockResolvedValue([
            table("destination", "9", party({ revision: 4 })),
          ]);
          api.getFindBill!.mockResolvedValue({
            workingOrderId: "counter-bill",
            partyId: null,
            edit: { ...sourceEdit, editorVersion: 9 },
          });
          const latest = preview("allergies");
          latest.snapshot!.revision = 4;
          latest.snapshot!.guests[0]!.note = "Updated by another waiter";
          latest.dishes.push({
            ...latest.dishes[0]!,
            line: { kind: "working", id: "new-arrival" },
            name: "Fresh dish",
          });
          api.previewBillMoveAllergy!.mockResolvedValue(latest);
          throw { code };
        })
        .mockResolvedValue({ partyId: "v1", billId: "counter-bill", merged: false });
      const { el, move } = await counter({ moveBill: write }, "allergies");
      move();
      await vi.waitFor(() => expect(dialog(el)).not.toBeNull());
      const form = dialog(el)!;
      await userEvent.click(form.shadowRoot!.querySelector<HTMLInputElement>("[data-tick]")!);
      await userEvent.click(form.shadowRoot!.querySelector<HTMLElement>("[data-primary]")!);
      await vi.waitFor(() => expect(form.view.snapshot?.revision).toBe(4));
      expect(write).toHaveBeenCalledOnce();
      expect(form.shadowRoot!.querySelectorAll("[data-tick]")).toHaveLength(2);
      expect(form.shadowRoot!.querySelector<HTMLInputElement>("[data-tick]")!.checked).toBe(true);
      await userEvent.click(form.shadowRoot!.querySelector<HTMLElement>("[data-primary]")!);
      await vi.waitFor(() => expect(write).toHaveBeenCalledTimes(2));
      expect(write.mock.calls[1]![3]).toEqual({
        partyId: null,
        otherPartyId: "v1",
        expectedOtherPartyRevision: 4,
        expectedEdits: [
          { billId: "counter-bill", editorVersion: 9, draftId: null, draftRevision: null },
        ],
      });
      expect(write.mock.calls[1]![4].allergy).toEqual({
        ticks: [{ line: { kind: "working", id: "arriving-line" }, guestIndex: 0 }],
      });
      expect(write.mock.calls[1]![4].submissionId).not.toBe(write.mock.calls[0]![4].submissionId);
    },
  );

  it("a superseded confirmation cannot submit into a reopened move window", async () => {
    const { el, move } = await counter();
    move();
    await vi.waitFor(() => expect(dialog(el)).not.toBeNull());
    const old = dialog(el)!;
    const detail = {
      scopeKey: old.scopeKey,
      expectedPartyRevision: null,
      patch: { party: { answer: "none", guests: [] }, ticks: [] },
    };
    await userEvent.click(old.shadowRoot!.querySelector<HTMLElement>("[data-cancel]")!);
    await vi.waitFor(() => expect(dialog(el)).toBeNull());
    move();
    await vi.waitFor(() => expect(dialog(el)).not.toBeNull());
    emit(dialog(el)!, "allergy-confirm", detail);
    await flush(el);
    expect(api.moveBill).not.toHaveBeenCalled();
    await userEvent.click(dialog(el)!.shadowRoot!.querySelector<HTMLElement>("[data-none]")!);
    await vi.waitFor(() => expect(api.moveBill).toHaveBeenCalledOnce());
  });

  it.each(["navigation", "API replacement"])("ignores a late preview after %s", async (leave) => {
    let finish!: (view: AllergyMoveRead) => void;
    const read = vi.fn(
      () =>
        new Promise<AllergyMoveRead>((resolve) => {
          finish = resolve;
        }),
    );
    const { el, move } = await counter({ previewBillMoveAllergy: read });
    move();
    await vi.waitFor(() => expect(read).toHaveBeenCalledOnce());
    if (leave === "navigation") emit(shell(el), "screen-select", { screen: "floor" });
    else el.api = { ...api } as unknown as TillApi;
    await flush(el);
    finish(preview());
    await flush(el);
    expect(dialog(el)).toBeNull();
    expect(api.moveBill).not.toHaveBeenCalled();
  });
});

for (const language of ["en", "es"] as const)
  for (const theme of ["light", "dark"] as const)
    for (const width of [390, 1280])
      it(`counter move question and immutable retry in ${language}/${theme}/${width}`, async () => {
        await page.viewport(width, 900);
        const write = vi.fn().mockRejectedValue(new TypeError("Failed to fetch"));
        const { el, host, move } = await counter(
          {
            getTill: vi.fn().mockResolvedValue({ ...till("till"), locale: language }),
            moveBill: write,
          },
          "allergies",
          theme,
        );
        setLocale(language);
        el.requestUpdate();
        await el.updateComplete;
        move();
        await vi.waitFor(() => expect(dialog(el)).not.toBeNull());
        const form = dialog(el)!;
        expect(form.shadowRoot!.querySelector("[data-primary]")!.textContent).toContain(
          t("allergy.send", language),
        );
        await userEvent.click(form.shadowRoot!.querySelector<HTMLInputElement>("[data-tick]")!);
        await expectNoA11yViolations(host);
        await measured();
        await page.screenshot({
          path: `__screenshots__/a669-counter-move/clash-${language}-${theme}-${width}.png`,
        });
        await userEvent.click(form.shadowRoot!.querySelector<HTMLElement>("[data-primary]")!);
        await vi.waitFor(() => expect(form.refusal).not.toBe(""), { timeout: 5000 });
        await expectNoA11yViolations(host);
        const native = form
          .shadowRoot!.querySelector("wt-dialog")!
          .shadowRoot!.querySelector("dialog")!;
        const box = native.getBoundingClientRect();
        expect(box.width).toBeGreaterThan(0);
        expect(box.left).toBeGreaterThanOrEqual(-1);
        expect(box.right).toBeLessThanOrEqual(width + 1);
        expect(form.shadowRoot!.querySelector<HTMLInputElement>("[data-tick]")!.disabled).toBe(
          true,
        );
        expect(form.shadowRoot!.querySelector("[data-cancel]")!.hasAttribute("disabled")).toBe(
          true,
        );
        await page.screenshot({
          path: `__screenshots__/a669-counter-move/retry-${language}-${theme}-${width}.png`,
        });
        write.mockResolvedValue({ partyId: "v1", billId: "counter-bill", merged: false });
        await userEvent.click(form.shadowRoot!.querySelector<HTMLElement>("[data-primary]")!);
        await vi.waitFor(() => expect(dialog(el)).toBeNull());
      });
