import { afterEach, describe, expect, it, vi } from "vitest";
import { setLocale } from "@waitron/dashboard-kit";
import { setContentLanguages } from "@waitron/ui";
import { cleanup, host } from "@waitron/ui/src/test-helpers.js";
import { expectNoA11yViolations, mountThemed } from "@waitron/ui/src/a11y-helpers.js";
import type { ImageApi, LibraryImage } from "./client.js";
import "./image-library.js";
afterEach(() => {
  cleanup();
  setLocale("en");
  setContentLanguages({ defaultLanguage: "en", languages: ["en"] });
});
describe.each(["light", "dark"] as const)("batch accessibility (%s)", (theme) => {
  it("announces progress and named failure/duplicate outcomes without losing the created photo", async () => {
    setLocale("en");
    setContentLanguages({ defaultLanguage: "en", languages: ["en"] });
    await mountThemed("<div></div>", theme);
    let resolve!: (value: { image: LibraryImage; created: boolean }) => void;
    const pending = new Promise<{ image: LibraryImage; created: boolean }>((done) => {
      resolve = done;
    });
    const image: LibraryImage = {
      id: "new",
      filename: "new.png",
      names: { en: "Bread" },
      createdAt: "2026-10-17T00:00:00Z",
      updatedAt: "2026-10-17T00:00:00Z",
      usageCount: 0,
    };
    const upload = vi
      .fn()
      .mockReturnValueOnce(pending)
      .mockRejectedValueOnce({ code: "image.invalid_file" })
      .mockResolvedValueOnce({ image: { ...image, id: "old" }, created: false });
    const library = document.createElement("dashboard-image-library");
    library.api = {
      listImages: vi.fn().mockResolvedValue({ images: [], total: 0 }),
      uploadImage: upload,
    } as unknown as ImageApi;
    host.append(library);
    await library.updateComplete;
    const data = new DataTransfer();
    ["bread.png", "damaged.png", "same.png"].forEach((name) =>
      data.items.add(new File(["photo"], name, { type: "image/png" })),
    );
    library.dispatchEvent(
      new DragEvent("drop", {
        dataTransfer: data,
        cancelable: true,
        bubbles: true,
        composed: true,
      }),
    );
    await library.updateComplete;
    expect(library.shadowRoot!.textContent).toContain("0 of 3 photos uploaded.");
    await expectNoA11yViolations(host);
    resolve({ image, created: true });
    await vi.waitFor(() =>
      expect(library.shadowRoot!.textContent).toContain("2 of 3 photos uploaded."),
    );
    expect(library.shadowRoot!.querySelector("[data-upload-error]")).not.toBeNull();
    expect(library.shadowRoot!.querySelectorAll("[data-new]")).toHaveLength(1);
    await expectNoA11yViolations(host);
  });
});
