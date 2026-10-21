import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { WtButton, WtDialog, WtFormActions, WtInput, WtSwitch } from "@waitron/ui";
import {
  cleanupWidgets,
  dialogClosed,
  expectMessageAboveButtons,
  mountWidget,
} from "./test-helpers.js";
import { codeMessage } from "../i18n/codes.js";
import { es } from "../i18n/strings.js";
import { setLocale, t } from "../i18n/t.js";
import type { ThemeNameDialog, ThemeNameRequest } from "./theme-name-dialog.js";
import "./theme-name-dialog.js";

beforeEach(() => setLocale("en-GB"));

afterEach(() => {
  cleanupWidgets();
  setLocale("en-GB");
});

type Submit = ThemeNameRequest["submit"];

async function open(
  request: Partial<ThemeNameRequest> & Pick<ThemeNameRequest, "kind">,
  submit: ReturnType<typeof vi.fn<Submit>> = vi.fn<Submit>(async () => {}),
) {
  const { el } = await mountWidget<ThemeNameDialog>("dashboard-theme-name-dialog", {});
  el.show({ name: "", inUse: false, warningLines: [], submit, ...request });
  await el.updateComplete;
  const dialog = el.shadowRoot!.querySelector<WtDialog>("wt-dialog[data-test=name-dialog]")!;
  await expect.poll(() => dialog.open).toBe(true);
  return { el, dialog, submit };
}

const input = (dialog: WtDialog) => dialog.querySelector<WtInput>("wt-input[name=name]")!;
const toggle = (dialog: WtDialog) => dialog.querySelector<WtSwitch>("wt-switch[name=inUse]");
const save = (dialog: WtDialog) =>
  dialog.querySelector<WtButton>("wt-button[data-test=name-save]")!;
const actions = (dialog: WtDialog) => dialog.querySelector<WtFormActions>("wt-form-actions")!;

async function type(el: ThemeNameDialog, dialog: WtDialog, value: string): Promise<void> {
  input(dialog).dispatchEvent(
    new CustomEvent("wt-change", { detail: { value }, bubbles: true, composed: true }),
  );
  await el.updateComplete;
}

async function flip(el: ThemeNameDialog, dialog: WtDialog, checked: boolean): Promise<void> {
  toggle(dialog)!.dispatchEvent(
    new CustomEvent("wt-change", { detail: { checked }, bubbles: true, composed: true }),
  );
  await el.updateComplete;
}

async function press(el: ThemeNameDialog, dialog: WtDialog): Promise<void> {
  save(dialog).click();
  await new Promise((resolve) => setTimeout(resolve, 0));
  await el.updateComplete;
}

const hardToRead = (dialog: WtDialog) => dialog.querySelector("[data-test=name-warnings]");

it("Make a copy opens savable with its proposal and the switch off", async () => {
  const { el, dialog, submit } = await open({ kind: "copy", name: "Christmas" });
  expect(dialog.heading).toBe("Name this theme");
  expect(input(dialog).required).toBe(true);
  expect(input(dialog).label).toBe(t("appearance.name_label"));
  expect(input(dialog).value).toBe("Christmas");
  expect(toggle(dialog)!.checked).toBe(false);
  expect(toggle(dialog)!.label).toBe(t("appearance.name_use_now"));
  expect(save(dialog).variant).toBe("primary");
  expect(save(dialog).disabled).toBe(false);
  expect(dialog.querySelector("[data-test=name-back]")!.textContent!.trim()).toBe(t("action.back"));
  const closed = dialogClosed(dialog);
  await press(el, dialog);
  await closed;
  expect(submit).toHaveBeenCalledTimes(1);
  expect(submit).toHaveBeenCalledWith({ name: "Christmas", inUse: false });
  expect(dialog.open).toBe(false);
});

it("Save as new theme opens savable, its switch as asked", async () => {
  const { el, dialog, submit } = await open({ kind: "save-as-new", name: "Summer", inUse: true });
  expect(toggle(dialog)!.checked).toBe(true);
  expect(save(dialog).disabled).toBe(false);
  await flip(el, dialog, false);
  expect(toggle(dialog)!.checked).toBe(false);
  await press(el, dialog);
  expect(submit).toHaveBeenCalledWith({ name: "Summer", inUse: false });
});

it("Rename opens with the current name, Save quiet until it changes, and no switch", async () => {
  const { el, dialog, submit } = await open({ kind: "rename", name: "Christmas", inUse: true });
  expect(toggle(dialog)).toBeNull();
  expect(input(dialog).value).toBe("Christmas");
  expect(save(dialog).variant).toBe("secondary");
  expect(save(dialog).disabled).toBe(true);
  await press(el, dialog);
  expect(submit).not.toHaveBeenCalled();
  await type(el, dialog, "Holiday");
  expect(save(dialog).variant).toBe("primary");
  expect(save(dialog).disabled).toBe(false);
  await press(el, dialog);
  expect(submit).toHaveBeenCalledWith({ name: "Holiday", inUse: false });
});

it("the first save opens empty, Save disabled until a name is typed", async () => {
  const { el, dialog, submit } = await open({ kind: "first-save", name: "" });
  expect(input(dialog).value).toBe("");
  expect(save(dialog).disabled).toBe(true);
  expect(save(dialog).variant).toBe("secondary");
  await type(el, dialog, "Bar");
  expect(save(dialog).disabled).toBe(false);
  expect(save(dialog).variant).toBe("primary");
  await type(el, dialog, "");
  expect(save(dialog).disabled).toBe(true);
  await press(el, dialog);
  expect(submit).not.toHaveBeenCalled();
});

it("with the switch on, it lists what is hard to read", async () => {
  const line = "Brand colour: buttons are hard to see on dark screens.";
  const { el, dialog } = await open({ kind: "copy", name: "Christmas", warningLines: [line] });
  expect(hardToRead(dialog)).toBeNull();
  expect(dialog.textContent).not.toContain(t("appearance.switch_hard_to_read"));
  expect(dialog.querySelector("li")).toBeNull();
  await flip(el, dialog, true);
  expect(hardToRead(dialog)!.textContent).toContain(t("appearance.switch_hard_to_read"));
  expect([...hardToRead(dialog)!.querySelectorAll("li")].map((li) => li.textContent)).toEqual([
    line,
  ]);
  expect(save(dialog).disabled).toBe(false);
  await flip(el, dialog, false);
  expect(hardToRead(dialog)).toBeNull();
  expect(save(dialog).disabled).toBe(false);

  cleanupWidgets();
  const none = await open({ kind: "copy", name: "Christmas", inUse: true, warningLines: [] });
  expect(toggle(none.dialog)!.checked).toBe(true);
  expect(hardToRead(none.dialog)).toBeNull();
  expect(none.dialog.textContent).not.toContain(t("appearance.switch_hard_to_read"));
  expect(save(none.dialog).disabled).toBe(false);
});

it("the browser's own checks speak after the first Save", async () => {
  const { el, dialog, submit } = await open({ kind: "copy", name: "Christmas" });
  await type(el, dialog, "");
  expect(input(dialog).error).toBe("");
  await press(el, dialog);
  expect(submit).not.toHaveBeenCalled();
  expect(input(dialog).error).toBe(t("appearance.name_required"));
  await expectMessageAboveButtons(dialog, save(dialog), t("form.fix_fields"));
  expect(save(dialog).disabled).toBe(true);
  await expect.poll(() => el.shadowRoot!.activeElement).toBe(input(dialog));
  await type(el, dialog, "a".repeat(61));
  expect(input(dialog).error).toBe(t("appearance.name_too_long"));
  expect(save(dialog).disabled).toBe(true);
  await type(el, dialog, "wAiTrOn");
  expect(input(dialog).error).toBe(t("appearance.name_reserved"));
  expect(save(dialog).disabled).toBe(true);
  await type(el, dialog, "Christmas");
  expect(input(dialog).error).toBe("");
  expect(actions(dialog).error).toBe("");
  expect(save(dialog).disabled).toBe(false);
  expect(submit).not.toHaveBeenCalled();
});

for (const [label, refusal, sentence] of [
  [
    "a taken name",
    { code: "theme.name_taken", params: { field: "name" } },
    "appearance.name_taken",
  ],
  [
    "a too-long name",
    { code: "theme.invalid", params: { field: "name", reason: "too_long" } },
    "appearance.name_too_long",
  ],
] as const) {
  it(`${label} is refused under the field and never disables Save`, async () => {
    const submit = vi.fn<Submit>().mockRejectedValue(refusal);
    const { el, dialog } = await open({ kind: "copy", name: "Christmas" }, submit);
    await press(el, dialog);
    expect(submit).toHaveBeenCalledTimes(1);
    expect(input(dialog).error).toBe(t(sentence));
    await expectMessageAboveButtons(dialog, save(dialog), t("form.fix_fields"));
    expect(save(dialog).disabled).toBe(false);
    expect(dialog.open).toBe(true);
    await type(el, dialog, "Christmas 2");
    expect(input(dialog).error).toBe("");
    expect(actions(dialog).error).toBe("");
  });
}

for (const refusal of [
  { code: "theme.not_found" },
  { code: "authorization.not_permitted" },
  { code: "theme.invalid", params: { field: "brandColor", reason: "too_long" } },
]) {
  it(`any other refusal goes at the bottom: ${refusal.code} ${JSON.stringify(refusal.params ?? {})}`, async () => {
    const submit = vi.fn<Submit>().mockRejectedValue(refusal);
    const { el, dialog } = await open({ kind: "copy", name: "Christmas" }, submit);
    await press(el, dialog);
    expect(actions(dialog).error).toBe(codeMessage(refusal.code));
    expect(actions(dialog).error).not.toBe("");
    expect(input(dialog).error).toBe("");
    expect(save(dialog).disabled).toBe(false);
    expect(dialog.open).toBe(true);
  });
}

it("a double press saves once", async () => {
  const submit = vi.fn<Submit>(() => new Promise<void>(() => {}));
  const { el, dialog } = await open({ kind: "copy", name: "Christmas" }, submit);
  save(dialog).click();
  save(dialog).click();
  await new Promise((resolve) => setTimeout(resolve, 0));
  await el.updateComplete;
  expect(submit).toHaveBeenCalledTimes(1);
});

it("dismiss closes without a request", async () => {
  const { el, dialog, submit } = await open({ kind: "rename", name: "Christmas" });
  await type(el, dialog, "Holiday");
  const closed = dialogClosed(dialog);
  el.dismiss();
  await el.updateComplete;
  await closed;
  expect(dialog.open).toBe(false);
  expect(submit).not.toHaveBeenCalled();
});

it("show is ignored while open", async () => {
  const { el, dialog } = await open({ kind: "copy", name: "Christmas" });
  el.show({
    kind: "rename",
    name: "Other",
    inUse: false,
    warningLines: [],
    submit: async () => {},
  });
  await el.updateComplete;
  expect(input(dialog).value).toBe("Christmas");
  expect(toggle(dialog)).not.toBeNull();
});

for (const outcome of ["resolves", "rejects"] as const) {
  it(`an answer after dismiss changes nothing: the request ${outcome}`, async () => {
    let settle!: { resolve: () => void; reject: (reason: unknown) => void };
    const submit = vi.fn<Submit>(
      () =>
        new Promise<void>((resolve, reject) => {
          settle = { resolve, reject };
        }),
    );
    const { el, dialog } = await open({ kind: "copy", name: "Christmas" }, submit);
    save(dialog).click();
    await el.updateComplete;
    expect(submit).toHaveBeenCalledTimes(1);
    const closed = dialogClosed(dialog);
    el.dismiss();
    await el.updateComplete;
    await closed;
    if (outcome === "resolves") settle.resolve();
    else settle.reject({ code: "theme.name_taken", params: { field: "name" } });
    await new Promise((resolve) => setTimeout(resolve, 0));
    await el.updateComplete;
    expect(dialog.open).toBe(false);
    expect(input(dialog)).toBeNull();
    expect(actions(dialog).error).toBe("");
  });
}

it("a late success from an earlier opening leaves a reopened dialog open", async () => {
  let settle!: () => void;
  const first = vi.fn<Submit>(
    () =>
      new Promise<void>((resolve) => {
        settle = resolve;
      }),
  );
  const { el, dialog } = await open({ kind: "copy", name: "Christmas" }, first);
  save(dialog).click();
  await el.updateComplete;
  expect(first).toHaveBeenCalledTimes(1);
  const closed = dialogClosed(dialog);
  el.dismiss();
  await el.updateComplete;
  await closed;
  el.show({ kind: "rename", name: "Summer", inUse: false, warningLines: [], submit: vi.fn() });
  await el.updateComplete;
  await expect.poll(() => dialog.open).toBe(true);
  await type(el, dialog, "Holiday");
  settle();
  await new Promise((resolve) => setTimeout(resolve, 50));
  await el.updateComplete;
  expect(dialog.open).toBe(true);
  expect(input(dialog).value).toBe("Holiday");
  expect(save(dialog).disabled).toBe(false);
});

it("Spanish", async () => {
  setLocale("es-ES");
  const { el, dialog } = await open({ kind: "copy", name: "Christmas" });
  expect(dialog.heading).toBe(es["appearance.name_heading"]);
  expect(input(dialog).label).toBe(es["appearance.name_label"]);
  expect(toggle(dialog)!.label).toBe(es["appearance.name_use_now"]);
  expect(dialog.querySelector("[data-test=name-back]")!.textContent!.trim()).toBe(t("action.back"));
  await type(el, dialog, "Waitron");
  await press(el, dialog);
  expect(input(dialog).error).toBe(es["appearance.name_reserved"]);
});
