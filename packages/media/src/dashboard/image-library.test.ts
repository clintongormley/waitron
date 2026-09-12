import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { setContentLanguages } from "@waitron/ui";
import { setLocale, LiveData, type DashboardRequest } from "@waitron/dashboard-kit";
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

it("requires file and default-language name and alt text, keeping optional translations optional", async () => {
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
  expect(el.shadowRoot!.querySelector("wt-input[name=alt-es]")!.getAttribute("error")).toBeTruthy();
  expect(el.shadowRoot!.querySelector("wt-input[name=name-fr]")!.hasAttribute("required")).toBe(
    false,
  );
  const transfer = new DataTransfer();
  transfer.items.add(new File(["photo"], "bread.jpg", { type: "image/jpeg" }));
  const file = el.shadowRoot!.querySelector<HTMLInputElement>("input[name=image-file]")!;
  file.files = transfer.files;
  file.dispatchEvent(new Event("change"));
  field("name-es", "Pan");
  field("alt-es", "Pan recién hecho");
  field("image-labels", "Food, Summer menu");
  await el.updateComplete;
  click("[data-test=save]");
  await vi.waitFor(() => expect(client.uploadImage).toHaveBeenCalledOnce());
  expect(client.uploadImage.mock.calls[0]![1]).toEqual({
    names: { es: "Pan" },
    altText: { es: "Pan recién hecho" },
    labels: ["Food", "Summer menu"],
  });
  await vi.waitFor(() => expect(el.shadowRoot!.querySelector("[data-test=save]")).toBeNull());
  expect(el.shadowRoot!.querySelector("[data-test=duplicate-upload]")).toBeNull();
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
        names: { es: "Breakfast" },
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

it("handles a new use between confirmation and deletion", async () => {
  const client = api();
  client.deleteImage.mockResolvedValue({
    deleted: false,
    uses: [{ kind: "product", id: "p", catalogueId: "menu", names: { es: "Toast" }, active: true }],
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
