import { describe, expect, it, vi } from "vitest";
import { render } from "lit";
import { createRequest } from "@waitron/dashboard-kit";
import { VERIFACTU_DASHBOARD } from "./index.js";

describe("VERIFACTU_DASHBOARD", () => {
  it("the contribution puts one panel on Venue details for system.manage, readable with fiscal.view", () => {
    expect(VERIFACTU_DASHBOARD.module).toBe("fiscal-verifactu");
    expect(VERIFACTU_DASHBOARD.screen).toBeUndefined();
    expect(
      VERIFACTU_DASHBOARD.settingsPanels!.map(
        ({ id, tab, order, requiresPermission, readPermission }) => ({
          id,
          tab,
          order,
          requiresPermission,
          readPermission,
        }),
      ),
    ).toEqual([
      {
        id: "aeat-certificate",
        tab: "venue-details",
        order: 1,
        requiresPermission: "system.manage",
        readPermission: "fiscal.view",
      },
    ]);
  });

  it("the panel renders the certificate card, reading through the request it is given", async () => {
    const answer = { filing: true, revision: null, timeZone: "Europe/Madrid", installed: null };
    const fetchImpl = vi.fn(
      async () => ({ ok: true, status: 200, text: async () => JSON.stringify(answer) }) as Response,
    );
    const handle = VERIFACTU_DASHBOARD.settingsPanels![0]!.create({
      request: createRequest({ fetchImpl: fetchImpl as unknown as typeof fetch }),
    });
    const container = document.createElement("div");
    document.body.append(container);
    try {
      render(handle.render(), container);
      const card = container.querySelector("dashboard-aeat-certificate-card")!;
      await vi.waitFor(() =>
        expect(card.shadowRoot?.querySelector("[data-test=certificate-message]")).not.toBeNull(),
      );
      expect(fetchImpl).toHaveBeenCalledWith(
        "/management-api/fiscal-certificate",
        expect.objectContaining({ method: "GET" }),
      );
    } finally {
      container.remove();
    }
  });
});
