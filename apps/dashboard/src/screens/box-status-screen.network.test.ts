import { afterEach, expect, it, vi } from "vitest";
import { LiveData } from "@waitron/dashboard-kit";
import type { DashboardApi } from "../api/client.js";
import { setLocale } from "../i18n/t.js";
import { cleanupWidgets, mountWidget } from "../widgets/test-helpers.js";
import type { BoxStatusScreen } from "./box-status-screen.js";
import "./box-status-screen.js";

const observation = {
  wired: { connected: true, address: "192.0.2.8" },
  wifi: { connectedSsidHex: "436166c3a92057692d4669", savedSsidHex: "426172" },
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
afterEach(() => {
  cleanupWidgets();
  setLocale("en");
});

it("shows wired and ordinary UTF-8 Wi-Fi names despite a failed health read", async () => {
  setLocale("en");
  const el = await mount();
  await vi.waitFor(() => expect(card(el)?.textContent).toContain("192.0.2.8"));
  expect(card(el)!.textContent).toContain("Café Wi-Fi");
  expect(card(el)!.textContent).toContain("Bar");
  expect(card(el)!.querySelector("a")?.getAttribute("href")).toBe("/help/en/box-status#network");
});

it.each(["en", "es"])(
  "describes null observations without claiming a missing radio (%s)",
  async (locale) => {
    setLocale(locale);
    const el = await mount(
      api(
        vi
          .fn()
          .mockResolvedValue({
            ...observation,
            wired: { connected: true, address: null },
            wifi: { connectedSsidHex: null, savedSsidHex: null },
          }),
      ),
    );
    await vi.waitFor(() =>
      expect(card(el)?.textContent).toContain(
        locale === "en" ? "Address not reported" : "Dirección no indicada",
      ),
    );
    expect(card(el)!.textContent).toContain(locale === "en" ? "Not connected" : "Sin conexión");
    expect(card(el)!.textContent).toContain(locale === "en" ? "Not reported" : "No indicado");
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
  const el = await mount(api(read));
  await vi.waitFor(() => expect(read).toHaveBeenCalledOnce());
  await vi.waitFor(() => expect(card(el)).toBeNull());
});
