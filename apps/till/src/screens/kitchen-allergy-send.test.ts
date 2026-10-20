import type { WtInput } from "@waitron/ui";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import type { PartyAllergyRead } from "@waitron/module";
import type { ExpoOrder, StationQueueGroup, TillApi } from "../api/client.js";
import { currentLocale, setLocale, t } from "../i18n/t.js";
import { codeMessage } from "../i18n/codes.js";
import { cleanupWidgets, expectNoA11yViolations, mountWidget } from "../widgets/test-helpers.js";
import type { TillPartyAllergyDialog } from "../widgets/party-allergy-dialog.js";
import { TillStationScreen } from "./till-station-screen.js";
import type { TillExpoScreen } from "./till-expo-screen.js";
import "./till-expo-screen.js";

const locale = currentLocale();
beforeEach(() => setLocale("en"));
afterEach(() => {
  cleanupWidgets();
  setLocale(locale);
});
const thresholds = { warmAfterMinutes: 5, overdueAfterMinutes: 10, forgottenAfterMinutes: 15 };
const party = { id: "party-1", revision: 7 };
const group = {
  id: "group-1",
  position: 1,
  displayNumber: 1,
  numberPartyId: party.id,
  state: "held" as const,
};
const stationItem = {
  id: "ticket-1",
  workingOrderLineId: "line-1",
  state: "queued" as const,
  name: "Soup",
  quantity: "1.000",
  course: { id: "course-1", name: "Starter", displayOrder: 1 },
  firedAt: null,
};
const stationGroup: StationQueueGroup = {
  kitchenNote: null,
  orderId: "bill-1",
  orderNumber: 5,
  label: "Table 4",
  queuedAt: "2026-10-20T10:00:00Z",
  status: "placed",
  thresholds,
  party,
  items: [{ ...stationItem, group }],
};
const expoItem = {
  id: "ticket-1",
  name: "Soup",
  qty: "1.000",
  stationName: "Kitchen",
  state: "queued" as const,
  firedAt: null,
  awayAt: null,
  queuedAt: "2026-10-20T10:00:00Z",
  thresholds,
  band: "fresh" as const,
};
const expoOrder: ExpoOrder = {
  kitchenNote: null,
  orderId: "bill-1",
  orderNumber: 5,
  tableLabel: "Table 4",
  openedMinutes: 2,
  worstBand: "fresh",
  party,
  courses: [],
  groups: [
    {
      groupId: group.id,
      position: 1,
      displayNumber: 1,
      numberPartyId: party.id,
      state: "held",
      fired: false,
      away: false,
      items: [expoItem],
    },
  ],
};
function view(answer: PartyAllergyRead["snapshot"]["answer"] = null): PartyAllergyRead {
  return {
    partyId: party.id,
    snapshot: { answer, guests: [], ticks: [], changedAt: null, changedBy: null, revision: 7 },
    dishes: [
      {
        line: { kind: "working", id: "line-1" },
        billId: "bill-1",
        name: "Soup",
        quantity: "1.000",
        allergens: {},
        extras: [],
        sentAt: null,
        offeredBefore: false,
      },
      {
        line: { kind: "working", id: "line-2" },
        billId: "bill-2",
        name: "Bread",
        quantity: "2.000",
        allergens: { gluten: { kinds: ["wheat"] } },
        extras: [],
        sentAt: null,
        offeredBefore: false,
      },
    ],
  };
}
function fixture(kind: "group" | "course", deviceMode = false) {
  const courseOrder = {
    ...expoOrder,
    party: undefined,
    groups: undefined,
    courses: [
      {
        courseId: "course-1",
        courseName: "Starter",
        displayOrder: 1,
        fired: false,
        away: false,
        items: [expoItem],
      },
    ],
  };
  const orders = [kind === "group" ? expoOrder : courseOrder];
  return {
    listStations: vi.fn().mockResolvedValue([
      {
        id: "station-1",
        name: "Kitchen",
        isDefault: true,
        active: true,
        open: true,
        byHand: null,
        sendsTo: null,
        why: "default",
      },
    ]),
    getStationQueue: vi.fn().mockResolvedValue({
      items: [kind === "group" ? stationGroup : { ...stationGroup, items: [stationItem] }],
      notices: [],
      printersDown: [],
    }),
    getExpoQueue: vi.fn().mockResolvedValue(orders),
    getDevicePassScreen: vi.fn().mockResolvedValue({ orders, stations: [], zones: null }),
    getFindBill: vi.fn().mockResolvedValue({ workingOrderId: "bill-1", partyId: party.id }),
    previewPartyAllergy: vi.fn<TillApi["previewPartyAllergy"]>().mockResolvedValue(view()),
    fireGroup: vi.fn<TillApi["fireGroup"]>().mockResolvedValue({ revision: 8 }),
    fireCourse: vi.fn<TillApi["fireCourse"]>().mockResolvedValue(undefined),
    fireDeviceGroup: vi.fn<TillApi["fireDeviceGroup"]>().mockResolvedValue({ revision: 8 }),
    fireDeviceCourse: vi.fn<TillApi["fireDeviceCourse"]>().mockResolvedValue(undefined),
    deviceMode,
  };
}
type Screen = TillStationScreen | TillExpoScreen;
async function mount(
  screen: "station" | "expo",
  kind: "group" | "course",
  api = fixture(kind),
  theme: "light" | "dark" = "light",
) {
  const { el } = await mountWidget<Screen>(
    `till-${screen}-screen`,
    {
      api: api as unknown as TillApi,
      embedded: true,
      runsPass: true,
      fireControl: screen === "station" ? "kitchen" : "expo",
      deviceMode: api.deviceMode,
    },
    theme,
  );
  await vi.waitFor(() =>
    expect(
      screen === "station"
        ? el.shadowRoot!.querySelector("till-station-queue")
        : el.shadowRoot!.querySelector(kind === "group" ? "[data-group-fire]" : "[data-fire]"),
    ).not.toBeNull(),
  );
  return { el, api };
}
async function fire(el: Screen, kind: "group" | "course") {
  if (el instanceof TillStationScreen)
    el.shadowRoot!.querySelector("till-station-queue")!.dispatchEvent(
      new CustomEvent(kind === "group" ? "fire-kitchen-group" : "fire-course", {
        detail:
          kind === "group"
            ? { partyId: party.id, groupId: group.id, expectedPartyRevision: 7 }
            : { orderId: "bill-1", courseId: "course-1" },
        bubbles: true,
        composed: true,
      }),
    );
  else
    await userEvent.click(
      el.shadowRoot!.querySelector<HTMLElement>(
        kind === "group" ? "[data-group-fire]" : "[data-fire]",
      )!,
    );
}
const dialog = (el: Screen) =>
  el.shadowRoot!.querySelector<TillPartyAllergyDialog>("till-party-allergy-dialog");
async function settle(el: Screen) {
  await new Promise<void>((r) => requestAnimationFrame(() => r()));
  await el.updateComplete;
}

describe("A669 kitchen fire callers", () => {
  it("changing stations retires a pending preview even if that station is reopened", async () => {
    let resolve!: (v: PartyAllergyRead) => void;
    const api = fixture("group");
    const stations = await api.listStations();
    api.listStations.mockResolvedValue([
      ...stations,
      { ...stations[0]!, id: "station-2", name: "Bar", isDefault: false },
    ]);
    api.previewPartyAllergy.mockImplementationOnce(
      () =>
        new Promise((r) => {
          resolve = r;
        }),
    );
    const { el } = await mount("station", "group", api);
    await fire(el, "group");
    await vi.waitFor(() => expect(api.previewPartyAllergy).toHaveBeenCalledOnce());
    await userEvent.click(el.shadowRoot!.querySelector<HTMLElement>('[data-station="station-2"]')!);
    await settle(el);
    await userEvent.click(el.shadowRoot!.querySelector<HTMLElement>('[data-station="station-1"]')!);
    await settle(el);
    resolve(view("none"));
    await settle(el);
    expect(api.fireGroup).not.toHaveBeenCalled();
    expect(dialog(el)).toBeNull();
  });

  it("a course lookup delivered with a changed operator cannot fire a counter dish", async () => {
    const api = fixture("course");
    const { el } = await mount("station", "course", api);
    api.getFindBill.mockImplementationOnce(async () => {
      el.operatorSession++;
      return { workingOrderId: "bill-1", partyId: null };
    });
    await fire(el, "course");
    await settle(el);
    expect(api.fireCourse).not.toHaveBeenCalled();
    expect(dialog(el)).toBeNull();
  });
  it("a successful Fire delivered with a changed operator does not refresh that operator's board", async () => {
    const api = fixture("group");
    const { el } = await mount("station", "group", api);
    api.fireGroup.mockImplementationOnce(async () => {
      el.operatorSession++;
      return { revision: 8 };
    });
    await fire(el, "group");
    await vi.waitFor(() => expect(dialog(el)).not.toBeNull());
    const reads = api.getStationQueue.mock.calls.length;
    await userEvent.click(dialog(el)!.shadowRoot!.querySelector<HTMLElement>("[data-none]")!);
    await settle(el);
    expect(api.fireGroup).toHaveBeenCalledOnce();
    expect(api.getStationQueue).toHaveBeenCalledTimes(reads);
    expect(dialog(el)).toBeNull();
  });
  it("a screen removed while starting its course lookup cancels that read", async () => {
    const api = fixture("course");
    const { el } = await mount("station", "course", api);
    api.getFindBill.mockImplementationOnce(() => {
      el.remove();
      return new Promise(() => {});
    });
    await fire(el, "course");
    await settle(el);
    expect(api.fireCourse).not.toHaveBeenCalled();
    expect(api.previewPartyAllergy).not.toHaveBeenCalled();
  });
  it("a preview naming another party is unread rather than an allergy answer", async () => {
    const api = fixture("group");
    api.previewPartyAllergy.mockResolvedValue({ ...view("none"), partyId: "other-party" });
    const { el } = await mount("station", "group", api);
    await fire(el, "group");
    await vi.waitFor(() =>
      expect(el.shadowRoot!.textContent).toContain(codeMessage("table.error")),
    );
    expect(api.fireGroup).not.toHaveBeenCalled();
  });
  it("a busy Fire ignores cancellation until its result is known", async () => {
    let resolve!: () => void;
    const api = fixture("group");
    api.fireGroup.mockImplementationOnce(
      () =>
        new Promise((r) => {
          resolve = () => r({ revision: 8 });
        }),
    );
    const { el } = await mount("station", "group", api);
    await fire(el, "group");
    await vi.waitFor(() => expect(dialog(el)).not.toBeNull());
    const form = dialog(el)!;
    await userEvent.click(form.shadowRoot!.querySelector<HTMLElement>("[data-none]")!);
    await vi.waitFor(() => expect(api.fireGroup).toHaveBeenCalledOnce());
    form.dispatchEvent(new CustomEvent("allergy-cancel", { bubbles: true, composed: true }));
    await settle(el);
    expect(dialog(el)).toBe(form);
    expect(form.busy).toBe(true);
    resolve();
    await vi.waitFor(() => expect(dialog(el)).toBeNull());
  });

  it.each(["station", "expo"] as const)(
    "%s keeps a counter course outside table allergy scope",
    async (screen) => {
      const api = fixture("course");
      api.getFindBill.mockResolvedValue({ workingOrderId: "bill-1", partyId: null });
      const { el } = await mount(screen, "course", api);
      await fire(el, "course");
      await vi.waitFor(() =>
        expect(api.fireCourse).toHaveBeenCalledExactlyOnceWith("bill-1", "course-1"),
      );
      expect(api.previewPartyAllergy).not.toHaveBeenCalled();
      expect(dialog(el)).toBeNull();
    },
  );
  it.each(["party.out_of_date", "allergy.out_of_date"])(
    "a %s write refusal closes consideration for a fresh Fire",
    async (code) => {
      const api = fixture("group");
      api.fireGroup.mockRejectedValueOnce({ code });
      const { el } = await mount("station", "group", api);
      await fire(el, "group");
      await vi.waitFor(() => expect(dialog(el)).not.toBeNull());
      await userEvent.click(dialog(el)!.shadowRoot!.querySelector<HTMLElement>("[data-none]")!);
      await vi.waitFor(() => expect(dialog(el)).toBeNull());
      expect(api.fireGroup).toHaveBeenCalledOnce();
      await fire(el, "group");
      await vi.waitFor(() => expect(dialog(el)).not.toBeNull());
      expect(api.previewPartyAllergy).toHaveBeenCalledTimes(2);
      expect(api.fireGroup).toHaveBeenCalledOnce();
    },
  );
  it("keeps showing a repeated Fire refusal while retaining its answer for retry", async () => {
    const api = fixture("group");
    api.fireGroup.mockRejectedValue({ code: "device.forbidden_action" });
    const { el } = await mount("station", "group", api);
    await fire(el, "group");
    await vi.waitFor(() => expect(dialog(el)).not.toBeNull());
    const form = dialog(el)!;
    await userEvent.click(form.shadowRoot!.querySelector<HTMLElement>("[data-none]")!);
    await vi.waitFor(() => expect(form.refusal).toBe(codeMessage("device.forbidden_action")));
    await userEvent.click(form.shadowRoot!.querySelector<HTMLElement>("[data-none]")!);
    await vi.waitFor(() => expect(api.fireGroup).toHaveBeenCalledTimes(2));
    await vi.waitFor(() => expect(form.refusal).toBe(codeMessage("device.forbidden_action")));
    expect(dialog(el)).toBe(form);
    expect(api.fireGroup.mock.calls[1]![2]).toEqual(api.fireGroup.mock.calls[0]![2]);
  });
  it("a failed Fire with no open form remains visible", async () => {
    const api = fixture("group");
    api.previewPartyAllergy.mockResolvedValue(view("none"));
    api.fireGroup.mockRejectedValue({ code: "device.forbidden_action" });
    const { el } = await mount("station", "group", api);
    await fire(el, "group");
    await vi.waitFor(() =>
      expect(el.shadowRoot!.textContent).toContain(codeMessage("device.forbidden_action")),
    );
    expect(dialog(el)).toBeNull();
  });
  it("Cancel after an unknown Fire retains no hidden retry", async () => {
    const api = fixture("group");
    api.fireGroup.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    const { el } = await mount("station", "group", api);
    await fire(el, "group");
    await vi.waitFor(() => expect(dialog(el)).not.toBeNull());
    const form = dialog(el)!;
    await userEvent.click(form.shadowRoot!.querySelector<HTMLElement>("[data-none]")!);
    await vi.waitFor(() => expect(form.refusal).not.toBe(""));
    form.dispatchEvent(new CustomEvent("allergy-cancel", { bubbles: true, composed: true }));
    await settle(el);
    expect(dialog(el)).toBeNull();
    expect(api.fireGroup).toHaveBeenCalledOnce();
  });
  it.each(["who", "allergens", "note"] as const)(
    "a Fire refusal marks the %s field and retains the guest",
    async (field) => {
      const api = fixture("group");
      const read = view("allergies");
      read.snapshot.guests = [
        { id: "guest-1", position: 0, who: "Alex", allergens: { milk: {} }, note: null },
      ];
      api.previewPartyAllergy.mockResolvedValue(read);
      api.fireGroup.mockRejectedValueOnce({ code: "allergy.invalid", field: `guests.0.${field}` });
      const { el } = await mount("station", "group", api);
      await fire(el, "group");
      await vi.waitFor(() => expect(dialog(el)).not.toBeNull());
      const form = dialog(el)!;
      await userEvent.click(form.shadowRoot!.querySelector<HTMLElement>("[data-primary]")!);
      await vi.waitFor(() => expect(form.fieldRefusal?.field).toBe(field));
      expect(form.fieldRefusal?.guestIndex).toBe(0);
      expect(form.shadowRoot!.querySelector<WtInput>('[data-guest="0"] wt-input')!.value).toBe(
        "Alex",
      );
      expect(form.busy).toBe(false);
    },
  );
  it("changed assignments after a refused Fire use a new command id", async () => {
    const api = fixture("group");
    const read = view("allergies");
    read.snapshot.guests = [
      { id: "guest-1", position: 0, who: "Alex", allergens: { milk: {} }, note: null },
    ];
    api.previewPartyAllergy.mockResolvedValue(read);
    api.fireGroup.mockRejectedValueOnce({ code: "allergy.invalid" });
    const { el } = await mount("station", "group", api);
    await fire(el, "group");
    await vi.waitFor(() => expect(dialog(el)).not.toBeNull());
    const form = dialog(el)!;
    await userEvent.click(form.shadowRoot!.querySelector<HTMLElement>("[data-primary]")!);
    await vi.waitFor(() => expect(form.refusal).not.toBe(""));
    await userEvent.click(form.shadowRoot!.querySelector<HTMLInputElement>('[data-tick="0:1"]')!);
    await userEvent.click(form.shadowRoot!.querySelector<HTMLElement>("[data-primary]")!);
    await vi.waitFor(() => expect(api.fireGroup).toHaveBeenCalledTimes(2));
    expect(api.fireGroup.mock.calls[1]![2].submissionId).not.toBe(
      api.fireGroup.mock.calls[0]![2].submissionId,
    );
    expect(api.fireGroup.mock.calls[1]![2].allergy).toEqual({
      ticks: [{ line: { kind: "working", id: "line-2" }, guestIndex: 0 }],
    });
  });
  it.each(["success", "failure"] as const)(
    "a late Fire %s cannot affect the new same-party opening",
    async (result) => {
      let resolve!: () => void;
      let reject!: (e: unknown) => void;
      const api = fixture("group");
      api.fireGroup.mockImplementationOnce(
        () =>
          new Promise((r, j) => {
            resolve = () => r({ revision: 8 });
            reject = j;
          }),
      );
      const { el } = await mount("station", "group", api);
      await fire(el, "group");
      await vi.waitFor(() => expect(dialog(el)).not.toBeNull());
      await userEvent.click(dialog(el)!.shadowRoot!.querySelector<HTMLElement>("[data-none]")!);
      await vi.waitFor(() => expect(api.fireGroup).toHaveBeenCalledOnce());
      el.operatorSession++;
      await el.updateComplete;
      await settle(el);
      await fire(el, "group");
      await vi.waitFor(() => expect(dialog(el)).not.toBeNull());
      const current = dialog(el)!;
      if (result === "success") resolve();
      else reject({ code: "allergy.invalid" });
      await settle(el);
      expect(dialog(el)).toBe(current);
      expect(current.refusal).toBe("");
      expect(current.busy).toBe(false);
      expect(api.fireGroup).toHaveBeenCalledOnce();
    },
  );

  it("a late course lookup refusal cannot mark the next station orientation", async () => {
    let reject!: (e: unknown) => void;
    const api = fixture("course");
    api.getFindBill.mockImplementationOnce(
      () =>
        new Promise((_, r) => {
          reject = r;
        }),
    );
    const { el } = await mount("station", "course", api);
    await fire(el, "course");
    await vi.waitFor(() => expect(api.getFindBill).toHaveBeenCalledOnce());
    el.operatorSession++;
    await el.updateComplete;
    reject({ code: "allergy.unanswered" });
    await settle(el);
    expect(el.shadowRoot!.querySelector('[role="alert"]')).toBeNull();
    expect(api.fireCourse).not.toHaveBeenCalled();
  });
  it.each(["station", "expo"] as const)(
    "%s shows a failed preview without sending or inventing an answer",
    async (screen) => {
      const api = fixture("group");
      api.previewPartyAllergy.mockRejectedValue({ code: "device.forbidden_action" });
      const { el } = await mount(screen, "group", api);
      await fire(el, "group");
      await vi.waitFor(() =>
        expect(el.shadowRoot!.textContent).toContain(codeMessage("device.forbidden_action")),
      );
      expect(api.fireGroup).not.toHaveBeenCalled();
      expect(dialog(el)).toBeNull();
    },
  );

  for (const screen of ["station", "expo"] as const)
    for (const language of ["en", "es"] as const)
      for (const theme of ["light", "dark"] as const)
        for (const width of [390, 1280]) {
          it(`renders ${screen} ${language} ${theme} ${width} with a visible question and cross-bill clash`, async () => {
            setLocale(language);
            await page.viewport(width, 900);
            try {
              const api = fixture("group");
              const { el } = await mount(screen, "group", api, theme);
              el.parentElement!.style.width = `${width}px`;
              el.style.width = "100%";
              await fire(el, "group");
              await vi.waitFor(() => expect(dialog(el)).not.toBeNull());
              const form = dialog(el)!;
              await form.updateComplete;
              expect(Math.round(el.getBoundingClientRect().width)).toBe(width);
              expect(form.shadowRoot!.querySelector("wt-dialog")!.heading).toBe(
                t("allergy.question"),
              );
              await expectNoA11yViolations(el.parentElement!);
              await page.screenshot({
                path: `../../__screenshots__/a669-kitchen/${screen}-${language}-${theme}-${width}-question.png`,
              });
              form.dispatchEvent(
                new CustomEvent("allergy-cancel", { bubbles: true, composed: true }),
              );
              await settle(el);
              const read = view("allergies");
              read.snapshot.guests = [
                {
                  id: "guest-1",
                  position: 0,
                  who: "Alex",
                  allergens: { gluten: { kinds: ["wheat"] } },
                  note: "Separate preparation",
                },
              ];
              api.previewPartyAllergy.mockResolvedValue(read);
              await fire(el, "group");
              await vi.waitFor(() => expect(dialog(el)).not.toBeNull());
              const next = dialog(el)!;
              await next.updateComplete;
              await userEvent.click(
                next.shadowRoot!.querySelector<HTMLInputElement>('[data-tick="0:1"]')!,
              );
              expect(next.shadowRoot!.querySelector("[data-clash]")!.textContent).toContain("Alex");
              const box = next
                .shadowRoot!.querySelector("wt-dialog")!
                .shadowRoot!.querySelector("dialog")!
                .getBoundingClientRect();
              expect(box.left).toBeGreaterThanOrEqual(0);
              expect(box.right).toBeLessThanOrEqual(width + 1);
              await expectNoA11yViolations(el.parentElement!);
              await page.screenshot({
                path: `../../__screenshots__/a669-kitchen/${screen}-${language}-${theme}-${width}-clash.png`,
              });
              expect(api.fireGroup).not.toHaveBeenCalled();
            } finally {
              await page.viewport(1280, 900);
            }
          });
        }

  it.each(["station", "expo"] as const)(
    "%s retains an unknown Fire answer for an exact retry",
    async (screen) => {
      const api = fixture("group");
      api.fireGroup.mockRejectedValueOnce(new TypeError("Failed to fetch"));
      const { el } = await mount(screen, "group", api);
      await fire(el, "group");
      await vi.waitFor(() => expect(dialog(el)).not.toBeNull());
      const form = dialog(el)!;
      await userEvent.click(form.shadowRoot!.querySelector<HTMLElement>("[data-none]")!);
      await vi.waitFor(() => expect(form.refusal).not.toBe(""));
      expect(form.busy).toBe(false);
      const original = structuredClone(api.fireGroup.mock.calls[0]![2]);
      await userEvent.click(form.shadowRoot!.querySelector<HTMLElement>("[data-none]")!);
      await vi.waitFor(() => expect(api.fireGroup).toHaveBeenCalledTimes(2));
      expect(api.fireGroup.mock.calls[1]![2]).toEqual(original);
      await vi.waitFor(() => expect(dialog(el)).toBeNull());
    },
  );
  it.each(["station", "expo"] as const)(
    "%s rejects a stale card before sending its answer",
    async (screen) => {
      const api = fixture("group");
      const read = view();
      read.snapshot.revision = 8;
      api.previewPartyAllergy.mockResolvedValue(read);
      const { el } = await mount(screen, "group", api);
      await fire(el, "group");
      await vi.waitFor(() =>
        expect(el.shadowRoot!.querySelector("[data-table-changed]")).not.toBeNull(),
      );
      expect(api.fireGroup).not.toHaveBeenCalled();
      expect(dialog(el)).toBeNull();
    },
  );
  it.each(["station", "expo"] as const)(
    "%s closes the answer when another operator signs in on the same API",
    async (screen) => {
      const { el, api } = await mount(screen, "group");
      await fire(el, "group");
      await vi.waitFor(() => expect(dialog(el)).not.toBeNull());
      const old = dialog(el)!;
      el.operatorSession++;
      await el.updateComplete;
      await settle(el);
      expect(dialog(el)).toBeNull();
      old.dispatchEvent(
        new CustomEvent("allergy-confirm", {
          detail: {
            scopeKey: old.scopeKey,
            expectedPartyRevision: 7,
            patch: { party: { answer: "none", guests: [] }, ticks: [] },
          },
          bubbles: true,
          composed: true,
        }),
      );
      await settle(el);
      expect(api.fireGroup).not.toHaveBeenCalled();
    },
  );
  it("a pass board changed away and back does not accept its old preview", async () => {
    let resolve!: (v: PartyAllergyRead) => void;
    const api = fixture("group");
    api.previewPartyAllergy.mockImplementationOnce(
      () =>
        new Promise((r) => {
          resolve = r;
        }),
    );
    const { el } = await mount("expo", "group", api);
    await fire(el, "group");
    await vi.waitFor(() => expect(api.previewPartyAllergy).toHaveBeenCalledOnce());
    el.embedded = false;
    await el.updateComplete;
    el.embedded = true;
    await el.updateComplete;
    resolve(view("none"));
    await settle(el);
    expect(api.fireGroup).not.toHaveBeenCalled();
    expect(dialog(el)).toBeNull();
  });
  it.each(["station", "expo"] as const)(
    "%s prevents two presses from opening or sending twice",
    async (screen) => {
      const { el, api } = await mount(screen, "group");
      if (el instanceof TillStationScreen) {
        await fire(el, "group");
        await fire(el, "group");
      } else {
        const button = el.shadowRoot!.querySelector<HTMLElement>("[data-group-fire]")!;
        button.click();
        button.click();
      }
      await vi.waitFor(() => expect(dialog(el)).not.toBeNull());
      expect(api.previewPartyAllergy).toHaveBeenCalledOnce();
      await userEvent.click(dialog(el)!.shadowRoot!.querySelector<HTMLElement>("[data-none]")!);
      await vi.waitFor(() => expect(api.fireGroup).toHaveBeenCalledOnce());
    },
  );

  it.each([
    ["station", "group"],
    ["station", "course"],
    ["expo", "group"],
    ["expo", "course"],
  ] as const)(
    "%s %s asks before Fire and sends an explicit answer atomically",
    async (screen, kind) => {
      const { el, api } = await mount(screen, kind);
      await fire(el, kind);
      await vi.waitFor(() => expect(dialog(el)).not.toBeNull());
      const send = kind === "group" ? api.fireGroup : api.fireCourse;
      expect(send).not.toHaveBeenCalled();
      expect(api.previewPartyAllergy).toHaveBeenCalledWith(
        party.id,
        kind === "group"
          ? { kind: "group", groupId: group.id }
          : { kind: "course", orderId: "bill-1", courseId: "course-1" },
        expect.objectContaining({ signal: expect.any(AbortSignal) }),
      );
      await userEvent.click(dialog(el)!.shadowRoot!.querySelector<HTMLElement>("[data-none]")!);
      await vi.waitFor(() => expect(send).toHaveBeenCalledOnce());
      expect(send.mock.calls[0]!.slice(0, 3)).toEqual([
        kind === "group" ? party.id : "bill-1",
        kind === "group" ? group.id : "course-1",
        {
          submissionId: expect.any(String),
          expectedPartyRevision: 7,
          allergy: { party: { answer: "none", guests: [] }, ticks: [] },
        },
      ]);
      await vi.waitFor(() => expect(dialog(el)).toBeNull());
    },
  );
  it.each(["station", "expo"] as const)("%s cancellation fires nothing", async (screen) => {
    const { el, api } = await mount(screen, "group");
    await fire(el, "group");
    await vi.waitFor(() => expect(dialog(el)).not.toBeNull());
    dialog(el)!.dispatchEvent(new CustomEvent("allergy-cancel", { bubbles: true, composed: true }));
    await settle(el);
    expect(api.fireGroup).not.toHaveBeenCalled();
    expect(dialog(el)).toBeNull();
  });
  it.each(["station", "expo"] as const)(
    "%s sends one guest assignment across both bills without dropping a dish",
    async (screen) => {
      const api = fixture("group");
      const read = view("allergies");
      read.snapshot.guests = [
        { id: "guest-1", position: 0, who: "Alex", allergens: { milk: {} }, note: null },
      ];
      api.previewPartyAllergy.mockResolvedValue(read);
      const { el } = await mount(screen, "group", api);
      await fire(el, "group");
      await vi.waitFor(() => expect(dialog(el)).not.toBeNull());
      const form = dialog(el)!;
      const checks = form.shadowRoot!.querySelectorAll<HTMLInputElement>("input[data-tick]");
      expect(checks).toHaveLength(2);
      await userEvent.click(checks[1]!);
      await userEvent.click(form.shadowRoot!.querySelector<HTMLElement>("[data-primary]")!);
      await vi.waitFor(() => expect(api.fireGroup).toHaveBeenCalledOnce());
      expect(api.fireGroup.mock.calls[0]![2].allergy).toEqual({
        ticks: [{ line: { kind: "working", id: "line-2" }, guestIndex: 0 }],
      });
    },
  );
  it.each(["station", "expo"] as const)(
    "%s never reoffers already considered held dishes",
    async (screen) => {
      const api = fixture("group");
      const read = view("allergies");
      read.dishes.forEach((d) => (d.offeredBefore = true));
      api.previewPartyAllergy.mockResolvedValue(read);
      const { el } = await mount(screen, "group", api);
      await fire(el, "group");
      await vi.waitFor(() => expect(api.fireGroup).toHaveBeenCalledOnce());
      expect(dialog(el)).toBeNull();
      expect(api.fireGroup.mock.calls[0]![2]).toEqual({
        submissionId: expect.any(String),
        expectedPartyRevision: 7,
      });
    },
  );
  it.each(["group", "course"] as const)(
    "device %s shows an unanswered refusal and opens no person-owned editor",
    async (kind) => {
      const api = fixture(kind, true);
      (kind === "group" ? api.fireDeviceGroup : api.fireDeviceCourse).mockRejectedValue({
        code: "allergy.unanswered",
      });
      const { el } = await mount("expo", kind, api);
      await fire(el, kind);
      await vi.waitFor(() =>
        expect(el.shadowRoot!.textContent).toContain(codeMessage("allergy.unanswered")),
      );
      expect(dialog(el)).toBeNull();
      expect(api.previewPartyAllergy).not.toHaveBeenCalled();
      expect(api.fireGroup).not.toHaveBeenCalled();
      expect(api.fireCourse).not.toHaveBeenCalled();
    },
  );
  it.each(["station", "expo"] as const)(
    "%s ignores a preview after an API switch",
    async (screen) => {
      let resolve!: (v: PartyAllergyRead) => void;
      const api = fixture("group");
      api.previewPartyAllergy.mockImplementation(
        () =>
          new Promise((r) => {
            resolve = r;
          }),
      );
      const { el } = await mount(screen, "group", api);
      await fire(el, "group");
      await vi.waitFor(() => expect(api.previewPartyAllergy).toHaveBeenCalledOnce());
      el.api = fixture("group") as unknown as TillApi;
      await el.updateComplete;
      resolve(view());
      await settle(el);
      expect(dialog(el)).toBeNull();
      expect(api.fireGroup).not.toHaveBeenCalled();
    },
  );
  it.each(["station", "expo"] as const)(
    "%s invalidates a removed and reopened same-party screen",
    async (screen) => {
      let resolve!: (v: PartyAllergyRead) => void;
      const api = fixture("group");
      api.previewPartyAllergy.mockImplementationOnce(
        () =>
          new Promise((r) => {
            resolve = r;
          }),
      );
      const { el } = await mount(screen, "group", api);
      await fire(el, "group");
      await vi.waitFor(() => expect(api.previewPartyAllergy).toHaveBeenCalledOnce());
      const parent = el.parentElement!;
      el.remove();
      parent.append(el);
      await el.updateComplete;
      resolve(view("none"));
      await settle(el);
      expect(api.fireGroup).not.toHaveBeenCalled();
      expect(dialog(el)).toBeNull();
      await fire(el, "group");
      await vi.waitFor(() => expect(dialog(el)).not.toBeNull());
    },
  );
});
