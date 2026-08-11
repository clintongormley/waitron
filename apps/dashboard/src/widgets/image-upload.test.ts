import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanupWidgets, mountWidget } from "./test-helpers.js";
import { codeMessage } from "../i18n/codes.js";
// Value import (not `import type`): pulls in the module for its `@customElement` side effect, which
// registers `dashboard-image-upload` so `mountWidget` can create it.
import { ImageUpload } from "./image-upload.js";
import type { DashboardApi } from "../api/client.js";

afterEach(cleanupWidgets);

/** A stub carrying only the `uploadImage` seam the widget uses; the real `DashboardApi` satisfies it. */
function stubApi(overrides: Partial<DashboardApi> = {}): DashboardApi {
  return {
    uploadImage: vi.fn().mockResolvedValue({ image: "abc123.png" }),
    ...overrides,
  } as unknown as DashboardApi;
}

/** A tiny in-memory PNG-typed file; the widget passes the whole `File` to `uploadImage` unread. */
function pngFile(): File {
  return new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], "photo.png", { type: "image/png" });
}

/** Put `file` on the widget's file input and fire the native `change`, as a real file pick does. */
function pickFile(el: ImageUpload, file: File): void {
  const input = el.shadowRoot!.querySelector<HTMLInputElement>("[data-test=file]")!;
  const transfer = new DataTransfer();
  transfer.items.add(file);
  input.files = transfer.files;
  input.dispatchEvent(new Event("change"));
}

/** Settle the in-flight upload promise and the follow-up render. */
async function flush(el: ImageUpload): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
  await el.updateComplete;
}

describe("image-upload", () => {
  it("uploads the picked file and emits image-changed with the stored reference", async () => {
    const api = stubApi();
    const { el } = await mountWidget<ImageUpload>("dashboard-image-upload", { api });
    const file = pngFile();
    const seen = new Promise<CustomEvent<{ image: string }>>((resolve) =>
      el.addEventListener("image-changed", (e) => resolve(e as CustomEvent), { once: true }),
    );
    pickFile(el, file);
    const event = await seen;
    expect(api.uploadImage).toHaveBeenCalledWith(file);
    expect(event.detail.image).toBe("abc123.png");
  });

  // image-changed must escape this widget's shadow boundary to reach the product form, so it is
  // dispatched bubbles+composed — asserted so a future edit does not quietly drop either.
  it("emits image-changed as a bubbling, composed event", async () => {
    const { el } = await mountWidget<ImageUpload>("dashboard-image-upload", { api: stubApi() });
    const seen = new Promise<Event>((resolve) =>
      el.addEventListener("image-changed", resolve, { once: true }),
    );
    pickFile(el, pngFile());
    const event = await seen;
    expect(event.bubbles).toBe(true);
    expect(event.composed).toBe(true);
  });

  it("renders a preview served from /media with a non-empty alt after upload", async () => {
    const { el } = await mountWidget<ImageUpload>("dashboard-image-upload", { api: stubApi() });
    pickFile(el, pngFile());
    await flush(el);
    const img = el.shadowRoot!.querySelector<HTMLImageElement>("[data-test=preview]")!;
    expect(img.getAttribute("src")).toBe("/media/abc123.png");
    expect(img.getAttribute("alt")).toBeTruthy();
  });

  // Edit-mode pre-fill: a product already carrying an image shows its preview immediately, with no
  // upload, so the form can seed the control from the loaded product.
  it("renders a preview for a pre-set image without uploading", async () => {
    const api = stubApi();
    const { el } = await mountWidget<ImageUpload>("dashboard-image-upload", {
      api,
      image: "seed.webp",
    });
    const img = el.shadowRoot!.querySelector<HTMLImageElement>("[data-test=preview]")!;
    expect(img.getAttribute("src")).toBe("/media/seed.webp");
    expect(api.uploadImage).not.toHaveBeenCalled();
  });

  // A rejected upload surfaces the server's `media.*` code through the i18n layer as localised copy in
  // a `role="alert"` region — the operator NEVER sees the raw wire code (the errorKey stays raw in
  // state; `codeMessage` maps it at the render edge, mirroring the login/staff screens).
  it("shows localised copy for the media.* error code in a role=alert region on a rejected upload", async () => {
    const api = stubApi({
      uploadImage: vi.fn().mockRejectedValue({ code: "media.unsupported_type" }),
    } as Partial<DashboardApi>);
    const { el } = await mountWidget<ImageUpload>("dashboard-image-upload", { api });
    pickFile(el, pngFile());
    await flush(el);
    const alert = el.shadowRoot!.querySelector("[role=alert]")!;
    expect(alert.textContent).toContain(codeMessage("media.unsupported_type", "es-ES"));
    expect(alert.textContent).not.toContain("media.unsupported_type");
  });

  // A thrown error with no `{ code }` falls back to `server.internal`, mirroring the screens, so the
  // operator always gets a stable localised sentence rather than a raw message or a blank banner.
  it("falls back to server.internal copy when the rejection names no code", async () => {
    const api = stubApi({
      uploadImage: vi.fn().mockRejectedValue(new Error("boom")),
    } as Partial<DashboardApi>);
    const { el } = await mountWidget<ImageUpload>("dashboard-image-upload", { api });
    pickFile(el, pngFile());
    await flush(el);
    const alert = el.shadowRoot!.querySelector("[role=alert]")!;
    expect(alert.textContent).toContain(codeMessage("server.internal", "es-ES"));
    expect(alert.textContent).not.toContain("server.internal");
  });

  // A successful upload after a failed one clears the stale banner, so a recovered pick does not leave
  // the operator looking at an error for an image that is now uploaded.
  it("clears a prior error on a subsequent successful upload", async () => {
    const api = stubApi({
      uploadImage: vi
        .fn()
        .mockRejectedValueOnce({ code: "media.too_large" })
        .mockResolvedValueOnce({ image: "ok.png" }),
    } as Partial<DashboardApi>);
    const { el } = await mountWidget<ImageUpload>("dashboard-image-upload", { api });
    pickFile(el, pngFile());
    await flush(el);
    expect(el.shadowRoot!.querySelector("[role=alert]")!.textContent).toContain(
      codeMessage("media.too_large", "es-ES"),
    );
    pickFile(el, pngFile());
    await flush(el);
    expect(el.shadowRoot!.querySelector("[role=alert]")).toBe(null);
    expect(el.shadowRoot!.querySelector<HTMLImageElement>("[data-test=preview]")!.src).toContain(
      "/media/ok.png",
    );
  });
});
