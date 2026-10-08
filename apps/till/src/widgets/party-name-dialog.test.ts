import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanupWidgets, mountWidget } from "./test-helpers.js";
import { setLocale, t } from "../i18n/t.js";
import "./party-name-dialog.js";
import type { PartyNameDetail, TillPartyNameDialog } from "./party-name-dialog.js";

afterEach(cleanupWidgets);
beforeEach(() => setLocale("en"));

async function mountDialog(props: Partial<TillPartyNameDialog> = {}): Promise<TillPartyNameDialog> {
  const { el } = await mountWidget<TillPartyNameDialog>("till-party-name-dialog", {
    tables: "Mesa 4, 5",
    ...props,
  });
  return el;
}

const field = (el: TillPartyNameDialog) => el.shadowRoot!.querySelector("wt-input")!;
const nativeInput = (el: TillPartyNameDialog) =>
  field(el).shadowRoot!.querySelector<HTMLInputElement>("input")!;
const save = (el: TillPartyNameDialog) =>
  el.shadowRoot!.querySelector<HTMLElement & { disabled: boolean }>("[data-name-save]")!;
const bottom = (el: TillPartyNameDialog) => el.shadowRoot!.querySelector("wt-form-actions")!;

async function type(el: TillPartyNameDialog, value: string): Promise<void> {
  const input = nativeInput(el);
  input.value = value;
  input.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
  await el.updateComplete;
}

function captured(el: TillPartyNameDialog) {
  const seen: { named: PartyNameDetail[]; cancelled: number } = { named: [], cancelled: 0 };
  el.addEventListener("party-name-confirm", (event) =>
    seen.named.push((event as CustomEvent<PartyNameDetail>).detail),
  );
  el.addEventListener("party-name-cancel", () => (seen.cancelled += 1));
  return seen;
}

describe("till-party-name-dialog", () => {
  it("names the tables in its heading, and its one optional field partyName, capped at 40", async () => {
    const el = await mountDialog();

    expect(el.shadowRoot!.querySelector("wt-dialog")!.heading).toBe(
      t("table.name_title").replace("{tables}", "Mesa 4, 5"),
    );
    expect(nativeInput(el).name).toBe("partyName");
    expect(nativeInput(el).maxLength).toBe(40);
    expect(field(el).required).toBe(false);
    expect(field(el).error).toBe("");
    expect(bottom(el).error).toBe("");
  });

  it("puts the cursor in the name field when it opens", async () => {
    const el = await mountDialog({ value: "Ana" });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(field(el).shadowRoot!.activeElement).toBe(nativeInput(el));
  });

  it("starts from the party's name, and sends the trimmed name", async () => {
    const el = await mountDialog({ value: "Ana" });
    const seen = captured(el);
    expect(nativeInput(el).value).toBe("Ana");

    await type(el, "  Luis ");
    save(el).click();

    expect(seen.named).toEqual([{ name: "Luis" }]);
  });

  it("sends null for an empty or blank name, which clears it", async () => {
    const el = await mountDialog({ value: "Ana" });
    const seen = captured(el);

    await type(el, "");
    save(el).click();
    await type(el, "Bo");
    save(el).click();
    await type(el, "   ");
    save(el).click();

    expect(seen.named).toEqual([{ name: null }, { name: "Bo" }, { name: null }]);
  });

  it("refuses a 41-character name beside the field without sending it, and works again once fixed", async () => {
    const el = await mountDialog();
    const seen = captured(el);

    await type(el, "x".repeat(41));
    save(el).click();
    await el.updateComplete;

    expect(seen.named).toEqual([]);
    expect(field(el).error).toBe(t("table.name_too_long"));
    expect(bottom(el).error).toBe(t("form.fix_fields"));
    expect(save(el).disabled).toBe(true);
    expect(el.shadowRoot!.querySelector("wt-form-error-summary")).toBeNull();

    await type(el, "x".repeat(40));

    expect(field(el).error).toBe("");
    expect(bottom(el).error).toBe("");
    expect(save(el).disabled).toBe(false);
    save(el).click();
    expect(seen.named).toEqual([{ name: "x".repeat(40) }]);
  });

  it("shows the server's refusal beside the field, keeping Save available, until the field changes", async () => {
    const el = await mountDialog({
      value: "Ana",
      savedValue: "Bea",
      refusal: t("table.name_too_long"),
    });

    expect(field(el).error).toBe(t("table.name_too_long"));
    expect(bottom(el).error).toBe(t("form.fix_fields"));
    expect(save(el).disabled).toBe(false);

    await type(el, "Ana B");

    expect(field(el).error).toBe("");
    expect(bottom(el).error).toBe("");
  });

  it("saves with Enter from the field", async () => {
    const el = await mountDialog();
    const seen = captured(el);
    await type(el, "Ana");

    nativeInput(el).dispatchEvent(
      new KeyboardEvent("keydown", { key: "Enter", bubbles: true, composed: true }),
    );

    expect(seen.named).toEqual([{ name: "Ana" }]);
  });

  it("reports Cancel without a name", async () => {
    const el = await mountDialog();
    const seen = captured(el);

    el.shadowRoot!.querySelector<HTMLElement>("[data-name-cancel]")!.click();

    expect(seen).toEqual({ named: [], cancelled: 1 });
  });
});
