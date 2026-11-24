import { LitElement } from "lit";
import type { WtFileInput } from "@waitron/ui";
import { afterEach, expect, it, vi } from "vitest";
import { SetupApi } from "../api/client.js";
import { setLocale, t } from "../i18n/t.js";
import { chooseFiles } from "@waitron/ui/src/test-helpers.js";
import { cleanupWidgets, mountWidget } from "../widgets/test-helpers.js";
import { SetupRestoreScreen } from "./restore-screen.js";

const saved = {
  sourceId: "selected-copy",
  createdAt: "2026-10-01T08:00:00.000Z",
  environment: "production",
  nodeId: "saved-node",
  nodeRecoveryKeyName: "Amber Hill",
  taxpayer: { legalName: "Saved venue", taxId: "89890001K" },
  venueName: "Saved venue",
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
  chooseFiles(screen.shadowRoot!.querySelector("[data-test=artifact]")!, file);
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
  expect(text).toContain("Saved venue");
  expect(text).not.toContain(t("restore.preview_older_key"));
  expect(text).not.toContain(t("restore.preview_keep_keys"));
  expect(text).not.toContain(t("restore.preview_key_separate"));
  expect(text).not.toContain("archive-secret");
  expect(child(el)!.outerHTML).not.toContain("archive-secret");
});
it.each([
  [
    "en-GB",
    "An older backup brings back its older master key.",
    "Keep older master keys until no older backup remains.",
    "The backup encryption key opens the copy. The master key authorises recovery.",
  ],
  [
    "es-ES",
    "Una copia antigua recupera la clave maestra de entonces.",
    "Conserva las claves maestras antiguas mientras queden copias que las necesiten.",
    "La clave de cifrado de copias abre la copia. La clave maestra autoriza la restauración.",
  ],
] as const)(
  "tells the %s review of a filing backup that the master key authorises recovery",
  async (locale, older, keep, separate) => {
    setLocale(locale);
    const { el } = await mount(
      async () =>
        new Response(
          JSON.stringify({
            ...saved,
            fiscalSelection: {
              module: "fiscal-verifactu",
              country: "ES",
              fiscalTerritory: "common",
              timeZone: "Europe/Madrid",
            },
          }),
        ),
    );
    await fill(el);
    review(el);
    await vi.waitFor(() => expect(child(el)!.shadowRoot!.textContent).toContain("Amber Hill"));
    const text = child(el)!.shadowRoot!.textContent!.replace(/\s+/g, " ");
    expect(text).toContain(older);
    expect(text).toContain(keep);
    expect(text).toContain(separate);
  },
);
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
it.each(["en-GB", "es-ES"] as const)(
  "shows the sheet's short grouped node ID in the %s backup preview",
  async (locale) => {
    setLocale(locale);
    const savedNode = "3262bf78-1d78-4b10-bae6-61fda564d5e8";
    const { el } = await mount(
      async () => new Response(JSON.stringify({ ...saved, nodeId: savedNode })),
    );
    await fill(el);
    review(el);
    await vi.waitFor(() => expect(child(el)!.shadowRoot!.textContent).toContain("3262 BF78"));
    const text = child(el)!.shadowRoot!.textContent!;
    expect(text).toContain(locale === "en-GB" ? "Node" : "Nodo");
    expect(text).toContain("Amber Hill");
    expect(text).not.toContain(savedNode);
    const allocation = child(el)!.shadowRoot!.querySelector<LitElement & { preview: typeof saved }>(
      "setup-recovery-allocation",
    )!;
    expect(allocation.preview.nodeId).toBe(savedNode);
  },
);
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
          ? el.shadowRoot!.querySelector<WtFileInput>("[data-test=artifact]")!.files[0]!
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
it("refuses a filing backup that holds no master key beside the review action, offering no key entry, in both languages", async () => {
  const { el } = await mount(
    async () =>
      new Response(
        JSON.stringify({
          ...saved,
          nodeRecoveryKeyName: null,
          fiscalSelection: {
            module: "fiscal-verifactu",
            country: "ES",
            fiscalTerritory: "common",
            timeZone: "Europe/Madrid",
          },
        }),
      ),
  );
  await fill(el);
  review(el);
  const actions = () =>
    child(el)!.shadowRoot!.querySelector("wt-form-actions")!.shadowRoot!.textContent;
  await vi.waitFor(() =>
    expect(actions()).toContain(
      "This backup holds no master key, so it cannot be restored. Choose a newer backup.",
    ),
  );
  expect(child(el)!.shadowRoot!.querySelector("[data-test=selected-copy]")).toBeNull();
  expect(child(el)!.shadowRoot!.querySelector("setup-recovery-allocation")).toBeNull();
  setLocale("es-ES");
  await child(el)!.updateComplete;
  expect(actions()).toContain(
    "Esta copia no contiene clave maestra, así que no se puede restaurar. Elige una copia más reciente.",
  );
});
it("shows a backup that files nothing and holds no master key without a key row", async () => {
  const { el } = await mount(
    async () => new Response(JSON.stringify({ ...saved, nodeRecoveryKeyName: null })),
  );
  await fill(el);
  review(el);
  await vi.waitFor(() => expect(child(el)!.shadowRoot!.textContent).toContain("Saved venue"));
  const copy = child(el)!.shadowRoot!.querySelector("[data-test=selected-copy]")!;
  expect([...copy.querySelectorAll("dt")].map((term) => term.textContent)).not.toContain(
    t("restore.preview_node_key"),
  );
  expect(copy.textContent).not.toContain("master key");
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
    ).toContain("Check the backup encryption key."),
  );
  expect(
    el.shadowRoot!.querySelector<HTMLElement & { error: string }>("[data-test=recovery-key]")!
      .error,
  ).toBe("Check the backup encryption key.");
  review(el);
  await vi.waitFor(() => expect(child(el)!.shadowRoot!.textContent).toContain("Amber Hill"));
});

it.each(["en-GB", "es-ES"])(
  "explains capacity when reviewing an uploaded backup (%s)",
  async (locale) => {
    setLocale(locale);
    const { el } = await mount(async () =>
      Response.json({ error: { code: "restore.archive_resource_limit" } }, { status: 507 }),
    );
    await fill(el);
    review(el);
    await vi.waitFor(() => {
      const actions = child(el)!.shadowRoot!.querySelector("wt-form-actions")!;
      expect(actions.shadowRoot!.querySelector("[data-error]")?.textContent).toContain(
        t("shell.restore.archive_resource_limit"),
      );
    });
    expect(child(el)!.shadowRoot!.querySelector("[data-test=selected-copy]")).toBeNull();
  },
);
it("explains an interrupted review upload and keeps the selected file for retry", async () => {
  const { el } = await mount(async () => new Response("Request Timeout", { status: 408 }));
  await fill(el);
  review(el);
  await expect
    .poll(() => child(el)!.shadowRoot!.querySelector("wt-form-actions")!.shadowRoot!.textContent)
    .toContain(
      "The backup upload did not finish. Connect this device by cable or to the venue’s network, then try again.",
    );
  expect(child(el)!.shadowRoot!.querySelector("[data-test=selected-copy]")).toBeNull();
});
