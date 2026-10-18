import { afterEach, expect, it, vi } from "vitest";
import { userEvent } from "vitest/browser";
import type { WtButton, WtDialog } from "@waitron/ui";
import { DashboardApi } from "../api/client.js";
import { cleanupWidgets, dialogClosed, mountWidget } from "../widgets/test-helpers.js";
import { currentLocale, setLocale } from "../i18n/t.js";
import "./backup-screen.js";

type Panel = HTMLElement & {
  updateComplete: Promise<unknown>;
  api: DashboardApi;
  canManage: boolean;
};
const q = <T extends Element>(el: Panel, name: string) =>
  el.shadowRoot?.querySelector<T>(`[data-test="${name}"]`) ?? null;
const oldLocale = currentLocale();
afterEach(() => {
  cleanupWidgets();
  setLocale(oldLocale);
});
const bytes = new Uint8Array([37, 80, 68, 70, 0, 255]);
function response() {
  return new Response(bytes, { headers: { "Content-Type": "application/pdf" } });
}
async function mount(fetcher = vi.fn(async () => response()), canManage = true) {
  const { el } = await mountWidget<Panel>("dashboard-recovery-document", {
    api: new DashboardApi("", fetcher),
    canManage,
  });
  return { el, fetcher };
}
async function click(el: Panel, name: string) {
  const button = q<WtButton>(el, name);
  expect(button, name).not.toBeNull();
  await button!.updateComplete;
  await userEvent.click(button!.shadowRoot!.querySelector("button")!);
  await el.updateComplete;
}
async function create(el: Panel) {
  await click(el, "new-document");
  await click(el, "confirm-document");
}

it("requires an explicit replacement confirmation and cancels without a request", async () => {
  const { el, fetcher } = await mount();
  expect(q(el, "new-document")).not.toBeNull();
  expect(fetcher).not.toHaveBeenCalled();
  await click(el, "new-document");
  expect(q<WtDialog>(el, "confirm-dialog")!.open).toBe(true);
  await click(el, "cancel-document");
  expect(q<WtDialog>(el, "confirm-dialog")!.open).toBe(false);
  expect(fetcher).not.toHaveBeenCalled();
});

it("Escape cancels confirmation without replacing the key", async () => {
  const { el, fetcher } = await mount();
  await click(el, "new-document");
  const dialog = q<WtDialog>(el, "confirm-dialog")!;
  const closed = dialogClosed(dialog);
  await userEvent.keyboard("{Escape}");
  await closed;
  await el.updateComplete;
  expect(dialog.open).toBe(false);
  expect(q<WtButton>(el, "new-document")!.disabled).toBe(false);
  expect(fetcher).not.toHaveBeenCalled();
});

it("offers identical PDF bytes for download and repeat printing without a second replacement", async () => {
  const { el, fetcher } = await mount();
  await create(el);
  await vi.waitFor(() => expect(q(el, "download-document")).not.toBeNull());
  const download = q<HTMLAnchorElement>(el, "download-document")!;
  const print = q<HTMLAnchorElement>(el, "print-document")!;
  expect(print.href).toBe(download.href);
  expect(print.target).toBe("_blank");
  expect(print.rel).toContain("noopener");
  expect(download.download).toMatch(/\.pdf$/);
  for (const href of [download.href, print.href, print.href])
    expect(Array.from(new Uint8Array(await (await fetch(href)).arrayBuffer()))).toEqual([
      37, 80, 68, 70, 0, 255,
    ]);
  expect(fetcher).toHaveBeenCalledTimes(1);
  await click(el, "clear-document");
  expect(q(el, "download-document")).toBeNull();
  await expect(fetch(download.href)).rejects.toThrow();
});

it.each(["en-GB", "es-ES"] as const)(
  "uses the current %s locale for replacement",
  async (locale) => {
    setLocale(locale);
    const { el, fetcher } = await mount();
    await create(el);
    await vi.waitFor(() => expect(q(el, "download-document")).not.toBeNull());
    expect(fetcher).toHaveBeenCalledWith(
      "/api/box/recovery-document/reissue",
      expect.objectContaining({
        body: JSON.stringify({ locale: locale === "es-ES" ? "es" : "en" }),
      }),
    );
  },
);

it("keeps a refused replacement retryable and clears old delivery before a replacement", async () => {
  const fetcher = vi
    .fn()
    .mockResolvedValueOnce(response())
    .mockResolvedValueOnce(
      new Response(JSON.stringify({ error: { code: "authorization.not_permitted" } }), {
        status: 403,
      }),
    )
    .mockImplementation(async () => response());
  const { el } = await mount(fetcher);
  await create(el);
  await vi.waitFor(() => expect(q(el, "download-document")).not.toBeNull());
  const old = q<HTMLAnchorElement>(el, "download-document")!.href;
  await create(el);
  await vi.waitFor(() =>
    expect(q<HTMLElementTagNameMap["wt-form-actions"]>(el, "document-error")?.error).toBeTruthy(),
  );
  expect(q(el, "download-document")).toBeNull();
  await expect(fetch(old)).rejects.toThrow();
  expect(q<WtButton>(el, "confirm-document")!.disabled).toBe(false);
  await click(el, "confirm-document");
  await vi.waitFor(() => expect(q(el, "download-document")).not.toBeNull());
  expect(fetcher).toHaveBeenCalledTimes(3);
});

it.each(["permission", "api"])(
  "ignores success and refusal from the old %s context",
  async (context) => {
    for (const refused of [false, true]) {
      let resolve!: (value: Response) => void;
      const fetcher = vi.fn(
        () =>
          new Promise<Response>((yes) => {
            resolve = yes;
          }),
      );
      const { el } = await mount(fetcher);
      const operation = vi.spyOn(el.api, "reissueRecoveryDocument");
      await create(el);
      if (context === "permission") el.canManage = false;
      else el.api = new DashboardApi("", async () => response());
      await el.updateComplete;
      resolve(
        refused
          ? new Response(JSON.stringify({ error: { code: "authorization.not_permitted" } }), {
              status: 403,
            })
          : response(),
      );
      await operation.mock.results[0]!.value.catch(() => undefined);
      await el.updateComplete;
      el.canManage = true;
      await el.updateComplete;
      expect(q(el, "download-document")).toBeNull();
      expect(q<WtDialog>(el, "confirm-dialog")!.open).toBe(false);
      expect(q<HTMLElementTagNameMap["wt-form-actions"]>(el, "document-error")!.error).toBe("");
      expect(q<WtButton>(el, "new-document")!.disabled).toBe(false);
    }
  },
);

it("clears a refusal on cancel and allows a fresh confirmation", async () => {
  const { el, fetcher } = await mount(
    vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify({ error: { code: "recovery.pack_invalid" } }), { status: 400 }),
      ),
  );
  await create(el);
  await vi.waitFor(() =>
    expect(q<HTMLElementTagNameMap["wt-form-actions"]>(el, "document-error")!.error).toBeTruthy(),
  );
  await click(el, "cancel-document");
  await click(el, "new-document");
  expect(q<HTMLElementTagNameMap["wt-form-actions"]>(el, "document-error")!.error).toBe("");
  expect(fetcher).toHaveBeenCalledTimes(1);
});

it("admits one replacement at a time and discards a reply after removal", async () => {
  let resolve!: (response: Response) => void;
  const fetcher = vi.fn(
    () =>
      new Promise<Response>((yes) => {
        resolve = yes;
      }),
  );
  const { el } = await mount(fetcher);
  const operation = vi.spyOn(el.api, "reissueRecoveryDocument");
  await create(el);
  expect(q<WtButton>(el, "confirm-document")!.disabled).toBe(true);
  await userEvent.keyboard("{Escape}");
  expect(q<WtDialog>(el, "confirm-dialog")!.shadowRoot!.querySelector("dialog")!.open).toBe(true);
  q<WtButton>(el, "confirm-document")!.dispatchEvent(new MouseEvent("click"));
  expect(fetcher).toHaveBeenCalledTimes(1);
  const parent = el.parentNode!;
  el.remove();
  resolve(response());
  await operation.mock.results[0]!.value;
  await el.updateComplete;
  parent.append(el);
  await el.updateComplete;
  expect(q(el, "download-document")).toBeNull();
  expect(q<WtButton>(el, "new-document")!.disabled).toBe(false);
});

it("releases retained bytes on removal", async () => {
  const { el } = await mount();
  await create(el);
  await vi.waitFor(() => expect(q(el, "download-document")).not.toBeNull());
  const href = q<HTMLAnchorElement>(el, "download-document")!.href;
  el.remove();
  await expect(fetch(href)).rejects.toThrow();
});

it("offers no controls without system.manage and discards delivery when permission is removed", async () => {
  const { el, fetcher } = await mount(undefined, false);
  expect(q(el, "new-document")).toBeNull();
  expect(fetcher).not.toHaveBeenCalled();
  el.canManage = true;
  await el.updateComplete;
  await create(el);
  await vi.waitFor(() => expect(q(el, "download-document")).not.toBeNull());
  const href = q<HTMLAnchorElement>(el, "download-document")!.href;
  el.canManage = false;
  await el.updateComplete;
  expect(q(el, "new-document")).toBeNull();
  expect(q(el, "download-document")).toBeNull();
  await expect(fetch(href)).rejects.toThrow();
});
