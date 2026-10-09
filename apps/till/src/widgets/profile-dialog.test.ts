import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { chooseOption, formMessageOf } from "@waitron/ui/src/test-helpers.js";
import type { WtCombobox } from "@waitron/ui";
import { cleanupWidgets, mountWidget } from "./test-helpers.js";
import { setLocale, t } from "../i18n/t.js";
import { codeMessage } from "../i18n/codes.js";
import "./profile-dialog.js";
import type { TillProfileDialog } from "./profile-dialog.js";

afterEach(cleanupWidgets);
beforeEach(() => setLocale("en"));

const COUNTER = { id: "pr-counter", name: "Counter till" };
const BAR = { id: "pr-bar", name: "Bar till" };

async function mountDialog(props: Partial<TillProfileDialog> = {}): Promise<TillProfileDialog> {
  const { el } = await mountWidget<TillProfileDialog>("till-profile-dialog", {
    open: true,
    profiles: [COUNTER, BAR],
    activeProfileId: COUNTER.id,
    ...props,
  });
  return el;
}

const picker = (el: TillProfileDialog) =>
  el.shadowRoot!.querySelector<WtCombobox>('wt-combobox[name="profileId"]')!;
const button = (el: TillProfileDialog, test: string) =>
  el.shadowRoot!.querySelector<HTMLElement & { disabled: boolean; loading: boolean }>(
    `[data-test=${test}]`,
  )!;
async function bottom(el: TillProfileDialog): Promise<string> {
  const row = el.shadowRoot!.querySelector(
    "wt-form-actions",
  ) as HTMLElementTagNameMap["wt-form-actions"];
  return (await formMessageOf(row))?.textContent?.trim() ?? "";
}

function switches(el: TillProfileDialog): string[] {
  const seen: string[] = [];
  el.addEventListener("profile-switch", (event) =>
    seen.push((event as CustomEvent<{ profileId: string }>).detail.profileId),
  );
  return seen;
}

describe("till-profile-dialog", () => {
  it("offers the approved profiles with the active one chosen, and reports the one switched to", async () => {
    const el = await mountDialog();
    const seen = switches(el);
    expect(picker(el).label).toBe(t("profile.label"));
    expect(picker(el).options.map((o) => [o.value, o.label])).toEqual([
      ["pr-counter", "Counter till"],
      ["pr-bar", "Bar till"],
    ]);
    expect(picker(el).value).toBe("pr-counter");
    await chooseOption(picker(el), "pr-bar");
    await el.updateComplete;
    expect(seen).toEqual([]);
    button(el, "profile-switch").click();
    expect(seen).toEqual(["pr-bar"]);
  });

  it("Cancel closes without switching", async () => {
    const el = await mountDialog();
    const seen = switches(el);
    let closed = 0;
    el.addEventListener("close", () => closed++);
    button(el, "profile-cancel").click();
    expect(closed).toBe(1);
    expect(seen).toEqual([]);
  });

  it.each(["device_profile.not_admitted", "device_profile.not_approved"])(
    "a %s refusal shows under the profile, and choosing another clears it",
    async (code) => {
      const el = await mountDialog();
      await chooseOption(picker(el), "pr-bar");
      el.notice = { code };
      await el.updateComplete;
      expect(picker(el).error).toBe(codeMessage(code));
      expect(await bottom(el)).toBe(t("form.fix_fields"));
      expect(button(el, "profile-switch").disabled).toBe(false);
      await chooseOption(picker(el), "pr-counter");
      await el.updateComplete;
      expect(picker(el).error).toBe("");
    },
  );

  it("a refusal naming no field is said at the bottom", async () => {
    const el = await mountDialog({ notice: { code: "device.payment_in_progress" } });
    expect(picker(el).error).toBe("");
    expect(await bottom(el)).toBe(codeMessage("device.payment_in_progress"));
    expect(codeMessage("device.payment_in_progress")).not.toBe(codeMessage("nope.unknown"));
  });

  it("an order in progress is said at the bottom", async () => {
    const el = await mountDialog({ notice: "order_open" });
    expect(await bottom(el)).toBe(t("profile.order_open"));
  });

  it("an unsaved order change is said at the bottom", async () => {
    const el = await mountDialog({ notice: "draft_unsaved" });
    expect(await bottom(el)).toBe(t("profile.draft_unsaved"));
  });

  it("a refused order change, replaced by the saved order, is said at the bottom", async () => {
    const el = await mountDialog({ notice: "draft_replaced" });
    expect(await bottom(el)).toBe(t("profile.draft_replaced"));
  });

  it("shows the switch as busy while it is out", async () => {
    const el = await mountDialog({ busy: true });
    expect(button(el, "profile-switch").loading).toBe(true);
    expect(button(el, "profile-cancel").disabled).toBe(true);
    expect(el.shadowRoot!.querySelector("wt-dialog")!.dismissible).toBe(false);
  });

  it("draws nothing while closed", async () => {
    const el = await mountDialog({ open: false });
    expect(el.shadowRoot!.querySelector("wt-dialog")).toBeNull();
  });
});
