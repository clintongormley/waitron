import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { userEvent } from "vitest/browser";
import type { WtDialog, WtInput, WtUnsavedChanges } from "@waitron/ui";
import type { PartyAllergyRead } from "@waitron/module";
import type { TillApi } from "../api/client.js";
import type { TillApp } from "../till-app.js";
import { currentLocale, setLocale } from "../i18n/t.js";
import { cleanupWidgets } from "../widgets/test-helpers.js";
import {
  api,
  mountApp,
  flush,
  emit,
  shell,
  floor,
  openTable,
  dialog,
  allergyView,
  resetAllergyFixture,
} from "../../test/allergy-app-fixture.js";

const locale = currentLocale();
beforeEach(() => {
  setLocale("en");
  resetAllergyFixture();
});
afterEach(() => {
  cleanupWidgets();
  setLocale(locale);
});

async function editing(
  overrides: Record<string, unknown> = {},
  activity?: TillApp["sessionActivity"],
) {
  const { el } = await mountApp(overrides, activity);
  const screen = await openTable(el);
  await vi.waitFor(() => expect(screen.allergyView).not.toBeNull());
  emit(screen, "edit-party-allergy");
  await vi.waitFor(() => expect(dialog(el)?.mode).toBe("edit"));
  const form = dialog(el)!;
  await userEvent.click(form.shadowRoot!.querySelector<HTMLElement>("[data-add]")!);
  const field = form.shadowRoot!.querySelector<WtInput>("wt-input")!;
  await field.updateComplete;
  const input = field.shadowRoot!.querySelector("input")!;
  await userEvent.fill(input, "Retained guest");
  await userEvent.click(form.shadowRoot!.querySelector<HTMLInputElement>('[data-code="milk"]')!);
  return { el, screen, form, input };
}
async function choose(el: TillApp, decision: "keep" | "discard") {
  const warning = el.shadowRoot!.querySelector<WtUnsavedChanges>("wt-unsaved-changes")!;
  await vi.waitFor(() => expect(warning.open).toBe(true));
  await warning.updateComplete;
  await userEvent.click(
    warning.shadowRoot!.querySelector<HTMLElement>(`[data-choice="${decision}"]`)!,
  );
}

it.each(["cancel", "escape"])(
  "the host retains the allergy editor through %s and Keep, then Discard closes",
  async (action) => {
    const { el, form, input } = await editing();
    if (action === "escape") await userEvent.keyboard("{Escape}");
    else await userEvent.click(form.shadowRoot!.querySelector<HTMLElement>("[data-cancel]")!);
    await choose(el, "keep");
    expect(dialog(el)).toBe(form);
    expect(input.value).toBe("Retained guest");
    const native = form.shadowRoot!.querySelector<WtDialog>("wt-dialog")!;
    const closed = new Promise<void>((resolve) =>
      native.addEventListener("wt-close", () => resolve(), { once: true }),
    );
    await userEvent.click(form.shadowRoot!.querySelector<HTMLElement>("[data-cancel]")!);
    await choose(el, "discard");
    await closed;
    await vi.waitFor(() => expect(dialog(el)).toBeNull());
    expect(api.savePartyAllergy).not.toHaveBeenCalled();
  },
);

it("navigation asks about the child editor, keeps input, and discards before leaving", async () => {
  const { el, form, input } = await editing();
  emit(shell(el), "screen-select", { screen: "floor" });
  await choose(el, "keep");
  expect(dialog(el)).toBe(form);
  expect(input.value).toBe("Retained guest");
  emit(shell(el), "screen-select", { screen: "floor" });
  await choose(el, "discard");
  await vi.waitFor(() => expect(floor(el)).not.toBeNull());
  expect(dialog(el)).toBeNull();
  expect(api.savePartyAllergy).not.toHaveBeenCalled();
});

it("forced logout invalidates a pending allergy leave answer", async () => {
  const activity = {
    configure: vi.fn(),
    start: vi.fn().mockResolvedValue(undefined),
    stop: vi.fn().mockResolvedValue(undefined),
    noteInteraction: vi.fn(),
    reacquire: vi.fn(),
  };
  const { el, form } = await editing({}, activity as unknown as TillApp["sessionActivity"]);
  emit(shell(el), "screen-select", { screen: "floor" });
  const warning = el.shadowRoot!.querySelector<WtUnsavedChanges>("wt-unsaved-changes")!;
  await vi.waitFor(() => expect(warning.open).toBe(true));
  const stale = form.shadowRoot!.querySelector<HTMLElement>("[data-primary]")!;
  (activity.configure.mock.calls.at(-1)![0] as { onIdle(): void }).onIdle();
  await vi.waitFor(() => expect(dialog(el)).toBeNull());
  stale.click();
  await flush(el);
  expect(api.savePartyAllergy).not.toHaveBeenCalled();
  expect(warning.open).toBe(false);
});

it("an API replacement ignores an old editor write and keeps its old controls inert", async () => {
  let finish!: (view: PartyAllergyRead) => void;
  const save = vi.fn().mockImplementation(
    () =>
      new Promise<PartyAllergyRead>((resolve) => {
        finish = resolve;
      }),
  );
  const { el, form, input } = await editing({ savePartyAllergy: save });
  await userEvent.click(form.shadowRoot!.querySelector<HTMLElement>("[data-primary]")!);
  await vi.waitFor(() => expect(save).toHaveBeenCalledOnce());
  expect(input.disabled).toBe(true);
  const replacement = { ...api, savePartyAllergy: vi.fn() };
  el.api = replacement as unknown as TillApi;
  await flush(el);
  finish({
    ...allergyView("allergies"),
    snapshot: { ...allergyView("allergies").snapshot, revision: 20 },
  });
  await vi.waitFor(() => expect(dialog(el)).toBeNull());
  expect(el.shadowRoot!.textContent).not.toContain("Retained guest");
  expect(replacement.savePartyAllergy).not.toHaveBeenCalled();
});

it("an unanswered editor save reaches the request limit and leaves the input available for retry", async () => {
  const save = vi.fn().mockImplementation(() => new Promise<PartyAllergyRead>(() => {}));
  const { el, form, input } = await editing({ savePartyAllergy: save });
  const { TABLE_REQUEST_LIMIT_MS } = await import("../state/draft-sync.js");
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  try {
    form.shadowRoot!.querySelector<HTMLElement>("[data-primary]")!.click();
    await form.updateComplete;
    await vi.advanceTimersByTimeAsync(TABLE_REQUEST_LIMIT_MS);
    await el.updateComplete;
    await form.updateComplete;
    expect(form.busy).toBe(false);
    expect(form.refusal).not.toBe("");
    expect(input.value).toBe("Retained guest");
    expect(dialog(el)).toBe(form);
  } finally {
    vi.useRealTimers();
  }
});
