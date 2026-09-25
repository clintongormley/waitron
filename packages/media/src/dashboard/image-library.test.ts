import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { userEvent } from "vitest/browser";
import { setContentLanguages } from "@waitron/ui";
import { codeMessage, setLocale, LiveData, type DashboardRequest } from "@waitron/dashboard-kit";
import "./image-library.js";
import type { ImageLibrary } from "./image-library.js";
import { ImageApi, type LibraryImage } from "./client.js";

const image: LibraryImage = {
  id: "one",
  filename: "one.jpg",
  names: { es: "Pan", en: "Bread" },
  altText: { es: "Pan recién hecho" },
  labels: ["Food", "Summer menu"],
  createdAt: "2026-09-12T12:00:00Z",
  updatedAt: "2026-09-12T12:00:00Z",
  usageCount: 0,
};
let el: ImageLibrary;
function api() {
  return {
    listImages: vi.fn().mockResolvedValue({ images: [image], total: 1 }),
    listLabels: vi.fn().mockResolvedValue({ labels: image.labels }),
    uploadImage: vi.fn().mockResolvedValue({ image, created: true }),
    updateImage: vi.fn().mockResolvedValue({ image }),
    deleteImage: vi.fn().mockResolvedValue({ deleted: true, uses: [] }),
    getImage: vi.fn().mockResolvedValue({ image, uses: [] }),
  };
}
async function mount(client = api(), picker = false) {
  el = document.createElement("dashboard-image-library");
  el.api = client as unknown as ImageApi;
  el.picker = picker;
  document.body.append(el);
  await el.updateComplete;
  await vi.waitFor(() => expect(el.shadowRoot!.querySelector("[data-image=one]")).not.toBeNull());
  return client;
}
function click(selector: string) {
  (el.shadowRoot!.querySelector(selector) as HTMLElement).click();
}
function field(name: string, value: string) {
  el.shadowRoot!.querySelector(`[name="${name}"]`)!.dispatchEvent(
    new CustomEvent("wt-change", { detail: { value }, bubbles: true, composed: true }),
  );
}
beforeEach(() => {
  setLocale("en-GB");
  setContentLanguages({ defaultLanguage: "es", languages: ["es", "fr"] });
});

it("shows the default name and alt text when the interface language is disabled for content", async () => {
  const client = api();
  client.listImages.mockResolvedValue({
    images: [{ ...image, altText: { en: "English description", es: "Pan recién hecho" } }],
    total: 1,
  });
  await mount(client);
  expect(el.shadowRoot!.querySelector("[data-image=one] h2")!.textContent).toBe("Pan");
  expect(el.shadowRoot!.querySelector<HTMLImageElement>("[data-image=one] img")!.alt).toBe(
    "Pan recién hecho",
  );
});

it("asks the server to sort names in the displayed content language", async () => {
  setContentLanguages({ defaultLanguage: "es", languages: ["es", "en"] });
  const zebra = { ...image, names: { es: "Cebra", en: "Zebra" } };
  const apple = { ...image, id: "two", names: { es: "Manzana", en: "Apple" } };
  const request = vi.fn().mockImplementation(async (path: string) => {
    if (path.includes("image-labels")) return { labels: [] };
    const language = new URL(path, location.origin).searchParams.get("language") ?? "es";
    return { images: language.startsWith("en") ? [apple, zebra] : [zebra, apple], total: 2 };
  });
  el = document.createElement("dashboard-image-library");
  el.api = new ImageApi(request as DashboardRequest);
  document.body.append(el);
  await el.updateComplete;
  const sort = el.shadowRoot!.querySelector<HTMLSelectElement>("select[name=image-sort]")!;
  sort.value = "name";
  sort.dispatchEvent(new Event("change"));
  await vi.waitFor(() => expect(el.shadowRoot!.querySelectorAll("article")).toHaveLength(2));
  expect(
    [...el.shadowRoot!.querySelectorAll("article h2")].map((heading) => heading.textContent),
  ).toEqual(["Apple", "Zebra"]);
  const query = new URL(
    request.mock.calls.filter((call) => !call[0].includes("image-labels")).at(-1)![0],
    location.origin,
  );
  expect(query.searchParams.get("language")).toBe("en-GB");
});

it("reloads a mounted library's first page passively on an interface-language change", async () => {
  const background = api();
  const client = Object.assign(api(), { background });
  client.listImages.mockResolvedValue({ images: [image], total: 25 });
  await mount(client);
  [...el.shadowRoot!.querySelectorAll<HTMLElement>("nav wt-button")].at(-1)!.click();
  await vi.waitFor(() =>
    expect(client.listImages).toHaveBeenLastCalledWith(expect.objectContaining({ offset: 24 })),
  );
  click("[data-test=edit-one]");
  await el.updateComplete;
  field("name-es", "Pan editado");
  await el.updateComplete;
  setLocale("es-ES");
  await vi.waitFor(() =>
    expect(background.listImages).toHaveBeenCalledWith(
      expect.objectContaining({ language: "es-ES", offset: 0 }),
    ),
  );
  expect(
    (el.shadowRoot!.querySelector("wt-input[name=name-es]") as HTMLElement & { value: string })
      .value,
  ).toBe("Pan editado");
});

it("refreshes image ordering passively after content-language settings change", async () => {
  const liveData = new LiveData();
  const background = api();
  const client = Object.assign(api(), { background, liveData });
  await mount(client);
  click("[data-test=edit-one]");
  await el.updateComplete;
  field("image-labels", "Draft label");
  background.listImages.mockResolvedValue({
    images: [{ ...image, id: "two", names: { es: "First" } }, image],
    total: 2,
  });
  liveData.invalidate([{ type: "content_languages" }]);
  await vi.waitFor(() => expect(background.listImages).toHaveBeenCalledOnce());
  expect(
    [...el.shadowRoot!.querySelectorAll("article")].map((article) =>
      article.getAttribute("data-image"),
    ),
  ).toEqual(["two", "one"]);
  expect(
    (el.shadowRoot!.querySelector("wt-input[name=image-labels]") as HTMLElement & { value: string })
      .value,
  ).toBe("Draft label");
});
afterEach(() => {
  el?.remove();
});

it("requires file and default-language name but keeps alt text optional", async () => {
  const client = await mount();
  click("[data-test=upload]");
  await el.updateComplete;
  click("[data-test=save]");
  await el.updateComplete;
  expect(client.uploadImage).not.toHaveBeenCalled();
  expect(el.shadowRoot!.querySelector("wt-form-error-summary")).not.toBeNull();
  expect(
    el.shadowRoot!.querySelector("wt-input[name=name-es]")!.getAttribute("error"),
  ).toBeTruthy();
  // Alt text is optional: the default-language alt field is neither required nor flagged as missing.
  expect(el.shadowRoot!.querySelector("wt-input[name=alt-es]")!.getAttribute("error")).toBeFalsy();
  expect(el.shadowRoot!.querySelector("wt-input[name=alt-es]")!.hasAttribute("required")).toBe(
    false,
  );
  expect(el.shadowRoot!.querySelector("wt-input[name=name-fr]")!.hasAttribute("required")).toBe(
    false,
  );
  const transfer = new DataTransfer();
  transfer.items.add(new File(["photo"], "bread.jpg", { type: "image/jpeg" }));
  const file = el.shadowRoot!.querySelector<HTMLInputElement>("input[name=image-file]")!;
  file.files = transfer.files;
  file.dispatchEvent(new Event("change"));
  field("name-es", "Pan");
  field("image-labels", "Food, Summer menu");
  await el.updateComplete;
  click("[data-test=save]");
  await vi.waitFor(() => expect(client.uploadImage).toHaveBeenCalledOnce());
  expect(client.uploadImage.mock.calls[0]![1]).toEqual({
    names: { es: "Pan" },
    altText: {},
    labels: ["Food", "Summer menu"],
  });
  await vi.waitFor(() => expect(el.shadowRoot!.querySelector("[data-test=save]")).toBeNull());
  expect(el.shadowRoot!.querySelector("[data-test=duplicate-upload]")).toBeNull();
});

it("previews the chosen file when uploading and the stored image when editing", async () => {
  await mount();
  click("[data-test=edit-one]");
  await el.updateComplete;
  const editing = el.shadowRoot!.querySelector<HTMLImageElement>("[data-test=preview]");
  expect(editing).not.toBeNull();
  expect(editing!.src).toContain("/media/one.jpg");
  el.shadowRoot!.querySelector("wt-modal")!.dispatchEvent(
    new CustomEvent("wt-close", { bubbles: true, composed: true }),
  );
  await el.updateComplete;
  click("[data-test=upload]");
  await el.updateComplete;
  expect(el.shadowRoot!.querySelector("[data-test=preview]")).toBeNull();
  const transfer = new DataTransfer();
  transfer.items.add(new File(["photo"], "bread.jpg", { type: "image/jpeg" }));
  const file = el.shadowRoot!.querySelector<HTMLInputElement>("input[name=image-file]")!;
  file.files = transfer.files;
  file.dispatchEvent(new Event("change"));
  await el.updateComplete;
  const preview = el.shadowRoot!.querySelector<HTMLImageElement>("[data-test=preview]");
  expect(preview).not.toBeNull();
  expect(preview!.src.startsWith("blob:")).toBe(true);
});

it("explains when a duplicate photo reuses the existing image and keeps its metadata", async () => {
  const client = api();
  client.uploadImage.mockResolvedValue({ image, created: false });
  await mount(client);
  click("[data-test=upload]");
  await el.updateComplete;
  const transfer = new DataTransfer();
  transfer.items.add(new File(["same photo"], "bread.jpg", { type: "image/jpeg" }));
  const file = el.shadowRoot!.querySelector<HTMLInputElement>("input[name=image-file]")!;
  file.files = transfer.files;
  file.dispatchEvent(new Event("change"));
  field("name-es", "Different name");
  field("alt-es", "Different alt text");
  field("image-labels", "Different label");
  await el.updateComplete;
  click("[data-test=save]");
  await vi.waitFor(() =>
    expect(el.shadowRoot!.querySelector("[data-test=duplicate-upload]")).not.toBeNull(),
  );
  const notice = el.shadowRoot!.querySelector("[data-test=duplicate-upload]")!;
  expect(notice.getAttribute("role")).toBe("status");
  expect(notice.textContent).toContain("Pan");
  expect(notice.textContent).toContain("name, alt text and labels are unchanged");
  expect(client.updateImage).not.toHaveBeenCalled();
  expect(el.shadowRoot!.querySelectorAll("[data-image=one]")).toHaveLength(1);
  click("[data-test=edit-duplicate]");
  await el.updateComplete;
  expect(
    (el.shadowRoot!.querySelector("wt-input[name=name-es]") as HTMLElement & { value: string })
      .value,
  ).toBe("Pan");
  expect(
    (el.shadowRoot!.querySelector("wt-input[name=alt-es]") as HTMLElement & { value: string })
      .value,
  ).toBe("Pan recién hecho");
  expect(
    (el.shadowRoot!.querySelector("wt-input[name=image-labels]") as HTMLElement & { value: string })
      .value,
  ).toBe("Food, Summer menu");
});

it("sends search, label, and sort to the server", async () => {
  const client = await mount();
  field("image-search", "summer bread");
  await el.updateComplete;
  const label = el.shadowRoot!.querySelector<HTMLSelectElement>("select[name=image-label]")!;
  label.value = "Food";
  label.dispatchEvent(new Event("change"));
  const sort = el.shadowRoot!.querySelector<HTMLSelectElement>("select[name=image-sort]")!;
  sort.value = "name";
  sort.dispatchEvent(new Event("change"));
  await vi.waitFor(() =>
    expect(client.listImages).toHaveBeenLastCalledWith({
      search: "summer bread",
      language: "en-GB",
      label: "Food",
      sort: "name",
      direction: "asc",
      offset: 0,
      limit: 24,
    }),
  );
});

it.each([
  { sort: "date", initial: "desc", reverse: "asc", picker: false },
  { sort: "name", initial: "asc", reverse: "desc", picker: true },
])(
  "offers both $sort directions and keeps relevance ranked in the picker=$picker library",
  async ({ sort, initial, reverse, picker }) => {
    const client = await mount(api(), picker);
    expect(el.shadowRoot!.querySelector("select[name=image-direction]")).toBeNull();
    const sorting = el.shadowRoot!.querySelector<HTMLSelectElement>("select[name=image-sort]")!;
    sorting.value = sort;
    sorting.dispatchEvent(new Event("change"));
    await el.updateComplete;
    const direction = el.shadowRoot!.querySelector<HTMLSelectElement>(
      "select[name=image-direction]",
    )!;
    expect(direction).not.toBeNull();
    expect(direction.value).toBe(initial);
    await vi.waitFor(() =>
      expect(client.listImages).toHaveBeenLastCalledWith(
        expect.objectContaining({ sort, direction: initial, offset: 0 }),
      ),
    );
    direction.value = reverse;
    direction.dispatchEvent(new Event("change"));
    await vi.waitFor(() =>
      expect(client.listImages).toHaveBeenLastCalledWith(
        expect.objectContaining({ sort, direction: reverse, offset: 0 }),
      ),
    );
    sorting.value = "relevance";
    sorting.dispatchEvent(new Event("change"));
    await el.updateComplete;
    expect(el.shadowRoot!.querySelector("select[name=image-direction]")).toBeNull();
    await vi.waitFor(() =>
      expect(client.listImages).toHaveBeenLastCalledWith({
        search: "",
        language: "en-GB",
        label: "",
        sort: "relevance",
        offset: 0,
        limit: 24,
      }),
    );
  },
);

it("closes a successfully saved editor even when refreshing the list fails", async () => {
  const client = await mount();
  click("[data-test=edit-one]");
  await el.updateComplete;
  field("name-es", "Pan nuevo");
  client.listImages.mockRejectedValueOnce(new Error("refresh"));
  click("[data-test=save]");
  await vi.waitFor(() => expect(client.updateImage).toHaveBeenCalledOnce());
  await vi.waitFor(() => expect(el.shadowRoot!.querySelector("[data-test=save]")).toBeNull());
  expect(el.shadowRoot!.textContent).toContain("could not be loaded");
});

it("shows usage links and blocks a delete when the server reports uses", async () => {
  const client = api();
  client.getImage.mockResolvedValue({
    image: { ...image, usageCount: 1 },
    uses: [
      {
        kind: "product",
        id: "product-1",
        catalogueId: "menu",
        name: "Breakfast",
        active: true,
      },
    ],
  });
  await mount(client);
  click("[data-test=delete-one]");
  await vi.waitFor(() => expect(el.shadowRoot!.textContent).toContain("Breakfast"));
  expect(el.shadowRoot!.querySelector("a")!.getAttribute("href")).toBe(
    "/manage/catalogue/product/product-1",
  );
  expect(el.shadowRoot!.querySelector("[data-test=confirm-delete]")).toBeNull();
  expect(client.deleteImage).not.toHaveBeenCalled();
});

it("links a blocking variant use to the variant's own product page, not its parent's", async () => {
  const client = api();
  client.getImage.mockResolvedValue({
    image: { ...image, usageCount: 1 },
    uses: [
      {
        kind: "variant",
        id: "variant-1",
        productId: "product-1",
        catalogueId: "menu",
        name: "Large",
        active: true,
      },
    ],
  });
  await mount(client);
  click("[data-test=delete-one]");
  await vi.waitFor(() => expect(el.shadowRoot!.textContent).toContain("Large"));
  expect(el.shadowRoot!.querySelector("a")!.getAttribute("href")).toBe(
    "/manage/catalogue/product/variant-1",
  );
  expect(el.shadowRoot!.querySelector("[data-test=confirm-delete]")).toBeNull();
});

it("handles a new use between confirmation and deletion", async () => {
  const client = api();
  client.deleteImage.mockResolvedValue({
    deleted: false,
    uses: [{ kind: "product", id: "p", catalogueId: "menu", name: "Toast", active: true }],
  });
  await mount(client);
  click("[data-test=delete-one]");
  await vi.waitFor(() =>
    expect(el.shadowRoot!.querySelector("[data-test=confirm-delete]")).not.toBeNull(),
  );
  click("[data-test=confirm-delete]");
  await vi.waitFor(() => expect(el.shadowRoot!.textContent).toContain("Toast"));
  expect(el.shadowRoot!.querySelector("[data-test=confirm-delete]")).toBeNull();
});

it("selects metadata from the picker without editing the image", async () => {
  const client = await mount(api(), true);
  const selected = vi.fn();
  el.addEventListener("select-image", selected);
  click("[data-test=select-one]");
  expect(selected.mock.calls[0]![0].detail).toEqual(image);
  expect(client.updateImage).not.toHaveBeenCalled();
});

it("retains every translation while editing enabled languages and keeps a draft through configuration updates", async () => {
  const client = await mount();
  click("[data-test=edit-one]");
  await el.updateComplete;
  field("name-es", "Nuevo pan");
  setContentLanguages({ defaultLanguage: "es", languages: ["es", "fr", "de"] });
  await el.updateComplete;
  expect(
    (el.shadowRoot!.querySelector("wt-input[name=name-es]") as HTMLElement & { value: string })
      .value,
  ).toBe("Nuevo pan");
  expect(el.shadowRoot!.querySelector("wt-input[name=name-de]")).not.toBeNull();
  click("[data-test=save]");
  await vi.waitFor(() =>
    expect(client.updateImage).toHaveBeenCalledWith("one", {
      names: { es: "Nuevo pan", en: "Bread" },
      altText: image.altText,
      labels: image.labels,
    }),
  );
});

it("keeps a failed save open, ignores repeated saves while pending and allows retry", async () => {
  const client = await mount();
  click("[data-test=edit-one]");
  await el.updateComplete;
  let reject!: (error: unknown) => void;
  client.updateImage.mockImplementationOnce(
    () =>
      new Promise((_resolve, rejectPromise) => {
        reject = rejectPromise;
      }),
  );
  click("[data-test=save]");
  click("[data-test=save]");
  expect(client.updateImage).toHaveBeenCalledOnce();
  reject({ code: "image.translation_required" });
  await vi.waitFor(() => expect(el.shadowRoot!.textContent).toContain("could not be saved"));
  expect(el.shadowRoot!.querySelector("[data-test=save]")).not.toBeNull();
  click("[data-test=save]");
  await vi.waitFor(() => expect(client.updateImage).toHaveBeenCalledTimes(2));
});

it("explains a photo the server could not read", async () => {
  const client = api();
  client.uploadImage.mockRejectedValueOnce({ code: "image.invalid_file" });
  await mount(client);
  click("[data-test=upload]");
  await el.updateComplete;
  const transfer = new DataTransfer();
  transfer.items.add(new File(["photo"], "bread.jpg", { type: "image/jpeg" }));
  const file = el.shadowRoot!.querySelector<HTMLInputElement>("input[name=image-file]")!;
  file.files = transfer.files;
  file.dispatchEvent(new Event("change"));
  field("name-es", "Pan");
  await el.updateComplete;
  click("[data-test=save]");
  await vi.waitFor(() =>
    expect(el.shadowRoot!.querySelector("[role=alert]")!.textContent).toContain(
      "The photo could not be read",
    ),
  );
});

it.each([
  ["image.too_large", "The photo file is too large", "El archivo de la foto es demasiado grande"],
  ["image.invalid_file", "The photo could not be read", "No se pudo leer la foto"],
  ["image.too_many_pixels", "The photo has too many pixels", "La foto tiene demasiados píxeles"],
])("names %s in English and Spanish", (code, en, es) => {
  expect(codeMessage(code, "en")).toContain(en);
  expect(codeMessage(code, "es")).toContain(es);
});

it("deletes unused images only after confirmation and refreshes the list of labels", async () => {
  const client = await mount();
  click("[data-test=delete-one]");
  await vi.waitFor(() =>
    expect(el.shadowRoot!.querySelector("[data-test=confirm-delete]")).not.toBeNull(),
  );
  expect(client.deleteImage).not.toHaveBeenCalled();
  client.listImages.mockResolvedValue({ images: [], total: 0 });
  client.listLabels.mockResolvedValue({ labels: [] });
  click("[data-test=confirm-delete]");
  await vi.waitFor(() => expect(el.shadowRoot!.querySelector("[data-image=one]")).toBeNull());
  expect(el.shadowRoot!.querySelectorAll("select[name=image-label] option")).toHaveLength(1);
  expect(el.shadowRoot!.textContent).toContain("No images found");
});

it("retains deletion confirmation after a failure and allows it to be dismissed", async () => {
  const client = await mount();
  client.deleteImage.mockRejectedValueOnce(new Error("delete"));
  click("[data-test=delete-one]");
  await vi.waitFor(() =>
    expect(el.shadowRoot!.querySelector("[data-test=confirm-delete]")).not.toBeNull(),
  );
  click("[data-test=confirm-delete]");
  await vi.waitFor(() =>
    expect(el.shadowRoot!.querySelector("wt-modal")!.textContent).toContain("could not be deleted"),
  );
  el.shadowRoot!.querySelector("wt-modal")!.dispatchEvent(new CustomEvent("wt-close"));
  await el.updateComplete;
  expect(el.shadowRoot!.querySelector("[data-test=confirm-delete]")).toBeNull();
});

it("keeps the latest search results when an older search resolves later", async () => {
  const client = await mount();
  let finish!: (value: unknown) => void;
  client.listImages.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  field("image-search", "old");
  await vi.waitFor(() => expect(client.listImages).toHaveBeenCalledTimes(2));
  client.listImages.mockResolvedValue({
    images: [{ ...image, id: "new", names: { es: "Latest" } }],
    total: 1,
  });
  field("image-search", "new");
  await vi.waitFor(() => expect(el.shadowRoot!.querySelector("[data-image=new]")).not.toBeNull());
  finish({ images: [image], total: 1 });
  await new Promise((resolve) => setTimeout(resolve, 20));
  expect(el.shadowRoot!.querySelector("[data-image=one]")).toBeNull();
});

it("resets a filter when its final image and unused label disappear", async () => {
  const client = await mount();
  const label = el.shadowRoot!.querySelector<HTMLSelectElement>("select[name=image-label]")!;
  label.value = "Food";
  label.dispatchEvent(new Event("change"));
  await vi.waitFor(() => expect(client.listImages).toHaveBeenCalledTimes(2));
  click("[data-test=delete-one]");
  await vi.waitFor(() =>
    expect(el.shadowRoot!.querySelector("[data-test=confirm-delete]")).not.toBeNull(),
  );
  client.listImages.mockResolvedValue({ images: [], total: 0 });
  client.listLabels.mockResolvedValue({ labels: [] });
  click("[data-test=confirm-delete]");
  await vi.waitFor(() =>
    expect(client.listImages).toHaveBeenLastCalledWith({
      search: "",
      language: "en-GB",
      label: "",
      sort: "relevance",
      offset: 0,
      limit: 24,
    }),
  );
});

it("returns to the previous page after its final image is deleted", async () => {
  const client = api();
  client.listImages.mockResolvedValue({ images: [image], total: 25 });
  await mount(client);
  const next = [...el.shadowRoot!.querySelectorAll<HTMLElement>("nav wt-button")].at(-1)!;
  next.click();
  await vi.waitFor(() =>
    expect(client.listImages).toHaveBeenLastCalledWith(expect.objectContaining({ offset: 24 })),
  );
  click("[data-test=delete-one]");
  await vi.waitFor(() =>
    expect(el.shadowRoot!.querySelector("[data-test=confirm-delete]")).not.toBeNull(),
  );
  client.listImages
    .mockResolvedValueOnce({ images: [], total: 24 })
    .mockResolvedValue({ images: [image], total: 24 });
  click("[data-test=confirm-delete]");
  await vi.waitFor(() =>
    expect(client.listImages).toHaveBeenLastCalledWith(expect.objectContaining({ offset: 0 })),
  );
});

it("updates interface language without discarding an image draft", async () => {
  await mount();
  click("[data-test=edit-one]");
  await el.updateComplete;
  field("name-es", "Pan editado");
  await el.updateComplete;
  setLocale("es-ES");
  await el.updateComplete;
  expect(el.shadowRoot!.querySelector("[data-test=save]")!.textContent).toContain("Guardar");
  expect(
    (el.shadowRoot!.querySelector("wt-input[name=name-es]") as HTMLElement & { value: string })
      .value,
  ).toBe("Pan editado");
});

it("keeps an enclosing picker open when its metadata editor is cancelled", async () => {
  await mount(api(), true);
  const enclosingClose = vi.fn();
  el.addEventListener("wt-close", enclosingClose);
  click("[data-test=edit-one]");
  await el.updateComplete;
  el.shadowRoot!.querySelector("wt-modal")!.dispatchEvent(
    new CustomEvent("wt-close", { bubbles: true, composed: true }),
  );
  await el.updateComplete;
  expect(el.shadowRoot!.querySelector("[data-test=save]")).toBeNull();
  expect(enclosingClose).not.toHaveBeenCalled();
});

it("keeps draft translations under their languages when the default changes live", async () => {
  const client = await mount();
  click("[data-test=edit-one]");
  await el.updateComplete;
  field("name-es", "Pan editado");
  field("image-labels", "Food, Breakfast");
  setContentLanguages({ defaultLanguage: "fr", languages: ["fr", "es"] });
  await el.updateComplete;
  const french = el.shadowRoot!.querySelector("wt-input[name=name-fr]") as HTMLElement & {
    value: string;
  };
  const spanish = el.shadowRoot!.querySelector("wt-input[name=name-es]") as HTMLElement & {
    value: string;
  };
  expect(french.value).toBe("");
  expect(french.hasAttribute("required")).toBe(true);
  expect(spanish.value).toBe("Pan editado");
  expect(spanish.hasAttribute("required")).toBe(false);
  click("[data-test=save]");
  await el.updateComplete;
  expect(client.updateImage).not.toHaveBeenCalled();
  field("name-fr", "Pain");
  field("alt-fr", "Pain frais");
  await el.updateComplete;
  click("[data-test=save]");
  await vi.waitFor(() =>
    expect(client.updateImage).toHaveBeenCalledWith("one", {
      names: { es: "Pan editado", en: "Bread", fr: "Pain" },
      altText: { es: "Pan recién hecho", fr: "Pain frais" },
      labels: ["Food", "Breakfast"],
    }),
  );
});

it("links category-only image usage to its category without an inactive-product label", async () => {
  const client = api();
  client.getImage.mockResolvedValue({
    image,
    uses: [{ kind: "category", id: "food", names: { es: "Comida" } }],
  });
  await mount(client);
  click("[data-test=delete-one]");
  await vi.waitFor(() =>
    expect(
      el.shadowRoot!.querySelector('a[href="/manage/categories?category=food"]'),
    ).not.toBeNull(),
  );
  expect(
    el.shadowRoot!.querySelector('a[href="/manage/categories?category=food"]')!.textContent,
  ).toBe("Comida");
  expect(el.shadowRoot!.querySelector('[data-test="confirm-delete"]')).toBeNull();
});

it("names a section using the image by its internal name, and blocks the delete", async () => {
  const client = api();
  client.getImage.mockResolvedValue({
    image,
    uses: [{ kind: "section", id: "drinks", internalName: "Drinks (internal)" }],
  });
  await mount(client);
  click("[data-test=delete-one]");
  await vi.waitFor(() =>
    expect(el.shadowRoot!.querySelector("wt-modal li")?.textContent).toBe("Drinks (internal)"),
  );
  // No screen shows a single section, so there is nothing to link to.
  expect(el.shadowRoot!.querySelector("wt-modal li a")).toBeNull();
  expect(el.shadowRoot!.querySelector('[data-test="confirm-delete"]')).toBeNull();
});

function openDialog(): HTMLDialogElement {
  return el.shadowRoot!.querySelector("wt-modal")!.shadowRoot!.querySelector("dialog")!;
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}
function chooseFile(files: File[]) {
  const transfer = new DataTransfer();
  for (const file of files) transfer.items.add(file);
  const input = el.shadowRoot!.querySelector<HTMLInputElement>("input[name=image-file]")!;
  input.files = transfer.files;
  input.dispatchEvent(new Event("change"));
}

it("cancelling the editor discards the draft without saving it", async () => {
  const client = await mount();
  click("[data-test=edit-one]");
  await el.updateComplete;
  field("name-es", "Pan descartado");
  await el.updateComplete;
  click("wt-modal wt-button[slot=cancel]");
  await el.updateComplete;
  expect(el.shadowRoot!.querySelector("[data-test=save]")).toBeNull();
  expect(client.updateImage).not.toHaveBeenCalled();
  click("[data-test=edit-one]");
  await el.updateComplete;
  expect(
    (el.shadowRoot!.querySelector("wt-input[name=name-es]") as HTMLElement & { value: string })
      .value,
  ).toBe("Pan");
});

it("keeps the editor open through a close requested mid-save, so a refusal is still shown", async () => {
  const client = await mount();
  click("[data-test=edit-one]");
  await el.updateComplete;
  const save = deferred<never>();
  client.updateImage.mockReturnValueOnce(save.promise);
  click("[data-test=save]");
  click("wt-modal wt-button[slot=cancel]");
  await el.updateComplete;
  expect(el.shadowRoot!.querySelector("[data-test=save]")).not.toBeNull();
  save.reject({ code: "image.translation_required" });
  await vi.waitFor(() =>
    expect(el.shadowRoot!.querySelector("wt-modal [role=alert]")!.textContent).toContain(
      "could not be saved",
    ),
  );
});

it("ignores Escape while a save is in flight and honours it once the save has settled", async () => {
  const client = await mount();
  click("[data-test=edit-one]");
  await el.updateComplete;
  const save = deferred<never>();
  client.updateImage.mockReturnValueOnce(save.promise);
  click("[data-test=save]");
  await el.updateComplete;
  (el.shadowRoot!.querySelector("wt-input[name=name-es]") as HTMLElement).focus();
  await userEvent.keyboard("{Escape}");
  await el.updateComplete;
  expect(openDialog().open).toBe(true);
  save.reject({ code: "image.translation_required" });
  await vi.waitFor(() => expect(el.shadowRoot!.textContent).toContain("could not be saved"));
  (el.shadowRoot!.querySelector("wt-input[name=name-es]") as HTMLElement).focus();
  await userEvent.keyboard("{Escape}");
  await vi.waitFor(() => expect(el.shadowRoot!.querySelector("[data-test=save]")).toBeNull());
  expect(client.updateImage).toHaveBeenCalledOnce();
});

it("saves the image when Enter is pressed in a name field", async () => {
  const client = await mount();
  click("[data-test=edit-one]");
  await el.updateComplete;
  const name = el.shadowRoot!.querySelector("wt-input[name=name-es]") as HTMLElement;
  name.focus();
  await userEvent.keyboard("{Enter}");
  await vi.waitFor(() =>
    expect(client.updateImage).toHaveBeenCalledWith("one", {
      names: image.names,
      altText: image.altText,
      labels: image.labels,
    }),
  );
});

it("drops the preview and asks for a photo again when the chosen file is cleared", async () => {
  const client = await mount();
  click("[data-test=upload]");
  await el.updateComplete;
  chooseFile([new File(["photo"], "bread.jpg", { type: "image/jpeg" })]);
  field("name-es", "Pan");
  await el.updateComplete;
  expect(el.shadowRoot!.querySelector("[data-test=preview]")).not.toBeNull();
  chooseFile([]);
  await el.updateComplete;
  expect(el.shadowRoot!.querySelector("[data-test=preview]")).toBeNull();
  click("[data-test=save]");
  await el.updateComplete;
  expect(client.uploadImage).not.toHaveBeenCalled();
  expect(el.shadowRoot!.querySelector("#file-error")!.textContent).toBe(
    "Choose a photo to upload.",
  );
});

it("offers a retry after the library fails to load, and shows the images it then gets", async () => {
  const client = api();
  client.listImages.mockRejectedValueOnce(new Error("offline"));
  el = document.createElement("dashboard-image-library");
  el.api = client as unknown as ImageApi;
  document.body.append(el);
  await vi.waitFor(() =>
    expect(el.shadowRoot!.querySelector("[role=alert]")!.textContent).toContain(
      "The image library could not be loaded.",
    ),
  );
  expect(el.shadowRoot!.querySelector("[data-image=one]")).toBeNull();
  click("[role=alert] wt-button");
  await vi.waitFor(() => expect(el.shadowRoot!.querySelector("[data-image=one]")).not.toBeNull());
  expect(el.shadowRoot!.querySelector("[role=alert]")).toBeNull();
});

it("steps back to the previous page of results", async () => {
  const client = api();
  client.listImages.mockResolvedValue({ images: [image], total: 25 });
  await mount(client);
  const [previous, next] = [...el.shadowRoot!.querySelectorAll<HTMLElement>("nav wt-button")];
  next!.click();
  await vi.waitFor(() =>
    expect(el.shadowRoot!.querySelector("nav span")!.textContent!.replace(/\s+/g, " ")).toBe(
      "25–25 / 25",
    ),
  );
  previous!.click();
  await vi.waitFor(() =>
    expect(el.shadowRoot!.querySelector("nav span")!.textContent!.replace(/\s+/g, " ")).toBe(
      "1–24 / 25",
    ),
  );
  expect(client.listImages).toHaveBeenLastCalledWith(expect.objectContaining({ offset: 0 }));
});

it("dismisses the delete confirmation without deleting when Close is pressed", async () => {
  const client = await mount();
  click("[data-test=delete-one]");
  await vi.waitFor(() =>
    expect(el.shadowRoot!.querySelector("[data-test=confirm-delete]")).not.toBeNull(),
  );
  click("wt-modal wt-button[slot=cancel]");
  await el.updateComplete;
  expect(el.shadowRoot!.querySelector("wt-modal")).toBeNull();
  expect(client.deleteImage).not.toHaveBeenCalled();
  expect(el.shadowRoot!.querySelector("[data-image=one]")).not.toBeNull();
});

it("sends one delete however often confirm is pressed while it is in flight", async () => {
  const client = await mount();
  const deletion = deferred<{ deleted: boolean; uses: [] }>();
  client.deleteImage.mockReturnValueOnce(deletion.promise);
  click("[data-test=delete-one]");
  await vi.waitFor(() =>
    expect(el.shadowRoot!.querySelector("[data-test=confirm-delete]")).not.toBeNull(),
  );
  click("[data-test=confirm-delete]");
  click("[data-test=confirm-delete]");
  expect(client.deleteImage).toHaveBeenCalledOnce();
  deletion.resolve({ deleted: true, uses: [] });
  await vi.waitFor(() => expect(el.shadowRoot!.querySelector("wt-modal")).toBeNull());
});

it("ignores Escape while a delete is in flight and closes once it completes", async () => {
  const client = await mount();
  const deletion = deferred<{ deleted: boolean; uses: [] }>();
  client.deleteImage.mockReturnValueOnce(deletion.promise);
  click("[data-test=delete-one]");
  await vi.waitFor(() =>
    expect(el.shadowRoot!.querySelector("[data-test=confirm-delete]")).not.toBeNull(),
  );
  click("[data-test=confirm-delete]");
  await el.updateComplete;
  (el.shadowRoot!.querySelector("wt-modal wt-button[slot=cancel]") as HTMLElement).focus();
  await userEvent.keyboard("{Escape}");
  await el.updateComplete;
  expect(openDialog().open).toBe(true);
  expect(el.shadowRoot!.querySelector("[data-test=confirm-delete]")).not.toBeNull();
  deletion.resolve({ deleted: true, uses: [] });
  await vi.waitFor(() => expect(el.shadowRoot!.querySelector("wt-modal")).toBeNull());
});

it("reports a failed usage lookup instead of opening the delete confirmation", async () => {
  const client = api();
  client.getImage.mockRejectedValueOnce(new Error("offline"));
  await mount(client);
  click("[data-test=delete-one]");
  await vi.waitFor(() =>
    expect(el.shadowRoot!.querySelector("[role=alert]")!.textContent).toBe(
      "The image could not be deleted.",
    ),
  );
  expect(el.shadowRoot!.querySelector("wt-modal")).toBeNull();
  expect(client.deleteImage).not.toHaveBeenCalled();
});

it("confirms the image asked about last when an earlier usage lookup fails late", async () => {
  const client = api();
  const two = { ...image, id: "two", names: { es: "Tostada" } };
  client.listImages.mockResolvedValue({ images: [image, two], total: 2 });
  const first = deferred<never>();
  client.getImage
    .mockReturnValueOnce(first.promise)
    .mockResolvedValueOnce({ image: two, uses: [] });
  await mount(client);
  click("[data-test=delete-one]");
  click("[data-test=delete-two]");
  await vi.waitFor(() =>
    expect(el.shadowRoot!.querySelector("[data-test=confirm-delete]")).not.toBeNull(),
  );
  first.reject(new Error("slow failure"));
  await new Promise((resolve) => setTimeout(resolve, 20));
  await el.updateComplete;
  expect(el.shadowRoot!.querySelector("wt-modal")!.textContent).toContain("Tostada");
  expect(el.shadowRoot!.querySelector("[role=alert]")).toBeNull();
  expect(el.shadowRoot!.querySelector("[data-test=confirm-delete]")).not.toBeNull();
});

it("marks an inactive product among an image's blocking uses", async () => {
  const client = api();
  client.getImage.mockResolvedValue({
    image: { ...image, usageCount: 2 },
    uses: [
      { kind: "product", id: "toast", catalogueId: "menu", name: "Toast", active: true },
      { kind: "product", id: "old", catalogueId: "menu", name: "Old toast", active: false },
    ],
  });
  await mount(client);
  click("[data-test=delete-one]");
  await vi.waitFor(() => expect(el.shadowRoot!.querySelectorAll("wt-modal li")).toHaveLength(2));
  expect(
    [...el.shadowRoot!.querySelectorAll("wt-modal li a")].map((link) => link.textContent),
  ).toEqual(["Toast", "Old toast (Inactive product)"]);
});

it("confirms the image asked about last when an earlier usage lookup answers late", async () => {
  const client = api();
  const two = { ...image, id: "two", names: { es: "Tostada" } };
  client.listImages.mockResolvedValue({ images: [image, two], total: 2 });
  const first = deferred<{ image: LibraryImage; uses: [] }>();
  client.getImage
    .mockReturnValueOnce(first.promise)
    .mockResolvedValueOnce({ image: two, uses: [] });
  await mount(client);
  click("[data-test=delete-one]");
  click("[data-test=delete-two]");
  await vi.waitFor(() =>
    expect(el.shadowRoot!.querySelector("wt-modal")!.textContent).toContain("Tostada"),
  );
  first.resolve({ image, uses: [] });
  await new Promise((resolve) => setTimeout(resolve, 20));
  await el.updateComplete;
  expect(el.shadowRoot!.querySelector("wt-modal")!.textContent).toContain("Tostada");
  client.listImages.mockResolvedValue({ images: [image], total: 1 });
  click("[data-test=confirm-delete]");
  await vi.waitFor(() => expect(client.deleteImage).toHaveBeenCalledOnce());
  expect(client.deleteImage).toHaveBeenCalledWith("two");
});

it("dismisses an idle delete confirmation with Escape, without deleting", async () => {
  const client = await mount();
  click("[data-test=delete-one]");
  await vi.waitFor(() =>
    expect(el.shadowRoot!.querySelector("[data-test=confirm-delete]")).not.toBeNull(),
  );
  (el.shadowRoot!.querySelector("wt-modal wt-button[slot=cancel]") as HTMLElement).focus();
  await userEvent.keyboard("{Escape}");
  await vi.waitFor(() => expect(el.shadowRoot!.querySelector("wt-modal")).toBeNull());
  expect(client.deleteImage).not.toHaveBeenCalled();
});
