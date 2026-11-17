import { LiveData } from "@waitron/dashboard-kit";
import { afterEach, expect, it, vi } from "vitest";
import { userEvent } from "vitest/browser";
import type { WtCombobox, WtDialog, WtInput } from "@waitron/ui";
import { chooseOption } from "@waitron/ui/src/test-helpers.js";
import type { DashboardApi } from "../api/client.js";
import { cleanupWidgets, dialogClosed, mountWidget } from "../widgets/test-helpers.js";
import { setLocale } from "../i18n/t.js";
import { BoxWifiDialog } from "./box-wifi-dialog.js";

const networks = [
  { ssidHex: "426172", signal: 82, security: "wpa-psk" },
  { ssidHex: "43616665", signal: 64, security: "sae" },
  { ssidHex: "4775657374", signal: 42, security: "other" },
];
afterEach(() => {
  cleanupWidgets();
  setLocale("en");
  vi.restoreAllMocks();
});
async function mount() {
  setLocale("en");
  vi.spyOn(document, "URL", "get").mockReturnValue("https://box.example/box-status");
  const scanBoxNetwork = vi.fn().mockResolvedValue({ networks });
  const joinBoxNetwork = vi.fn().mockResolvedValue({});
  const { el } = await mountWidget<BoxWifiDialog>("dashboard-box-wifi-dialog", {
    api: { scanBoxNetwork, joinBoxNetwork, liveData: new LiveData() } as unknown as DashboardApi,
  });
  el.show(false);
  await expect.poll(() => el.shadowRoot?.querySelector("wt-combobox")).toBeTruthy();
  const dialog = el.shadowRoot!.querySelector<WtDialog>("wt-dialog")!;
  const choice = dialog.querySelector<WtCombobox>("wt-combobox")!;
  const password = dialog.querySelector<WtInput>("wt-input")!;
  const join = dialog.querySelector<HTMLElement>("[data-test=wifi-join]")!;
  return { el, dialog, choice, password, join, scanBoxNetwork, joinBoxNetwork };
}
async function type(password: WtInput, value: string) {
  password.dispatchEvent(
    new CustomEvent("wt-change", { detail: { value }, bubbles: true, composed: true }),
  );
  await password.updateComplete;
}

it("scans, keeps unsupported networks visible but disabled, and joins with unchanged bytes", async () => {
  const { el, dialog, choice, password, join, scanBoxNetwork, joinBoxNetwork } = await mount();
  expect(scanBoxNetwork).toHaveBeenCalledOnce();
  expect(choice.options.map((o) => [o.label, !!o.disabled])).toEqual([
    ["Bar · 82%", false],
    ["Cafe · 64%", false],
    ["Guest · 42% · Unsupported security", true],
  ]);
  expect(dialog.textContent).toContain("local screen");
  await chooseOption(choice, "43616665:sae");
  await type(password, " secret  ");
  const accepted = vi.fn();
  el.addEventListener("wifi-accepted", accepted);
  await userEvent.click(join);
  await expect.poll(() => accepted.mock.calls.length).toBe(1);
  expect(joinBoxNetwork).toHaveBeenCalledExactlyOnceWith({
    ssidHex: "43616665",
    keyMgmt: "sae",
    psk: " secret  ",
    hidden: false,
  });
  await expect.poll(() => dialog.open).toBe(false);
  expect(el.shadowRoot!.querySelector("wt-input")).toBeNull();
  expect(password.value).toBe("");
});

it("marks the carried password refusal, clears it on edit and permits a retry", async () => {
  const { el, dialog, choice, password, join, joinBoxNetwork } = await mount();
  await chooseOption(choice, "426172:wpa-psk");
  joinBoxNetwork.mockRejectedValueOnce({
    code: "box_network.password_invalid",
    params: { field: "psk", keyMgmt: "wpa-psk" },
  });
  await userEvent.click(join);
  await expect.poll(() => password.error).toContain("password");
  await expect
    .poll(() => password.shadowRoot!.activeElement)
    .toBe(password.shadowRoot!.querySelector("input"));
  expect(joinBoxNetwork).not.toHaveBeenCalled();
  await type(password, "short");
  await userEvent.click(join);
  await expect.poll(() => password.error).toContain("password");
  expect(password.error).toContain("8–63");
  expect(dialog.open).toBe(true);
  await type(password, "corrected");
  await el.updateComplete;
  expect(password.error).toBe("");
  await userEvent.click(join);
  await expect.poll(() => dialog.open).toBe(false);
  expect(joinBoxNetwork).toHaveBeenCalledTimes(2);
});

it("shows a scan refusal and an empty scan, and scans again only on request", async () => {
  const { el, dialog, scanBoxNetwork } = await mount();
  const again = dialog.querySelector<HTMLElement>("[data-test=wifi-scan-again]")!;
  scanBoxNetwork.mockRejectedValueOnce({ code: "box_network.no_wifi" });
  await userEvent.click(again);
  await expect
    .poll(() => dialog.querySelector("wt-form-actions")?.error)
    .toContain("No Wi-Fi adapter");
  scanBoxNetwork.mockResolvedValueOnce({ networks: [] });
  await userEvent.click(again);
  await expect.poll(() => dialog.textContent).toContain("No networks found");
  expect(scanBoxNetwork).toHaveBeenCalledTimes(3);
  el.remove();
});

it.each([{ code: "connection.failed" }, { code: "server.internal" }, new Error("lost")])(
  "keeps an uncertain Join outcome unknown without resending (%s)",
  async (error) => {
    const { dialog, choice, password, join, joinBoxNetwork } = await mount();
    await chooseOption(choice, "426172:wpa-psk");
    await type(password, "secret password");
    joinBoxNetwork.mockRejectedValue(error);
    await userEvent.click(join);
    await expect.poll(() => dialog.querySelector("wt-form-actions")?.error).toContain("unknown");
    expect(dialog.open).toBe(true);
    expect(joinBoxNetwork).toHaveBeenCalledOnce();
  },
);

it("never collects or sends a password from HTTP, even on localhost", async () => {
  const joinBoxNetwork = vi.fn();
  const { el } = await mountWidget<BoxWifiDialog>("dashboard-box-wifi-dialog", {
    api: { joinBoxNetwork } as unknown as DashboardApi,
  });
  expect(new URL(document.URL).protocol).toBe("http:");
  el.show(false);
  await el.updateComplete;
  expect(el.shadowRoot!.querySelector("wt-input[type=password]")).toBeNull();
  expect(el.shadowRoot!.querySelector("wt-form-actions")?.error).toContain("HTTPS");
  expect(joinBoxNetwork).not.toHaveBeenCalled();
});
it("shows a failed first scan without claiming an empty successful scan", async () => {
  vi.spyOn(document, "URL", "get").mockReturnValue("https://box.example/box-status");
  const { el } = await mountWidget<BoxWifiDialog>("dashboard-box-wifi-dialog", {
    api: {
      scanBoxNetwork: vi.fn().mockRejectedValue({ code: "box_network.no_wifi" }),
    } as unknown as DashboardApi,
  });
  el.show(false);
  await expect
    .poll(() => el.shadowRoot!.querySelector("wt-form-actions")?.error)
    .toContain("No Wi-Fi adapter");
  expect(el.shadowRoot!.textContent).not.toContain("No networks found");
});

it("explains the SAE password format at the password field", async () => {
  const { choice, password, join, joinBoxNetwork } = await mount();
  await chooseOption(choice, "43616665:sae");
  await type(password, "not accepted");
  joinBoxNetwork.mockRejectedValue({
    code: "box_network.password_invalid",
    params: { field: "psk", keyMgmt: "sae" },
  });
  await userEvent.click(join);
  await expect.poll(() => password.error).toContain("256 UTF-8 bytes");
});
it("holds an open dialog while another change runs, then accepts Enter once", async () => {
  const { el, dialog, choice, password, join, scanBoxNetwork, joinBoxNetwork } = await mount();
  await chooseOption(choice, "426172:wpa-psk");
  await type(password, "secret password");
  el.blocked = true;
  await el.updateComplete;
  expect(join.hasAttribute("disabled")).toBe(true);
  const again = dialog.querySelector<HTMLElement>("[data-test=wifi-scan-again]")!;
  expect(again.hasAttribute("disabled")).toBe(true);
  await userEvent.click(join);
  await userEvent.click(again);
  expect(joinBoxNetwork).not.toHaveBeenCalled();
  expect(scanBoxNetwork).toHaveBeenCalledOnce();
  el.blocked = false;
  await el.updateComplete;
  password.focus();
  await userEvent.keyboard("{Enter}");
  await expect.poll(() => dialog.open).toBe(false);
  expect(joinBoxNetwork).toHaveBeenCalledOnce();
});
it("Cancel clears a staged password without sending Join", async () => {
  const { dialog, password, joinBoxNetwork } = await mount();
  await type(password, "secret");
  const closed = dialogClosed(dialog);
  await userEvent.click(dialog.querySelector<HTMLElement>("[slot=cancel]")!);
  await closed;
  expect(dialog.open).toBe(false);
  expect(password.value).toBe("");
  expect(joinBoxNetwork).not.toHaveBeenCalled();
});
