import { afterEach, describe, expect, it, vi } from "vitest";
import { userEvent } from "vitest/browser";
import { encodeMasterKeyCode } from "@waitron/shared";
import type { WtDialog, WtMasterKeyInput } from "@waitron/ui";
import { MASTER_KEY_FIELD_WORDS } from "@waitron/recovery-pack/src/i18n/master-key-field.js";
import { DashboardApi } from "../api/client.js";
import type { MadeRecoveryPack, RecoveryPackStatus } from "../api/backup-api.js";
import { createFreshSignInGate } from "../api/fresh-sign-in.js";
import { codeMessage } from "../i18n/codes.js";
import { fill, setLocale, t } from "../i18n/t.js";
import { en, es } from "../i18n/strings.js";
import { cleanupWidgets, dialogClosed, mountWidget } from "./test-helpers.js";
import type {
  RecoveryPackDialog,
  RecoveryPackDialogKind,
  RecoveryPackMade,
} from "./recovery-pack-dialog.js";
import "./recovery-pack-dialog.js";

const MADE_AT = "2026-10-12T12:00:00.000Z";

function status(overrides: Partial<RecoveryPackStatus> = {}): RecoveryPackStatus {
  return {
    latest: null,
    upToDate: false,
    incomplete: false,
    unreceived: null,
    reasons: [],
    keep: [],
    backupsUseOlderKey: false,
    masterKey: null,
    keepOldPackUntil: "2026-11-11T12:00:00.000Z",
    timeZone: "Europe/Madrid",
    backupKey: null,
    ...overrides,
  };
}

/** The current master key was shown on pack 3, which a browser confirmed receiving. */
const HELD = status({ masterKey: { name: "2026-10-12 · QZJV", pack: 3 } });

/** A whole master key, as the pack prints it. */
const TYPED = encodeMasterKeyCode(new Uint8Array(16).fill(7));

function pdf(): Blob {
  return new Blob(["%PDF-1.7 pack"], { type: "application/pdf" });
}

function stubApi() {
  return {
    makeRecoveryPack: vi.fn<(body: unknown) => Promise<MadeRecoveryPack>>().mockResolvedValue({
      pdf: pdf(),
      number: 4,
      madeAt: "2026-10-30T09:00:00.000Z",
    }),
    markRecoveryPackReceived: vi
      .fn<(n: number, masterKey?: string, signal?: AbortSignal) => Promise<void>>()
      .mockResolvedValue(undefined),
    getRecoveryPackStatus: vi.fn<() => Promise<RecoveryPackStatus>>().mockResolvedValue(status()),
  };
}

type Api = ReturnType<typeof stubApi>;

async function open(
  options: { api?: Api; at?: RecoveryPackStatus; kind?: RecoveryPackDialogKind } = {},
) {
  const api = options.api ?? stubApi();
  const { el } = await mountWidget<RecoveryPackDialog>("dashboard-recovery-pack-dialog", {
    api: api as unknown as DashboardApi,
  });
  el.show(options.at ?? status(), options.kind ?? "pack");
  await el.updateComplete;
  const dialog = el.shadowRoot!.querySelector<WtDialog>("wt-dialog")!;
  await expect.poll(() => dialog.open).toBe(true);
  return { el, api, dialog };
}

/** A part of the dialog's master key box: its key, name, buttons and what they say. */
function inBox(el: RecoveryPackDialog, name: string) {
  return (
    el
      .shadowRoot!.querySelector("wt-master-key-box")
      ?.shadowRoot!.querySelector<HTMLElement>(`[data-test=${name}]`) ?? null
  );
}

function button(el: RecoveryPackDialog, test: string) {
  return el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-button"]>(
    `wt-button[data-test=${test}]`,
  );
}

function field(el: RecoveryPackDialog) {
  return el.shadowRoot!.querySelector<WtMasterKeyInput>("wt-master-key-input");
}

/** Types into the master key field as a person does, through its own input. */
async function type(el: RecoveryPackDialog, text: string = TYPED) {
  const input = field(el)!.shadowRoot!.querySelector<
    HTMLElement & { updateComplete: Promise<unknown> }
  >("wt-input")!;
  await input.updateComplete;
  input.dispatchEvent(
    new CustomEvent("wt-change", { detail: { value: text }, bubbles: true, composed: true }),
  );
  await field(el)!.updateComplete;
  await el.updateComplete;
}

/** The focused element, looked for through every shadow root on the way down. */
function focused(): Element | null {
  let at = document.activeElement;
  while (at?.shadowRoot?.activeElement) at = at.shadowRoot.activeElement;
  return at;
}

function words(node: Element | null | undefined): string {
  return (node?.textContent ?? "").replace(/\s+/g, " ").trim();
}

function bottom(el: RecoveryPackDialog): string {
  return el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-form-actions"]>("wt-form-actions")!
    .error;
}

function made(el: RecoveryPackDialog) {
  const seen: RecoveryPackMade[] = [];
  el.addEventListener("recovery-pack-made", (event) =>
    seen.push((event as CustomEvent<RecoveryPackMade>).detail),
  );
  return seen;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

afterEach(cleanupWidgets);
afterEach(() => vi.restoreAllMocks());
afterEach(() => setLocale("en-GB"));

describe("the form", () => {
  it.each([
    [
      "en-GB",
      "Print the recovery pack",
      "Type your master key to print a new copy of the recovery pack.",
      "Cancel",
    ],
    [
      "es-ES",
      "Imprimir el paquete de recuperación",
      "Escribe tu clave maestra para imprimir una copia nueva del paquete de recuperación.",
      "Cancelar",
    ],
  ] as const)(
    "draws Print in %s: its text, the required master key field named for the current key, Cancel, and Print off until a whole key is typed",
    async (locale, heading, text, cancel) => {
      setLocale(locale);
      const { el, dialog } = await open({ at: HELD });
      expect(dialog.heading).toBe(heading);
      expect(words(el.shadowRoot!.querySelector("[data-test=intro]"))).toBe(text);
      expect(el.shadowRoot!.querySelector("dashboard-fresh-sign-in")).toBeNull();
      expect(el.shadowRoot!.querySelector("[data-test=note]")).toBeNull();
      expect(field(el)!.required).toBe(true);
      expect(field(el)!.keyName).toBe("2026-10-12 · QZJV");
      expect(button(el, "cancel-pack")!.slot).toBe("cancel");
      expect(words(button(el, "cancel-pack"))).toBe(cancel);
      expect(words(button(el, "make-pack"))).toBe(heading);
      expect(button(el, "make-pack")!.disabled).toBe(true);
      await type(el, TYPED.slice(0, 10));
      expect(button(el, "make-pack")!.disabled).toBe(true);
      await type(el);
      expect(button(el, "make-pack")!.disabled).toBe(false);
      expect(button(el, "make-pack")!.variant).toBe("primary");
    },
  );

  it("Print sends the locale and the typed master key, and nothing about a new key", async () => {
    const { el, api } = await open({ at: HELD });
    await type(el);
    button(el, "make-pack")!.click();
    await expect.poll(() => api.makeRecoveryPack.mock.calls.length).toBe(1);
    expect(api.makeRecoveryPack.mock.calls[0]![0]).toEqual({ locale: "en", masterKey: TYPED });
  });

  it.each([
    ["en-GB", MASTER_KEY_FIELD_WORDS.en.wrongKey("2026-10-12 · QZJV")],
    ["es-ES", MASTER_KEY_FIELD_WORDS.es.wrongKey("2026-10-12 · QZJV")],
  ] as const)("a wrong key shows the field's line naming the key (%s)", async (locale, line) => {
    setLocale(locale);
    const api = stubApi();
    api.makeRecoveryPack.mockRejectedValue({
      code: "master_key.wrong",
      params: { keyName: "2026-10-12 · QZJV" },
      status: 403,
    });
    const { el } = await open({ api, at: HELD });
    await type(el);
    button(el, "make-pack")!.click();
    await expect.poll(() => field(el)!.error).toBe(line);
    expect(bottom(el)).toBe("");
    expect(el.shadowRoot!.querySelector("[data-test=lost]")).toBeNull();
    expect(api.markRecoveryPackReceived).not.toHaveBeenCalled();
    await type(el, encodeMasterKeyCode(new Uint8Array(16).fill(9)));
    expect(field(el)!.error).toBe("");
  });

  it("a wrong key the box names no key for says the venue has no master key yet", async () => {
    const api = stubApi();
    api.makeRecoveryPack.mockRejectedValue({
      code: "master_key.wrong",
      params: {},
      status: 403,
    });
    const { el } = await open({ api, at: HELD });
    await type(el);
    button(el, "make-pack")!.click();
    await expect.poll(() => field(el)!.error).toBe(codeMessage("master_key.wrong"));
  });

  it.each([
    [
      "en-GB",
      "Too many recovery requests are running or have arrived recently. Wait a minute and try again, or choose Cancel.",
    ],
    [
      "es-ES",
      "Hay demasiadas solicitudes de recuperación en curso o recientes. Espera un minuto e inténtalo de nuevo, o elige Cancelar.",
    ],
  ] as const)("too many tries are worded on the form's own line (%s)", async (locale, line) => {
    setLocale(locale);
    const api = stubApi();
    api.makeRecoveryPack.mockRejectedValue({ code: "recovery.rate_limited", status: 429 });
    const { el } = await open({ api, at: HELD });
    await type(el);
    button(el, "make-pack")!.click();
    await expect.poll(() => bottom(el)).toBe(line);
    expect(field(el)!.error).toBe("");
    expect(button(el, "make-pack")!.disabled).toBe(false);
  });

  it.each([
    [
      "en-GB",
      "Make a new master key?",
      "Do this only if the master key is lost, or someone who should not have it may have seen it. Backups made before now still need the old key. Keep the old pack until 23 December 2026. The new key is shown once, in a new recovery pack.",
      "Make a new master key",
      "Stop",
    ],
    [
      "es-ES",
      "¿Crear una clave maestra nueva?",
      "Hazlo solo si la clave maestra se ha perdido o si alguien que no debía ha podido verla. Las copias anteriores siguen necesitando la clave antigua. Guarda el paquete antiguo hasta el 23 de diciembre de 2026. La clave nueva se muestra una sola vez, en un paquete de recuperación nuevo.",
      "Crear una clave maestra nueva",
      "Parar",
    ],
  ] as const)(
    "Make a new master key asks first, in %s, with the day to keep the old pack until",
    async (locale, heading, text, make, stop) => {
      setLocale(locale);
      const { el, dialog, api } = await open({
        at: status({ keepOldPackUntil: "2026-12-23T12:00:00.000Z" }),
        kind: "master-key",
      });
      expect(dialog.heading).toBe(heading);
      expect(words(el.shadowRoot!.querySelector("[data-test=intro]"))).toBe(text);
      expect(el.shadowRoot!.querySelector("[data-test=note]")).toBeNull();
      expect(words(button(el, "make-pack"))).toBe(make);
      expect(button(el, "make-pack")!.variant).toBe("danger");
      expect(words(button(el, "cancel-pack"))).toBe(stop);
      expect(button(el, "cancel-pack")!.slot).toBe("cancel");
      expect(el.shadowRoot!.querySelector("input")).toBeNull();
      expect(api.makeRecoveryPack).not.toHaveBeenCalled();
    },
  );

  it.each([
    // 00:30 on 24 December at the venue; 23 December in any zone from UTC-11 to UTC+13.
    ["Pacific/Kiritimati", "2026-12-23T10:30:00.000Z", "24 December 2026"],
    // 23:30 on 23 December at the venue; 24 December in any zone from UTC to UTC+14.
    ["Pacific/Pago_Pago", "2026-12-24T10:30:00.000Z", "23 December 2026"],
  ])(
    "dates the keep day in the venue's zone (%s), not the browser's",
    async (timeZone, keepOldPackUntil, day) => {
      setLocale("en-GB");
      const { el } = await open({ at: status({ timeZone, keepOldPackUntil }), kind: "master-key" });
      expect(words(el.shadowRoot!.querySelector("[data-test=intro]"))).toContain(
        `Keep the old pack until ${day}.`,
      );
    },
  );

  it("Make a new master key sends newMasterKey and shows the key it answers", async () => {
    const api = stubApi();
    api.makeRecoveryPack.mockResolvedValue({
      pdf: pdf(),
      number: 4,
      madeAt: "2026-11-23T09:00:00.000Z",
      masterKey: { key: "88DP 74BA YPVB RRM5 XFV2 WPQY B5M5", name: "2026-11-23 · QZJV" },
    });
    const { el } = await open({ api, kind: "master-key" });
    button(el, "make-pack")!.click();
    await expect.poll(() => api.makeRecoveryPack.mock.calls.length).toBe(1);
    expect(api.makeRecoveryPack.mock.calls[0]![0]).toEqual({ locale: "en", newMasterKey: true });
    await expect.poll(() => inBox(el, "master-key")).not.toBeNull();
    expect(words(inBox(el, "master-key"))).toBe("88DP 74BA YPVB RRM5 XFV2 WPQY B5M5");
  });
});

describe("the new master key", () => {
  const KEY = "88DP 74BA YPVB RRM5 XFV2 WPQY B5M5";
  const NAME = "2026-11-23 · QZJV";

  async function shown(locale: "en-GB" | "es-ES" = "en-GB") {
    setLocale(locale);
    const api = stubApi();
    api.makeRecoveryPack.mockResolvedValue({
      pdf: pdf(),
      number: 4,
      madeAt: "2026-11-23T09:00:00.000Z",
      masterKey: { key: KEY, name: NAME },
    });
    const opened = await open({ api, kind: "master-key" });
    const seen = made(opened.el);
    button(opened.el, "make-pack")!.click();
    await expect.poll(() => inBox(opened.el, "master-key")).not.toBeNull();
    return { ...opened, seen };
  }

  it.each([
    [
      "en-GB",
      "Recovery pack",
      "Download or print the recovery pack, then keep it somewhere safe, away from this box.",
      "This is the only time the master key is shown.",
      `Master key · ${NAME}`,
      ["Download", "Print", "Copy"],
    ],
    [
      "es-ES",
      "Paquete de recuperación",
      "Descarga o imprime el paquete de recuperación y guárdalo en un lugar seguro, lejos de este servidor.",
      "Esta es la única vez que se muestra la clave maestra.",
      `Clave maestra · ${NAME}`,
      ["Descargar", "Imprimir", "Copiar"],
    ],
  ] as const)(
    "on success shows the new key with Download, Print and Copy, as setup's last step does (%s)",
    async (locale, heading, lead, warning, name, labels) => {
      const { el, dialog, seen } = await shown(locale);
      expect(dialog.open).toBe(true);
      expect(dialog.heading).toBe(heading);
      const root = el.shadowRoot!;
      expect(words(root.querySelector("[data-test=shown-lead]"))).toBe(lead);
      expect(words(root.querySelector("[data-test=shown-warning]"))).toBe(warning);
      expect(words(inBox(el, "master-key-name"))).toBe(name);
      expect(inBox(el, "master-key")!.textContent).toBe(KEY);
      expect(["download", "print", "copy"].map((b) => words(inBox(el, b)))).toEqual(labels);
      expect(button(el, "key-continue")).toBeNull();
      expect(button(el, "make-pack")).toBeNull();
      expect(seen).toHaveLength(1);
      expect(seen[0]).toMatchObject({ number: 4, received: true });
    },
  );

  it("Copy puts the key on the clipboard exactly as printed and says Copied., but Continue waits for Download or Print", async () => {
    const write = vi.spyOn(navigator.clipboard, "writeText").mockResolvedValue(undefined);
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    const { el, dialog } = await shown();
    inBox(el, "copy")!.click();
    await expect.poll(() => inBox(el, "copied")).not.toBeNull();
    expect(write).toHaveBeenCalledWith(KEY);
    expect(words(inBox(el, "copied"))).toBe(t("master_key_shown.copied"));
    await el.updateComplete;
    expect(button(el, "key-continue")).toBeNull();
    inBox(el, "download")!.click();
    await expect.poll(() => button(el, "key-continue")).not.toBeNull();
    expect(words(button(el, "key-continue"))).toBe(t("master_key_shown.continue"));
    const closed = dialogClosed(dialog);
    button(el, "key-continue")!.click();
    await closed;
    expect(dialog.open).toBe(false);
    expect(inBox(el, "master-key")).toBeNull();
  });

  it("a Copy the browser refuses says so and counts for nothing", async () => {
    vi.spyOn(navigator.clipboard, "writeText").mockRejectedValue(new Error("denied"));
    const { el } = await shown();
    inBox(el, "copy")!.click();
    await expect.poll(() => inBox(el, "copy-failed")).not.toBeNull();
    expect(words(inBox(el, "copy-failed"))).toBe(t("master_key_shown.copy_failed"));
    expect(inBox(el, "copied")).toBeNull();
    expect(button(el, "key-continue")).toBeNull();
  });

  it("a Print the browser blocks says so where a refused Copy does, and counts for nothing", async () => {
    vi.spyOn(window, "open").mockReturnValue(null);
    const { el } = await shown();
    inBox(el, "print")!.click();
    await expect.poll(() => inBox(el, "print-failed")).not.toBeNull();
    expect(words(inBox(el, "print-failed"))).toBe(
      "Your browser blocked printing. Use Download instead.",
    );
    expect(button(el, "key-continue")).toBeNull();
  });

  it("Download saves the pack and Print opens it, each then offering Continue", async () => {
    const opened = vi.spyOn(window, "open").mockReturnValue({} as Window);
    const clicked: { href: string; download: string }[] = [];
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (
      this: HTMLAnchorElement,
    ) {
      clicked.push({ href: this.href, download: this.download });
    });
    const first = await shown();
    inBox(first.el, "download")!.click();
    await expect.poll(() => button(first.el, "key-continue")).not.toBeNull();
    expect(clicked).toEqual([
      { href: expect.stringMatching(/^blob:/), download: "waitron-recovery-pack-4.pdf" },
    ]);
    expect(await (await fetch(clicked[0]!.href)).text()).toBe("%PDF-1.7 pack");
    cleanupWidgets();
    const second = await shown();
    inBox(second.el, "print")!.click();
    await expect.poll(() => button(second.el, "key-continue")).not.toBeNull();
    expect(opened).toHaveBeenCalledWith(expect.stringMatching(/^blob:/), "_blank");
  });

  it("asks for a fresh sign-in through the shared gate, then shows the key the resent make returns", async () => {
    const prompt = vi.fn(async () => true);
    let makes = 0;
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const call = `${init?.method ?? "GET"} ${String(input)}`;
      if (call === "POST /api/backup/recovery-pack" && makes++ === 0)
        return new Response(
          JSON.stringify({ error: { code: "management_session.proof_required" } }),
          {
            status: 400,
            headers: { "Content-Type": "application/json" },
          },
        );
      if (call === "POST /api/backup/recovery-pack")
        return new Response("%PDF-1.7 pack\n%%EOF\n", {
          status: 200,
          headers: {
            "Content-Type": "application/pdf",
            "X-Waitron-Recovery-Pack": "4",
            "X-Waitron-Recovery-Pack-Made-At": "2026-11-23T09:00:00.000Z",
            "X-Waitron-Master-Key": KEY,
            "X-Waitron-Master-Key-Name": encodeURIComponent(NAME),
          },
        });
      if (call === "POST /api/backup/recovery-pack/4/received")
        return new Response(null, { status: 204 });
      throw new Error(`Unexpected request: ${call}`);
    });
    const api = new DashboardApi("", fetchImpl as typeof fetch, undefined, undefined, false, {
      freshSignIn: createFreshSignInGate({ sessionGeneration: () => 0, prompt }),
    });
    const { el } = await mountWidget<RecoveryPackDialog>("dashboard-recovery-pack-dialog", { api });
    el.show(status(), "master-key");
    await el.updateComplete;
    button(el, "make-pack")!.click();
    await expect.poll(() => inBox(el, "master-key")).not.toBeNull();
    expect(prompt).toHaveBeenCalledOnce();
    expect(makes).toBe(2);
    expect(inBox(el, "master-key")!.textContent).toBe(KEY);
    expect(words(inBox(el, "master-key-name"))).toBe(`Master key · ${NAME}`);
  });

  it("shows no key when the box answered without one, and closes as a made pack", async () => {
    const { el, dialog } = await open({ kind: "master-key" });
    const seen = made(el);
    button(el, "make-pack")!.click();
    await expect.poll(() => seen.length).toBe(1);
    await expect.poll(() => dialog.open).toBe(false);
    expect(inBox(el, "master-key")).toBeNull();
  });
});

describe("confirming the new master key", () => {
  const KEY = "88DP 74BA YPVB RRM5 XFV2 WPQY B5M5";
  const NAME = "2026-11-23 · QZJV";
  const lost = { code: "connection.failed" };

  /** Makes a new master key whose confirm fails twice, then waits for the dialog to settle. */
  async function unconfirmed(
    after: RecoveryPackStatus | Error,
    settled: string,
    locale: "en-GB" | "es-ES" = "en-GB",
  ) {
    setLocale(locale);
    const api = stubApi();
    api.makeRecoveryPack.mockResolvedValue({
      pdf: pdf(),
      number: 4,
      madeAt: "2026-11-23T09:00:00.000Z",
      masterKey: { key: KEY, name: NAME },
    });
    api.markRecoveryPackReceived.mockRejectedValueOnce(lost).mockRejectedValueOnce(lost);
    if (after instanceof Error) api.getRecoveryPackStatus.mockRejectedValue(after);
    else api.getRecoveryPackStatus.mockResolvedValue(after);
    const opened = await open({ api, at: HELD, kind: "master-key" });
    const seen = made(opened.el);
    button(opened.el, "make-pack")!.click();
    await expect
      .poll(() => opened.el.shadowRoot!.querySelector(`[data-test=${settled}]`))
      .not.toBeNull();
    await opened.el.updateComplete;
    return { ...opened, seen };
  }

  it("sends back the key it was shown, and hands the card the PDF only once the box confirms", async () => {
    const api = stubApi();
    api.makeRecoveryPack.mockResolvedValue({
      pdf: pdf(),
      number: 4,
      madeAt: "2026-11-23T09:00:00.000Z",
      masterKey: { key: KEY, name: NAME },
    });
    const confirm = deferred<void>();
    api.markRecoveryPackReceived.mockReturnValue(confirm.promise);
    const { el } = await open({ api, kind: "master-key" });
    const seen = made(el);
    button(el, "make-pack")!.click();
    await expect.poll(() => api.markRecoveryPackReceived.mock.calls.length).toBe(1);
    expect(api.markRecoveryPackReceived).toHaveBeenCalledWith(4, KEY, expect.any(AbortSignal));
    await el.updateComplete;
    expect(seen).toEqual([]);
    confirm.resolve();
    await expect.poll(() => seen.length).toBe(1);
    expect(seen[0]).toMatchObject({ number: 4, received: true });
    await expect.poll(() => inBox(el, "master-key")?.textContent).toBe(KEY);
  });

  it("after two failed confirms, a status naming the new key as current shows it and hands the PDF over", async () => {
    const { el, api, seen } = await unconfirmed(
      status({ masterKey: { name: NAME, pack: 4 } }),
      "shown-lead",
    );
    expect(api.markRecoveryPackReceived.mock.calls).toEqual([
      [4, KEY, expect.any(AbortSignal)],
      [4, KEY, expect.any(AbortSignal)],
    ]);
    expect(api.getRecoveryPackStatus).toHaveBeenCalledOnce();
    expect(inBox(el, "master-key")!.textContent).toBe(KEY);
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({ number: 4, received: true });
  });

  it.each([
    [
      "en-GB",
      "The box did not take the new master key, so it kept the current one. Make a new master key tries again. Stop closes this window.",
    ],
    [
      "es-ES",
      "El servidor no aceptó la clave maestra nueva, así que sigue con la actual. Crear una clave maestra nueva lo vuelve a intentar. Parar cierra esta ventana.",
    ],
  ] as const)(
    "a status naming the old key, with nothing waiting, says the key was not kept (%s), shows no key, and the card receives no PDF",
    async (locale, text) => {
      const { el, seen } = await unconfirmed(HELD, "not-kept", locale);
      expect(words(el.shadowRoot!.querySelector("[data-test=not-kept]"))).toBe(text);
      expect(el.shadowRoot!.querySelector("[data-test=not-kept]")!.getAttribute("role")).toBe(
        "alert",
      );
      expect(el.shadowRoot!.querySelector("wt-master-key-box")).toBeNull();
      expect(words(button(el, "remake-pack"))).toBe(t("master_key_dialog.make"));
      expect(words(button(el, "stop-pack"))).toBe(t("master_key_dialog.stop"));
      expect(button(el, "retry-pack")).toBeNull();
      expect(seen).toEqual([]);
    },
  );

  it("Make a new master key from not kept goes back to the form", async () => {
    const { el } = await unconfirmed(HELD, "not-kept");
    button(el, "remake-pack")!.click();
    await el.updateComplete;
    expect(el.shadowRoot!.querySelector("[data-test=not-kept]")).toBeNull();
    expect(button(el, "make-pack")!.disabled).toBe(false);
  });

  it.each([
    [
      "en-GB",
      "The box may be using this new master key: this browser could not confirm it. Keep this pack, then choose Try again. Stop closes this window.",
      "Try again",
      "Stop",
    ],
    [
      "es-ES",
      "Puede que el servidor esté usando esta clave maestra nueva: este navegador no ha podido confirmarlo. Guarda este paquete y elige Volver a intentarlo. Parar cierra esta ventana.",
      "Volver a intentarlo",
      "Parar",
    ],
  ] as const)(
    "a key still waiting says it is not known (%s), shows the key with Download and Print, and the card receives no PDF",
    async (locale, text, retry, stop) => {
      const { el, seen } = await unconfirmed(
        status({ ...HELD, newKeyWaiting: true }),
        "not-known",
        locale,
      );
      expect(words(el.shadowRoot!.querySelector("[data-test=not-known]"))).toBe(text);
      expect(el.shadowRoot!.querySelector("[data-test=not-known]")!.getAttribute("role")).toBe(
        "alert",
      );
      expect(inBox(el, "master-key")!.textContent).toBe(KEY);
      expect(inBox(el, "download")).not.toBeNull();
      expect(inBox(el, "print")).not.toBeNull();
      expect(words(button(el, "retry-pack"))).toBe(retry);
      expect(words(button(el, "stop-pack"))).toBe(stop);
      expect(button(el, "remake-pack")).toBeNull();
      expect(seen).toEqual([]);
    },
  );

  it("a status naming a current key with the new key's name but another pack is not known, and the card receives no PDF", async () => {
    const { el, seen } = await unconfirmed(
      status({ masterKey: { name: NAME, pack: 3 } }),
      "not-known",
    );
    expect(el.shadowRoot!.querySelector("[data-test=not-kept]")).toBeNull();
    expect(el.shadowRoot!.querySelector("[data-test=shown-lead]")).toBeNull();
    expect(inBox(el, "master-key")!.textContent).toBe(KEY);
    expect(seen).toEqual([]);
  });

  it("drops the confirm's request when the dialog is removed while it is out", async () => {
    const api = stubApi();
    api.makeRecoveryPack.mockResolvedValue({
      pdf: pdf(),
      number: 4,
      madeAt: "2026-11-23T09:00:00.000Z",
      masterKey: { key: KEY, name: NAME },
    });
    api.markRecoveryPackReceived.mockReturnValue(new Promise(() => undefined));
    const { el } = await open({ api, kind: "master-key" });
    button(el, "make-pack")!.click();
    await expect.poll(() => api.markRecoveryPackReceived.mock.calls.length).toBe(1);
    const signal = api.markRecoveryPackReceived.mock.calls[0]![2]!;
    expect(signal.aborted).toBe(false);
    el.remove();
    expect(signal.aborted).toBe(true);
  });

  it.each(["not-kept", "not-known"] as const)(
    "moves focus to the %s message when it appears",
    async (settled) => {
      const { el } = await unconfirmed(
        settled === "not-kept" ? HELD : status({ ...HELD, newKeyWaiting: true }),
        settled,
      );
      await expect
        .poll(() => focused())
        .toBe(el.shadowRoot!.querySelector(`[data-test=${settled}]`));
    },
  );

  it("a Try again that fails again draws the not known message anew and focuses it", async () => {
    const { el, api } = await unconfirmed(status({ ...HELD, newKeyWaiting: true }), "not-known");
    const first = el.shadowRoot!.querySelector("[data-test=not-known]");
    api.markRecoveryPackReceived.mockRejectedValueOnce(lost).mockRejectedValueOnce(lost);
    button(el, "retry-pack")!.click();
    await expect.poll(() => api.getRecoveryPackStatus.mock.calls.length).toBe(2);
    await expect.poll(() => el.shadowRoot!.querySelector("[data-test=not-known]")).not.toBe(first);
    const again = el.shadowRoot!.querySelector("[data-test=not-known]");
    expect(again).not.toBeNull();
    await expect.poll(() => focused()).toBe(again);
  });

  it("an unreadable status is not known either, and the card receives no PDF", async () => {
    const { el, seen } = await unconfirmed(new Error("offline"), "not-known");
    expect(inBox(el, "master-key")!.textContent).toBe(KEY);
    expect(seen).toEqual([]);
  });

  it("Try again on not known confirms again, re-reads when that fails, and shows the key once a confirm succeeds", async () => {
    const { el, api, seen } = await unconfirmed(
      status({ ...HELD, newKeyWaiting: true }),
      "not-known",
    );
    api.markRecoveryPackReceived.mockRejectedValueOnce(lost).mockRejectedValueOnce(lost);
    button(el, "retry-pack")!.click();
    await expect.poll(() => api.getRecoveryPackStatus.mock.calls.length).toBe(2);
    await el.updateComplete;
    expect(api.markRecoveryPackReceived).toHaveBeenCalledTimes(4);
    expect(el.shadowRoot!.querySelector("[data-test=not-known]")).not.toBeNull();
    expect(seen).toEqual([]);
    button(el, "retry-pack")!.click();
    await expect.poll(() => seen.length).toBe(1);
    expect(api.markRecoveryPackReceived).toHaveBeenCalledTimes(5);
    expect(api.markRecoveryPackReceived).toHaveBeenLastCalledWith(4, KEY, expect.any(AbortSignal));
    expect(seen[0]).toMatchObject({ number: 4, received: true });
    await expect.poll(() => el.shadowRoot!.querySelector("[data-test=shown-lead]")).not.toBeNull();
    expect(el.shadowRoot!.querySelector("[data-test=not-known]")).toBeNull();
    expect(inBox(el, "master-key")!.textContent).toBe(KEY);
  });
});

describe("a made pack", () => {
  it("marks the pack received, then hands the PDF over and closes", async () => {
    const { el, api, dialog } = await open({ kind: "master-key" });
    const order: string[] = [];
    api.markRecoveryPackReceived.mockImplementation(async () => {
      order.push("marked");
    });
    el.addEventListener("recovery-pack-made", () => order.push("handed"));
    const seen = made(el);
    const closeAfter = vi.spyOn(dialog, "closeAfter");
    button(el, "make-pack")!.click();
    await expect.poll(() => seen.length).toBe(1);
    expect(api.makeRecoveryPack).toHaveBeenCalledWith({
      locale: "en",
      newMasterKey: true,
    });
    expect(api.markRecoveryPackReceived).toHaveBeenCalledWith(4);
    expect(order).toEqual(["marked", "handed"]);
    expect(seen[0]).toEqual({
      pdf: expect.any(Blob),
      number: 4,
      madeAt: "2026-10-30T09:00:00.000Z",
      received: true,
    });
    expect(seen[0]!.pdf.type).toBe("application/pdf");
    expect(closeAfter).toHaveBeenCalledWith("security");
    await expect.poll(() => dialog.open).toBe(false);
  });

  it("sends one make at a time: a second press while it is out sends nothing", async () => {
    const api = stubApi();
    const answer = deferred<MadeRecoveryPack>();
    api.makeRecoveryPack.mockReturnValue(answer.promise);
    const { el } = await open({ api });
    const seen = made(el);
    await type(el);
    button(el, "make-pack")!.click();
    await expect.poll(() => api.makeRecoveryPack.mock.calls.length).toBe(1);
    button(el, "make-pack")!.click();
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(api.makeRecoveryPack).toHaveBeenCalledOnce();
    answer.resolve({ pdf: pdf(), number: 4, madeAt: "2026-10-30T09:00:00.000Z" });
    await expect.poll(() => seen.length).toBe(1);
    expect(api.makeRecoveryPack).toHaveBeenCalledOnce();
  });

  it("asks for the pack in Spanish when the screen is in Spanish", async () => {
    setLocale("es-ES");
    const { el, api } = await open();
    await type(el);
    button(el, "make-pack")!.click();
    await expect.poll(() => api.makeRecoveryPack.mock.calls.length).toBe(1);
    expect(api.makeRecoveryPack.mock.calls[0]![0]).toEqual({ locale: "es", masterKey: TYPED });
  });

  it("tries the mark once more when it fails, and hands the PDF over either way", async () => {
    const api = stubApi();
    api.markRecoveryPackReceived
      .mockRejectedValueOnce({ code: "connection.failed" })
      .mockRejectedValueOnce({ code: "connection.failed" });
    const { el } = await open({ api });
    const seen = made(el);
    await type(el);
    button(el, "make-pack")!.click();
    await expect.poll(() => seen.length).toBe(1);
    expect(api.markRecoveryPackReceived).toHaveBeenCalledTimes(2);
    expect(seen[0]!.received).toBe(false);
  });

  it("is marked received when the second try succeeds", async () => {
    const api = stubApi();
    api.markRecoveryPackReceived.mockRejectedValueOnce({ code: "connection.failed" });
    const { el } = await open({ api });
    const seen = made(el);
    await type(el);
    button(el, "make-pack")!.click();
    await expect.poll(() => seen.length).toBe(1);
    expect(api.markRecoveryPackReceived).toHaveBeenCalledTimes(2);
    expect(seen[0]!.received).toBe(true);
  });
});

describe("closing", () => {
  it("drops an answer that arrives after Cancel", async () => {
    const api = stubApi();
    const answer = deferred<MadeRecoveryPack>();
    api.makeRecoveryPack.mockReturnValue(answer.promise);
    const { el, dialog } = await open({ api });
    const seen = made(el);
    await type(el);
    button(el, "make-pack")!.click();
    await expect.poll(() => api.makeRecoveryPack.mock.calls.length).toBe(1);
    const closed = dialogClosed(dialog);
    button(el, "cancel-pack")!.click();
    await closed;
    answer.resolve({ pdf: pdf(), number: 4, madeAt: "2026-10-30T09:00:00.000Z" });
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(seen).toEqual([]);
    expect(api.markRecoveryPackReceived).not.toHaveBeenCalled();
    expect(dialog.open).toBe(false);
  });

  it("drops a lost answer that arrives after Cancel without reading the status", async () => {
    const api = stubApi();
    const answer = deferred<MadeRecoveryPack>();
    api.makeRecoveryPack.mockReturnValue(answer.promise);
    const { el, dialog } = await open({ api });
    await type(el);
    button(el, "make-pack")!.click();
    await expect.poll(() => api.makeRecoveryPack.mock.calls.length).toBe(1);
    const closed = dialogClosed(dialog);
    button(el, "cancel-pack")!.click();
    await closed;
    answer.reject({ code: "connection.failed" });
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(api.getRecoveryPackStatus).not.toHaveBeenCalled();
    expect(dialog.open).toBe(false);
  });

  it.each(["Stop", "Escape"] as const)(
    "keeps %s from closing while a new master key is being made, and shows the key when it arrives",
    async (how) => {
      const KEY = "88DP 74BA YPVB RRM5 XFV2 WPQY B5M5";
      const api = stubApi();
      const answer = deferred<MadeRecoveryPack>();
      api.makeRecoveryPack.mockReturnValue(answer.promise);
      const { el, dialog } = await open({ api, kind: "master-key" });
      const seen = made(el);
      button(el, "make-pack")!.click();
      await expect.poll(() => api.makeRecoveryPack.mock.calls.length).toBe(1);
      await el.updateComplete;
      expect(button(el, "cancel-pack")!.disabled).toBe(true);
      if (how === "Stop") button(el, "cancel-pack")!.click();
      else await userEvent.keyboard("{Escape}");
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(dialog.open).toBe(true);
      answer.resolve({
        pdf: pdf(),
        number: 4,
        madeAt: "2026-11-23T09:00:00.000Z",
        masterKey: { key: KEY, name: "2026-11-23 · QZJV" },
      });
      await expect.poll(() => inBox(el, "master-key")?.textContent).toBe(KEY);
      expect(dialog.open).toBe(true);
      expect(seen).toHaveLength(1);
    },
  );

  it("lets Stop close again once the box has refused a new master key", async () => {
    const api = stubApi();
    api.makeRecoveryPack.mockRejectedValue({ status: 500, code: "server.internal" });
    const { el, dialog } = await open({ api, kind: "master-key" });
    button(el, "make-pack")!.click();
    await expect.poll(() => bottom(el)).not.toBe("");
    expect(button(el, "cancel-pack")!.disabled).toBe(false);
    const closed = dialogClosed(dialog);
    button(el, "cancel-pack")!.click();
    await closed;
    expect(dialog.open).toBe(false);
  });

  it("forgets a typed key on Cancel: reopened, the field is empty, Print is off, and a later Print sends only the new key", async () => {
    const { el, api, dialog } = await open({ at: HELD });
    await type(el);
    expect(button(el, "make-pack")!.disabled).toBe(false);
    const closed = dialogClosed(dialog);
    button(el, "cancel-pack")!.click();
    await closed;
    el.show(HELD);
    await expect.poll(() => dialog.open).toBe(true);
    await el.updateComplete;
    const input =
      field(el)!.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-input"]>("wt-input")!;
    await input.updateComplete;
    expect(input.value).toBe("");
    expect(button(el, "make-pack")!.disabled).toBe(true);
    button(el, "make-pack")!.click();
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(api.makeRecoveryPack).not.toHaveBeenCalled();
    const other = encodeMasterKeyCode(new Uint8Array(16).fill(9));
    await type(el, other);
    button(el, "make-pack")!.click();
    await expect.poll(() => api.makeRecoveryPack.mock.calls.length).toBe(1);
    expect(api.makeRecoveryPack.mock.calls[0]![0]).toEqual({ locale: "en", masterKey: other });
  });

  it("forgets its kind on close: a dialog reopened for a plain pack makes a plain pack", async () => {
    const { el, dialog } = await open({ kind: "master-key" });
    const closed = dialogClosed(dialog);
    button(el, "cancel-pack")!.click();
    await closed;
    el.show(status());
    await expect.poll(() => dialog.open).toBe(true);
    await el.updateComplete;
    expect(dialog.heading).toBe(t("recovery_pack_dialog.heading"));
    expect(field(el)).not.toBeNull();
    expect(button(el, "make-pack")!.variant).toBe("secondary");
  });
});

describe("a lost answer", () => {
  async function lose(options: {
    masterKey: boolean;
    error?: unknown;
    after?: RecoveryPackStatus;
  }) {
    const api = stubApi();
    api.makeRecoveryPack.mockRejectedValue(options.error ?? { code: "connection.failed" });
    api.getRecoveryPackStatus.mockResolvedValue(options.after ?? status());
    const { el, dialog } = await open({
      api,
      at: HELD,
      kind: options.masterKey ? "master-key" : "pack",
    });
    if (!options.masterKey) await type(el);
    button(el, "make-pack")!.click();
    await expect.poll(() => el.shadowRoot!.querySelector("[data-test=lost]")).not.toBeNull();
    return { el, api, dialog };
  }

  it("after Make a new master key, reads the status again and warns that the only copy of the key may be on a pack the person does not have", async () => {
    const { el, api } = await lose({ masterKey: true });
    expect(api.getRecoveryPackStatus).toHaveBeenCalledOnce();
    const lost = words(el.shadowRoot!.querySelector("[data-test=lost]"));
    expect(lost).toContain(t("recovery_pack_dialog.lost_new_key"));
    expect(lost).not.toContain(codeMessage("connection.failed"));
    expect(bottom(el)).toBe("");
    expect(lost).toContain(t("recovery_pack_dialog.lost_new_key_choices"));
    expect(words(button(el, "remake-pack"))).toBe(t("master_key_dialog.make"));
    expect(words(button(el, "stop-pack"))).toBe(t("master_key_dialog.stop"));
    expect(button(el, "make-pack")).toBeNull();
    expect(button(el, "retry-pack")).toBeNull();
    expect(el.shadowRoot!.querySelector("dashboard-fresh-sign-in")).toBeNull();
  });

  it("names setup's pack and its date when the status names it unreceived, and hands the status on", async () => {
    const after = status({
      unreceived: {
        number: 4,
        madeAt: MADE_AT,
        offeredAtSetup: true,
        holdsCurrentMasterKey: true,
      },
      masterKey: { name: "2026-10-12 · QZJV", pack: 4 },
    });
    const statuses: RecoveryPackStatus[] = [];
    const listening = new AbortController();
    document.addEventListener(
      "recovery-pack-status",
      (event) => statuses.push((event as CustomEvent<RecoveryPackStatus>).detail),
      { signal: listening.signal },
    );
    const { el } = await lose({ masterKey: true, after });
    listening.abort();
    expect(statuses).toEqual([after]);
    const lost = words(el.shadowRoot!.querySelector("[data-test=lost]"));
    expect(lost).toContain(
      "The current master key is on recovery pack 4, made on 12 October, which this box never saw arrive.",
    );
  });

  it.each([
    [
      "en-GB",
      "The new master key did not reach this browser, so the box kept the current one. The current master key is on recovery pack 3, made on 12 October, which this box never saw arrive. Make a new master key tries again. Stop closes this window.",
    ],
    [
      "es-ES",
      "La clave maestra nueva no llegó a este navegador, así que el servidor sigue con la actual. La clave maestra actual está en el paquete de recuperación 3, hecho el 12 de octubre, que este servidor nunca vio llegar. Crear una clave maestra nueva lo vuelve a intentar. Parar cierra esta ventana.",
    ],
  ] as const)("says in %s that the box kept the current key", async (locale, text) => {
    setLocale(locale);
    const { el } = await lose({
      masterKey: true,
      after: status({
        unreceived: {
          number: 3,
          madeAt: MADE_AT,
          offeredAtSetup: true,
          holdsCurrentMasterKey: true,
        },
        masterKey: { name: "2026-10-12 · QZJV", pack: 3 },
      }),
    });
    expect(words(el.shadowRoot!.querySelector("[data-test=lost]"))).toBe(text);
  });

  it("names no pack when the unreceived pack holding the current key was not setup's", async () => {
    const { el } = await lose({
      masterKey: true,
      after: status({
        unreceived: { number: 3, madeAt: MADE_AT, holdsCurrentMasterKey: true },
        masterKey: { name: "2026-10-12 · QZJV", pack: 3 },
      }),
    });
    const lost = words(el.shadowRoot!.querySelector("[data-test=lost]"));
    expect(lost).toBe(
      `${t("recovery_pack_dialog.lost_new_key")} ${t("recovery_pack_dialog.lost_new_key_choices")}`,
    );
  });

  it("names setup's older unreceived pack that shows the current master key, though a later pack was received", async () => {
    const { el } = await lose({
      masterKey: true,
      after: status({
        latest: {
          number: 4,
          madeAt: MADE_AT,
          madeByName: null,
          received: true,
          parts: [],
        },
        unreceived: {
          number: 3,
          madeAt: MADE_AT,
          offeredAtSetup: true,
          holdsCurrentMasterKey: true,
        },
        masterKey: { name: "2026-10-12 · QZJV", pack: 3 },
      }),
    });
    expect(words(el.shadowRoot!.querySelector("[data-test=lost]"))).toContain(
      fill("recovery_pack_dialog.lost_new_key_named", { number: "3", date: "12 October" }),
    );
  });

  it("names no pack when the status names none unreceived", async () => {
    const { el } = await lose({ masterKey: true, after: HELD });
    const lost = words(el.shadowRoot!.querySelector("[data-test=lost]"));
    expect(lost).not.toContain("recovery pack 3");
    expect(lost).not.toContain("recovery pack 4");
  });

  it("names no pack when the unreceived pack did not show the current master key", async () => {
    const { el } = await lose({
      masterKey: true,
      after: status({ ...HELD, unreceived: { number: 4, madeAt: MADE_AT } }),
    });
    const lost = words(el.shadowRoot!.querySelector("[data-test=lost]"));
    expect(lost).toContain(t("recovery_pack_dialog.lost_new_key"));
    expect(lost).not.toContain("recovery pack 3");
    expect(lost).not.toContain("recovery pack 4");
  });

  it("offers Make a new master key again, through the shared sign-in gate", async () => {
    const { el, api } = await lose({ masterKey: true });
    button(el, "remake-pack")!.click();
    await el.updateComplete;
    expect(el.shadowRoot!.querySelector("[data-test=lost]")).toBeNull();
    expect(words(button(el, "make-pack"))).toBe(t("master_key_dialog.make"));
    expect(el.shadowRoot!.querySelector("dashboard-fresh-sign-in")).toBeNull();
    expect(api.makeRecoveryPack).toHaveBeenCalledOnce();
    expect(button(el, "make-pack")!.variant).toBe("danger");
  });

  it("moves focus to its message", async () => {
    const { el } = await lose({ masterKey: true });
    await expect.poll(() => focused()).toBe(el.shadowRoot!.querySelector("[data-test=lost]"));
  });

  it("Stop closes the dialog", async () => {
    const { el, dialog } = await lose({ masterKey: true });
    const closed = dialogClosed(dialog);
    button(el, "stop-pack")!.click();
    await closed;
    expect(dialog.open).toBe(false);
  });

  it("after a plain make, says the pack may have been made and offers Try again and Stop", async () => {
    const { el, api } = await lose({ masterKey: false });
    expect(api.getRecoveryPackStatus).toHaveBeenCalledOnce();
    const lost = words(el.shadowRoot!.querySelector("[data-test=lost]"));
    expect(lost).toContain(t("recovery_pack_dialog.lost"));
    expect(lost).not.toContain(t("recovery_pack_dialog.lost_new_key"));
    expect(words(button(el, "retry-pack"))).toBe(t("recovery_pack_dialog.try_again"));
    expect(words(button(el, "stop-pack"))).toBe(t("recovery_pack_dialog.stop"));
    expect(button(el, "remake-pack")).toBeNull();
  });

  it("Try again sends the request once more", async () => {
    const { el, api } = await lose({ masterKey: false });
    api.makeRecoveryPack.mockResolvedValue({
      pdf: pdf(),
      number: 5,
      madeAt: "2026-10-30T09:00:00.000Z",
    });
    const seen = made(el);
    button(el, "retry-pack")!.click();
    await expect.poll(() => seen.length).toBe(1);
    expect(api.makeRecoveryPack).toHaveBeenCalledTimes(2);
    expect(api.makeRecoveryPack.mock.calls[1]![0]).toEqual({ locale: "en", masterKey: TYPED });
    expect(seen[0]!.number).toBe(5);
  });

  it("counts a body the browser refused as not whole as lost", async () => {
    const { el } = await lose({ masterKey: true, error: { code: "recovery.pack_invalid" } });
    expect(words(el.shadowRoot!.querySelector("[data-test=lost]"))).toContain(
      t("recovery_pack_dialog.lost_new_key"),
    );
  });

  it("counts a connection dropped mid-body as lost", async () => {
    const { el } = await lose({ masterKey: true, error: new TypeError("network error") });
    expect(words(el.shadowRoot!.querySelector("[data-test=lost]"))).toContain(
      t("recovery_pack_dialog.lost_new_key"),
    );
  });

  describe("through the real client", () => {
    function boxApi(makeAnswer: () => Response) {
      const json = (body: unknown, status = 200) =>
        new Response(JSON.stringify(body), {
          status,
          headers: { "Content-Type": "application/json" },
        });
      const calls: string[] = [];
      const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const call = `${init?.method ?? "GET"} ${String(input)}`;
        calls.push(call);
        if (call === "POST /api/backup/recovery-pack") return makeAnswer();
        if (call === "GET /api/backup/recovery-pack") return json(status());
        throw new Error(`Unexpected request: ${call}`);
      });
      return { api: new DashboardApi("", fetchImpl as typeof fetch), calls };
    }

    async function press(api: DashboardApi) {
      const { el } = await mountWidget<RecoveryPackDialog>("dashboard-recovery-pack-dialog", {
        api,
      });
      el.show(HELD, "master-key");
      await el.updateComplete;
      button(el, "make-pack")!.click();
      return el;
    }

    it("counts a gateway's plain-text 502 as lost, not as the box's refusal", async () => {
      const { api, calls } = boxApi(
        () =>
          new Response("Bad Gateway", { status: 502, headers: { "Content-Type": "text/plain" } }),
      );
      const el = await press(api);
      await expect.poll(() => el.shadowRoot!.querySelector("[data-test=lost]")).not.toBeNull();
      expect(words(el.shadowRoot!.querySelector("[data-test=lost]"))).toContain(
        t("recovery_pack_dialog.lost_new_key"),
      );
      expect(calls.filter((call) => call === "GET /api/backup/recovery-pack")).toHaveLength(1);
      expect(bottom(el)).toBe("");
    });

    it("keeps the box's own refusal envelope a refusal", async () => {
      const { api, calls } = boxApi(
        () =>
          new Response(JSON.stringify({ error: { code: "password.throttled" } }), {
            status: 429,
            headers: { "Content-Type": "application/json" },
          }),
      );
      const el = await press(api);
      await expect.poll(() => bottom(el)).toBe(codeMessage("password.throttled"));
      expect(el.shadowRoot!.querySelector("[data-test=lost]")).toBeNull();
      expect(calls).not.toContain("GET /api/backup/recovery-pack");
    });
  });

  it("still warns when the status cannot be read again", async () => {
    const api = stubApi();
    api.makeRecoveryPack.mockRejectedValue({ code: "connection.timed_out" });
    api.getRecoveryPackStatus.mockRejectedValue({ code: "connection.failed" });
    const { el } = await open({ api, kind: "master-key" });
    button(el, "make-pack")!.click();
    await expect.poll(() => el.shadowRoot!.querySelector("[data-test=lost]")).not.toBeNull();
    expect(words(el.shadowRoot!.querySelector("[data-test=lost]"))).toContain(
      t("recovery_pack_dialog.lost_new_key"),
    );
  });
});

describe("a refusal", () => {
  it("shows a server refusal and keeps Print the recovery pack working", async () => {
    const api = stubApi();
    api.makeRecoveryPack.mockRejectedValue({ code: "password.throttled", status: 429 });
    const { el } = await open({ api, kind: "master-key" });
    button(el, "make-pack")!.click();
    await expect.poll(() => bottom(el)).toBe(codeMessage("password.throttled"));
    expect(el.shadowRoot!.querySelector("[data-test=lost]")).toBeNull();
    expect(api.getRecoveryPackStatus).not.toHaveBeenCalled();
    expect(button(el, "make-pack")!.disabled).toBe(false);
  });

  it("forgets a refusal on Cancel, so a reopened dialog shows none and sends nothing", async () => {
    const api = stubApi();
    api.makeRecoveryPack.mockRejectedValue({ code: "password.throttled", status: 429 });
    const { el, dialog } = await open({ api });
    await type(el);
    button(el, "make-pack")!.click();
    await expect.poll(() => bottom(el)).toBe(codeMessage("password.throttled"));
    const closed = dialogClosed(dialog);
    button(el, "cancel-pack")!.click();
    await closed;
    el.show(status());
    await expect.poll(() => dialog.open).toBe(true);
    await el.updateComplete;
    expect(bottom(el)).toBe("");
    expect(api.makeRecoveryPack).toHaveBeenCalledOnce();
  });

  it("shows the box's own recovery.pack_invalid as a refusal in words, not as a lost answer", async () => {
    const api = stubApi();
    api.makeRecoveryPack.mockRejectedValue({
      code: "recovery.pack_invalid",
      params: { reason: "shape" },
      status: 400,
    });
    const { el } = await open({ api, kind: "master-key" });
    button(el, "make-pack")!.click();
    await expect.poll(() => bottom(el)).toBe(codeMessage("recovery.pack_invalid"));
    expect(bottom(el)).not.toBe(codeMessage("test.unmapped_code"));
    expect(el.shadowRoot!.querySelector("[data-test=lost]")).toBeNull();
  });
});

describe("the words", () => {
  const KEYS = [
    "recovery_pack_dialog.heading",
    "recovery_pack_dialog.intro",
    "recovery_pack_dialog.make",
    "recovery_pack_dialog.limited",
    "recovery_pack_dialog.lost_new_key",
    "recovery_pack_dialog.lost_new_key_named",
    "recovery_pack_dialog.lost_new_key_choices",
    "recovery_pack_dialog.lost",
    "recovery_pack_dialog.lost_choices",
    "recovery_pack_dialog.try_again",
    "recovery_pack_dialog.stop",
    "recovery_pack_dialog.not_kept",
    "recovery_pack_dialog.not_known",
    "master_key_dialog.heading",
    "master_key_dialog.text",
    "master_key_dialog.make",
    "master_key_dialog.stop",
    "master_key_shown.lead",
    "master_key_shown.warning",
    "master_key_shown.key_name",
    "master_key_shown.download",
    "master_key_shown.print",
    "master_key_shown.copy",
    "master_key_shown.copied",
    "master_key_shown.copy_failed",
    "master_key_shown.print_failed",
    "master_key_shown.continue",
  ] as const;

  it("has its own English and Spanish for every sentence", () => {
    for (const key of KEYS) {
      expect(en[key], key).toBeTruthy();
      expect(es[key], key).toBeTruthy();
      expect(es[key], key).not.toBe(en[key]);
    }
  });

  it("dates the keep day in Spanish on a Spanish screen", async () => {
    setLocale("es-ES");
    const { el } = await open({
      at: status({ keepOldPackUntil: "2026-10-12T12:00:00.000Z" }),
      kind: "master-key",
    });
    expect(words(el.shadowRoot!.querySelector("[data-test=intro]"))).toContain(
      "12 de octubre de 2026",
    );
    expect(el.shadowRoot!.querySelector<WtDialog>("wt-dialog")!.heading).toBe(
      es["master_key_dialog.heading"],
    );
  });
});
