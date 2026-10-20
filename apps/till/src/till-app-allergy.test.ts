import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { WtInput } from "@waitron/ui";
import { userEvent } from "vitest/browser";
import type { AllergySendTarget, PartyAllergyRead } from "@waitron/module";
import type { TillApi } from "./api/client.js";
import { cleanupWidgets } from "./widgets/test-helpers.js";
import { currentLocale, setLocale } from "./i18n/t.js";
import {
  server,
  api,
  mountApp,
  flush,
  emit,
  shell,
  floor,
  tableOrder,
  table4,
  draft,
  openTable,
  addDish,
  dialog,
  allergyView,
  party,
  table,
  till,
  resetAllergyFixture,
} from "../test/allergy-app-fixture.js";
const originalLocale = currentLocale();
beforeEach(() => {
  setLocale("en");
  resetAllergyFixture();
});
afterEach(() => {
  cleanupWidgets();
  setLocale(originalLocale);
});

describe("A669 live table editor", () => {
  it("retains a send answer after exhausted network retries and resends its immutable command", async () => {
    const submit = vi.fn().mockRejectedValue(new TypeError("Failed to fetch"));
    const { el } = await mountApp({ submitDraft: submit });
    await openTable(el);
    await addDish(el);
    await userEvent.click(
      tableOrder(el)!.shadowRoot!.querySelector<HTMLElement>('[data-draft-action="send-all"]')!,
    );
    await vi.waitFor(() => expect(dialog(el)).not.toBeNull());
    const form = dialog(el)!;
    await userEvent.click(form.shadowRoot!.querySelector<HTMLElement>("[data-none]")!);
    await vi.waitFor(() => expect(form.refusal).not.toBe(""), { timeout: 5000 });
    expect(dialog(el)).toBe(form);
    expect(draft(el).sending).toBe(true);
    expect(submit).toHaveBeenCalledTimes(3);
    expect(submit.mock.calls[2]![2]).toEqual(submit.mock.calls[0]![2]);
    submit.mockImplementation(server.submitDraft);
    await userEvent.click(form.shadowRoot!.querySelector<HTMLElement>("[data-none]")!);
    await vi.waitFor(() => expect(submit).toHaveBeenCalledTimes(4));
    expect(submit.mock.calls[3]![2]).toEqual(submit.mock.calls[0]![2]);
    await vi.waitFor(() => expect(dialog(el)).toBeNull());
  });

  it("a send refused for a stale party refreshes and reconfirms before using the new revision", async () => {
    let revision = 3;
    const preview = vi.fn().mockImplementation(async (_id: string, target: AllergySendTarget) => {
      const view = allergyView(null, target);
      return { ...view, snapshot: { ...view.snapshot, revision } };
    });
    const submit = vi
      .fn()
      .mockImplementationOnce(async () => {
        revision = 4;
        throw { code: "party.out_of_date" };
      })
      .mockImplementation(server.submitDraft);
    const { el } = await mountApp({ submitDraft: submit, previewPartyAllergy: preview });
    await openTable(el);
    await addDish(el);
    api.getTablesState!.mockResolvedValue([table("t4", "4", party({ revision: 4 }))]);
    api.listGroups!.mockResolvedValue({ revision: 4, groups: [] });
    api.readCurrentOrders!.mockResolvedValue({
      revision: 4,
      hasGroups: false,
      nextDisplayNumber: 1,
      retainedCourses: [],
      groups: [],
      ungrouped: [],
      reminder: null,
    });
    await userEvent.click(
      tableOrder(el)!.shadowRoot!.querySelector<HTMLElement>('[data-draft-action="send-all"]')!,
    );
    await vi.waitFor(() => expect(dialog(el)).not.toBeNull());
    const form = dialog(el)!;
    await userEvent.click(form.shadowRoot!.querySelector<HTMLElement>("[data-none]")!);
    await vi.waitFor(() => expect(form.view.snapshot?.revision).toBe(4));
    expect(submit).toHaveBeenCalledOnce();
    expect(dialog(el)).toBe(form);
    await userEvent.click(form.shadowRoot!.querySelector<HTMLElement>("[data-none]")!);
    await vi.waitFor(() => expect(submit).toHaveBeenCalledTimes(2));
    expect(submit.mock.calls[1]![2]).toMatchObject({
      expectedPartyRevision: 4,
      allergy: { party: { answer: "none", guests: [] }, ticks: [] },
    });
    expect(submit.mock.calls[1]![2].submissionId).not.toBe(submit.mock.calls[0]![2].submissionId);
  });

  it("refreshes the full heading after an answer is saved together with a send", async () => {
    const submit = vi.fn(async (...args: Parameters<typeof server.submitDraft>) => {
      const result = await server.submitDraft(...args);
      api.readPartyAllergy!.mockResolvedValue({
        ...allergyView("none"),
        snapshot: { ...allergyView("none").snapshot, revision: 4 },
      });
      return result;
    });
    const { el } = await mountApp({
      submitDraft: submit,
      readPartyAllergy: vi.fn().mockResolvedValue(allergyView(null)),
    });
    const screen = await openTable(el);
    await addDish(el);
    await userEvent.click(
      screen.shadowRoot!.querySelector<HTMLElement>('[data-draft-action="send-all"]')!,
    );
    await vi.waitFor(() => expect(dialog(el)).not.toBeNull());
    await userEvent.click(dialog(el)!.shadowRoot!.querySelector<HTMLElement>("[data-none]")!);
    await vi.waitFor(() => expect(submit).toHaveBeenCalledOnce());
    await vi.waitFor(() => expect(screen.allergyView?.snapshot.answer).toBe("none"));
  });

  it("refreshes a server-stale editor refusal before allowing a separate confirmation", async () => {
    const read = vi.fn().mockResolvedValue(allergyView("none"));
    const save = vi
      .fn()
      .mockImplementationOnce(async () => {
        read.mockResolvedValue({
          ...allergyView("none"),
          snapshot: { ...allergyView("none").snapshot, revision: 4 },
        });
        throw { code: "party.out_of_date" };
      })
      .mockResolvedValue({
        ...allergyView("allergies"),
        snapshot: { ...allergyView("allergies").snapshot, revision: 5 },
      });
    const { el } = await mountApp({ readPartyAllergy: read, savePartyAllergy: save });
    const screen = await openTable(el);
    await vi.waitFor(() => expect(screen.allergyView).not.toBeNull());
    emit(screen, "edit-party-allergy");
    await vi.waitFor(() => expect(dialog(el)).not.toBeNull());
    const form = dialog(el)!;
    await userEvent.click(form.shadowRoot!.querySelector<HTMLElement>("[data-add]")!);
    const who = form.shadowRoot!.querySelector<WtInput>("wt-input")!;
    await who.updateComplete;
    await userEvent.fill(who.shadowRoot!.querySelector("input")!, "Guest two");
    await userEvent.click(form.shadowRoot!.querySelector<HTMLInputElement>('[data-code="milk"]')!);
    api.getTablesState!.mockResolvedValue([table("t4", "4", party({ revision: 4 }))]);
    api.listGroups!.mockResolvedValue({ revision: 4, groups: [] });
    api.readCurrentOrders!.mockResolvedValue({
      revision: 4,
      hasGroups: false,
      nextDisplayNumber: 1,
      retainedCourses: [],
      groups: [],
      ungrouped: [],
      reminder: null,
    });
    await userEvent.click(form.shadowRoot!.querySelector<HTMLElement>("[data-primary]")!);
    await vi.waitFor(() => expect(form.busy).toBe(false));
    await vi.waitFor(() => expect(form.view.snapshot?.revision).toBe(4));
    expect(save).toHaveBeenCalledOnce();
    expect(who.shadowRoot!.querySelector("input")!.value).toBe("Guest two");
    await userEvent.click(form.shadowRoot!.querySelector<HTMLElement>("[data-primary]")!);
    await vi.waitFor(() => expect(save).toHaveBeenCalledTimes(2));
    expect(save.mock.calls[1]![1].expectedPartyRevision).toBe(4);
    expect(save.mock.calls[1]![1].submissionId).not.toBe(save.mock.calls[0]![1].submissionId);
  });

  it("cancels an editor opening read when navigation leaves its party", async () => {
    const read = vi.fn().mockResolvedValue(allergyView("none"));
    const { el } = await mountApp({ readPartyAllergy: read });
    const screen = await openTable(el);
    await vi.waitFor(() => expect(screen.allergyView).not.toBeNull());
    let finish!: (view: PartyAllergyRead) => void;
    read.mockImplementationOnce(
      () =>
        new Promise<PartyAllergyRead>((resolve) => {
          finish = resolve;
        }),
    );
    emit(screen, "edit-party-allergy");
    await vi.waitFor(() => expect(read).toHaveBeenCalledTimes(2));
    const signal = read.mock.calls[1]![1]?.signal as AbortSignal | undefined;
    emit(shell(el), "screen-select", { screen: "floor" });
    await flush(el);
    expect(signal?.aborted).toBe(true);
    finish(allergyView("allergies"));
    await flush(el);
    expect(dialog(el)).toBeNull();
  });

  it("a hanging preview reaches its deadline and releases the frozen draft", async () => {
    const { el } = await mountApp({ previewPartyAllergy: vi.fn(() => new Promise(() => {})) });
    await openTable(el);
    await addDish(el);
    const nativeTimeout = window.setTimeout.bind(window);
    const { TABLE_REQUEST_LIMIT_MS } = await import("./state/draft-sync.js");
    const deadlines: (() => void)[] = [];
    const timeout = vi.spyOn(window, "setTimeout").mockImplementation(((
      handler: TimerHandler,
      delay?: number,
      ...args: unknown[]
    ) => {
      if (delay === TABLE_REQUEST_LIMIT_MS && typeof handler === "function")
        deadlines.push(handler as () => void);
      return nativeTimeout(handler, delay, ...args);
    }) as typeof window.setTimeout);
    try {
      await userEvent.click(
        tableOrder(el)!.shadowRoot!.querySelector<HTMLElement>('[data-draft-action="send-all"]')!,
      );
      await vi.waitFor(() => expect(api.previewPartyAllergy).toHaveBeenCalledOnce());
      deadlines.at(-1)!();
      await vi.waitFor(() => expect(draft(el).sending).toBe(false));
      expect(api.submitDraft).not.toHaveBeenCalled();
      expect(draft(el).lines).toHaveLength(1);
      expect(dialog(el)).toBeNull();
    } finally {
      timeout.mockRestore();
    }
  });

  it.each(["till", "tablet-landscape"] as const)(
    "binds the authoritative heading in the %s layout",
    async (formFactor) => {
      const { el } = await mountApp({ getTill: vi.fn().mockResolvedValue(till(formFactor)) });
      const screen = await openTable(el);
      await vi.waitFor(() =>
        expect(screen.shadowRoot!.querySelector("[data-allergy-heading]")?.textContent).toContain(
          "No allergies",
        ),
      );
      expect(screen.hasAttribute("embedded")).toBe(formFactor === "tablet-landscape");
    },
  );

  it("aborts an old party read and lets the next party read finish first", async () => {
    let resolveOld!: (view: PartyAllergyRead) => void;
    const read = vi.fn().mockImplementation((id: string) =>
      id === "v1"
        ? new Promise<PartyAllergyRead>((resolve) => {
            resolveOld = resolve;
          })
        : Promise.resolve({
            ...allergyView("none"),
            partyId: "v7",
            snapshot: { ...allergyView("none").snapshot, revision: 9 },
          }),
    );
    const { el } = await mountApp({ readPartyAllergy: read });
    await openTable(el);
    await vi.waitFor(() => expect(read).toHaveBeenCalledOnce());
    const oldSignal = read.mock.calls[0]![1].signal as AbortSignal;
    emit(shell(el), "screen-select", { screen: "floor" });
    await flush(el);
    expect(oldSignal.aborted).toBe(true);
    emit(floor(el)!, "open-table", { tableId: "t7", seated: true });
    await vi.waitFor(() => expect(tableOrder(el)?.allergyView?.partyId).toBe("v7"));
    resolveOld(allergyView("allergies"));
    await flush(el);
    expect(tableOrder(el)?.allergyView?.partyId).toBe("v7");
    expect(tableOrder(el)?.allergyView?.snapshot.answer).toBe("none");
  });

  it("polls after fifteen seconds without overlapping a pending read and ignores an older reply after Save", async () => {
    const nativeTimeout = window.setTimeout.bind(window);
    let poll!: () => void;
    const timeout = vi.spyOn(window, "setTimeout").mockImplementation(((
      handler: TimerHandler,
      delay?: number,
      ...args: unknown[]
    ) => {
      if (delay === 15_000 && typeof handler === "function") poll = handler as () => void;
      return nativeTimeout(handler, delay, ...args);
    }) as typeof window.setTimeout);
    try {
      const read = vi.fn().mockResolvedValue(allergyView("none"));
      const { el } = await mountApp({ readPartyAllergy: read });
      const screen = await openTable(el);
      await vi.waitFor(() => expect(screen.allergyView).not.toBeNull());
      await vi.waitFor(() => expect(poll).toBeTypeOf("function"));
      let resolveRead!: (view: PartyAllergyRead) => void;
      read.mockImplementationOnce(
        () =>
          new Promise<PartyAllergyRead>((resolve) => {
            resolveRead = resolve;
          }),
      );
      const before = read.mock.calls.length;
      poll();
      window.dispatchEvent(new Event("focus"));
      expect(read).toHaveBeenCalledTimes(before + 1);
      emit(screen, "edit-party-allergy");
      await vi.waitFor(() => expect(dialog(el)?.mode).toBe("edit"));
      const form = dialog(el)!;
      await userEvent.click(form.shadowRoot!.querySelector<HTMLElement>("[data-add]")!);
      const who = form.shadowRoot!.querySelector<WtInput>("wt-input")!;
      await who.updateComplete;
      await userEvent.fill(who.shadowRoot!.querySelector("input")!, "Guest two");
      await userEvent.click(
        form.shadowRoot!.querySelector<HTMLInputElement>('[data-code="milk"]')!,
      );
      await userEvent.click(form.shadowRoot!.querySelector<HTMLElement>("[data-primary]")!);
      await vi.waitFor(() => expect(dialog(el)).toBeNull());
      resolveRead(allergyView("none"));
      await flush(el);
      expect(screen.allergyView?.snapshot.revision).toBe(4);
    } finally {
      timeout.mockRestore();
    }
  });

  it("places an editor refusal beside the named guest field", async () => {
    const { el } = await mountApp({
      savePartyAllergy: vi
        .fn()
        .mockRejectedValue({ code: "allergy.invalid", field: "guests.0.who" }),
    });
    const screen = await openTable(el);
    await vi.waitFor(() => expect(screen.allergyView).not.toBeNull());
    emit(screen, "edit-party-allergy");
    await vi.waitFor(() => expect(dialog(el)).not.toBeNull());
    const form = dialog(el)!;
    await userEvent.click(form.shadowRoot!.querySelector<HTMLElement>("[data-add]")!);
    const who = form.shadowRoot!.querySelector<WtInput>("wt-input")!;
    await who.updateComplete;
    await userEvent.fill(who.shadowRoot!.querySelector("input")!, "Guest two");
    await userEvent.click(form.shadowRoot!.querySelector<HTMLInputElement>('[data-code="milk"]')!);
    await userEvent.click(form.shadowRoot!.querySelector<HTMLElement>("[data-primary]")!);
    await vi.waitFor(() => expect(form.busy).toBe(false));
    expect(who.error).not.toBe("");
    expect(form.refusal).not.toBe("");
    expect(who.shadowRoot!.querySelector("input")!.value).toBe("Guest two");
  });

  it("keeps dirty input when a poll advances and requires a refreshed review before saving", async () => {
    const view = allergyView("allergies");
    view.snapshot.guests = [
      { id: "guest-1", position: 0, who: "Guest one", allergens: { milk: {} }, note: null },
    ];
    const read = vi.fn().mockResolvedValue(view);
    const { el } = await mountApp({ readPartyAllergy: read });
    const screen = await openTable(el);
    await vi.waitFor(() => expect(screen.allergyView).toEqual(view));
    emit(screen, "edit-party-allergy");
    await vi.waitFor(() => expect(dialog(el)?.mode).toBe("edit"));
    const form = dialog(el)!;
    await userEvent.click(form.shadowRoot!.querySelector<HTMLElement>('[data-edit="0"]')!);
    const who = form.shadowRoot!.querySelector<WtInput>("wt-input")!;
    await who.updateComplete;
    await userEvent.fill(who.shadowRoot!.querySelector("input")!, "My correction");
    const latest: PartyAllergyRead = {
      ...view,
      snapshot: {
        ...view.snapshot,
        revision: 4,
        guests: [
          ...view.snapshot.guests,
          {
            id: "guest-2",
            position: 1,
            who: "New guest elsewhere",
            allergens: { eggs: {} },
            note: null,
          },
        ],
      },
    };
    read.mockResolvedValue(latest);
    api.getTablesState!.mockResolvedValue([table("t4", "4", party({ revision: 4 }))]);
    api.listGroups!.mockResolvedValue({ revision: 4, groups: [] });
    api.readCurrentOrders!.mockResolvedValue({
      revision: 4,
      hasGroups: false,
      nextDisplayNumber: 1,
      retainedCourses: [],
      groups: [],
      ungrouped: [],
      reminder: null,
    });
    window.dispatchEvent(new Event("focus"));
    await vi.waitFor(() => expect(screen.allergyView?.snapshot.revision).toBe(4));
    expect(who.shadowRoot!.querySelector("input")!.value).toBe("My correction");
    await userEvent.click(form.shadowRoot!.querySelector<HTMLElement>("[data-primary]")!);
    await flush(el);
    expect(api.savePartyAllergy).not.toHaveBeenCalled();
    expect(dialog(el)).toBe(form);
    expect(form.refusal).not.toBe("");
    expect(form.shadowRoot!.textContent).toContain("New guest elsewhere");
    expect(who.shadowRoot!.querySelector("input")!.value).toBe("My correction");
    await userEvent.click(form.shadowRoot!.querySelector<HTMLElement>("[data-primary]")!);
    await vi.waitFor(() => expect(api.savePartyAllergy).toHaveBeenCalledOnce());
    expect(api.savePartyAllergy!.mock.calls[0]![1]).toMatchObject({
      expectedPartyRevision: 4,
      allergy: {
        party: {
          guests: [
            { id: "guest-1", who: "My correction", allergens: { milk: {} } },
            { id: "guest-2", who: "New guest elsewhere", allergens: { eggs: {} } },
          ],
        },
      },
    });
  });

  it("reuses an uncertain editor command on retry and closes before a failed refresh", async () => {
    const save = vi
      .fn()
      .mockRejectedValueOnce({ code: "server.unreachable" })
      .mockResolvedValue({
        ...allergyView("allergies"),
        snapshot: { ...allergyView("allergies").snapshot, revision: 4 },
      });
    const { el } = await mountApp({ savePartyAllergy: save });
    const screen = await openTable(el);
    await vi.waitFor(() => expect(screen.allergyView).not.toBeNull());
    emit(screen, "edit-party-allergy");
    await vi.waitFor(() => expect(dialog(el)).not.toBeNull());
    const form = dialog(el)!;
    await userEvent.click(form.shadowRoot!.querySelector<HTMLElement>("[data-add]")!);
    const who = form.shadowRoot!.querySelector<WtInput>("wt-input")!;
    await who.updateComplete;
    await userEvent.fill(who.shadowRoot!.querySelector("input")!, "Guest two");
    await userEvent.click(form.shadowRoot!.querySelector<HTMLInputElement>('[data-code="milk"]')!);
    await userEvent.click(form.shadowRoot!.querySelector<HTMLElement>("[data-primary]")!);
    await vi.waitFor(() => expect(form.busy).toBe(false));
    expect(form.refusal).not.toBe("");
    api.readPartyAllergy!.mockRejectedValue({ code: "server.unreachable" });
    await userEvent.click(form.shadowRoot!.querySelector<HTMLElement>("[data-primary]")!);
    await vi.waitFor(() => expect(save).toHaveBeenCalledTimes(2));
    expect(save.mock.calls[1]![1]).toEqual(save.mock.calls[0]![1]);
    await vi.waitFor(() => expect(dialog(el)).toBeNull());
    expect(screen.allergyView?.snapshot.revision).toBe(4);
  });

  it("reads the full party view on opening and binds it independently of the order draft", async () => {
    const view = allergyView("allergies");
    view.snapshot.guests = [
      { id: "guest-1", position: 0, who: "Guest one", allergens: { milk: {} }, note: null },
    ];
    const { el } = await mountApp({ readPartyAllergy: vi.fn().mockResolvedValue(view) });
    const screen = await openTable(el);
    await vi.waitFor(() => expect(screen.allergyView).toEqual(view));
    expect(screen.shadowRoot!.querySelector("[data-allergy-heading]")?.textContent).toContain(
      "Guest one",
    );
    await addDish(el);
    const store = draft(el);
    const lines = [...store.lines];
    const next = {
      ...view,
      snapshot: { ...view.snapshot, answer: "none" as const, guests: [], revision: 4 },
    };
    api.readPartyAllergy!.mockResolvedValue(next);
    window.dispatchEvent(new Event("focus"));
    await vi.waitFor(() => expect(screen.allergyView?.snapshot.revision).toBe(4));
    expect(screen.party?.revision).toBe(3);
    expect(draft(el)).toBe(store);
    expect(store.lines).toEqual(lines);
    expect(
      api.readPartyAllergy!.mock.calls.every(
        ([id, options]) => id === "v1" && options.signal instanceof AbortSignal,
      ),
    ).toBe(true);
  });

  it("opens Change as an editor and saves an explicit answer with the reviewed revision", async () => {
    const { el } = await mountApp();
    const screen = await openTable(el);
    await vi.waitFor(() => expect(screen.allergyView?.snapshot.answer).toBe("none"));
    await userEvent.click(screen.shadowRoot!.querySelector<HTMLElement>("[data-allergy-change]")!);
    await vi.waitFor(() => expect(dialog(el)?.mode).toBe("edit"));
    const form = dialog(el)!;
    expect(
      form.shadowRoot!.querySelector<HTMLElement>("[data-primary]")?.hasAttribute("disabled"),
    ).toBe(true);
    await userEvent.click(form.shadowRoot!.querySelector<HTMLElement>("[data-add]")!);
    const who = form.shadowRoot!.querySelector<WtInput>("wt-input")!;
    await who.updateComplete;
    await userEvent.fill(who.shadowRoot!.querySelector("input")!, "Guest two");
    await userEvent.click(form.shadowRoot!.querySelector<HTMLInputElement>('[data-code="milk"]')!);
    await userEvent.click(form.shadowRoot!.querySelector<HTMLElement>("[data-primary]")!);
    await vi.waitFor(() => expect(api.savePartyAllergy).toHaveBeenCalledOnce());
    expect(api.savePartyAllergy!.mock.calls[0]!.slice(0, 2)).toEqual([
      "v1",
      {
        submissionId: expect.any(String),
        expectedPartyRevision: 3,
        allergy: {
          party: {
            answer: "allergies",
            guests: [{ who: "Guest two", allergens: { milk: {} }, note: null }],
          },
          ticks: [],
        },
      },
    ]);
    await vi.waitFor(() => expect(dialog(el)).toBeNull());
    expect(screen.party?.revision).toBe(4);
  });
});

describe("A669 table orchestration", () => {
  it.each(["send-all", "fire-selected"])(
    "asks before %s and sends saved ids and the editing observation with the answer",
    async (action) => {
      const { el } = await mountApp();
      await openTable(el);
      await addDish(el);
      const screen = tableOrder(el)!;
      if (action === "fire-selected")
        await userEvent.click(
          screen.shadowRoot!.querySelector<HTMLElement>("[data-draft-select]")!,
        );
      await userEvent.click(
        screen.shadowRoot!.querySelector<HTMLElement>(`[data-draft-action="${action}"]`)!,
      );
      await vi.waitFor(() => expect(dialog(el)).not.toBeNull());
      expect(api.submitDraft).not.toHaveBeenCalled();
      expect(draft(el).sending).toBe(true);
      const preview = api.previewPartyAllergy!.mock.calls[0]![1] as Extract<
        AllergySendTarget,
        { kind: "draft" }
      >;
      expect(preview).toEqual({
        kind: "draft",
        draftId: server.drafts[0]!.id,
        lineIds: [server.drafts[0]!.lines[0]!.id],
      });
      await userEvent.click(dialog(el)!.shadowRoot!.querySelector<HTMLElement>("[data-none]")!);
      await vi.waitFor(() => expect(api.submitDraft).toHaveBeenCalledOnce());
      const packet = api.submitDraft!.mock.calls[0]![2];
      expect(packet).toMatchObject({
        expectedPartyRevision: 3,
        draftRevision: 1,
        allergy: { party: { answer: "none", guests: [] }, ticks: [] },
        groups: [{ release: action === "send-all" ? "hold" : "fire", lineIds: preview.lineIds }],
      });
      expect(packet.expectedEdit).toMatchObject({
        billId: "wo-4",
        draftId: preview.draftId,
        draftRevision: 1,
      });
    },
  );
  it("cancels without sending or dropping the draft", async () => {
    const { el } = await mountApp();
    await openTable(el);
    await addDish(el);
    await userEvent.click(
      tableOrder(el)!.shadowRoot!.querySelector<HTMLElement>('[data-draft-action="send-all"]')!,
    );
    await vi.waitFor(() => expect(dialog(el)).not.toBeNull());
    await userEvent.click(dialog(el)!.shadowRoot!.querySelector<HTMLElement>("[data-cancel]")!);
    await vi.waitFor(() => expect(draft(el).sending).toBe(false));
    expect(api.submitDraft).not.toHaveBeenCalled();
    expect(draft(el).lines).toHaveLength(1);
  });
  it("a failed preview blocks the send without inventing an answer", async () => {
    const { el } = await mountApp({
      previewPartyAllergy: vi.fn().mockRejectedValue({ code: "server.internal" }),
    });
    await openTable(el);
    await addDish(el);
    await userEvent.click(
      tableOrder(el)!.shadowRoot!.querySelector<HTMLElement>('[data-draft-action="send-all"]')!,
    );
    await vi.waitFor(() => expect(api.previewPartyAllergy).toHaveBeenCalledOnce());
    await flush(el);
    expect(api.submitDraft).not.toHaveBeenCalled();
    expect(draft(el).sending).toBe(false);
    expect(el.shadowRoot!.querySelector(".error")?.textContent?.trim()).toBeTruthy();
  });
});

it.each([
  { kind: "lines", event: "send-lines", method: "sendLines" },
  { kind: "group", event: "fire-group", method: "fireGroup" },
  { kind: "held-line", event: "fire-held-line", method: "fireHeldLine" },
] as const)(
  "asks before releasing $kind and attaches the explicit answer",
  async ({ kind, event, method }) => {
    const { el } = await mountApp();
    const screen = await openTable(el);
    const expectedEdit = screen.billEdit;
    emit(
      screen,
      event,
      kind === "lines"
        ? { lineNos: [2], expectedEdit }
        : kind === "group"
          ? { groupId: "held-group" }
          : { lineId: "held-line" },
    );
    await vi.waitFor(() => expect(dialog(el)).not.toBeNull());
    expect(api[method]).not.toHaveBeenCalled();
    await userEvent.click(dialog(el)!.shadowRoot!.querySelector<HTMLElement>("[data-none]")!);
    await vi.waitFor(() => expect(api[method]).toHaveBeenCalledOnce());
    const command = api[method]!.mock.calls[0]![kind === "lines" ? 3 : 2];
    expect(command).toMatchObject({
      expectedPartyRevision: 3,
      allergy: { party: { answer: "none", guests: [] }, ticks: [] },
    });
    expect(command.submissionId).toEqual(expect.any(String));
    if (kind === "lines")
      expect(api[method]!.mock.calls[0]!.slice(0, 3)).toEqual(["wo-4", [2], expectedEdit]);
    else
      expect(api[method]!.mock.calls[0]!.slice(0, 2)).toEqual([
        "v1",
        kind === "group" ? "held-group" : "held-line",
      ]);
  },
);

it("refreshes party metadata before using a newer allergy revision without replacing the draft", async () => {
  const getTablesState = vi.fn().mockResolvedValue([table4]);
  const listGroups = vi.fn().mockResolvedValue({ revision: 5, groups: [] });
  const readCurrentOrders = vi.fn().mockResolvedValue({
    revision: 5,
    hasGroups: false,
    nextDisplayNumber: 1,
    retainedCourses: [],
    groups: [],
    ungrouped: [],
    reminder: null,
  });
  const previewPartyAllergy = vi
    .fn()
    .mockImplementation(async (_id: string, target: AllergySendTarget) => ({
      ...allergyView(null, target),
      snapshot: { ...allergyView(null).snapshot, revision: 5 },
    }));
  const { el } = await mountApp({
    getTablesState,
    listGroups,
    readCurrentOrders,
    previewPartyAllergy,
  });
  await openTable(el);
  await addDish(el);
  const store = draft(el);
  const loadsBefore = server.listDrafts.mock.calls.length;
  getTablesState.mockResolvedValue([table("t4", "4", party({ revision: 5 }))]);
  const floorReads = getTablesState.mock.calls.length;
  await userEvent.click(
    tableOrder(el)!.shadowRoot!.querySelector<HTMLElement>('[data-draft-action="send-all"]')!,
  );
  await vi.waitFor(() => expect(dialog(el)).not.toBeNull());
  expect(getTablesState.mock.calls.length).toBeGreaterThan(floorReads);
  expect(tableOrder(el)!.party?.revision).toBe(5);
  expect(draft(el)).toBe(store);
  expect(server.listDrafts.mock.calls.length).toBe(loadsBefore);
  expect(api.submitDraft).not.toHaveBeenCalled();
  await userEvent.click(dialog(el)!.shadowRoot!.querySelector<HTMLElement>("[data-none]")!);
  await vi.waitFor(() => expect(api.submitDraft).toHaveBeenCalledOnce());
  expect(api.submitDraft!.mock.calls[0]![2].expectedPartyRevision).toBe(5);
});

it("keeps the answer and permits retry after the server refuses an allergy write", async () => {
  const submitDraft = vi
    .fn<TillApi["submitDraft"]>()
    .mockRejectedValueOnce({ code: "allergy.unanswered" })
    .mockImplementation((id, did, packet) => server.submitDraft(id, did, packet));
  const { el } = await mountApp({ submitDraft });
  await openTable(el);
  await addDish(el);
  await userEvent.click(
    tableOrder(el)!.shadowRoot!.querySelector<HTMLElement>('[data-draft-action="send-all"]')!,
  );
  await vi.waitFor(() => expect(dialog(el)).not.toBeNull());
  const form = dialog(el)!;
  await userEvent.click(form.shadowRoot!.querySelector<HTMLElement>("[data-none]")!);
  await vi.waitFor(() => expect(form.busy).toBe(false));
  expect(form.refusal).not.toBe("");
  expect(dialog(el)).toBe(form);
  expect(draft(el).sending).toBe(true);
  await userEvent.click(form.shadowRoot!.querySelector<HTMLElement>("[data-none]")!);
  await vi.waitFor(() => expect(submitDraft).toHaveBeenCalledTimes(2));
  expect(submitDraft.mock.calls[1]![2].allergy).toEqual({
    party: { answer: "none", guests: [] },
    ticks: [],
  });
});

it("does not spend the network deadline while the waiter is answering", async () => {
  const { el } = await mountApp();
  await openTable(el);
  await addDish(el);
  const timers = vi.spyOn(window, "setTimeout");
  const cleared = vi.spyOn(window, "clearTimeout");
  try {
    await userEvent.click(
      tableOrder(el)!.shadowRoot!.querySelector<HTMLElement>('[data-draft-action="send-all"]')!,
    );
    await vi.waitFor(() => expect(dialog(el)).not.toBeNull());
    const { TABLE_REQUEST_LIMIT_MS } = await import("./state/draft-sync.js");
    const requestTimers = timers.mock.calls.flatMap(([, delay], index) =>
      delay === TABLE_REQUEST_LIMIT_MS ? [timers.mock.results[index]!.value] : [],
    );
    expect(requestTimers.length).toBeGreaterThan(0);
    for (const timer of requestTimers) expect(cleared.mock.calls.flat()).toContain(timer);
  } finally {
    timers.mockRestore();
    cleared.mockRestore();
  }
});

it("puts a server's guest field refusal on that guest and permits correction", async () => {
  const submitDraft = vi.fn().mockRejectedValue({ code: "allergy.invalid", field: "guests.0.who" });
  const { el } = await mountApp({ submitDraft });
  await openTable(el);
  await addDish(el);
  await userEvent.click(
    tableOrder(el)!.shadowRoot!.querySelector<HTMLElement>('[data-draft-action="send-all"]')!,
  );
  await vi.waitFor(() => expect(dialog(el)).not.toBeNull());
  const form = dialog(el)!;
  await userEvent.click(form.shadowRoot!.querySelector<HTMLElement>("[data-allergies]")!);
  await userEvent.fill(
    form
      .shadowRoot!.querySelector('wt-input[name="guest-0-who"]')!
      .shadowRoot!.querySelector("input")!,
    "Blue shirt",
  );
  await userEvent.click(form.shadowRoot!.querySelector<HTMLInputElement>('[data-code="milk"]')!);
  await userEvent.click(form.shadowRoot!.querySelector<HTMLElement>("[data-primary]")!);
  await userEvent.click(form.shadowRoot!.querySelector<HTMLElement>("[data-primary]")!);
  await vi.waitFor(() => expect(submitDraft).toHaveBeenCalledOnce());
  await vi.waitFor(() => expect(form.fieldRefusal).toMatchObject({ field: "who", guestIndex: 0 }));
  expect(form.shadowRoot!.querySelector<WtInput>('wt-input[name="guest-0-who"]')!.error).not.toBe(
    "",
  );
});

it("never moves the shown party backwards to match an older allergy read", async () => {
  const getTablesState = vi.fn().mockResolvedValue([table("t4", "4", party({ revision: 5 }))]);
  const { el } = await mountApp({ getTablesState });
  await openTable(el);
  await addDish(el);
  getTablesState.mockResolvedValue([table4]);
  await userEvent.click(
    tableOrder(el)!.shadowRoot!.querySelector<HTMLElement>('[data-draft-action="send-all"]')!,
  );
  await vi.waitFor(() => expect(api.previewPartyAllergy).toHaveBeenCalledOnce());
  await flush(el);
  expect(tableOrder(el)!.party!.revision).toBe(5);
  expect(dialog(el)).toBeNull();
  expect(api.submitDraft).not.toHaveBeenCalled();
});

it.each(["success", "refusal"] as const)(
  "does not apply a late %s submit to a replacement API's view",
  async (outcome) => {
    let resolve!: (value: Awaited<ReturnType<TillApi["submitDraft"]>>) => void;
    let reject!: (error: unknown) => void;
    const pending = new Promise<Awaited<ReturnType<TillApi["submitDraft"]>>>((done, fail) => {
      resolve = done;
      reject = fail;
    });
    const submitDraft = vi.fn().mockReturnValue(pending);
    const { el } = await mountApp({
      submitDraft,
      previewPartyAllergy: vi
        .fn()
        .mockImplementation(async (_id: string, target: AllergySendTarget) =>
          allergyView("none", target),
        ),
    });
    await openTable(el);
    await addDish(el);
    await userEvent.click(
      tableOrder(el)!.shadowRoot!.querySelector<HTMLElement>('[data-draft-action="send-all"]')!,
    );
    await vi.waitFor(() => expect(submitDraft).toHaveBeenCalledOnce());
    const [partyId, draftId, packet] = submitDraft.mock.calls[0]!;
    el.api = { ...api } as unknown as TillApi;
    await flush(el, 6);
    if (outcome === "success") resolve(server.apply(partyId, draftId, packet));
    else reject({ code: "party.out_of_date" });
    await flush(el, 6);
    expect(tableOrder(el)).not.toBeNull();
    expect(tableOrder(el)!.party!.revision).toBe(3);
    expect(el.shadowRoot!.querySelector(".error")?.textContent?.trim() ?? "").toBe("");
  },
);

it("keeps the newest release opening when older previews answer last", async () => {
  const answers: ((view: PartyAllergyRead) => void)[] = [];
  const previewPartyAllergy = vi.fn().mockImplementation(
    () =>
      new Promise<PartyAllergyRead>((resolve) => {
        answers.push(resolve);
      }),
  );
  const { el } = await mountApp({ previewPartyAllergy });
  const screen = await openTable(el);
  emit(screen, "send-lines", { lineNos: [2], expectedEdit: screen.billEdit });
  emit(screen, "send-lines", { lineNos: [2], expectedEdit: screen.billEdit });
  await vi.waitFor(() => expect(answers).toHaveLength(2));
  const view = allergyView(null, { kind: "lines", orderId: "wo-4", lineNos: [2] });
  answers[1]!(view);
  await vi.waitFor(() => expect(dialog(el)).not.toBeNull());
  const key = dialog(el)!.scopeKey;
  answers[0]!(view);
  await flush(el, 6);
  expect(dialog(el)!.scopeKey).toBe(key);
  await userEvent.click(dialog(el)!.shadowRoot!.querySelector<HTMLElement>("[data-none]")!);
  await vi.waitFor(() => expect(api.sendLines).toHaveBeenCalledOnce());
});

it("keeps a duplicate grouped submit frozen until the allergy confirmation finishes", async () => {
  const { el } = await mountApp();
  const screen = await openTable(el);
  await addDish(el);
  const store = draft(el);
  const detail = {
    groups: [{ release: "hold", joinGroupId: "held-group", lineIndexes: [0] }],
    sent: [store.lines[0]!],
    store,
  };
  emit(screen, "submit-draft", detail);
  emit(screen, "submit-draft", detail);
  await vi.waitFor(() => expect(dialog(el)).not.toBeNull());
  await flush(el, 6);
  expect(store.sending).toBe(true);
  expect(api.submitDraft).not.toHaveBeenCalled();
  await userEvent.click(dialog(el)!.shadowRoot!.querySelector<HTMLElement>("[data-none]")!);
  await vi.waitFor(() => expect(api.submitDraft).toHaveBeenCalledOnce());
});
