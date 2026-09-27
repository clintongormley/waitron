import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { page } from "vitest/browser";
import { setLocale } from "@waitron/dashboard-kit";
import { setContentLanguages } from "@waitron/ui";
import { cleanup, host } from "@waitron/ui/src/test-helpers.js";
import { mountThemed } from "@waitron/ui/src/a11y-helpers.js";
import type { ImageApi } from "./client.js";
import "./image-library.js";

const viewport = { width: window.innerWidth, height: window.innerHeight };

beforeEach(() => {
  setLocale("en-GB");
  setContentLanguages({ defaultLanguage: "es", languages: ["es", "en"] });
});
afterEach(async () => {
  cleanup();
  await page.viewport(viewport.width, viewport.height);
});

function measured(element: Element): DOMRect {
  const box = element.getBoundingClientRect();
  expect(box.width).toBeGreaterThan(0);
  return box;
}

for (const theme of ["light", "dark"] as const) {
  it(`fits the upload dialog's fields inside it on a 320px-wide phone, with nothing to scroll sideways (${theme})`, async () => {
    await page.viewport(320, 700);
    expect(window.innerWidth).toBe(320);
    await mountThemed("<div></div>", theme);
    const library = document.createElement("dashboard-image-library");
    library.api = {
      listImages: vi.fn().mockResolvedValue({ images: [], total: 0 }),
      listLabels: vi.fn().mockResolvedValue({ labels: [] }),
    } as unknown as ImageApi;
    host.append(library);
    await library.updateComplete;
    library.shadowRoot!.querySelector<HTMLElement>("[data-test=upload]")!.click();
    await vi.waitFor(() => expect(library.shadowRoot!.querySelector("wt-modal")).not.toBeNull());
    const modal = library.shadowRoot!.querySelector("wt-modal")!;
    await modal.updateComplete;
    const dialogElement = modal.shadowRoot!.querySelector<HTMLDialogElement>("dialog")!;
    await vi.waitFor(() => expect(dialogElement.open).toBe(true));
    const dialog = measured(dialogElement);

    const file = library.shadowRoot!.querySelector("input[type=file]")!;
    const fileBox = measured(file);
    expect(fileBox.left).toBeGreaterThanOrEqual(dialog.left);
    expect(fileBox.right).toBeLessThanOrEqual(dialog.right);

    const fieldsets = [...library.shadowRoot!.querySelectorAll("fieldset")];
    expect(fieldsets).toHaveLength(2);
    for (const fieldset of fieldsets) {
      const box = measured(fieldset);
      expect(box.left).toBeGreaterThanOrEqual(dialog.left);
      expect(box.right).toBeLessThanOrEqual(dialog.right);
      for (const input of fieldset.querySelectorAll("wt-input")) {
        expect(measured(input).right).toBeLessThanOrEqual(dialog.right);
      }
    }

    const body = modal.shadowRoot!.querySelector<HTMLElement>(".body")!;
    expect(body.clientWidth).toBeGreaterThan(0);
    expect(body.scrollWidth).toBeLessThanOrEqual(body.clientWidth);
  });
}
