import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setLocale } from "@waitron/dashboard-kit";
import { setContentLanguages } from "@waitron/ui";
import { chooseOption, cleanup, formMessageOf, host } from "@waitron/ui/src/test-helpers.js";
import { expectNoA11yViolations, mountThemed } from "@waitron/ui/src/a11y-helpers.js";
import type { ImageApi, LibraryImage } from "./client.js";
import type { ImageLibrary } from "./image-library.js";
import "./image-library.js";

const image: LibraryImage = {
  id: "bread",
  filename: "bread.png",
  names: { es: "Pan", en: "Bread" },
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
    getImage: vi.fn().mockResolvedValue({
      image,
      uses: [
        {
          kind: "product",
          id: "toast",
          catalogueId: "breakfast",
          name: "Toast",
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
  it.each(["upload", "edit-bread"])(
    "keeps quiet and changed Save accessible (%s)",
    async (action) => {
      const library = await mount(theme);
      await openDialog(library, action);
      const save =
        library.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-button"]>("[data-test=save]")!;
      expect(save.disabled).toBe(true);
      expect(save.variant).toBe("secondary");
      await expectNoA11yViolations(host);
      library
        .shadowRoot!.querySelector("[name=name-es]")!
        .dispatchEvent(new CustomEvent("wt-change", { detail: { value: "Pan editado" } }));
      await library.updateComplete;
      expect(save.disabled).toBe(false);
      expect(save.variant).toBe("primary");
      await expectNoA11yViolations(host);
    },
  );
  it("labels search, filters, direction and image actions in the populated library", async () => {
    const library = await mount(theme);
    await chooseOption(library.shadowRoot!.querySelector("wt-combobox[name=image-sort]")!, "date");
    await library.updateComplete;
    await expectNoA11yViolations(host);
  });
  it("announces missing upload metadata beside fields and above the Save button", async () => {
    const library = await mount(theme);
    await openDialog(library, "upload");
    library
      .shadowRoot!.querySelector("[name=name-en]")!
      .dispatchEvent(new CustomEvent("wt-change", { detail: { value: "Bread draft" } }));
    await library.updateComplete;
    library.shadowRoot!.querySelector<HTMLElement>("[data-test=save]")!.click();
    await library.updateComplete;
    const actions = library.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-form-actions"]>(
      "wt-modal wt-form-actions",
    )!;
    expect((await formMessageOf(actions))!.getAttribute("role")).toBe("alert");
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
  it("names the preview, its photo and its list of uses, opened from the thumbnail", async () => {
    const library = await mount(theme);
    const modal = await openDialog(library, "preview-bread");
    await vi.waitFor(() => expect(modal.querySelector(".uses li a")?.textContent).toBe("Toast"));
    await expectNoA11yViolations(host);
  });
  it("says the image is not used anywhere in the preview", async () => {
    const library = await mount(theme);
    vi.mocked(library.api.getImage).mockResolvedValue({ image, uses: [] });
    const modal = await openDialog(library, "preview-bread");
    await vi.waitFor(() => expect(modal.querySelector("[data-test=no-uses]")).not.toBeNull());
    await expectNoA11yViolations(host);
  });
  it("announces a failed lookup of the image's uses, with Try again, in the preview", async () => {
    const library = await mount(theme);
    vi.mocked(library.api.getImage).mockRejectedValue({ code: "connection.failed" });
    const modal = await openDialog(library, "preview-bread");
    await vi.waitFor(() => expect(modal.querySelector(".uses [role=alert]")).not.toBeNull());
    expect(modal.querySelector("[data-test=retry-uses]")).not.toBeNull();
    await expectNoA11yViolations(host);
  });
});
