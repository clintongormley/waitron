import { afterEach, expect, test, vi } from "vitest";
import { userEvent } from "vitest/browser";
import { cleanup, mount } from "../test-helpers.js";
import type { WtDeleteDialog } from "./wt-delete-dialog.js";
import "./wt-delete-dialog.js";

afterEach(cleanup);

/**
 * In a file of its own: in wt-delete-dialog.test.ts, after that file's earlier cases, every Escape
 * was refused even with `closedby="closerequest"` forced (Chromium 153, 2026-10-10); run in a file
 * of its own the case fails as it should.
 */
test("a delete in flight stays open through repeated Escape presses", async () => {
  const el = (await mount("<wt-delete-dialog></wt-delete-dialog>")) as WtDeleteDialog;
  el.copy = {
    heading: "Delete printer?",
    refusals: "Why it can't be deleted",
    ends: "Work that will end",
    removes: "Settings that will be removed",
    irreversible: "This can't be undone.",
    cancel: "Cancel",
    confirm: "Delete",
    retry: "Try again",
    loading: "Checking what this affects",
    item: (item) => item.key,
    refusal: (refusal) => refusal.code,
  };
  el.impact = {
    target: { id: "printer-p", name: "Printer P" },
    refusals: [],
    ends: [],
    removes: [],
  };
  el.submitting = true;
  el.open = true;
  await el.updateComplete;
  const modal = el.shadowRoot!.querySelector("wt-modal")!;
  await modal.updateComplete;
  const dialog = modal.shadowRoot!.querySelector("dialog")!;
  const closes = vi.fn();
  el.addEventListener("wt-close", closes);
  const nativeCloses = vi.fn();
  dialog.addEventListener("close", nativeCloses);

  for (let press = 1; press <= 3; press += 1) {
    await userEvent.keyboard("{Escape}");
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(dialog.open, `after Escape ${press}`).toBe(true);
  }
  expect(nativeCloses).not.toHaveBeenCalled();
  expect(el.open).toBe(true);
  expect(closes).not.toHaveBeenCalled();
});
