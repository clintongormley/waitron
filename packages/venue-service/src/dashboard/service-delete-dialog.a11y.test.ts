import { describe, expect, it, vi } from "vitest";
import { expectNoA11yViolations } from "@waitron/ui/src/a11y-helpers.js";
import { allowedImpact, mountDelete, openDelete } from "../../test/service-delete-test-helpers.js";

describe.each(["light", "dark"])("service deletion accessibility %s", (theme) => {
  it.each(["department", "zone"] as const)("%s confirmation states", async (kind) => {
    for (const state of [
      "loading",
      "read-error",
      "allowed",
      "blocked",
      "submitting",
      "action-error",
    ]) {
      const impact = {
        ...allowedImpact,
        target: kind === "department" ? allowedImpact.target : { id: "z1", name: "Patio" },
        removes: [
          {
            key: "tables",
            count: 3,
            targets: [{ id: "t", name: "Long table name without a today row" }],
          },
          { key: "counter_default", count: 1, targets: [] },
        ],
        refusals:
          state === "blocked"
            ? [
                {
                  code: "zone.profile_in_use",
                  params: {},
                  targets: [{ id: "private-profile", name: "Long dining room profile name" }],
                },
              ]
            : [],
      };
      const read =
        state === "loading"
          ? vi.fn(() => new Promise(() => {}))
          : state === "read-error"
            ? vi.fn().mockRejectedValue({ code: "connection.failed" })
            : vi.fn().mockResolvedValue(impact);
      const write =
        state === "submitting"
          ? vi.fn(() => new Promise(() => {}))
          : vi.fn().mockRejectedValue({ code: "connection.failed" });
      const { screen, host } = await mountDelete(
        {
          getDepartmentDeleteImpact: read,
          getZoneDeleteImpact: read,
          deleteDepartment: write,
          deleteZone: write,
        },
        theme,
        kind,
      );
      const dialog = await openDelete(screen, kind);
      if (state !== "loading") await expect.poll(() => dialog.loading).toBe(false);
      if (state === "submitting" || state === "action-error") {
        dialog.shadowRoot!.querySelector<HTMLElement>('[data-test="delete-confirm"]')!.click();
        await expect
          .poll(() => (state === "submitting" ? dialog.submitting : Boolean(dialog.actionError)))
          .toBe(true);
      }
      await expectNoA11yViolations(host);
      host.remove();
    }
  });
});
