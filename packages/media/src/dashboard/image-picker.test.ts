import { afterEach, expect, it, vi } from "vitest";
import { html, render } from "lit";
import { LiveData } from "@waitron/dashboard-kit";
import { MEDIA_DASHBOARD } from "./index.js";
import "./image-picker.js";
import type { ImagePicker } from "./image-picker.js";
import type { ImageLibrary } from "./image-library.js";
let host: HTMLElement;
afterEach(() => host?.remove());
it("registers a generic picker that uses the injected dashboard request", async () => {
  host = document.createElement("div");
  document.body.append(host);
  const request = vi
    .fn()
    .mockImplementation(async (path: string) =>
      path.includes("image-labels") ? { labels: [] } : { images: [], total: 0 },
    );
  render(html`<media-image-picker .request=${request}></media-image-picker>`, host);
  const picker = host.querySelector("media-image-picker") as ImagePicker;
  await picker.updateComplete;
  const library = picker.shadowRoot!.querySelector("dashboard-image-library") as ImageLibrary;
  await library.updateComplete;
  await vi.waitFor(() => expect(request).toHaveBeenCalledTimes(2));
  expect(library.picker).toBe(true);
  const selected = vi.fn();
  picker.addEventListener("select-image", selected);
  library.dispatchEvent(
    new CustomEvent("select-image", { detail: { id: "one" }, bubbles: true, composed: true }),
  );
  expect(selected.mock.calls[0]![0].detail).toEqual({ id: "one" });
});
it("contributes the image library screen and localized navigation", async () => {
  host = document.createElement("div");
  document.body.append(host);
  const request = vi
    .fn()
    .mockImplementation(async (path: string) =>
      path.includes("image-labels") ? { labels: [] } : { images: [], total: 0 },
    );
  const screen = MEDIA_DASHBOARD.create({ request });
  render(screen.render(), host);
  expect(MEDIA_DASHBOARD.screen.requiresPermission).toBe("image.manage");
  expect(MEDIA_DASHBOARD.strings.es["nav.images"]).toBe("Biblioteca de imágenes");
  await vi.waitFor(() => expect(request).toHaveBeenCalledTimes(2));
});
function libraryRequest() {
  return vi
    .fn()
    .mockImplementation(async (path: string) =>
      path.includes("image-labels") ? { labels: [] } : { images: [], total: 0 },
    );
}
it("shows no library until it is given a request, then lists images through that request", async () => {
  host = document.createElement("div");
  document.body.append(host);
  render(html`<media-image-picker .liveData=${new LiveData()}></media-image-picker>`, host);
  const picker = host.querySelector("media-image-picker") as ImagePicker;
  await picker.updateComplete;
  expect(picker.shadowRoot!.querySelector("dashboard-image-library")).toBeNull();
  const request = libraryRequest();
  picker.request = request;
  await picker.updateComplete;
  expect(picker.shadowRoot!.querySelector("dashboard-image-library")).not.toBeNull();
  await vi.waitFor(() =>
    expect(request).toHaveBeenCalledWith("/management-api/image-labels", "GET", undefined, {
      passive: false,
    }),
  );
});
it("refreshes the library from a replacement live-data source once the library has loaded again", async () => {
  host = document.createElement("div");
  document.body.append(host);
  const request = libraryRequest();
  const first = new LiveData();
  render(
    html`<media-image-picker .request=${request} .liveData=${first}></media-image-picker>`,
    host,
  );
  const picker = host.querySelector("media-image-picker") as ImagePicker;
  await picker.updateComplete;
  const replacement = new LiveData();
  picker.liveData = replacement;
  await picker.updateComplete;
  const library = picker.shadowRoot!.querySelector("dashboard-image-library") as ImageLibrary;
  await library.updateComplete;
  const search = library.shadowRoot!.querySelector("[name=image-search]")!;
  search.dispatchEvent(
    new CustomEvent("wt-change", { detail: { value: "bread" }, bubbles: true, composed: true }),
  );
  await vi.waitFor(() =>
    expect(request).toHaveBeenCalledWith(
      expect.stringContaining("search=bread"),
      "GET",
      undefined,
      expect.anything(),
    ),
  );
  const reads = request.mock.calls.length;
  replacement.invalidate([{ type: "media_images" }]);
  await vi.waitFor(() => expect(request.mock.calls.length).toBeGreaterThan(reads));
});
