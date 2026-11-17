import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanupWidgets, mountWidget } from "../widgets/test-helpers.js";
import { setLocale } from "../i18n/t.js";
import "./done-screen.js";
import { BACKUP_SETUP_URL, SetupDoneScreen } from "./done-screen.js";
import "./review-screen.js";
import type { SetupReviewScreen } from "./review-screen.js";
import { SetupApi } from "../api/client.js";

const q = (el: SetupDoneScreen, sel: string) => el.shadowRoot!.querySelector<HTMLElement>(sel);

function apiWith(getStatus: () => Promise<unknown>): SetupApi {
  return { getStatus } as unknown as SetupApi;
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

const RESTART_EN = "The server is restarting to finish setup. Once it is back, open it here:";
const READY_EN = "The server is ready. Open it here:";
const JOINING_BODY_EN =
  "The sign-in to the restaurant's primary worked. This server now takes its first copy of the restaurant's data from the primary, over the restaurant's network; no internet is needed. This can take a few minutes. It restarts by itself when it has the copy, and then waits as the standby. The primary keeps selling throughout.";
const JOINING_BODY_ES =
  "El inicio de sesión en el servidor principal del restaurante ha funcionado. Este servidor recibe ahora su primera copia de los datos del restaurante desde el principal, por la red del restaurante; no hace falta internet. Puede tardar unos minutos. Se reinicia solo cuando tiene la copia y después espera como servidor en espera. El principal sigue vendiendo todo el tiempo.";

/** Waits past the first poll a trading server would make (`startDelayMs: 0`) and redraws. */
async function afterATimerTurn(el: SetupDoneScreen): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 20));
  await el.updateComplete;
}

const WAITING_EN =
  "Before it creates the new invoice series, the server needs you to confirm its time again. Check that both times below are right, then press Confirm the time. If the server's time is wrong, press This device to set it from this device's time.";
const CONFIRMED_EN = "Time confirmed. This page shows when the server is ready.";
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
  return { getStatus, restoreClock: clock.restoreClock } as unknown as SetupApi;
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
    ["en-GB", "Server key 15 Oct 2026 · K7QF"],
    ["es-ES", "Clave del servidor 15 oct 2026 · K7QF"],
  ] as const)("localizes the issue date and key label in %s", async (locale, name) => {
    setLocale(locale);
    const el = await mountDone(() => new Promise(() => {}), {
      mirrorJoin: true,
      breakGlassSecret: "key-on-paper",
      breakGlassKeyName: "2026-10-15 · K7QF",
    });
    expect(q(el, "[data-test=break-glass-key-name]")?.textContent?.trim()).toBe(name);
    expect(el.breakGlassKeyName).toBe("2026-10-15 · K7QF");
    expect(q(el, "[data-test=break-glass-secret]")?.textContent).toBe("key-on-paper");
    setLocale(locale === "en-GB" ? "es-ES" : "en-GB");
    await el.updateComplete;
    expect(q(el, "[data-test=break-glass-key-name]")?.textContent?.trim()).toBe(
      locale === "en-GB"
        ? "Clave del servidor 15 oct 2026 · K7QF"
        : "Server key 15 Oct 2026 · K7QF",
    );
    expect(el.breakGlassKeyName).toBe("2026-10-15 · K7QF");
  });

  it.each([
    ["en-GB", "Opening hours: Monday to Friday, 09:00–17:00", "Change opening hours"],
    [
      "es-ES",
      "Horario de apertura: de lunes a viernes, 09:00–17:00",
      "Cambiar el horario de apertura",
    ],
  ] as const)(
    "shows the saved first hours and a link to the Opening hours year in %s",
    async (locale, hours, link) => {
      setLocale(locale);
      const el = await mountDone(() => new Promise(() => {}), {
        openingHours: { departmentId: "first-department" },
      } as Partial<SetupDoneScreen>);
      expect(q(el, "[data-test=opening-hours]")?.textContent).toContain(hours);
      const anchor = q(el, "[data-test=opening-hours] a");
      expect(anchor?.textContent?.trim()).toBe(link);
      expect(anchor?.getAttribute("href")).toBe("/opening-hours/view/year");
    },
  );

  it("does not invent hours on a response without a first schedule", async () => {
    const el = await mountDone(() => new Promise(() => {}));
    expect(q(el, "[data-test=opening-hours]")).toBeNull();
  });

  it("announces the restart on the provision/restore path", async () => {
    const el = await mountDone(() => new Promise(() => {}));
    expect(el.shadowRoot!.textContent).toContain(RESTART_EN);
  });

  it.each([
    [
      "en-GB",
      [
        [
          "Dashboard",
          "/",
          "Set up your menu, staff, devices and settings, and see your sales.",
        ],
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

  it("This device sets the server's clock with the key, then confirms the set time against a fresh challenge", async () => {
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
      "The server could not set its clock from this device. Check this device's date and time, then press This device again.",
    ],
    [
      "a screen on the server itself",
      { compare: { result: "same_machine" } },
      undefined,
      "This screen is on the server itself, so its time does not count. Open this page on a phone, computer or till on the venue's network.",
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
      "The server did not accept the server key this page holds. Open any of the server's pages on a phone, computer or till on the venue's network and enter the server key from the selected backup's paper there.",
    ],
    [
      "es-ES",
      "El servidor no ha aceptado la clave del servidor que guarda esta página. Abre cualquier página del servidor en un móvil, ordenador o caja de la red del local e introduce allí la clave del servidor del papel de la copia elegida.",
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
      "This page could not get the two times from the server, so Confirm the time and This device stay off. Keep this page open: it asks the server again by itself.",
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
        api: { getStatus, restoreClock } as unknown as SetupApi,
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
      api: { getStatus, restoreClock } as unknown as SetupApi,
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
      api: { getStatus, restoreClock } as unknown as SetupApi,
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
      api: { getStatus, restoreClock } as unknown as SetupApi,
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
      api: { getStatus, restoreClock } as unknown as SetupApi,
      nodeRecoveryKey: "node-key-secret",
    });
    await vi.waitFor(() =>
      expect(q(el, "[data-test=clock-server]")?.textContent).toBe(when(SERVER_MS)),
    );
    await vi.waitFor(() => expect(getStatus).toHaveBeenCalledTimes(2));
    q(el, "[data-test=clock-confirm]")!.click();
    await vi.waitFor(() =>
      expect(q(el, "[data-test=clock-note]")?.textContent?.trim()).toMatch(
        /^This page could not get the two times from the server/,
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
      api: { getStatus, restoreClock } as unknown as SetupApi,
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

  it("shows a 'no backups yet' nudge with a link to backup setup", async () => {
    const el = await mountDone(() => new Promise(() => {}), { onboardingIntent: "live" });
    const nudge = q(el, "[data-test=backup-nudge]");
    expect(nudge).not.toBeNull();
    const link = nudge!.querySelector("a");
    expect(link).not.toBeNull();
    expect(new URL(link!.href).pathname).toBe(BACKUP_SETUP_URL);
  });

  it("suppresses the nudge in demo mode", async () => {
    const el = await mountDone(() => new Promise(() => {}), { onboardingIntent: "demo" });
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
    expect(text.replace(/\s+/g, " ")).toContain(JOINING_BODY_EN);
  });

  it.each([
    ["en-GB", "This server is joining", JOINING_BODY_EN],
    ["es-ES", "Este servidor se está uniendo", JOINING_BODY_ES],
  ] as const)(
    "says the joining server is taking its first copy (%s)",
    async (locale, heading, body) => {
      setLocale(locale);
      const el = await mountDone(() => new Promise(() => {}), { mirrorJoin: true });
      expect(q(el, "h1")!.textContent!.trim()).toBe(heading);
      expect(q(el, "[data-test=joining-body]")!.textContent!.trim()).toBe(body);
    },
  );

  it.each([
    [
      "en-GB",
      "Print a switch label for each server: open the primary's dashboard, then System, then Servers, and choose Print switch label in each server's row menu.",
    ],
    [
      "es-ES",
      "Imprime una etiqueta de cambio para cada servidor: abre el panel del servidor principal, luego Sistema y luego Servidores, y elige Imprimir etiqueta de cambio en el menú de la fila de cada servidor.",
    ],
  ] as const)(
    "tells the joining server's person to print switch labels (%s)",
    async (locale, words) => {
      setLocale(locale);
      const el = await mountDone(() => new Promise(() => {}), { mirrorJoin: true });
      expect(q(el, "[data-test=joining-switch-label]")!.textContent!.trim()).toBe(words);
    },
  );

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

  it.each([
    ["en-GB", "Older backups need the key from that time", "Server key 15 Oct 2026 · K7QF"],
    [
      "es-ES",
      "Las copias antiguas necesitan la clave de entonces",
      "Clave del servidor 15 oct 2026 · K7QF",
    ],
  ] as const)(
    "shows the paper key name and the old-backup warning in %s",
    async (locale, warning, name) => {
      setLocale(locale);
      const el = await mountDone(() => new Promise(() => {}), {
        mirrorJoin: true,
        breakGlassSecret: "key-on-paper",
        breakGlassKeyName: "2026-10-15 · K7QF",
      } as Partial<SetupDoneScreen>);
      expect(q(el, "[data-test=break-glass-key-name]")?.textContent?.trim()).toBe(name);
      expect(q(el, "[data-test=break-glass-backup-warning]")?.textContent).toContain(warning);
      expect(q(el, "[data-test=break-glass-secret]")?.textContent).toBe("key-on-paper");
    },
  );

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

  it("tells the operator what the break-glass secret is for on a trading server", async () => {
    const el = await mountDone(() => new Promise(() => {}), { breakGlassSecret: "bg-9f3a" });
    expect(q(el, "[data-test=break-glass-secret]")?.textContent).toBe("bg-9f3a");
    const warning = q(el, "[data-test=break-glass-warning]")!.textContent!.replace(/\s+/g, " ");
    expect(warning).toContain("You need it to promote this server if the primary is unreachable.");
    expect(warning).not.toContain("take over from the primary");
  });

  it("shows the break-glass secret on the mirror path without promising a promote", async () => {
    const el = await mountDone(() => new Promise(() => {}), {
      mirrorJoin: true,
      breakGlassSecret: "bg-9f3a",
    });
    expect(q(el, "[data-test=break-glass-secret]")?.textContent).toBe("bg-9f3a");
    const warning = q(el, "[data-test=break-glass-warning]")!.textContent!.replace(/\s+/g, " ");
    expect(warning).toContain("will not be shown again");
    expect(warning).toContain(
      "You will need it if this server ever has to take over from the primary.",
    );
    expect(warning).not.toContain("promote");
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
    expect(q(el, "[data-test=backup-nudge] a")!.textContent!.trim()).toBe(
      "Configura ahora las copias de seguridad",
    );
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
    "after %s, names which devices need a person under a restore heading and shows the no-backups nudge",
    async (_, restored) => {
      const el = await mountDone(() => new Promise(() => {}), { restored });
      expect(q(el, "h1")!.textContent!.trim()).toBe("Restored from your backup");
      const steps = q(el, "[data-test=device-steps]")!.textContent!.replace(/\s+/g, " ");
      expect(steps).toContain("opened at https://waitron.local reconnect by themselves");
      expect(steps).toContain("opened at an IP address");
      expect(steps).toContain("port 9110");
      expect(q(el, "[data-test=backup-nudge]")).not.toBeNull();
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

  it("shows the joining screen and its break-glass code in Spanish", async () => {
    setLocale("es-ES");
    const el = await mountDone(() => new Promise(() => {}), {
      mirrorJoin: true,
      breakGlassSecret: "bg-9f3a",
    });
    expect(q(el, "h1")!.textContent!.trim()).toBe("Este servidor se está uniendo");
    expect(q(el, "[data-test=break-glass] h2")!.textContent!.trim()).toBe(
      "Guarda ahora tu clave del servidor",
    );
    const warning = q(el, "[data-test=break-glass-warning]")!.textContent!.replace(/\s+/g, " ");
    expect(warning).toContain("Se muestra una sola vez y no se volverá a mostrar.");
    expect(warning).toContain(
      "La necesitarás si algún día este servidor tiene que sustituir al principal.",
    );
    expect(warning).not.toContain("pase a ser el principal");
    expect(q(el, "[data-test=break-glass-secret]")!.textContent).toBe("bg-9f3a");
    expect(q(el, "[data-test=status]")).toBeNull();
  });

  it("tells a trading server's operator in Spanish what the break-glass code is for", async () => {
    setLocale("es-ES");
    const el = await mountDone(() => new Promise(() => {}), { breakGlassSecret: "bg-9f3a" });
    const warning = q(el, "[data-test=break-glass-warning]")!.textContent!.replace(/\s+/g, " ");
    expect(warning).toContain(
      "La necesitas para que este servidor pase a ser el principal si no se puede contactar con el principal actual.",
    );
    expect(warning).not.toContain("sustituir al principal");
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
    expect(text).not.toContain("Once the server is trading");
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

  it("puts the backup nudge in a card, its link coloured as the wizard's help links", async () => {
    const { el, host } = await mountWidget<SetupDoneScreen>("setup-done-screen", {
      api: apiWith(() => new Promise(() => {})),
      startDelayMs: 0,
      onboardingIntent: "live",
    });
    host.style.setProperty("--wt-color-primary-text", "rgb(31, 32, 33)");
    host.style.setProperty("--wt-color-primary", "rgb(91, 92, 93)");
    const nudge = q(el, "[data-test=backup-nudge]")!;
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
    ["an ordinary setup", { onboardingIntent: "live" }, ["links", "break-glass", "backup-nudge"]],
    ["a rebuild", { restored: "bucket" }, ["links", "device-steps", "break-glass"]],
    [
      "an archive restore",
      { restored: "archive" },
      ["links", "device-steps", "break-glass", "backup-nudge"],
    ],
    [
      "a Waitron Cloud restore",
      { restored: "cloud" },
      ["links", "device-steps", "break-glass", "backup-nudge"],
    ],
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
