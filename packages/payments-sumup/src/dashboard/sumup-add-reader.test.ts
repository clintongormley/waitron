import { afterEach, describe, expect, it, vi } from "vitest";
import type { DashboardRequest } from "@waitron/dashboard-kit";
import { cleanupWidgets, mountWidget } from "./test-helpers.js";
import { t } from "./strings.js";
import { SumUpAddReader, PAIRING_LIFETIME_MS, PAIRING_POLL_MS } from "./sumup-add-reader.js";
import type { AddReaderResult, ReaderStatus } from "./client.js";

afterEach(() => {
  cleanupWidgets();
  vi.restoreAllMocks();
});

const READERS_PATH = "/management-api/payments/readers";
const STATUS_PATH = "/management-api/payments/readers/r1/status";
const UNPAIR_PATH = "/management-api/payments/readers/r1/unpair";

/** A request stub over the three routes the dialog calls. `add` may resolve an {@link AddReaderResult}
 * or throw; `status` is called for every poll and returns the next {@link ReaderStatus}; `unpair`
 * resolves (the orphan cleanup) unless overridden. */
function stubRequest(opts: {
  add?: () => AddReaderResult | never;
  status?: () => ReaderStatus;
  unpair?: () => void | never;
}): DashboardRequest & { statusCalls: () => number; unpairCalls: () => number } {
  const request = vi.fn(async (path: string, method: string) => {
    if (path === READERS_PATH && method === "POST") {
      return (opts.add ?? (() => ({ id: "r1", status: "processing" }) as AddReaderResult))();
    }
    if (path === STATUS_PATH && method === "GET") {
      return (opts.status ?? (() => ({ online: false }) as ReaderStatus))();
    }
    if (path === UNPAIR_PATH && method === "POST") {
      return (opts.unpair ?? (() => undefined))();
    }
    throw new Error(`unexpected ${method} ${path}`);
  }) as unknown as DashboardRequest & {
    statusCalls: () => number;
    unpairCalls: () => number;
  };
  const calls = () => (request as unknown as { mock: { calls: [string, string][] } }).mock.calls;
  request.statusCalls = () => calls().filter(([p, m]) => p === STATUS_PATH && m === "GET").length;
  request.unpairCalls = () => calls().filter(([p, m]) => p === UNPAIR_PATH && m === "POST").length;
  return request;
}

function q(el: SumUpAddReader, sel: string): HTMLElement | null {
  return el.shadowRoot!.querySelector<HTMLElement>(sel);
}

function text(el: SumUpAddReader, sel: string): string {
  return q(el, sel)?.textContent?.trim() ?? "";
}

async function setInput(el: SumUpAddReader, testId: string, value: string): Promise<void> {
  q(el, `[data-test=${testId}]`)!.dispatchEvent(
    new CustomEvent("wt-change", { detail: { value } }),
  );
  await el.updateComplete;
}

async function fillAndPair(el: SumUpAddReader): Promise<void> {
  await setInput(el, "reader-name", "Front counter");
  await setInput(el, "pairing-code", "ABCD1234");
  q(el, "[data-test=pair]")!.click();
  await vi.advanceTimersByTimeAsync(0); // let the POST resolve
  await el.updateComplete;
}

describe("sumup-add-reader", () => {
  it("posts the code, polls status every 2s, and on pairingStatus=paired emits onAdded and closes", async () => {
    vi.useFakeTimers();
    try {
      const pairing = ["processing", "processing", "paired"] as const;
      let i = 0;
      const request = stubRequest({
        status: () => ({ online: false, pairingStatus: pairing[i++] ?? "paired" }),
      });
      const onAdded = vi.fn();
      const onClose = vi.fn();
      const { el } = await mountWidget<SumUpAddReader>("sumup-add-reader", {
        request,
        onAdded,
        onClose,
      });

      await fillAndPair(el);
      expect(request).toHaveBeenCalledWith(READERS_PATH, "POST", {
        providerId: "sumup",
        name: "Front counter",
        code: "ABCD1234",
      });
      expect(request.statusCalls()).toBe(0);

      await vi.advanceTimersByTimeAsync(PAIRING_POLL_MS);
      expect(request.statusCalls()).toBe(1); // still processing

      await vi.advanceTimersByTimeAsync(PAIRING_POLL_MS);
      expect(request.statusCalls()).toBe(2);

      await vi.advanceTimersByTimeAsync(PAIRING_POLL_MS); // third poll → paired
      expect(onAdded).toHaveBeenCalledTimes(1);
      expect(onClose).toHaveBeenCalledTimes(1);
      expect(request.unpairCalls()).toBe(0); // paired, so nothing to clean up
    } finally {
      vi.useRealTimers();
    }
  });

  it("completes when paired even while the reader is offline (not gated on connectivity)", async () => {
    vi.useFakeTimers();
    try {
      const request = stubRequest({
        status: () => ({ online: false, pairingStatus: "paired" }),
      });
      const onAdded = vi.fn();
      const onClose = vi.fn();
      const { el } = await mountWidget<SumUpAddReader>("sumup-add-reader", {
        request,
        onAdded,
        onClose,
      });

      await fillAndPair(el);
      await vi.advanceTimersByTimeAsync(PAIRING_POLL_MS);
      expect(onAdded).toHaveBeenCalledTimes(1);
      expect(onClose).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("does NOT complete while online but still processing (not gated on connectivity)", async () => {
    vi.useFakeTimers();
    try {
      const request = stubRequest({
        status: () => ({ online: true, pairingStatus: "processing" }),
      });
      const onAdded = vi.fn();
      const { el } = await mountWidget<SumUpAddReader>("sumup-add-reader", { request, onAdded });

      await fillAndPair(el);
      await vi.advanceTimersByTimeAsync(PAIRING_POLL_MS);
      await vi.advanceTimersByTimeAsync(PAIRING_POLL_MS);
      expect(onAdded).not.toHaveBeenCalled();
      expect(text(el, "[data-test=countdown]")).not.toBe("");
    } finally {
      vi.useRealTimers();
    }
  });

  it("renders a five-minute countdown that decrements each poll", async () => {
    vi.useFakeTimers();
    try {
      const request = stubRequest({
        status: () => ({ online: false, pairingStatus: "processing" }),
      });
      const { el } = await mountWidget<SumUpAddReader>("sumup-add-reader", { request });

      await fillAndPair(el);
      expect(text(el, "[data-test=countdown]")).toBe(
        t("payments.sumup.pairing_time_left").replace("{time}", "5:00"),
      );

      await vi.advanceTimersByTimeAsync(PAIRING_POLL_MS);
      await el.updateComplete;
      expect(text(el, "[data-test=countdown]")).toBe(
        t("payments.sumup.pairing_time_left").replace("{time}", "4:58"),
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it("expires without paired: unpairs the created row and offers try again", async () => {
    vi.useFakeTimers();
    try {
      const request = stubRequest({
        status: () => ({ online: false, pairingStatus: "processing" }),
      });
      const onAdded = vi.fn();
      const { el } = await mountWidget<SumUpAddReader>("sumup-add-reader", { request, onAdded });

      await fillAndPair(el);
      await vi.advanceTimersByTimeAsync(PAIRING_LIFETIME_MS);
      await el.updateComplete;

      expect(text(el, "[data-test=pairing-expired]")).toBe(t("payments.sumup.pairing_expired"));
      expect(q(el, "[data-test=try-again]")).not.toBeNull();
      expect(onAdded).not.toHaveBeenCalled();
      // The processing orphan is unpaired so it cannot be picked as a default reader.
      expect(request).toHaveBeenCalledWith(UNPAIR_PATH, "POST");
      expect(request.unpairCalls()).toBe(1);

      // Try again returns to the form with a cleared code.
      q(el, "[data-test=try-again]")!.click();
      await el.updateComplete;
      expect(q(el, "[data-test=pairing-code]")).not.toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("stops polling when detached (disconnectedCallback clears the timer)", async () => {
    vi.useFakeTimers();
    try {
      const request = stubRequest({
        status: () => ({ online: false, pairingStatus: "processing" }),
      });
      const { el } = await mountWidget<SumUpAddReader>("sumup-add-reader", { request });

      await fillAndPair(el);
      await vi.advanceTimersByTimeAsync(PAIRING_POLL_MS);
      expect(request.statusCalls()).toBe(1);

      el.remove();
      await vi.advanceTimersByTimeAsync(PAIRING_LIFETIME_MS);
      // Without the disconnectedCallback clear, the interval would keep firing and this would climb.
      expect(request.statusCalls()).toBe(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("finishes immediately when the POST already reports paired", async () => {
    vi.useFakeTimers();
    try {
      const request = stubRequest({ add: () => ({ id: "r1", status: "paired" }) });
      const onAdded = vi.fn();
      const onClose = vi.fn();
      const { el } = await mountWidget<SumUpAddReader>("sumup-add-reader", {
        request,
        onAdded,
        onClose,
      });

      await fillAndPair(el);
      expect(onAdded).toHaveBeenCalledTimes(1);
      expect(onClose).toHaveBeenCalledTimes(1);
      expect(request.statusCalls()).toBe(0); // no polling needed
    } finally {
      vi.useRealTimers();
    }
  });

  it("shows the failed copy and unpairs the row when a poll is rejected", async () => {
    vi.useFakeTimers();
    try {
      let polls = 0;
      const request = stubRequest({
        status: () => {
          polls++;
          throw { code: "server.internal" };
        },
      });
      const { el } = await mountWidget<SumUpAddReader>("sumup-add-reader", { request });

      await fillAndPair(el);
      await vi.advanceTimersByTimeAsync(PAIRING_POLL_MS);
      await el.updateComplete;

      expect(polls).toBe(1);
      expect(text(el, "[data-test=pairing-failed]")).toBe(t("payments.sumup.pairing_failed"));
      expect(q(el, "[data-test=try-again]")).not.toBeNull();
      expect(request.unpairCalls()).toBe(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("shows the failed copy and does NOT unpair when the pair POST itself is rejected", async () => {
    vi.useFakeTimers();
    try {
      const request = stubRequest({
        add: () => {
          throw { code: "payment.provider_credential_rejected" };
        },
      });
      const { el } = await mountWidget<SumUpAddReader>("sumup-add-reader", { request });

      await fillAndPair(el);
      expect(text(el, "[data-test=pairing-failed]")).toBe(t("payments.sumup.pairing_failed"));
      expect(q(el, "[data-test=try-again]")).not.toBeNull();
      expect(request.unpairCalls()).toBe(0); // no row was created, nothing to unpair
    } finally {
      vi.useRealTimers();
    }
  });

  it("survives a failed unpair on expiry without hanging", async () => {
    vi.useFakeTimers();
    try {
      const request = stubRequest({
        status: () => ({ online: false, pairingStatus: "processing" }),
        unpair: () => {
          throw { code: "server.internal" };
        },
      });
      const { el } = await mountWidget<SumUpAddReader>("sumup-add-reader", { request });

      await fillAndPair(el);
      await vi.advanceTimersByTimeAsync(PAIRING_LIFETIME_MS);
      await el.updateComplete;

      expect(text(el, "[data-test=pairing-expired]")).toBe(t("payments.sumup.pairing_expired"));
      expect(request.unpairCalls()).toBe(1); // attempted, its rejection swallowed
    } finally {
      vi.useRealTimers();
    }
  });

  it("blocks pairing until the name and code are filled", async () => {
    vi.useFakeTimers();
    try {
      const request = stubRequest({});
      const { el } = await mountWidget<SumUpAddReader>("sumup-add-reader", { request });

      q(el, "[data-test=pair]")!.click();
      await vi.advanceTimersByTimeAsync(0);
      await el.updateComplete;

      expect(request).not.toHaveBeenCalled();
      const summary = q(el, "wt-form-error-summary");
      expect((summary as unknown as { errors: string[] }).errors).toEqual([
        t("payments.sumup.reader_name_required"),
        t("payments.sumup.pairing_code_required"),
      ]);
    } finally {
      vi.useRealTimers();
    }
  });
});
