import axe from "axe-core";
import { expect } from "vitest";
import { applyTokens } from "@waitron/ui";

export type Theme = "light" | "dark";

const mounted: HTMLElement[] = [];

export interface Mounted<T extends HTMLElement> {
  el: T;
  host: HTMLElement;
}

/**
 * Assigns `props` before connecting, because the wizard screens take object properties that cannot
 * travel through markup. The host is painted `--wt-color-surface-raised`, the background of the page
 * column the screens render inside (`setup-app.ts`), so a contrast check sees the app's colours.
 */
export async function mountWidget<T extends HTMLElement>(
  tag: string,
  props: Partial<T>,
  theme?: Theme,
): Promise<Mounted<T>> {
  const host = document.createElement("div");
  document.body.appendChild(host);
  applyTokens(host);
  if (theme) host.setAttribute("data-theme", theme);
  host.style.background = "var(--wt-color-surface-raised)";
  mounted.push(host);

  const el = document.createElement(tag) as T;
  Object.assign(el, props);
  host.appendChild(el);
  await (el as T & { updateComplete: Promise<unknown> }).updateComplete;
  return { el, host };
}

/** Removes every host mounted since the last cleanup. Use as `afterEach(cleanupWidgets)`. */
export function cleanupWidgets(): void {
  for (const host of mounted.splice(0)) host.remove();
}

export function formatViolations(violations: axe.Result[]): string {
  return violations
    .map((violation) => {
      const targets = violation.nodes.map((node) => node.target.join(" ")).join(", ");
      return `${violation.id} [${violation.impact}]: ${violation.help}\n  targets: ${targets}`;
    })
    .join("\n\n");
}

// The reasons in axe's colour-contrast messages (`locales/_template.json`) counted as being about
// the colours themselves. axe 4.14.0 never sets `fgAlpha`.
const UNDECIDED_COLOUR_READINGS = new Set(["equalRatio", "fgAlpha", "colorParse"]);

function undecidedColourReadings(incomplete: axe.Result[]): string[] {
  return incomplete
    .filter((result) => result.id === "color-contrast")
    .flatMap((result) =>
      result.nodes.flatMap((node) =>
        node.any
          .filter((check) =>
            UNDECIDED_COLOUR_READINGS.has(
              (check.data as { messageKey?: string } | null)?.messageKey ?? "",
            ),
          )
          .map(
            (check) =>
              `${result.id} [undecided]: ${check.message}\n  targets: ${node.target.join(" ")}`,
          ),
      ),
    );
}

/**
 * Runs the full default axe ruleset against `context` and fails the test on any violation, or on a
 * colour-contrast check axe left undecided for a reason about the colours themselves (`equalRatio`,
 * `fgAlpha`, `colorParse`).
 */
export async function expectNoA11yViolations(context: Element): Promise<void> {
  const results = await axe.run(context);
  expect(results.violations, formatViolations(results.violations)).toEqual([]);
  const colourReadings = undecidedColourReadings(results.incomplete);
  expect(colourReadings, colourReadings.join("\n\n")).toEqual([]);
}

/** What Review backup answers in `reviewBackup`, and the recovery details it then enters. */
export const REVIEWED_PREVIEW = {
  sourceId: "reviewed-copy",
  createdAt: "2026-10-01T08:00:00.000Z",
  environment: "production",
  nodeId: "00000000-0000-4000-8000-000000000001",
  nodeRecoveryKeyName: "Amber Hill",
  taxpayer: { legalName: "Saved venue", taxId: "89890001K" },
  venueName: "Saved venue",
} as const;
export const REVIEWED_CREDENTIALS = {
  recoveryOperation: {
    binding: {
      module: "fiscal-verifactu",
      action: "restore",
      eventId: "reviewed-event",
      sourceId: REVIEWED_PREVIEW.sourceId,
      targetNodeId: REVIEWED_PREVIEW.nodeId,
    },
    input: { allocation: { receipt: "public-signed-reservation" } },
  },
  nodeRecoverySecret: "reviewed-node-key",
};

type Updating = HTMLElement & { updateComplete: Promise<unknown> };

/**
 * Presses the restore screen's Review backup, then enters the recovery details it asks for, so a
 * later Restore sends `REVIEWED_CREDENTIALS`. The screen's own fields must already let Review run.
 * Review is answered with `preview` by replacing the preview reads on the screen's `api`; its other
 * requests are left alone. The record entered names `preview`'s copy and node.
 */
export async function reviewBackup(
  screen: HTMLElement,
  preview: { sourceId: string; nodeId: string } = REVIEWED_PREVIEW,
): Promise<void> {
  const copy = () => screen.shadowRoot!.querySelector<Updating>("setup-recovery-copy")!;
  const answer = async () => structuredClone(preview);
  Object.assign((copy() as Updating & { api: object }).api, {
    previewRestore: answer,
    previewBucketRestore: answer,
    previewCloudRestore: answer,
  });
  await copy().updateComplete;
  const answered = new Promise<void>((resolve) => {
    const seen = (event: Event) => {
      if (!(event as CustomEvent<{ preview?: unknown }>).detail.preview) return;
      copy().removeEventListener("recovery-preview", seen);
      resolve();
    };
    copy().addEventListener("recovery-preview", seen);
  });
  copy().shadowRoot!.querySelector<HTMLElement>("[data-test=preview]")!.click();
  await answered;
  await copy().updateComplete;
  const entry = copy().shadowRoot!.querySelector<Updating>("setup-recovery-allocation")!;
  await entry.updateComplete;
  const { binding, input } = REVIEWED_CREDENTIALS.recoveryOperation;
  await enterRecoveryDetails(entry, {
    binding: { ...binding, sourceId: preview.sourceId, targetNodeId: preview.nodeId },
    input,
  });
  await (screen as Updating).updateComplete;
}

/**
 * Enters `record` and `nodeKey` on a `setup-recovery-allocation` and ticks both of its
 * confirmations.
 */
export async function enterRecoveryDetails(
  entry: HTMLElement,
  record: object = REVIEWED_CREDENTIALS.recoveryOperation,
  nodeKey: string = REVIEWED_CREDENTIALS.nodeRecoverySecret,
): Promise<void> {
  const change = (field: string, value: string) =>
    entry
      .shadowRoot!.querySelector(`[data-test=${field}]`)!
      .dispatchEvent(new CustomEvent("wt-change", { detail: { value } }));
  const tick = (field: string) => {
    const input = entry.shadowRoot!.querySelector<HTMLInputElement>(`[data-test=${field}]`)!;
    input.checked = true;
    input.dispatchEvent(new Event("change"));
  };
  change("record", JSON.stringify(record));
  change("node-key", nodeKey);
  tick("isolated");
  tick("retained");
  await (entry as Updating).updateComplete;
}
