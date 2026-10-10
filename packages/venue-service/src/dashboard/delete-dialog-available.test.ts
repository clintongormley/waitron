import { expect, it } from "vitest";
import { WtDeleteDialog, applyTokens } from "@waitron/ui";
import { VENUE_SERVICE_DASHBOARD } from "./index.js";

it("the venue dashboard entry can open the shared delete dialog", async () => {
  expect(VENUE_SERVICE_DASHBOARD.module).toBe("venue-service");
  expect(customElements.get("wt-delete-dialog")).toBe(WtDeleteDialog);
  const host = document.createElement("div");
  applyTokens(host);
  document.body.append(host);
  try {
    const el = document.createElement("wt-delete-dialog");
    el.copy = {
      heading: "Delete station?",
      refusals: "Why it can't be deleted",
      ends: "Work that will end",
      removes: "Settings that will be removed",
      irreversible: "This can't be undone.",
      cancel: "Cancel",
      confirm: "Delete",
      retry: "Try again",
      loading: "Checking",
      item: (item) => item.key,
      refusal: (refusal) => refusal.code,
    };
    el.impact = { target: { id: "s1", name: "Grill" }, refusals: [], ends: [], removes: [] };
    el.open = true;
    host.append(el);
    await el.updateComplete;
    const modal = el.shadowRoot!.querySelector("wt-modal")!;
    await modal.updateComplete;
    expect(modal.shadowRoot!.querySelector("dialog")!.open).toBe(true);
    expect(modal.shadowRoot!.querySelector("h2")!.textContent).toBe("Delete station?");
  } finally {
    host.remove();
  }
});
