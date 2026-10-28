import { describe, expect, it, vi } from "vitest";
import {
  BOX_EMAIL_CHECK_MS,
  boxEmailMessage,
  startBoxEmailDuty,
  type BoxEmailCode,
  type BoxEmailContext,
  type EmailedIncident,
} from "./box-alert-email.js";
import type { BackupOutcomeHolder } from "./alert-sources.js";
import type { EmailDelivery } from "./email-delivery.js";
import { BOX_EMAIL_WORDS } from "./i18n/box-emails.js";
import type { FreeSpaceReading } from "./free-space-watch.js";
import type { Logger } from "./logger.js";
import type { ManagerEmailRecipient } from "./manager-email-recipients.js";
import type { OwnedStaffNotice, StaffNoticesRead } from "./staff-notices.js";
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
    notices: { notices: [], unavailable: [] } as StaffNoticesRead,
    incidents: [] as readonly EmailedIncident[],
    backupStopped: undefined as BackupOutcomeHolder["runStopped"],
    primary: true,
  };
  const context = vi.fn(async (): Promise<BoxEmailContext> => ({
    venue: VENUE,
    recipients: state.recipients,
    delivery: state.delivery,
  }));
  const moduleNotices = vi.fn(async (): Promise<StaffNoticesRead> => state.notices);
  const emailedIncidents = vi.fn(async (): Promise<readonly EmailedIncident[]> => state.incidents);
  const send = vi.fn<TextEmailSender>(async () => "sent");
  const handle = startBoxEmailDuty({
    disk: { since: () => state.diskSince },
    space: {
      current: (): FreeSpaceReading =>
        state.lowSince === null
          ? { freeBytes: null, readAt: null, lowSince: null }
          : { freeBytes: 1, readAt: state.lowSince, lowSince: state.lowSince },
    },
    moduleNotices,
    emailedIncidents,
    backupStopped: () => state.backupStopped,
    context,
    send,
    isPrimary: () => state.primary,
    intervalMs: BOX_EMAIL_CHECK_MS,
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
  return {
    handle,
    armed,
    state,
    context,
    moduleNotices,
    emailedIncidents,
    send,
    sent,
    tick,
    lines,
    events,
  };
}

function notice(code: string): OwnedStaffNotice {
  return { owner: "fiscal-verifactu", key: code, code, severity: "error", params: {} };
}

const STOP = {
  clockAt: "2025-03-14T08:12:00.000Z",
  offsetMinutes: 60,
  lastRecordAt: "2026-10-18T21:40:00.000Z",
  lastRecordOffsetMinutes: 120,
};

const SPANISH_STOP = BOX_EMAIL_WORDS["clock.behind_chain"].es;

function clockStop(params: typeof STOP): OwnedStaffNotice {
  return { ...notice("clock.behind_chain"), params };
}

const RESTART: EmailedIncident = {
  id: "i-restart",
  code: "clock.behind_chain_restarted",
  params: {
    confirmationId: "c-1",
    confirmedBy: "admin",
    person: "Ana",
    clockAt: "2025-03-14T08:12:00.000Z",
    lastRecordAt: "2026-10-18T21:40:00.000Z",
  },
};

const MISDATED: EmailedIncident = {
  id: "i-misdated",
  code: "clock.records_misdated",
  params: {
    confirmationId: "c-1",
    count: 3,
    from: "2026-10-18T19:05:00.000Z",
    fromOffsetMinutes: 120,
    to: "2026-10-26T09:30:00.000Z",
    toOffsetMinutes: 60,
    partial: false,
    unconfirmed: false,
  },
};

function clockEmail(incident: EmailedIncident, recipient: ManagerEmailRecipient) {
  return {
    recipient: recipient.email,
    ...boxEmailMessage(incident.code, recipient.language, VENUE, incident.params),
  };
}

const turn = () => new Promise((resolve) => setImmediate(resolve));

function held<T>() {
  let release!: (value: T) => void;
  const promise = new Promise<T>((resolve) => (release = resolve));
  return { promise, release };
}

function expected(code: BoxEmailCode, recipient: ManagerEmailRecipient) {
  return {
    recipient: recipient.email,
    ...boxEmailMessage(code, recipient.language, VENUE),
  };
}

describe("startBoxEmailDuty", () => {
  it("emails each manager once when the low-space warning comes on, in their own language", async () => {
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

  it("a full disk whose email never went sends the low-space email once the stop lifts", async () => {
    const d = duty();
    d.state.recipients = [ANA];
    d.send.mockImplementation(async () => "unknown");
    d.state.lowSince = at(1);
    d.state.diskSince = at(1);
    await d.tick();
    await d.tick();
    d.send.mockImplementation(async () => "sent");
    d.state.diskSince = null;
    await d.tick();
    expect(d.sent()).toEqual([
      expected("storage.disk_full", ANA),
      expected("storage.disk_full", ANA),
      expected("storage.space_low", ANA),
    ]);
    await d.tick();
    expect(d.send).toHaveBeenCalledTimes(3);
  });

  it("a full disk found without email settings sends the low-space email once the stop lifts and settings appear", async () => {
    const d = duty();
    d.state.delivery = { mode: "unconfigured" };
    d.state.lowSince = at(1);
    d.state.diskSince = at(1);
    await d.tick();
    d.state.diskSince = null;
    d.state.delivery = { mode: "smtp", smtp: SMTP };
    await d.tick();
    expect(d.sent()).toEqual([
      expected("storage.space_low", ANA),
      expected("storage.space_low", BEN),
    ]);
  });

  it("a manager added after the stop lifts, while space stays low, gets the low-space email and the others nothing more", async () => {
    const d = duty();
    d.state.recipients = [ANA];
    d.state.lowSince = at(1);
    d.state.diskSince = at(1);
    await d.tick();
    d.state.diskSince = null;
    await d.tick();
    d.state.recipients = [ANA, BEN];
    await d.tick();
    await d.tick();
    expect(d.sent()).toEqual([
      expected("storage.disk_full", ANA),
      expected("storage.space_low", BEN),
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

  it("emails a module's clock notice once, and again in a new episode", async () => {
    const d = duty();
    d.state.notices = { notices: [notice("clock.unusable")], unavailable: [] };
    await d.tick();
    expect(d.sent()).toEqual([expected("clock.unusable", ANA), expected("clock.unusable", BEN)]);
    await d.tick();
    expect(d.send).toHaveBeenCalledTimes(2);
    d.state.notices = { notices: [], unavailable: [] };
    await d.tick();
    d.state.notices = { notices: [notice("clock.unusable")], unavailable: [] };
    await d.tick();
    expect(d.sent()).toEqual([
      expected("clock.unusable", ANA),
      expected("clock.unusable", BEN),
      expected("clock.unusable", ANA),
      expected("clock.unusable", BEN),
    ]);
  });

  it("keeps a module's episode while its check fails", async () => {
    const d = duty();
    d.state.notices = { notices: [notice("clock.unusable")], unavailable: [] };
    await d.tick();
    expect(d.send).toHaveBeenCalledTimes(2);
    d.state.notices = { notices: [], unavailable: ["fiscal-verifactu"] };
    await d.tick();
    d.state.notices = { notices: [notice("clock.unusable")], unavailable: [] };
    await d.tick();
    expect(d.send).toHaveBeenCalledTimes(2);
  });

  it("tries a failed clock email again while its module's check fails", async () => {
    const d = duty();
    d.state.recipients = [ANA];
    d.send.mockImplementationOnce(async () => "rejected");
    d.state.notices = { notices: [notice("clock.unusable")], unavailable: [] };
    await d.tick();
    d.state.notices = { notices: [], unavailable: ["fiscal-verifactu"] };
    await d.tick();
    expect(d.sent()).toEqual([expected("clock.unusable", ANA), expected("clock.unusable", ANA)]);
    await d.tick();
    expect(d.send).toHaveBeenCalledTimes(2);
  });

  it("emails no module notice without email words", async () => {
    const d = duty();
    d.state.notices = {
      notices: [notice("fiscal.records_unsent"), notice("printer.jobs_waiting")],
      unavailable: [],
    };
    await d.tick();
    await d.tick();
    expect(d.context).not.toHaveBeenCalled();
    expect(d.send).not.toHaveBeenCalled();
  });

  it("emails each manager once per clock stop, with the stop's two times", async () => {
    const d = duty();
    d.state.notices = { notices: [clockStop(STOP)], unavailable: [] };
    await d.tick();
    await d.tick();
    expect(d.sent()).toEqual([
      {
        recipient: ANA.email,
        subject: SPANISH_STOP.subject.replaceAll("{venue}", VENUE),
        text: SPANISH_STOP.text
          .replaceAll("{clockAt}", "14/03/2025 09:12")
          .replaceAll("{lastRecordAt}", "18/10/2026 23:40"),
      },
      {
        recipient: BEN.email,
        subject:
          "Payments stopped at Corner Bistro: the box's clock reads earlier than its last sale",
        text: expect.stringContaining(
          "(14/03/2025 09:12) reads earlier than its last recorded sale (18/10/2026 23:40)",
        ),
      },
    ]);
  });

  it("a clock stop keeps its first notice's times when a later read differs", async () => {
    const d = duty();
    d.state.recipients = [BEN];
    d.send.mockImplementationOnce(async () => "rejected");
    d.state.notices = { notices: [clockStop(STOP)], unavailable: [] };
    await d.tick();
    d.state.notices = {
      notices: [clockStop({ ...STOP, clockAt: "2025-03-14T08:13:00.000Z" })],
      unavailable: [],
    };
    await d.tick();
    await d.tick();
    expect(d.sent()).toHaveLength(2);
    expect(d.sent()[1]!.text).toContain("(14/03/2025 09:12)");
    expect(d.sent()[1]!.text).not.toContain("09:13");
  });

  it("a clock stop that goes and comes back emails again, with the new stop's times", async () => {
    const d = duty();
    d.state.recipients = [BEN];
    d.state.notices = { notices: [clockStop(STOP)], unavailable: [] };
    await d.tick();
    d.state.notices = { notices: [], unavailable: [] };
    await d.tick();
    d.state.notices = {
      notices: [clockStop({ ...STOP, clockAt: "2025-03-14T08:13:00.000Z" })],
      unavailable: [],
    };
    await d.tick();
    expect(d.sent()).toHaveLength(2);
    expect(d.sent()[0]!.text).toContain("(14/03/2025 09:12)");
    expect(d.sent()[1]!.text).toContain("(14/03/2025 09:13)");
  });

  it("emails each manager once per open restart or wrongly dated alert, in their own language", async () => {
    const d = duty();
    d.state.incidents = [RESTART, MISDATED];
    await d.tick();
    await d.tick();
    expect(d.sent()).toEqual([
      clockEmail(RESTART, ANA),
      clockEmail(RESTART, BEN),
      clockEmail(MISDATED, ANA),
      clockEmail(MISDATED, BEN),
    ]);
    expect(d.sent()[1]!.text).toContain("confirmed by an administrator");
    expect(d.sent()[3]!.text).toContain("from 18/10/2026 21:05 to 26/10/2026 10:30");
    expect(d.events("box_email.sent")).toContainEqual([
      "info",
      "box_email.sent",
      { code: "clock.records_misdated" },
    ]);
  });

  it("emails each alert of one code on its own, once", async () => {
    const d = duty();
    d.state.recipients = [BEN];
    const second = { ...MISDATED, id: "i-misdated-2", params: { ...MISDATED.params, count: 4 } };
    d.state.incidents = [MISDATED];
    await d.tick();
    d.state.incidents = [MISDATED, second];
    await d.tick();
    await d.tick();
    expect(d.sent()).toEqual([clockEmail(MISDATED, BEN), clockEmail(second, BEN)]);
  });

  it("emails nothing for an alert handled before it was read, nor retries one handled after a failed send", async () => {
    const d = duty();
    d.state.recipients = [BEN];
    d.send.mockImplementationOnce(async () => "rejected");
    d.state.incidents = [RESTART];
    await d.tick();
    d.state.incidents = [];
    await d.tick();
    await d.tick();
    expect(d.sent()).toEqual([clockEmail(RESTART, BEN)]);
    expect(d.context).toHaveBeenCalledTimes(1);
  });

  it("tries a failed alert email again while the alert stays open", async () => {
    const d = duty();
    d.state.recipients = [BEN];
    d.send.mockImplementationOnce(async () => "unknown");
    d.state.incidents = [MISDATED];
    await d.tick();
    await d.tick();
    await d.tick();
    expect(d.sent()).toEqual([clockEmail(MISDATED, BEN), clockEmail(MISDATED, BEN)]);
  });

  it("keeps an alert's episode while the alert read fails, and sends nothing more", async () => {
    const d = duty();
    d.state.recipients = [BEN];
    d.state.incidents = [RESTART];
    await d.tick();
    d.emailedIncidents.mockRejectedValueOnce(new Error("busy"));
    await d.tick();
    await d.tick();
    expect(d.sent()).toEqual([clockEmail(RESTART, BEN)]);
    expect(d.events("box_email.check_failed")).toHaveLength(1);
  });

  it("stop during the alert read sends nothing", async () => {
    const d = duty();
    const read = held<readonly EmailedIncident[]>();
    d.emailedIncidents.mockImplementationOnce(() => read.promise);
    d.armed[0]!.fn();
    await vi.waitFor(() => expect(d.emailedIncidents).toHaveBeenCalled());
    const stopping = d.handle.stop();
    read.release([RESTART]);
    await stopping;
    await turn();
    expect(d.context).not.toHaveBeenCalled();
    expect(d.send).not.toHaveBeenCalled();
  });

  it("a node that is not the primary reads and sends nothing", async () => {
    const d = duty();
    d.state.primary = false;
    d.state.lowSince = at(1);
    await d.tick();
    await d.tick();
    expect(d.armed).toHaveLength(3);
    expect(d.context).not.toHaveBeenCalled();
    expect(d.moduleNotices).not.toHaveBeenCalled();
    expect(d.emailedIncidents).not.toHaveBeenCalled();
    expect(d.send).not.toHaveBeenCalled();
  });

  it("stop waits for a read in flight, and nothing is read or sent after it", async () => {
    const d = duty();
    const read = held<BoxEmailContext>();
    d.context.mockImplementationOnce(() => read.promise);
    d.state.lowSince = at(1);
    d.armed[0]!.fn();
    await vi.waitFor(() => expect(d.context).toHaveBeenCalled());
    const stopping = d.handle.stop();
    let settled = false;
    void stopping.then(() => (settled = true));
    await turn();
    await turn();
    expect(settled).toBe(false);
    read.release({ venue: VENUE, recipients: [ANA, BEN], delivery: { mode: "smtp", smtp: SMTP } });
    await stopping;
    await turn();
    await turn();
    expect(d.send).not.toHaveBeenCalled();
    expect(d.armed[0]!.cancelled).toBe(true);
    expect(d.armed).toHaveLength(1);
  });

  it("stop during a send sends to no one after it", async () => {
    const d = duty();
    const first = held<"sent">();
    d.send.mockImplementationOnce(() => first.promise);
    d.state.lowSince = at(1);
    d.armed[0]!.fn();
    await vi.waitFor(() => expect(d.send).toHaveBeenCalled());
    await d.handle.stop();
    first.release("sent");
    await turn();
    await turn();
    expect(d.send).toHaveBeenCalledTimes(1);
    expect(d.armed).toHaveLength(1);
  });

  it("logs each kind of failed send once per recipient, however the failures alternate", async () => {
    const d = duty();
    const anaOutcomes = [
      "rejected",
      "rejected",
      "rejected",
      "unknown",
      "rejected",
      "unknown",
      "rejected",
    ] as const;
    let anaCalls = 0;
    d.send.mockImplementation(async ({ recipient }) =>
      recipient === ANA.email ? (anaOutcomes[anaCalls++] ?? "sent") : "sent",
    );
    d.state.lowSince = at(1);
    for (let i = 0; i < anaOutcomes.length; i++) await d.tick();
    const failure = (outcome: string) => [
      "warn",
      "box_email.send_failed",
      { code: "storage.space_low", outcome },
    ];
    expect(d.events("box_email.send_failed")).toEqual([failure("rejected"), failure("unknown")]);
    await d.tick();
    expect(d.sent().filter((m) => m.recipient === ANA.email)).toHaveLength(8);
    expect(d.events("box_email.sent")).toHaveLength(2);
    expect(d.events("box_email.send_failed")).toHaveLength(2);
  });
});

const DELETED: EmailedIncident = {
  id: "i-deleted",
  code: "backup.archives_deleted",
  params: { count: 3, date: "2026-10-28" },
};

const REFUSED = {
  code: "backup.staging_space_low",
  at: "2026-10-28T03:00:00.000Z",
  sizes: { neededBytes: 6_300_000_000, availableBytes: 1_900_000_000 },
};

function refusedEmail(recipient: ManagerEmailRecipient, sizes = REFUSED.sizes) {
  return {
    recipient: recipient.email,
    ...boxEmailMessage("backup.run_stopped", recipient.language, VENUE, sizes),
  };
}

describe("startBoxEmailDuty for backups", () => {
  it("emails each manager once while old backups deleted stays open, in their own language", async () => {
    const d = duty();
    d.state.incidents = [DELETED];
    await d.tick();
    await d.tick();
    expect(d.sent()).toEqual([clockEmail(DELETED, ANA), clockEmail(DELETED, BEN)]);
    expect(d.sent()[1]!.text).toBe(
      "Low disk space: the box deleted its 3 oldest backups (28 Oct 2026).",
    );
  });

  it("tries a failed deletion email again while the alert stays open, and not once it is handled", async () => {
    const d = duty();
    d.state.recipients = [BEN];
    d.send.mockImplementationOnce(async () => "unknown");
    d.send.mockImplementationOnce(async () => "unknown");
    d.state.incidents = [DELETED];
    await d.tick();
    await d.tick();
    d.state.incidents = [];
    await d.tick();
    expect(d.sent()).toEqual([clockEmail(DELETED, BEN), clockEmail(DELETED, BEN)]);
  });

  it("emails each manager once per refusal for lack of room, with its sizes", async () => {
    const d = duty();
    d.state.backupStopped = REFUSED;
    await d.tick();
    await d.tick();
    expect(d.sent()).toEqual([refusedEmail(ANA), refusedEmail(BEN)]);
    expect(d.sent()[1]!.text).toBe(
      "Backup not made: it needs 6.3 GB free and the disk has 1.9 GB.",
    );
    expect(d.events("box_email.sent")).toContainEqual([
      "info",
      "box_email.sent",
      { code: "backup.run_stopped" },
    ]);
  });

  it("keeps the sizes of the first sighting while the refusal lasts", async () => {
    const d = duty();
    d.state.recipients = [BEN];
    d.send.mockImplementationOnce(async () => "unknown");
    d.state.backupStopped = REFUSED;
    await d.tick();
    d.state.backupStopped = {
      ...REFUSED,
      at: "2026-10-28T04:00:00.000Z",
      sizes: { neededBytes: 7_000_000_000, availableBytes: 1_000_000_000 },
    };
    await d.tick();
    expect(d.sent()).toEqual([refusedEmail(BEN), refusedEmail(BEN)]);
  });

  it("tries a failed refusal email at each check while the refusal lasts, and not once it clears", async () => {
    const d = duty();
    d.state.recipients = [BEN];
    d.send.mockImplementationOnce(async () => "unknown");
    d.send.mockImplementationOnce(async () => "rejected");
    d.state.backupStopped = REFUSED;
    await d.tick();
    await d.tick();
    d.state.backupStopped = undefined;
    await d.tick();
    await d.tick();
    expect(d.sent()).toEqual([refusedEmail(BEN), refusedEmail(BEN)]);
  });

  it("emails a refusal again after the backups ran and were refused once more", async () => {
    const d = duty();
    d.state.recipients = [BEN];
    d.state.backupStopped = REFUSED;
    await d.tick();
    d.state.backupStopped = undefined;
    await d.tick();
    d.state.backupStopped = REFUSED;
    await d.tick();
    expect(d.sent()).toEqual([refusedEmail(BEN), refusedEmail(BEN)]);
  });

  it("does not email a backup run that stopped on anything else", async () => {
    const d = duty();
    d.state.backupStopped = { code: "backup.recovery_key_missing", at: REFUSED.at };
    await d.tick();
    await d.tick();
    expect(d.send).not.toHaveBeenCalled();
    expect(d.context).not.toHaveBeenCalled();
  });
});
