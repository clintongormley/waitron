import { LitElement, html } from "lit";
import { applyTokens, LeaveController } from "@waitron/ui";
import { type DashboardRequest } from "@waitron/dashboard-kit";
import { expect } from "vitest";
import { page, userEvent } from "vitest/browser";
import { VenueServiceApi } from "../dashboard/client.js";
import { zonesModel } from "./department-zones-fixture.js";
import "../dashboard/department-edit-dialog.js";

class DepartmentEditHost extends LitElement {
  readonly leave = new LeaveController(this);
  override render() {
    return html`<department-edit-dialog></department-edit-dialog
      >${this.leave.render({ heading: "Unsaved changes", message: "Discard changes?", keepLabel: "Keep editing", discardLabel: "Discard changes" })}`;
  }
}
customElements.define("a493-department-edit-host", DepartmentEditHost);
const hosts = new Set<DepartmentEditHost>();
export function cleanupDepartmentEditors() {
  for (const host of hosts) host.remove();
  hosts.clear();
}
export async function mountDepartmentEditor(
  request?: DashboardRequest,
  theme: "light" | "dark" = "light",
) {
  const app = document.createElement("a493-department-edit-host") as DepartmentEditHost;
  hosts.add(app);
  applyTokens(app);
  app.setAttribute("data-theme", theme);
  document.body.append(app);
  await app.updateComplete;
  const el = app.shadowRoot!.querySelector("department-edit-dialog")!;
  const writes: unknown[][] = [];
  el.api = new VenueServiceApi(
    request ??
      ((async (path, method = "GET", body) => {
        if (method === "GET")
          return path.endsWith("/profiles")
            ? []
            : { receivingProfileId: null, destinationDepartmentIds: [], profiles: [] };
        writes.push([path, method, body]);
      }) as DashboardRequest),
  );
  el.model = structuredClone(zonesModel);
  el.departmentId = "d1";
  await el.updateComplete;
  const form = departmentForm(el);
  await form.updateComplete;
  await expect.poll(() => form.shadowRoot!.querySelector("[name=receivingProfileId]")).toBeTruthy();
  const modal = el.shadowRoot!.querySelector("wt-modal")!;
  await modal.updateComplete;
  await expect.poll(() => modal.shadowRoot!.querySelector("dialog")!.matches(":modal")).toBe(true);
  return { el, app, form, modal, writes };
}
export function departmentForm(el: HTMLElementTagNameMap["department-edit-dialog"]) {
  return el.shadowRoot!.querySelector("department-settings")!;
}
export async function editDepartmentField(
  form: HTMLElementTagNameMap["department-settings"],
  name: string,
  value: string,
) {
  const field = form.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-input"]>(
    `[name=${name}]`,
  )!;
  await field.updateComplete;
  await userEvent.fill(page.elementLocator(field.shadowRoot!.querySelector("input")!), value);
  await form.updateComplete;
}
export function departmentSave(form: HTMLElementTagNameMap["department-settings"]) {
  return form.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-button"]>(
    "[data-test=save-editor]",
  )!;
}
export async function selectDepartmentTab(
  form: HTMLElementTagNameMap["department-settings"],
  tab: "details" | "service" | "transfers",
) {
  await form.updateComplete;
  const strip = form.shadowRoot!.querySelector("wt-tabs")!;
  await strip.updateComplete;
  await userEvent.click(
    page.elementLocator(strip.shadowRoot!.querySelector(`[role=tab][data-key=${tab}]`)!),
  );
  await form.updateComplete;
  await strip.updateComplete;
}
