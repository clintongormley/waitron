import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanupWidgets, mountWidget } from "../widgets/test-helpers.js";
import { setLocale } from "../i18n/t.js";
import "./done-screen.js";
import { BACKUP_SETUP_URL, SetupDoneScreen } from "./done-screen.js";
import "./review-screen.js";
import type { SetupReviewScreen } from "./review-screen.js";
import type { SetupApi } from "../api/client.js";

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

afterEach(() => {
  setLocale("en-GB");
  cleanupWidgets();
});

describe("setup-done-screen", () => {
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
          "/manage",
          "Set up your menu, staff, devices and settings, and see your sales.",
        ],
        ["Till", "/", "Take orders and payments."],
        [
          "Email inbox",
          "/manage/email",
          "Read account emails captured locally, such as invitations and password resets.",
        ],
      ],
    ],
    [
      "es-ES",
      [
        [
          "Panel",
          "/manage",
          "Configura la carta, el personal, los dispositivos y los ajustes, y consulta tus ventas.",
        ],
        ["Caja", "/", "Toma pedidos y cobra."],
        [
          "Bandeja de correo",
          "/manage/email",
          "Lee los correos de cuentas capturados localmente, como invitaciones y restablecimientos de contraseña.",
        ],
      ],
    ],
  ] as const)(
    "describes each destination under its heading in %s, dashboard first",
    async (locale, expected) => {
      setLocale(locale);
      const el = await mountDone(() => new Promise(() => {}));
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
    const el = await mountDone(() => new Promise(() => {}), { rebuilt: true });
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
    const getStatus = vi.fn().mockRejectedValue({ code: "server.internal" });
    const el = await mountDone(getStatus);
    await vi.waitFor(() => expect(q(el, "[data-test=status]")?.textContent?.trim()).toBe(READY_EN));
    expect(q(el, "[data-test=reload]")).toBeNull();
  });

  it("waits through network failures, then reports ready on the first non-2xx", async () => {
    const getStatus = vi
      .fn()
      .mockRejectedValueOnce(new TypeError("Failed to fetch"))
      .mockRejectedValueOnce(new TypeError("Failed to fetch"))
      .mockRejectedValue({ code: "server.internal" });
    const el = await mountDone(getStatus);
    await vi.waitFor(() => expect(q(el, "[data-test=status]")?.textContent?.trim()).toBe(READY_EN));
  });

  it("keeps waiting while getStatus still resolves, then reports ready once it 404s", async () => {
    const getStatus = vi
      .fn()
      .mockResolvedValueOnce({ provisioned: false, environment: "preproduction", needs: ["venue"] })
      .mockResolvedValueOnce({ provisioned: false, environment: "preproduction", needs: ["venue"] })
      .mockRejectedValue({ code: "server.internal" });
    const el = await mountDone(getStatus);
    await vi.waitFor(() => expect(q(el, "[data-test=status]")?.textContent?.trim()).toBe(READY_EN));
  });

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
    expect(hrefs).toEqual(["/manage", "/", "/manage/email"]);
  });

  it("does not promise trading mode on the mirror path", async () => {
    const el = await mountDone(() => new Promise(() => {}), { mirrorJoin: true });
    const text = el.shadowRoot!.textContent!;
    expect(text).not.toContain(RESTART_EN);
    expect(text.replace(/\s+/g, " ")).toContain("no till and no dashboard");
  });

  it("offers no till/dashboard links and no backup nudge on the mirror path", async () => {
    const el = await mountDone(() => new Promise(() => {}), { mirrorJoin: true });
    expect(q(el, "[data-test=links]")).toBeNull();
    expect(q(el, "[data-test=backup-nudge]")).toBeNull();
  });

  it("reports the restart instead of offering a reload on the mirror path", async () => {
    const getStatus = vi.fn().mockRejectedValue({ code: "server.internal" });
    const el = await mountDone(getStatus, { mirrorJoin: true });
    await vi.waitFor(() =>
      expect(q(el, "[data-test=status]")?.textContent).toContain("has restarted"),
    );
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

  it("tells the operator what the break-glass secret is for on a trading server", async () => {
    const el = await mountDone(() => new Promise(() => {}), { breakGlassSecret: "bg-9f3a" });
    expect(q(el, "[data-test=break-glass-secret]")?.textContent).toBe("bg-9f3a");
    const warning = q(el, "[data-test=break-glass-warning]")!.textContent!.replace(/\s+/g, " ");
    expect(warning).toContain("You need it to promote this server if the primary is unreachable.");
    expect(warning).not.toContain("cannot do that in this version");
  });

  it("shows the break-glass secret on the mirror path without promising a promote", async () => {
    const el = await mountDone(() => new Promise(() => {}), {
      mirrorJoin: true,
      breakGlassSecret: "bg-9f3a",
    });
    expect(q(el, "[data-test=break-glass-secret]")?.textContent).toBe("bg-9f3a");
    const warning = q(el, "[data-test=break-glass-warning]")!.textContent!.replace(/\s+/g, " ");
    expect(warning).toContain("will not be shown again");
    expect(warning).toContain("cannot do that in this version");
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
    expect(links).toEqual(["Panel", "Caja", "Bandeja de correo"]);
    expect(q(el, "[data-test=backup-nudge] a")!.textContent!.trim()).toBe(
      "Configura ahora las copias de seguridad",
    );
    expect(q(el, "[data-test=status]")!.textContent!.trim()).toBe(
      "El servidor se está reiniciando para terminar la configuración. Cuando vuelva, ábrelo desde aquí:",
    );
  });

  it("reports ready in Spanish once the setup route is gone", async () => {
    setLocale("es-ES");
    const el = await mountDone(() => Promise.reject(new Error("404")));
    await vi.waitFor(() =>
      expect(q(el, "[data-test=status]")?.textContent?.trim()).toBe(
        "El servidor está listo. Ábrelo desde aquí:",
      ),
    );
    expect(q(el, "[data-test=reload]")).toBeNull();
  });

  it("names the devices to reconnect after a rebuild in Spanish", async () => {
    setLocale("es-ES");
    const el = await mountDone(() => new Promise(() => {}), { rebuilt: true });
    expect(q(el, "h1")!.textContent!.trim()).toBe("Reconstruido desde tu bucket");
    const steps = q(el, "[data-test=device-steps]")!.textContent!.replace(/\s+/g, " ");
    expect(steps).toContain("Los dispositivos dependen de cómo se configuró cada uno:");
    expect(steps).toContain("https://waitron.local");
    expect(steps).toContain("/setup/trust");
    expect(steps).toContain("puerto 9110");
  });

  it("shows the stalled join and its break-glass code in Spanish", async () => {
    setLocale("es-ES");
    const el = await mountDone(() => new Promise(() => {}), {
      mirrorJoin: true,
      breakGlassSecret: "bg-9f3a",
    });
    expect(q(el, "h1")!.textContent!.trim()).toBe("Este servidor no se ha unido");
    expect(q(el, "[data-test=break-glass] h2")!.textContent!.trim()).toBe(
      "Guarda ahora tu código de emergencia",
    );
    const warning = q(el, "[data-test=break-glass-warning]")!.textContent!.replace(/\s+/g, " ");
    expect(warning).toContain("Se muestra una sola vez y no se volverá a mostrar.");
    expect(warning).toContain("En esta versión no puede hacerlo");
    expect(q(el, "[data-test=break-glass-secret]")!.textContent).toBe("bg-9f3a");
    expect(q(el, "[data-test=status]")!.textContent!.trim()).toBe(
      "Esperando a que el servidor se reinicie…",
    );
  });

  it("tells a trading server's operator in Spanish what the break-glass code is for", async () => {
    setLocale("es-ES");
    const el = await mountDone(() => new Promise(() => {}), { breakGlassSecret: "bg-9f3a" });
    const warning = q(el, "[data-test=break-glass-warning]")!.textContent!.replace(/\s+/g, " ");
    expect(warning).toContain(
      "Lo necesitas para que este servidor pase a ser el principal si no se puede contactar con el principal actual.",
    );
  });

  it("reports the stalled server's restart in Spanish", async () => {
    setLocale("es-ES");
    const el = await mountDone(() => Promise.reject(new Error("404")), { mirrorJoin: true });
    await vi.waitFor(() =>
      expect(q(el, "[data-test=status]")!.textContent).toContain("El servidor se ha reiniciado"),
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
  it("offers dashboard, till and email inbox as choice rows with descriptions", async () => {
    const el = await mountDone(() => new Promise(() => {}));
    const rows = [...q(el, "[data-test=links]")!.querySelectorAll("wt-choice-row")];
    expect(q(el, "[data-test=links]")!.classList.contains("choices")).toBe(true);
    expect(rows.map((row) => [row.heading, row.href])).toEqual([
      ["Dashboard", "/manage"],
      ["Till", "/"],
      ["Email inbox", "/manage/email"],
    ]);
    expect(rows.every((row) => row.textContent!.trim().length > 0)).toBe(true);
    expect(q(el, "[data-test=links]")!.querySelectorAll("a")).toHaveLength(0);
  });

  it("names each choice row for tests, as the mode screen does", async () => {
    const el = await mountDone(() => new Promise(() => {}));
    const hrefOf = (test: string) =>
      el.shadowRoot!.querySelector<HTMLElement & { href: string }>(`[data-test=${test}]`)?.href;
    expect(["link-till", "link-dashboard", "link-email"].map(hrefOf)).toEqual([
      "/",
      "/manage",
      "/manage/email",
    ]);
  });

  it.each([
    ["an ordinary setup", {}],
    ["a rebuild", { rebuilt: true }],
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
    const el = await mountDone(() => new Promise(() => {}), { rebuilt: true });
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
    host.style.setProperty("--wt-color-primary", "rgb(31, 32, 33)");
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
    ["a rebuild", { rebuilt: true }, ["links", "device-steps", "break-glass"]],
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
    expect(gaps).toEqual([21, 21]);
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
