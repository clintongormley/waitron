import { render } from "lit";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { userEvent } from "vitest/browser";
import { currentLocale, setLocale } from "../i18n/t.js";
import type { BillEditConflict } from "../state/bill-edit-conflicts.js";
import { cleanupWidgets, mountWidget } from "./test-helpers.js";
import {
  BillEditConflictsDialog,
  type BillEditConflictsPrompt,
} from "./bill-edit-conflicts-dialog.js";

import { draftHolderRow } from "./draft-holder-row.js";

const locale = currentLocale();
beforeEach(() => setLocale("en"));
afterEach(() => {
  cleanupWidgets();
  setLocale(locale);
});

const row: BillEditConflict = {
  label: "Table 4 · Bill 2",
  partyId: "p4",
  ownerName: "Luis",
  edit: { billId: "b2", draftId: "draft-2", editorVersion: 3, draftRevision: 2 },
};
const withoutDraft: BillEditConflict = {
  label: "Table 7 · Bill",
  partyId: "p7",
  ownerName: null,
  edit: { billId: "b7", draftId: null, editorVersion: 5, draftRevision: null },
};

async function mount(over: Partial<BillEditConflictsPrompt> = {}) {
  const prompt = {
    rows: [row],
    takeOver: vi.fn().mockResolvedValue(null),
    close: vi.fn(),
    ...over,
  };
  const { el } = await mountWidget<BillEditConflictsDialog>("till-bill-edit-conflicts-dialog", {
    prompt,
  });
  const root = el.shadowRoot!;
  const button = (selector: string) => root.querySelector<HTMLElement>(selector)!;
  return { el, root, prompt, button };
}

it("identifies each blocked bill and offers Take over only for a known draft", async () => {
  const { root, button } = await mount({ rows: [row, withoutDraft] });
  expect(root.querySelectorAll("li")).toHaveLength(2);
  expect(root.textContent).toContain("Luis has an unsent order");
  expect(root.textContent).toContain("Table 7 · Bill");
  expect(root.textContent).toContain("An unsent order");
  expect(button('[data-split-take-over="b2"]').getAttribute("aria-label")).toBe(
    "Take over draft · Table 4 · Bill 2",
  );
  expect(button('[data-split-take-over="b7"]')).toBeNull();
  expect(button("[data-finish-conflicts]")).toBeNull();
});

it("returns focus to the selected row on Back and dismisses without taking over", async () => {
  const { root, button, prompt } = await mount();
  const takeover = () => button('[data-split-take-over="b2"]');
  await userEvent.click(takeover());
  await userEvent.click(button("[data-back-to-conflicts]"));
  expect(root.activeElement).toBe(takeover());
  await userEvent.keyboard("{Escape}");
  await vi.waitFor(() => expect(prompt.close).toHaveBeenCalledWith(false));
  expect(prompt.takeOver).not.toHaveBeenCalled();
});

it("keeps a refused takeover's message in the confirmation", async () => {
  const takeOver = vi.fn().mockResolvedValue("The draft was sent.");
  const { root, button, prompt } = await mount({ takeOver });
  await userEvent.click(button('[data-split-take-over="b2"]'));
  await userEvent.click(button("[data-confirm-take-over]"));
  expect(root.querySelector('[role="alert"]')?.textContent).toBe("The draft was sent.");
  expect(takeOver.mock.calls).toEqual([[row]]);
  expect(prompt.close).not.toHaveBeenCalled();
});

it.each([
  ["en", "Close", "Close this message, then try the action again."],
  ["es-ES", "Cerrar", "Cierra este aviso y vuelve a intentarlo."],
])(
  "after resolving a whole-table conflict, explains how to retry in %s",
  async (language, label, message) => {
    setLocale(language);
    const { button, root, prompt } = await mount();
    await userEvent.click(button('[data-split-take-over="b2"]'));
    await userEvent.click(button("[data-confirm-take-over]"));
    const close = button("[data-finish-conflicts]");
    expect(close?.textContent?.trim()).toBe(label);
    expect(root.querySelector("p")?.textContent?.trim()).toBe(message);
    await userEvent.click(close);
    await vi.waitFor(() => expect(prompt.close).toHaveBeenCalledWith(false));
  },
);

it("the shared row distinguishes orders taken from this waiter from other held orders", () => {
  const container = document.createElement("div");
  const words = (name: string | null, takenFromYou: boolean) => {
    render(
      draftHolderRow({ billId: "b2", label: "Bill 2", ownerName: name, takenFromYou }),
      container,
    );
    return container.textContent?.trim();
  };
  expect(words("Luis", true)).toBe("Taken over by Luis");
  expect(words(null, true)).toBe("Taken over by someone else");
  expect(words(null, false)).toBe("An unsent order");
});
