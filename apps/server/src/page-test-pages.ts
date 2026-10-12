import { randomUUID } from "node:crypto";
import type { A4HoldCode } from "@waitron/db";
import {
  INVOICE_DELIVERY_LEASE_MS,
  tokenHash,
  type InvoiceDeliveryClaim,
} from "./invoice-delivery.js";
import type { A4DeliveryOutcome } from "./invoice-page-print.js";
import type { PageFormat } from "./page-print-api.js";

/** A page no agent has taken by then fails as `not_claimed`. */
export const TEST_PAGE_CLAIM_WINDOW_MS = 5 * 60_000;
/** How long a finished outcome stays readable before it is forgotten. */
export const TEST_PAGE_OUTCOME_MS = 10 * 60_000;

export type TestPageFailure =
  Extract<A4DeliveryOutcome, { failureCode: unknown }>["failureCode"] | "not_claimed";

export type TestPageView = {
  id: string;
  status: "waiting" | "printing" | "sent" | "failed" | "unknown";
  failureCode?: TestPageFailure;
  /** What the printer is holding the page for, while it is printing. */
  hold?: A4HoldCode;
};

interface TestPage extends TestPageView {
  pagePrinterId: string;
  requestedAt: number;
  finishedAt?: number;
  reported?: true;
  claim?: {
    agentId: string;
    tokenHash: string;
    format: PageFormat;
    resolutionDpi: number;
    touchedAt: number;
    hold: A4HoldCode | null;
  };
}

/**
 * Test pages for office printers, held in memory only: at most one per printer, which a printer's
 * next request replaces once it has finished. A test page is never a delivery and has no row.
 */
export function createPageTestPages(now: () => Date) {
  const pages = new Map<string, TestPage>();

  const finish = (
    page: TestPage,
    status: "failed" | "unknown",
    code: TestPageFailure,
    at: number,
  ) => {
    page.status = status;
    page.failureCode = code;
    page.finishedAt = at;
  };
  const settle = (): number => {
    const at = now().getTime();
    for (const [printerId, page] of pages) {
      if (page.status === "waiting" && at - page.requestedAt >= TEST_PAGE_CLAIM_WINDOW_MS) {
        finish(page, "failed", "not_claimed", at);
      } else if (
        page.status === "printing" &&
        at - page.claim!.touchedAt >= INVOICE_DELIVERY_LEASE_MS
      ) {
        finish(page, "unknown", "timeout", at);
      } else if (page.finishedAt !== undefined && at - page.finishedAt >= TEST_PAGE_OUTCOME_MS) {
        pages.delete(printerId);
      }
    }
    return at;
  };
  const view = ({ id, status, failureCode, claim }: TestPage): TestPageView => {
    if (failureCode !== undefined) return { id, status, failureCode };
    const hold = status === "printing" ? claim!.hold : null;
    return hold === null ? { id, status } : { id, status, hold };
  };
  const held = (claim: InvoiceDeliveryClaim): TestPage | undefined => {
    for (const page of pages.values()) {
      if (
        page.id === claim.deliveryId &&
        page.claim?.agentId === claim.holder &&
        claim.generation === 1 &&
        page.claim.tokenHash === tokenHash(claim.token)
      ) {
        return page;
      }
    }
    return undefined;
  };

  return {
    /** The printer's page still out, or a new one. */
    request(pagePrinterId: string): TestPageView {
      const at = settle();
      const current = pages.get(pagePrinterId);
      if (current !== undefined && current.finishedAt === undefined) return view(current);
      const page: TestPage = {
        id: randomUUID(),
        status: "waiting",
        pagePrinterId,
        requestedAt: at,
      };
      pages.set(pagePrinterId, page);
      return view(page);
    },

    read(pagePrinterId: string): TestPageView | null {
      settle();
      const page = pages.get(pagePrinterId);
      return page === undefined ? null : view(page);
    },

    /** Whether `id` names a test page, so the agent routes take this path rather than a delivery's. */
    knows(id: string): boolean {
      for (const page of pages.values()) if (page.id === id) return true;
      return false;
    },

    /** The printers whose test page is out with an agent. */
    printingOn(): string[] {
      settle();
      const printing: string[] = [];
      for (const [printerId, page] of pages)
        if (page.status === "printing") printing.push(printerId);
      return printing;
    },

    /** What the printer's test page still printing is held for, or `null`. */
    holdOn(pagePrinterId: string): A4HoldCode | null {
      settle();
      const page = pages.get(pagePrinterId);
      return page?.status === "printing" ? page.claim!.hold : null;
    },

    /**
     * Hands the oldest waiting page on one of `printers`, other than `busyPrinterIds`, to `agentId`;
     * a waiting page whose printer is listed as disabled fails instead.
     */
    claim(
      agentId: string,
      printers: readonly {
        id: string;
        active: boolean;
        agentId: string | null;
        documentFormat: PageFormat;
        resolutionDpi: number;
      }[],
      busyPrinterIds: readonly string[] = [],
    ): { id: string; generation: 1; token: string; pagePrinterId: string } | undefined {
      const at = settle();
      let next: TestPage | undefined;
      for (const printer of printers) {
        const page = pages.get(printer.id);
        if (page?.status !== "waiting") continue;
        if (!printer.active) finish(page, "failed", "printer_disabled", at);
        else if (
          printer.agentId === agentId &&
          !busyPrinterIds.includes(printer.id) &&
          (next === undefined || page.requestedAt < next.requestedAt)
        ) {
          next = page;
        }
      }
      if (next === undefined) return undefined;
      const printer = printers.find(({ id }) => id === next.pagePrinterId)!;
      const token = randomUUID();
      next.status = "printing";
      next.claim = {
        agentId,
        tokenHash: tokenHash(token),
        format: printer.documentFormat,
        resolutionDpi: printer.resolutionDpi,
        touchedAt: at,
        hold: null,
      };
      return { id: next.id, generation: 1, token, pagePrinterId: next.pagePrinterId };
    },

    /** The format and resolution the claim fixed, while it is still printing. */
    printing(
      claim: InvoiceDeliveryClaim,
    ): { format: PageFormat; resolutionDpi: number } | undefined {
      settle();
      const page = held(claim);
      if (page?.status !== "printing") return undefined;
      return { format: page.claim!.format, resolutionDpi: page.claim!.resolutionDpi };
    },

    renew(claim: InvoiceDeliveryClaim, hold: A4HoldCode | null): boolean {
      const at = settle();
      const page = held(claim);
      if (page?.status !== "printing") return false;
      page.claim!.touchedAt = at;
      page.claim!.hold = hold;
      return true;
    },

    /**
     * Records the agent's outcome, also over a lapse (nothing else can have printed it). A repeat
     * of an accepted report changes nothing.
     */
    report(claim: InvoiceDeliveryClaim, outcome: A4DeliveryOutcome): boolean {
      const at = settle();
      const page = held(claim);
      if (page === undefined) return false;
      if (page.reported) return true;
      page.status = outcome.status;
      if (outcome.status === "sent") delete page.failureCode;
      else page.failureCode = outcome.failureCode;
      page.finishedAt = at;
      page.reported = true;
      return true;
    },
  };
}

export type PageTestPages = ReturnType<typeof createPageTestPages>;
