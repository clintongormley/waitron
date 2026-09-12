import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setLocale } from "@waitron/dashboard-kit";
import { setContentLanguages } from "@waitron/ui";
import { cleanup, host } from "@waitron/ui/src/test-helpers.js";
import { expectNoA11yViolations, mountThemed } from "@waitron/ui/src/a11y-helpers.js";
import type { ImageApi, LibraryImage } from "./client.js";
import type { ImageLibrary } from "./image-library.js";
import "./image-library.js";

const image: LibraryImage = {
  id: "bread",
  filename: "bread.png",
  names: { es: "Pan", en: "Bread" },
  altText: { es: "Pan recién hecho", en: "Freshly baked bread" },
  labels: ["Food", "Breakfast"],
  createdAt: "2026-09-12T10:00:00Z",
  updatedAt: "2026-09-12T10:00:00Z",
  usageCount: 1,
};
beforeEach(() => {
  setLocale("en-GB");
  setContentLanguages({ defaultLanguage: "es", languages: ["es", "en"] });
});
afterEach(cleanup);

async function mount(theme: "light" | "dark"): Promise<ImageLibrary> {
  await mountThemed("<div></div>", theme);
  const library = document.createElement("dashboard-image-library");
  library.api = {
    listImages: vi.fn().mockResolvedValue({ images: [image], total: 1 }),
    listLabels: vi.fn().mockResolvedValue({ labels: image.labels }),
    getImage: vi.fn().mockResolvedValue({
      image,
      uses: [
        {
          kind: "product",
          id: "toast",
          catalogueId: "breakfast",
          names: { es: "Tostada", en: "Toast" },
          active: true,
        },
      ],
    }),
  } as unknown as ImageApi;
  host.append(library);
  await library.updateComplete;
  await vi.waitFor(() =>
    expect(library.shadowRoot!.querySelector("[data-image=bread]")).not.toBeNull(),
  );
  return library;
}

async function openDialog(library: ImageLibrary, action: string): Promise<HTMLElement> {
  library.shadowRoot!.querySelector<HTMLElement>(`[data-test=${action}]`)!.click();
  await vi.waitFor(() => expect(library.shadowRoot!.querySelector("wt-modal")).not.toBeNull());
  const modal = library.shadowRoot!.querySelector("wt-modal")!;
  await modal.updateComplete;
  await vi.waitFor(() =>
    expect(modal.shadowRoot!.querySelector<HTMLDialogElement>("dialog")!.open).toBe(true),
  );
  return modal;
}

describe.each(["light", "dark"] as const)("image library accessibility (%s)", (theme) => {
  it("labels search, filters, direction and image actions in the populated library", async () => {
    const library = await mount(theme);
    const sort = library.shadowRoot!.querySelector<HTMLSelectElement>("select[name=image-sort]")!;
    sort.value = "date";
    sort.dispatchEvent(new Event("change"));
    await library.updateComplete;
    await expectNoA11yViolations(host);
  });
  it("announces missing upload metadata beside fields and in the form summary", async () => {
    const library = await mount(theme);
    await openDialog(library, "upload");
    library.shadowRoot!.querySelector<HTMLElement>("[data-test=save]")!.click();
    await library.updateComplete;
    const summary = library.shadowRoot!.querySelector("wt-form-error-summary")!;
    await summary.updateComplete;
    expect(summary.shadowRoot!.querySelector("[role=alert]")).not.toBeNull();
    await expectNoA11yViolations(host);
  });
  it("labels translated metadata fields in the edit dialog", async () => {
    const library = await mount(theme);
    await openDialog(library, "edit-bread");
    await expectNoA11yViolations(host);
  });
  it("exposes the blocking reason and product link in the used-image dialog", async () => {
    const library = await mount(theme);
    const modal = await openDialog(library, "delete-bread");
    expect(modal.querySelector("a")!.textContent).toBe("Toast");
    expect(modal.querySelector("[data-test=confirm-delete]")).toBeNull();
    await expectNoA11yViolations(host);
  });
});
