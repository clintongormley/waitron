import type { WtDialog } from "@waitron/ui/src/components/wt-dialog.js";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { userEvent } from "vitest/browser";
import { LiveData } from "@waitron/dashboard-kit";
import type { BoxNetwork, DashboardApi } from "../api/client.js";
import { setLocale } from "../i18n/t.js";
import { es } from "../i18n/strings.js";
import { cleanupWidgets, mountWidget } from "../widgets/test-helpers.js";
import type { BoxStatusScreen } from "./box-status-screen.js";
import "./box-status-screen.js";

const observation: BoxNetwork = {
  wired: { connected: true, address: "192.0.2.8" },
  wifi: { connectedSsidHex: "4775657374e28099732057692d4669", savedSsidHex: "426172" },
  change: null,
  bootCopy: { state: "absent", reason: "cable-only", failure: null },
};

function api(getBoxNetwork = vi.fn().mockResolvedValue(observation)) {
  return {
    getBoxNetwork,
    getBoxHealth: vi.fn().mockRejectedValue({ code: "server.internal" }),
    listAlerts: vi.fn().mockResolvedValue({ visible: true, alerts: [] }),
    liveData: new LiveData(),
  } as unknown as DashboardApi;
}

async function mount(client = api()) {
  const { el } = await mountWidget<BoxStatusScreen>("dashboard-box-status-screen", { api: client });
  return el;
}
const card = (el: BoxStatusScreen) => el.shadowRoot!.querySelector("[data-test=box-network]");
beforeEach(() => {
  vi.spyOn(document, "URL", "get").mockReturnValue("https://box.example/box-status");
});
afterEach(() => {
  vi.restoreAllMocks();
  cleanupWidgets();
  setLocale("en");
});

it("shows wired and ordinary UTF-8 Wi-Fi names despite a failed health read", async () => {
  setLocale("en");
  const el = await mount();
  await vi.waitFor(() => expect(card(el)?.textContent).toContain("192.0.2.8"));
  expect(card(el)!.textContent).toContain("Guest’s Wi-Fi");
  expect(card(el)!.textContent).toContain("Bar");
  expect(card(el)!.querySelector("a")?.getAttribute("href")).toBe("/help/en/box-status#network");
});

it.each(["en", "es"])(
  "describes null observations without claiming a missing radio (%s)",
  async (locale) => {
    setLocale(locale);
    const el = await mount(
      api(
        vi.fn().mockResolvedValue({
          ...observation,
          wired: { connected: true, address: null },
          wifi: { connectedSsidHex: null, savedSsidHex: null },
        }),
      ),
    );
    await vi.waitFor(() =>
      expect(card(el)?.textContent).toContain(
        locale === "en" ? "Address not reported" : es["box_status.network.no_address"],
      ),
    );
    expect(card(el)!.textContent).toContain(
      locale === "en" ? "Not connected" : es["box_status.network.disconnected"],
    );
    expect(card(el)!.textContent).toContain(
      locale === "en" ? "Not reported" : es["box_status.network.not_reported"],
    );
  },
);

it("shows loading, hides stale observations on failure and recovers independently of health", async () => {
  let resolve!: (value: typeof observation) => void;
  const read = vi
    .fn()
    .mockImplementationOnce(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    )
    .mockResolvedValue(observation);
  const client = api(read);
  const el = await mount(client);
  expect(card(el)?.textContent).toContain("Reading network");
  resolve(observation);
  await vi.waitFor(() => expect(card(el)?.textContent).toContain("192.0.2.8"));
  read.mockRejectedValue({ code: "box_host.failed", params: { detail: "PRIVATE" } });
  client.liveData.refresh();
  await vi.waitFor(() => expect(card(el)?.textContent).toContain("Couldn't read the network"));
  expect(card(el)!.textContent).not.toContain("192.0.2.8");
  expect(card(el)!.textContent).not.toContain("PRIVATE");
  read.mockResolvedValue({ ...observation, wired: { connected: false, address: null } });
  client.liveData.refresh();
  await vi.waitFor(() => expect(card(el)?.textContent).toContain("Not connected"));
  expect(card(el)!.textContent).not.toContain("Couldn't read");
  expect(el.shadowRoot!.querySelector(".error")).not.toBeNull();
});

it("hides the card when the box cannot report its network", async () => {
  const read = vi
    .fn()
    .mockRejectedValue({ code: "box_host.unavailable", params: { reason: "unsupported" } });
  const client = api(read);
  const el = await mount(client);
  await vi.waitFor(() => expect(read).toHaveBeenCalledOnce());
  await vi.waitFor(() => expect(card(el)).toBeNull());
  client.liveData.refresh();
  await new Promise<void>(queueMicrotask);
  expect(read).toHaveBeenCalledOnce();
  const host = el.parentElement!;
  el.remove();
  read.mockResolvedValue(observation);
  host.append(el);
  await vi.waitFor(() => expect(card(el)?.textContent).toContain("192.0.2.8"));
});

async function join(el: BoxStatusScreen, client: DashboardApi) {
  Object.assign(client, {
    scanBoxNetwork: vi
      .fn()
      .mockResolvedValue({ networks: [{ ssidHex: "426172", signal: 80, security: "wpa-psk" }] }),
    joinBoxNetwork: vi.fn().mockResolvedValue({}),
  });
  await userEvent.click(el.shadowRoot!.querySelector<HTMLElement>("[data-test=wifi-scan]")!);
  const wifi = el.shadowRoot!.querySelector("dashboard-box-wifi-dialog")!;
  await expect.poll(() => wifi.shadowRoot!.querySelector("wt-combobox")?.options.length).toBe(1);
  const { chooseOption } = await import("@waitron/ui/src/test-helpers.js");
  await chooseOption(wifi.shadowRoot!.querySelector("wt-combobox")!, "426172:wpa-psk");
  const password = wifi.shadowRoot!.querySelector("wt-input")!;
  await userEvent.fill(password.shadowRoot!.querySelector("input")!, "join password");
  return { wifi, button: wifi.shadowRoot!.querySelector<HTMLElement>("[data-test=wifi-join]")! };
}
it("closes accepted Join before refresh, keeps acceptance across failed reads, then reports Last change on reopening", async () => {
  const read = vi.fn().mockResolvedValue(observation);
  const client = api(read);
  const el = await mount(client);
  await expect.poll(() => card(el)?.textContent).toContain("192.0.2.8");
  const { wifi, button } = await join(el, client);
  read.mockRejectedValueOnce({ code: "box_host.failed" });
  await userEvent.click(button);
  await expect.poll(() => wifi.shadowRoot!.querySelector("wt-dialog")?.open).toBe(false);
  await expect.poll(() => card(el)?.textContent).toContain("Couldn't read");
  expect(card(el)!.textContent).toContain("accepted");
  expect(card(el)!.querySelector("[data-test=wifi-scan]")).toBeNull();
  read.mockResolvedValue({
    ...observation,
    change: { kind: "join", ssidHex: "426172", state: "applied", reason: null },
    bootCopy: { state: "pending", reason: null, failure: null },
  });
  client.liveData.refresh();
  await expect.poll(() => card(el)?.textContent).toContain("Last change");
  expect(card(el)!.textContent).not.toContain("accepted");
  expect(card(el)!.textContent).toContain("waiting");
  const host = el.parentElement!;
  el.remove();
  host.append(el);
  await expect.poll(() => card(el)?.textContent).toContain("Last change");
  expect(card(el)!.textContent).toContain("Bar");
});
it("does not retire acceptance on a read that began before Join was accepted", async () => {
  const read = vi.fn().mockResolvedValue(observation);
  const client = api(read);
  const el = await mount(client);
  await expect.poll(() => card(el)?.textContent).toContain("192.0.2.8");
  const { button } = await join(el, client);
  let oldDone!: (n: typeof observation) => void;
  let newDone!: (n: typeof observation) => void;
  read
    .mockImplementationOnce(
      () =>
        new Promise((done) => {
          oldDone = done;
        }),
    )
    .mockImplementationOnce(
      () =>
        new Promise((done) => {
          newDone = done;
        }),
    );
  client.liveData.refresh();
  await expect.poll(() => typeof oldDone).toBe("function");
  await userEvent.click(button);
  await expect.poll(() => card(el)?.textContent).toContain("accepted");
  oldDone(observation);
  await expect.poll(() => typeof newDone).toBe("function");
  expect(card(el)!.textContent).toContain("accepted");
  newDone({
    ...observation,
    change: { kind: "join", ssidHex: "426172", state: "running", reason: null },
  });
  await expect.poll(() => card(el)?.textContent).not.toContain("accepted");
  expect(card(el)!.querySelector("[data-test=wifi-scan]")?.hasAttribute("disabled")).toBe(true);
});

it.each(["connection.failed", "box_network.busy"])(
  "refreshes Last change after %s without resending",
  async (code) => {
    const read = vi.fn().mockResolvedValue(observation);
    const client = api(read);
    const el = await mount(client);
    await expect.poll(() => card(el)?.textContent).toContain("192.0.2.8");
    const { button } = await join(el, client);
    vi.mocked(client.joinBoxNetwork).mockRejectedValue({ code });
    read.mockResolvedValue({
      ...observation,
      change: { kind: "join", ssidHex: "426172", state: "running", reason: null },
    });
    await userEvent.click(button);
    await expect.poll(() => read.mock.calls.length).toBe(2);
    await expect.poll(() => card(el)?.textContent).toContain("in progress");
    expect(client.joinBoxNetwork).toHaveBeenCalledOnce();
  },
);

async function forgetQuestion(el: BoxStatusScreen) {
  await expect.poll(() => card(el)?.querySelector("[data-test=wifi-forget]")).toBeTruthy();
  await userEvent.click(card(el)!.querySelector<HTMLElement>("[data-test=wifi-forget]")!);
  const dialog = el.shadowRoot!.querySelector<WtDialog>("wt-dialog[data-test=wifi-forget-dialog]")!;
  await expect.poll(() => dialog.open).toBe(true);
  return dialog;
}

it("names the saved network before Forget, explains unwired recovery, and Stop sends nothing", async () => {
  const client = Object.assign(
    api(
      vi.fn().mockResolvedValue({
        ...observation,
        wired: { connected: false, address: null },
      }),
    ),
    { forgetBoxNetwork: vi.fn().mockResolvedValue({}) },
  );
  const el = await mount(client);
  const dialog = await forgetQuestion(el);
  expect(dialog.heading).toContain("Bar");
  expect(dialog.textContent).toContain("local screen");
  expect(dialog.textContent).toContain("disconnect");
  const { dialogClosed } = await import("../widgets/test-helpers.js");
  const closed = dialogClosed(dialog);
  await userEvent.click(dialog.querySelector<HTMLElement>("[data-test=wifi-forget-stop]")!);
  await closed;
  expect(client.forgetBoxNetwork).not.toHaveBeenCalled();
});

it("forgets the named saved network, closes before reading the outcome and retains acceptance on read failure", async () => {
  const read = vi.fn().mockResolvedValue(observation);
  let accepted!: () => void;
  const client = Object.assign(api(read), {
    forgetBoxNetwork: vi.fn(
      () =>
        new Promise<void>((done) => {
          accepted = done;
        }),
    ),
  });
  const el = await mount(client);
  const dialog = await forgetQuestion(el);
  expect(dialog.textContent).not.toContain("local screen");
  const opensAtRefresh: boolean[] = [];
  read.mockImplementation(() => {
    opensAtRefresh.push(dialog.open);
    return Promise.reject({ code: "box_host.failed" });
  });
  await userEvent.click(dialog.querySelector<HTMLElement>("[data-test=wifi-forget-confirm]")!);
  expect(client.forgetBoxNetwork).toHaveBeenCalledExactlyOnceWith({ ssidHex: "426172" });
  expect(dialog.querySelector("[data-test=wifi-forget-stop]")?.hasAttribute("disabled")).toBe(true);
  expect(card(el)!.querySelector("[data-test=wifi-scan]")?.hasAttribute("disabled")).toBe(true);
  const { dialogClosed } = await import("../widgets/test-helpers.js");
  const closed = dialogClosed(dialog);
  accepted();
  await closed;
  await expect.poll(() => card(el)?.textContent).toContain("Couldn't read");
  expect(card(el)!.textContent).toContain("accepted");
  expect(opensAtRefresh.length).toBeGreaterThan(0);
  expect(opensAtRefresh).not.toContain(true);
  read.mockResolvedValue({
    ...observation,
    wifi: { connectedSsidHex: null, savedSsidHex: null },
    change: { kind: "forget", ssidHex: "426172", state: "applied", reason: null },
    bootCopy: { state: "absent", reason: "cable-only", failure: null },
  });
  client.liveData.refresh();
  await expect.poll(() => card(el)?.textContent).toContain("Last change");
  expect(card(el)!.textContent).not.toContain("accepted");
  expect(card(el)!.querySelector("[data-test=wifi-forget]")).toBeNull();
});

it("shows a lost Forget answer as unknown, refreshes Last change and never resends", async () => {
  const read = vi.fn().mockResolvedValue(observation);
  const client = Object.assign(api(read), {
    forgetBoxNetwork: vi.fn().mockRejectedValue({ code: "connection.failed" }),
  });
  const el = await mount(client);
  const dialog = await forgetQuestion(el);
  read.mockResolvedValue({
    ...observation,
    change: { kind: "forget", ssidHex: "426172", state: "running", reason: null },
  });
  await userEvent.click(dialog.querySelector<HTMLElement>("[data-test=wifi-forget-confirm]")!);
  await expect.poll(() => dialog.querySelector("wt-form-actions")?.error).toContain("unknown");
  await expect.poll(() => card(el)?.textContent).toContain("in progress");
  expect(client.forgetBoxNetwork).toHaveBeenCalledOnce();
  expect(dialog.querySelector("[data-test=wifi-forget-confirm]")?.hasAttribute("disabled")).toBe(
    true,
  );
});

it("keeps a Forget refusal through a recovered read and lets the person retry", async () => {
  const read = vi.fn().mockResolvedValue(observation);
  const client = Object.assign(api(read), {
    forgetBoxNetwork: vi.fn().mockRejectedValue({ code: "box_host.busy" }),
  });
  const el = await mount(client);
  const dialog = await forgetQuestion(el);
  const confirm = dialog.querySelector<HTMLElement>("[data-test=wifi-forget-confirm]")!;
  await userEvent.click(confirm);
  await expect.poll(() => read.mock.calls.length).toBe(2);
  await expect.poll(() => dialog.querySelector("wt-form-actions")?.error).toContain("busy");
  expect(confirm.hasAttribute("disabled")).toBe(false);
  client.forgetBoxNetwork.mockResolvedValue({});
  await userEvent.click(confirm);
  await expect.poll(() => dialog.open).toBe(false);
  expect(client.forgetBoxNetwork).toHaveBeenCalledTimes(2);
});

it("explains a definite not-saved refusal instead of calling the outcome unknown", async () => {
  const client = Object.assign(api(), {
    forgetBoxNetwork: vi.fn().mockRejectedValue({ code: "box_network.not_saved" }),
  });
  const el = await mount(client);
  const dialog = await forgetQuestion(el);
  await userEvent.click(dialog.querySelector<HTMLElement>("[data-test=wifi-forget-confirm]")!);
  await expect
    .poll(() => dialog.querySelector("wt-form-actions")?.error)
    .toContain("no longer has this network saved");
  expect(dialog.querySelector("wt-form-actions")?.error).not.toContain("unknown");
});
