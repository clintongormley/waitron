import { afterEach, beforeEach, expect, it, onTestFinished, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import { applyTokens, setContentLanguages } from "@waitron/ui";
import { chooseOption, formMessageOf } from "@waitron/ui/src/test-helpers.js";
import { codeMessage, setLocale, LiveData, type DashboardRequest } from "@waitron/dashboard-kit";
import "./image-library.js";
import type { ImageLibrary } from "./image-library.js";
import { ImageApi, type ImageUsage, type LibraryImage } from "./client.js";
import { MEDIA_STRINGS } from "./strings.js";

const image: LibraryImage = {
  id: "one",
  filename: "one.jpg",
  names: { es: "Pan", en: "Bread" },
  createdAt: "2026-09-12T12:00:00Z",
  updatedAt: "2026-09-12T12:00:00Z",
  usageCount: 0,
};
let el: ImageLibrary;
function api() {
  return {
    listImages: vi.fn().mockResolvedValue({ images: [image], total: 1 }),
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
async function bottomOf(): Promise<string> {
  const actions = el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-form-actions"]>(
    "wt-modal wt-form-actions",
  )!;
  return (await formMessageOf(actions))?.textContent?.trim() ?? "";
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

it("gives each thumbnail the photo's name in the viewer's language as its alt text", async () => {
  setContentLanguages({ defaultLanguage: "es", languages: ["es", "en"] });
  await mount();
  expect(el.shadowRoot!.querySelector<HTMLImageElement>("[data-image=one] img")!.alt).toBe("Bread");
});

it("falls back to the default-language name for a thumbnail's alt text when the viewer's language is disabled for content", async () => {
  await mount();
  expect(el.shadowRoot!.querySelector("[data-image=one] h2")!.textContent).toBe("Pan");
  expect(el.shadowRoot!.querySelector<HTMLImageElement>("[data-image=one] img")!.alt).toBe("Pan");
});

it("offers no label filter, no labels field and no alt-text field", async () => {
  await mount();
  expect(el.shadowRoot!.querySelector("[name=image-label]")).toBeNull();
  expect(
    [...el.shadowRoot!.querySelectorAll(".filters wt-combobox, .filters select")].map((field) =>
      field.getAttribute("name"),
    ),
  ).toEqual(["image-sort"]);
  click("[data-test=edit-one]");
  await el.updateComplete;
  expect(el.shadowRoot!.querySelector("wt-input[name=name-es]")).not.toBeNull();
  expect(el.shadowRoot!.querySelector("[name=image-labels]")).toBeNull();
  expect(el.shadowRoot!.querySelector("[name^=alt-]")).toBeNull();
});

for (const { locale, edit, remove, use } of [
  { locale: "en-GB", edit: "Edit", remove: "Delete", use: "Use image" },
  { locale: "es-ES", edit: "Editar", remove: "Eliminar", use: "Usar imagen" },
]) {
  it(`labels each card's actions briefly and names the image in each one's accessible name (${locale})`, async () => {
    setLocale(locale);
    const client = api();
    const toast = { ...image, id: "two", names: { es: "Tostada", en: "Toast" } };
    client.listImages.mockResolvedValue({ images: [image, toast], total: 2 });
    await mount(client, true);
    await vi.waitFor(() => expect(el.shadowRoot!.querySelectorAll("article")).toHaveLength(2));
    for (const [id, name] of [
      ["one", "Pan"],
      ["two", "Tostada"],
    ]) {
      for (const [test, label] of [
        [`edit-${id}`, edit],
        [`delete-${id}`, remove],
        [`select-${id}`, use],
      ]) {
        const button = el.shadowRoot!.querySelector(`[data-test=${test}]`)!;
        expect(button.textContent!.trim()).toBe(label);
        expect(
          page.getByRole("button", { name: `${label}: ${name}`, exact: true }).query(),
          `a button named "${label}: ${name}"`,
        ).not.toBeNull();
      }
    }
  });
}

it("asks the server to sort names in the displayed content language", async () => {
  setContentLanguages({ defaultLanguage: "es", languages: ["es", "en"] });
  const zebra = { ...image, names: { es: "Cebra", en: "Zebra" } };
  const apple = { ...image, id: "two", names: { es: "Manzana", en: "Apple" } };
  const request = vi.fn().mockImplementation(async (path: string) => {
    const language = new URL(path, location.origin).searchParams.get("language") ?? "es";
    return { images: language.startsWith("en") ? [apple, zebra] : [zebra, apple], total: 2 };
  });
  el = document.createElement("dashboard-image-library");
  el.api = new ImageApi(request as DashboardRequest);
  document.body.append(el);
  await el.updateComplete;
  await chooseOption(el.shadowRoot!.querySelector("wt-combobox[name=image-sort]")!, "name");
  await vi.waitFor(() => expect(el.shadowRoot!.querySelectorAll("article")).toHaveLength(2));
  expect(
    [...el.shadowRoot!.querySelectorAll("article h2")].map((heading) => heading.textContent),
  ).toEqual(["Apple", "Zebra"]);
  const query = new URL(request.mock.calls.at(-1)![0], location.origin);
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
  field("name-fr", "Brouillon");
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
    (el.shadowRoot!.querySelector("wt-input[name=name-fr]") as HTMLElement & { value: string })
      .value,
  ).toBe("Brouillon");
});

// `countUsages` (packages/media/src/images.ts) counts a live or queued version's photos, and an
// include folder's, from these.
it.each([
  "menu_publications",
  "menu_version_images",
  "menu_scheduled_publications",
  "section_members",
])("refreshes the library passively when %s changes", async (type) => {
  const liveData = new LiveData();
  const background = api();
  const client = Object.assign(api(), { background, liveData });
  await mount(client);
  liveData.invalidate([{ type }]);
  await vi.waitFor(() => expect(background.listImages).toHaveBeenCalledOnce());
});

// The library's live read (listImages) names neither; only the delete dialog's one-off
// getImage does, and it is not refreshed live.
it.each(["menu_versions", "catalogues"])(
  "does not refresh the library when %s changes",
  async (type) => {
    const liveData = new LiveData();
    const background = api();
    const client = Object.assign(api(), { background, liveData });
    await mount(client);
    liveData.invalidate([{ type }]);
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(background.listImages).not.toHaveBeenCalled();
  },
);
afterEach(() => {
  el?.remove();
});

it("requires file and default-language name", async () => {
  const client = await mount();
  click("[data-test=upload]");
  await el.updateComplete;
  field("name-fr", "Pain");
  await el.updateComplete;
  click("[data-test=save]");
  await el.updateComplete;
  expect(client.uploadImage).not.toHaveBeenCalled();
  expect(await bottomOf()).toBe("Correct the highlighted fields to continue.");
  expect(
    el.shadowRoot!.querySelector("wt-input[name=name-es]")!.getAttribute("error"),
  ).toBeTruthy();
  expect(el.shadowRoot!.querySelector("wt-input[name=name-fr]")!.hasAttribute("required")).toBe(
    false,
  );
  click("wt-modal wt-button[slot=cancel]");
  await el.updateComplete;
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
  await vi.waitFor(() => expect(client.uploadImage).toHaveBeenCalledOnce());
  expect(client.uploadImage.mock.calls[0]![1]).toEqual({ names: { es: "Pan" } });
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
  await el.updateComplete;
  click("[data-test=save]");
  await vi.waitFor(() =>
    expect(el.shadowRoot!.querySelector("[data-test=duplicate-upload]")).not.toBeNull(),
  );
  const notice = el.shadowRoot!.querySelector("[data-test=duplicate-upload]")!;
  expect(notice.getAttribute("role")).toBe("status");
  expect(notice.textContent).toContain("Pan");
  expect(notice.textContent).toContain("Its name is unchanged.");
  expect(client.updateImage).not.toHaveBeenCalled();
  expect(el.shadowRoot!.querySelectorAll("[data-image=one]")).toHaveLength(1);
  click("[data-test=edit-duplicate]");
  await el.updateComplete;
  expect(
    (el.shadowRoot!.querySelector("wt-input[name=name-es]") as HTMLElement & { value: string })
      .value,
  ).toBe("Pan");
});

type SortField = HTMLElement & {
  label: string;
  value: string;
  search: string;
  options: { value: string; label: string }[];
};

const ES = MEDIA_STRINGS.es;
it.each([
  {
    locale: "en-GB",
    sortLabel: "Sort by",
    sorts: ["Relevance", "Date", "Name"],
    orderLabel: "Order",
    dates: ["Oldest first", "Newest first"],
    names: ["A–Z", "Z–A"],
  },
  {
    locale: "es",
    sortLabel: ES["image.sort"],
    sorts: [ES["image.relevance"], ES["image.date"], ES["image.name_sort"]],
    orderLabel: ES["image.direction"],
    dates: [ES["image.oldest_first"], ES["image.newest_first"]],
    names: [ES["image.name_ascending"], ES["image.name_descending"]],
  },
])(
  "draws the sort and its order as the shared dropdown, each showing the current choice ($locale)",
  async ({ locale, sortLabel, sorts, orderLabel, dates, names }) => {
    setLocale(locale);
    await mount();
    const sort = el.shadowRoot!.querySelector<SortField>("wt-combobox[name=image-sort]")!;
    expect(sort).not.toBeNull();
    expect(sort.label).toBe(sortLabel);
    expect(sort.search).toBe("auto");
    expect(sort.options).toEqual([
      { value: "relevance", label: sorts[0] },
      { value: "date", label: sorts[1] },
      { value: "name", label: sorts[2] },
    ]);
    expect(sort.value).toBe("relevance");
    await chooseOption(sort, "date");
    await el.updateComplete;
    const order = el.shadowRoot!.querySelector<SortField>("wt-combobox[name=image-direction]")!;
    expect(order.label).toBe(orderLabel);
    expect(order.search).toBe("auto");
    expect(order.options).toEqual([
      { value: "asc", label: dates[0] },
      { value: "desc", label: dates[1] },
    ]);
    expect(order.value).toBe("desc");
    await chooseOption(sort, "name");
    await el.updateComplete;
    expect(order.options.map((option) => option.label)).toEqual(names);
    expect(order.value).toBe("asc");
  },
);

it("keeps a sort or order change inside the library", async () => {
  await mount();
  const heard = vi.fn();
  document.addEventListener("wt-change", heard);
  try {
    await chooseOption(el.shadowRoot!.querySelector("wt-combobox[name=image-sort]")!, "date");
    await el.updateComplete;
    await chooseOption(el.shadowRoot!.querySelector("wt-combobox[name=image-direction]")!, "asc");
  } finally {
    document.removeEventListener("wt-change", heard);
  }
  expect(heard).not.toHaveBeenCalled();
});

/** Opens a dropdown's list and clicks the row it already shows, as a person can, and returns
 * how many `wt-change` events the dropdown sent. */
async function clickChosenRow(box: HTMLElement): Promise<number> {
  const sent = vi.fn();
  box.addEventListener("wt-change", sent);
  // The field's label lies over the trigger's centre and hands its click on to the trigger.
  await userEvent.click(box.shadowRoot!.querySelector<HTMLElement>(".trigger")!, { force: true });
  const row = box.shadowRoot!.querySelector<HTMLElement>('[role="option"][aria-selected="true"]');
  expect(row).not.toBeNull();
  await userEvent.click(row!);
  box.removeEventListener("wt-change", sent);
  return sent.mock.calls.length;
}

it("asks the server nothing, and keeps the order, when the sort already shown is chosen again", async () => {
  const client = await mount();
  const sort = el.shadowRoot!.querySelector<SortField>("wt-combobox[name=image-sort]")!;
  await chooseOption(sort, "date");
  await el.updateComplete;
  const order = el.shadowRoot!.querySelector<SortField>("wt-combobox[name=image-direction]")!;
  await chooseOption(order, "asc");
  await vi.waitFor(() =>
    expect(client.listImages).toHaveBeenLastCalledWith(
      expect.objectContaining({ sort: "date", direction: "asc" }),
    ),
  );
  const before = client.listImages.mock.calls.length;
  expect(await clickChosenRow(sort)).toBe(1);
  await el.updateComplete;
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(client.listImages).toHaveBeenCalledTimes(before);
  expect(order.value).toBe("asc");
});

it("asks the server nothing when the order already shown is chosen again", async () => {
  const client = await mount();
  await chooseOption(el.shadowRoot!.querySelector("wt-combobox[name=image-sort]")!, "date");
  await el.updateComplete;
  await vi.waitFor(() =>
    expect(client.listImages).toHaveBeenLastCalledWith(
      expect.objectContaining({ sort: "date", direction: "desc" }),
    ),
  );
  const before = client.listImages.mock.calls.length;
  const order = el.shadowRoot!.querySelector<SortField>("wt-combobox[name=image-direction]")!;
  expect(await clickChosenRow(order)).toBe(1);
  await el.updateComplete;
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(client.listImages).toHaveBeenCalledTimes(before);
});

it("sends search and sort to the server", async () => {
  const client = await mount();
  field("image-search", "summer bread");
  await el.updateComplete;
  await chooseOption(el.shadowRoot!.querySelector("wt-combobox[name=image-sort]")!, "name");
  await vi.waitFor(() =>
    expect(client.listImages).toHaveBeenLastCalledWith({
      search: "summer bread",
      language: "en-GB",
      sort: "name",
      direction: "asc",
      offset: 0,
      limit: 24,
    }),
  );
});

it("searches once typing has paused for 250 ms, so a burst of keystrokes sends one request", async () => {
  const client = await mount();
  const before = client.listImages.mock.calls.length;
  vi.useFakeTimers();
  try {
    // A wait timed from the first keystroke would fire at 250 ms, before the 449 ms check.
    field("image-search", "c");
    await vi.advanceTimersByTimeAsync(100);
    field("image-search", "ch");
    await vi.advanceTimersByTimeAsync(100);
    field("image-search", "chi");
    await vi.advanceTimersByTimeAsync(249);
    expect(client.listImages).toHaveBeenCalledTimes(before);
    await vi.advanceTimersByTimeAsync(1);
    expect(client.listImages).toHaveBeenCalledTimes(before + 1);
    expect(client.listImages).toHaveBeenLastCalledWith(
      expect.objectContaining({ search: "chi", offset: 0 }),
    );
  } finally {
    vi.useRealTimers();
  }
});

it("changes the sort at once, with text typed but not yet searched, and does not search it again", async () => {
  const client = await mount();
  const before = client.listImages.mock.calls.length;
  vi.useFakeTimers();
  try {
    field("image-search", "chi");
    await chooseOption(el.shadowRoot!.querySelector("wt-combobox[name=image-sort]")!, "name");
    await vi.advanceTimersByTimeAsync(0);
    expect(client.listImages).toHaveBeenCalledTimes(before + 1);
    expect(client.listImages).toHaveBeenLastCalledWith(
      expect.objectContaining({ search: "chi", sort: "name" }),
    );
    await vi.advanceTimersByTimeAsync(1000);
    expect(client.listImages).toHaveBeenCalledTimes(before + 1);
  } finally {
    vi.useRealTimers();
  }
});

it("starts a search still waiting from the first page when another load sends it early", async () => {
  const client = api();
  client.listImages.mockResolvedValue({ images: [image], total: 100 });
  await mount(client);
  const next = [...el.shadowRoot!.querySelectorAll<HTMLElement>("nav wt-button")].at(-1)!;
  next.click();
  await vi.waitFor(() =>
    expect(client.listImages).toHaveBeenLastCalledWith(expect.objectContaining({ offset: 24 })),
  );
  await el.updateComplete;
  const before = client.listImages.mock.calls.length;
  vi.useFakeTimers();
  try {
    field("image-search", "chi");
    await vi.advanceTimersByTimeAsync(100);
    next.click();
    await vi.advanceTimersByTimeAsync(0);
    expect(client.listImages).toHaveBeenCalledTimes(before + 1);
    expect(client.listImages).toHaveBeenLastCalledWith(
      expect.objectContaining({ search: "chi", offset: 0 }),
    );
    await vi.advanceTimersByTimeAsync(1000);
    expect(client.listImages).toHaveBeenCalledTimes(before + 1);
  } finally {
    vi.useRealTimers();
  }
});

it("drops a search still waiting when the library is removed", async () => {
  const client = await mount();
  const before = client.listImages.mock.calls.length;
  vi.useFakeTimers();
  try {
    field("image-search", "chi");
    el.remove();
    await vi.advanceTimersByTimeAsync(1000);
    expect(client.listImages).toHaveBeenCalledTimes(before);
  } finally {
    vi.useRealTimers();
  }
});

it.each([
  { sort: "date", initial: "desc", reverse: "asc", picker: false },
  { sort: "name", initial: "asc", reverse: "desc", picker: true },
])(
  "offers both $sort directions and keeps relevance ranked in the picker=$picker library",
  async ({ sort, initial, reverse, picker }) => {
    const client = await mount(api(), picker);
    expect(el.shadowRoot!.querySelector("[name=image-direction]")).toBeNull();
    const sorting = el.shadowRoot!.querySelector<HTMLElement>("wt-combobox[name=image-sort]")!;
    await chooseOption(sorting, sort);
    await el.updateComplete;
    const direction = el.shadowRoot!.querySelector<HTMLElement & { value: string }>(
      "wt-combobox[name=image-direction]",
    )!;
    expect(direction).not.toBeNull();
    expect(direction.value).toBe(initial);
    await vi.waitFor(() =>
      expect(client.listImages).toHaveBeenLastCalledWith(
        expect.objectContaining({ sort, direction: initial, offset: 0 }),
      ),
    );
    await chooseOption(direction, reverse);
    await vi.waitFor(() =>
      expect(client.listImages).toHaveBeenLastCalledWith(
        expect.objectContaining({ sort, direction: reverse, offset: 0 }),
      ),
    );
    await chooseOption(sorting, "relevance");
    await el.updateComplete;
    expect(el.shadowRoot!.querySelector("[name=image-direction]")).toBeNull();
    await vi.waitFor(() =>
      expect(client.listImages).toHaveBeenLastCalledWith({
        search: "",
        language: "en-GB",
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
  field("name-es", "Pan editado");
  await el.updateComplete;
  click("[data-test=save]");
  click("[data-test=save]");
  expect(client.updateImage).toHaveBeenCalledOnce();
  reject({ code: "image.invalid_metadata" });
  await vi.waitFor(async () => expect(await bottomOf()).toContain("could not be saved"));
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
    expect(el.shadowRoot!.querySelector("#file-error")?.textContent).toContain(
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

it("deletes unused images only after confirmation", async () => {
  const client = await mount();
  click("[data-test=delete-one]");
  await vi.waitFor(() =>
    expect(el.shadowRoot!.querySelector("[data-test=confirm-delete]")).not.toBeNull(),
  );
  expect(client.deleteImage).not.toHaveBeenCalled();
  client.listImages.mockResolvedValue({ images: [], total: 0 });
  click("[data-test=confirm-delete]");
  await vi.waitFor(() => expect(el.shadowRoot!.querySelector("[data-image=one]")).toBeNull());
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
  const dialog = el.shadowRoot!.querySelector("wt-modal")!;
  const actions = dialog.querySelector("wt-form-actions")!;
  await vi.waitFor(async () =>
    expect((await formMessageOf(actions))?.textContent).toBe("The image could not be deleted."),
  );
  const message = await formMessageOf(actions);
  expect(dialog.shadowRoot!.querySelector(".body")!.contains(message)).toBe(true);
  expect(actions.shadowRoot!.querySelector("[data-error]")).toBeNull();
  expect(dialog.textContent).not.toContain("could not be deleted");
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
  await el.updateComplete;
  click("[data-test=save]");
  await vi.waitFor(() =>
    expect(client.updateImage).toHaveBeenCalledWith("one", {
      names: { es: "Pan editado", en: "Bread", fr: "Pain" },
    }),
  );
});

it("links a section using the image by its internal name to its editor, and blocks the delete", async () => {
  const client = api();
  client.getImage.mockResolvedValue({
    image,
    uses: [
      {
        kind: "section",
        id: "drinks",
        internalName: "Drinks (internal)",
        ownerMenuId: "drinks-menu",
      },
    ],
  });
  await mount(client);
  click("[data-test=delete-one]");
  await vi.waitFor(() =>
    expect(el.shadowRoot!.querySelector("wt-modal li")?.textContent).toBe("Drinks (internal)"),
  );
  expect(el.shadowRoot!.querySelector("wt-modal li a")!.getAttribute("href")).toBe(
    "/manage/menus/menu/drinks-menu/view/structure",
  );
  expect(el.shadowRoot!.querySelector('[data-test="confirm-delete"]')).toBeNull();
});

it("links a live menu version using the image to its menu, and blocks the delete", async () => {
  const client = api();
  client.getImage.mockResolvedValue({
    image,
    uses: [
      { kind: "menu_version", id: "version-1", menuId: "lunch", menuName: "Lunch Menu", number: 3 },
    ],
  });
  await mount(client);
  click("[data-test=delete-one]");
  await vi.waitFor(() =>
    expect(el.shadowRoot!.querySelector("wt-modal li")?.textContent).toBe(
      "Lunch Menu (Published menu)",
    ),
  );
  expect(el.shadowRoot!.querySelector("wt-modal li a")!.getAttribute("href")).toBe(
    "/manage/menus/menu/lunch",
  );
  expect(el.shadowRoot!.querySelector('[data-test="confirm-delete"]')).toBeNull();
});

for (const [locale, label] of [
  ["en-GB", "Lunch Menu (Scheduled menu)"],
  ["es-ES", "Lunch Menu (Carta programada)"],
]) {
  it(`links a queued menu edition using the image to its menu, and blocks the delete (${locale})`, async () => {
    setLocale(locale);
    const client = api();
    client.getImage.mockResolvedValue({
      image,
      uses: [
        {
          kind: "scheduled_menu_version",
          id: "version-2",
          menuId: "lunch",
          menuName: "Lunch Menu",
          number: 2,
          activatesAt: "2026-10-08T07:00:00.000Z",
        },
      ],
    });
    await mount(client);
    click("[data-test=delete-one]");
    await vi.waitFor(() =>
      expect(el.shadowRoot!.querySelector("wt-modal li")?.textContent).toBe(label),
    );
    expect(el.shadowRoot!.querySelector("wt-modal li a")!.getAttribute("href")).toBe(
      "/manage/menus/menu/lunch",
    );
    expect(el.shadowRoot!.querySelector('[data-test="confirm-delete"]')).toBeNull();
  });
}

for (const [locale, label] of [
  ["en-GB", "Drinks folder in Lunch Menu"],
  ["es-ES", "Carpeta Drinks en Lunch Menu"],
]) {
  it(`links an include's folder using the image to its menu's structure, and blocks the delete (${locale})`, async () => {
    setLocale(locale);
    const client = api();
    client.getImage.mockResolvedValue({
      image,
      uses: [
        {
          kind: "menu_include",
          id: "member-1",
          menuId: "lunch",
          menuName: "Lunch Menu",
          includedMenuName: "Drinks",
        },
      ],
    });
    await mount(client);
    click("[data-test=delete-one]");
    await vi.waitFor(() =>
      expect(el.shadowRoot!.querySelector("wt-modal li")?.textContent).toBe(label),
    );
    expect(el.shadowRoot!.querySelector("wt-modal li a")!.getAttribute("href")).toBe(
      "/manage/menus/menu/lunch/view/structure",
    );
    expect(el.shadowRoot!.querySelector('[data-test="confirm-delete"]')).toBeNull();
  });
}

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
  field("name-es", "Pan editado");
  await el.updateComplete;
  click("[data-test=save]");
  click("wt-modal wt-button[slot=cancel]");
  await el.updateComplete;
  expect(el.shadowRoot!.querySelector("[data-test=save]")).not.toBeNull();
  save.reject({ code: "image.invalid_metadata" });
  await vi.waitFor(async () => expect(await bottomOf()).toContain("could not be saved"));
});

it("ignores Escape while a save is in flight and honours it once the save has settled", async () => {
  const client = await mount();
  click("[data-test=edit-one]");
  await el.updateComplete;
  const save = deferred<never>();
  client.updateImage.mockReturnValueOnce(save.promise);
  field("name-es", "Pan editado");
  await el.updateComplete;
  click("[data-test=save]");
  await el.updateComplete;
  (el.shadowRoot!.querySelector("wt-input[name=name-es]") as HTMLElement).focus();
  await userEvent.keyboard("{Escape}");
  await el.updateComplete;
  expect(openDialog().open).toBe(true);
  save.reject({ code: "image.invalid_metadata" });
  await vi.waitFor(async () => expect(await bottomOf()).toContain("could not be saved"));
  (el.shadowRoot!.querySelector("wt-input[name=name-es]") as HTMLElement).focus();
  await userEvent.keyboard("{Escape}");
  await vi.waitFor(() => expect(el.shadowRoot!.querySelector("[data-test=save]")).toBeNull());
  expect(client.updateImage).toHaveBeenCalledOnce();
});

it("saves the image when Enter is pressed in a name field", async () => {
  const client = await mount();
  click("[data-test=edit-one]");
  await el.updateComplete;
  field("name-es", "Pan editado");
  await el.updateComplete;
  const name = el.shadowRoot!.querySelector("wt-input[name=name-es]") as HTMLElement;
  name.focus();
  await userEvent.keyboard("{Enter}");
  await vi.waitFor(() =>
    expect(client.updateImage).toHaveBeenCalledWith("one", {
      names: { es: "Pan editado", en: "Bread" },
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

it.each([
  ["en-GB", "Old toast (Disabled product)"],
  ["es-ES", "Old toast (Producto deshabilitado)"],
])("in %s, marks a disabled product among an image's blocking uses", async (locale, marked) => {
  setLocale(locale);
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
  ).toEqual(["Toast", marked]);
});

it.each([
  ["en-GB", "Receipt logo"],
  ["es-ES", "Logotipo del recibo"],
])(
  "in %s, links the receipt using the image as its logo to the Receipts screen, and blocks the delete",
  async (locale, label) => {
    setLocale(locale);
    const client = api();
    client.getImage.mockResolvedValue({
      image: { ...image, usageCount: 1 },
      uses: [{ kind: "receipt" }],
    });
    await mount(client);
    click("[data-test=delete-one]");
    await vi.waitFor(() =>
      expect(el.shadowRoot!.querySelector("wt-modal li")?.textContent).toBe(label),
    );
    expect(el.shadowRoot!.querySelector("wt-modal li a")!.getAttribute("href")).toBe(
      "/manage/venue-settings/view/receipts",
    );
    expect(el.shadowRoot!.querySelector('[data-test="confirm-delete"]')).toBeNull();
  },
);

// `countUsages` (packages/media/src/images.ts) counts the receipt's logo from this table.
it("refreshes the library passively when tenant_receipts changes", async () => {
  const liveData = new LiveData();
  const background = api();
  const client = Object.assign(api(), { background, liveData });
  await mount(client);
  liveData.invalidate([{ type: "tenant_receipts" }]);
  await vi.waitFor(() => expect(background.listImages).toHaveBeenCalledOnce());
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

const saveButton = () => el.shadowRoot!.querySelector<HTMLElement>("[data-test=save]")!;
const nameInput = (language: string) =>
  el.shadowRoot!.querySelector<HTMLElement & { error: string; value: string }>(
    `wt-input[name=name-${language}]`,
  )!;
const fileInput = () => el.shadowRoot!.querySelector<HTMLInputElement>("input[name=image-file]")!;
const fileError = () => el.shadowRoot!.querySelector("#file-error")?.textContent?.trim() ?? "";
const FIX_FIELDS = "Correct the highlighted fields to continue.";
const photo = () => new File(["photo"], "bread.jpg", { type: "image/jpeg" });

it("says nothing about errors before the first submission, and Save works", async () => {
  await mount();
  click("[data-test=upload]");
  await el.updateComplete;
  field("name-fr", "Pain");
  await el.updateComplete;

  expect(fileError()).toBe("");
  expect(fileInput().getAttribute("aria-invalid")).toBe("false");
  expect(nameInput("es").error).toBe("");
  expect(await bottomOf()).toBe("");
  expect(saveButton().hasAttribute("disabled")).toBe(false);
});

it("on an invalid submission shows the field and bottom messages, focuses the photo and disables Save", async () => {
  const client = await mount();
  click("[data-test=upload]");
  await el.updateComplete;
  field("name-fr", "Pain");
  await el.updateComplete;
  click("[data-test=save]");
  await el.updateComplete;

  expect(client.uploadImage).not.toHaveBeenCalled();
  expect(fileError()).toBe("Choose a photo to upload.");
  expect(fileInput().getAttribute("aria-invalid")).toBe("true");
  expect(nameInput("es").error).toBe("This field is required.");
  expect(await bottomOf()).toBe(FIX_FIELDS);
  expect(saveButton().hasAttribute("disabled")).toBe(true);
  expect(nameInput("fr").value).toBe("Pain");
  await vi.waitFor(() => expect(el.shadowRoot!.activeElement).toBe(fileInput()));
  expect(el.shadowRoot!.querySelector("wt-form-error-summary")).toBeNull();

  setLocale("es-ES");
  await el.updateComplete;
  expect(await bottomOf()).toBe("Corrige los campos marcados para continuar.");
});

it("focuses the default-language name when an edit is saved without one", async () => {
  await mount();
  click("[data-test=edit-one]");
  await el.updateComplete;
  field("name-es", " ");
  await el.updateComplete;
  click("[data-test=save]");

  await vi.waitFor(() =>
    expect(nameInput("es").shadowRoot!.activeElement).toBe(
      nameInput("es").shadowRoot!.querySelector("input"),
    ),
  );
  expect(nameInput("es").error).toBe("This field is required.");
});

it("re-checks every change after a failed submission, and Save works again once fixed", async () => {
  await mount();
  click("[data-test=upload]");
  await el.updateComplete;
  field("name-fr", "Pain");
  await el.updateComplete;
  click("[data-test=save]");
  await el.updateComplete;

  chooseFile([photo()]);
  await el.updateComplete;
  expect(fileError()).toBe("");
  expect(await bottomOf()).toBe(FIX_FIELDS);
  expect(saveButton().hasAttribute("disabled")).toBe(true);

  field("name-es", "Pan");
  await el.updateComplete;
  expect(nameInput("es").error).toBe("");
  expect(await bottomOf()).toBe("");
  expect(saveButton().hasAttribute("disabled")).toBe(false);

  field("name-es", " ");
  await el.updateComplete;
  expect(nameInput("es").error).toBe("This field is required.");
  expect(await bottomOf()).toBe(FIX_FIELDS);
  expect(saveButton().hasAttribute("disabled")).toBe(true);
});

it.each([
  "image.too_large",
  "image.invalid_file",
  "image.too_many_pixels",
  "media.unsupported_type",
])(
  "puts a refused %s under the photo until another photo is chosen, and leaves Save working",
  async (code) => {
    const client = api();
    client.uploadImage.mockRejectedValueOnce({ code, params: {}, status: 400 });
    await mount(client);
    click("[data-test=upload]");
    await el.updateComplete;
    chooseFile([photo()]);
    field("name-es", "Pan");
    await el.updateComplete;
    click("[data-test=save]");

    await vi.waitFor(() => expect(fileError()).toBe(codeMessage(code)));
    expect(fileInput().getAttribute("aria-invalid")).toBe("true");
    expect(await bottomOf()).toBe(FIX_FIELDS);
    expect(saveButton().hasAttribute("disabled")).toBe(false);
    await vi.waitFor(() => expect(el.shadowRoot!.activeElement).toBe(fileInput()));

    field("name-es", "Pan blanco");
    await el.updateComplete;
    expect(fileError()).toBe(codeMessage(code));
    expect(saveButton().hasAttribute("disabled")).toBe(false);

    chooseFile([new File(["smaller"], "small.jpg", { type: "image/jpeg" })]);
    await el.updateComplete;
    expect(fileError()).toBe("");
    expect(await bottomOf()).toBe("");
    expect(saveButton().hasAttribute("disabled")).toBe(false);
    click("[data-test=save]");
    await vi.waitFor(() => expect(client.uploadImage).toHaveBeenCalledTimes(2));
  },
);

it("puts a refused translation under that language's name until the name changes", async () => {
  const client = api();
  client.updateImage.mockRejectedValueOnce({
    code: "image.translation_required",
    params: { field: "names", language: "es" },
    status: 400,
  });
  await mount(client);
  click("[data-test=edit-one]");
  await el.updateComplete;
  field("name-es", "Pan editado");
  await el.updateComplete;
  click("[data-test=save]");

  const message = codeMessage("image.translation_required");
  await vi.waitFor(() => expect(nameInput("es").error).toBe(message));
  expect(await bottomOf()).toBe(FIX_FIELDS);
  expect(saveButton().hasAttribute("disabled")).toBe(false);
  await vi.waitFor(() =>
    expect(nameInput("es").shadowRoot!.activeElement).toBe(
      nameInput("es").shadowRoot!.querySelector("input"),
    ),
  );

  field("name-fr", "Pain");
  await el.updateComplete;
  expect(nameInput("es").error).toBe(message);
  expect(saveButton().hasAttribute("disabled")).toBe(false);

  field("name-es", "Pan blanco");
  await el.updateComplete;
  expect(nameInput("es").error).toBe("");
  expect(await bottomOf()).toBe("");
  expect(saveButton().hasAttribute("disabled")).toBe(false);
});

it("sends again when Save is pressed with a refused field unchanged, and drops the refusal", async () => {
  const client = api();
  client.updateImage.mockRejectedValueOnce({
    code: "image.translation_required",
    params: { field: "names", language: "es" },
    status: 400,
  });
  await mount(client);
  click("[data-test=edit-one]");
  await el.updateComplete;
  field("name-es", "Pan editado");
  await el.updateComplete;
  click("[data-test=save]");
  await vi.waitFor(() =>
    expect(nameInput("es").error).toBe(codeMessage("image.translation_required")),
  );

  const retry = deferred<never>();
  client.updateImage.mockReturnValueOnce(retry.promise);
  click("[data-test=save]");
  await el.updateComplete;
  expect(client.updateImage).toHaveBeenCalledTimes(2);
  expect(nameInput("es").error).toBe("");
  expect(await bottomOf()).toBe("");
});

it("says a refused translation in a language the form does not show above Save, and leaves Save working", async () => {
  const client = api();
  client.updateImage.mockRejectedValueOnce({
    code: "image.translation_required",
    params: { field: "names", language: "de" },
    status: 400,
  });
  await mount(client);
  click("[data-test=edit-one]");
  await el.updateComplete;
  field("name-es", "Pan editado");
  await el.updateComplete;
  click("[data-test=save]");

  await vi.waitFor(async () =>
    expect(await bottomOf()).toBe(
      `The image could not be saved. ${codeMessage("image.translation_required")}`,
    ),
  );
  expect(nameInput("es").error).toBe("");
  expect(saveButton().hasAttribute("disabled")).toBe(false);
});

it("says a photo refusal on an edit, which has no photo field, above Save and leaves Save working", async () => {
  const client = api();
  client.updateImage.mockRejectedValueOnce({ code: "image.too_large", params: {}, status: 400 });
  await mount(client);
  click("[data-test=edit-one]");
  await el.updateComplete;
  field("name-es", "Pan editado");
  await el.updateComplete;
  click("[data-test=save]");

  await vi.waitFor(async () =>
    expect(await bottomOf()).toBe(
      `The image could not be saved. ${codeMessage("image.too_large")}`,
    ),
  );
  expect(el.shadowRoot!.querySelector("#file-error")).toBeNull();
  expect(saveButton().hasAttribute("disabled")).toBe(false);
});

it("leaves Save working on a refusal that names no field, and drops it on the next submission", async () => {
  const client = api();
  client.updateImage.mockRejectedValueOnce(new Error("offline"));
  await mount(client);
  click("[data-test=edit-one]");
  await el.updateComplete;
  field("name-es", "Pan editado");
  await el.updateComplete;
  click("[data-test=save]");

  await vi.waitFor(async () =>
    expect(await bottomOf()).toBe(
      `The image could not be saved. ${codeMessage("server.internal")}`,
    ),
  );
  expect(saveButton().hasAttribute("disabled")).toBe(false);
  expect(el.shadowRoot!.querySelector("wt-modal p[role=alert]")).toBeNull();

  const retry = deferred<never>();
  client.updateImage.mockReturnValueOnce(retry.promise);
  click("[data-test=save]");
  await el.updateComplete;
  expect(client.updateImage).toHaveBeenCalledTimes(2);
  expect(await bottomOf()).toBe("");
});

it("shows the refusal and the generic sentence together when both apply", async () => {
  const client = api();
  client.updateImage.mockRejectedValueOnce({ code: "image.invalid_metadata" });
  await mount(client);
  click("[data-test=edit-one]");
  await el.updateComplete;
  field("name-es", "Pan editado");
  await el.updateComplete;
  click("[data-test=save]");
  const refused = `The image could not be saved. ${codeMessage("image.invalid_metadata")}`;
  await vi.waitFor(async () => expect(await bottomOf()).toBe(refused));

  field("name-es", "");
  await el.updateComplete;
  expect(await bottomOf()).toBe(`${refused} ${FIX_FIELDS}`);
  expect(saveButton().hasAttribute("disabled")).toBe(true);
});

it("starts again when reopened: no messages and Save quiet", async () => {
  const client = api();
  client.updateImage.mockRejectedValueOnce({ code: "image.invalid_metadata" });
  await mount(client);
  click("[data-test=upload]");
  await el.updateComplete;
  field("name-fr", "Pain");
  await el.updateComplete;
  click("[data-test=save]");
  await el.updateComplete;
  expect(await bottomOf()).toBe(FIX_FIELDS);
  click("wt-modal wt-button[slot=cancel]");
  await el.updateComplete;

  click("[data-test=upload]");
  await el.updateComplete;
  expect(fileError()).toBe("");
  expect(nameInput("es").error).toBe("");
  expect(await bottomOf()).toBe("");
  expect(saveButton().hasAttribute("disabled")).toBe(true);
  click("wt-modal wt-button[slot=cancel]");
  await el.updateComplete;

  click("[data-test=edit-one]");
  await el.updateComplete;
  field("name-es", "Pan editado");
  await el.updateComplete;
  click("[data-test=save]");
  await vi.waitFor(async () => expect(await bottomOf()).toContain("could not be saved"));
  click("wt-modal wt-button[slot=cancel]");
  await el.updateComplete;
  click("[data-test=edit-one]");
  await el.updateComplete;
  expect(await bottomOf()).toBe("");
  expect(saveButton().hasAttribute("disabled")).toBe(true);
});

it("names each language section with a capital letter in Spanish, where the browser's name is lower case", async () => {
  setLocale("es-ES");
  await mount();
  click("[data-test=edit-one]");
  await el.updateComplete;
  const legends = [...el.shadowRoot!.querySelectorAll("wt-modal legend")].map((legend) =>
    legend.textContent!.trim(),
  );
  expect(new Intl.DisplayNames(["es-ES"], { type: "language" }).of("fr")).toBe("francés");
  expect(legends).toEqual(["Español (Predeterminado)", "Francés"]);
});

it("clears a failed load's message once the server answers again", async () => {
  const liveData = new LiveData();
  const client = Object.assign(api(), { liveData });
  client.listImages.mockRejectedValue({ code: "connection.failed" });
  el = document.createElement("dashboard-image-library");
  el.api = client as unknown as ImageApi;
  document.body.append(el);
  await vi.waitFor(() =>
    expect(el.shadowRoot!.querySelector("[role=alert]")?.textContent).toContain(
      MEDIA_STRINGS.en["image.load_error"],
    ),
  );
  client.listImages.mockResolvedValue({ images: [image], total: 1 });
  liveData.refresh();
  await vi.waitFor(() => expect(el.shadowRoot!.querySelector("[data-image=one]")).not.toBeNull());
  expect(el.shadowRoot!.querySelector("[role=alert]")).toBeNull();
});

const thumbnail = (id = "one") =>
  el.shadowRoot!.querySelector<HTMLButtonElement>(`[data-test=preview-${id}]`)!;
const viewer = () => el.shadowRoot!.querySelector<HTMLElement>("wt-modal[data-test=image-preview]");
async function openedViewer(): Promise<HTMLElement> {
  await vi.waitFor(() => expect(viewer()?.shadowRoot?.querySelector("dialog")?.open).toBe(true));
  return viewer()!;
}
const usesShown = () =>
  [...viewer()!.querySelectorAll(".uses li a")].map((link) => [
    link.textContent,
    link.getAttribute("href"),
  ]);
const everyKindOfUse: ImageUsage[] = [
  { kind: "product", id: "toast", catalogueId: "menu", name: "Toast", active: true },
  { kind: "product", id: "old", catalogueId: "menu", name: "Old toast", active: false },
  {
    kind: "variant",
    id: "large",
    productId: "toast",
    catalogueId: "menu",
    name: "Large toast",
    active: true,
  },
  { kind: "section", id: "drinks", internalName: "Drinks (internal)", ownerMenuId: "drinks-menu" },
  { kind: "menu_version", id: "v1", menuId: "lunch", menuName: "Lunch Menu", number: 3 },
];

for (const picker of [false, true]) {
  it(`opens a preview when the thumbnail is clicked, without editing, deleting or choosing the image (${picker ? "picker" : "library"})`, async () => {
    const client = await mount(api(), picker);
    const selected = vi.fn();
    el.addEventListener("select-image", selected);
    await userEvent.click(el.shadowRoot!.querySelector("[data-image=one] img")!);
    const modal = await openedViewer();
    expect((modal as HTMLElement & { heading: string }).heading).toBe("Pan");
    const shown = modal.querySelector<HTMLImageElement>("img")!;
    expect(shown.alt).toBe("Pan");
    expect(shown.getAttribute("src")).toBe("/media/one.jpg");
    expect(client.getImage).toHaveBeenCalledWith("one");
    expect(el.shadowRoot!.querySelectorAll("wt-modal")).toHaveLength(1);
    expect(el.shadowRoot!.querySelector("wt-input[name=name-es]")).toBeNull();
    expect(el.shadowRoot!.querySelector("[data-test=confirm-delete]")).toBeNull();
    expect(client.updateImage).not.toHaveBeenCalled();
    expect(client.deleteImage).not.toHaveBeenCalled();
    expect(selected).not.toHaveBeenCalled();
  });
}

for (const [locale, label] of [
  ["en-GB", "Preview"],
  ["es-ES", "Vista previa"],
]) {
  it(`names the thumbnail's button as a preview of the image, and shows that it opens one (${locale})`, async () => {
    setLocale(locale);
    await mount();
    expect(thumbnail().getAttribute("aria-label")).toBe(`${label}: Pan`);
    expect(thumbnail().textContent!.trim()).toBe(label);
    expect(thumbnail().type).toBe("button");
  });
}

it.each([
  ["Enter", "{Enter}"],
  ["Space", " "],
])("opens the preview from the keyboard with %s on the thumbnail", async (_key, keys) => {
  const client = await mount();
  thumbnail().focus();
  await userEvent.keyboard(keys);
  await openedViewer();
  expect(client.getImage).toHaveBeenCalledWith("one");
  expect(client.updateImage).not.toHaveBeenCalled();
});

it("lists every place the image is used under a heading, each linked to the place itself", async () => {
  const client = api();
  client.getImage.mockResolvedValue({ image, uses: everyKindOfUse });
  await mount(client);
  thumbnail().click();
  const modal = await openedViewer();
  await vi.waitFor(() => expect(usesShown()).toHaveLength(5));
  expect(usesShown()).toEqual([
    ["Toast", "/manage/catalogue/product/toast"],
    ["Old toast (Disabled product)", "/manage/catalogue/product/old"],
    ["Large toast", "/manage/catalogue/product/large"],
    ["Drinks (internal)", "/manage/menus/menu/drinks-menu/view/structure"],
    ["Lunch Menu (Published menu)", "/manage/menus/menu/lunch"],
  ]);
  const list = modal.querySelector(".uses ul")!;
  expect(el.shadowRoot!.getElementById(list.getAttribute("aria-labelledby")!)!.textContent).toBe(
    "Where it is used",
  );
});

it("says plainly when the image is not used anywhere", async () => {
  await mount();
  thumbnail().click();
  const modal = await openedViewer();
  await vi.waitFor(() =>
    expect(modal.querySelector("[data-test=no-uses]")?.textContent).toBe("Not used anywhere yet."),
  );
  expect(modal.querySelector(".uses li")).toBeNull();
});

it("shows that the uses are being looked up until the answer arrives", async () => {
  const client = api();
  const lookup = deferred<{ image: LibraryImage; uses: ImageUsage[] }>();
  client.getImage.mockReturnValueOnce(lookup.promise);
  await mount(client);
  thumbnail().click();
  const modal = await openedViewer();
  expect(modal.querySelector(".uses [role=status]")!.textContent).toBe(
    "Looking up where it is used…",
  );
  expect(modal.querySelector("[data-test=no-uses]")).toBeNull();
  lookup.resolve({ image, uses: everyKindOfUse.slice(0, 1) });
  await vi.waitFor(() =>
    expect(usesShown()).toEqual([["Toast", "/manage/catalogue/product/toast"]]),
  );
  expect(modal.querySelector(".uses [role=status]")).toBeNull();
});

it("reports a failed lookup in the preview and shows the uses after Try again", async () => {
  const client = api();
  client.getImage
    .mockRejectedValueOnce({ code: "connection.failed" })
    .mockResolvedValueOnce({ image, uses: everyKindOfUse.slice(0, 1) });
  await mount(client);
  thumbnail().click();
  const modal = await openedViewer();
  await vi.waitFor(() =>
    expect(modal.querySelector(".uses [role=alert]")?.textContent).toContain(
      "Could not look up where this image is used.",
    ),
  );
  expect(usesShown()).toEqual([]);
  modal.querySelector<HTMLElement>("[data-test=retry-uses]")!.click();
  await vi.waitFor(() =>
    expect(usesShown()).toEqual([["Toast", "/manage/catalogue/product/toast"]]),
  );
  expect(client.getImage).toHaveBeenCalledTimes(2);
  expect(client.getImage).toHaveBeenLastCalledWith("one");
  expect(modal.querySelector(".uses [role=alert]")).toBeNull();
});

/** The focused element, followed down through every open shadow root. */
function deepActiveElement(): Element | null {
  let active = document.activeElement;
  while (active?.shadowRoot?.activeElement) active = active.shadowRoot.activeElement;
  return active;
}
/** Mounts inside a theme root, so the preview's dialog has its real size and a backdrop around it. */
async function mountWithTokens(client = api()) {
  const root = document.createElement("div");
  document.body.append(root);
  applyTokens(root);
  onTestFinished(() => root.remove());
  el = document.createElement("dashboard-image-library");
  el.api = client as unknown as ImageApi;
  root.append(el);
  await vi.waitFor(() => expect(el.shadowRoot!.querySelector("[data-image=one]")).not.toBeNull());
  return client;
}
const closePreview = () =>
  viewer()!.querySelector<HTMLElement>("[data-test=close-preview]")!.click();
async function previewClosed() {
  await vi.waitFor(() => expect(viewer()).toBeNull());
}

it("shows the uses of the image opened last when an earlier image's lookup answers late", async () => {
  const client = api();
  const two = { ...image, id: "two", filename: "two.jpg", names: { es: "Tostada" } };
  client.listImages.mockResolvedValue({ images: [image, two], total: 2 });
  const first = deferred<{ image: LibraryImage; uses: ImageUsage[] }>();
  client.getImage
    .mockReturnValueOnce(first.promise)
    .mockResolvedValueOnce({ image: two, uses: everyKindOfUse.slice(0, 1) });
  await mount(client);
  await vi.waitFor(() => expect(el.shadowRoot!.querySelectorAll("article")).toHaveLength(2));
  thumbnail("one").click();
  await openedViewer();
  closePreview();
  await previewClosed();
  thumbnail("two").click();
  await openedViewer();
  await vi.waitFor(() =>
    expect(usesShown()).toEqual([["Toast", "/manage/catalogue/product/toast"]]),
  );
  first.resolve({ image, uses: everyKindOfUse.slice(3, 4) });
  await new Promise((resolve) => setTimeout(resolve, 20));
  await el.updateComplete;
  expect((viewer() as HTMLElement & { heading: string }).heading).toBe("Tostada");
  expect(viewer()!.querySelector<HTMLImageElement>("img")!.getAttribute("src")).toBe(
    "/media/two.jpg",
  );
  expect(usesShown()).toEqual([["Toast", "/manage/catalogue/product/toast"]]);
});

it("does not reopen a closed preview when its lookup answers late, or fails late", async () => {
  const client = api();
  const answer = deferred<{ image: LibraryImage; uses: ImageUsage[] }>();
  const failure = deferred<never>();
  client.getImage.mockReturnValueOnce(answer.promise).mockReturnValueOnce(failure.promise);
  await mount(client);
  for (const settle of [
    () => answer.resolve({ image, uses: everyKindOfUse }),
    () => failure.reject(new Error("late")),
  ]) {
    thumbnail().click();
    await openedViewer();
    closePreview();
    await previewClosed();
    settle();
    await new Promise((resolve) => setTimeout(resolve, 20));
    await el.updateComplete;
    expect(viewer()).toBeNull();
  }
});

it("drops a lookup that answers after the library is removed", async () => {
  const client = api();
  const answer = deferred<{ image: LibraryImage; uses: ImageUsage[] }>();
  client.getImage.mockReturnValueOnce(answer.promise);
  await mount(client);
  thumbnail().click();
  await openedViewer();
  el.remove();
  answer.resolve({ image, uses: everyKindOfUse });
  await new Promise((resolve) => setTimeout(resolve, 20));
  document.body.append(el);
  await el.updateComplete;
  expect(viewer()).toBeNull();
});

it.each([
  ["the Close button", async () => closePreview()],
  [
    "Escape",
    async () => {
      viewer()!.querySelector<HTMLElement>("[data-test=close-preview]")!.focus();
      await userEvent.keyboard("{Escape}");
    },
  ],
  [
    "a click on the backdrop outside the dialog",
    async () => {
      await userEvent.click(page.elementLocator(document.documentElement), {
        position: { x: 2, y: 2 },
        force: true,
      });
    },
  ],
])(
  "closes the preview with %s and puts focus back on the image's thumbnail",
  async (_how, close) => {
    const client = api();
    client.getImage.mockResolvedValue({ image, uses: everyKindOfUse.slice(0, 1) });
    await mountWithTokens(client);
    thumbnail().click();
    await openedViewer();
    await vi.waitFor(() => expect(usesShown()).toHaveLength(1));
    await close();
    await previewClosed();
    await vi.waitFor(() => expect(deepActiveElement()).toBe(thumbnail()));
    expect(client.updateImage).not.toHaveBeenCalled();
    expect(client.deleteImage).not.toHaveBeenCalled();
  },
);

it("keeps the preview open on a click inside the dialog, its own edge included", async () => {
  await mountWithTokens();
  thumbnail().click();
  const modal = await openedViewer();
  await vi.waitFor(() => expect(modal.querySelector("[data-test=no-uses]")).not.toBeNull());
  await userEvent.click(modal.querySelector("img")!);
  await userEvent.click(modal.querySelector("h3")!);
  const dialog = modal.shadowRoot!.querySelector("dialog")!;
  const box = dialog.getBoundingClientRect();
  // A click on the dialog's own border reaches the <dialog> itself, as a backdrop click does, but
  // inside its box. A real click half a pixel inside the dialog's left edge landed on its body
  // instead, so this one is sent straight to the dialog.
  dialog.dispatchEvent(
    new MouseEvent("click", {
      bubbles: true,
      composed: true,
      clientX: box.left + 0.5,
      clientY: box.top + box.height / 2,
    }),
  );
  await new Promise((resolve) => setTimeout(resolve, 20));
  expect(viewer()?.shadowRoot!.querySelector("dialog")!.open).toBe(true);
});

it("keeps an enclosing picker open when the preview is closed with Escape", async () => {
  await mount(api(), true);
  const enclosingClose = vi.fn();
  el.addEventListener("wt-close", enclosingClose);
  thumbnail().click();
  await openedViewer();
  viewer()!.querySelector<HTMLElement>("[data-test=close-preview]")!.focus();
  await userEvent.keyboard("{Escape}");
  await previewClosed();
  expect(enclosingClose).not.toHaveBeenCalled();
});

it("leaves Edit and Delete working as before once a preview has been opened and closed", async () => {
  const client = await mount();
  thumbnail().click();
  await openedViewer();
  closePreview();
  await previewClosed();
  click("[data-test=edit-one]");
  await el.updateComplete;
  expect(el.shadowRoot!.querySelector("wt-input[name=name-es]")).not.toBeNull();
  expect(viewer()).toBeNull();
  click("wt-modal wt-button[slot=cancel]");
  await vi.waitFor(() => expect(el.shadowRoot!.querySelector("wt-modal")).toBeNull());
  click("[data-test=delete-one]");
  await vi.waitFor(() =>
    expect(el.shadowRoot!.querySelector("[data-test=confirm-delete]")).not.toBeNull(),
  );
  expect(viewer()).toBeNull();
  click("[data-test=confirm-delete]");
  await vi.waitFor(() => expect(client.deleteImage).toHaveBeenCalledWith("one"));
});
