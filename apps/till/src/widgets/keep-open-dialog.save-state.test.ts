import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanupWidgets, mountWidget } from "./test-helpers.js";
import { setLocale } from "../i18n/t.js";
import type { TillKeepOpenDialog } from "./keep-open-dialog.js";
import "./keep-open-dialog.js";
beforeEach(() => setLocale("en"));
afterEach(cleanupWidgets);
describe.each(["period", "zone"] as const)("%s draft", (subject) => {
  async function mount() {
    const { el } = await mountWidget<TillKeepOpenDialog>("till-keep-open-dialog", {
      subject,
      period: {
        id: "lunch",
        name: subject === "zone" ? "Terrace" : "Lunch",
        endsAt: "14:00",
        running: true,
        extendedUntil: null,
        dayEndsAt: "05:00",
        choices: ["14:15", "14:30", "05:00"],
        next: null,
      },
    });
    expect(el.shadowRoot).not.toBeNull();
    return el;
  }
  async function state(el: TillKeepOpenDialog) {
    await el.updateComplete;
    const b = el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-button"]>("[data-submit]")!;
    await b.updateComplete;
    return [b.variant, b.disabled, b.shadowRoot!.querySelector("button")!.disabled];
  }
  async function choose(el: TillKeepOpenDialog, value: string) {
    el.shadowRoot!.querySelector("wt-combobox")!.dispatchEvent(
      new CustomEvent("wt-change", { detail: { value } }),
    );
    await el.updateComplete;
  }
  it("starts quiet and cannot submit until a time is chosen", async () => {
    const el = await mount();
    expect(await state(el)).toEqual(["secondary", true, true]);
    const heard: unknown[] = [];
    el.addEventListener("keep-open-confirm", (e) => heard.push(e));
    el.shadowRoot!.querySelector<HTMLElement>("[data-submit]")!.click();
    expect(heard).toEqual([]);
    await choose(el, "14:30");
    expect(await state(el)).toEqual(["primary", false, false]);
    await choose(el, "");
    expect(await state(el)).toEqual(["secondary", true, true]);
  });
  it("busy retains the chosen action colour and refusal leaves it retryable", async () => {
    const el = await mount();
    await choose(el, "14:30");
    el.busy = true;
    expect(await state(el)).toEqual(["primary", true, true]);
    el.busy = false;
    el.refusal = "period_extension.invalid";
    expect(await state(el)).toEqual(["primary", false, false]);
  });
  it("commit restores the quiet baseline and an unchanged host press cannot resubmit", async () => {
    const el = await mount();
    await choose(el, "14:30");
    el.commit();
    expect(await state(el)).toEqual(["secondary", true, true]);
    const heard: unknown[] = [];
    el.addEventListener("keep-open-confirm", (e) => heard.push(e));
    el.shadowRoot!.querySelector<HTMLElement>("[data-submit]")!.click();
    expect(heard).toEqual([]);
    await choose(el, "14:15");
    expect(await state(el)).toEqual(["primary", false, false]);
    await choose(el, "14:30");
    expect(await state(el)).toEqual(["secondary", true, true]);
  });
});
