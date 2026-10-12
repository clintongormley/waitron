import { LitElement, html } from "lit";
import { applyTokens, LeaveController } from "@waitron/ui";
import { type DashboardRequest } from "@waitron/dashboard-kit";
import { expect } from "vitest";
import { page, userEvent } from "vitest/browser";
import { VenueServiceApi, type VenueServiceView } from "../dashboard/client.js";
import { zonesModel } from "./department-zones-fixture.js";
import "../dashboard/zone-edit-dialog.js";

interface ZoneEditor extends LitElement {
  api: VenueServiceApi;
  model: VenueServiceView;
  zoneId: string;
}
class ZoneEditHost extends LitElement {
  readonly leave = new LeaveController(this);
  override render() {
    return html`<zone-edit-dialog></zone-edit-dialog
      >${this.leave.render({ heading: "Unsaved changes", message: "Discard changes?", keepLabel: "Keep editing", discardLabel: "Discard changes" })}`;
  }
}
customElements.define("a493-zone-edit-host", ZoneEditHost);
const hosts = new Set<ZoneEditHost>();
export function cleanupZoneEditors() {
  for (const host of hosts) host.remove();
  hosts.clear();
}
export async function mountZoneEditor(
  request?: DashboardRequest,
  theme: "light" | "dark" = "light",
) {
  const app = document.createElement("a493-zone-edit-host") as ZoneEditHost;
  hosts.add(app);
  applyTokens(app);
  app.setAttribute("data-theme", theme);
  document.body.append(app);
  await app.updateComplete;
  const el = app.shadowRoot!.querySelector("zone-edit-dialog") as ZoneEditor;
  const writes: unknown[][] = [];
  el.api = new VenueServiceApi(
    request ??
      ((async (path, method = "GET", body) => {
        if (method === "GET") return { tables: [] };
        writes.push([path, method, body]);
      }) as DashboardRequest),
  );
  el.model = structuredClone(zonesModel);
  el.zoneId = "z1";
  await el.updateComplete;
  const modal = el.shadowRoot?.querySelector("wt-modal");
  expect(modal, "the selected zone opens as a protected dialog").toBeTruthy();
  await modal!.updateComplete;
  await expect.poll(() => modal!.shadowRoot!.querySelector("dialog")!.matches(":modal")).toBe(true);
  return { el, app, modal: modal!, writes };
}
export async function editZoneName(el: ZoneEditor, value: string) {
  const field = el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-input"]>("[name=name]")!;
  await field.updateComplete;
  await userEvent.fill(page.elementLocator(field.shadowRoot!.querySelector("input")!), value);
  await el.updateComplete;
}
export function zoneSave(el: ZoneEditor) {
  return el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-button"]>(
    "[data-test=save-editor]",
  )!;
}
export async function zoneFields(el: ZoneEditor) {
  const fields = el.shadowRoot!.querySelector("dashboard-service-settings-fields")!;
  await fields.updateComplete;
  return fields;
}
