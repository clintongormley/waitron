import { afterEach, describe, expect, it, vi } from "vitest";
import { userEvent } from "vitest/browser";
import { registerCodeMessages, type DashboardRequest } from "@waitron/dashboard-kit";
import { formMessageOf } from "@waitron/ui/src/test-helpers.js";
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

/** A request stub over the three routes the dialog calls. `add` returns an {@link AddReaderResult}, a
 * promise of one (which a test may leave pending), or throws; `status` is called for every poll and
 * returns the next {@link ReaderStatus} or a promise of it; `unpair` resolves (the orphan cleanup)
 * unless overridden. `addCalls`, `statusCalls` and `unpairCalls` count the requests on each route. */
function stubRequest(opts: {
  add?: () => AddReaderResult | Promise<AddReaderResult> | never;
  status?: () => ReaderStatus | Promise<ReaderStatus>;
  unpair?: () => void | never;
}): DashboardRequest & {
  addCalls: () => number;
  statusCalls: () => number;
  unpairCalls: () => number;
} {
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
    addCalls: () => number;
    statusCalls: () => number;
    unpairCalls: () => number;
  };
  const calls = () => (request as unknown as { mock: { calls: [string, string][] } }).mock.calls;
  request.addCalls = () => calls().filter(([p, m]) => p === READERS_PATH && m === "POST").length;
  request.statusCalls = () => calls().filter(([p, m]) => p === STATUS_PATH && m === "GET").length;
  request.unpairCalls = () => calls().filter(([p, m]) => p === UNPAIR_PATH && m === "POST").length;
  return request;
}

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
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

async function bottomOf(el: SumUpAddReader): Promise<string> {
  const actions = q(el, "wt-form-actions") as HTMLElementTagNameMap["wt-form-actions"];
  return (await formMessageOf(actions))?.textContent?.trim() ?? "";
}

function fieldError(el: SumUpAddReader, testId: string): string {
  return (q(el, `[data-test=${testId}]`) as unknown as { error: string }).error;
}

function pairDisabled(el: SumUpAddReader): boolean {
  return q(el, "[data-test=pair]")!.hasAttribute("disabled");
}

function focused(el: SumUpAddReader, testId: string): boolean {
  const field = q(el, `[data-test=${testId}]`)!;
  return field.shadowRoot!.activeElement === field.shadowRoot!.querySelector("input");
}

async function pressPair(el: SumUpAddReader): Promise<void> {
  q(el, "[data-test=pair]")!.click();
  await el.updateComplete;
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
  it("keeps a reader paired after Cancel while the pair POST was still pending", async () => {
    vi.useFakeTimers();
    try {
      const add = deferred<AddReaderResult>();
      const request = stubRequest({
        add: () => add.promise,
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
      q(el, "[data-test=cancel]")!.click();
      el.remove();
      add.resolve({ id: "r1", status: "processing" });
      await vi.advanceTimersByTimeAsync(PAIRING_LIFETIME_MS);
      expect(request.statusCalls()).toBe(1);
      expect(onAdded).toHaveBeenCalledTimes(1);
      expect(onClose).toHaveBeenCalledTimes(1);
      expect(request.unpairCalls()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("still cleans up once if the final Cancel status read fails", async () => {
    vi.useFakeTimers();
    try {
      const request = stubRequest({
        status: () => {
          throw new Error("offline");
        },
      });
      const onAdded = vi.fn();
      const onClose = vi.fn();
      const { el } = await mountWidget<SumUpAddReader>("sumup-add-reader", {
        request,
        onAdded,
        onClose,
      });
      await fillAndPair(el);
      q(el, "[data-test=cancel]")!.click();
      q(el, "[data-test=cancel]")!.click();
      el.remove();
      await vi.advanceTimersByTimeAsync(PAIRING_LIFETIME_MS);
      expect(request.statusCalls()).toBe(1);
      expect(request.unpairCalls()).toBe(1);
      expect(onAdded).not.toHaveBeenCalled();
      expect(onClose).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it.each(["paired", "processing"] as const)(
    "checks once after Cancel and keeps only a reader now %s, even when the dialog is removed",
    async (pairingStatus) => {
      vi.useFakeTimers();
      try {
        const finalStatus = deferred<ReaderStatus>();
        let reads = 0;
        const request = stubRequest({
          status: () =>
            ++reads === 1 ? { online: false, pairingStatus: "processing" } : finalStatus.promise,
        });
        const onAdded = vi.fn();
        const onClose = vi.fn();
        const { el } = await mountWidget<SumUpAddReader>("sumup-add-reader", {
          request,
          onAdded,
          onClose,
        });
        onClose.mockImplementation(() => el.remove());
        await fillAndPair(el);
        await vi.advanceTimersByTimeAsync(PAIRING_POLL_MS);

        q(el, "[data-test=cancel]")!.click();
        expect(onClose).toHaveBeenCalledTimes(1);
        expect(el.isConnected).toBe(false);
        expect(request.unpairCalls()).toBe(0);
        expect(request.statusCalls()).toBe(2);
        finalStatus.resolve({ online: false, pairingStatus });
        await vi.advanceTimersByTimeAsync(PAIRING_LIFETIME_MS);

        expect(onAdded).toHaveBeenCalledTimes(pairingStatus === "paired" ? 1 : 0);
        expect(request.unpairCalls()).toBe(pairingStatus === "paired" ? 0 : 1);
        expect(request.statusCalls()).toBe(2);
        expect(onClose).toHaveBeenCalledTimes(1);
      } finally {
        vi.useRealTimers();
      }
    },
  );

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

  it("keeps polling without unpairing after a status timeout and shows the timeout message", async () => {
    vi.useFakeTimers();
    try {
      registerCodeMessages({
        "connection.timed_out": {
          en: "Waitron is taking too long to answer. Try again in a moment.",
          es: "Waitron está tardando demasiado en responder. Inténtalo de nuevo en un momento.",
        },
      });
      let polls = 0;
      const request = stubRequest({
        status: () => {
          polls++;
          if (polls === 1) throw { code: "connection.timed_out" };
          return { online: true, pairingStatus: "paired" };
        },
      });
      const onAdded = vi.fn();
      const { el } = await mountWidget<SumUpAddReader>("sumup-add-reader", { request, onAdded });

      await fillAndPair(el);
      await vi.advanceTimersByTimeAsync(PAIRING_POLL_MS);
      await el.updateComplete;
      expect(text(el, "[data-test=pairing-timeout]")).toBe(
        "Waitron está tardando demasiado en responder. Inténtalo de nuevo en un momento.",
      );
      expect(text(el, "[data-test=countdown]")).toContain("4:58");
      expect(request.unpairCalls()).toBe(0);
      expect(q(el, "[data-test=try-again]")).toBeNull();

      await vi.advanceTimersByTimeAsync(PAIRING_POLL_MS);
      expect(polls).toBe(2);
      expect(onAdded).toHaveBeenCalledTimes(1);
      expect(request.unpairCalls()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps checking after the code expires when every status read times out", async () => {
    vi.useFakeTimers();
    try {
      let paired = false;
      const request = stubRequest({
        status: () => {
          if (!paired) throw { code: "connection.timed_out" };
          return { online: true, pairingStatus: "paired" };
        },
      });
      const onAdded = vi.fn();
      const { el } = await mountWidget<SumUpAddReader>("sumup-add-reader", { request, onAdded });

      await fillAndPair(el);
      await vi.advanceTimersByTimeAsync(PAIRING_LIFETIME_MS + PAIRING_POLL_MS);
      await el.updateComplete;
      expect(q(el, "[data-test=countdown]")).toBeNull();
      expect(q(el, "[data-test=pairing-timeout]")).not.toBeNull();
      expect(q(el, "[data-test=try-again]")).toBeNull();
      expect(request.unpairCalls()).toBe(0);

      paired = true;
      await vi.advanceTimersByTimeAsync(PAIRING_POLL_MS);
      expect(onAdded).toHaveBeenCalledTimes(1);
      expect(request.unpairCalls()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps the form and says a refused pair POST above Pair, and does NOT unpair", async () => {
    vi.useFakeTimers();
    try {
      const request = stubRequest({
        add: () => {
          throw { code: "payment.pairing_refused" };
        },
      });
      const { el } = await mountWidget<SumUpAddReader>("sumup-add-reader", { request });

      await fillAndPair(el);
      expect(await bottomOf(el)).toBe(t("payments.sumup.pairing_failed"));
      expect(q(el, "[data-test=pairing-failed]")).toBeNull();
      expect(q(el, "[data-test=try-again]")).toBeNull();
      expect((q(el, "[data-test=reader-name]") as unknown as { value: string }).value).toBe(
        "Front counter",
      );
      expect((q(el, "[data-test=pairing-code]") as unknown as { value: string }).value).toBe(
        "ABCD1234",
      );
      expect(fieldError(el, "pairing-code")).toBe("");
      expect(pairDisabled(el)).toBe(false);
      expect(request.unpairCalls()).toBe(0); // no row was created, nothing to unpair
    } finally {
      vi.useRealTimers();
    }
  });

  it("says the shared code copy above Pair for any other refusal of the pair POST", async () => {
    vi.useFakeTimers();
    try {
      registerCodeMessages({
        "reader.provider_disconnected": {
          en: "SumUp add-reader copy for this test",
          es: "SumUp add-reader copy for this test",
        },
      });
      const request = stubRequest({
        add: () => {
          throw { code: "reader.provider_disconnected" };
        },
      });
      const { el } = await mountWidget<SumUpAddReader>("sumup-add-reader", { request });

      await fillAndPair(el);
      expect(await bottomOf(el)).toBe("SumUp add-reader copy for this test");
      expect(pairDisabled(el)).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it("drops the refusal when Pair is pressed again, and shows it beside the field message meanwhile", async () => {
    vi.useFakeTimers();
    try {
      let adds = 0;
      const request = stubRequest({
        add: () => {
          if (adds++ === 0) throw { code: "payment.pairing_refused" };
          return { id: "r1", status: "processing" };
        },
      });
      const { el } = await mountWidget<SumUpAddReader>("sumup-add-reader", { request });

      await fillAndPair(el);
      await setInput(el, "pairing-code", "");
      expect(await bottomOf(el)).toBe(
        `${t("payments.sumup.pairing_failed")} ${t("payments.sumup.fix_fields")}`,
      );
      expect(pairDisabled(el)).toBe(true);

      await setInput(el, "pairing-code", "EFGH5678");
      expect(await bottomOf(el)).toBe(t("payments.sumup.pairing_failed"));
      q(el, "[data-test=pair]")!.click();
      await vi.advanceTimersByTimeAsync(0);
      await el.updateComplete;

      expect(request.addCalls()).toBe(2);
      expect(await bottomOf(el)).toBe("");
      expect(q(el, "[data-test=pairing-progress]")).not.toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("calls onClose once when Cancel is pressed while the pair POST is pending", async () => {
    vi.useFakeTimers();
    try {
      const add = deferred<AddReaderResult>();
      const request = stubRequest({ add: () => add.promise });
      const onAdded = vi.fn();
      const onClose = vi.fn();
      const { el } = await mountWidget<SumUpAddReader>("sumup-add-reader", {
        request,
        onAdded,
        onClose,
      });

      await fillAndPair(el);
      q(el, "[data-test=cancel]")!.click();
      expect(onClose).toHaveBeenCalledTimes(1);

      add.resolve({ id: "r1", status: "paired" });
      await vi.advanceTimersByTimeAsync(PAIRING_LIFETIME_MS);

      expect(onClose).toHaveBeenCalledTimes(1);
      expect(request.statusCalls()).toBe(0);
      expect(onAdded).toHaveBeenCalledTimes(1);
      expect(request.unpairCalls()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("unpairs the reader a pair POST created when it returns processing after Cancel", async () => {
    vi.useFakeTimers();
    try {
      const add = deferred<AddReaderResult>();
      const request = stubRequest({ add: () => add.promise });
      const onAdded = vi.fn();
      const onClose = vi.fn();
      const { el } = await mountWidget<SumUpAddReader>("sumup-add-reader", {
        request,
        onAdded,
        onClose,
      });

      await fillAndPair(el);
      q(el, "[data-test=cancel]")!.click();
      add.resolve({ id: "r1", status: "processing" });
      await vi.advanceTimersByTimeAsync(PAIRING_LIFETIME_MS);

      expect(request).toHaveBeenCalledWith(UNPAIR_PATH, "POST");
      expect(request.unpairCalls()).toBe(1);
      expect(request.statusCalls()).toBe(1);
      expect(onAdded).not.toHaveBeenCalled();
      expect(onClose).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("reports, and does not unpair, a reader whose pair POST returns paired after the dialog was detached", async () => {
    vi.useFakeTimers();
    try {
      const add = deferred<AddReaderResult>();
      const request = stubRequest({ add: () => add.promise });
      const onAdded = vi.fn();
      const onClose = vi.fn();
      const { el } = await mountWidget<SumUpAddReader>("sumup-add-reader", {
        request,
        onAdded,
        onClose,
      });

      await fillAndPair(el);
      el.remove();
      add.resolve({ id: "r1", status: "paired" });
      await vi.advanceTimersByTimeAsync(PAIRING_LIFETIME_MS);

      expect(onAdded).toHaveBeenCalledTimes(1);
      expect(onClose).not.toHaveBeenCalled();
      expect(request.unpairCalls()).toBe(0);
      expect(request.statusCalls()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("unpairs the processing reader once when Cancel is pressed while polling and the host then removes the dialog", async () => {
    vi.useFakeTimers();
    try {
      const request = stubRequest({
        status: () => ({ online: false, pairingStatus: "processing" }),
      });
      const onAdded = vi.fn();
      const onClose = vi.fn();
      const { el } = await mountWidget<SumUpAddReader>("sumup-add-reader", {
        request,
        onAdded,
        onClose,
      });
      onClose.mockImplementation(() => el.remove());

      await fillAndPair(el);
      await vi.advanceTimersByTimeAsync(PAIRING_POLL_MS);
      expect(request.statusCalls()).toBe(1);

      q(el, "[data-test=cancel]")!.click();
      await vi.advanceTimersByTimeAsync(PAIRING_LIFETIME_MS);

      expect(onClose).toHaveBeenCalledTimes(1);
      expect(el.isConnected).toBe(false);
      expect(request).toHaveBeenCalledWith(UNPAIR_PATH, "POST");
      expect(request.unpairCalls()).toBe(1);
      expect(request.statusCalls()).toBe(2);
      expect(onAdded).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("unpairs the processing reader when the dialog is detached while polling", async () => {
    vi.useFakeTimers();
    try {
      const request = stubRequest({
        status: () => ({ online: false, pairingStatus: "processing" }),
      });
      const { el } = await mountWidget<SumUpAddReader>("sumup-add-reader", { request });

      await fillAndPair(el);
      el.remove();
      await vi.advanceTimersByTimeAsync(PAIRING_LIFETIME_MS);

      expect(request.unpairCalls()).toBe(1);
      expect(request.statusCalls()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not unpair a paired reader when the host removes the dialog after it finishes", async () => {
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
      onClose.mockImplementation(() => el.remove());

      await fillAndPair(el);
      await vi.advanceTimersByTimeAsync(PAIRING_POLL_MS);

      expect(onAdded).toHaveBeenCalledTimes(1);
      expect(onClose).toHaveBeenCalledTimes(1);
      expect(el.isConnected).toBe(false);
      expect(request.unpairCalls()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not unpair again when an expired dialog is removed", async () => {
    vi.useFakeTimers();
    try {
      const request = stubRequest({
        status: () => ({ online: false, pairingStatus: "processing" }),
      });
      const { el } = await mountWidget<SumUpAddReader>("sumup-add-reader", { request });

      await fillAndPair(el);
      await vi.advanceTimersByTimeAsync(PAIRING_LIFETIME_MS);
      expect(request.unpairCalls()).toBe(1);

      el.remove();
      await vi.advanceTimersByTimeAsync(0);
      expect(request.unpairCalls()).toBe(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("stops polling and calls onClose once when Cancel is pressed while pairing", async () => {
    vi.useFakeTimers();
    try {
      const request = stubRequest({
        status: () => ({ online: false, pairingStatus: "paired" }),
      });
      const onClose = vi.fn();
      const { el } = await mountWidget<SumUpAddReader>("sumup-add-reader", { request, onClose });

      await fillAndPair(el);
      q(el, "[data-test=cancel]")!.click();
      await vi.advanceTimersByTimeAsync(PAIRING_LIFETIME_MS);

      expect(onClose).toHaveBeenCalledTimes(1);
      expect(request.statusCalls()).toBe(1);
      expect(request.unpairCalls()).toBe(0);
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
      expect(fieldError(el, "reader-name")).toBe(t("payments.sumup.reader_name_required"));
      expect(fieldError(el, "pairing-code")).toBe(t("payments.sumup.pairing_code_required"));
    } finally {
      vi.useRealTimers();
    }
  });

  it("sends one pair request when Pair is pressed again while the first is in flight", async () => {
    vi.useFakeTimers();
    try {
      const add = deferred<AddReaderResult>();
      const request = stubRequest({ add: () => add.promise });
      const { el } = await mountWidget<SumUpAddReader>("sumup-add-reader", { request });

      await fillAndPair(el);
      q(el, "[data-test=pair]")!.click();
      await vi.advanceTimersByTimeAsync(0);

      expect(request.addCalls()).toBe(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("starts no poll when detached while the pair request is in flight", async () => {
    vi.useFakeTimers();
    try {
      const add = deferred<AddReaderResult>();
      const request = stubRequest({
        add: () => add.promise,
        status: () => ({ online: false, pairingStatus: "paired" }),
      });
      const onAdded = vi.fn();
      const { el } = await mountWidget<SumUpAddReader>("sumup-add-reader", { request, onAdded });

      await fillAndPair(el);
      el.remove();
      add.resolve({ id: "r1", status: "processing" });
      await vi.advanceTimersByTimeAsync(PAIRING_LIFETIME_MS);

      expect(request.statusCalls()).toBe(0);
      expect(onAdded).not.toHaveBeenCalled();
      expect(request.unpairCalls()).toBe(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not overlap a slow status read with the next poll tick", async () => {
    vi.useFakeTimers();
    try {
      const slow = deferred<ReaderStatus>();
      let reads = 0;
      const request = stubRequest({
        status: () =>
          reads++ === 0 ? slow.promise : { online: false, pairingStatus: "processing" },
      });
      const { el } = await mountWidget<SumUpAddReader>("sumup-add-reader", { request });

      await fillAndPair(el);
      await vi.advanceTimersByTimeAsync(PAIRING_POLL_MS);
      expect(request.statusCalls()).toBe(1);

      await vi.advanceTimersByTimeAsync(PAIRING_POLL_MS);
      expect(request.statusCalls()).toBe(1);

      slow.resolve({ online: false, pairingStatus: "processing" });
      await vi.advanceTimersByTimeAsync(PAIRING_POLL_MS);
      expect(request.statusCalls()).toBe(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("ignores a status read that resolves after the dialog was detached", async () => {
    vi.useFakeTimers();
    try {
      const pending = deferred<ReaderStatus>();
      const request = stubRequest({ status: () => pending.promise });
      const onAdded = vi.fn();
      const onClose = vi.fn();
      const { el } = await mountWidget<SumUpAddReader>("sumup-add-reader", {
        request,
        onAdded,
        onClose,
      });

      await fillAndPair(el);
      await vi.advanceTimersByTimeAsync(PAIRING_POLL_MS);
      expect(request.statusCalls()).toBe(1);

      el.remove();
      pending.resolve({ online: false, pairingStatus: "paired" });
      await vi.advanceTimersByTimeAsync(0);

      expect(onAdded).not.toHaveBeenCalled();
      expect(onClose).not.toHaveBeenCalled();
      expect(request.unpairCalls()).toBe(1); // sent at detach, before the read answered
    } finally {
      vi.useRealTimers();
    }
  });

  it("closes without pairing when Cancel is pressed", async () => {
    const request = stubRequest({});
    const onAdded = vi.fn();
    const onClose = vi.fn();
    const { el } = await mountWidget<SumUpAddReader>("sumup-add-reader", {
      request,
      onAdded,
      onClose,
    });

    q(el, "[data-test=cancel]")!.click();

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onAdded).not.toHaveBeenCalled();
    expect(request).not.toHaveBeenCalled();
  });

  it("calls onClose once however many times the dialog is closed", async () => {
    const request = stubRequest({});
    const onClose = vi.fn();
    const { el } = await mountWidget<SumUpAddReader>("sumup-add-reader", { request, onClose });

    q(el, "[data-test=cancel]")!.click();
    q(el, "[data-test=cancel]")!.click();

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("calls onClose when the dialog is dismissed with Escape", async () => {
    const request = stubRequest({});
    const onAdded = vi.fn();
    const onClose = vi.fn();
    const { el } = await mountWidget<SumUpAddReader>("sumup-add-reader", {
      request,
      onAdded,
      onClose,
    });
    const dialog = q(el, "wt-dialog") as HTMLElement & { updateComplete: Promise<unknown> };
    await dialog.updateComplete;
    const native = dialog.shadowRoot!.querySelector("dialog")!;
    expect(native.open).toBe(true);
    // The browser reports a close a task after the dialog shuts, which can be after the key press
    // resolves; this listener runs after wt-dialog's own, so onClose has been called by then.
    const reported = new Promise<void>((resolve) => {
      native.addEventListener("close", () => resolve(), { once: true });
    });

    await userEvent.keyboard("{Escape}");

    expect(native.open).toBe(false);
    await reported;
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onAdded).not.toHaveBeenCalled();
    expect(request).not.toHaveBeenCalled();
  });

  it("says nothing about errors before the first press, and Pair works", async () => {
    const request = stubRequest({});
    const { el } = await mountWidget<SumUpAddReader>("sumup-add-reader", { request });

    await setInput(el, "reader-name", "Front");
    await setInput(el, "reader-name", "");

    expect(fieldError(el, "reader-name")).toBe("");
    expect(fieldError(el, "pairing-code")).toBe("");
    expect(await bottomOf(el)).toBe("");
    expect(pairDisabled(el)).toBe(false);
  });

  it("on an invalid press marks the fields, says so above Pair, focuses the first and disables Pair", async () => {
    const request = stubRequest({});
    const { el } = await mountWidget<SumUpAddReader>("sumup-add-reader", { request });

    await setInput(el, "pairing-code", "ABCD1234");
    await pressPair(el);

    expect(request).not.toHaveBeenCalled();
    expect(fieldError(el, "reader-name")).toBe(t("payments.sumup.reader_name_required"));
    expect(fieldError(el, "pairing-code")).toBe("");
    expect(await bottomOf(el)).toBe(t("payments.sumup.fix_fields"));
    expect(pairDisabled(el)).toBe(true);
    await vi.waitFor(() => expect(focused(el, "reader-name")).toBe(true));
    expect((q(el, "[data-test=pairing-code]") as unknown as { value: string }).value).toBe(
      "ABCD1234",
    );
  });

  it("re-checks every change after a failed press, and Pair works again once both are filled", async () => {
    const request = stubRequest({});
    const { el } = await mountWidget<SumUpAddReader>("sumup-add-reader", { request });

    await pressPair(el);
    await setInput(el, "reader-name", "Front");
    expect(fieldError(el, "reader-name")).toBe("");
    expect(fieldError(el, "pairing-code")).toBe(t("payments.sumup.pairing_code_required"));
    expect(pairDisabled(el)).toBe(true);

    await setInput(el, "pairing-code", "ABCD1234");
    expect(fieldError(el, "pairing-code")).toBe("");
    expect(await bottomOf(el)).toBe("");
    expect(pairDisabled(el)).toBe(false);

    await setInput(el, "reader-name", " ");
    expect(fieldError(el, "reader-name")).toBe(t("payments.sumup.reader_name_required"));
    expect(pairDisabled(el)).toBe(true);
  });

  it("starts the form again after Try again: the cleared code is not marked and Pair works", async () => {
    vi.useFakeTimers();
    try {
      const request = stubRequest({
        status: () => {
          throw { code: "server.internal" };
        },
      });
      const { el } = await mountWidget<SumUpAddReader>("sumup-add-reader", { request });

      await fillAndPair(el);
      await vi.advanceTimersByTimeAsync(PAIRING_POLL_MS);
      await el.updateComplete;
      q(el, "[data-test=try-again]")!.click();
      await el.updateComplete;

      expect((q(el, "[data-test=reader-name]") as unknown as { value: string }).value).toBe(
        "Front counter",
      );
      expect(fieldError(el, "pairing-code")).toBe("");
      expect(await bottomOf(el)).toBe("");
      expect(pairDisabled(el)).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it("ends the form in one action row with Cancel on the left and Pair as the primary action", async () => {
    const request = stubRequest({});
    const { el } = await mountWidget<SumUpAddReader>("sumup-add-reader", { request });

    const actions = q(el, "wt-form-actions")!;
    expect(actions.getAttribute("slot")).toBe("footer");
    expect(actions.querySelector("[data-test=cancel]")!.getAttribute("slot")).toBe("cancel");
    expect(actions.querySelector("[data-test=pair]")!.getAttribute("variant")).toBe("primary");
    expect(q(el, "wt-form-error-summary")).toBeNull();
  });
});
