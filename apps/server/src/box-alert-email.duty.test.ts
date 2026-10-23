import { describe, expect, it, vi } from "vitest";
import {
  BOX_EMAIL_CHECK_MS,
  boxEmailMessage,
  startBoxEmailDuty,
  type BoxEmailCode,
  type BoxEmailContext,
} from "./box-alert-email.js";
import type { EmailDelivery } from "./email-delivery.js";
import type { FreeSpaceReading } from "./free-space-watch.js";
import type { Logger } from "./logger.js";
import type { ManagerEmailRecipient } from "./manager-email-recipients.js";
import type { TextEmailSender } from "./text-email.js";

type Line = [string, string, Record<string, unknown> | undefined];

const VENUE = "Corner Bistro";
const SMTP = { url: "smtp://127.0.0.1:1", from: "box@example.test" };
const ANA: ManagerEmailRecipient = { personId: "p-ana", email: "ana@example.test", language: "es" };
const BEN: ManagerEmailRecipient = { personId: "p-ben", email: "ben@example.test", language: "en" };

function at(minute: number): Date {
  return new Date(Date.UTC(2026, 9, 23, 12, minute));
}

function duty() {
  const lines: Line[] = [];
  const log: Logger = (level, event, fields) => lines.push([level, event, fields]);
  const events = (event: string) => lines.filter((line) => line[1] === event);
  const armed: { ms: number; fn: () => void; cancelled: boolean }[] = [];
  const state = {
    diskSince: null as Date | null,
    lowSince: null as Date | null,
    recipients: [ANA, BEN] as readonly ManagerEmailRecipient[],
    delivery: { mode: "smtp", smtp: SMTP } as EmailDelivery,
    now: at(0),
  };
  const context = vi.fn(async (): Promise<BoxEmailContext> => ({
    venue: VENUE,
    recipients: state.recipients,
    delivery: state.delivery,
  }));
  const send = vi.fn<TextEmailSender>(async () => "sent");
  const handle = startBoxEmailDuty({
    disk: { since: () => state.diskSince },
    space: {
      current: (): FreeSpaceReading =>
        state.lowSince === null
          ? { freeBytes: null, readAt: null, lowSince: null }
          : { freeBytes: 1, readAt: state.lowSince, lowSince: state.lowSince },
    },
    moduleNotices: async () => ({ notices: [], unavailable: [] }),
    context,
    send,
    isPrimary: () => true,
    intervalMs: BOX_EMAIL_CHECK_MS,
    now: () => state.now,
    log,
    timer: (ms, fn) => {
      const entry = { ms, fn, cancelled: false };
      armed.push(entry);
      return { cancel: () => (entry.cancelled = true) };
    },
  });
  const tick = async () => {
    const n = armed.length;
    armed.at(-1)!.fn();
    await vi.waitFor(() => expect(armed.length).toBe(n + 1));
  };
  const sent = () =>
    send.mock.calls.map(([message]) => ({
      recipient: message.recipient,
      subject: message.subject,
      text: message.text,
    }));
  return { handle, armed, state, context, send, sent, tick, lines, events };
}

function expected(code: BoxEmailCode, recipient: ManagerEmailRecipient) {
  return {
    recipient: recipient.email,
    ...boxEmailMessage(code, recipient.language, VENUE),
  };
}

describe("startBoxEmailDuty", () => {
  it("emails each manager once when the disk falls below 2 GB, in their own language", async () => {
    const d = duty();
    d.state.lowSince = at(1);
    await d.tick();
    expect(d.sent()).toEqual([
      expected("storage.space_low", ANA),
      expected("storage.space_low", BEN),
    ]);
    expect(d.send.mock.calls[0]![0].smtp).toEqual(SMTP);
    expect(d.events("box_email.sent")).toEqual([
      ["info", "box_email.sent", { code: "storage.space_low" }],
      ["info", "box_email.sent", { code: "storage.space_low" }],
    ]);
    await d.tick();
    expect(d.send).toHaveBeenCalledTimes(2);
  });

  it("a box found full and low at once emails only the full disk", async () => {
    const d = duty();
    d.state.lowSince = at(1);
    d.state.diskSince = at(1);
    await d.tick();
    await d.tick();
    expect(d.sent()).toEqual([
      expected("storage.disk_full", ANA),
      expected("storage.disk_full", BEN),
    ]);
  });

  it("a disk going from low to full emails both, once each", async () => {
    const d = duty();
    d.state.lowSince = at(1);
    await d.tick();
    d.state.diskSince = at(2);
    await d.tick();
    await d.tick();
    expect(d.sent()).toEqual([
      expected("storage.space_low", ANA),
      expected("storage.space_low", BEN),
      expected("storage.disk_full", ANA),
      expected("storage.disk_full", BEN),
    ]);
  });

  it("a stop that lifts and returns while space stays low sends nothing more", async () => {
    const d = duty();
    d.state.lowSince = at(1);
    d.state.diskSince = at(1);
    await d.tick();
    d.state.diskSince = null;
    await d.tick();
    d.state.diskSince = at(3);
    await d.tick();
    expect(d.sent()).toEqual([
      expected("storage.disk_full", ANA),
      expected("storage.disk_full", BEN),
    ]);
  });

  it("once both are off the episode ends, and the next fall emails again", async () => {
    const d = duty();
    d.state.lowSince = at(1);
    await d.tick();
    d.state.lowSince = null;
    await d.tick();
    d.state.lowSince = at(3);
    await d.tick();
    expect(d.sent()).toEqual([
      expected("storage.space_low", ANA),
      expected("storage.space_low", BEN),
      expected("storage.space_low", ANA),
      expected("storage.space_low", BEN),
    ]);
  });

  it("a send that could not be made is tried the next minute; one already accepted is not", async () => {
    const d = duty();
    d.send.mockImplementationOnce(async () => "unknown");
    d.state.lowSince = at(1);
    await d.tick();
    expect(d.sent().map((m) => m.recipient)).toEqual([ANA.email, BEN.email]);
    await d.tick();
    expect(d.sent().map((m) => m.recipient)).toEqual([ANA.email, BEN.email, ANA.email]);
    await d.tick();
    expect(d.send).toHaveBeenCalledTimes(3);
  });

  it("a send the mail server refused is tried again the next minute, and goes", async () => {
    const d = duty();
    d.send.mockImplementation(async ({ recipient }) =>
      recipient === BEN.email && d.send.mock.calls.length <= 2 ? "rejected" : "sent",
    );
    d.state.lowSince = at(1);
    await d.tick();
    expect(d.sent().map((m) => m.recipient)).toEqual([ANA.email, BEN.email]);
    expect(d.events("box_email.sent")).toHaveLength(1);
    await d.tick();
    expect(d.sent().map((m) => m.recipient)).toEqual([ANA.email, BEN.email, BEN.email]);
    expect(d.events("box_email.sent")).toHaveLength(2);
    await d.tick();
    expect(d.send).toHaveBeenCalledTimes(3);
  });

  it("a sender that throws counts as not sent", async () => {
    const d = duty();
    d.send.mockImplementationOnce(async () => {
      throw new Error("socket closed");
    });
    d.state.lowSince = at(1);
    await d.tick();
    expect(d.sent().map((m) => m.recipient)).toEqual([ANA.email, BEN.email]);
    await d.tick();
    expect(d.sent().map((m) => m.recipient)).toEqual([ANA.email, BEN.email, ANA.email]);
  });

  it("without email settings it sends nothing, says so once, and sends once settings appear", async () => {
    const d = duty();
    d.state.delivery = { mode: "unconfigured" };
    d.state.lowSince = at(1);
    await d.tick();
    await d.tick();
    expect(d.send).not.toHaveBeenCalled();
    expect(d.events("box_email.not_configured")).toEqual([
      ["warn", "box_email.not_configured", { code: "storage.space_low" }],
    ]);
    d.state.delivery = { mode: "smtp", smtp: SMTP };
    await d.tick();
    expect(d.sent()).toEqual([
      expected("storage.space_low", ANA),
      expected("storage.space_low", BEN),
    ]);
  });

  it("a manager added during an episode gets it at the next check", async () => {
    const d = duty();
    d.state.recipients = [ANA];
    d.state.lowSince = at(1);
    await d.tick();
    d.state.recipients = [ANA, BEN];
    await d.tick();
    expect(d.sent()).toEqual([
      expected("storage.space_low", ANA),
      expected("storage.space_low", BEN),
    ]);
  });

  it("with nobody to email it says so once", async () => {
    const d = duty();
    d.state.recipients = [];
    d.state.lowSince = at(1);
    await d.tick();
    await d.tick();
    expect(d.send).not.toHaveBeenCalled();
    expect(d.events("box_email.no_recipients")).toEqual([
      ["warn", "box_email.no_recipients", { code: "storage.space_low" }],
    ]);
  });

  it("checks a minute after start, then a minute after each check finishes", async () => {
    const d = duty();
    expect(d.armed).toEqual([{ ms: 60_000, fn: expect.any(Function), cancelled: false }]);
    await d.tick();
    expect(d.armed).toHaveLength(2);
    expect(d.armed[1]!.ms).toBe(60_000);
  });

  it("a check whose reads throw is logged, and the next is armed", async () => {
    const d = duty();
    d.context.mockRejectedValueOnce(new Error("boom"));
    d.state.lowSince = at(1);
    await d.tick();
    expect(d.events("box_email.check_failed")).toEqual([
      ["warn", "box_email.check_failed", { errorCode: "unknown" }],
    ]);
    expect(d.armed.at(-1)!.ms).toBe(60_000);
  });

  it("reads nothing when there is nothing to email", async () => {
    const d = duty();
    await d.tick();
    await d.tick();
    expect(d.context).not.toHaveBeenCalled();
    expect(d.send).not.toHaveBeenCalled();
  });
});
