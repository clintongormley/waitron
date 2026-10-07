import type { Page } from "playwright";
import type { BrowserCommand } from "vitest/node";

type Scenario = "dirty-keep" | "dirty-discard" | "clean" | "reverted" | "saved";

export const probeTillReload: BrowserCommand<[scenario: Scenario]> = async (context, scenario) => {
  const runner = (context as unknown as { page: Page }).page;
  const subject = await runner.context().newPage();
  subject.setDefaultTimeout(8_000);
  subject.setDefaultNavigationTimeout(8_000);
  const dialogs: string[] = [];
  const savedNotes: string[] = [];
  const errors: string[] = [];
  let finishReload: (() => void) | undefined;
  const fixtureUrl = new URL("/__w69_native_reload__", runner.url()).href;
  subject.on("pageerror", (error) => errors.push(error.message));
  subject.on("dialog", async (dialog) => {
    dialogs.push(dialog.type());
    if (scenario === "dirty-keep") {
      await dialog.dismiss();
      finishReload?.();
    } else await dialog.accept();
  });
  try {
    await subject.route("**/*", (route) =>
      route.request().isNavigationRequest()
        ? route.fulfill({
            contentType: "text/html",
            body: "<!doctype html><html><head><title>Native till reload probe</title><style>html,body{height:100%;margin:0}till-app{display:block;height:100%}</style></head><body></body></html>",
          })
        : route.continue(),
    );
    await subject.exposeFunction("recordAbsence", (note: string) => {
      savedNotes.push(note);
    });
    await subject.goto(fixtureUrl);
    const tokenSource = new URL("../../../packages/ui/src/tokens/index.ts", import.meta.url)
      .pathname;
    await subject.evaluate(async (tokenSource) => {
      const { applyTokens } = await import(/* @vite-ignore */ `/@fs${tokenSource}`);
      applyTokens(document.documentElement);
      const source = "/src/till-app.ts";
      await import(/* @vite-ignore */ source);
      const app = document.createElement("till-app") as HTMLElement & { api: unknown };
      const empty = async () => [];
      app.api = {
        getDevDevices: async () => {
          throw { code: "server.internal" };
        },
        getDeviceIdentity: async () => ({
          deviceId: "native-reload-till",
          name: "Till 1",
          formFactor: "till",
          stationId: null,
        }),
        getContentLanguages: async () => ({ defaultLanguage: "en", languages: ["en", "es"] }),
        getLocales: async () => ({
          locales: [{ code: "en-GB", label: "English" }],
          venueDefault: "en-GB",
          loginDefault: "en-GB",
        }),
        getTill: async () => ({
          locale: "en-GB",
          invoiceLocale: "en-GB",
          venueName: "Native reload fixture",
          nif: "B12345678",
          orderFlow: "prepay",
          receiptPrintMode: "auto",
          bumpMode: "line",
          fireControl: "waiter",
          courses: [],
          cardProvider: "none",
          tipsEnabled: false,
          canvas: {
            formFactor: "till",
            tabs: [{ key: "counter", title: "Counter", columns: 12, cards: [] }],
          },
          capabilities: ["show-schedule"],
          inactivityTimeoutSeconds: null,
          nodeId: "native-reload-node",
          servers: [],
        }),
        listDefaultZoneOffers: async () => ({
          context: {
            zoneId: "counter",
            departmentId: "department",
            serviceMode: "prepay",
            receiptPrintMode: "auto",
          },
          menus: [],
          offers: [],
        }),
        setServiceZone: () => {},
        listStaff: async () => [{ personId: "p1", displayName: "Ana" }],
        clockStatus: async () => ({ state: "not-applicable" }),
        reportBattery: async () => {},
        listMyShifts: empty,
        listMySwaps: empty,
        listMyAbsences: empty,
        requestAbsence: async ({ note }: { note: string }) => {
          await (window as unknown as { recordAbsence(note: string): Promise<void> }).recordAbsence(
            note,
          );
        },
      };
      document.body.append(app);
    }, tokenSource);
    await subject.locator("till-lock-screen").waitFor();
    await subject.locator("till-lock-screen").evaluate((owner) => {
      owner.dispatchEvent(
        new CustomEvent("logged-in", {
          detail: { personId: "p1", displayName: "Ana", permissions: [], locale: "en-GB" },
          bubbles: true,
          composed: true,
        }),
      );
    });
    await subject.locator("till-tab-shell").waitFor({ state: "attached" });
    await subject.locator("till-tab-shell").evaluate((owner) => {
      owner.dispatchEvent(new CustomEvent("show-schedule", { bubbles: true, composed: true }));
    });
    const note = subject.locator("wt-input.abs-note input");
    await note.waitFor();
    // A real click gives Chromium activation even in the clean control.
    await subject.locator("wt-input.abs-note label").click();
    if (scenario !== "clean") await note.fill("Family visit");
    if (scenario === "reverted") await note.fill("");
    if (scenario === "saved") {
      await subject.locator("wt-input.abs-from input").fill("2026-12-01");
      await subject.locator("wt-input.abs-to input").fill("2026-12-02");
      await subject.locator("wt-button.abs-submit button").click();
      await subject.waitForFunction(() => {
        const app = document.querySelector("till-app")!;
        const owner = app.shadowRoot!.querySelector("till-schedule-screen")!;
        return (
          owner.shadowRoot!.querySelector<HTMLElement & { value: string }>(".abs-note")!.value ===
          ""
        );
      });
    }
    const documentId = await subject.evaluate(() => {
      const id = crypto.randomUUID();
      document.body.dataset["probeDocument"] = id;
      return id;
    });
    const session = await subject.context().newCDPSession(subject);
    let deadline: ReturnType<typeof setTimeout> | undefined;
    const settled = new Promise<void>((resolve, reject) => {
      finishReload = resolve;
      deadline = setTimeout(
        () => reject(new Error("Reload neither navigated nor was dismissed")),
        8_000,
      );
    });
    const arrived = (frame: ReturnType<Page["mainFrame"]>) => {
      if (frame === subject.mainFrame()) finishReload?.();
    };
    subject.on("framenavigated", arrived);
    try {
      // page.reload waits for a navigation that a rejected unload deliberately prevents.
      await session.send("Page.reload");
      await settled;
      if (scenario !== "dirty-keep") await subject.waitForLoadState("domcontentloaded");
    } finally {
      clearTimeout(deadline);
      subject.off("framenavigated", arrived);
      finishReload = undefined;
      await session.detach();
    }
    const retained = await subject.evaluate(() => {
      const app = document.querySelector("till-app");
      const owner = app?.shadowRoot?.querySelector("till-schedule-screen");
      const input = owner?.shadowRoot
        ?.querySelector<HTMLElement>("wt-input.abs-note")
        ?.shadowRoot?.querySelector<HTMLInputElement>("input");
      return { documentId: document.body.dataset["probeDocument"], note: input?.value ?? null };
    });
    if (errors.length > 0) throw new Error(errors.join("\n"));
    return {
      dialogs,
      reloaded: retained.documentId !== documentId,
      note: retained.note,
      savedNotes,
    };
  } finally {
    await subject.close({ runBeforeUnload: false });
  }
};
