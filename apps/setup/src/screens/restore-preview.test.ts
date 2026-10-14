import { LitElement } from "lit";
import { afterEach, expect, it, vi } from "vitest";
import { SetupApi } from "../api/client.js";
import { setLocale } from "../i18n/t.js";
import { cleanupWidgets, mountWidget } from "../widgets/test-helpers.js";
import { SetupRestoreScreen } from "./restore-screen.js";

const saved = {
  sourceId: "selected-copy",
  createdAt: "2026-10-01T08:00:00.000Z",
  environment: "production",
  nodeId: "saved-node",
  nodeRecoveryKeyName: "Amber Hill",
  taxpayer: { legalName: "Saved venue", taxId: "89890001K" },
  locationName: "Saved location",
};
afterEach(() => {
  cleanupWidgets();
  setLocale("en-GB");
});
const child = (screen: SetupRestoreScreen) =>
  screen.shadowRoot!.querySelector<LitElement>("setup-recovery-copy");
async function fill(
  screen: SetupRestoreScreen,
  file = new File(["encrypted-copy"], "selected.backup"),
  key = "archive-secret",
) {
  const picker = screen.shadowRoot!.querySelector<HTMLInputElement>("[data-test=artifact]")!;
  const files = new DataTransfer();
  files.items.add(file);
  picker.files = files.files;
  picker.dispatchEvent(new Event("change"));
  const input = screen
    .shadowRoot!.querySelector("[data-test=recovery-key]")!
    .shadowRoot!.querySelector<HTMLInputElement>("input")!;
  input.value = key;
  input.dispatchEvent(new Event("input"));
  await screen.updateComplete;
  await child(screen)?.updateComplete;
}
async function mount(fetchImpl: typeof fetch) {
  const mounted = await mountWidget<SetupRestoreScreen>("setup-restore-screen", {});
  Object.assign(mounted.el, { api: new SetupApi("", fetchImpl) });
  await mounted.el.updateComplete;
  return mounted;
}
function review(screen: SetupRestoreScreen) {
  child(screen)!.shadowRoot!.querySelector<HTMLElement>("[data-test=preview]")!.click();
}
it("shows the selected backup's key name and date without exposing the archive encryption key", async () => {
  const { el } = await mount(async () => new Response(JSON.stringify(saved)));
  await fill(el);
  expect(child(el)).not.toBeNull();
  review(el);
  await vi.waitFor(() => expect(child(el)!.shadowRoot!.textContent).toContain("Amber Hill"));
  const text = child(el)!.shadowRoot!.textContent!;
  expect(text).toContain("2026-10-01");
  expect(text).toContain("Saved venue");
  expect(text).toContain("89890001K");
  expect(text).toContain("Saved location");
  expect(text).toContain("Keep older paper keys until no older backup remains.");
  expect(text).not.toContain("archive-secret");
  expect(child(el)!.outerHTML).not.toContain("archive-secret");
});
it("waits for a file and encryption key before it can review", async () => {
  const transport = vi.fn(async () => new Response(JSON.stringify(saved)));
  const { el } = await mount(transport);
  expect(child(el)).not.toBeNull();
  await child(el)!.updateComplete;
  const button = child(el)!.shadowRoot!.querySelector<HTMLElement & { disabled: boolean }>(
    "[data-test=preview]",
  )!;
  expect(button.disabled).toBe(true);
  review(el);
  expect(transport).not.toHaveBeenCalled();
  await fill(el);
  expect(button.disabled).toBe(false);
});
it.each(["file", "key", "environment"])(
  "drops the old copy's preview when its %s changes during the read",
  async (changed) => {
    let resolve!: (response: Response) => void;
    const pending = new Promise<Response>((done) => {
      resolve = done;
    });
    const transport = vi.fn(() => pending);
    const { el } = await mount(transport);
    await fill(el);
    review(el);
    await vi.waitFor(() => expect(transport).toHaveBeenCalledTimes(1));
    if (changed === "environment") {
      el.shadowRoot!.querySelector("[data-test=environment]")!.dispatchEvent(
        new CustomEvent("wt-change", { detail: { value: "preproduction" } }),
      );
      await el.updateComplete;
    } else
      await fill(
        el,
        changed === "key"
          ? el.shadowRoot!.querySelector<HTMLInputElement>("[data-test=artifact]")!.files![0]
          : new File(["other-copy"], "other.backup"),
        changed === "key" ? "different-key" : "archive-secret",
      );
    await child(el)!.updateComplete;
    const response = new Response(JSON.stringify(saved));
    const read = vi.spyOn(response, "json");
    resolve(response);
    await vi.waitFor(() => expect(read).toHaveBeenCalledOnce());
    await read.mock.results[0]!.value;
    await child(el)!.updateComplete;
    expect(child(el)!.shadowRoot!.textContent).not.toContain("Amber Hill");
  },
);
it("discards a late response after leaving the screen", async () => {
  let resolve!: (response: Response) => void;
  const transport = vi.fn(
    () =>
      new Promise<Response>((done) => {
        resolve = done;
      }),
  );
  const { el, host } = await mount(transport);
  await fill(el);
  const preview = child(el)!;
  review(el);
  await vi.waitFor(() => expect(transport).toHaveBeenCalledTimes(1));
  host.remove();
  const response = new Response(JSON.stringify(saved));
  const read = vi.spyOn(response, "json");
  resolve(response);
  await vi.waitFor(() => expect(read).toHaveBeenCalledOnce());
  await read.mock.results[0]!.value;
  await preview.updateComplete;
  expect(preview.shadowRoot!.textContent).not.toContain("Amber Hill");
});
it("keeps an unnamed old key explicit and updates its warnings after a language change", async () => {
  const { el } = await mount(
    async () => new Response(JSON.stringify({ ...saved, nodeRecoveryKeyName: null })),
  );
  await fill(el);
  review(el);
  await vi.waitFor(() =>
    expect(child(el)!.shadowRoot!.textContent).toContain(
      "This backup's node key has no stored name.",
    ),
  );
  setLocale("es-ES");
  await child(el)!.updateComplete;
  expect(child(el)!.shadowRoot!.textContent).toContain(
    "La clave del nodo de esta copia no tiene nombre guardado.",
  );
});
it("shows a refusal beside the review action and allows another attempt", async () => {
  const transport = vi
    .fn()
    .mockResolvedValueOnce(
      new Response(JSON.stringify({ error: { code: "recovery.passphrase_invalid" } }), {
        status: 422,
      }),
    )
    .mockResolvedValue(new Response(JSON.stringify(saved)));
  const { el } = await mount(transport);
  await fill(el);
  review(el);
  await vi.waitFor(() =>
    expect(
      child(el)!.shadowRoot!.querySelector("wt-form-actions")!.shadowRoot!.textContent,
    ).toContain("Check the backup file's encryption key."),
  );
  expect(
    el.shadowRoot!.querySelector<HTMLElement & { error: string }>("[data-test=recovery-key]")!
      .error,
  ).toBe("Check the backup file's encryption key.");
  review(el);
  await vi.waitFor(() => expect(child(el)!.shadowRoot!.textContent).toContain("Amber Hill"));
});
