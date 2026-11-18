import { LiveData } from "@waitron/dashboard-kit";
import type { DeleteImpact } from "@waitron/shared";
import { LitElement, html } from "lit";
import { afterEach, expect, it, vi } from "vitest";
import type { DashboardApi } from "../api/client.js";
import { codeMessage } from "../i18n/codes.js";
import { HardwareDeleteDialog } from "./hardware-delete-dialog.js";
import { deviceDeleteCopy } from "./device-delete-copy.js";
import { cleanupWidgets, mountWidget } from "./test-helpers.js";

const copy = deviceDeleteCopy();
const impact = (id: string): DeleteImpact => ({
  target: { id, name: id === "first" ? "Front till" : "Terrace till" },
  refusals: [],
  ends: [],
  removes: [],
});
const coded = (code: string) => Object.assign(new Error(code), { code });

function gate() {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => (release = resolve));
  return { promise, release };
}

const tag = "test-hardware-delete-dialog";

async function mount() {
  const liveData = new LiveData();
  const read = vi.fn(async (id: string) => impact(id));
  const send = vi.fn(async (_id: string, _impact: DeleteImpact | null) => {});
  const beforeDeleted = vi.fn((_id: string): Promise<void> | undefined => undefined);

  class Harness extends LitElement {
    readonly hardware = new HardwareDeleteDialog(this, () => api, {
      send,
      notFound: ["device.not_found"],
      onGone: () => this.hardware.close(),
      beforeDeleted,
      onDeleted: () => this.hardware.close(),
    });

    protected override render() {
      return html`<button>Open</button>${this.hardware.render("hardware-delete", copy)}`;
    }
  }
  const api = { getDeviceDeleteImpact: read, liveData } as unknown as DashboardApi;
  const harnessTag = `${tag}-${nextHarness++}`;
  customElements.define(harnessTag, Harness);
  const { el } = await mountWidget<Harness>(harnessTag, {});
  const dialog = el.shadowRoot!.querySelector("wt-delete-dialog")!;
  const button = (action: string) =>
    dialog.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-button"]>(
      `[data-test=delete-${action}]`,
    )!;
  const open = async (id: string) => {
    el.hardware.open(id, el.shadowRoot!.querySelector("button"), "getDeviceDeleteImpact");
    await expect
      .poll(() => dialog.shadowRoot!.querySelector("[data-target]")?.textContent)
      .toBe(impact(id).target.name);
  };
  const message = () => dialog.shadowRoot!.querySelector("wt-form-actions")?.error;
  return { el, dialog, open, button, liveData, read, send, beforeDeleted, message };
}
let nextHarness = 0;

afterEach(cleanupWidgets);

it("keeps the send refusal through a failed live read and a successful Retry", async () => {
  const { open, button, liveData, read, send, message } = await mount();
  await open("first");
  send.mockRejectedValueOnce(coded("device.payment_in_progress"));
  button("confirm").click();
  const refusal = codeMessage("device.payment_in_progress");
  await expect.poll(message).toBe(refusal);

  const readCode = "server.internal";
  read.mockRejectedValueOnce(coded(readCode));
  liveData.invalidate([{ type: "devices", id: "first" }]);
  await expect.poll(message).toBe(`${codeMessage(readCode)} ${refusal}`);

  button("retry").click();
  await expect.poll(message).toBe(refusal);
  expect(button("confirm").disabled).toBe(false);
});

it("does not start the earlier send’s success step after the target changes", async () => {
  const { el, dialog, open, button, send, beforeDeleted } = await mount();
  const answer = gate();
  send.mockReturnValueOnce(answer.promise);
  await open("first");
  button("confirm").click();
  await expect.poll(() => dialog.submitting).toBe(true);

  el.hardware.close();
  await open("second");
  answer.release();
  await answer.promise;
  await el.updateComplete;
  expect(beforeDeleted).not.toHaveBeenCalled();
  expect(dialog.open).toBe(true);
  expect(button("confirm").disabled).toBe(false);
});

it("does not close a reopened target when the earlier success redraw finishes", async () => {
  const { el, dialog, open, button, beforeDeleted } = await mount();
  const redraw = gate();
  beforeDeleted.mockReturnValueOnce(redraw.promise);
  await open("first");
  button("confirm").click();
  await expect.poll(() => beforeDeleted.mock.calls).toEqual([["first"]]);

  el.hardware.close();
  await open("first");
  redraw.release();
  await redraw.promise;
  await el.updateComplete;
  expect(dialog.open).toBe(true);
  expect(button("confirm").disabled).toBe(false);
});
