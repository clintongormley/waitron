import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { setLocale } from "@waitron/dashboard-kit";
import { applyTokens } from "@waitron/ui";
import { rotaWeek } from "../testing/rota-fixture.js";
import type { RotaWeek } from "../staffing-types.js";
import { OpenSlotsMenu } from "./open-slots-menu.js";

const frames: HTMLElement[] = [];
beforeEach(() => setLocale("en"));
afterEach(() => {
  frames.splice(0).forEach((f) => f.remove());
  setLocale("en");
});
const normal = (s: string) => s.replace(/\s+/g, " ").trim();
async function mount(personId: string, businessDay = "2026-12-04", week: RotaWeek = rotaWeek()) {
  const frame = document.createElement("div");
  frames.push(frame);
  document.body.append(frame);
  applyTokens(frame);
  const el = new OpenSlotsMenu();
  el.week = week;
  el.personId = personId;
  el.businessDay = businessDay;
  frame.append(el);
  await el.updateComplete;
  return { el, root: el.shadowRoot! };
}
/** Friday with one more open slot, in the Restaurant, for a staff role Marc does not hold. */
function withOther(): RotaWeek {
  const read = rotaWeek();
  const friday = read.days[4]!;
  const empty = friday.areas[0]!.match.slots[0]!;
  read.staffRoles.push({
    id: "waiter",
    name: "Waiter",
    colour: "blue",
    position: 2,
    holderIds: [],
  });
  const restaurant = read.areas[1]!.area;
  friday.areas.push({
    area: restaurant,
    match: {
      slots: [
        {
          slot: {
            ...empty.slot,
            key: "floor",
            area: restaurant,
            staffRoleId: "waiter",
            startsAt: "12:00",
            endsAt: "16:00",
            start: 360,
            end: 600,
          },
          status: { kind: "unfilled" },
        },
      ],
      over: [],
    },
  });
  return read;
}

describe("a day's open slots", () => {
  it("heads itself with the day and the person, then their staff roles' slots, then the others", async () => {
    const { root } = await mount("marc", "2026-12-04", withOther());
    expect(normal(root.querySelector("[data-test=open-title]")!.textContent!)).toBe(
      "Fri 4 Dec · Marc",
    );
    expect(root.querySelector("[data-test=open-title]")!.getAttribute("aria-hidden")).toBe("true");
    expect([...root.querySelectorAll("h3")].map((h) => normal(h.textContent!))).toEqual([
      "Open slots in Marc's staff roles",
      "Other open slots this day",
    ]);
    const own = root.querySelector<HTMLElement>("[data-slot=empty]")!;
    expect(normal(own.querySelector("strong")!.textContent!)).toBe(
      "09:00–17:00 · Kitchen · Sous chef",
    );
    expect(own.textContent).not.toContain("outside staff role");
    const other = root.querySelector<HTMLElement>("[data-slot=floor]")!;
    expect(normal(other.textContent!)).toContain("12:00–16:00 · Restaurant · Waiter");
    expect(other.textContent).toContain("outside staff role");
    const sections = [...root.querySelectorAll("section")];
    expect(sections[0]!.contains(own)).toBe(true);
    expect(sections[1]!.contains(other)).toBe(true);
  });
  it.each(["light", "dark"] as const)(
    "marks a slot outside the person's staff roles in the warning colour, as the cards do (%s)",
    async (theme) => {
      const { root } = await mount("marc", "2026-12-04", withOther());
      frames[0]!.setAttribute("data-theme", theme);
      const probe = document.createElement("span");
      probe.style.color = "var(--wt-color-warning)";
      frames[0]!.append(probe);
      const outside = [...root.querySelectorAll("[data-slot=floor] small")].find(
        (s) => normal(s.textContent!) === "outside staff role",
      )!;
      expect(getComputedStyle(outside).color).toBe(getComputedStyle(probe).color);
      expect(getComputedStyle(outside).color).not.toBe(
        getComputedStyle(root.querySelector("[data-slot=floor] strong")!).color,
      );
    },
  );
  it("says what a slot would make of the person's hours when it would take them over their contract, in the danger colour", async () => {
    const { root, el } = await mount("marc", "2026-12-04", withOther());
    const over = root.querySelector<HTMLElement>("[data-slot=empty] [data-test=would-make]")!;
    expect(normal(over.textContent!)).toBe("would make 47 / 40 h");
    const probe = document.createElement("span");
    probe.style.color = "var(--wt-color-danger)";
    frames[0]!.append(probe);
    expect(getComputedStyle(over).color).toBe(getComputedStyle(probe).color);
    expect(root.querySelector("[data-slot=floor] [data-test=would-make]")).not.toBeNull();
    el.personId = "laia";
    await el.updateComplete;
    expect(root.querySelector("[data-test=would-make]")).toBeNull();
    el.personId = "ibra";
    await el.updateComplete;
    expect(root.querySelector("[data-test=would-make]")).toBeNull();
  });
  it("with nothing open that day it says so and still offers another shift", async () => {
    const { root } = await mount("marc", "2026-12-02");
    expect(normal(root.textContent!)).toContain("No open slots this day");
    expect(root.querySelector("h3")).toBeNull();
    expect(root.querySelector("[data-slot]")).toBeNull();
    expect(normal(root.querySelector("[data-test=another-shift]")!.textContent!)).toBe(
      "Another shift…",
    );
  });
  it("a slot sends choose-slot with the slot, and Another shift sends another-shift with the person and day", async () => {
    const { el, root } = await mount("marc");
    const sent: [string, unknown][] = [];
    for (const name of ["choose-slot", "another-shift"])
      document.addEventListener(name, (e) => sent.push([name, (e as CustomEvent).detail]), {
        once: true,
      });
    root.querySelector<HTMLElement>("[data-slot=empty]")!.click();
    root.querySelector<HTMLElement>("[data-test=another-shift]")!.click();
    expect(sent).toEqual([
      ["choose-slot", { slot: el.week.days[4]!.areas[0]!.match.slots[0]!.slot }],
      ["another-shift", { personId: "marc", businessDay: "2026-12-04" }],
    ]);
  });
  it("busy disables every row and Another shift, and sends nothing", async () => {
    const { el, root } = await mount("marc");
    el.busy = true;
    await el.updateComplete;
    const another = root.querySelector<HTMLElementTagNameMap["wt-button"]>(
      "[data-test=another-shift]",
    )!;
    expect(root.querySelector<HTMLButtonElement>("[data-slot=empty]")!.disabled).toBe(true);
    expect(another.disabled).toBe(true);
    let sent = 0;
    el.addEventListener("choose-slot", () => sent++);
    el.addEventListener("another-shift", () => sent++);
    root.querySelector<HTMLElement>("[data-slot=empty]")!.dispatchEvent(new MouseEvent("click"));
    another.dispatchEvent(new MouseEvent("click"));
    expect(sent).toBe(0);
  });
  it("beside a day it has no Cancel; in a sheet it ends with Cancel, which sends close-menu unless busy", async () => {
    const { el, root } = await mount("marc");
    const buttons = () =>
      [...root.querySelectorAll("wt-button")].map((b) => normal(b.textContent!));
    expect(buttons()).toEqual(["Another shift…"]);
    el.sheet = true;
    el.error = "Could not fill the slot. Try again.";
    await el.updateComplete;
    expect(buttons()).toEqual(["Another shift…", "Cancel"]);
    const cancel = root.querySelector<HTMLElementTagNameMap["wt-button"]>("[data-test=cancel]")!;
    expect(root.lastElementChild).toBe(cancel);
    let closes = 0;
    el.addEventListener("close-menu", () => closes++);
    cancel.click();
    expect(closes).toBe(1);
    el.busy = true;
    await el.updateComplete;
    expect(cancel.disabled).toBe(true);
    cancel.dispatchEvent(new MouseEvent("click"));
    expect(closes).toBe(1);
  });
  it("draws nothing until it has a week", async () => {
    const el = new OpenSlotsMenu();
    document.body.append(el);
    frames.push(el);
    await el.updateComplete;
    expect(el.shadowRoot!.childElementCount).toBe(0);
  });
  it("shows a refusal as an alert", async () => {
    const { el, root } = await mount("marc");
    expect(root.querySelector("[role=alert]")).toBeNull();
    el.error = "Could not fill the slot. Try again.";
    await el.updateComplete;
    expect(root.querySelector("[role=alert]")!.textContent).toBe(
      "Could not fill the slot. Try again.",
    );
  });
  it("reads in Spanish", async () => {
    setLocale("es");
    const { root } = await mount("marc", "2026-12-04", withOther());
    expect([...root.querySelectorAll("h3")].map((h) => normal(h.textContent!))).toEqual([
      "Puestos libres en los roles de Marc",
      "Otros puestos libres este día",
    ]);
    expect(normal(root.querySelector("[data-test=would-make]")!.textContent!)).toBe(
      "pasaría a 47 / 40 h",
    );
    expect(normal(root.querySelector("[data-test=another-shift]")!.textContent!)).toBe(
      "Otro turno…",
    );
    const none = await mount("marc", "2026-12-02");
    expect(normal(none.root.textContent!)).toContain("No hay puestos libres este día");
  });
});
