import { afterEach, describe, expect, it, vi } from "vitest";
import { userEvent } from "vitest/browser";
import type { WtDialog } from "@waitron/ui";
import { DashboardApi } from "../api/client.js";
import type { MadeRecoveryPack, RecoveryPackStatus } from "../api/client.js";
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
    serverKey: "set",
    timeZone: "Europe/Madrid",
    ...overrides,
  };
}

/** The current server key is on pack 3, which a browser confirmed receiving. */
const HELD = status({ keep: [{ number: 3, madeAt: MADE_AT, until: null, why: "server_key" }] });
/** The current server key is on pack 3, which no browser confirmed receiving. */
const UNRECEIVED = status({
  unreceived: { number: 3, madeAt: MADE_AT, holdsCurrentServerKey: true },
});

function pdf(): Blob {
  return new Blob(["%PDF-1.7 pack"], { type: "application/pdf" });
}

function stubApi() {
  return {
    makeRecoveryPack: vi.fn<(body: unknown) => Promise<MadeRecoveryPack>>().mockResolvedValue({
      pdf: pdf(),
      number: 4,
      key: "unchanged",
      madeAt: "2026-10-30T09:00:00.000Z",
    }),
    markRecoveryPackReceived: vi.fn<(n: number) => Promise<void>>().mockResolvedValue(undefined),
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

function button(el: RecoveryPackDialog, test: string) {
  return el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-button"]>(
    `wt-button[data-test=${test}]`,
  );
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

const option = () => t("recovery_pack.make_master_key");
const unreceivedWords = () =>
  fill("recovery_pack_dialog.unreceived", { number: "3", date: "12 October", option: option() });

afterEach(cleanupWidgets);
afterEach(() => vi.restoreAllMocks());
afterEach(() => setLocale("en-GB"));

describe("the form", () => {
  it("draws the plain make: its intro, Cancel and Make pack, with no choice and no sign-in form", async () => {
    const { el, dialog } = await open();
    expect(dialog.heading).toBe(t("recovery_pack_dialog.heading"));
    expect(words(el.shadowRoot!.querySelector("[data-test=intro]"))).toBe(
      t("recovery_pack_dialog.intro"),
    );
    expect(el.shadowRoot!.querySelector("dashboard-fresh-sign-in")).toBeNull();
    expect(el.shadowRoot!.querySelector("input")).toBeNull();
    expect(el.shadowRoot!.querySelector("[data-test=note]")).toBeNull();
    expect(button(el, "cancel-pack")!.slot).toBe("cancel");
    expect(words(button(el, "cancel-pack"))).toBe(t("action.cancel"));
    expect(words(button(el, "make-pack"))).toBe(t("recovery_pack_dialog.make"));
    expect(button(el, "make-pack")!.variant).toBe("primary");
    expect(button(el, "make-pack")!.disabled).toBe(false);
  });

  it("asks for a plain pack with no new key", async () => {
    const { el, api } = await open({ at: HELD });
    button(el, "make-pack")!.click();
    await expect.poll(() => api.makeRecoveryPack.mock.calls.length).toBe(1);
    expect(api.makeRecoveryPack.mock.calls[0]![0]).toMatchObject({ newServerKey: false });
  });

  it.each([
    [
      "en-GB",
      "Make a new master key?",
      "Do this only if the master key is lost, or someone who should not have it may have seen it. Backups made before now still need the old key. Keep the old pack until 23 December 2026. The new key is shown once, in a new recovery pack.",
      "You may be asked to sign in again.",
      "Make a new master key",
      "Stop",
    ],
    [
      "es-ES",
      "¿Crear una clave maestra nueva?",
      "Hazlo solo si la clave maestra se ha perdido o si alguien que no debía ha podido verla. Las copias anteriores siguen necesitando la clave antigua. Guarda el paquete antiguo hasta el 23 de diciembre de 2026. La clave nueva se muestra una sola vez, en un paquete de recuperación nuevo.",
      "Puede que se te pida volver a iniciar sesión.",
      "Crear una clave maestra nueva",
      "Parar",
    ],
  ] as const)(
    "Make a new master key asks first, in %s, with the day to keep the old pack until",
    async (locale, heading, text, note, make, stop) => {
      setLocale(locale);
      const { el, dialog, api } = await open({
        at: status({ keepOldPackUntil: "2026-12-23T12:00:00.000Z" }),
        kind: "master-key",
      });
      expect(dialog.heading).toBe(heading);
      expect(words(el.shadowRoot!.querySelector("[data-test=intro]"))).toBe(text);
      expect(words(el.shadowRoot!.querySelector("[data-test=note]"))).toBe(note);
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

  it("asks for a new box key with the new master key", async () => {
    const { el, api } = await open({ kind: "master-key" });
    button(el, "make-pack")!.click();
    await expect.poll(() => api.makeRecoveryPack.mock.calls.length).toBe(1);
    expect(api.makeRecoveryPack.mock.calls[0]![0]).toMatchObject({ newServerKey: true });
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
      key: "replaced",
      madeAt: "2026-11-23T09:00:00.000Z",
      masterKey: { key: KEY, name: NAME },
    });
    const opened = await open({ api, kind: "master-key" });
    const seen = made(opened.el);
    button(opened.el, "make-pack")!.click();
    await expect
      .poll(() => opened.el.shadowRoot!.querySelector("[data-test=master-key]"))
      .not.toBeNull();
    return { ...opened, seen };
  }

  it.each([
    [
      "en-GB",
      "Recovery pack",
      "Download, print or copy the master key, then keep it somewhere safe, away from this box.",
      "This is the only time the master key is shown.",
      `Master key · ${NAME}`,
      ["Download", "Print", "Copy"],
    ],
    [
      "es-ES",
      "Paquete de recuperación",
      "Descarga, imprime o copia la clave maestra y guárdala en un lugar seguro, lejos de este servidor.",
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
      expect(words(root.querySelector("[data-test=master-key-name]"))).toBe(name);
      expect(root.querySelector("[data-test=master-key]")!.textContent).toBe(KEY);
      expect(["key-download", "key-print", "key-copy"].map((b) => words(button(el, b)))).toEqual(
        labels,
      );
      expect(button(el, "key-continue")).toBeNull();
      expect(button(el, "make-pack")).toBeNull();
      expect(seen).toHaveLength(1);
      expect(seen[0]).toMatchObject({ number: 4, key: "replaced", received: true });
    },
  );

  it("Copy puts the key on the clipboard exactly as printed, says Copied., then offers Continue", async () => {
    const write = vi.spyOn(navigator.clipboard, "writeText").mockResolvedValue(undefined);
    const { el, dialog } = await shown();
    button(el, "key-copy")!.click();
    await expect.poll(() => el.shadowRoot!.querySelector("[data-test=key-copied]")).not.toBeNull();
    expect(write).toHaveBeenCalledWith(KEY);
    expect(words(el.shadowRoot!.querySelector("[data-test=key-copied]"))).toBe(
      t("master_key_shown.copied"),
    );
    await expect.poll(() => button(el, "key-continue")).not.toBeNull();
    expect(words(button(el, "key-continue"))).toBe(t("master_key_shown.continue"));
    const closed = dialogClosed(dialog);
    button(el, "key-continue")!.click();
    await closed;
    expect(dialog.open).toBe(false);
    expect(el.shadowRoot!.querySelector("[data-test=master-key]")).toBeNull();
  });

  it("a Copy the browser refuses says so and counts for nothing", async () => {
    vi.spyOn(navigator.clipboard, "writeText").mockRejectedValue(new Error("denied"));
    const { el } = await shown();
    button(el, "key-copy")!.click();
    await expect.poll(() => el.shadowRoot!.querySelector("[data-test=copy-failed]")).not.toBeNull();
    expect(words(el.shadowRoot!.querySelector("[data-test=copy-failed]"))).toBe(
      t("master_key_shown.copy_failed"),
    );
    expect(el.shadowRoot!.querySelector("[data-test=key-copied]")).toBeNull();
    expect(button(el, "key-continue")).toBeNull();
  });

  it("Download saves the pack and Print opens it, each then offering Continue", async () => {
    const opened = vi.spyOn(window, "open").mockReturnValue(null);
    const clicked: { href: string; download: string }[] = [];
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (
      this: HTMLAnchorElement,
    ) {
      clicked.push({ href: this.href, download: this.download });
    });
    const first = await shown();
    button(first.el, "key-download")!.click();
    await expect.poll(() => button(first.el, "key-continue")).not.toBeNull();
    expect(clicked).toEqual([
      { href: expect.stringMatching(/^blob:/), download: "waitron-recovery-pack-4.pdf" },
    ]);
    expect(await (await fetch(clicked[0]!.href)).text()).toBe("%PDF-1.7 pack");
    cleanupWidgets();
    const second = await shown();
    button(second.el, "key-print")!.click();
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
            "X-Waitron-Recovery-Pack-Key": "replaced",
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
    await expect.poll(() => el.shadowRoot!.querySelector("[data-test=master-key]")).not.toBeNull();
    expect(prompt).toHaveBeenCalledOnce();
    expect(makes).toBe(2);
    expect(el.shadowRoot!.querySelector("[data-test=master-key]")!.textContent).toBe(KEY);
    expect(words(el.shadowRoot!.querySelector("[data-test=master-key-name]"))).toBe(
      `Master key · ${NAME}`,
    );
  });

  it("shows no key when the box answered without one, and closes as a made pack", async () => {
    const { el, dialog } = await open({ kind: "master-key" });
    const seen = made(el);
    button(el, "make-pack")!.click();
    await expect.poll(() => seen.length).toBe(1);
    await expect.poll(() => dialog.open).toBe(false);
    expect(el.shadowRoot!.querySelector("[data-test=master-key]")).toBeNull();
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
      newServerKey: true,
    });
    expect(api.markRecoveryPackReceived).toHaveBeenCalledWith(4);
    expect(order).toEqual(["marked", "handed"]);
    expect(seen[0]).toEqual({
      pdf: expect.any(Blob),
      number: 4,
      key: "unchanged",
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
    button(el, "make-pack")!.click();
    await expect.poll(() => api.makeRecoveryPack.mock.calls.length).toBe(1);
    button(el, "make-pack")!.click();
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(api.makeRecoveryPack).toHaveBeenCalledOnce();
    answer.resolve({ pdf: pdf(), number: 4, key: "unchanged", madeAt: "2026-10-30T09:00:00.000Z" });
    await expect.poll(() => seen.length).toBe(1);
    expect(api.makeRecoveryPack).toHaveBeenCalledOnce();
  });

  it("asks for the pack in Spanish when the screen is in Spanish", async () => {
    setLocale("es-ES");
    const { el, api } = await open();
    button(el, "make-pack")!.click();
    await expect.poll(() => api.makeRecoveryPack.mock.calls.length).toBe(1);
    expect(api.makeRecoveryPack.mock.calls[0]![0]).toMatchObject({
      locale: "es",
      newServerKey: false,
    });
  });

  it("tries the mark once more when it fails, and hands the PDF over either way", async () => {
    const api = stubApi();
    api.markRecoveryPackReceived
      .mockRejectedValueOnce({ code: "connection.failed" })
      .mockRejectedValueOnce({ code: "connection.failed" });
    const { el } = await open({ api });
    const seen = made(el);
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
    button(el, "make-pack")!.click();
    await expect.poll(() => api.makeRecoveryPack.mock.calls.length).toBe(1);
    const closed = dialogClosed(dialog);
    button(el, "cancel-pack")!.click();
    await closed;
    answer.resolve({ pdf: pdf(), number: 4, key: "replaced", madeAt: "2026-10-30T09:00:00.000Z" });
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
        key: "replaced",
        madeAt: "2026-11-23T09:00:00.000Z",
        masterKey: { key: KEY, name: "2026-11-23 · QZJV" },
      });
      await expect
        .poll(() => el.shadowRoot!.querySelector("[data-test=master-key]")?.textContent)
        .toBe(KEY);
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

  it("forgets its kind on close: a dialog reopened for a plain pack makes a plain pack", async () => {
    const { el, dialog } = await open({ kind: "master-key" });
    const closed = dialogClosed(dialog);
    button(el, "cancel-pack")!.click();
    await closed;
    el.show(status());
    await expect.poll(() => dialog.open).toBe(true);
    await el.updateComplete;
    expect(dialog.heading).toBe(t("recovery_pack_dialog.heading"));
    expect(button(el, "make-pack")!.variant).toBe("primary");
  });
});

describe("the box key was not replaced", () => {
  async function failedKey(at: RecoveryPackStatus) {
    const api = stubApi();
    api.makeRecoveryPack.mockResolvedValue({
      pdf: pdf(),
      number: 4,
      key: "failed",
      madeAt: "2026-10-30T09:00:00.000Z",
    });
    api.getRecoveryPackStatus.mockResolvedValue(at);
    const { el, dialog } = await open({ api, at: HELD, kind: "master-key" });
    const seen = made(el);
    button(el, "make-pack")!.click();
    await expect.poll(() => el.shadowRoot!.querySelector("[data-test=key-failed]")).not.toBeNull();
    return { el, api, dialog, seen };
  }

  const first = () =>
    fill("recovery_pack_dialog.key_failed", { not: t("recovery_pack_dialog.not") });

  it("still hands the PDF over, and says where the current key is when its pack was received", async () => {
    const { el, api, dialog, seen } = await failedKey(HELD);
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({ number: 4, key: "failed", received: true });
    expect(api.markRecoveryPackReceived).toHaveBeenCalledWith(4);
    expect(dialog.open).toBe(true);
    expect(words(el.shadowRoot!.querySelector("[data-test=key-failed]"))).toBe(
      `${first()} ${fill("recovery_pack_dialog.key_still_works", { number: "3", date: "12 October" })}`,
    );
    expect(el.shadowRoot!.querySelector("[data-test=key-failed] strong")!.textContent).toBe(
      t("recovery_pack_dialog.not"),
    );
  });

  it("uses the unreceived wording when the pack holding the key was never confirmed received", async () => {
    const { el } = await failedKey(UNRECEIVED);
    expect(words(el.shadowRoot!.querySelector("[data-test=key-failed]"))).toBe(
      `${first()} ${unreceivedWords()}`,
    );
  });

  it("names the original setup pack when replacing the key fails", async () => {
    setLocale("en-GB");
    const { el } = await failedKey({
      ...UNRECEIVED,
      unreceived: { ...UNRECEIVED.unreceived!, offeredAtSetup: true },
    });
    expect(words(el.shadowRoot!.querySelector("[data-test=key-failed]"))).toContain(
      "The current key, on recovery pack 3 made on 12 October, still works.",
    );
  });

  it("says only that the key was not replaced when the status names no pack holding a key", async () => {
    const { el } = await failedKey(status());
    expect(words(el.shadowRoot!.querySelector("[data-test=key-failed]"))).toBe(first());
  });

  it("closes on Close", async () => {
    const { el, dialog } = await failedKey(HELD);
    expect(button(el, "make-pack")).toBeNull();
    const closed = dialogClosed(dialog);
    button(el, "close-pack")!.click();
    await closed;
    expect(dialog.open).toBe(false);
  });

  it("closes as a made pack when it was a plain make", async () => {
    const api = stubApi();
    api.makeRecoveryPack.mockResolvedValue({
      pdf: pdf(),
      number: 4,
      key: "failed",
      madeAt: "2026-10-30T09:00:00.000Z",
    });
    const { el, dialog } = await open({ api });
    const seen = made(el);
    button(el, "make-pack")!.click();
    await expect.poll(() => seen.length).toBe(1);
    await expect.poll(() => dialog.open).toBe(false);
  });
});

describe("a lost answer", () => {
  async function lose(options: { ticked: boolean; error?: unknown; after?: RecoveryPackStatus }) {
    const api = stubApi();
    api.makeRecoveryPack.mockRejectedValue(options.error ?? { code: "connection.failed" });
    api.getRecoveryPackStatus.mockResolvedValue(options.after ?? status());
    const { el, dialog } = await open({
      api,
      at: HELD,
      kind: options.ticked ? "master-key" : "pack",
    });
    button(el, "make-pack")!.click();
    await expect.poll(() => el.shadowRoot!.querySelector("[data-test=lost]")).not.toBeNull();
    return { el, api, dialog };
  }

  it("after Make a new master key, reads the status again and warns that the only copy of the key may be on a pack the person does not have", async () => {
    const { el, api } = await lose({ ticked: true });
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

  it("names the pack and its date when the status names it unreceived, and hands the status on", async () => {
    const after = status({
      unreceived: { number: 4, madeAt: MADE_AT, holdsCurrentServerKey: true },
    });
    const statuses: RecoveryPackStatus[] = [];
    const listening = new AbortController();
    document.addEventListener(
      "recovery-pack-status",
      (event) => statuses.push((event as CustomEvent<RecoveryPackStatus>).detail),
      { signal: listening.signal },
    );
    const { el } = await lose({ ticked: true, after });
    listening.abort();
    expect(statuses).toEqual([after]);
    const lost = words(el.shadowRoot!.querySelector("[data-test=lost]"));
    expect(lost).toContain(
      fill("recovery_pack_dialog.lost_new_key_named", { number: "4", date: "12 October" }),
    );
  });

  it("names no pack when the status names none unreceived", async () => {
    const { el } = await lose({ ticked: true, after: HELD });
    const lost = words(el.shadowRoot!.querySelector("[data-test=lost]"));
    expect(lost).not.toContain("recovery pack 3");
    expect(lost).not.toContain("recovery pack 4");
  });

  it("offers Make a new master key again, through the shared sign-in gate", async () => {
    const { el, api } = await lose({ ticked: true });
    button(el, "remake-pack")!.click();
    await el.updateComplete;
    expect(el.shadowRoot!.querySelector("[data-test=lost]")).toBeNull();
    expect(words(button(el, "make-pack"))).toBe(t("master_key_dialog.make"));
    expect(el.shadowRoot!.querySelector("dashboard-fresh-sign-in")).toBeNull();
    expect(api.makeRecoveryPack).toHaveBeenCalledOnce();
    expect(button(el, "make-pack")!.variant).toBe("danger");
  });

  it("Stop closes the dialog", async () => {
    const { el, dialog } = await lose({ ticked: true });
    const closed = dialogClosed(dialog);
    button(el, "stop-pack")!.click();
    await closed;
    expect(dialog.open).toBe(false);
  });

  it("after a plain make, says the pack may have been made and offers Try again and Stop", async () => {
    const { el, api } = await lose({ ticked: false });
    expect(api.getRecoveryPackStatus).toHaveBeenCalledOnce();
    const lost = words(el.shadowRoot!.querySelector("[data-test=lost]"));
    expect(lost).toContain(t("recovery_pack_dialog.lost"));
    expect(lost).not.toContain(t("recovery_pack_dialog.lost_new_key"));
    expect(words(button(el, "retry-pack"))).toBe(t("recovery_pack_dialog.try_again"));
    expect(words(button(el, "stop-pack"))).toBe(t("recovery_pack_dialog.stop"));
    expect(button(el, "remake-pack")).toBeNull();
  });

  it("Try again sends the request once more", async () => {
    const { el, api } = await lose({ ticked: false });
    api.makeRecoveryPack.mockResolvedValue({
      pdf: pdf(),
      number: 5,
      key: "unchanged",
      madeAt: "2026-10-30T09:00:00.000Z",
    });
    const seen = made(el);
    button(el, "retry-pack")!.click();
    await expect.poll(() => seen.length).toBe(1);
    expect(api.makeRecoveryPack).toHaveBeenCalledTimes(2);
    expect(seen[0]!.number).toBe(5);
  });

  it("counts a body the browser refused as not whole as lost", async () => {
    const { el } = await lose({ ticked: true, error: { code: "recovery.pack_invalid" } });
    expect(words(el.shadowRoot!.querySelector("[data-test=lost]"))).toContain(
      t("recovery_pack_dialog.lost_new_key"),
    );
  });

  it("counts a connection dropped mid-body as lost", async () => {
    const { el } = await lose({ ticked: true, error: new TypeError("network error") });
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
  it("shows a server refusal and keeps Make pack working", async () => {
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
    "recovery_pack_dialog.unreceived",
    "recovery_pack_dialog.make",
    "recovery_pack_dialog.key_failed",
    "recovery_pack_dialog.not",
    "recovery_pack_dialog.key_still_works",
    "recovery_pack_dialog.lost_new_key",
    "recovery_pack_dialog.lost_new_key_named",
    "recovery_pack_dialog.lost_new_key_choices",
    "recovery_pack_dialog.lost",
    "recovery_pack_dialog.lost_choices",
    "recovery_pack_dialog.try_again",
    "recovery_pack_dialog.stop",
    "master_key_dialog.heading",
    "master_key_dialog.text",
    "master_key_dialog.note",
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
    "master_key_shown.continue",
  ] as const;

  it("has its own English and Spanish for every sentence", () => {
    for (const key of KEYS) {
      expect(en[key], key).toBeTruthy();
      expect(es[key], key).toBeTruthy();
      expect(es[key], key).not.toBe(en[key]);
    }
  });

  it("names the Make a new master key button in the unreceived wording", () => {
    expect(en["recovery_pack_dialog.unreceived"]).toBe(
      "The current box key is on recovery pack {number}, made on {date}, but the box was never told that pack {number} arrived. If you do not have pack {number}, choose {option}.",
    );
  });

  it("says the master key was not replaced without claiming its page was not drawn", () => {
    expect(en["recovery_pack_dialog.key_failed"]).toBe(
      "The pack was made, but the master key was {not} replaced. The pack says why.",
    );
    expect(es["recovery_pack_dialog.key_failed"]).toBe(
      "El paquete se ha hecho, pero la clave maestra {not} se ha sustituido. El paquete explica por qué.",
    );
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
