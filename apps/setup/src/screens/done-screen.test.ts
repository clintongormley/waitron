import { afterEach, describe, expect, it, vi } from "vitest";
import { userEvent } from "vitest/browser";
import { cleanupWidgets, mountWidget } from "../widgets/test-helpers.js";
import { setLocale } from "../i18n/t.js";
import "./done-screen.js";
import { SetupDoneScreen } from "./done-screen.js";
import "./review-screen.js";
import type { SetupReviewScreen } from "./review-screen.js";
import { SetupApi } from "../api/client.js";
import type { SetupBoxLabel } from "../widgets/box-label.js";

/** A one-pixel image, standing in for a drawn QR. */
const PIXEL =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";

const q = (el: SetupDoneScreen, sel: string) => el.shadowRoot!.querySelector<HTMLElement>(sel);

/** What a trading server answers at `/recovery-api/status`: no such route. */
const trading = () => Promise.reject({ code: "server.internal", status: 404 });

function apiWith(getStatus: () => Promise<unknown>): SetupApi {
  return { getStatus, getRecoveryStatus: trading } as unknown as SetupApi;
}

async function mountDone(
  getStatus: () => Promise<unknown>,
  extra: Partial<SetupDoneScreen> = {},
): Promise<SetupDoneScreen> {
  const { el } = await mountWidget<SetupDoneScreen>("setup-done-screen", {
    api: apiWith(getStatus),
    startDelayMs: 0,
    pollIntervalMs: 3,
    ...extra,
  });
  return el;
}

const RESTART_EN = "The box is restarting to finish setup. Once it is back, open it here:";
const READY_EN = "The box is ready. Open it here:";
const JOINING_BODY_EN =
  "The sign-in to the restaurant's primary worked. This box now takes its first copy of the restaurant's data from the primary, over the restaurant's network; no internet is needed. This can take a few minutes. It restarts by itself when it has the copy, and then waits as the standby. The primary keeps selling throughout.";
const JOINING_STATUS_EN = "Joining. This can take a few minutes.";
const JOINING_STATUS_ES = "Uniéndose. Puede tardar unos minutos.";

/** Waits past the first poll a trading server would make (`startDelayMs: 0`) and redraws. */
async function afterATimerTurn(el: SetupDoneScreen): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 20));
  await el.updateComplete;
}

const WAITING_EN =
  "Before it creates the new invoice series, the box needs you to confirm its time again. Check that both times below are right, then press Confirm the time. If the box's time is wrong, press This device to set it from this device's time.";
const CONFIRMED_EN = "Time confirmed. This page shows when the box is ready.";
const WAITING = { code: "server.waiting_for_clock", status: 503, params: { confirmed: false } };
const WAITING_CONFIRMED = { ...WAITING, params: { confirmed: true } };
const SERVER_MS = Date.UTC(2026, 10, 14, 9, 30, 5);
const DEVICE_MS = Date.UTC(2026, 10, 14, 9, 30, 7);
const when = (ms: number) =>
  new Date(ms).toLocaleString("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });

/** The waiting app's clock routes, answering as `start-clock-waiting.ts` does unless told otherwise. */
function clockApi(
  answers: { compare?: object; confirm?: object; set?: object; refuseKey?: boolean } = {},
) {
  const sent: { route: string; body: Record<string, unknown> }[] = [];
  let challenges = 0;
  const restoreClock = vi.fn(async (route: string, body: Record<string, unknown>) => {
    sent.push({ route, body });
    if (answers.refuseKey) throw { code: "promotion.break_glass_invalid", status: 403 };
    if (route === "challenge") return { id: `challenge-${++challenges}` };
    const times = { deviceMs: DEVICE_MS, serverMs: SERVER_MS };
    if (route === "compare") return answers.compare ?? { result: "agrees", ...times };
    if (route === "confirm") return answers.confirm ?? { result: "confirmed", ...times };
    return answers.set ?? { status: "set" };
  });
  return { sent, restoreClock };
}

function clockApiWith(
  clock: ReturnType<typeof clockApi>,
  getStatus: () => Promise<unknown>,
): SetupApi {
  return {
    getStatus,
    restoreClock: clock.restoreClock,
    getRecoveryStatus: trading,
  } as unknown as SetupApi;
}

function mountWaiting(
  clock: ReturnType<typeof clockApi>,
  extra: Partial<SetupDoneScreen> = {},
): Promise<SetupDoneScreen> {
  const getStatus = vi.fn().mockRejectedValue(WAITING);
  return mountDone(getStatus, {
    api: clockApiWith(clock, getStatus),
    nodeRecoveryKey: "node-key-secret",
    pollIntervalMs: 100000,
    ...extra,
  });
}

afterEach(() => {
  setLocale("en-GB");
  cleanupWidgets();
});

describe("setup-done-screen", () => {
  it.each(["key label from copy", "2026-02-30 · K7QF", "2026-99-15 · K7QF"])(
    "keeps a malformed stored label visible without inventing a date: %s",
    async (name) => {
      const el = await mountDone(() => new Promise(() => {}), {
        breakGlassSecret: "key-on-paper",
        breakGlassKeyName: name,
      });
      expect(q(el, "[data-test=break-glass-key-name]")?.textContent?.trim()).toBe(name);
      expect(q(el, "[data-test=break-glass-secret]")?.textContent).toBe("key-on-paper");
    },
  );

  it.each([
    ["en-GB", "Box key 15 Oct 2026 · K7QF"],
    ["es-ES", "Clave del servidor 15 oct 2026 · K7QF"],
  ] as const)("localizes the issue date and key label in %s", async (locale, name) => {
    setLocale(locale);
    const el = await mountDone(() => new Promise(() => {}), {
      breakGlassSecret: "key-on-paper",
      breakGlassKeyName: "2026-10-15 · K7QF",
    });
    expect(q(el, "[data-test=break-glass-key-name]")?.textContent?.trim()).toBe(name);
    expect(el.breakGlassKeyName).toBe("2026-10-15 · K7QF");
    expect(q(el, "[data-test=break-glass-secret]")?.textContent).toBe("key-on-paper");
    setLocale(locale === "en-GB" ? "es-ES" : "en-GB");
    await el.updateComplete;
    expect(q(el, "[data-test=break-glass-key-name]")?.textContent?.trim()).toBe(
      locale === "en-GB" ? "Clave del servidor 15 oct 2026 · K7QF" : "Box key 15 Oct 2026 · K7QF",
    );
    expect(el.breakGlassKeyName).toBe("2026-10-15 · K7QF");
  });

  it("links to the Preparation PDF while the page is open", async () => {
    const el = await mountDone(() => new Promise(() => {}), {
      onboardingIntent: "prepare",
      breakGlassSecret: "key-on-paper",
      recoveryPackPdf: btoa("%PDF-test"),
    });
    const link = el.shadowRoot!.querySelector<HTMLAnchorElement>(
      "[data-test=download-recovery-pack]",
    );
    expect(link).not.toBeNull();
    expect(link!.textContent?.trim()).toBe("Download recovery pack (PDF)");
    expect(q(el, "[data-test=break-glass-warning]")?.textContent).toContain(
      "The recovery pack contains the box key",
    );
    expect(link!.download).toBe("waitron-recovery-pack.pdf");
    const response = await fetch(link!.href);
    expect(response.headers.get("content-type")).toBe("application/pdf");
    expect(await response.text()).toBe("%PDF-test");
    expect(q(el, "[data-test=break-glass-save]")).toBeNull();
    const href = link!.href;
    el.remove();
    await expect(fetch(href)).rejects.toThrow();
  });

  it("announces the restart on the provision/restore path", async () => {
    const el = await mountDone(() => new Promise(() => {}));
    expect(el.shadowRoot!.textContent).toContain(RESTART_EN);
  });

  it.each([
    [
      "en-GB",
      [
        ["Dashboard", "/", "Set up your menu, staff, devices and settings, and see your sales."],
        ["Till", "/till/", "Take orders and payments."],
        [
          "Email inbox",
          "/email",
          "Read Demo account emails, such as invitations and password resets.",
        ],
      ],
    ],
    [
      "es-ES",
      [
        [
          "Panel",
          "/",
          "Configura la carta, el personal, los dispositivos y los ajustes, y consulta tus ventas.",
        ],
        ["Caja", "/till/", "Toma pedidos y cobra."],
        [
          "Bandeja de correo",
          "/email",
          "Lee los correos de cuentas de demostración, como invitaciones y restablecimientos de contraseña.",
        ],
      ],
    ],
  ] as const)(
    "describes each destination under its heading in %s, dashboard first",
    async (locale, expected) => {
      setLocale(locale);
      const el = await mountDone(() => new Promise(() => {}), { onboardingIntent: "demo" });
      const rows = [...q(el, "[data-test=links]")!.querySelectorAll("wt-choice-row")];
      await Promise.all(rows.map((row) => row.updateComplete));
      expect(
        rows.map((row) => [
          row.heading,
          row.shadowRoot!.querySelector("a")!.getAttribute("href"),
          row.textContent!.trim(),
        ]),
      ).toEqual(expected);
      for (const row of rows) {
        const slot = row.shadowRoot!.querySelector<HTMLSlotElement>("[part=description] slot")!;
        expect(
          slot
            .assignedNodes()
            .map((node) => node.textContent)
            .join("")
            .trim(),
        ).toBe(row.textContent!.trim());
        expect(getComputedStyle(slot.parentElement!).display).not.toBe("none");
      }
    },
  );

  it.each(["en-GB", "es-ES"])(
    "announces the waiting-to-ready change in one status region in %s",
    async (locale) => {
      setLocale(locale);
      let fail!: (error: unknown) => void;
      const el = await mountDone(
        () =>
          new Promise((_, reject) => {
            fail = reject;
          }),
      );
      await vi.waitFor(() => expect(fail).toBeTypeOf("function"));
      const status = q(el, "[data-test=status]")!;
      expect(status.getAttribute("role")).toBe("status");
      const waiting =
        locale === "es-ES"
          ? "El servidor se está reiniciando para terminar la configuración. Cuando vuelva, ábrelo desde aquí:"
          : RESTART_EN;
      expect(status.textContent!.trim()).toBe(waiting);
      fail({ code: "server.internal" });
      const ready = locale === "es-ES" ? "El servidor está listo. Ábrelo desde aquí:" : READY_EN;
      await vi.waitFor(() => expect(status.textContent!.trim()).toBe(ready));
      expect(q(el, "[data-test=status]")).toBe(status);
      expect(el.shadowRoot!.querySelectorAll('[role="status"]')).toHaveLength(1);
      expect(el.shadowRoot!.textContent).not.toContain(waiting);
    },
  );

  it.each([
    ["demo", "Demo"],
    ["prepare", "Preparation"],
    ["live", "Live"],
  ] as const)("keeps the selected %s mode visible", async (onboardingIntent, label) => {
    const el = await mountDone(() => new Promise(() => {}), { onboardingIntent });
    expect(q(el, "[data-test=mode-indicator]")?.textContent?.trim()).toBe(label);
  });

  it("after a rebuild, names which devices need a person and hides the no-backups nudge", async () => {
    const el = await mountDone(() => new Promise(() => {}), { restored: "bucket" });
    expect(el.shadowRoot!.querySelector("h1")!.textContent).toBe("Rebuilt from your bucket");
    const steps = q(el, "[data-test=device-steps]")!.textContent!.replace(/\s+/g, " ");
    expect(steps).toContain("opened at https://waitron.local reconnect by themselves");
    expect(steps).toContain("opened at an IP address");
    expect(steps).toContain("port 9110");
    expect(q(el, "[data-test=backup-nudge]")).toBeNull();
    // A fenced box neither sells nor raises an alert (`deferFirstStart`), so the screen promises
    // neither.
    expect(steps).not.toContain("still sells");
    expect(steps).not.toContain("alert");
  });

  it("says nothing about devices reconnecting after an ordinary setup", async () => {
    const el = await mountDone(() => new Promise(() => {}));
    expect(el.shadowRoot!.querySelector("h1")!.textContent).toBe("Setup complete");
    expect(q(el, "[data-test=device-steps]")).toBeNull();
  });

  it("keeps waiting (no reload) while getStatus fails with a network TypeError", async () => {
    const getStatus = vi.fn().mockRejectedValue(new TypeError("Failed to fetch"));
    const el = await mountDone(getStatus);
    // Waited for, not timed: a fixed sleep before counting polls fails when a loaded machine starves
    // the browser's event loop.
    await vi.waitFor(() => expect(getStatus.mock.calls.length).toBeGreaterThan(1));
    expect(q(el, "[data-test=reload]")).toBeNull();
    expect(q(el, "[data-test=status]")?.textContent?.trim()).toBe(RESTART_EN);
  });

  it("reports ready once getStatus rejects with a non-2xx code", async () => {
    const getStatus = vi.fn().mockRejectedValue({ code: "server.internal", status: 404 });
    const el = await mountDone(getStatus);
    await vi.waitFor(() => expect(q(el, "[data-test=status]")?.textContent?.trim()).toBe(READY_EN));
    expect(q(el, "[data-test=reload]")).toBeNull();
  });

  it("waits through network failures, then reports ready on the first non-2xx", async () => {
    const getStatus = vi
      .fn()
      .mockRejectedValueOnce(new TypeError("Failed to fetch"))
      .mockRejectedValueOnce(new TypeError("Failed to fetch"))
      .mockRejectedValue({ code: "server.internal", status: 404 });
    const el = await mountDone(getStatus);
    await vi.waitFor(() => expect(q(el, "[data-test=status]")?.textContent?.trim()).toBe(READY_EN));
  });

  it("keeps waiting while getStatus still resolves, then reports ready once it 404s", async () => {
    const getStatus = vi
      .fn()
      .mockResolvedValueOnce({ provisioned: false, environment: "preproduction", needs: ["venue"] })
      .mockResolvedValueOnce({ provisioned: false, environment: "preproduction", needs: ["venue"] })
      .mockRejectedValue({ code: "server.internal", status: 404 });
    const el = await mountDone(getStatus);
    await vi.waitFor(() => expect(q(el, "[data-test=status]")?.textContent?.trim()).toBe(READY_EN));
  });

  it.each([500, 502, 503, 504])("keeps waiting while getStatus answers %i", async (status) => {
    const getStatus = vi.fn().mockRejectedValue({ code: "server.internal", status });
    const el = await mountDone(getStatus);
    await vi.waitFor(() => expect(getStatus.mock.calls.length).toBeGreaterThan(1));
    expect(q(el, "[data-test=status]")?.textContent?.trim()).toBe(RESTART_EN);
  });

  it("asks for the time on the screen itself when the restore's start waits for it", async () => {
    const before = location.href;
    const clock = clockApi();
    const el = await mountWaiting(clock);
    await vi.waitFor(() => expect(q(el, "[data-test=clock-step]")).not.toBeNull());
    expect(q(el, "[data-test=status]")?.textContent?.trim()).toBe(WAITING_EN);
    await vi.waitFor(() =>
      expect(q(el, "[data-test=clock-server]")?.textContent).toBe(when(SERVER_MS)),
    );
    expect(q(el, "[data-test=clock-device]")?.textContent).toBe(when(DEVICE_MS));
    expect(q(el, "[data-test=clock-confirm]")?.textContent?.trim()).toBe("Confirm the time");
    expect(q(el, "[data-test=clock-this-device]")?.textContent?.trim()).toBe("This device");
    expect(clock.sent.map((call) => call.route)).toEqual(["challenge", "compare"]);
    expect(clock.sent.every((call) => call.body.key === "node-key-secret")).toBe(true);
    expect(clock.sent[1]!.body.challengeId).toBe("challenge-1");
    expect(location.href).toBe(before);
  });

  it("asks once however many polls answer that the start waits", async () => {
    const clock = clockApi();
    const getStatus = vi.fn().mockRejectedValue(WAITING);
    const el = await mountDone(getStatus, { api: clockApiWith(clock, getStatus) });
    await vi.waitFor(() => expect(getStatus.mock.calls.length).toBeGreaterThan(3));
    await vi.waitFor(() => expect(q(el, "[data-test=clock-step]")).not.toBeNull());
    expect(clock.sent.filter((call) => call.route === "compare")).toHaveLength(1);
  });

  it("Confirm the time sends the key with a fresh challenge and says the time is confirmed", async () => {
    const clock = clockApi();
    const el = await mountWaiting(clock);
    await vi.waitFor(() => expect(q(el, "[data-test=clock-confirm]")).not.toBeNull());
    q(el, "[data-test=clock-confirm]")!.click();
    await vi.waitFor(() =>
      expect(q(el, "[data-test=status]")?.textContent?.trim()).toBe(CONFIRMED_EN),
    );
    expect(clock.sent.slice(2).map((call) => call.route)).toEqual(["challenge", "confirm"]);
    expect(clock.sent[3]!.body).toMatchObject({
      key: "node-key-secret",
      challengeId: "challenge-2",
    });
    expect(clock.sent[3]!.body.instantMs).toBeTypeOf("number");
    expect(q(el, "[data-test=clock-confirm]")).toBeNull();
    expect(q(el, "[data-test=clock-this-device]")).toBeNull();
  });

  it("asks again when a poll after its confirmation says the server holds none", async () => {
    const clock = clockApi();
    const getStatus = vi.fn().mockRejectedValue(WAITING);
    const el = await mountDone(getStatus, {
      api: clockApiWith(clock, getStatus),
      nodeRecoveryKey: "node-key-secret",
    });
    await vi.waitFor(() => expect(q(el, "[data-test=clock-confirm]")).not.toBeNull());
    q(el, "[data-test=clock-confirm]")!.click();
    await vi.waitFor(() => expect(clock.sent.some((call) => call.route === "confirm")).toBe(true));
    await vi.waitFor(() =>
      expect(clock.sent.filter((call) => call.route === "compare").length).toBe(2),
    );
    await vi.waitFor(() => expect(q(el, "[data-test=clock-confirm]")).not.toBeNull());
    expect(q(el, "[data-test=status]")?.textContent?.trim()).toBe(WAITING_EN);
  });

  it("keeps saying the time is confirmed while polls say the server holds the confirmation", async () => {
    const clock = clockApi();
    const getStatus = vi.fn(() =>
      Promise.reject(
        clock.sent.some((call) => call.route === "confirm") ? WAITING_CONFIRMED : WAITING,
      ),
    );
    const el = await mountDone(getStatus, {
      api: clockApiWith(clock, getStatus),
      nodeRecoveryKey: "node-key-secret",
    });
    await vi.waitFor(() => expect(q(el, "[data-test=clock-confirm]")).not.toBeNull());
    q(el, "[data-test=clock-confirm]")!.click();
    await vi.waitFor(() =>
      expect(q(el, "[data-test=status]")?.textContent?.trim()).toBe(CONFIRMED_EN),
    );
    const polled = getStatus.mock.calls.length;
    await vi.waitFor(() => expect(getStatus.mock.calls.length).toBeGreaterThan(polled + 2));
    expect(q(el, "[data-test=status]")?.textContent?.trim()).toBe(CONFIRMED_EN);
    expect(clock.sent.filter((call) => call.route === "compare")).toHaveLength(1);
  });

  it("ignores a poll sent before its confirmation that answers after it", async () => {
    const clock = clockApi();
    let answerHeld!: () => void;
    let polls = 0;
    const getStatus = vi.fn(() => {
      polls += 1;
      if (polls === 1) return Promise.reject(WAITING);
      if (polls === 2)
        return new Promise((_, reject) => {
          answerHeld = () => reject(WAITING);
        });
      return Promise.reject(WAITING_CONFIRMED);
    });
    const el = await mountDone(getStatus, {
      api: clockApiWith(clock, getStatus),
      nodeRecoveryKey: "node-key-secret",
    });
    await vi.waitFor(() => expect(polls).toBe(2));
    await vi.waitFor(() => expect(q(el, "[data-test=clock-confirm]")).not.toBeNull());
    q(el, "[data-test=clock-confirm]")!.click();
    await vi.waitFor(() =>
      expect(q(el, "[data-test=status]")?.textContent?.trim()).toBe(CONFIRMED_EN),
    );
    answerHeld();
    await vi.waitFor(() => expect(polls).toBeGreaterThan(4));
    expect(q(el, "[data-test=status]")?.textContent?.trim()).toBe(CONFIRMED_EN);
    expect(clock.sent.filter((call) => call.route === "compare")).toHaveLength(1);
  });

  it("says the time is confirmed, asking nothing, when the server holds another page's confirmation", async () => {
    const clock = clockApi();
    const getStatus = vi.fn().mockRejectedValue(WAITING_CONFIRMED);
    const el = await mountDone(getStatus, {
      api: clockApiWith(clock, getStatus),
      nodeRecoveryKey: "node-key-secret",
    });
    await vi.waitFor(() =>
      expect(q(el, "[data-test=status]")?.textContent?.trim()).toBe(CONFIRMED_EN),
    );
    await vi.waitFor(() => expect(getStatus.mock.calls.length).toBeGreaterThan(2));
    expect(clock.sent).toEqual([]);
    expect(q(el, "[data-test=clock-step]")).toBeNull();
  });

  it("a confirmation the times refuse shows the times again", async () => {
    const clock = clockApi({
      confirm: { result: "differs", deviceMs: DEVICE_MS, serverMs: SERVER_MS },
    });
    const el = await mountWaiting(clock);
    await vi.waitFor(() => expect(q(el, "[data-test=clock-confirm]")).not.toBeNull());
    q(el, "[data-test=clock-confirm]")!.click();
    await vi.waitFor(() =>
      expect(clock.sent.filter((call) => call.route === "compare")).toHaveLength(2),
    );
    expect(q(el, "[data-test=status]")?.textContent?.trim()).toBe(WAITING_EN);
    expect(q(el, "[data-test=clock-confirm]")).not.toBeNull();
  });

  it("This device sets the box's clock with the key, then confirms the set time against a fresh challenge", async () => {
    const clock = clockApi();
    const el = await mountWaiting(clock);
    await vi.waitFor(() => expect(q(el, "[data-test=clock-this-device]")).not.toBeNull());
    q(el, "[data-test=clock-this-device]")!.click();
    await vi.waitFor(() =>
      expect(q(el, "[data-test=status]")?.textContent?.trim()).toBe(CONFIRMED_EN),
    );
    expect(clock.sent.slice(2).map((call) => call.route)).toEqual([
      "challenge",
      "set",
      "challenge",
      "confirm",
    ]);
    expect(clock.sent[3]!.body).toMatchObject({
      key: "node-key-secret",
      challengeId: "challenge-2",
    });
    expect(clock.sent[5]!.body).toMatchObject({
      key: "node-key-secret",
      challengeId: "challenge-3",
    });
    expect(clock.sent[5]!.body.instantMs).toBeTypeOf("number");
    expect(q(el, "[data-test=clock-step]")).toBeNull();
  });

  it("after This device, shows the times again when the confirmation finds them apart", async () => {
    const clock = clockApi({
      confirm: { result: "differs", deviceMs: DEVICE_MS, serverMs: SERVER_MS },
    });
    const el = await mountWaiting(clock);
    await vi.waitFor(() => expect(q(el, "[data-test=clock-this-device]")).not.toBeNull());
    q(el, "[data-test=clock-this-device]")!.click();
    await vi.waitFor(() =>
      expect(clock.sent.slice(2).map((call) => call.route)).toEqual([
        "challenge",
        "set",
        "challenge",
        "confirm",
        "challenge",
        "compare",
      ]),
    );
    expect(q(el, "[data-test=status]")?.textContent?.trim()).toBe(WAITING_EN);
    expect(q(el, "[data-test=clock-this-device]")).not.toBeNull();
    expect(q(el, "[data-test=clock-note]")).toBeNull();
  });

  it.each([
    [
      "a refused This device",
      { set: { status: "refused", reason: "challenge" } },
      "clock-this-device",
      "The box could not set its clock from this device. Check this device's date and time, then press This device again.",
    ],
    [
      "a screen on the box itself",
      { compare: { result: "same_machine" } },
      undefined,
      "This screen is on the box itself, so its time does not count. Open this page on a phone, computer or till on the venue's network.",
    ],
  ] as const)("says what happened after %s", async (_label, answers, press, line) => {
    const clock = clockApi(answers);
    const el = await mountWaiting(clock);
    await vi.waitFor(() => expect(q(el, "[data-test=clock-step]")).not.toBeNull());
    if (press !== undefined) {
      await vi.waitFor(() => expect(q(el, `[data-test=${press}]`)).not.toBeNull());
      q(el, `[data-test=${press}]`)!.click();
    }
    await vi.waitFor(() => expect(q(el, "[data-test=clock-note]")?.textContent?.trim()).toBe(line));
  });

  it.each([
    [
      "en-GB",
      "The box did not accept the master key this page holds. Open any of the box's pages on a phone, computer or till on the venue's network and enter the selected backup's master key there.",
    ],
    [
      "es-ES",
      "El servidor no ha aceptado la clave maestra que guarda esta página. Abre cualquier página del servidor en un móvil, ordenador o caja de la red del local e introduce allí la clave maestra de la copia elegida.",
    ],
  ] as const)(
    "if the server refuses the key, says where to enter it, since this screen has no key field, in %s",
    async (locale, line) => {
      setLocale(locale);
      const clock = clockApi({ refuseKey: true });
      const el = await mountWaiting(clock);
      await vi.waitFor(() =>
        expect(q(el, "[data-test=clock-note]")?.textContent?.trim()).toBe(line),
      );
    },
  );

  it.each([
    ["en-GB", WAITING_EN, "Confirm the time", "This device"],
    [
      "es-ES",
      "Antes de crear las series de facturas nuevas, el servidor necesita que vuelvas a confirmar su hora. Comprueba que las dos horas de abajo son correctas y pulsa Confirmar la hora. Si la hora del servidor está mal, pulsa Este dispositivo para ponerla con la hora de este dispositivo.",
      "Confirmar la hora",
      "Este dispositivo",
    ],
  ] as const)(
    "after a rebuild that waits for its time, keeps the device steps below the clock step in %s",
    async (locale, line, confirm, thisDevice) => {
      setLocale(locale);
      const clock = clockApi();
      const el = await mountWaiting(clock, { restored: "bucket" });
      await vi.waitFor(() => expect(q(el, "[data-test=status]")?.textContent?.trim()).toBe(line));
      await vi.waitFor(() => expect(q(el, "[data-test=clock-confirm]")).not.toBeNull());
      expect(q(el, "[data-test=clock-confirm]")?.textContent?.trim()).toBe(confirm);
      expect(q(el, "[data-test=clock-this-device]")?.textContent?.trim()).toBe(thisDevice);
      const steps = q(el, "[data-test=device-steps]")!;
      expect(
        q(el, "[data-test=clock-step]")!.compareDocumentPosition(steps) &
          Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
    },
  );

  it("after a rebuild that waited for its time, reports ready once the server trades", async () => {
    const clock = clockApi();
    const getStatus = vi
      .fn()
      .mockRejectedValueOnce(WAITING)
      .mockRejectedValue({ code: "server.internal", status: 404 });
    const el = await mountDone(getStatus, {
      api: clockApiWith(clock, getStatus),
      nodeRecoveryKey: "node-key-secret",
      restored: "bucket",
    });
    await vi.waitFor(() => expect(q(el, "[data-test=status]")?.textContent?.trim()).toBe(READY_EN));
    expect(q(el, "[data-test=clock-step]")).toBeNull();
    expect(q(el, "[data-test=device-steps]")).not.toBeNull();
  });

  it.each([
    [
      "en-GB",
      "This page could not get the two times from the box, so Confirm the time and This device stay off. Keep this page open: it asks the box again by itself.",
    ],
    [
      "es-ES",
      "Esta página no ha podido obtener las dos horas del servidor, así que Confirmar la hora y Este dispositivo siguen desactivados. Mantén esta página abierta: vuelve a preguntar al servidor por sí sola.",
    ],
  ] as const)(
    "while no comparison has answered, says so, keeps both choices off and asks again, in %s",
    async (locale, line) => {
      setLocale(locale);
      const sent: string[] = [];
      const restoreClock = vi.fn(async (route: string) => {
        sent.push(route);
        if (route === "challenge") return { id: "challenge" };
        throw new TypeError("Failed to fetch");
      });
      const getStatus = vi.fn().mockRejectedValue(WAITING);
      const el = await mountDone(getStatus, {
        api: { getStatus, restoreClock, getRecoveryStatus: trading } as unknown as SetupApi,
        nodeRecoveryKey: "node-key-secret",
      });
      await vi.waitFor(() =>
        expect(q(el, "[data-test=clock-note]")?.textContent?.trim()).toBe(line),
      );
      await vi.waitFor(() =>
        expect(sent.filter((route) => route === "compare").length).toBeGreaterThan(2),
      );
      const confirm = q(el, "[data-test=clock-confirm]") as HTMLElement & { disabled: boolean };
      const thisDevice = q(el, "[data-test=clock-this-device]") as HTMLElement & {
        disabled: boolean;
      };
      expect(confirm.disabled).toBe(true);
      expect(thisDevice.disabled).toBe(true);
      confirm.click();
      thisDevice.click();
      await afterATimerTurn(el);
      expect(sent).not.toContain("confirm");
      expect(sent).not.toContain("set");
    },
  );

  it("shows both times once a comparison answers after one that failed", async () => {
    let compares = 0;
    const restoreClock = vi.fn(async (route: string) => {
      if (route === "challenge") return { id: "challenge" };
      compares += 1;
      if (compares === 1) throw new TypeError("Failed to fetch");
      return { result: "agrees", deviceMs: DEVICE_MS, serverMs: SERVER_MS };
    });
    const getStatus = vi.fn().mockRejectedValue(WAITING);
    const el = await mountDone(getStatus, {
      api: { getStatus, restoreClock, getRecoveryStatus: trading } as unknown as SetupApi,
      nodeRecoveryKey: "node-key-secret",
    });
    await vi.waitFor(() =>
      expect(q(el, "[data-test=clock-server]")?.textContent).toBe(when(SERVER_MS)),
    );
    expect(q(el, "[data-test=clock-device]")?.textContent).toBe(when(DEVICE_MS));
    expect(q(el, "[data-test=clock-note]")).toBeNull();
    expect(
      (q(el, "[data-test=clock-confirm]") as HTMLElement & { disabled: boolean }).disabled,
    ).toBe(false);
    expect(compares).toBe(2);
  });

  it.each([
    ["a too-slow or clock-moved round trip", { result: "challenge" }],
    ["an answer without times", { result: "agrees" }],
  ])("compares again after %s, then shows both times", async (_label, first) => {
    let compares = 0;
    const restoreClock = vi.fn(async (route: string) => {
      if (route === "challenge") return { id: "challenge" };
      compares += 1;
      if (compares === 1) return first;
      return { result: "agrees", deviceMs: DEVICE_MS, serverMs: SERVER_MS };
    });
    const getStatus = vi.fn().mockRejectedValue(WAITING);
    const el = await mountDone(getStatus, {
      api: { getStatus, restoreClock, getRecoveryStatus: trading } as unknown as SetupApi,
      nodeRecoveryKey: "node-key-secret",
    });
    await vi.waitFor(() =>
      expect(q(el, "[data-test=clock-server]")?.textContent).toBe(when(SERVER_MS)),
    );
    expect(q(el, "[data-test=clock-note]")).toBeNull();
    expect(
      (q(el, "[data-test=clock-confirm]") as HTMLElement & { disabled: boolean }).disabled,
    ).toBe(false);
    expect(compares).toBe(2);
  });

  it("does not compare again on the server's own screen", async () => {
    const clock = clockApi({ compare: { result: "same_machine" } });
    const getStatus = vi.fn().mockRejectedValue(WAITING);
    const el = await mountDone(getStatus, {
      api: clockApiWith(clock, getStatus),
      nodeRecoveryKey: "node-key-secret",
    });
    await vi.waitFor(() => expect(q(el, "[data-test=clock-note]")).not.toBeNull());
    await vi.waitFor(() => expect(getStatus.mock.calls.length).toBeGreaterThan(5));
    expect(clock.sent.filter((call) => call.route === "compare")).toHaveLength(1);
  });

  it("sends nothing more with the key once it leaves the page while a challenge is pending", async () => {
    const sent: string[] = [];
    let answerChallenge!: () => void;
    const restoreClock = vi.fn((route: string) => {
      sent.push(route);
      if (route === "challenge")
        return new Promise((resolve) => {
          answerChallenge = () => resolve({ id: "challenge" });
        });
      return Promise.resolve({ result: "agrees", deviceMs: DEVICE_MS, serverMs: SERVER_MS });
    });
    const getStatus = vi.fn().mockRejectedValue(WAITING);
    const el = await mountDone(getStatus, {
      api: { getStatus, restoreClock, getRecoveryStatus: trading } as unknown as SetupApi,
      nodeRecoveryKey: "node-key-secret",
    });
    await vi.waitFor(() => expect(sent).toEqual(["challenge"]));
    el.remove();
    answerChallenge();
    await afterATimerTurn(el);
    expect(sent).toEqual(["challenge"]);
  });

  it("a press that gets no answer hides the times and compares again", async () => {
    const sent: string[] = [];
    let pressFails = true;
    const restoreClock = vi.fn(async (route: string) => {
      sent.push(route);
      if (route === "challenge") return { id: "challenge" };
      if (route === "confirm" && pressFails) {
        pressFails = false;
        throw new TypeError("Failed to fetch");
      }
      return { result: "agrees", deviceMs: DEVICE_MS, serverMs: SERVER_MS };
    });
    let releasePoll!: () => void;
    const getStatus = vi
      .fn()
      .mockRejectedValueOnce(WAITING)
      .mockImplementationOnce(
        () =>
          new Promise((_, reject) => {
            releasePoll = () => reject(WAITING);
          }),
      )
      .mockRejectedValue(WAITING);
    const el = await mountDone(getStatus, {
      api: { getStatus, restoreClock, getRecoveryStatus: trading } as unknown as SetupApi,
      nodeRecoveryKey: "node-key-secret",
    });
    await vi.waitFor(() =>
      expect(q(el, "[data-test=clock-server]")?.textContent).toBe(when(SERVER_MS)),
    );
    await vi.waitFor(() => expect(getStatus).toHaveBeenCalledTimes(2));
    q(el, "[data-test=clock-confirm]")!.click();
    await vi.waitFor(() =>
      expect(q(el, "[data-test=clock-note]")?.textContent?.trim()).toMatch(
        /^This page could not get the two times from the box/,
      ),
    );
    expect(q(el, "[data-test=clock-server]")?.textContent).toBe("");
    expect(sent.filter((route) => route === "compare")).toHaveLength(1);
    releasePoll();
    await vi.waitFor(() =>
      expect(q(el, "[data-test=clock-server]")?.textContent).toBe(when(SERVER_MS)),
    );
    expect(q(el, "[data-test=clock-note]")).toBeNull();
    expect(sent.filter((route) => route === "compare")).toHaveLength(2);
  });

  it("sends no confirmation once it leaves the page while a press's challenge is pending", async () => {
    const sent: string[] = [];
    let answerChallenge: (() => void) | undefined;
    const restoreClock = vi.fn((route: string) => {
      sent.push(route);
      if (route === "challenge" && sent.length > 2)
        return new Promise((resolve) => {
          answerChallenge = () => resolve({ id: "challenge" });
        });
      if (route === "challenge") return Promise.resolve({ id: "challenge" });
      return Promise.resolve({ result: "agrees", deviceMs: DEVICE_MS, serverMs: SERVER_MS });
    });
    const el = await mountWaiting({ sent: [], restoreClock } as unknown as ReturnType<
      typeof clockApi
    >);
    await vi.waitFor(() =>
      expect(q(el, "[data-test=clock-server]")?.textContent).toBe(when(SERVER_MS)),
    );
    q(el, "[data-test=clock-confirm]")!.click();
    await vi.waitFor(() => expect(answerChallenge).toBeDefined());
    el.remove();
    answerChallenge!();
    await afterATimerTurn(el);
    expect(sent).toEqual(["challenge", "compare", "challenge"]);
  });

  it("keeps the latest comparison's times when an earlier one answers after it", async () => {
    const LATER_SERVER_MS = Date.UTC(2026, 10, 15, 9, 30, 5);
    let status: object = WAITING;
    const held: ((answer: object) => void)[] = [];
    let compares = 0;
    const sent: string[] = [];
    const restoreClock = vi.fn((route: string) => {
      sent.push(route);
      if (route === "challenge") return Promise.resolve({ id: "challenge" });
      if (route === "confirm")
        return Promise.resolve({ result: "differs", deviceMs: DEVICE_MS, serverMs: SERVER_MS });
      compares += 1;
      if (compares === 1)
        return Promise.resolve({ result: "agrees", deviceMs: DEVICE_MS, serverMs: SERVER_MS });
      return new Promise((resolve) => held.push(resolve));
    });
    const getStatus = vi.fn(() => Promise.reject(status));
    const el = await mountDone(getStatus, {
      api: { getStatus, restoreClock, getRecoveryStatus: trading } as unknown as SetupApi,
      nodeRecoveryKey: "node-key-secret",
    });
    await vi.waitFor(() =>
      expect(q(el, "[data-test=clock-server]")?.textContent).toBe(when(SERVER_MS)),
    );
    q(el, "[data-test=clock-confirm]")!.click();
    await vi.waitFor(() => expect(held).toHaveLength(1));
    status = WAITING_CONFIRMED;
    await vi.waitFor(() =>
      expect(q(el, "[data-test=status]")?.textContent?.trim()).toBe(CONFIRMED_EN),
    );
    status = WAITING;
    await vi.waitFor(() => expect(held).toHaveLength(2));
    expect(q(el, "[data-test=clock-server]")?.textContent).toBe("");
    expect(
      (q(el, "[data-test=clock-confirm]") as HTMLElement & { disabled: boolean }).disabled,
    ).toBe(true);
    held[1]!({ result: "agrees", deviceMs: DEVICE_MS, serverMs: SERVER_MS });
    await vi.waitFor(() =>
      expect(q(el, "[data-test=clock-server]")?.textContent).toBe(when(SERVER_MS)),
    );
    held[0]!({ result: "agrees", deviceMs: DEVICE_MS, serverMs: LATER_SERVER_MS });
    await afterATimerTurn(el);
    expect(q(el, "[data-test=clock-server]")?.textContent).toBe(when(SERVER_MS));
  });

  it("draws no clock step while the server has not said it waits", async () => {
    const el = await mountDone(() => new Promise(() => {}), { restored: "bucket" });
    expect(q(el, "[data-test=clock-step]")).toBeNull();
  });

  it("does not ask for the time on a 503 with any other code", async () => {
    const clock = clockApi();
    const getStatus = vi.fn().mockRejectedValue({ code: "setup.not_ready", status: 503 });
    const el = await mountDone(getStatus, {
      api: clockApiWith(clock, getStatus),
      nodeRecoveryKey: "node-key-secret",
    });
    await vi.waitFor(() => expect(getStatus.mock.calls.length).toBeGreaterThan(2));
    expect(clock.sent).toEqual([]);
    expect(q(el, "[data-test=clock-step]")).toBeNull();
    expect(q(el, "[data-test=status]")?.textContent?.trim()).toBe(RESTART_EN);
  });

  it("reports ready on a 404 without asking for the time", async () => {
    const clock = clockApi();
    const getStatus = vi.fn().mockRejectedValue({ code: "server.internal", status: 404 });
    const el = await mountDone(getStatus, {
      api: clockApiWith(clock, getStatus),
      nodeRecoveryKey: "node-key-secret",
    });
    await vi.waitFor(() => expect(q(el, "[data-test=status]")?.textContent?.trim()).toBe(READY_EN));
    expect(clock.sent).toEqual([]);
  });

  it("through the real client, asks for the time on the waiting app's answer with the key in the body", async () => {
    const posts: Request[] = [];
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = new Request(input, init);
      if (request.method !== "POST")
        return new Response(
          '{"error":{"code":"server.waiting_for_clock","params":{"confirmed":false}}}',
          {
            status: 503,
            headers: { "content-type": "application/json" },
          },
        );
      posts.push(request.clone());
      return new URL(request.url).pathname === "/restore-clock/challenge"
        ? Response.json({ id: "challenge-1" })
        : Response.json({ result: "agrees", deviceMs: DEVICE_MS, serverMs: SERVER_MS });
    });
    const { el } = await mountWidget<SetupDoneScreen>("setup-done-screen", {
      api: new SetupApi("", fetchImpl),
      startDelayMs: 0,
      pollIntervalMs: 3,
      nodeRecoveryKey: "node-key-secret",
    });
    await vi.waitFor(() =>
      expect(q(el, "[data-test=clock-server]")?.textContent).toBe(when(SERVER_MS)),
    );
    expect(posts.map((request) => new URL(request.url).pathname)).toEqual([
      "/restore-clock/challenge",
      "/restore-clock/compare",
    ]);
    expect(posts.every((request) => !request.url.includes("node-key-secret"))).toBe(true);
    expect(await posts[1]!.json()).toMatchObject({
      key: "node-key-secret",
      challengeId: "challenge-1",
    });
  });

  it("waits through 503s, then reports ready once getStatus answers 404", async () => {
    const getStatus = vi
      .fn()
      .mockRejectedValueOnce({ code: "setup.not_ready", status: 503 })
      .mockRejectedValueOnce({ code: "server.internal", status: 503 })
      .mockRejectedValue({ code: "server.internal", status: 404 });
    const el = await mountDone(getStatus);
    await vi.waitFor(() => expect(q(el, "[data-test=status]")?.textContent?.trim()).toBe(READY_EN));
    expect(getStatus.mock.calls.length).toBeGreaterThanOrEqual(3);
  });

  it.each([
    ["a JSON error envelope", 503, '{"error":{"code":"setup.not_ready"}}', "application/json"],
    ["an HTML page", 502, "<html>Bad gateway</html>", "text/html"],
    ["an empty body", 503, null, undefined],
  ] as const)(
    "through the real client, waits on a 5xx with %s, then reports ready on a bare 404",
    async (_label, status, body, contentType) => {
      let routeGone = false;
      const fetchImpl = vi.fn(async () =>
        routeGone
          ? new Response(null, { status: 404 })
          : new Response(body, {
              status,
              headers: contentType === undefined ? {} : { "content-type": contentType },
            }),
      );
      const { el } = await mountWidget<SetupDoneScreen>("setup-done-screen", {
        api: new SetupApi("", fetchImpl),
        startDelayMs: 0,
        pollIntervalMs: 3,
      });
      await vi.waitFor(() => expect(fetchImpl.mock.calls.length).toBeGreaterThan(1));
      expect(q(el, "[data-test=status]")?.textContent?.trim()).toBe(RESTART_EN);
      routeGone = true;
      await vi.waitFor(() =>
        expect(q(el, "[data-test=status]")?.textContent?.trim()).toBe(READY_EN),
      );
    },
  );

  // The removed element still renders once and arms its first-poll timer after it has left the page.
  // The attached control arms an identical zero-delay timer AFTER it, and same-delay timers fire in
  // the order they were set, so once the control has polled the removed one's timer has fired too.
  it("never polls when removed before its first render", async () => {
    const getStatus = vi.fn(() => new Promise(() => {}));
    const host = document.createElement("div");
    document.body.appendChild(host);
    try {
      const el = document.createElement("setup-done-screen");
      Object.assign(el, { api: apiWith(getStatus), startDelayMs: 0, pollIntervalMs: 3 });
      host.appendChild(el);
      el.remove();
      await el.updateComplete;
      const controlStatus = vi.fn(() => new Promise(() => {}));
      await mountDone(controlStatus);
      await vi.waitFor(() => expect(controlStatus).toHaveBeenCalled());
      expect(getStatus).not.toHaveBeenCalled();
    } finally {
      host.remove();
    }
  });

  // In the case this test guards against, both elements run the same code and the removed one is
  // rejected first, so it has finished by the time the control reports ready.
  it("does not report ready when it is removed while a poll is in flight", async () => {
    const inFlight = () => {
      let fail!: (reason: unknown) => void;
      const getStatus = vi.fn(
        () =>
          new Promise((_, reject) => {
            fail = reject;
          }),
      );
      return { getStatus, fail: (reason: unknown) => fail(reason) };
    };
    const removed = inFlight();
    const control = inFlight();
    const el = await mountDone(removed.getStatus);
    const controlEl = await mountDone(control.getStatus);
    await vi.waitFor(() => {
      expect(removed.getStatus).toHaveBeenCalledOnce();
      expect(control.getStatus).toHaveBeenCalledOnce();
    });
    const host = el.parentElement!;
    el.remove();
    removed.fail({ code: "server.internal" });
    control.fail({ code: "server.internal" });
    await vi.waitFor(() =>
      expect(q(controlEl, "[data-test=status]")?.textContent?.trim()).toBe(READY_EN),
    );
    host.appendChild(el);
    await el.updateComplete;
    expect(q(el, "[data-test=reload]")).toBeNull();
    expect(q(el, "[data-test=status]")?.textContent?.trim()).toBe(RESTART_EN);
    expect(removed.getStatus).toHaveBeenCalledOnce();
  });

  it("does not ask for the time when it is removed while a poll is in flight", async () => {
    const inFlight = () => {
      let fail!: (reason: unknown) => void;
      const getStatus = vi.fn(
        () =>
          new Promise((_, reject) => {
            fail = reject;
          }),
      );
      return { getStatus, fail: (reason: unknown) => fail(reason) };
    };
    const removed = inFlight();
    const control = inFlight();
    const removedClock = clockApi();
    const controlClock = clockApi();
    const el = await mountDone(removed.getStatus, {
      api: clockApiWith(removedClock, removed.getStatus),
      nodeRecoveryKey: "node-key-secret",
    });
    await mountDone(control.getStatus, {
      api: clockApiWith(controlClock, control.getStatus),
      nodeRecoveryKey: "node-key-secret",
    });
    await vi.waitFor(() => {
      expect(removed.getStatus).toHaveBeenCalledOnce();
      expect(control.getStatus).toHaveBeenCalledOnce();
    });
    el.remove();
    removed.fail(WAITING);
    control.fail(WAITING);
    await vi.waitFor(() => expect(controlClock.sent.length).toBeGreaterThan(0));
    expect(removedClock.sent).toEqual([]);
  });

  it.each(["en-GB", "es-ES"])(
    "offers no reload control before or after ready in %s",
    async (locale) => {
      setLocale(locale);
      let fail!: (error: unknown) => void;
      const el = await mountDone(
        () =>
          new Promise((_, reject) => {
            fail = reject;
          }),
      );
      await vi.waitFor(() => expect(fail).toBeTypeOf("function"));
      expect(q(el, "wt-button")).toBeNull();
      fail({ code: "server.internal" });
      const ready = locale === "es-ES" ? "El servidor está listo. Ábrelo desde aquí:" : READY_EN;
      await vi.waitFor(() => expect(q(el, "[data-test=status]")?.textContent?.trim()).toBe(ready));
      expect(q(el, "wt-button")).toBeNull();
      expect(q(el, "[data-test=reload]")).toBeNull();
    },
  );

  it("drops the node recovery key once its poll answers ready", async () => {
    const getStatus = vi.fn().mockRejectedValue({ code: "server.internal", status: 404 });
    const el = await mountDone(getStatus, { nodeRecoveryKey: "node-key-secret" });
    await vi.waitFor(() => expect(q(el, "[data-test=status]")?.textContent?.trim()).toBe(READY_EN));
    expect(el.nodeRecoveryKey).toBeUndefined();
  });

  it("keeps the node recovery key while its poll answers 503", async () => {
    const getStatus = vi.fn().mockRejectedValue({ code: "setup.not_ready", status: 503 });
    const el = await mountDone(getStatus, { nodeRecoveryKey: "node-key-secret" });
    await vi.waitFor(() => expect(getStatus.mock.calls.length).toBeGreaterThan(2));
    expect(el.nodeRecoveryKey).toBe("node-key-secret");
  });

  it("drops the node recovery key once it leaves the page", async () => {
    const el = await mountDone(() => new Promise(() => {}), { nodeRecoveryKey: "node-key-secret" });
    el.remove();
    expect(el.nodeRecoveryKey).toBeUndefined();
  });

  it("leaves the no-backups warning to the dashboard", async () => {
    const el = await mountDone(() => new Promise(() => {}), { onboardingIntent: "live" });
    expect(q(el, "[data-test=backup-nudge]")).toBeNull();
  });

  it("lists the box's reachability links on the provision/restore path", async () => {
    const el = await mountDone(() => new Promise(() => {}));
    const links = el.shadowRoot!.querySelector("[data-test=links]")!;
    const hrefs = [...links.querySelectorAll("wt-choice-row")].map((row) => row.href);
    expect(hrefs).toEqual(["/", "/till/"]);
  });

  it("does not promise trading mode on the mirror path", async () => {
    const el = await mountDone(() => new Promise(() => {}), { mirrorJoin: true });
    const text = el.shadowRoot!.textContent!;
    expect(text).not.toContain(RESTART_EN);
    expect(text.replace(/\s+/g, " ")).toContain(JOINING_STATUS_EN);
  });

  it.each([
    ["en-GB", "This box is joining", JOINING_STATUS_EN],
    ["es-ES", "Este servidor se está uniendo", JOINING_STATUS_ES],
  ] as const)(
    "says the joining box is taking its first copy (%s)",
    async (locale, heading, words) => {
      setLocale(locale);
      const el = await mountDone(() => new Promise(() => {}), { mirrorJoin: true });
      expect(q(el, "h1")!.textContent!.trim()).toBe(heading);
      expect(q(el, "[data-test=joining-status]")!.textContent!.trim()).toBe(words);
    },
  );

  it.each(["en-GB", "es-ES"] as const)(
    "while joining, shows only the join task, with the joining status as its detail (%s)",
    async (locale) => {
      setLocale(locale);
      const el = await mountDone(() => new Promise(() => {}), {
        mirrorJoin: true,
        breakGlassSecret: "bg-9f3a",
        contactUrl: "https://box-41aa.waitron.local",
      });
      const tasks = [...el.shadowRoot!.querySelectorAll("[data-test=joining-tasks] > li")];
      expect(tasks.map((task) => task.getAttribute("data-test"))).toEqual(["task-join"]);
      const status = q(el, "[data-test=joining-status]")!;
      expect(status.closest("[data-test=task-join]")).not.toBeNull();
      expect(status.getAttribute("role")).toBe("status");
      expect(q(el, "h1")!.nextElementSibling).toBe(q(el, "[data-test=joining-tasks]"));
      expect(q(el, "[data-test=joining-tasks]")!.nextElementSibling).toBeNull();
      expect(q(el, "[data-test=break-glass-secret]")).toBeNull();
      expect(q(el, "[data-test=break-glass]")).toBeNull();
      expect(q(el, "setup-box-label")).toBeNull();
      expect(el.shadowRoot!.textContent!).not.toMatch(/will not change|no cambiará/);
      expect(el.shadowRoot!.textContent!).not.toMatch(/encryption key|cifrado/);
    },
  );

  it.each([
    [
      "en-GB",
      "Print the QR code for this box",
      "Print the QR code and attach it to this box. Every box in the restaurant has one: if the main box fails, scan the QR code on a spare with a till or phone on the venue's network to switch to that spare.",
      "Print QR code",
    ],
    [
      "es-ES",
      "Imprimir el código QR de este servidor",
      "Imprime el código QR y pégalo en este servidor. Cada servidor del restaurante tiene uno: si el servidor principal falla, escanea el código QR de un servidor de reserva con una caja o un móvil de la red del local para cambiar a ese servidor.",
      "Imprimir código QR",
    ],
  ] as const)(
    "offers this box's own label on a new restaurant's finished page (%s)",
    async (locale, heading, why, button) => {
      setLocale(locale);
      const printFrame = vi.fn<(view: Window) => void>();
      const el = await mountDone(() => new Promise(() => {}), {
        onboardingIntent: "live",
        contactUrl: "https://box-7c21.waitron.local",
        drawQr: async () => PIXEL,
        printFrame,
      });
      const card = q(el, "[data-test=main-label]")!;
      expect(card.tagName).toBe("WT-CARD");
      expect(card.previousElementSibling).toBe(q(el, "[data-test=links]"));
      expect(card.querySelector("h2")!.textContent!.trim()).toBe(heading);
      expect(card.querySelector("[data-test=main-label-why]")!.textContent!.trim()).toBe(why);
      const preview = card.querySelector("setup-box-label") as SetupBoxLabel;
      expect(preview.address).toBe("https://box-7c21.waitron.local");
      expect(preview.children).toHaveLength(0);
      const print = preview.shadowRoot!.querySelector<HTMLElement>("[data-test=print-label]")!;
      expect(print.textContent!.trim()).toBe(button);
      await vi.waitFor(() =>
        expect((print as HTMLElement & { disabled: boolean }).disabled).toBe(false),
      );
      print.click();
      await vi.waitFor(() => expect(printFrame).toHaveBeenCalledTimes(1));
      printFrame.mock.calls[0]![0].dispatchEvent(new Event("afterprint"));
    },
  );

  it("offers no label on the finished page when this box's address is not known", async () => {
    const el = await mountDone(() => new Promise(() => {}), { onboardingIntent: "live" });
    expect(q(el, "[data-test=main-label]")).toBeNull();
    expect(q(el, "setup-box-label")).toBeNull();
  });

  it("shows no joining status or task list on the ordinary done page", async () => {
    const el = await mountDone(() => new Promise(() => {}));
    expect(q(el, "h1")).not.toBeNull();
    expect(q(el, "[data-test=joining-status]")).toBeNull();
    expect(q(el, "[data-test=joining-tasks]")).toBeNull();
  });

  it.each(["en-GB", "es-ES"] as const)(
    "sends the person to nobody on the mirror path (%s)",
    async (locale) => {
      setLocale(locale);
      const getStatus = vi.fn().mockRejectedValue(new Error("404"));
      const el = await mountDone(getStatus, { mirrorJoin: true, breakGlassSecret: "bg-9f3a" });
      await afterATimerTurn(el);
      expect(getStatus).not.toHaveBeenCalled();
      const text = el.shadowRoot!.textContent!.replace(/\s+/g, " ");
      expect(text).not.toMatch(/whoever|installed|support|avisa|instaló|soporte/i);
    },
  );

  it("offers no till/dashboard links and no backup nudge on the mirror path", async () => {
    const el = await mountDone(() => new Promise(() => {}), { mirrorJoin: true });
    expect(q(el, "[data-test=links]")).toBeNull();
    expect(q(el, "[data-test=backup-nudge]")).toBeNull();
  });

  it("shows no restart status and no reload on the mirror path", async () => {
    const getStatus = vi.fn().mockRejectedValue({ code: "server.internal" });
    const el = await mountDone(getStatus, { mirrorJoin: true });
    await afterATimerTurn(el);
    expect(getStatus).not.toHaveBeenCalled();
    expect(q(el, "[data-test=status]")).toBeNull();
    expect(q(el, "[data-test=reload]")).toBeNull();
  });

  it("sets the break-glass secret in the design system's monospace font", async () => {
    const { el, host } = await mountWidget<SetupDoneScreen>("setup-done-screen", {
      api: apiWith(() => new Promise(() => {})),
      startDelayMs: 0,
      breakGlassSecret: "bg-9f3a",
    });
    host.style.setProperty("--wt-font-family-mono", "serif");
    const secret = q(el, "[data-test=break-glass-secret]")!;
    expect(getComputedStyle(secret).fontFamily).toBe("serif");
  });

  it("tells the operator how to keep the break-glass secret on a trading server", async () => {
    const el = await mountDone(() => new Promise(() => {}), { breakGlassSecret: "bg-9f3a" });
    expect(q(el, "[data-test=break-glass-secret]")?.textContent).toBe("bg-9f3a");
    const warning = q(el, "[data-test=break-glass-warning]")!.textContent!.replace(/\s+/g, " ");
    expect(warning.trim()).toBe(
      "Save it as a file or write it down, and keep it off this computer. It is shown once and will not be shown again.",
    );
  });

  it("shows the finished setup in Spanish", async () => {
    setLocale("es-ES");
    const el = await mountDone(() => new Promise(() => {}), { onboardingIntent: "prepare" });
    expect(q(el, "h1")!.textContent!.trim()).toBe("Configuración completada");
    expect(q(el, "[data-test=mode-indicator]")!.textContent!.trim()).toBe("Preparación");
    const text = el.shadowRoot!.textContent!.replace(/\s+/g, " ");
    expect(text).toContain(
      "El servidor se está reiniciando para terminar la configuración. Cuando vuelva, ábrelo desde aquí:",
    );
    const links = [...q(el, "[data-test=links]")!.querySelectorAll("wt-choice-row")].map(
      (row) => row.heading,
    );
    expect(links).toEqual(["Panel", "Caja"]);
    expect(q(el, "[data-test=status]")!.textContent!.trim()).toBe(
      "El servidor se está reiniciando para terminar la configuración. Cuando vuelva, ábrelo desde aquí:",
    );
  });

  it("reports ready in Spanish once the setup route is gone", async () => {
    setLocale("es-ES");
    const el = await mountDone(() => Promise.reject({ code: "server.internal", status: 404 }));
    await vi.waitFor(() =>
      expect(q(el, "[data-test=status]")?.textContent?.trim()).toBe(
        "El servidor está listo. Ábrelo desde aquí:",
      ),
    );
    expect(q(el, "[data-test=reload]")).toBeNull();
  });

  it.each([
    ["an archive restore", "archive"],
    ["a Waitron Cloud restore", "cloud"],
  ] as const)(
    "after %s, names which devices need a person under a restore heading",
    async (_, restored) => {
      const el = await mountDone(() => new Promise(() => {}), { restored });
      expect(q(el, "h1")!.textContent!.trim()).toBe("Restored from your backup");
      const steps = q(el, "[data-test=device-steps]")!.textContent!.replace(/\s+/g, " ");
      expect(steps).toContain("opened at https://waitron.local reconnect by themselves");
      expect(steps).toContain("opened at an IP address");
      expect(steps).toContain("port 9110");
    },
  );

  it("names a restore from a backup in Spanish", async () => {
    setLocale("es-ES");
    const el = await mountDone(() => new Promise(() => {}), { restored: "archive" });
    expect(q(el, "h1")!.textContent!.trim()).toBe("Restaurado desde tu copia de seguridad");
    expect(q(el, "[data-test=device-steps]")).not.toBeNull();
  });

  it("names the devices to reconnect after a rebuild in Spanish", async () => {
    setLocale("es-ES");
    const el = await mountDone(() => new Promise(() => {}), { restored: "bucket" });
    expect(q(el, "h1")!.textContent!.trim()).toBe("Reconstruido desde tu bucket");
    const steps = q(el, "[data-test=device-steps]")!.textContent!.replace(/\s+/g, " ");
    expect(steps).toContain("Los dispositivos dependen de cómo se configuró cada uno:");
    expect(steps).toContain("https://waitron.local");
    expect(steps).toContain("/setup/trust");
    expect(steps).toContain("puerto 9110");
  });

  it("shows the joining screen in Spanish, keeping the key back until the box has joined", async () => {
    setLocale("es-ES");
    const el = await mountDone(() => new Promise(() => {}), {
      mirrorJoin: true,
      breakGlassSecret: "bg-9f3a",
    });
    expect(q(el, "h1")!.textContent!.trim()).toBe("Este servidor se está uniendo");
    expect(q(el, "[data-test=break-glass]")).toBeNull();
    expect(q(el, "[data-test=break-glass-secret]")).toBeNull();
    expect(q(el, "[data-test=status]")).toBeNull();
  });

  it("tells a trading server's operator in Spanish how to keep the break-glass code", async () => {
    setLocale("es-ES");
    const el = await mountDone(() => new Promise(() => {}), { breakGlassSecret: "bg-9f3a" });
    const warning = q(el, "[data-test=break-glass-warning]")!.textContent!.replace(/\s+/g, " ");
    expect(warning.trim()).toBe(
      "Guárdala en un archivo o anótala, y guárdala fuera de este ordenador. Se muestra una sola vez y no se volverá a mostrar.",
    );
  });

  it("redraws in Spanish on a live language switch", async () => {
    const el = await mountDone(() => new Promise(() => {}), { onboardingIntent: "live" });
    expect(q(el, "h1")!.textContent!.trim()).toBe("Setup complete");
    setLocale("es-ES");
    await el.updateComplete;
    expect(q(el, "h1")!.textContent!.trim()).toBe("Configuración completada");
    expect(q(el, "[data-test=mode-indicator]")!.textContent!.trim()).toBe("En vivo");
  });
});

describe("saving the server key as a file", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  /** Spies the browser download so a test reads the file the button saves instead. */
  function captureSaves() {
    const realURL = URL.createObjectURL.bind(URL);
    const blobs: Blob[] = [];
    const urls: string[] = [];
    const names: string[] = [];
    const hrefs: string[] = [];
    vi.spyOn(URL, "createObjectURL").mockImplementation((blob) => {
      blobs.push(blob as Blob);
      const url = realURL(blob);
      urls.push(url);
      return url;
    });
    const revoke = vi.spyOn(URL, "revokeObjectURL");
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (
      this: HTMLAnchorElement,
    ) {
      names.push(this.download);
      hrefs.push(this.href);
    });
    return { blobs, urls, names, hrefs, revoke };
  }

  it("saves the key and its name as one text file, and keeps the key on screen", async () => {
    const saves = captureSaves();
    const el = await mountDone(() => new Promise(() => {}), {
      breakGlassSecret: "key-on-paper",
      breakGlassKeyName: "2026-10-15 · K7QF",
    });
    await userEvent.click(q(el, "[data-test=break-glass-save]")!);
    expect(saves.names).toEqual(["waitron-server-key-2026-10-15-K7QF.txt"]);
    expect(saves.hrefs).toEqual([saves.urls[0]]);
    expect(saves.blobs).toHaveLength(1);
    expect(saves.blobs[0]!.type).toBe("text/plain;charset=utf-8");
    expect((await saves.blobs[0]!.text()).split("\n")).toEqual([
      "Waitron box key",
      "Box key 15 Oct 2026 · K7QF",
      "",
      "key-on-paper",
      "",
      "Print this file and keep it with your recovery pack, or move it to storage away from this computer, then delete it here. A copy left on this computer is lost with it.",
      "",
    ]);
    expect(saves.revoke).toHaveBeenCalledWith(saves.urls[0]);
    expect(document.querySelector(`a[href="${saves.urls[0]}"]`)).toBeNull();
    expect(q(el, "[data-test=break-glass-secret]")?.textContent).toBe("key-on-paper");
    expect(q(el, "[data-test=break-glass-save-error]")).toBeNull();
  });

  it("writes the file in Spanish when the screen is in Spanish", async () => {
    setLocale("es-ES");
    const saves = captureSaves();
    const el = await mountDone(() => new Promise(() => {}), {
      breakGlassSecret: "key-on-paper",
      breakGlassKeyName: "2026-10-15 · K7QF",
    });
    const button = q(el, "[data-test=break-glass-save]")!;
    expect(button.textContent!.trim()).toBe("Guardar en un archivo");
    await userEvent.click(button);
    expect(saves.names).toEqual(["waitron-server-key-2026-10-15-K7QF.txt"]);
    expect((await saves.blobs[0]!.text()).split("\n")).toEqual([
      "Clave del servidor de Waitron",
      "Clave del servidor 15 oct 2026 · K7QF",
      "",
      "key-on-paper",
      "",
      "Imprime este archivo y guárdalo con tu paquete de recuperación, o muévelo a un almacenamiento fuera de este ordenador y después bórralo de aquí. Una copia que se quede en este ordenador se pierde con él.",
      "",
    ]);
    setLocale("en-GB");
  });

  it.each([
    ["a Preparation setup", { onboardingIntent: "prepare" }],
    ["a Live setup", { onboardingIntent: "live" }],
  ] as const)(
    "claims in neither the screen nor the file of %s that the key restores or promotes",
    async (_, extra) => {
      const saves = captureSaves();
      const el = await mountDone(() => new Promise(() => {}), {
        ...extra,
        breakGlassSecret: "key-on-paper",
      });
      const claim = /need it|promot|restor/i;
      expect(q(el, "[data-test=break-glass-warning]")!.textContent).not.toMatch(claim);
      await userEvent.click(q(el, "[data-test=break-glass-save]")!);
      const text = await saves.blobs[0]!.text();
      expect(text).not.toMatch(claim);
    },
  );

  it("falls back to a plain file name and leaves out the name line when the key has no name", async () => {
    const saves = captureSaves();
    const el = await mountDone(() => new Promise(() => {}), { breakGlassSecret: "key-on-paper" });
    await userEvent.click(q(el, "[data-test=break-glass-save]")!);
    expect(saves.names).toEqual(["waitron-server-key.txt"]);
    expect((await saves.blobs[0]!.text()).split("\n").slice(0, 4)).toEqual([
      "Waitron box key",
      "",
      "key-on-paper",
      "",
    ]);
  });

  it("says the file could not be saved and keeps the key on screen when the download fails", async () => {
    const realURL = URL.createObjectURL.bind(URL);
    vi.spyOn(URL, "createObjectURL")
      .mockImplementationOnce(() => {
        throw new Error("Download refused");
      })
      .mockImplementation(realURL);
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    const el = await mountDone(() => new Promise(() => {}), { breakGlassSecret: "key-on-paper" });
    const button = q(el, "[data-test=break-glass-save]")!;
    await userEvent.click(button);
    await el.updateComplete;
    const error = q(el, "[data-test=break-glass-save-error]")!;
    expect(error.getAttribute("role")).toBe("alert");
    expect(error.textContent!.trim()).toBe(
      "The file could not be saved. Write the key down instead.",
    );
    expect(q(el, "[data-test=break-glass-secret]")?.textContent).toBe("key-on-paper");
    await userEvent.click(button);
    await el.updateComplete;
    expect(q(el, "[data-test=break-glass-save-error]")).toBeNull();
  });
});

/** Every element under `root`, including those inside nested shadow roots. */
function deepElements(root: ParentNode): Element[] {
  return [...root.querySelectorAll("*")].flatMap((element) => [
    element,
    ...(element.shadowRoot ? deepElements(element.shadowRoot) : []),
  ]);
}

const PILL_LOOK = [
  "border-top-left-radius",
  "border-bottom-right-radius",
  "padding-top",
  "padding-right",
  "padding-bottom",
  "padding-left",
  "background-color",
  "border-top-color",
  "border-top-width",
  "border-top-style",
  "font-weight",
  "color",
] as const;

const pillLook = (pill: HTMLElement) => {
  const style = getComputedStyle(pill);
  return PILL_LOOK.map((name) => `${name}: ${style.getPropertyValue(name)}`);
};

describe("setup-done-screen layout", () => {
  it.each(["demo", "prepare", "live", undefined] as const)(
    "offers the captured inbox only for Demo after %s setup",
    async (intent) => {
      const el = await mountDone(() => new Promise(() => {}), { onboardingIntent: intent });
      expect(q(el, "[data-test=link-dashboard]")).not.toBeNull();
      expect(q(el, "[data-test=link-till]")).not.toBeNull();
      expect(q(el, "[data-test=link-email]") !== null).toBe(intent === "demo");
    },
  );
  it("offers dashboard, till and email inbox as choice rows with descriptions", async () => {
    const el = await mountDone(() => new Promise(() => {}), { onboardingIntent: "demo" });
    const rows = [...q(el, "[data-test=links]")!.querySelectorAll("wt-choice-row")];
    expect(q(el, "[data-test=links]")!.classList.contains("choices")).toBe(true);
    expect(rows.map((row) => [row.heading, row.href])).toEqual([
      ["Dashboard", "/"],
      ["Till", "/till/"],
      ["Email inbox", "/email"],
    ]);
    expect(rows.every((row) => row.textContent!.trim().length > 0)).toBe(true);
    expect(q(el, "[data-test=links]")!.querySelectorAll("a")).toHaveLength(0);
  });

  it("names each choice row for tests, as the mode screen does", async () => {
    const el = await mountDone(() => new Promise(() => {}), { onboardingIntent: "demo" });
    const hrefOf = (test: string) =>
      el.shadowRoot!.querySelector<HTMLElement & { href: string }>(`[data-test=${test}]`)?.href;
    expect(["link-till", "link-dashboard", "link-email"].map(hrefOf)).toEqual([
      "/till/",
      "/",
      "/email",
    ]);
  });

  it.each([
    ["an ordinary setup", {}],
    ["a rebuild", { restored: "bucket" }],
  ] as const)(
    "mentions the print agent's port 9110 nowhere but the device steps, after %s",
    async (_, extra) => {
      const el = await mountDone(() => new Promise(() => {}), {
        onboardingIntent: "live",
        breakGlassSecret: "bg-9f3a",
        ...extra,
      });
      const steps = q(el, "[data-test=device-steps]");
      const outside = deepElements(el.shadowRoot!).filter((element) => !steps?.contains(element));
      const mentions = outside.filter(
        (element) =>
          [...element.childNodes].some(
            (node) => node.nodeType === Node.TEXT_NODE && node.textContent!.includes("9110"),
          ) || [...element.attributes].some((attribute) => attribute.value.includes("9110")),
      );
      expect(mentions.map((element) => element.outerHTML)).toEqual([]);
    },
  );

  it("introduces the links with one muted sentence that promises no trading mode", async () => {
    const { el, host } = await mountWidget<SetupDoneScreen>("setup-done-screen", {
      api: apiWith(() => new Promise(() => {})),
      startDelayMs: 0,
    });
    host.style.setProperty("--wt-color-text-muted", "rgb(7, 8, 9)");
    const intro = q(el, ".intro")!;
    expect(intro.textContent!.trim()).toBe(RESTART_EN);
    expect(getComputedStyle(intro).color).toBe("rgb(7, 8, 9)");
    const text = el.shadowRoot!.textContent!.replace(/\s+/g, " ");
    expect(text).not.toContain("trading mode");
    expect(text).not.toContain("Once the box is trading");
  });

  it("draws the mode pill exactly as the review screen draws its own, directly under the heading", async () => {
    const { el: done } = await mountWidget<SetupDoneScreen>("setup-done-screen", {
      api: apiWith(() => new Promise(() => {})),
      startDelayMs: 0,
      onboardingIntent: "prepare",
    });
    const { el: review } = await mountWidget<SetupReviewScreen>("setup-review-screen", {
      draft: { mode: "prepare" },
    });
    const pill = q(done, "[data-test=mode-indicator]")!;
    expect(pillLook(pill)).toEqual(
      pillLook(review.shadowRoot!.querySelector<HTMLElement>("[data-test=mode-badge]")!),
    );
    expect(pill.parentElement!.previousElementSibling!.localName).toBe("h1");
  });

  it("follows the tokens for the mode pill's gap below it", async () => {
    const { el, host } = await mountWidget<SetupDoneScreen>("setup-done-screen", {
      api: apiWith(() => new Promise(() => {})),
      startDelayMs: 0,
      onboardingIntent: "live",
    });
    host.style.setProperty("--wt-space-3", "19px");
    const block = q(el, "[data-test=mode-indicator]")!.parentElement!;
    expect(getComputedStyle(block).marginBottom).toBe("19px");
  });

  it("draws no mode pill when no mode was chosen", async () => {
    const el = await mountDone(() => new Promise(() => {}));
    expect(q(el, "[data-test=mode-indicator]")).toBeNull();
  });

  it("puts the rebuilt device steps in a card, as a list", async () => {
    const el = await mountDone(() => new Promise(() => {}), { restored: "bucket" });
    const steps = q(el, "[data-test=device-steps]")!;
    expect(steps.localName).toBe("wt-card");
    expect(steps.querySelectorAll(":scope > ul > li")).toHaveLength(3);
  });

  it("puts the replacement link in a card and uses the wizard's help link colour", async () => {
    const { el, host } = await mountWidget<SetupDoneScreen>("setup-done-screen", {
      api: apiWith(() => new Promise(() => {})),
      startDelayMs: 0,
      onboardingIntent: "prepare",
      breakGlassKeyInBackups: true,
    });
    host.style.setProperty("--wt-color-primary-text", "rgb(31, 32, 33)");
    host.style.setProperty("--wt-color-primary", "rgb(91, 92, 93)");
    const nudge = q(el, "[data-test=recovery-pack-replacement]")!;
    expect(nudge.localName).toBe("wt-card");
    expect(getComputedStyle(nudge.querySelector("a")!).color).toBe("rgb(31, 32, 33)");
  });

  it("draws the break-glass box from tokens, with a warning edge at its start", async () => {
    const { el, host } = await mountWidget<SetupDoneScreen>("setup-done-screen", {
      api: apiWith(() => new Promise(() => {})),
      startDelayMs: 0,
      breakGlassSecret: "bg-9f3a",
    });
    host.style.setProperty("--wt-space-1", "5px");
    host.style.setProperty("--wt-space-2", "9px");
    host.style.setProperty("--wt-space-3", "13px");
    host.style.setProperty("--wt-space-4", "21px");
    host.style.setProperty("--wt-radius-lg", "17px");
    host.style.setProperty("--wt-radius-md", "11px");
    host.style.setProperty("--wt-font-size-lg", "23px");
    host.style.setProperty("--wt-color-warning", "rgb(1, 2, 3)");
    host.style.setProperty("--wt-color-surface", "rgb(4, 5, 6)");
    const box = getComputedStyle(q(el, "[data-test=break-glass]")!);
    expect([box.paddingTop, box.paddingRight, box.paddingBottom, box.paddingLeft]).toEqual([
      "21px",
      "21px",
      "21px",
      "21px",
    ]);
    expect(box.borderTopLeftRadius).toBe("17px");
    expect(box.backgroundColor).toBe("rgb(4, 5, 6)");
    expect([box.borderTopColor, box.borderRightColor, box.borderLeftColor]).toEqual([
      "rgb(1, 2, 3)",
      "rgb(1, 2, 3)",
      "rgb(1, 2, 3)",
    ]);
    expect([box.borderTopWidth, box.borderLeftWidth]).toEqual(["1px", "5px"]);
    const heading = getComputedStyle(q(el, "[data-test=break-glass] h2")!);
    expect(heading.fontSize).toBe("23px");
    expect([heading.marginTop, heading.marginBottom]).toEqual(["0px", "9px"]);
    const secret = getComputedStyle(q(el, "[data-test=break-glass-secret]")!);
    expect(secret.fontSize).toBe("23px");
    expect(secret.borderTopLeftRadius).toBe("11px");
    expect([secret.marginTop, secret.paddingTop, secret.paddingLeft]).toEqual([
      "9px",
      "9px",
      "13px",
    ]);
  });

  it.each([
    ["an ordinary setup", { onboardingIntent: "live" }, ["links", "break-glass"]],
    ["a rebuild", { restored: "bucket" }, ["links", "device-steps", "break-glass"]],
    ["an archive restore", { restored: "archive" }, ["links", "device-steps", "break-glass"]],
    ["a Waitron Cloud restore", { restored: "cloud" }, ["links", "device-steps", "break-glass"]],
  ] as const)("spaces its blocks by the same token after %s", async (_, extra, order) => {
    const { el, host } = await mountWidget<SetupDoneScreen>("setup-done-screen", {
      api: apiWith(() => new Promise(() => {})),
      startDelayMs: 0,
      breakGlassSecret: "bg-9f3a",
      ...extra,
    });
    host.style.setProperty("--wt-space-4", "21px");
    const blocks = order.map((id) => q(el, `[data-test=${id}]`)!.getBoundingClientRect());
    const gaps = blocks.slice(1).map((block, i) => Math.round(block.top - blocks[i]!.bottom));
    expect(gaps).toEqual(order.slice(1).map(() => 21));
  });

  it("writes its styles in tokens only: no rem or em, no hex colour, no fallback value", () => {
    const css = [SetupDoneScreen.styles]
      .flat(Infinity as 1)
      .map((sheet) => (sheet as { cssText: string }).cssText)
      .join("\n");
    expect(css.match(/\d(rem|em)\b/g)).toBeNull();
    expect(css.match(/#[0-9a-f]{3,8}\b/gi)).toBeNull();
    expect(css.match(/var\(--[\w-]+\s*,/g)).toBeNull();
  });
});

describe("setup-done-screen after a start that failed", () => {
  const FAILED_EN = "The box did not start. Open it to see what went wrong and what you can do:";
  const GONE = { code: "server.internal", status: 404 };
  const RECOVERY = {
    failures: 3,
    level: "recovery",
    lastErrorCode: "restore.stream_failed",
    lastFailureAt: "2026-11-17T21:00:00.000Z",
    refused: false,
  };

  function mountWith(
    getStatus: () => Promise<unknown>,
    getRecoveryStatus: () => Promise<unknown>,
  ): Promise<SetupDoneScreen> {
    return mountDone(getStatus, {
      api: { getStatus, getRecoveryStatus } as unknown as SetupApi,
      restored: "bucket",
    });
  }

  it("says the server did not start and links to its page when the recovery page answers", async () => {
    const getRecoveryStatus = vi.fn().mockResolvedValue(RECOVERY);
    const el = await mountWith(vi.fn().mockRejectedValue(GONE), getRecoveryStatus);
    await vi.waitFor(() => expect(getRecoveryStatus.mock.calls.length).toBeGreaterThan(1));
    expect(q(el, "[data-test=status]")?.textContent?.trim()).toBe(FAILED_EN);
    const links = [...el.shadowRoot!.querySelectorAll("[data-test=links] wt-choice-row")];
    expect(links.map((link) => link.getAttribute("href"))).toEqual(["/"]);
    expect(links[0]!.getAttribute("data-test")).toBe("link-server");
    expect(links[0]!.textContent?.trim()).toBe("Its page has a button to try starting it again.");
  });

  /** Answers as the box does: `GONE` from the setup route, and the recovery page's JSON once failed. */
  function failingBox() {
    const box = { answer: WAITING as object };
    const getStatus = vi.fn(() => Promise.reject(box.answer));
    const getRecoveryStatus = vi.fn(() =>
      box.answer === GONE ? Promise.resolve(RECOVERY) : trading(),
    );
    return { box, getStatus, getRecoveryStatus };
  }

  async function failedFromWaiting(clock: ReturnType<typeof clockApi>) {
    const { box, getStatus, getRecoveryStatus } = failingBox();
    const el = await mountDone(getStatus, {
      api: {
        getStatus,
        getRecoveryStatus,
        restoreClock: clock.restoreClock,
      } as unknown as SetupApi,
      nodeRecoveryKey: "node-key-secret",
      restored: "archive",
    });
    await vi.waitFor(() =>
      expect(q(el, "[data-test=clock-server]")?.textContent).toBe(when(SERVER_MS)),
    );
    box.answer = GONE;
    await vi.waitFor(() =>
      expect(q(el, "[data-test=status]")?.textContent?.trim()).toBe(FAILED_EN),
    );
    return { el, box };
  }

  it("shows no clock controls once a start that waited for its time fails", async () => {
    const { el } = await failedFromWaiting(clockApi());
    expect(q(el, "[data-test=clock-step]")).toBeNull();
    expect(q(el, "[data-test=clock-confirm]")).toBeNull();
  });

  it("compares the times afresh when a failed start goes back to waiting for its time", async () => {
    const clock = clockApi();
    const { el, box } = await failedFromWaiting(clock);
    box.answer = WAITING;
    await vi.waitFor(() =>
      expect(clock.sent.filter((call) => call.route === "compare")).toHaveLength(2),
    );
    await vi.waitFor(() => expect(q(el, "[data-test=clock-confirm]")).not.toBeNull());
    expect(q(el, "[data-test=status]")?.textContent?.trim()).toBe(WAITING_EN);
  });

  it("sends nothing more for a This device press whose answer arrives after the start failed", async () => {
    let answerSet!: () => void;
    const clock = clockApi();
    const restoreClock = vi.fn((route: string, body: Record<string, unknown>) =>
      route === "set"
        ? new Promise((resolve) => {
            clock.sent.push({ route, body });
            answerSet = () => resolve({ status: "set" });
          })
        : clock.restoreClock(route, body),
    );
    const { box, getStatus, getRecoveryStatus } = failingBox();
    const el = await mountDone(getStatus, {
      api: { getStatus, getRecoveryStatus, restoreClock } as unknown as SetupApi,
      nodeRecoveryKey: "node-key-secret",
    });
    await vi.waitFor(() =>
      expect(q(el, "[data-test=clock-server]")?.textContent).toBe(when(SERVER_MS)),
    );
    q(el, "[data-test=clock-this-device]")!.click();
    await vi.waitFor(() => expect(clock.sent.at(-1)?.route).toBe("set"));
    box.answer = GONE;
    await vi.waitFor(() =>
      expect(q(el, "[data-test=status]")?.textContent?.trim()).toBe(FAILED_EN),
    );
    const sent = clock.sent.length;
    answerSet();
    await afterATimerTurn(el);
    expect(clock.sent).toHaveLength(sent);
    expect(q(el, "[data-test=status]")?.textContent?.trim()).toBe(FAILED_EN);
  });

  it.each([
    ["a file restore", { restored: "archive" }],
    ["a fresh Live setup", { onboardingIntent: "live" }],
  ] as const)(
    "after %s whose start failed, hides the cards that say the server trades but keeps the server key",
    async (_, extra) => {
      const { box, getStatus, getRecoveryStatus } = failingBox();
      box.answer = GONE;
      const el = await mountDone(getStatus, {
        api: { getStatus, getRecoveryStatus } as unknown as SetupApi,
        breakGlassSecret: "key-on-paper",
        ...extra,
      });
      await vi.waitFor(() =>
        expect(q(el, "[data-test=status]")?.textContent?.trim()).toBe(FAILED_EN),
      );
      expect(q(el, "[data-test=backup-nudge]")).toBeNull();
      expect(q(el, "[data-test=device-steps]")).toBeNull();
      expect(q(el, "[data-test=break-glass-secret]")?.textContent).toBe("key-on-paper");
    },
  );

  it("shows the device steps again once a later start trades", async () => {
    const { box, getStatus, getRecoveryStatus } = failingBox();
    box.answer = GONE;
    const el = await mountDone(getStatus, {
      api: { getStatus, getRecoveryStatus } as unknown as SetupApi,
      restored: "archive",
    });
    await vi.waitFor(() =>
      expect(q(el, "[data-test=status]")?.textContent?.trim()).toBe(FAILED_EN),
    );
    expect(q(el, "[data-test=device-steps]")).toBeNull();
    getRecoveryStatus.mockImplementation(trading);
    await vi.waitFor(() => expect(q(el, "[data-test=status]")?.textContent?.trim()).toBe(READY_EN));
    expect(q(el, "[data-test=device-steps]")).not.toBeNull();
  });

  it("offers no label while the start has failed, and offers it once a later start trades", async () => {
    const { box, getStatus, getRecoveryStatus } = failingBox();
    box.answer = GONE;
    const el = await mountDone(getStatus, {
      api: { getStatus, getRecoveryStatus } as unknown as SetupApi,
      contactUrl: "https://box-7c21.waitron.local",
      drawQr: async () => PIXEL,
    });
    await vi.waitFor(() =>
      expect(q(el, "[data-test=status]")?.textContent?.trim()).toBe(FAILED_EN),
    );
    expect(q(el, "[data-test=main-label]")).toBeNull();
    expect(q(el, "setup-box-label")).toBeNull();
    getRecoveryStatus.mockImplementation(trading);
    await vi.waitFor(() => expect(q(el, "[data-test=status]")?.textContent?.trim()).toBe(READY_EN));
    expect(q(el, "[data-test=main-label]")).not.toBeNull();
  });

  it("says it in Spanish", async () => {
    setLocale("es-ES");
    const el = await mountWith(
      vi.fn().mockRejectedValue(GONE),
      vi.fn().mockResolvedValue(RECOVERY),
    );
    await vi.waitFor(() =>
      expect(q(el, "[data-test=status]")?.textContent?.trim()).toBe(
        "El servidor no ha arrancado. Ábrelo para ver qué ha fallado y qué puedes hacer:",
      ),
    );
    expect(q(el, "[data-test=link-server]")?.textContent?.trim()).toBe(
      "Su página tiene un botón para intentar arrancarlo de nuevo.",
    );
  });

  it("reports ready when the recovery status read is refused, as on a trading server", async () => {
    const el = await mountWith(vi.fn().mockRejectedValue(GONE), vi.fn().mockRejectedValue(GONE));
    await vi.waitFor(() => expect(q(el, "[data-test=status]")?.textContent?.trim()).toBe(READY_EN));
    expect(q(el, "[data-test=link-dashboard]")).not.toBeNull();
  });

  it("reports ready once a later start trades after a failed one", async () => {
    const getRecoveryStatus = vi
      .fn()
      .mockResolvedValueOnce(RECOVERY)
      .mockResolvedValueOnce(RECOVERY)
      .mockRejectedValue(GONE);
    const el = await mountWith(vi.fn().mockRejectedValue(GONE), getRecoveryStatus);
    await vi.waitFor(() => expect(q(el, "[data-test=status]")?.textContent?.trim()).toBe(READY_EN));
    expect(getRecoveryStatus).toHaveBeenCalledTimes(3);
  });

  it("keeps waiting when the recovery status read cannot reach the box", async () => {
    const getRecoveryStatus = vi.fn().mockRejectedValue(new TypeError("Failed to fetch"));
    const el = await mountWith(vi.fn().mockRejectedValue(GONE), getRecoveryStatus);
    await vi.waitFor(() => expect(getRecoveryStatus.mock.calls.length).toBeGreaterThan(1));
    expect(q(el, "[data-test=status]")?.textContent?.trim()).toBe(RESTART_EN);
  });

  // A trading server has no `/recovery-api/status` route: the dashboard's catch-all
  // (`mountBuiltApps` in apps/server/src/spa-api.ts) answers a fetch, which sends no
  // `Accept: text/html`, with an empty 404; Hono's own 404 is plain text.
  it.each([
    ["an empty 404", () => new Response(null, { status: 404 })],
    ["a plain-text 404", () => new Response("404 Not Found", { status: 404 })],
    ["a page", () => new Response("<!doctype html>", { headers: { "content-type": "text/html" } })],
  ])(
    "through the real client, reports ready when the trading server answers %s",
    async (_, answer) => {
      const paths: string[] = [];
      const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
        const path = new URL(String(input), location.href).pathname;
        paths.push(path);
        return path === "/recovery-api/status" ? answer() : new Response(null, { status: 404 });
      });
      const { el } = await mountWidget<SetupDoneScreen>("setup-done-screen", {
        api: new SetupApi("", fetchImpl),
        startDelayMs: 0,
        pollIntervalMs: 3,
      });
      await vi.waitFor(() =>
        expect(q(el, "[data-test=status]")?.textContent?.trim()).toBe(READY_EN),
      );
      expect(paths).toEqual(["/setup-api/status", "/recovery-api/status"]);
    },
  );

  it("through the real client, says the server did not start on the recovery page's answer", async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) =>
      new URL(String(input), location.href).pathname === "/recovery-api/status"
        ? Response.json(RECOVERY)
        : new Response(null, { status: 404 }),
    );
    const { el } = await mountWidget<SetupDoneScreen>("setup-done-screen", {
      api: new SetupApi("", fetchImpl),
      startDelayMs: 0,
      pollIntervalMs: 3,
    });
    await vi.waitFor(() =>
      expect(q(el, "[data-test=status]")?.textContent?.trim()).toBe(FAILED_EN),
    );
  });
});

describe("the joining page", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  const JOINED_PROBE = {
    nodeId: "a8000000-0000-4000-8000-000000000003",
    term: 2,
    standing: "serving-secondary",
    acceptingSales: false,
    environment: "preproduction",
  };
  const SERVERS = "https://waitron.local/servers";
  const SPARE = "https://box-41aa.waitron.local";
  const SWITCH_PAGE = "https://box-41aa.waitron.local/handover/emergency";
  const LOST_EN =
    "This page can no longer reach this box. This usually happens after it restarts to join: it then uses the restaurant's own security certificate, which this browser has not accepted. To check, open the main box's Servers page and look at this box's row.";
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    });
  const notFound = () =>
    Promise.resolve(json({ error: { code: "server.not_found", params: {} } }, 404));
  const unreachable = () => Promise.reject(new TypeError("Failed to fetch"));

  /**
   * A real client over a fetch that gives each `/api/node` answer in turn, then repeats the last;
   * `/api/box/status` answers through `boxStatus`, 404 unless told otherwise.
   */
  function joiningApi(
    answers: (() => Promise<Response>)[],
    boxStatus: () => Promise<Response> = notFound,
  ) {
    let calls = 0;
    const signals: (AbortSignal | undefined)[] = [];
    const fetchImpl = vi.fn((url: RequestInfo | URL, init?: RequestInit) => {
      signals.push(init?.signal ?? undefined);
      if (url === "/api/box/status") return boxStatus();
      expect(url).toBe("/api/node");
      const answer = answers[Math.min(calls, answers.length - 1)]!;
      calls += 1;
      return answer();
    });
    const nodeCalls = () => fetchImpl.mock.calls.filter(([url]) => url === "/api/node").length;
    return { api: new SetupApi("", fetchImpl), fetchImpl, nodeCalls, signals };
  }

  async function mountJoining(
    answers: (() => Promise<Response>)[],
    extra: Partial<SetupDoneScreen> = {},
    boxStatus?: () => Promise<Response>,
  ) {
    const { api, ...rest } = joiningApi(answers, boxStatus);
    const { el } = await mountWidget<SetupDoneScreen>("setup-done-screen", {
      api,
      startDelayMs: 0,
      pollIntervalMs: 3,
      mirrorJoin: true,
      contactUrl: SPARE,
      drawQr: async () => PIXEL,
      ...extra,
    });
    return { el, ...rest };
  }

  /** A joining page whose box has already joined. */
  async function mountJoined(extra: Partial<SetupDoneScreen> = {}) {
    const mounted = await mountJoining([() => Promise.resolve(json(JOINED_PROBE))], extra);
    await vi.waitFor(() => expect(done(mounted.el, "join")).toBe("true"));
    return mounted;
  }
  const taskIds = (el: SetupDoneScreen) =>
    [...el.shadowRoot!.querySelectorAll("[data-test=joining-tasks] > li")].map((task) =>
      task.getAttribute("data-test"),
    );
  const label = (el: SetupDoneScreen) =>
    q(el, "[data-test=task-label] setup-box-label") as SetupBoxLabel | null;

  const status = (el: SetupDoneScreen) => q(el, "[data-test=joining-status]")!;
  const statusText = (el: SetupDoneScreen) => status(el).textContent!.replace(/\s+/g, " ").trim();
  const done = (el: SetupDoneScreen, task: string) =>
    q(el, `[data-test=task-${task}]`)!.getAttribute("data-done");
  const stateText = (el: SetupDoneScreen, task: string) =>
    q(el, `[data-test=task-${task}-state]`)!.textContent!.trim();

  it("says it is joining, then changes by itself to joined and ticks the first task", async () => {
    const { el, nodeCalls } = await mountJoining([
      unreachable,
      notFound,
      () => Promise.resolve(json({ error: { code: "server.internal", params: {} } }, 503)),
      () => Promise.resolve(json(JOINED_PROBE)),
    ]);
    expect(q(el, "h1")!.textContent!.trim()).toBe("This box is joining");
    expect(status(el).getAttribute("role")).toBe("status");
    expect(statusText(el)).toBe(JOINING_STATUS_EN);
    expect(done(el, "join")).toBe("false");
    await vi.waitFor(() => expect(done(el, "join")).toBe("true"));
    expect(q(el, "[data-test=joining-status]")).toBeNull();
    expect(q(el, "h1")!.textContent!.trim()).toBe("This box has joined");
    expect(done(el, "join")).toBe("true");
    expect(stateText(el, "join")).toBe("Done");
    expect(q(el, "[data-test=error]")).toBeNull();
    expect(el.shadowRoot!.querySelector("[role=alert]")).toBeNull();
    expect(nodeCalls()).toBe(4);
    await afterATimerTurn(el);
    expect(nodeCalls()).toBe(4);
  });

  it("keeps polling quietly while the box restarts, showing no error", async () => {
    const { el, nodeCalls } = await mountJoining([
      unreachable,
      notFound,
      () => Promise.resolve(json({ error: { code: "server.internal", params: {} } }, 500)),
      () => Promise.resolve(new Response("<!doctype html>", { status: 200 })),
    ]);
    await vi.waitFor(() => expect(nodeCalls()).toBeGreaterThan(5));
    expect(statusText(el)).toBe(JOINING_STATUS_EN);
    expect(done(el, "join")).toBe("false");
    expect(el.shadowRoot!.querySelector("[role=alert]")).toBeNull();
  });

  it.each([
    ["a box whose trading admission is not ready", { acceptingSales: false }],
    ["a box holding no chart", { ...JOINED_PROBE, term: null, standing: null }],
    ["a box the chart lists as evicted", { ...JOINED_PROBE, standing: "evicted" }],
  ])("does not count the answer of %s as joined", async (_, body) => {
    const { el, nodeCalls } = await mountJoining([() => Promise.resolve(json(body))]);
    await vi.waitFor(() => expect(nodeCalls()).toBeGreaterThan(3));
    expect(statusText(el)).toBe(JOINING_STATUS_EN);
    expect(done(el, "join")).toBe("false");
  });

  it.each([
    [
      "en-GB",
      "waiting",
      "Joining. Waiting for the main box to send its copy of the restaurant's data.",
    ],
    [
      "en-GB",
      "restoring",
      "Joining. Copying the restaurant's data from the main box. The main box keeps selling.",
    ],
    ["en-GB", "ready", "Joining. The copy is complete and this box is restarting."],
    [
      "es-ES",
      "waiting",
      "Uniéndose. Esperando a que el servidor principal envíe su copia de los datos del restaurante.",
    ],
    [
      "es-ES",
      "restoring",
      "Uniéndose. Copiando los datos del restaurante desde el servidor principal. El servidor principal sigue vendiendo.",
    ],
    ["es-ES", "ready", "Uniéndose. La copia está completa y este servidor se está reiniciando."],
  ] as const)(
    "says where the first copy has got to while the box is joining (%s, %s)",
    async (locale, copy, words) => {
      setLocale(locale);
      const { el } = await mountJoining([notFound], {}, () =>
        Promise.resolve(json({ adoption: "pending", copy })),
      );
      await vi.waitFor(() => expect(statusText(el)).toBe(words));
      expect(done(el, "join")).toBe("false");
    },
  );

  it("drops the copy's stage once the box answers its role probe without being joined", async () => {
    let probe: () => Promise<Response> = notFound;
    const { el } = await mountJoining([() => probe()], {}, () =>
      Promise.resolve(json({ adoption: "pending", copy: "ready" })),
    );
    await vi.waitFor(() =>
      expect(statusText(el)).toBe("Joining. The copy is complete and this box is restarting."),
    );
    probe = () => Promise.resolve(json({ acceptingSales: false }));
    await vi.waitFor(() => expect(statusText(el)).toBe(JOINING_STATUS_EN));
  });

  it("says plainly when it has lost the box, links the Servers page, and still ticks joined later", async () => {
    let probe: () => Promise<Response> = notFound;
    const { el, nodeCalls } = await mountJoining([() => probe()], {
      serversUrl: SERVERS,
      lostAfterMs: 40,
      lostPollIntervalMs: 6,
    });
    await vi.waitFor(() => expect(nodeCalls()).toBeGreaterThan(1));
    probe = unreachable;
    expect(statusText(el)).toBe(JOINING_STATUS_EN);
    await vi.waitFor(() => expect(statusText(el)).toBe(LOST_EN));
    const link = q(el, "[data-test=joining-status] a") as HTMLAnchorElement;
    expect(link.href).toBe(SERVERS);
    expect(link.target).toBe("_blank");
    expect(link.rel).toBe("noopener noreferrer");
    expect(link.textContent!.trim()).toBe("Servers page");
    expect(done(el, "join")).toBe("false");
    expect(stateText(el, "join")).toBe("In progress");
    expect(taskIds(el)).toEqual(["task-join", "task-label"]);
    probe = () => Promise.resolve(json(JOINED_PROBE));
    await vi.waitFor(() => expect(done(el, "join")).toBe("true"));
    expect(q(el, "[data-test=joining-status]")).toBeNull();
    expect(taskIds(el)).toEqual(["task-join", "task-label"]);
  });

  it("keeps the label task shown once it has lost the box, even when the box answers again as joining", async () => {
    let probe: () => Promise<Response> = unreachable;
    const { el } = await mountJoining([() => probe()], { lostAfterMs: 20, lostPollIntervalMs: 6 });
    await vi.waitFor(() => expect(statusText(el)).toBe(LOST_EN));
    expect(taskIds(el)).toEqual(["task-join", "task-label"]);
    probe = notFound;
    await vi.waitFor(() => expect(statusText(el)).toBe(JOINING_STATUS_EN));
    expect(done(el, "join")).toBe("false");
    expect(taskIds(el)).toEqual(["task-join", "task-label"]);
  });

  it("goes back to the joining status when the box answers again", async () => {
    let probe: () => Promise<Response> = unreachable;
    const { el } = await mountJoining([() => probe()], { lostAfterMs: 20, lostPollIntervalMs: 6 });
    await vi.waitFor(() => expect(statusText(el)).toMatch(/^This page can no longer reach/));
    probe = notFound;
    await vi.waitFor(() => expect(statusText(el)).toBe(JOINING_STATUS_EN));
  });

  it("does not say it has lost the box before a minute without an answer", async () => {
    const { el, nodeCalls } = await mountJoining([unreachable]);
    await vi.waitFor(() => expect(nodeCalls()).toBeGreaterThan(5));
    expect(statusText(el)).toBe(JOINING_STATUS_EN);
  });

  it("gives up on a request the box never answers, and counts it as no answer", async () => {
    const { el, nodeCalls, signals } = await mountJoining([() => new Promise(() => {})], {
      requestTimeoutMs: 5,
      lostAfterMs: 30,
      lostPollIntervalMs: 6,
    });
    await vi.waitFor(() => expect(nodeCalls()).toBeGreaterThan(2));
    expect(signals[0]?.aborted).toBe(true);
    await vi.waitFor(() => expect(statusText(el)).toMatch(/^This page can no longer reach/));
  });

  it.each([
    ["gets no answer in time", () => new Promise<Response>(() => {})],
    ["cannot reach the box", unreachable],
    [
      "is refused",
      () => Promise.resolve(json({ error: { code: "server.internal", params: {} } }, 500)),
    ],
  ])(
    "keeps the copy's stage, and counts the refused role probe as an answer, when the status read %s",
    async (_, later) => {
      let boxCalls = 0;
      const { el } = await mountJoining(
        [notFound],
        { requestTimeoutMs: 10, lostAfterMs: 0, lostPollIntervalMs: 3 },
        () => {
          boxCalls += 1;
          return boxCalls === 1
            ? Promise.resolve(json({ adoption: "pending", copy: "restoring" }))
            : later();
        },
      );
      const copying =
        "Joining. Copying the restaurant's data from the main box. The main box keeps selling.";
      await vi.waitFor(() => expect(statusText(el)).toBe(copying));
      await vi.waitFor(() => expect(boxCalls).toBeGreaterThan(4));
      expect(statusText(el)).toBe(copying);
    },
  );

  it("counts a role-probe answer that is not JSON as the box answering", async () => {
    const htmlPage = () =>
      Promise.resolve(
        new Response("<!doctype html>", { status: 200, headers: { "content-type": "text/html" } }),
      );
    const { el, nodeCalls } = await mountJoining([htmlPage], {
      lostAfterMs: 0,
      lostPollIntervalMs: 3,
    });
    await vi.waitFor(() => expect(nodeCalls()).toBeGreaterThan(3));
    expect(statusText(el)).toBe(JOINING_STATUS_EN);
  });

  it("cancels the request in flight when the screen leaves the page", async () => {
    const { el, signals } = await mountJoining([() => new Promise(() => {})]);
    await vi.waitFor(() => expect(signals).toHaveLength(1));
    expect(signals[0]?.aborted).toBe(false);
    el.remove();
    expect(signals[0]?.aborted).toBe(true);
  });

  it("shows the Servers page words without a link when the main box's address is not known", async () => {
    const { el } = await mountJoining([unreachable], { lostAfterMs: 0 });
    await vi.waitFor(() => expect(statusText(el)).toBe(LOST_EN));
    expect(q(el, "[data-test=joining-status] a")).toBeNull();
  });

  it("stops polling when the screen leaves the page", async () => {
    const { el, fetchImpl } = await mountJoining([
      () => Promise.resolve(json({ acceptingSales: false })),
    ]);
    await vi.waitFor(() => expect(fetchImpl.mock.calls.length).toBeGreaterThan(1));
    el.remove();
    const calls = fetchImpl.mock.calls.length;
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(fetchImpl.mock.calls.length).toBeLessThanOrEqual(calls + 1);
    const settled = fetchImpl.mock.calls.length;
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(fetchImpl.mock.calls.length).toBe(settled);
  });

  it("the joining page shows no key task", async () => {
    const { el } = await mountJoined({
      breakGlassSecret: "key-on-paper",
      breakGlassKeyName: "2026-10-15 · K7QF",
    });
    expect(taskIds(el)).toEqual(["task-join", "task-label"]);
    expect(q(el, "[data-test=break-glass-secret]")).toBeNull();
    expect(q(el, "[data-test=key-wrote]")).toBeNull();
  });

  it("shows this box's label in the label task, printing it once its QR is drawn", async () => {
    let finish!: (qr: string) => void;
    const drawQr = vi.fn(() => new Promise<string>((resolve) => (finish = resolve)));
    const printFrame = vi.fn<(view: Window) => void>();
    const { el } = await mountJoined({ drawQr, printFrame });
    const task = q(el, "[data-test=task-label]")!;
    expect(task.querySelector(".task-label")!.textContent!.trim()).toBe(
      "Print the QR code for this box",
    );
    expect(stateText(el, "label")).toBe("To do");
    expect(task.querySelector("[data-test=label-why]")!.textContent!.trim()).toBe(
      "Print the QR code and attach it to this box. If the main box fails, you can scan the QR code with a till or phone on the venue's network to promote this box from spare to be the new main box.",
    );
    const preview = label(el)!;
    expect(preview.address).toBe(SPARE);
    expect(drawQr).toHaveBeenCalledExactlyOnceWith(SWITCH_PAGE);
    const part = (test: string) =>
      preview.shadowRoot!.querySelector<HTMLElement>(`[data-test=${test}]`)!;
    expect(part("label-name").textContent!.trim()).toBe("box-41aa.waitron.local");
    expect(part("label-address").textContent!.trim()).toBe(SWITCH_PAGE);
    const print = part("print-label") as HTMLElement & { disabled: boolean };
    expect(print.disabled).toBe(true);
    finish(PIXEL);
    await vi.waitFor(() => expect(print.disabled).toBe(false));
    print.click();
    await vi.waitFor(() => expect(printFrame).toHaveBeenCalledTimes(1));
    const view = printFrame.mock.calls[0]![0];
    expect(view.document.body.textContent).toContain(SWITCH_PAGE);
    view.dispatchEvent(new Event("afterprint"));
    expect(done(el, "label")).toBe("true");
  });

  it.each([
    [
      "en-GB",
      "Print the QR code for this box",
      "Print the QR code and attach it to this box. If the main box fails, you can scan the QR code with a till or phone on the venue's network to promote this box from spare to be the new main box.",
      "Print QR code",
      "To do",
      "Done",
    ],
    [
      "es-ES",
      "Imprimir el código QR de este servidor",
      "Imprime el código QR y pégalo en este servidor. Si el servidor principal falla, puedes escanear el código QR con una caja o un móvil de la red del local para convertir este servidor de reserva en el nuevo servidor principal.",
      "Imprimir código QR",
      "Pendiente",
      "Hecho",
    ],
  ] as const)(
    "the QR code task has one button, Print QR code, and asks for no confirmation (%s)",
    async (locale, heading, why, button, toDo, doneWord) => {
      setLocale(locale);
      const printFrame = vi.fn<(view: Window) => void>();
      const { el } = await mountJoined({ printFrame });
      const task = q(el, "[data-test=task-label]")!;
      expect(task.querySelector(".task-label")!.textContent!.trim()).toBe(heading);
      expect(task.querySelector("[data-test=label-why]")!.textContent!.trim()).toBe(why);
      expect(stateText(el, "label")).toBe(toDo);
      const buttons = () => [
        ...task.querySelectorAll("wt-button, button"),
        ...label(el)!.shadowRoot!.querySelectorAll("wt-button, button"),
      ];
      const print = label(el)!.shadowRoot!.querySelector<HTMLElement & { disabled: boolean }>(
        "[data-test=print-label]",
      )!;
      expect(buttons()).toEqual([print]);
      expect(print.textContent!.trim()).toBe(button);
      expect(q(el, "[data-test=label-stuck]")).toBeNull();
      await vi.waitFor(() => expect(print.disabled).toBe(false));
      await userEvent.click(print);
      await el.updateComplete;
      await vi.waitFor(() => expect(printFrame).toHaveBeenCalledTimes(1));
      printFrame.mock.calls[0]![0].dispatchEvent(new Event("afterprint"));
      expect(done(el, "label")).toBe("true");
      expect(stateText(el, "label")).toBe(doneWord);
      expect(label(el)!.shadowRoot!.querySelector("[data-test=print-label]")).toBe(print);
      expect(task.querySelector("[data-test=label-why]")!.textContent!.trim()).toBe(why);
    },
  );

  it("pressing Print QR code before the QR is drawn ticks nothing", async () => {
    const printFrame = vi.fn<(view: Window) => void>();
    const { el } = await mountJoined({
      drawQr: () => new Promise<string>(() => {}),
      printFrame,
    });
    const print = label(el)!.shadowRoot!.querySelector<HTMLElement & { disabled: boolean }>(
      "[data-test=print-label]",
    )!;
    expect(print.disabled).toBe(true);
    print.click();
    print.dispatchEvent(new MouseEvent("click", { bubbles: true, composed: true }));
    await el.updateComplete;
    expect(printFrame).not.toHaveBeenCalled();
    expect(done(el, "label")).toBe("false");
    expect(stateText(el, "label")).toBe("To do");
  });

  it("offers no label task when this box's address is not known", async () => {
    const { el } = await mountJoined({ contactUrl: undefined });
    expect(taskIds(el)).toEqual(["task-join"]);
  });

  it("shows no Servers page link on the page once the box answers", async () => {
    const { el } = await mountJoined({ serversUrl: SERVERS });
    expect(el.shadowRoot!.querySelector("a")).toBeNull();
    expect(el.shadowRoot!.textContent!).not.toContain("Print switch label");
  });

  it.each(["join", "label"])("shows the %s task's state as visible words", async (task) => {
    const { el } = await mountJoined();
    const state = q(el, `[data-test=task-${task}-state]`)!;
    const box = state.getBoundingClientRect();
    expect(box.width).toBeGreaterThan(8);
    expect(box.height).toBeGreaterThan(8);
    expect(getComputedStyle(state).clipPath).toBe("none");
  });

  it("drops the long paragraphs and never says the page will not change", async () => {
    const { el } = await mountJoining([() => new Promise(() => {})]);
    const text = el.shadowRoot!.textContent!.replace(/\s+/g, " ");
    expect(text).not.toContain("This page will not change");
    expect(text).not.toContain(JOINING_BODY_EN);
    expect(q(el, "[data-test=joining-next]")).toBeNull();
    expect(q(el, "[data-test=joining-switch-label]")).toBeNull();
  });

  it("shows the joining and joined page in Spanish", async () => {
    setLocale("es-ES");
    let probe: () => Promise<Response> = () => new Promise(() => {});
    const { el } = await mountJoining([() => probe()], { serversUrl: SERVERS });
    expect(q(el, "h1")!.textContent!.trim()).toBe("Este servidor se está uniendo");
    expect(statusText(el)).toBe(JOINING_STATUS_ES);
    expect(stateText(el, "join")).toBe("En curso");
    probe = () => Promise.resolve(json(JOINED_PROBE));
    await vi.waitFor(() => expect(done(el, "join")).toBe("true"));
    expect(q(el, "h1")!.textContent!.trim()).toBe("Este servidor se ha unido");
    expect(stateText(el, "label")).toBe("Pendiente");
    const task = q(el, "[data-test=task-label]")!;
    expect(task.querySelector(".task-label")!.textContent!.trim()).toBe(
      "Imprimir el código QR de este servidor",
    );
    expect(task.querySelector("[data-test=label-why]")!.textContent!.trim()).toBe(
      "Imprime el código QR y pégalo en este servidor. Si el servidor principal falla, puedes escanear el código QR con una caja o un móvil de la red del local para convertir este servidor de reserva en el nuevo servidor principal.",
    );
  });

  it("says in Spanish when it has lost the box", async () => {
    setLocale("es-ES");
    const { el } = await mountJoining([unreachable], { serversUrl: SERVERS, lostAfterMs: 0 });
    await vi.waitFor(() =>
      expect(statusText(el)).toBe(
        "Esta página ya no puede comunicarse con este servidor. Suele pasar después de que se reinicie para unirse: entonces usa el certificado de seguridad propio del restaurante, que este navegador no ha aceptado. Para comprobarlo, abre la página Servidores del servidor principal y mira la fila de este servidor.",
      ),
    );
  });
});
