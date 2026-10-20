import axe from "axe-core";
import { afterEach, expect, it } from "vitest";
import { applyTokens } from "@waitron/ui";
import "./first-fiscal-screen.js";
const hosts: HTMLElement[] = [];
afterEach(() => {
  hosts.splice(0).forEach((host) => host.remove());
  document.body.style.background = "";
  document.documentElement.style.background = "";
});
for (const theme of ["light", "dark"] as const)
  for (const locale of ["en", "es"] as const)
    for (const stage of ["choice", "proposal", "import", "comparison", "confirmed"] as const) {
      it(`${locale} ${theme} ${stage} has accessible fields and actions`, async () => {
        const host = document.createElement("main");
        document.body.append(host);
        hosts.push(host);
        applyTokens(host);
        host.dataset.theme = theme;
        host.style.background = "var(--wt-color-surface-raised)";
        const bg = getComputedStyle(host).backgroundColor;
        document.body.style.background = bg;
        document.documentElement.style.background = bg;
        const el = document.createElement("vf-first-fiscal-screen");
        el.locale = locale;
        el.context = {
          status: "claimed",
          environment: "production",
          venue: {
            taxId: "B12345674",
            seriesCode: "A",
            fullSeriesCode: "FF",
            rectificativeSeriesCode: "R",
          },
        };
        const request = {
          binding: {
            module: "fiscal-verifactu",
            action: "setup",
            eventId: "event",
            sourceId: "source",
            targetNodeId: "node",
          },
          operatorId: "admin",
          recipientVenueId: "recipient",
          requiredBases: [{ code: "A", purpose: "standard" }],
        };
        if (stage !== "choice")
          Object.assign(el, {
            draft: {
              route: "new",
              serials: "1, 2",
              fingerprint: "",
              incident: "",
              consulted: false,
              consumed: false,
            },
          });
        if (["import", "comparison", "confirmed"].includes(stage)) Object.assign(el, { request });
        if (["comparison", "confirmed"].includes(stage))
          Object.assign(el, {
            imported: {
              allocation: {
                allocationId: "allocation",
                installationIdentity: "S000001",
                series: [{ code: "A-S000001", purpose: "standard" }],
                reservationEvidence: {
                  block: { payload: { generationId: "generation", blockId: "block" } },
                },
              },
              approval: { incidentEvidence: "ORIGINAL / 1" },
            },
          });
        if (stage === "confirmed") Object.assign(el, { confirmed: true });
        host.append(el);
        await el.updateComplete;
        const result = await axe.run(host);
        expect(
          result.violations.map((entry) => ({
            id: entry.id,
            nodes: entry.nodes.map((node) => node.target),
          })),
        ).toEqual([]);
      });
    }
