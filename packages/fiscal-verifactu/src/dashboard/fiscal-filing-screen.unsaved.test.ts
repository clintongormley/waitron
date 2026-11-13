import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { userEvent } from "vitest/browser";
import { LitElement, html } from "lit";
import { LeaveController, applyTokens } from "@waitron/ui";
import { currentLocale, setLocale, type DashboardRequest } from "@waitron/dashboard-kit";
import { VERIFACTU_DASHBOARD } from "./index.js";
import type { FiscalFilingScreen } from "./fiscal-filing-screen.js";
import { conflictCase, overview } from "../../test/fiscal-filing-browser-fixture.js";

const MESSAGE = "Valor o tipo incorrecto del campo: DescripcionOperacion";
const base = conflictCase("rec-1", "2026-11-03T11:02:00.000Z");
const found = {
  ...base,
  cause: "fiscal.registro_rechazado" as const,
  evidence: { codigo: 1100, mensaje: MESSAGE, csv: null },
  submission: { ...base.submission!, codigoError: "1100", mensajeError: MESSAGE },
  conflicts: [],
};
const request = vi.fn(async () => overview({ cases: [found], totalCases: 1 }));

class FilingLeaveApp extends LitElement {
  readonly leave = new LeaveController(this);
  readonly screen = VERIFACTU_DASHBOARD.moreScreens![0]!.create({
    request: request as unknown as DashboardRequest,
  });
  override render() {
    return html`${this.screen.render()}
    ${this.leave.render({
      heading: "Unsaved changes",
      message: "Discard unsaved changes?",
      keepLabel: "Keep editing",
      discardLabel: "Discard changes",
    })}`;
  }
}
customElements.define("fiscal-filing-leave-test", FilingLeaveApp);

let app: FilingLeaveApp;
let locale = "";
beforeEach(() => {
  request.mockClear();
  locale = currentLocale();
  setLocale("en");
});
afterEach(() => {
  app?.remove();
  setLocale(locale);
});

function unload() {
  const event = new Event("beforeunload", { cancelable: true });
  window.dispatchEvent(event);
  return event.defaultPrevented;
}

async function question() {
  await app.updateComplete;
  const q = app.shadowRoot!.querySelector("wt-unsaved-changes")!;
  await q.updateComplete;
  return q;
}

async function openAndEdit() {
  app = document.createElement("fiscal-filing-leave-test") as FilingLeaveApp;
  applyTokens(app);
  document.body.append(app);
  await app.updateComplete;
  const screen = app.shadowRoot!.querySelector("vf-fiscal-filing-screen") as FiscalFilingScreen;
  await vi.waitFor(() =>
    expect(screen.shadowRoot?.querySelector("[data-state=read]")).not.toBeNull(),
  );
  const table = screen.shadowRoot!.querySelector("wt-data-table")!;
  const view = () =>
    table.shadowRoot?.querySelector<HTMLElement>("[data-test=view-rec-1]") ??
    table.querySelector<HTMLElement>("[data-test=view-rec-1]");
  await vi.waitFor(() => expect(view()).not.toBeNull());
  view()!.click();
  const details = screen.shadowRoot!.querySelector("wt-modal[data-test=case-details]")!;
  await vi.waitFor(() => expect(details).toHaveProperty("open", true));
  expect(unload()).toBe(false);
  const area = details
    .querySelector("wt-textarea[name=operationDescription]")!
    .shadowRoot!.querySelector("textarea")!;
  await userEvent.click(area);
  await userEvent.fill(area, "Servicio de restauración");
  await screen.updateComplete;
  return { screen, details };
}

it("asks before Escape closes an edited description, Keep leaves it, and Stop discards it", async () => {
  const { screen, details } = await openAndEdit();
  expect(unload()).toBe(true);
  await userEvent.keyboard("{Escape}");
  await vi.waitFor(async () => expect((await question()).open).toBe(true));
  (await question()).shadowRoot!.querySelector<HTMLElement>("[data-choice=keep]")!.click();
  await vi.waitFor(async () => expect((await question()).open).toBe(false));
  expect(details).toHaveProperty("open", true);
  expect(details.querySelector("wt-textarea")!.value).toBe("Servicio de restauración");

  await userEvent.click(details.querySelector("[data-test=stop]")!);
  await vi.waitFor(() => expect(details).toHaveProperty("open", false));
  await screen.updateComplete;
  expect(unload()).toBe(false);
  expect(request).toHaveBeenCalledTimes(1);
});

it("asks before the page is left with an edited description", async () => {
  await openAndEdit();
  const proceed = vi.fn();
  const left = app.leave.coordinator.request({ scopes: "all", reason: "navigation", proceed });
  await vi.waitFor(async () => expect((await question()).open).toBe(true));
  expect(proceed).not.toHaveBeenCalled();
  (await question()).shadowRoot!.querySelector<HTMLElement>("[data-choice=discard]")!.click();
  expect(await left).toBe("proceeded");
  expect(proceed).toHaveBeenCalledOnce();
  expect(request).toHaveBeenCalledTimes(1);
});
