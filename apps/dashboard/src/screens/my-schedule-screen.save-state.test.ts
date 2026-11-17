import { afterEach, describe, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import { chooseOption } from "@waitron/ui/src/test-helpers.js";
import { cleanupWidgets, mountWidget } from "../widgets/test-helpers.js";
import { setLocale, t } from "../i18n/t.js";
import { codeMessage } from "../i18n/codes.js";
import type { DashboardApi, MyShift, RosterEntry } from "../api/client.js";
import "./my-schedule-screen.js";
import type { MyScheduleScreen } from "./my-schedule-screen.js";

afterEach(() => {
  cleanupWidgets();
  setLocale("es-ES");
});

const roster: RosterEntry[] = [
  { personId: "me", displayName: "Me" },
  { personId: "col1", displayName: "Ana" },
  { personId: "col2", displayName: "Luis" },
];
const shift: MyShift = {
  id: "s1",
  startsAt: "2026-05-04T09:00:00Z",
  startsOffsetMinutes: 0,
  endsAt: "2026-05-04T17:00:00Z",
  endsOffsetMinutes: 0,
  description: "bar",
  rosterVersionId: "rota-week",
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((yes) => (resolve = yes));
  return { promise, resolve };
}

function stubApi() {
  return {
    getStaffRoster: vi.fn(async () => roster),
    listMyShifts: vi.fn(async () => [shift]),
    listMySwaps: vi.fn(async () => []),
    listMyAbsences: vi.fn(async () => []),
    acceptSwap: vi.fn(async () => {}),
    requestSwap: vi.fn(async () => ({ swapId: "sw9" })),
    requestAbsence: vi.fn(async () => ({ absenceId: "ab9" })),
  };
}

async function mountLoaded(api = stubApi()) {
  setLocale("en-GB");
  const { el } = await mountWidget<MyScheduleScreen>("dashboard-my-schedule-screen", {
    api: api as unknown as DashboardApi,
    myPersonId: "me",
  });
  await vi.waitFor(() => expect(q(el, "[data-test=shift-s1]")).not.toBeNull());
  await el.updateComplete;
  return { el, api };
}

const q = <T extends HTMLElement = HTMLElement>(el: MyScheduleScreen, selector: string) =>
  el.shadowRoot!.querySelector<T>(selector);

type Action = "cover-submit" | "abs-submit";
function action(el: MyScheduleScreen, which: Action) {
  return q<HTMLElementTagNameMap["wt-button"]>(el, `[data-test=${which}]`)!;
}
/** What the action looks like and whether a person can press it: the host's state and its inner button's. */
async function state(el: MyScheduleScreen, which: Action) {
  await el.updateComplete;
  const button = action(el, which);
  await button.updateComplete;
  return {
    variant: button.variant,
    disabled: button.disabled,
    innerDisabled: button.shadowRoot!.querySelector("button")!.disabled,
  };
}
const quiet = { variant: "secondary", disabled: true, innerDisabled: true };
const ready = { variant: "primary", disabled: false, innerDisabled: false };
const blocked = { variant: "primary", disabled: true, innerDisabled: true };

/** A real pointer press on the inner button; `force` presses a disabled one too. */
async function press(el: MyScheduleScreen, which: Action) {
  await userEvent.click(
    page.elementLocator(action(el, which).shadowRoot!.querySelector("button")!),
    {
      force: true,
    },
  );
  await el.updateComplete;
}
async function choose(el: MyScheduleScreen, dataTest: string, value: string) {
  await chooseOption(q(el, `[data-test=${dataTest}]`)!, value);
  await el.updateComplete;
}
async function type(el: MyScheduleScreen, dataTest: string, value: string) {
  const field = q<HTMLElementTagNameMap["wt-input"]>(el, `[data-test=${dataTest}]`)!;
  await field.updateComplete;
  await userEvent.fill(page.elementLocator(field.shadowRoot!.querySelector("input")!), value);
  await el.updateComplete;
}
async function settle(el: MyScheduleScreen) {
  await new Promise((resolve) => setTimeout(resolve, 0));
  await el.updateComplete;
}

describe("the cover request", () => {
  it("opens quiet, and a press sends nothing", async () => {
    const { el, api } = await mountLoaded();
    expect(await state(el, "cover-submit")).toEqual(quiet);
    await press(el, "cover-submit");
    expect(api.requestSwap).not.toHaveBeenCalled();
  });

  it("wakes once a field is chosen, before the other is, and choosing the empty values back quiets it", async () => {
    const { el } = await mountLoaded();
    await choose(el, "cover-shift", "s1");
    expect(await state(el, "cover-submit")).toEqual(ready);
    await choose(el, "cover-colleague", "col1");
    expect(await state(el, "cover-submit")).toEqual(ready);
    await choose(el, "cover-colleague", "");
    await choose(el, "cover-shift", "");
    expect(await state(el, "cover-submit")).toEqual(quiet);
  });

  it("after a request is sent, the cleared form is quiet again", async () => {
    const { el, api } = await mountLoaded();
    await choose(el, "cover-shift", "s1");
    await choose(el, "cover-colleague", "col1");
    await press(el, "cover-submit");
    expect(api.requestSwap).toHaveBeenCalledExactlyOnceWith({
      fromShiftId: "s1",
      toPersonId: "col1",
      toShiftId: null,
    });
    await vi.waitFor(async () => expect(await state(el, "cover-submit")).toEqual(quiet));
  });

  it("a filled form that matches the request just sent is quiet, and a press sends nothing", async () => {
    const api = stubApi();
    const reply = deferred<{ swapId: string }>();
    api.requestSwap.mockImplementationOnce(() => reply.promise);
    const { el } = await mountLoaded(api);
    await choose(el, "cover-shift", "s1");
    await choose(el, "cover-colleague", "col1");
    await press(el, "cover-submit");
    await choose(el, "cover-colleague", "col2");
    reply.resolve({ swapId: "sw9" });
    await vi.waitFor(async () => expect(await state(el, "cover-submit")).toEqual(ready));
    await choose(el, "cover-colleague", "col1");
    expect(await state(el, "cover-submit")).toEqual(quiet);
    await press(el, "cover-submit");
    // A host `.click()` reaches the listener even while the inner button is disabled, so this proves
    // the handler itself sends nothing for an unchanged form.
    action(el, "cover-submit").click();
    await settle(el);
    expect(api.requestSwap).toHaveBeenCalledTimes(1);
  });
});

describe("the absence request", () => {
  it("opens quiet, and a press sends nothing", async () => {
    const { el, api } = await mountLoaded();
    expect(await state(el, "abs-submit")).toEqual(quiet);
    await press(el, "abs-submit");
    expect(api.requestAbsence).not.toHaveBeenCalled();
  });

  it("one edit wakes it, and typing the original value back quiets it", async () => {
    const { el } = await mountLoaded();
    await choose(el, "abs-kind", "sick_leave");
    expect(await state(el, "abs-submit")).toEqual(ready);
    await choose(el, "abs-kind", "holiday");
    expect(await state(el, "abs-submit")).toEqual(quiet);
    await type(el, "abs-from", "2026-06-01");
    await type(el, "abs-to", "2026-06-03");
    expect(await state(el, "abs-submit")).toEqual(ready);
    await type(el, "abs-to", "");
    expect(await state(el, "abs-submit")).toEqual(ready);
    await type(el, "abs-from", "");
    expect(await state(el, "abs-submit")).toEqual(quiet);
    await type(el, "abs-note", "Wedding");
    expect(await state(el, "abs-submit")).toEqual(ready);
    await type(el, "abs-note", "");
    expect(await state(el, "abs-submit")).toEqual(quiet);
  });

  it("after a request is sent, the cleared form is quiet again", async () => {
    const { el, api } = await mountLoaded();
    await type(el, "abs-from", "2026-06-01");
    await type(el, "abs-to", "2026-06-03");
    await type(el, "abs-note", "Wedding");
    await press(el, "abs-submit");
    expect(api.requestAbsence).toHaveBeenCalledExactlyOnceWith({
      kind: "holiday",
      startsOn: "2026-06-01",
      endsOn: "2026-06-03",
      note: "Wedding",
    });
    await vi.waitFor(async () => expect(await state(el, "abs-submit")).toEqual(quiet));
  });

  it("a filled form that matches the request just sent is quiet, and a press sends nothing", async () => {
    const api = stubApi();
    const reply = deferred<{ absenceId: string }>();
    api.requestAbsence.mockImplementationOnce(() => reply.promise);
    const { el } = await mountLoaded(api);
    await type(el, "abs-from", "2026-06-01");
    await type(el, "abs-to", "2026-06-03");
    await press(el, "abs-submit");
    await type(el, "abs-note", "Wedding");
    reply.resolve({ absenceId: "ab9" });
    await vi.waitFor(async () => expect(await state(el, "abs-submit")).toEqual(ready));
    await type(el, "abs-note", "");
    expect(await state(el, "abs-submit")).toEqual(quiet);
    await press(el, "abs-submit");
    action(el, "abs-submit").click();
    await settle(el);
    expect(api.requestAbsence).toHaveBeenCalledTimes(1);
  });
});

describe("the forms contract", () => {
  type Form = "cover" | "request-absence";
  const actions = (el: MyScheduleScreen, form: Form) =>
    q<HTMLElementTagNameMap["wt-form-actions"]>(el, `.${form} wt-form-actions`)!;
  const fieldError = (el: MyScheduleScreen, name: string) =>
    q<HTMLElement & { error: string }>(el, `[data-test=${name}]`)!.error;
  const focused = (el: MyScheduleScreen) => el.shadowRoot!.activeElement?.getAttribute("name");

  it("marks the required fields", async () => {
    const { el } = await mountLoaded();
    const required = (name: string) =>
      q<HTMLElement & { required: boolean }>(el, `[data-test=${name}]`)!.required;
    expect(["cover-shift", "cover-colleague", "abs-from", "abs-to"].map(required)).toEqual([
      true,
      true,
      true,
      true,
    ]);
    expect(["abs-kind", "abs-note"].map(required)).toEqual([false, false]);
  });

  it("a cover press with no shift marks it, says so below, focuses it and sends nothing; choosing it lets the press send", async () => {
    const { el, api } = await mountLoaded();
    await choose(el, "cover-colleague", "col1");
    expect(await state(el, "cover-submit")).toEqual(ready);
    await press(el, "cover-submit");
    await settle(el);
    expect(api.requestSwap).not.toHaveBeenCalled();
    expect(fieldError(el, "cover-shift")).toBe(t("myschedule.cover_shift_required"));
    expect(fieldError(el, "cover-colleague")).toBe("");
    expect(actions(el, "cover").error).toBe(t("form.fix_fields"));
    expect(actions(el, "request-absence").error).toBe("");
    expect(q(el, "[data-test=notice]")).toBeNull();
    await vi.waitFor(() => expect(focused(el)).toBe("cover-shift"));
    expect(q<HTMLElement & { value: string }>(el, "[data-test=cover-colleague]")!.value).toBe(
      "col1",
    );
    expect(await state(el, "cover-submit")).toEqual(blocked);

    await choose(el, "cover-shift", "s1");
    expect(fieldError(el, "cover-shift")).toBe("");
    expect(actions(el, "cover").error).toBe("");
    expect(await state(el, "cover-submit")).toEqual(ready);
    await press(el, "cover-submit");
    expect(api.requestSwap).toHaveBeenCalledExactlyOnceWith({
      fromShiftId: "s1",
      toPersonId: "col1",
      toShiftId: null,
    });
  });

  it("a cover press with no colleague marks the colleague, and clearing it again after a fix marks it again", async () => {
    const { el, api } = await mountLoaded();
    await choose(el, "cover-shift", "s1");
    await press(el, "cover-submit");
    await settle(el);
    expect(api.requestSwap).not.toHaveBeenCalled();
    expect(fieldError(el, "cover-shift")).toBe("");
    expect(fieldError(el, "cover-colleague")).toBe(t("myschedule.cover_colleague_required"));
    await vi.waitFor(() => expect(focused(el)).toBe("cover-colleague"));
    await choose(el, "cover-colleague", "col1");
    expect(fieldError(el, "cover-colleague")).toBe("");
    await choose(el, "cover-colleague", "");
    expect(fieldError(el, "cover-colleague")).toBe(t("myschedule.cover_colleague_required"));
    expect(actions(el, "cover").error).toBe(t("form.fix_fields"));
    expect(await state(el, "cover-submit")).toEqual(blocked);
  });

  it("an absence press with no dates marks both, focuses From and sends nothing; filling them lets the press send", async () => {
    const { el, api } = await mountLoaded();
    await choose(el, "abs-kind", "sick_leave");
    await press(el, "abs-submit");
    await settle(el);
    expect(api.requestAbsence).not.toHaveBeenCalled();
    expect(fieldError(el, "abs-from")).toBe(t("myschedule.absence_from_required"));
    expect(fieldError(el, "abs-to")).toBe(t("myschedule.absence_to_required"));
    expect(actions(el, "request-absence").error).toBe(t("form.fix_fields"));
    expect(actions(el, "cover").error).toBe("");
    await vi.waitFor(() => expect(focused(el)).toBe("abs-from"));
    expect(await state(el, "abs-submit")).toEqual(blocked);

    await type(el, "abs-from", "2026-06-01");
    expect(fieldError(el, "abs-from")).toBe("");
    expect(fieldError(el, "abs-to")).toBe(t("myschedule.absence_to_required"));
    expect(await state(el, "abs-submit")).toEqual(blocked);
    await type(el, "abs-to", "2026-06-03");
    expect(fieldError(el, "abs-to")).toBe("");
    expect(actions(el, "request-absence").error).toBe("");
    expect(await state(el, "abs-submit")).toEqual(ready);
    await press(el, "abs-submit");
    expect(api.requestAbsence).toHaveBeenCalledExactlyOnceWith({
      kind: "sick_leave",
      startsOn: "2026-06-01",
      endsOn: "2026-06-03",
      note: null,
    });
  });

  it("an absence whose To is before its From is marked at To and not sent; the same day is sent", async () => {
    const { el, api } = await mountLoaded();
    await type(el, "abs-from", "2026-06-05");
    await type(el, "abs-to", "2026-06-01");
    expect(fieldError(el, "abs-to")).toBe("");
    expect(await state(el, "abs-submit")).toEqual(ready);
    await press(el, "abs-submit");
    await settle(el);
    expect(api.requestAbsence).not.toHaveBeenCalled();
    expect(fieldError(el, "abs-from")).toBe("");
    expect(fieldError(el, "abs-to")).toBe(t("myschedule.absence_to_before_from"));
    expect(actions(el, "request-absence").error).toBe(t("form.fix_fields"));
    await vi.waitFor(() => expect(focused(el)).toBe("abs-to"));
    expect(await state(el, "abs-submit")).toEqual(blocked);
    await type(el, "abs-to", "2026-06-05");
    expect(fieldError(el, "abs-to")).toBe("");
    expect(await state(el, "abs-submit")).toEqual(ready);
    await press(el, "abs-submit");
    expect(api.requestAbsence).toHaveBeenCalledExactlyOnceWith({
      kind: "holiday",
      startsOn: "2026-06-05",
      endsOn: "2026-06-05",
      note: null,
    });
  });

  it("a refused cover request says why below its own form, leaves the button working, and the next press clears it", async () => {
    const api = stubApi();
    const retry = deferred<{ swapId: string }>();
    api.requestSwap
      .mockImplementationOnce(() => Promise.reject({ code: "swap.not_permitted" }))
      .mockImplementationOnce(() => retry.promise);
    const { el } = await mountLoaded(api);
    await choose(el, "cover-shift", "s1");
    await choose(el, "cover-colleague", "col1");
    await press(el, "cover-submit");
    await vi.waitFor(() =>
      expect(actions(el, "cover").error).toBe(codeMessage("swap.not_permitted")),
    );
    expect(q(el, "[data-test=notice]")).toBeNull();
    expect(actions(el, "request-absence").error).toBe("");
    expect(fieldError(el, "cover-shift")).toBe("");
    expect(fieldError(el, "cover-colleague")).toBe("");
    expect(await state(el, "cover-submit")).toEqual(ready);
    await press(el, "cover-submit");
    expect(api.requestSwap).toHaveBeenCalledTimes(2);
    expect(actions(el, "cover").error).toBe("");
    retry.resolve({ swapId: "sw9" });
  });

  it("a refused absence request says why below its own form, leaves the button working, and the next press clears it", async () => {
    const api = stubApi();
    const retry = deferred<{ absenceId: string }>();
    api.requestAbsence
      .mockImplementationOnce(() => Promise.reject({ code: "absence.overlaps" }))
      .mockImplementationOnce(() => retry.promise);
    const { el } = await mountLoaded(api);
    await type(el, "abs-from", "2026-06-01");
    await type(el, "abs-to", "2026-06-03");
    await press(el, "abs-submit");
    await vi.waitFor(() =>
      expect(actions(el, "request-absence").error).toBe(codeMessage("absence.overlaps")),
    );
    expect(q(el, "[data-test=notice]")).toBeNull();
    expect(actions(el, "cover").error).toBe("");
    expect(await state(el, "abs-submit")).toEqual(ready);
    await press(el, "abs-submit");
    expect(api.requestAbsence).toHaveBeenCalledTimes(2);
    expect(actions(el, "request-absence").error).toBe("");
    retry.resolve({ absenceId: "ab9" });
  });

  it.each([
    {
      form: "cover" as const,
      field: "fromShiftId",
      marked: "cover-shift",
      other: "cover-colleague",
    },
    { form: "request-absence" as const, field: "startsOn", marked: "abs-from", other: "abs-to" },
  ])(
    "a refusal naming $field goes under $marked, never disables the button, and changing that field clears it",
    async ({ form, field, marked, other }) => {
      const api = stubApi();
      const refusal = { code: "management.request_invalid", params: { field } };
      api.requestSwap.mockImplementationOnce(() => Promise.reject(refusal));
      api.requestAbsence.mockImplementationOnce(() => Promise.reject(refusal));
      const { el } = await mountLoaded(api);
      const submit = form === "cover" ? "cover-submit" : "abs-submit";
      if (form === "cover") {
        await choose(el, "cover-shift", "s1");
        await choose(el, "cover-colleague", "col1");
      } else {
        await type(el, "abs-from", "2026-06-01");
        await type(el, "abs-to", "2026-06-03");
      }
      await press(el, submit);
      await vi.waitFor(() =>
        expect(fieldError(el, marked)).toBe(codeMessage("management.request_invalid")),
      );
      expect(fieldError(el, other)).toBe("");
      expect(actions(el, form).error).toBe(t("form.fix_fields"));
      expect(q(el, "[data-test=notice]")).toBeNull();
      expect(await state(el, submit)).toEqual(ready);
      if (form === "cover") {
        await choose(el, "cover-shift", "");
        await choose(el, "cover-shift", "s1");
      } else await type(el, "abs-from", "2026-06-02");
      expect(fieldError(el, marked)).toBe("");
      expect(actions(el, form).error).toBe("");
    },
  );
});
