import { describe, expect, it, vi } from "vitest";
import type { ReactiveController } from "lit";
import { LiveData } from "@waitron/dashboard-kit";
import type { DashboardApi } from "./client.js";
import { DashboardQueries } from "./query-controller.js";

function host() {
  const controllers: ReactiveController[] = [];
  return {
    addController: (controller: ReactiveController) => controllers.push(controller),
    removeController() {},
    requestUpdate() {},
    updateComplete: Promise.resolve(true),
    disconnect: () => controllers.forEach((controller) => controller.hostDisconnected?.()),
  };
}

const theme = { hash: "h1", css: ":root{}", logo: null };

function sharedApi(): DashboardApi {
  return {
    liveData: new LiveData(),
    getVenueTheme: async () => theme,
  } as unknown as DashboardApi;
}

const wrap = async <T>(read: () => Promise<T>) => ({ answer: await read(), sentAt: 7 });

describe("DashboardQueries", () => {
  for (const order of ["watch first", "watchSent first"] as const) {
    it(`gives a plain and a sent watch of one query each its own shape on a shared cache (${order})`, async () => {
      const api = sharedApi();
      const plainHost = host();
      const sentHost = host();
      const plain = new DashboardQueries(plainHost, () => api, vi.fn());
      const sent = new DashboardQueries(sentHost, () => api, vi.fn());
      const plainApply = vi.fn();
      const sentApply = vi.fn();
      const watchPlain = () => plain.watch("getVenueTheme", [], plainApply);
      const watchSent = () => sent.watchSent("getVenueTheme", [], wrap, sentApply);
      if (order === "watch first") {
        await watchPlain();
        await watchSent();
      } else {
        await watchSent();
        await watchPlain();
      }
      expect(plainApply).toHaveBeenLastCalledWith(theme);
      expect(sentApply).toHaveBeenLastCalledWith({ answer: theme, sentAt: 7 });
      plainHost.disconnect();
      sentHost.disconnect();
    });
  }
});
