import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { LitElement, html } from "lit";
import { page, userEvent } from "vitest/browser";
import { LeaveController } from "@waitron/ui";
import { cleanupWidgets, mountWidget, expectNoA11yViolations } from "../widgets/test-helpers.js";
import { setLocale, t } from "../i18n/t.js";
import type { MyShift, TillApi } from "../api/client.js";
import "./till-schedule-screen.js";

class ScheduleLeaveApp extends LitElement {
  readonly leave = new LeaveController(this);
  api!: TillApi;
  backs = 0;
  override render() {
    return html`<till-schedule-screen
        .api=${this.api}
        .staff=${[
          { personId: "me", displayName: "Me" },
          { personId: "colleague", displayName: "Colleague" },
        ]}
        operatorPersonId="me"
        @back-to-counter=${() => this.backs++}
      ></till-schedule-screen
      >${this.leave.render({ heading: t("unsaved.heading"), message: t("unsaved.message"), keepLabel: t("unsaved.keep"), discardLabel: t("unsaved.discard") })}`;
  }
}
customElements.define("till-schedule-leave-test-app", ScheduleLeaveApp);
beforeEach(() => setLocale("en"));
afterEach(cleanupWidgets);
const shift: MyShift = {
  id: "shift-1",
  locationId: "location-1",
  startsAt: "2026-10-10T09:00:00Z",
  startsOffsetMinutes: 0,
  endsAt: "2026-10-10T17:00:00Z",
  endsOffsetMinutes: 0,
  role: "bar",
  rosterVersionId: null,
};
async function mount(overrides: Record<string, unknown> = {}, theme?: "light" | "dark") {
  const api = {
    listMyShifts: async () => [shift],
    listMySwaps: async () => [],
    listMyAbsences: async () => [],
    requestSwap: vi.fn(async () => ({ swapId: "swap-1" })),
    requestAbsence: vi.fn(async () => ({ absenceId: "absence-1" })),
    acceptSwap: vi.fn(async () => {}),
    ...overrides,
  } as unknown as TillApi;
  const { el: app } = await mountWidget<ScheduleLeaveApp>(
    "till-schedule-leave-test-app",
    { api },
    theme,
  );
  const screen = app.shadowRoot!.querySelector("till-schedule-screen")!;
  await expect.poll(() => screen.shadowRoot?.querySelector(".shift")).toBeTruthy();
  return { app, screen, api };
}
type Screen = HTMLElementTagNameMap["till-schedule-screen"];
const fields: Record<string, string> = {
  "cover-shift": '[name="cover-shift"]',
  "cover-colleague": '[name="cover-colleague"]',
  "abs-kind": '[name="abs-kind"]',
  "abs-from": ".abs-from",
  "abs-to": ".abs-to",
  "abs-note": ".abs-note",
};
function field(screen: Screen, name: string) {
  return screen.shadowRoot!.querySelector<HTMLElement & { value: string }>(fields[name]!)!;
}
async function change(screen: Screen, name: string, value: string) {
  field(screen, name).dispatchEvent(
    new CustomEvent("wt-change", { detail: { value }, bubbles: true, composed: true }),
  );
  await screen.updateComplete;
}
function click(screen: Screen, selector: string) {
  screen.shadowRoot!.querySelector<HTMLElement>(selector)!.click();
}
function unload() {
  const event = new Event("beforeunload", { cancelable: true });
  window.dispatchEvent(event);
  return event.defaultPrevented;
}
async function question(app: ScheduleLeaveApp) {
  await app.updateComplete;
  const q = app.shadowRoot!.querySelector("wt-unsaved-changes")!;
  await q.updateComplete;
  return q;
}
async function choose(app: ScheduleLeaveApp, choice: "keep" | "discard") {
  const q = await question(app);
  expect(q.open).toBe(true);
  q.shadowRoot!.querySelector<HTMLElement>(`[data-choice=${choice}]`)!.click();
  await expect.poll(() => q.open).toBe(false);
}
async function cover(screen: Screen) {
  await change(screen, "cover-shift", "shift-1");
  await change(screen, "cover-colleague", "colleague");
}
async function absence(screen: Screen) {
  await change(screen, "abs-from", "2026-10-10");
  await change(screen, "abs-to", "2026-10-12");
  await change(screen, "abs-note", "Family visit");
}
for (const [name, next, original] of [
  ["cover-shift", "shift-1", ""],
  ["cover-colleague", "colleague", ""],
  ["abs-kind", "sick_leave", "holiday"],
  ["abs-from", "2026-10-10", ""],
  ["abs-to", "2026-10-12", ""],
  ["abs-note", " ", ""],
]) {
  it(`protects ${name} immediately and removes unload protection on revert`, async () => {
    const { screen } = await mount();
    expect(unload()).toBe(false);
    field(screen, name!).dispatchEvent(
      new CustomEvent("wt-change", { detail: { value: next }, bubbles: true, composed: true }),
    );
    expect(unload()).toBe(true);
    await change(screen, name!, original!);
    expect(unload()).toBe(false);
  });
}
it("Back keeps both requests, then discards their local values before leaving once", async () => {
  const { app, screen, api } = await mount();
  await cover(screen);
  await absence(screen);
  click(screen, ".back");
  expect(app.backs).toBe(0);
  await choose(app, "keep");
  expect(field(screen, "cover-shift").value).toBe("shift-1");
  expect(field(screen, "abs-note").value).toBe("Family visit");
  click(screen, ".back");
  await choose(app, "discard");
  await expect.poll(() => app.backs).toBe(1);
  for (const name of ["cover-shift", "cover-colleague", "abs-from", "abs-to", "abs-note"])
    expect(field(screen, name).value).toBe("");
  expect(unload()).toBe(false);
  expect(api.requestSwap).not.toHaveBeenCalled();
  expect(api.requestAbsence).not.toHaveBeenCalled();
});
it("clean Back stays direct", async () => {
  const { app, screen } = await mount();
  click(screen, ".back");
  await expect.poll(() => app.backs).toBe(1);
  expect((await question(app)).open).toBe(false);
});
for (const saved of ["cover", "absence"]) {
  it(`successful ${saved} submission commits only that request before a failed refresh`, async () => {
    const listMyShifts = vi
      .fn()
      .mockResolvedValueOnce([shift])
      .mockRejectedValue(new Error("offline"));
    const { app, screen, api } = await mount({ listMyShifts });
    await cover(screen);
    await absence(screen);
    click(screen, saved === "cover" ? ".cover-submit" : ".abs-submit");
    await expect.poll(() => listMyShifts.mock.calls.length).toBe(2);
    await screen.updateComplete;
    expect(saved === "cover" ? api.requestSwap : api.requestAbsence).toHaveBeenCalledWith(
      saved === "cover"
        ? { fromShiftId: "shift-1", toPersonId: "colleague", toShiftId: null }
        : { kind: "holiday", startsOn: "2026-10-10", endsOn: "2026-10-12", note: "Family visit" },
    );
    expect(field(screen, saved === "cover" ? "cover-shift" : "abs-note").value).toBe("");
    expect(unload()).toBe(true);
    click(screen, ".back");
    await choose(app, "discard");
    await expect.poll(() => app.backs).toBe(1);
    expect(field(screen, saved === "cover" ? "cover-shift" : "abs-note").value).toBe("");
    expect(unload()).toBe(false);
  });
  it(`successful ${saved} does not overwrite later delivered input`, async () => {
    let resolve!: (value: unknown) => void;
    const pending = new Promise((r) => {
      resolve = r;
    });
    const { app, screen, api } = await mount({
      [saved === "cover" ? "requestSwap" : "requestAbsence"]: vi.fn(() => pending),
    });
    if (saved === "cover") await cover(screen);
    else await absence(screen);
    click(screen, saved === "cover" ? ".cover-submit" : ".abs-submit");
    await change(
      screen,
      saved === "cover" ? "cover-colleague" : "abs-note",
      saved === "cover" ? "" : "Later note",
    );
    resolve(saved === "cover" ? { swapId: "new" } : { absenceId: "new" });
    await expect
      .poll(() => screen.shadowRoot!.querySelector(".abs-submit")!.hasAttribute("disabled"))
      .toBe(saved === "cover");
    expect(field(screen, saved === "cover" ? "cover-colleague" : "abs-note").value).toBe(
      saved === "cover" ? "" : "Later note",
    );
    expect(unload()).toBe(true);
    const request = app.leave.coordinator.request({
      scopes: "all",
      reason: "navigation",
      proceed() {},
    });
    await choose(app, "discard");
    expect(await request).toBe("proceeded");
    await screen.updateComplete;
    expect(field(screen, saved === "cover" ? "cover-colleague" : "abs-note").value).toBe(
      saved === "cover" ? "colleague" : "Family visit",
    );
    expect(saved === "cover" ? api.requestSwap : api.requestAbsence).toHaveBeenCalledOnce();
    expect(unload()).toBe(false);
  });
  it(`refused ${saved} remains unsaved`, async () => {
    const { app, screen } = await mount({
      [saved === "cover" ? "requestSwap" : "requestAbsence"]: async () => {
        throw { code: "absence.overlaps" };
      },
    });
    if (saved === "cover") await cover(screen);
    else await absence(screen);
    click(screen, saved === "cover" ? ".cover-submit" : ".abs-submit");
    await expect.poll(() => screen.shadowRoot!.querySelector('[role="alert"]')).toBeTruthy();
    expect(unload()).toBe(true);
    click(screen, ".back");
    await choose(app, "keep");
    expect(field(screen, saved === "cover" ? "cover-shift" : "abs-note").value).toBe(
      saved === "cover" ? "shift-1" : "Family visit",
    );
  });
}
it("disconnect aborts a question and clears the departed request inputs", async () => {
  const { app, screen } = await mount();
  await absence(screen);
  click(screen, ".back");
  const q = await question(app);
  expect(q.open).toBe(true);
  const staleDiscard = q.shadowRoot!.querySelector<HTMLElement>("[data-choice=discard]")!;
  screen.remove();
  await expect.poll(() => q.open).toBe(false);
  expect(unload()).toBe(false);
  staleDiscard.click();
  expect(app.backs).toBe(0);
  app.shadowRoot!.appendChild(screen);
  await screen.updateComplete;
  expect(field(screen, "abs-note").value).toBe("");
  expect(unload()).toBe(false);
});
it("a departed submission cannot clear or reload a reconnected draft", async () => {
  let resolve!: (value: unknown) => void;
  const request = new Promise((r) => {
    resolve = r;
  });
  const listMyShifts = vi.fn(async () => [shift]);
  const { app, screen } = await mount({ requestAbsence: () => request, listMyShifts });
  await absence(screen);
  click(screen, ".abs-submit");
  screen.remove();
  app.shadowRoot!.appendChild(screen);
  await screen.updateComplete;
  await change(screen, "abs-note", "New visit");
  await expect.poll(() => listMyShifts.mock.calls.length).toBe(2);
  resolve({ absenceId: "old" });
  await new Promise((r) => setTimeout(r, 0));
  await screen.updateComplete;
  expect(field(screen, "abs-note").value).toBe("New visit");
  expect(listMyShifts).toHaveBeenCalledTimes(2);
  expect(unload()).toBe(true);
  const discarded = app.leave.coordinator.request({
    scopes: [screen],
    reason: "navigation",
    proceed() {},
  });
  await choose(app, "discard");
  expect(await discarded).toBe("proceeded");
  await screen.updateComplete;
  expect(field(screen, "abs-note").value).toBe("");
  expect(field(screen, "abs-from").value).toBe("");
});
it("a lone successful time-off request becomes clean without resetting the chosen kind", async () => {
  const { app, screen, api } = await mount();
  await change(screen, "abs-kind", "leave");
  await absence(screen);
  click(screen, ".abs-submit");
  await expect.poll(() => field(screen, "abs-note").value).toBe("");
  expect(field(screen, "abs-kind").value).toBe("leave");
  expect(unload()).toBe(false);
  expect(api.requestAbsence).toHaveBeenCalledExactlyOnceWith({
    kind: "leave",
    startsOn: "2026-10-10",
    endsOn: "2026-10-12",
    note: "Family visit",
  });
  click(screen, ".back");
  await expect.poll(() => app.backs).toBe(1);
  expect((await question(app)).open).toBe(false);
});
it("a lone successful cover request becomes clean", async () => {
  const { app, screen } = await mount();
  await cover(screen);
  click(screen, ".cover-submit");
  await expect.poll(() => field(screen, "cover-shift").value).toBe("");
  expect(field(screen, "cover-colleague").value).toBe("");
  expect(unload()).toBe(false);
  click(screen, ".back");
  await expect.poll(() => app.backs).toBe(1);
  expect((await question(app)).open).toBe(false);
});
it("Back during a pending submission cannot leave or ask; completion leaves the accepted request clean", async () => {
  let resolve!: (value: unknown) => void;
  const pending = new Promise((r) => {
    resolve = r;
  });
  const { app, screen } = await mount({ requestAbsence: () => pending });
  await absence(screen);
  click(screen, ".abs-submit");
  click(screen, ".back");
  expect(app.backs).toBe(0);
  expect((await question(app)).open).toBe(false);
  expect(unload()).toBe(true);
  resolve({ absenceId: "accepted" });
  await expect.poll(() => field(screen, "abs-note").value).toBe("");
  await screen.updateComplete;
  click(screen, ".back");
  await expect.poll(() => app.backs).toBe(1);
  expect(unload()).toBe(false);
});
it("departed schedule controls cannot request a write, leave or edit a reconnected visit", async () => {
  const { app, screen, api } = await mount();
  await absence(screen);
  const note = field(screen, "abs-note");
  const button = screen.shadowRoot!.querySelector<HTMLElement>(".abs-submit")!;
  const back = screen.shadowRoot!.querySelector<HTMLElement>(".back")!;
  screen.remove();
  note.dispatchEvent(
    new CustomEvent("wt-change", { detail: { value: "Detached" }, bubbles: true, composed: true }),
  );
  button.click();
  back.click();
  expect(api.requestAbsence).not.toHaveBeenCalled();
  expect(app.backs).toBe(0);
  app.shadowRoot!.appendChild(screen);
  await screen.updateComplete;
  expect(field(screen, "abs-note").value).toBe("");
  expect(unload()).toBe(false);
});
it("an old list read cannot clear a new visit's cover choice", async () => {
  let resolve!: (value: MyShift[]) => void;
  const oldRead = new Promise<MyShift[]>((r) => {
    resolve = r;
  });
  const listMyShifts = vi
    .fn()
    .mockResolvedValueOnce([shift])
    .mockReturnValueOnce(oldRead)
    .mockResolvedValueOnce([shift]);
  const { app, screen } = await mount({ listMyShifts });
  await absence(screen);
  click(screen, ".abs-submit");
  await expect.poll(() => listMyShifts.mock.calls.length).toBe(2);
  screen.remove();
  app.shadowRoot!.appendChild(screen);
  await screen.updateComplete;
  await expect.poll(() => listMyShifts.mock.calls.length).toBe(3);
  await cover(screen);
  resolve([]);
  await new Promise((r) => setTimeout(r, 0));
  await screen.updateComplete;
  expect(field(screen, "cover-shift").value).toBe("shift-1");
  expect(screen.shadowRoot!.querySelectorAll(".shift")).toHaveLength(1);
  expect(unload()).toBe(true);
});
it("identifies each date and reason field to the browser by its purpose", async () => {
  const { screen } = await mount();
  for (const name of ["abs-from", "abs-to", "abs-note"])
    expect(field(screen, name).getAttribute("name")).toBe(name);
});

for (const locale of ["en-GB", "es-ES"])
  for (const theme of ["light", "dark"] as const)
    for (const width of [390, 1280])
      it(`native schedule Back/Keep/Escape/Discard, ${locale}, ${theme}, ${width}`, async () => {
        setLocale(locale);
        await page.viewport(width, 900);
        const { app, screen, api } = await mount({}, theme);
        const input = field(screen, "abs-note");
        await (input as HTMLElementTagNameMap["wt-input"]).updateComplete;
        const native = input.shadowRoot!.querySelector("input")!;
        await userEvent.fill(native, "Family visit");
        const back = screen
          .shadowRoot!.querySelector("wt-button.back")!
          .shadowRoot!.querySelector("button")!;
        await userEvent.click(back);
        const q = await question(app);
        expect(q.open).toBe(true);
        const keep = q
          .shadowRoot!.querySelector("[data-choice=keep]")!
          .shadowRoot!.querySelector("button")!;
        await expect.poll(() => keep.matches(":focus")).toBe(true);
        await expectNoA11yViolations(q);
        await page.screenshot({
          path: `__screenshots__/w69-till-pages-look/schedule-${locale}-${theme}-${width}-warning.png`,
        });
        await userEvent.keyboard("{Escape}");
        await expect.poll(() => q.open).toBe(false);
        expect(native.value).toBe("Family visit");
        expect(app.backs).toBe(0);
        await expect.poll(() => back.matches(":focus")).toBe(true);
        await page.screenshot({
          path: `__screenshots__/w69-till-pages-look/schedule-${locale}-${theme}-${width}-kept.png`,
        });
        await userEvent.click(back);
        await choose(app, "keep");
        expect(native.value).toBe("Family visit");
        await userEvent.click(back);
        await choose(app, "discard");
        await expect.poll(() => app.backs).toBe(1);
        expect(native.value).toBe("");
        expect(unload()).toBe(false);
        expect(api.requestAbsence).not.toHaveBeenCalled();
        await page.viewport(1280, 900);
      });
it("accepting an offered swap does not cancel an unrelated time-off leave question", async () => {
  let resolve!: () => void;
  const acceptance = new Promise<void>((r) => {
    resolve = r;
  });
  const listMyShifts = vi.fn(async () => [shift]);
  const { app, screen } = await mount({
    listMyShifts,
    acceptSwap: () => acceptance,
    listMySwaps: async () => [
      {
        id: "offered",
        requestedByPersonId: "colleague",
        fromShiftId: "their-shift",
        toPersonId: "me",
        toShiftId: null,
        status: "requested",
        createdAt: "2026-10-01T10:00:00Z",
        direction: "offered_to_me",
      },
    ],
  });
  await absence(screen);
  click(screen, ".accept");
  const pending = app.leave.coordinator.request({
    scopes: [screen],
    reason: "navigation",
    proceed() {},
  });
  const q = await question(app);
  expect(q.open).toBe(true);
  resolve();
  await expect.poll(() => listMyShifts.mock.calls.length).toBe(2);
  await screen.updateComplete;
  await app.updateComplete;
  expect(q.open).toBe(true);
  expect(field(screen, "abs-note").value).toBe("Family visit");
  await choose(app, "keep");
  expect(await pending).toBe("kept");
  expect(unload()).toBe(true);
});
