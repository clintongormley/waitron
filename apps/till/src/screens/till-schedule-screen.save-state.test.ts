import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import { chooseOption } from "@waitron/ui/src/test-helpers.js";
import { cleanupWidgets, mountWidget } from "../widgets/test-helpers.js";
import { setLocale, t } from "../i18n/t.js";
import { codeMessage } from "../i18n/codes.js";
import type { MyShift, StaffMember, TillApi } from "../api/client.js";
import "./till-schedule-screen.js";
import type { TillScheduleScreen } from "./till-schedule-screen.js";

afterEach(cleanupWidgets);
beforeEach(() => setLocale("en"));

const staff: StaffMember[] = [
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
    listMyShifts: vi.fn(async () => [shift]),
    listMySwaps: vi.fn(async () => []),
    listMyAbsences: vi.fn(async () => []),
    acceptSwap: vi.fn(async () => {}),
    requestSwap: vi.fn(async () => ({ swapId: "sw9" })),
    requestAbsence: vi.fn(async () => ({ absenceId: "ab9" })),
  };
}

async function mountLoaded(api = stubApi()) {
  const { el } = await mountWidget<TillScheduleScreen>("till-schedule-screen", {
    api: api as unknown as TillApi,
    staff,
    operatorPersonId: "me",
  });
  await vi.waitFor(() => expect(q(el, "[data-shift=s1]")).not.toBeNull());
  await el.updateComplete;
  return { el, api };
}

const q = <T extends HTMLElement = HTMLElement>(el: TillScheduleScreen, selector: string) =>
  el.shadowRoot!.querySelector<T>(selector);

type Action = "cover-submit" | "abs-submit";
function action(el: TillScheduleScreen, which: Action) {
  return q<HTMLElementTagNameMap["wt-button"]>(el, `.${which}`)!;
}
/** What the action looks like and whether a person can press it: the host's state and its inner button's. */
async function state(el: TillScheduleScreen, which: Action) {
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
async function press(el: TillScheduleScreen, which: Action) {
  await userEvent.click(
    page.elementLocator(action(el, which).shadowRoot!.querySelector("button")!),
    { force: true },
  );
  await el.updateComplete;
}
async function choose(el: TillScheduleScreen, name: string, value: string) {
  await chooseOption(q(el, `wt-combobox[name=${name}]`)!, value);
  await el.updateComplete;
}
async function type(el: TillScheduleScreen, name: string, value: string) {
  const field = q<HTMLElementTagNameMap["wt-input"]>(el, `wt-input[name=${name}]`)!;
  await field.updateComplete;
  await userEvent.fill(page.elementLocator(field.shadowRoot!.querySelector("input")!), value);
  await el.updateComplete;
}
async function settle(el: TillScheduleScreen) {
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

  it("a filled form that matches the request just sent is quiet, and its handler sends nothing", async () => {
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
    // the handler itself sends nothing for an unchanged form whose fields are both filled.
    action(el, "cover-submit").click();
    await settle(el);
    expect(api.requestSwap).toHaveBeenCalledTimes(1);
  });
});

describe("the cover request while one is out", () => {
  it("a second press sends nothing more", async () => {
    const api = stubApi();
    const reply = deferred<{ swapId: string }>();
    api.requestSwap.mockImplementationOnce(() => reply.promise);
    const { el } = await mountLoaded(api);
    await choose(el, "cover-shift", "s1");
    await choose(el, "cover-colleague", "col1");
    await press(el, "cover-submit");
    action(el, "cover-submit").click();
    await settle(el);
    expect(api.requestSwap).toHaveBeenCalledTimes(1);
    reply.resolve({ swapId: "sw9" });
  });

  it("an answer arriving after the screen was closed and reopened leaves the reopened form alone", async () => {
    const api = stubApi();
    const reply = deferred<{ swapId: string }>();
    api.requestSwap.mockImplementationOnce(() => reply.promise);
    const { el } = await mountLoaded(api);
    await choose(el, "cover-shift", "s1");
    await choose(el, "cover-colleague", "col1");
    await press(el, "cover-submit");
    const host = el.parentElement!;
    el.remove();
    host.appendChild(el);
    await vi.waitFor(() => expect(q(el, "[data-shift=s1]")).not.toBeNull());
    await choose(el, "cover-shift", "s1");
    await choose(el, "cover-colleague", "col1");
    reply.resolve({ swapId: "sw9" });
    await settle(el);
    expect(q<HTMLElement & { value: string }>(el, "[name=cover-shift]")!.value).toBe("s1");
    expect(q<HTMLElement & { value: string }>(el, "[name=cover-colleague]")!.value).toBe("col1");
    expect(await state(el, "cover-submit")).toEqual(ready);
    expect(api.listMyShifts).toHaveBeenCalledTimes(2);
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

  it("a filled form that matches the request just sent is quiet, and its handler sends nothing", async () => {
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
  const actions = (el: TillScheduleScreen, form: Form) =>
    q<HTMLElementTagNameMap["wt-form-actions"]>(el, `.${form} wt-form-actions`)!;
  const fieldError = (el: TillScheduleScreen, name: string) =>
    q<HTMLElement & { error: string }>(el, `[name=${name}]`)!.error;
  const focused = (el: TillScheduleScreen) => el.shadowRoot!.activeElement?.getAttribute("name");

  it("marks the required fields", async () => {
    const { el } = await mountLoaded();
    const required = (name: string) =>
      q<HTMLElement & { required: boolean }>(el, `[name=${name}]`)!.required;
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
    expect(fieldError(el, "cover-shift")).toBe(t("schedule.cover_shift_required"));
    expect(fieldError(el, "cover-colleague")).toBe("");
    expect(actions(el, "cover").error).toBe(t("form.fix_fields"));
    expect(actions(el, "request-absence").error).toBe("");
    expect(q(el, ".notice")).toBeNull();
    await vi.waitFor(() => expect(focused(el)).toBe("cover-shift"));
    expect(q<HTMLElement & { value: string }>(el, "[name=cover-colleague]")!.value).toBe("col1");
    expect(await state(el, "cover-submit")).toEqual(blocked);

    await choose(el, "cover-colleague", "");
    await choose(el, "cover-colleague", "col1");
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
    expect(fieldError(el, "cover-colleague")).toBe(t("schedule.cover_colleague_required"));
    await vi.waitFor(() => expect(focused(el)).toBe("cover-colleague"));
    await choose(el, "cover-colleague", "col1");
    expect(fieldError(el, "cover-colleague")).toBe("");
    await choose(el, "cover-colleague", "");
    expect(fieldError(el, "cover-colleague")).toBe(t("schedule.cover_colleague_required"));
    expect(actions(el, "cover").error).toBe(t("form.fix_fields"));
    expect(await state(el, "cover-submit")).toEqual(blocked);
  });

  it("an absence press with no dates marks both, focuses From and sends nothing; filling them lets the press send", async () => {
    const { el, api } = await mountLoaded();
    await choose(el, "abs-kind", "sick_leave");
    await press(el, "abs-submit");
    await settle(el);
    expect(api.requestAbsence).not.toHaveBeenCalled();
    expect(fieldError(el, "abs-from")).toBe(t("schedule.absence_from_required"));
    expect(fieldError(el, "abs-to")).toBe(t("schedule.absence_to_required"));
    expect(actions(el, "request-absence").error).toBe(t("form.fix_fields"));
    expect(actions(el, "cover").error).toBe("");
    await vi.waitFor(() => expect(focused(el)).toBe("abs-from"));
    expect(await state(el, "abs-submit")).toEqual(blocked);

    await type(el, "abs-from", "2026-06-01");
    expect(fieldError(el, "abs-from")).toBe("");
    expect(fieldError(el, "abs-to")).toBe(t("schedule.absence_to_required"));
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

  it("an absence whose To is before its From is marked at To and not sent", async () => {
    const { el, api } = await mountLoaded();
    await type(el, "abs-from", "2026-06-05");
    await type(el, "abs-to", "2026-06-01");
    expect(fieldError(el, "abs-to")).toBe("");
    expect(await state(el, "abs-submit")).toEqual(ready);
    await press(el, "abs-submit");
    await settle(el);
    expect(api.requestAbsence).not.toHaveBeenCalled();
    expect(fieldError(el, "abs-from")).toBe("");
    expect(fieldError(el, "abs-to")).toBe(t("schedule.absence_to_before_from"));
    expect(actions(el, "request-absence").error).toBe(t("form.fix_fields"));
    await vi.waitFor(() => expect(focused(el)).toBe("abs-to"));
    expect(await state(el, "abs-submit")).toEqual(blocked);
    await type(el, "abs-to", "2026-06-05");
    expect(fieldError(el, "abs-to")).toBe("");
    expect(await state(el, "abs-submit")).toEqual(ready);
    await press(el, "abs-submit");
    expect(api.requestAbsence).toHaveBeenCalledOnce();
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
    expect(q(el, ".notice")).toBeNull();
    expect(actions(el, "request-absence").error).toBe("");
    expect(fieldError(el, "cover-shift")).toBe("");
    expect(fieldError(el, "cover-colleague")).toBe("");
    expect(await state(el, "cover-submit")).toEqual(ready);
    await press(el, "cover-submit");
    expect(api.requestSwap).toHaveBeenCalledTimes(2);
    expect(actions(el, "cover").error).toBe("");
    retry.resolve({ swapId: "sw9" });
  });

  for (const [width, painted] of [
    [1280, "rgb(1, 2, 3)"],
    [390, "rgb(4, 5, 6)"],
  ] as const)
    it(`each form's button row paints what is behind it at ${width}px: the card, or at phone width the page`, async () => {
      await page.viewport(width, 900);
      try {
        const { el } = await mountLoaded();
        el.style.setProperty("--wt-color-surface", "rgb(1, 2, 3)");
        el.style.setProperty("--wt-color-bg", "rgb(4, 5, 6)");
        el.style.setProperty("--wt-form-actions-surface", "var(--wt-color-bg)");
        for (const form of ["cover", "request-absence"] as const)
          expect(getComputedStyle(actions(el, form)).backgroundColor).toBe(painted);
      } finally {
        await page.viewport(1280, 900);
      }
    });

  it("a refusal and a field cleared after it show together, the refusal first", async () => {
    const api = stubApi();
    api.requestSwap.mockImplementationOnce(() => Promise.reject({ code: "swap.not_permitted" }));
    const { el } = await mountLoaded(api);
    await choose(el, "cover-shift", "s1");
    await choose(el, "cover-colleague", "col1");
    await press(el, "cover-submit");
    await vi.waitFor(() =>
      expect(actions(el, "cover").error).toBe(codeMessage("swap.not_permitted")),
    );
    await choose(el, "cover-colleague", "");
    expect(fieldError(el, "cover-colleague")).toBe(t("schedule.cover_colleague_required"));
    expect(actions(el, "cover").error).toBe(
      `${codeMessage("swap.not_permitted")} ${t("form.fix_fields")}`,
    );
    expect(await state(el, "cover-submit")).toEqual(blocked);
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
    expect(q(el, ".notice")).toBeNull();
    expect(actions(el, "cover").error).toBe("");
    expect(await state(el, "abs-submit")).toEqual(ready);
    await press(el, "abs-submit");
    expect(api.requestAbsence).toHaveBeenCalledTimes(2);
    expect(actions(el, "request-absence").error).toBe("");
    retry.resolve({ absenceId: "ab9" });
  });

  type Change = (el: TillScheduleScreen) => Promise<void>;
  const formFields: Record<Form, string[]> = {
    cover: ["cover-shift", "cover-colleague"],
    "request-absence": ["abs-kind", "abs-from", "abs-to", "abs-note"],
  };
  const refusedFields: {
    form: Form;
    field: string;
    marked: string;
    change: Change;
    unrelated: Change;
  }[] = [
    {
      form: "cover",
      field: "fromShiftId",
      marked: "cover-shift",
      change: async (el) => {
        await choose(el, "cover-shift", "");
        await choose(el, "cover-shift", "s1");
      },
      unrelated: (el) => choose(el, "cover-colleague", "col2"),
    },
    {
      form: "cover",
      field: "toPersonId",
      marked: "cover-colleague",
      change: (el) => choose(el, "cover-colleague", "col2"),
      unrelated: async (el) => {
        await choose(el, "cover-shift", "");
        await choose(el, "cover-shift", "s1");
      },
    },
    {
      form: "request-absence",
      field: "kind",
      marked: "abs-kind",
      change: (el) => choose(el, "abs-kind", "sick_leave"),
      unrelated: (el) => type(el, "abs-note", "dentist"),
    },
    {
      form: "request-absence",
      field: "startsOn",
      marked: "abs-from",
      change: (el) => type(el, "abs-from", "2026-06-02"),
      unrelated: (el) => type(el, "abs-to", "2026-06-04"),
    },
    {
      form: "request-absence",
      field: "endsOn",
      marked: "abs-to",
      change: (el) => type(el, "abs-to", "2026-06-04"),
      unrelated: (el) => type(el, "abs-from", "2026-06-02"),
    },
    {
      form: "request-absence",
      field: "note",
      marked: "abs-note",
      change: (el) => type(el, "abs-note", "dentist"),
      unrelated: (el) => choose(el, "abs-kind", "sick_leave"),
    },
  ];
  it.each(refusedFields)(
    "a refusal naming $field goes under $marked, never disables the button, survives a change to another field, and changing its own field clears it",
    async ({ form, field, marked, change, unrelated }) => {
      const api = stubApi();
      const refusal = { code: "management.request_invalid", field, status: 400 };
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
      for (const other of formFields[form].filter((name) => name !== marked))
        expect(fieldError(el, other)).toBe("");
      expect(actions(el, form).error).toBe(t("form.fix_fields"));
      expect(q(el, ".notice")).toBeNull();
      expect(await state(el, submit)).toEqual(ready);
      await unrelated(el);
      expect(fieldError(el, marked)).toBe(codeMessage("management.request_invalid"));
      expect(actions(el, form).error).toBe(t("form.fix_fields"));
      await change(el);
      expect(fieldError(el, marked)).toBe("");
      expect(actions(el, form).error).toBe("");
    },
  );

  it("a refusal naming a field the form does not show stays in the bottom message", async () => {
    const api = stubApi();
    api.requestSwap.mockImplementationOnce(() =>
      Promise.reject({ code: "management.request_invalid", field: "toShiftId", status: 400 }),
    );
    const { el } = await mountLoaded(api);
    await choose(el, "cover-shift", "s1");
    await choose(el, "cover-colleague", "col1");
    await press(el, "cover-submit");
    await vi.waitFor(() =>
      expect(actions(el, "cover").error).toBe(codeMessage("management.request_invalid")),
    );
    expect(fieldError(el, "cover-shift")).toBe("");
    expect(fieldError(el, "cover-colleague")).toBe("");
  });
});
