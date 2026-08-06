import { afterEach, describe, it } from "vitest";
import { cleanupWidgets, expectNoA11yViolations, mountWidget } from "./test-helpers.js";
import "./prep-queue.js";
import type { TillPrepQueue } from "./prep-queue.js";
import type { PrepQueueEntry } from "../api/client.js";

const entries: PrepQueueEntry[] = [
  {
    id: "wo-1",
    orderNumber: 5,
    label: "Mesa 4",
    state: "queued",
    queuedAt: "2026-08-06T10:00:00.000Z",
  },
  {
    id: "wo-2",
    orderNumber: 6,
    label: null,
    state: "ready",
    queuedAt: "2026-08-06T10:05:00.000Z",
  },
];

afterEach(cleanupWidgets);

describe.each(["light", "dark"] as const)("till-prep-queue a11y (%s theme)", (theme) => {
  it("an empty prep queue has no violations", async () => {
    const { host } = await mountWidget<TillPrepQueue>("till-prep-queue", { entries: [] }, theme);
    await expectNoA11yViolations(host);
  });

  it("a populated prep queue (with Advance controls) has no violations", async () => {
    const { host } = await mountWidget<TillPrepQueue>("till-prep-queue", { entries }, theme);
    await expectNoA11yViolations(host);
  });
});
