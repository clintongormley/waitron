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

const card = {
  filename: "one.jpg",
  names: { es: "Pan de pueblo con semillas", en: "Country bread with seeds" },
  createdAt: "2026-09-12T12:00:00Z",
  updatedAt: "2026-09-12T12:00:00Z",
  usageCount: 0,
};

async function mountLibrary(picker: boolean, theme: "light" | "dark") {
  await mountThemed("<div></div>", theme);
  const library = document.createElement("dashboard-image-library");
  library.picker = picker;
  library.api = {
    listImages: vi.fn().mockResolvedValue({
      images: [1, 2, 3, 4, 5, 6].map((n) => ({ ...card, id: `image-${n}` })),
      total: 6,
    }),
  } as unknown as ImageApi;
  host.append(library);
  await library.updateComplete;
  await vi.waitFor(() => expect(library.shadowRoot!.querySelectorAll("article")).toHaveLength(6));
  return library;
}

const frame = () => new Promise((resolve) => requestAnimationFrame(resolve));

function token(element: Element, name: string): number {
  const value = parseFloat(getComputedStyle(element).getPropertyValue(name));
  expect(value, name).toBeGreaterThan(0);
  return value;
}

for (const locale of ["en-GB", "es-ES"] as const) {
  for (const picker of [false, true]) {
    for (const theme of ["light", "dark"] as const) {
      it(`keeps each image's Edit and Delete buttons on one line inside its card from 300 to 1240px and at each column count's narrowest card, with Use image above them in the picker (${locale}, ${picker ? "picker" : "library"}, ${theme})`, async () => {
        setLocale(locale);
        await page.viewport(1280, 800);
        const library = await mountLibrary(picker, theme);
        const grid = library.shadowRoot!.querySelector(".grid")!;
        const narrowestCard = token(library, "--wt-tap-min") * 6;
        const gap = token(library, "--wt-space-4");
        host.style.width = "1000px";
        await frame();
        const hostBeyondGrid = 1000 - measured(grid).width;

        // A sweep in 20px steps; then, for one to four columns, the host width at which the grid
        // is exactly that many narrowest cards and their gaps wide, and (from two columns) 1px
        // less, where the grid must hold one column fewer.
        const widths: { width: number; columns?: number; narrowest?: boolean }[] = [];
        for (let width = 300; width <= 1240; width += 20) widths.push({ width });
        for (let columns = 1; columns <= 4; columns++) {
          const width = columns * narrowestCard + (columns - 1) * gap + hostBeyondGrid;
          widths.push({ width, columns, narrowest: true });
          if (columns > 1) widths.push({ width: width - 1, columns: columns - 1 });
        }
        for (const { width, columns, narrowest } of widths) {
          host.style.width = `${width}px`;
          await frame();
          const articles = [...library.shadowRoot!.querySelectorAll("article")];
          if (columns !== undefined) {
            const lefts = new Set(articles.map((article) => Math.round(measured(article).left)));
            expect(lefts.size, `${width}px: columns`).toBe(columns);
          }
          for (const article of articles) {
            const box = measured(article);
            if (narrowest) {
              expect(
                Math.abs(box.width - narrowestCard),
                `${width}px: card ${box.width}px is not the narrowest`,
              ).toBeLessThan(1);
            }
            const id = article.getAttribute("data-image")!;
            const edit = measured(article.querySelector(`[data-test=edit-${id}]`)!);
            const remove = measured(article.querySelector(`[data-test=delete-${id}]`)!);
            expect(remove.top, `${width}px: Delete below Edit`).toBe(edit.top);
            expect(edit.left, `${width}px: Edit outside its card`).toBeGreaterThanOrEqual(box.left);
            expect(remove.right, `${width}px: Delete outside its card`).toBeLessThanOrEqual(
              box.right,
            );
            const thumb = measured(article.querySelector(".thumb")!);
            const chip = measured(article.querySelector(".chip")!);
            expect(chip.left, `${width}px: Preview chip outside its photo`).toBeGreaterThanOrEqual(
              thumb.left,
            );
            expect(chip.right, `${width}px: Preview chip outside its photo`).toBeLessThanOrEqual(
              thumb.right,
            );
            const chipText = document.createRange();
            chipText.selectNodeContents(article.querySelector(".chip")!);
            expect(chipText.getClientRects(), `${width}px: Preview chip wraps`).toHaveLength(1);
            if (picker) {
              const use = measured(article.querySelector(`[data-test=select-${id}]`)!);
              expect(use.bottom, `${width}px: Use image not above Edit`).toBeLessThanOrEqual(
                edit.top,
              );
              expect(use.left, `${width}px: Use image outside its card`).toBeGreaterThanOrEqual(
                box.left,
              );
              expect(use.right, `${width}px: Use image outside its card`).toBeLessThanOrEqual(
                box.right,
              );
            }
          }
        }
      });
    }
  }
}

for (const locale of ["en-GB", "es-ES"] as const) {
  for (const picker of [false, true]) {
    for (const theme of ["light", "dark"] as const) {
      it(`puts Delete at the start of each card's action row and Edit at its end, with a gap between them, from 300 to 1240px (${locale}, ${picker ? "picker" : "library"}, ${theme})`, async () => {
        setLocale(locale);
        await page.viewport(1280, 800);
        const library = await mountLibrary(picker, theme);
        const gap = token(library, "--wt-space-4");
        for (let width = 300; width <= 1240; width += 20) {
          host.style.width = `${width}px`;
          await frame();
          for (const article of library.shadowRoot!.querySelectorAll("article")) {
            const id = article.getAttribute("data-image")!;
            const row = measured(article.querySelector(".actions")!);
            const edit = measured(article.querySelector(`[data-test=edit-${id}]`)!);
            const remove = measured(article.querySelector(`[data-test=delete-${id}]`)!);
            expect(remove.top, `${width}px: Delete and Edit on one line`).toBe(edit.top);
            expect(
              Math.abs(remove.left - row.left),
              `${width}px: Delete not at the start`,
            ).toBeLessThan(1);
            expect(
              Math.abs(row.right - edit.right),
              `${width}px: Edit not at the end`,
            ).toBeLessThan(1);
            expect(edit.left - remove.right, `${width}px: gap`).toBeGreaterThanOrEqual(gap);
          }
        }
      });
    }
  }
}

for (const theme of ["light", "dark"] as const) {
  it(`gives the search box the free width of the filter row beside the dropdowns on a wide screen (${theme})`, async () => {
    await page.viewport(1280, 800);
    const library = await mountLibrary(false, theme);
    host.style.width = "1000px";
    await frame();
    const row = measured(library.shadowRoot!.querySelector(".filters")!);
    const search = measured(library.shadowRoot!.querySelector("wt-input[name=image-search]")!);
    const selects = [...library.shadowRoot!.querySelectorAll(".filters wt-combobox")].map(measured);
    for (const select of selects) expect(Math.abs(select.bottom - search.bottom)).toBeLessThan(1);
    expect(search.width).toBeGreaterThanOrEqual(token(library, "--wt-tap-min") * 8);
    const last = selects.at(-1)!;
    expect(row.right - last.right).toBeLessThan(1);
  });

  it(`gives the search box a line of its own, full width, on a phone (${theme})`, async () => {
    await page.viewport(390, 800);
    const library = await mountLibrary(false, theme);
    await frame();
    const row = measured(library.shadowRoot!.querySelector(".filters")!);
    const search = measured(library.shadowRoot!.querySelector("wt-input[name=image-search]")!);
    expect(search.width).toBeCloseTo(row.width, 0);
    expect(row.right).toBeLessThanOrEqual(window.innerWidth);
  });

  it(`never draws a card wider than a library narrower than the usual card (${theme})`, async () => {
    await page.viewport(320, 700);
    const library = await mountLibrary(false, theme);
    host.style.width = "200px";
    await frame();
    const grid = measured(library.shadowRoot!.querySelector(".grid")!);
    for (const article of library.shadowRoot!.querySelectorAll("article")) {
      expect(measured(article).right).toBeLessThanOrEqual(grid.right);
    }
  });
}

const uses = [
  { kind: "product", id: "toast", catalogueId: "menu", name: "Toast", active: true },
  {
    kind: "product",
    id: "old",
    catalogueId: "menu",
    name: "Old country toast with seeds",
    active: false,
  },
  {
    kind: "variant",
    id: "large",
    productId: "toast",
    catalogueId: "menu",
    name: "Large",
    active: true,
  },
  { kind: "section", id: "breads", internalName: "Breads (internal)", ownerMenuId: "lunch" },
  { kind: "menu_version", id: "v1", menuId: "lunch", menuName: "Weekday lunch", number: 3 },
];

/** A PNG of the given size, so the preview is measured with a photo that has loaded. */
function photo(width: number, height: number): string {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d")!;
  context.fillStyle = "rgb(200 120 40)";
  context.fillRect(0, 0, width, height);
  return canvas.toDataURL("image/png");
}

async function openPreview(
  theme: "light" | "dark",
  shown: typeof uses = uses,
  size = { width: 900, height: 400 },
) {
  const library = await mountLibrary(false, theme);
  Object.assign(library.api, {
    getImage: vi.fn().mockResolvedValue({ image: { ...card, id: "image-1" }, uses: shown }),
  });
  library.shadowRoot!.querySelector<HTMLElement>("[data-test=preview-image-1]")!.click();
  await vi.waitFor(() =>
    expect(library.shadowRoot!.querySelectorAll("wt-modal .uses li a")).toHaveLength(shown.length),
  );
  const modal = library.shadowRoot!.querySelector("wt-modal")!;
  await modal.updateComplete;
  const dialog = modal.shadowRoot!.querySelector<HTMLDialogElement>("dialog")!;
  await vi.waitFor(() => expect(dialog.open).toBe(true));
  const image = modal.querySelector<HTMLImageElement>(".viewer img")!;
  image.src = photo(size.width, size.height);
  await image.decode();
  expect(image.naturalWidth).toBe(size.width);
  expect(image.naturalHeight).toBe(size.height);
  await frame();
  return {
    library,
    dialog: measured(dialog),
    body: modal.shadowRoot!.querySelector<HTMLElement>(".body")!,
    photo: measured(image),
    list: measured(modal.querySelector(".uses")!),
    links: [...modal.querySelectorAll(".uses li a")].map(measured),
  };
}

for (const theme of ["light", "dark"] as const) {
  it(`shows the preview's photo beside its list of uses on a laptop screen (${theme})`, async () => {
    await page.viewport(1280, 800);
    const { dialog, photo, list } = await openPreview(theme);
    expect(photo.right).toBeLessThanOrEqual(list.left);
    expect(photo.top).toBeLessThan(list.bottom);
    expect(list.top).toBeLessThan(photo.bottom);
    expect(photo.left).toBeGreaterThanOrEqual(dialog.left);
    expect(list.right).toBeLessThanOrEqual(dialog.right);
  });

  it(`stacks the preview's photo above its list of uses on a phone, both whole and easy to tap (${theme})`, async () => {
    await page.viewport(390, 800);
    const { library, dialog, body, photo, list, links } = await openPreview(theme);
    expect(photo.bottom).toBeLessThanOrEqual(list.top);
    for (const box of [photo, list]) {
      expect(box.left).toBeGreaterThanOrEqual(dialog.left);
      expect(box.right).toBeLessThanOrEqual(dialog.right);
    }
    expect(body.clientWidth).toBeGreaterThan(0);
    expect(body.scrollWidth).toBeLessThanOrEqual(body.clientWidth);
    const tapMin = token(library, "--wt-tap-min");
    for (const link of links) {
      expect(link.height).toBeGreaterThanOrEqual(tapMin);
      expect(link.right).toBeLessThanOrEqual(dialog.right);
    }
  });
}

/** A product name with no space or hyphen anywhere, so nothing in it offers a line break. */
const unbroken = {
  kind: "product",
  id: "long",
  catalogueId: "menu",
  name: "Tostadadepanrusticoconsemillasyaceitedeoliva",
  active: true,
};

for (const theme of ["light", "dark"] as const) {
  it(`wraps a use whose name has no break in it inside the preview on a 320px-wide phone, with nothing to scroll sideways (${theme})`, async () => {
    await page.viewport(320, 700);
    const { library, dialog, body, list, links } = await openPreview(theme, [unbroken, ...uses]);
    expect(body.clientWidth).toBeGreaterThan(0);
    expect(body.scrollWidth).toBeLessThanOrEqual(body.clientWidth);
    const tapMin = token(library, "--wt-tap-min");
    for (const link of links) {
      expect(link.height).toBeGreaterThanOrEqual(tapMin);
      expect(link.left).toBeGreaterThanOrEqual(list.left);
      expect(link.right).toBeLessThanOrEqual(list.right);
      expect(link.right).toBeLessThanOrEqual(dialog.right);
    }
  });

  it(`wraps a use whose name has no break in it inside the delete dialog on a 320px-wide phone, with nothing to scroll sideways (${theme})`, async () => {
    await page.viewport(320, 700);
    const library = await mountLibrary(false, theme);
    Object.assign(library.api, {
      getImage: vi.fn().mockResolvedValue({ image: { ...card, id: "image-1" }, uses: [unbroken] }),
    });
    library.shadowRoot!.querySelector<HTMLElement>("[data-test=delete-image-1]")!.click();
    await vi.waitFor(() =>
      expect(library.shadowRoot!.querySelector("wt-modal li a")).not.toBeNull(),
    );
    const modal = library.shadowRoot!.querySelector("wt-modal")!;
    await modal.updateComplete;
    const dialogElement = modal.shadowRoot!.querySelector<HTMLDialogElement>("dialog")!;
    await vi.waitFor(() => expect(dialogElement.open).toBe(true));
    await frame();
    const dialog = measured(dialogElement);
    const body = modal.shadowRoot!.querySelector<HTMLElement>(".body")!;
    expect(body.clientWidth).toBeGreaterThan(0);
    expect(body.scrollWidth).toBeLessThanOrEqual(body.clientWidth);
    const list = measured(modal.querySelector("ul")!);
    const link = measured(modal.querySelector("li a")!);
    expect(link.right).toBeLessThanOrEqual(list.right);
    expect(link.right).toBeLessThanOrEqual(dialog.right);
  });
}

// A photo taller than the preview's height cap is drawn whole inside a box of another shape, by
// `object-fit: contain`; every other photo's box takes the photo's own proportions.
for (const theme of ["light", "dark"] as const) {
  for (const [viewport, shape, size, capped] of [
    [{ width: 1280, height: 800 }, "landscape", { width: 900, height: 400 }, false],
    [{ width: 1280, height: 800 }, "portrait", { width: 600, height: 800 }, true],
    [{ width: 390, height: 800 }, "landscape", { width: 900, height: 400 }, false],
    [{ width: 390, height: 800 }, "portrait", { width: 600, height: 800 }, false],
  ] as const) {
    it(`draws a ${shape} photo whole in the preview at its own proportions, inside the dialog, at ${viewport.width}px (${theme})`, async () => {
      await page.viewport(viewport.width, viewport.height);
      const { library, dialog, photo } = await openPreview(theme, uses, size);
      const image = library.shadowRoot!.querySelector(".viewer img")!;
      expect(getComputedStyle(image).objectFit).toBe("contain");
      const ratio = size.width / size.height;
      if (capped) {
        expect(photo.height).toBeCloseTo(viewport.height * 0.6, 0);
      } else {
        expect(photo.width / photo.height).toBeCloseTo(ratio, 2);
      }
      expect(photo.left).toBeGreaterThanOrEqual(dialog.left);
      expect(photo.right).toBeLessThanOrEqual(dialog.right);
      expect(photo.top).toBeGreaterThanOrEqual(dialog.top);
      expect(photo.bottom).toBeLessThanOrEqual(dialog.bottom);
    });
  }
}
