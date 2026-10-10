import { afterEach, expect, test, vi } from "vitest";
import { userEvent } from "vitest/browser";
import type { DeleteImpact } from "@waitron/shared";
import { cleanup, formMessageOf, host, mount, mountInShadowRoot } from "../test-helpers.js";
import * as ui from "../index.js";
import type { DeleteDialogCopy, WtDeleteDialog } from "../index.js";
import type { WtButton } from "./wt-button.js";
import type { WtFormActions } from "./wt-form-actions.js";
import type { WtModal } from "./wt-modal.js";

afterEach(cleanup);

const SCRIPT_NAME = "<script>window.__deleteDialogRan = true</script>";
const LONG_NAME = "Terrace".repeat(30);

const copy: DeleteDialogCopy = {
  heading: "Delete printer?",
  refusals: "Why it can't be deleted",
  ends: "Work that will end",
  removes: "Settings that will be removed",
  irreversible: "This can't be undone.",
  cancel: "Cancel",
  confirm: "Delete",
  retry: "Try again",
  loading: "Checking what this affects",
  item: (item) => `${item.key} ${item.count}: ${item.targets.map((t) => t.name).join(", ")}`,
  refusal: (refusal) => `${refusal.code}: ${refusal.targets.map((t) => t.name).join(", ")}`,
};

/** A generic fixture for the dialog: no printer rule refuses a delete. */
function refusedImpact(): DeleteImpact {
  return {
    target: { id: "printer-p", name: "Printer P" },
    refusals: [
      {
        code: "reader.payment_in_progress",
        params: {},
        targets: [{ id: "pay-1", name: "Payment 1" }],
      },
    ],
    ends: [
      { key: "print_jobs", count: 3, targets: [] },
      { key: "portable_holder", count: 1, targets: [{ id: "dev-h", name: SCRIPT_NAME }] },
    ],
    removes: [
      { key: "profile_receipt", count: 1, targets: [{ id: "prof-1", name: "Bar profile" }] },
      { key: "station_printers", count: 1, targets: [{ id: "st-1", name: "Grill" }] },
      { key: "device_receipt", count: 1, targets: [{ id: "dev-1", name: LONG_NAME }] },
    ],
  };
}

function readyImpact(): DeleteImpact {
  return { ...refusedImpact(), refusals: [] };
}

async function openDialog(
  props: Partial<Pick<WtDeleteDialog, "impact" | "loading" | "readError" | "actionError">> = {},
  mounter: (html: string) => Promise<HTMLElement> = mount,
): Promise<WtDeleteDialog> {
  const el = (await mounter("<wt-delete-dialog></wt-delete-dialog>")) as WtDeleteDialog;
  el.copy = copy;
  el.impact = props.impact === undefined ? readyImpact() : props.impact;
  el.loading = props.loading ?? false;
  el.readError = props.readError ?? "";
  el.actionError = props.actionError ?? "";
  el.open = true;
  await settle(el);
  return el;
}

async function settle(el: WtDeleteDialog): Promise<void> {
  await el.updateComplete;
  const modal = modalOf(el);
  await modal.updateComplete;
  for (const button of el.shadowRoot!.querySelectorAll<WtButton>("wt-button"))
    await button.updateComplete;
}

function modalOf(el: WtDeleteDialog): WtModal {
  return el.shadowRoot!.querySelector<WtModal>("wt-modal")!;
}

function nativeDialog(el: WtDeleteDialog): HTMLDialogElement {
  return modalOf(el).shadowRoot!.querySelector("dialog")!;
}

function button(el: WtDeleteDialog, name: string): WtButton {
  return el.shadowRoot!.querySelector<WtButton>(`[data-test="delete-${name}"]`)!;
}

function inner(el: WtDeleteDialog, name: string): HTMLButtonElement {
  return button(el, name).shadowRoot!.querySelector<HTMLButtonElement>("button")!;
}

function deepActiveElement(): Element | null {
  let focused = document.activeElement;
  while (focused?.shadowRoot?.activeElement) focused = focused.shadowRoot.activeElement;
  return focused;
}

function record(target: EventTarget, type: string): CustomEvent[] {
  const seen: CustomEvent[] = [];
  target.addEventListener(type, (event) => seen.push(event as CustomEvent));
  return seen;
}

test("exports and registers the shared delete confirmation", () => {
  expect(customElements.get("wt-delete-dialog")).toBeTypeOf("function");
  expect(ui.WtDeleteDialog).toBe(customElements.get("wt-delete-dialog"));
});

test("opens no dialog until its copy is set, so it never shows an unnamed one", async () => {
  const el = (await mount("<wt-delete-dialog></wt-delete-dialog>")) as WtDeleteDialog;
  el.impact = readyImpact();
  el.open = true;
  await el.updateComplete;
  expect(el.shadowRoot!.querySelector("wt-modal")).toBeNull();
  el.copy = copy;
  await settle(el);
  expect(nativeDialog(el).open).toBe(true);
  expect(modalOf(el).heading).toBe(copy.heading);
});

test("lists refusals, then work that ends, then settings removed, then the irreversible sentence", async () => {
  const el = await openDialog({ impact: refusedImpact() });
  expect(nativeDialog(el).open).toBe(true);
  expect(nativeDialog(el).matches(":modal")).toBe(true);
  const root = el.shadowRoot!;
  expect([...root.querySelectorAll("h3")].map((h) => h.textContent!.trim())).toEqual([
    copy.refusals,
    copy.ends,
    copy.removes,
  ]);
  const groups = [...root.querySelectorAll("[data-group]")];
  expect(groups.map((g) => g.getAttribute("data-group"))).toEqual(["refusals", "ends", "removes"]);
  expect(groups.map((g) => [...g.querySelectorAll("li")].map((li) => li.textContent))).toEqual([
    ["reader.payment_in_progress: Payment 1"],
    ["print_jobs 3: ", `portable_holder 1: ${SCRIPT_NAME}`],
    [
      "profile_receipt 1: Bar profile",
      "station_printers 1: Grill",
      `device_receipt 1: ${LONG_NAME}`,
    ],
  ]);
  const irreversible = root.querySelector("[data-irreversible]")!;
  expect(irreversible.textContent!.trim()).toBe(copy.irreversible);
  expect(
    groups.at(-1)!.compareDocumentPosition(irreversible) & Node.DOCUMENT_POSITION_FOLLOWING,
  ).toBeTruthy();
  expect(modalOf(el).heading).toBe(copy.heading);
  expect(modalOf(el).size).toBe("compact");
});

test("renders names as text, never as markup, and wraps a long one inside the dialog", async () => {
  const el = await openDialog({ impact: refusedImpact() });
  const root = el.shadowRoot!;
  expect(root.querySelector("script")).toBeNull();
  expect((window as { __deleteDialogRan?: boolean }).__deleteDialogRan).toBeUndefined();
  const long = [...root.querySelectorAll("li")].find((li) => li.textContent!.includes(LONG_NAME))!;
  expect(long.scrollWidth).toBeLessThanOrEqual(long.clientWidth);
  expect(long.getBoundingClientRect().right).toBeLessThanOrEqual(
    nativeDialog(el).getBoundingClientRect().right,
  );
});

test("draws no heading for an empty group, and an empty impact still says it can't be undone", async () => {
  const el = await openDialog({
    impact: { ...readyImpact(), ends: [], refusals: [] },
  });
  expect([...el.shadowRoot!.querySelectorAll("h3")].map((h) => h.textContent!.trim())).toEqual([
    copy.removes,
  ]);
  el.impact = {
    target: { id: "printer-p", name: "Printer P" },
    refusals: [],
    ends: [],
    removes: [],
  };
  await settle(el);
  expect(el.shadowRoot!.querySelectorAll("h3, ul, [data-group]")).toHaveLength(0);
  expect(el.shadowRoot!.querySelector("[data-irreversible]")!.textContent!.trim()).toBe(
    copy.irreversible,
  );
  expect(button(el, "confirm").variant).toBe("danger");
  expect(inner(el, "confirm").disabled).toBe(false);
});

test("a refusal keeps Delete quiet and disabled until a refreshed impact has none", async () => {
  const el = await openDialog({ impact: refusedImpact() });
  const seen: unknown[] = [];
  el.addEventListener("wt-delete-confirm", (event) =>
    seen.push((event as CustomEvent<{ id: string }>).detail),
  );
  const confirm = el.shadowRoot!.querySelector<WtButton>('[data-test="delete-confirm"]')!;
  expect(confirm.variant).toBe("secondary");
  expect(confirm.shadowRoot!.querySelector<HTMLButtonElement>("button")!.disabled).toBe(true);
  confirm.dispatchEvent(new MouseEvent("click", { bubbles: true, composed: true }));
  expect(seen).toEqual([]);
  el.impact = { ...el.impact!, refusals: [] };
  await el.updateComplete;
  await confirm.updateComplete;
  expect(confirm.variant).toBe("danger");
  confirm.shadowRoot!.querySelector<HTMLButtonElement>("button")!.click();
  expect(seen).toEqual([{ id: "printer-p" }]);
});

test("a ready impact's Delete sends one composed event and stops the click that caused it", async () => {
  const el = await openDialog({}, mountInShadowRoot);
  const confirms = record(document, "wt-delete-confirm");
  const clicks = vi.fn();
  document.addEventListener("click", clicks);
  try {
    await userEvent.click(inner(el, "confirm"));
  } finally {
    document.removeEventListener("click", clicks);
  }
  expect(confirms).toHaveLength(1);
  expect(confirms[0]!.detail).toEqual({ id: "printer-p" });
  expect(confirms[0]!.bubbles).toBe(true);
  expect(confirms[0]!.composed).toBe(true);
  expect(clicks).not.toHaveBeenCalled();
});

test("while the impact loads, its status shows and Delete stays quiet and disabled", async () => {
  const el = await openDialog({ impact: null, loading: true });
  const status = el.shadowRoot!.querySelector('[role="status"]')!;
  expect(status.textContent!.trim()).toBe(copy.loading);
  expect(button(el, "confirm").variant).toBe("secondary");
  expect(inner(el, "confirm").disabled).toBe(true);
  expect(el.shadowRoot!.querySelector("[data-irreversible]")).toBeNull();
  const seen = record(el, "wt-delete-confirm");
  button(el, "confirm").dispatchEvent(new MouseEvent("click", { bubbles: true, composed: true }));
  expect(seen).toEqual([]);

  el.impact = readyImpact();
  await settle(el);
  expect(inner(el, "confirm").disabled, "an impact still refreshing").toBe(true);
  el.loading = false;
  await settle(el);
  expect(el.shadowRoot!.querySelector('[role="status"]')).toBeNull();
  expect(inner(el, "confirm").disabled).toBe(false);
});

test("a failed read shows its message above the buttons, keeps Delete off and offers Retry", async () => {
  const el = await openDialog({ impact: null, readError: "Could not load what this affects." });
  const actions = el.shadowRoot!.querySelector<WtFormActions>("wt-form-actions")!;
  expect((await formMessageOf(actions))?.textContent).toBe("Could not load what this affects.");
  expect(button(el, "confirm").variant).toBe("secondary");
  expect(inner(el, "confirm").disabled).toBe(true);
  expect(button(el, "retry").variant).toBe("secondary");
  expect(inner(el, "retry").disabled).toBe(false);

  const retries = record(el, "wt-delete-retry");
  const confirms = record(el, "wt-delete-confirm");
  await userEvent.click(inner(el, "retry"));
  expect(retries).toHaveLength(1);
  expect(retries[0]!.detail).toEqual({});
  expect(retries[0]!.bubbles && retries[0]!.composed).toBe(true);
  expect(confirms).toEqual([]);

  el.loading = true;
  await settle(el);
  expect(inner(el, "retry").disabled, "Retry while the read is under way").toBe(true);
  button(el, "retry").dispatchEvent(new MouseEvent("click", { bubbles: true, composed: true }));
  expect(retries).toHaveLength(1);
  el.loading = false;
  await settle(el);
  expect(inner(el, "retry").disabled, "Retry after a second failure").toBe(false);
});

test("a stale impact beside a failed refresh still keeps Delete off", async () => {
  const el = await openDialog({ readError: "Could not load what this affects." });
  expect(button(el, "confirm").variant).toBe("secondary");
  expect(inner(el, "confirm").disabled).toBe(true);
});

test("an action error alone leaves Delete usable, and clearing the read error keeps it", async () => {
  const el = await openDialog({
    readError: "Could not load what this affects.",
    actionError: "The printer could not be deleted.",
  });
  const actions = el.shadowRoot!.querySelector<WtFormActions>("wt-form-actions")!;
  const both = (await formMessageOf(actions))!.textContent!;
  expect(both).toContain("Could not load what this affects.");
  expect(both).toContain("The printer could not be deleted.");
  el.readError = "";
  await settle(el);
  expect((await formMessageOf(actions))?.textContent).toBe("The printer could not be deleted.");
  expect(el.shadowRoot!.querySelector('[data-test="delete-retry"]')).toBeNull();
  expect(button(el, "confirm").variant).toBe("danger");
  expect(inner(el, "confirm").disabled).toBe(false);
  const seen = record(el, "wt-delete-confirm");
  await userEvent.click(inner(el, "confirm"));
  expect(seen.map((event) => event.detail)).toEqual([{ id: "printer-p" }]);
});

test("a delete in flight keeps Delete red and busy, sends nothing more and cannot be closed", async () => {
  const el = await openDialog();
  const confirms = record(el, "wt-delete-confirm");
  const closes = record(el, "wt-close");
  el.addEventListener("wt-delete-confirm", () => (el.submitting = true));
  await userEvent.dblClick(inner(el, "confirm"));
  await settle(el);
  expect(confirms).toHaveLength(1);
  expect(button(el, "confirm").variant).toBe("danger");
  expect(button(el, "confirm").loading).toBe(true);
  expect(inner(el, "confirm").getAttribute("aria-busy")).toBe("true");
  expect(inner(el, "confirm").disabled).toBe(true);
  button(el, "confirm").dispatchEvent(new MouseEvent("click", { bubbles: true, composed: true }));
  expect(confirms).toHaveLength(1);

  expect(inner(el, "cancel").disabled).toBe(true);
  button(el, "cancel").dispatchEvent(new MouseEvent("click", { bubbles: true, composed: true }));
  await userEvent.keyboard("{Escape}");
  await new Promise((resolve) => setTimeout(resolve, 50));
  expect(nativeDialog(el).open).toBe(true);
  expect(el.open).toBe(true);
  expect(closes).toEqual([]);

  el.submitting = false;
  await settle(el);
  expect(inner(el, "cancel").disabled).toBe(false);
});

test("new copy while open leaves focus where the keyboard put it", async () => {
  const el = await openDialog();
  await expect.poll(deepActiveElement).toBe(inner(el, "cancel"));
  await userEvent.keyboard("{Tab}");
  await expect.poll(deepActiveElement).toBe(inner(el, "confirm"));
  el.copy = { ...copy, heading: "¿Eliminar la impresora?" };
  await settle(el);
  await new Promise((resolve) => setTimeout(resolve, 50));
  expect(deepActiveElement()).toBe(inner(el, "confirm"));
});

test("opens with Cancel focused, and Escape closes it with one composed wt-close", async () => {
  const el = await openDialog({}, mountInShadowRoot);
  await expect.poll(deepActiveElement).toBe(inner(el, "cancel"));
  const closes = record(document, "wt-close");
  await userEvent.keyboard("{Escape}");
  await vi.waitFor(() => expect(closes).toHaveLength(1));
  expect(closes[0]!.detail).toEqual({});
  expect(closes[0]!.bubbles && closes[0]!.composed).toBe(true);
  expect(el.open).toBe(false);
  expect(nativeDialog(el).open).toBe(false);
  await new Promise((resolve) => setTimeout(resolve, 50));
  expect(closes).toHaveLength(1);
});

test("Cancel closes it with one wt-close and stops its click", async () => {
  const el = await openDialog({}, mountInShadowRoot);
  const closes = record(document, "wt-close");
  const clicks = vi.fn();
  document.addEventListener("click", clicks);
  try {
    await userEvent.click(inner(el, "cancel"));
  } finally {
    document.removeEventListener("click", clicks);
  }
  await vi.waitFor(() => expect(nativeDialog(el).open).toBe(false));
  await new Promise((resolve) => setTimeout(resolve, 50));
  expect(closes).toHaveLength(1);
  expect(closes[0]!.detail).toEqual({});
  expect(el.open).toBe(false);
  expect(clicks).not.toHaveBeenCalled();
});

test("a close the parent makes itself sends no wt-close", async () => {
  const el = await openDialog();
  const closes = record(el, "wt-close");
  el.open = false;
  await settle(el);
  await vi.waitFor(() => expect(nativeDialog(el).open).toBe(false));
  await new Promise((resolve) => setTimeout(resolve, 50));
  expect(closes).toEqual([]);
});

/** A row of two buttons before the dialog, the first focused at opening, and an opener after it. */
async function openFromRow() {
  const el = (await mount("<wt-delete-dialog></wt-delete-dialog>")) as WtDeleteDialog;
  const row = document.createElement("div");
  row.innerHTML = "<button>Target</button><button>Nearby</button>";
  host.prepend(row);
  const opener = document.createElement("button");
  host.append(opener);
  const [target, nearby] = row.querySelectorAll("button");
  target!.focus();
  el.copy = copy;
  el.impact = readyImpact();
  el.opener = opener;
  el.open = true;
  await settle(el);
  return { el, target: target!, nearby: nearby!, opener };
}

/** Focus is handed back on the native close report, which arrives after the dialog has shut. */
async function escapeAndWaitForClose(el: WtDeleteDialog): Promise<void> {
  const closed = new Promise((resolve) => el.addEventListener("wt-close", resolve, { once: true }));
  await userEvent.keyboard("{Escape}");
  await closed;
}

test("Escape hands focus back to what had it at opening", async () => {
  const { el, target } = await openFromRow();
  await escapeAndWaitForClose(el);
  expect(deepActiveElement()).toBe(target);
});

test("focus goes to the opener when what had it at opening has gone", async () => {
  const { el, target, opener } = await openFromRow();
  expect(modalOf(el).opener).toBe(opener);
  target.remove();
  await escapeAndWaitForClose(el);
  expect(deepActiveElement()).toBe(opener);
});

test("focus goes beside what had it at opening when the opener has gone too", async () => {
  const { el, target, nearby, opener } = await openFromRow();
  target.remove();
  opener.remove();
  await escapeAndWaitForClose(el);
  expect(deepActiveElement()).toBe(nearby);
});

test("paints its groups, status and refusals from tokens", async () => {
  const el = await openDialog({ impact: refusedImpact(), loading: true });
  el.style.setProperty("--wt-space-3", "13px");
  el.style.setProperty("--wt-color-text-muted", "rgb(1, 2, 3)");
  el.style.setProperty("--wt-color-danger", "rgb(4, 5, 6)");
  const root = el.shadowRoot!;
  expect(getComputedStyle(root.querySelector('[data-group="ends"]')!).marginBottom).toBe("13px");
  expect(getComputedStyle(root.querySelector('[role="status"]')!).color).toBe("rgb(1, 2, 3)");
  expect(getComputedStyle(root.querySelector('[data-group="refusals"] h3')!).color).toBe(
    "rgb(4, 5, 6)",
  );
});
