import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import type { KeyRing } from "@waitron/credentials";
import { incidents, locations, type Database } from "@waitron/db";
import { codeOf } from "@waitron/server-kit";
import type { DiskFullState } from "./disk-full-state.js";
import { resolveEmailDeliveryIn, type EmailDelivery } from "./email-delivery.js";
import type { FreeSpaceState } from "./free-space-watch.js";
import {
  BOX_EMAIL_WORDS,
  CLOCK_CONFIRMED_BY_WORDS,
  CLOCK_MISDATED_EMAIL_WORDS,
  CLOCK_RESTARTED_EMAIL_WORDS,
} from "./i18n/box-emails.js";
import type { Logger } from "./logger.js";
import { receiptDateTimeNumeric } from "./receipt-dates.js";
import {
  readManagerEmailRecipients,
  type ManagerEmailRecipient,
} from "./manager-email-recipients.js";
import type { StaffNoticesRead } from "./staff-notices.js";
import type { TextEmailOutcome, TextEmailSender } from "./text-email.js";
import { unrefTimer, type Timer } from "./unref-timer.js";

export type BoxEmailCode = keyof typeof BOX_EMAIL_WORDS;

/** The codes the duty reads from the stop and the warning; every other code from module notices. */
export const STORAGE_EMAIL_CODES = ["storage.space_low", "storage.disk_full"] as const;

export function isBoxEmailCode(code: string): code is BoxEmailCode {
  return Object.hasOwn(BOX_EMAIL_WORDS, code);
}

/** The alerts the duty emails while they stay open, read from the incidents table. */
export const CLOCK_INCIDENT_EMAIL_CODES = [
  "clock.behind_chain_restarted",
  "clock.records_misdated",
] as const;

export type ClockIncidentEmailCode = (typeof CLOCK_INCIDENT_EMAIL_CODES)[number];

export interface ClockIncident {
  readonly id: string;
  readonly code: ClockIncidentEmailCode;
  readonly params: Readonly<Record<string, unknown>>;
}

/** Each time placeholder and the param holding the offset it is written in. */
const TIME_PLACEHOLDERS = {
  clockAt: "offsetMinutes",
  lastRecordAt: "lastRecordOffsetMinutes",
  from: "fromOffsetMinutes",
  to: "toOffsetMinutes",
} as const;

function wordsFor(
  code: BoxEmailCode | ClockIncidentEmailCode,
  language: "en" | "es",
  params?: Readonly<Record<string, unknown>>,
): { subject: string; text: string } {
  if (code === "clock.behind_chain_restarted") {
    const by = CLOCK_CONFIRMED_BY_WORDS[language];
    const source = params?.["confirmedBy"];
    const confirmedBy =
      typeof source === "string" && source !== "otherwise" && Object.hasOwn(by, source)
        ? by[source as keyof typeof by]
        : by.otherwise;
    const words = CLOCK_RESTARTED_EMAIL_WORDS[language];
    return {
      subject: words.subject,
      text: words.text.replaceAll("{confirmedBy}", () => confirmedBy),
    };
  }
  if (code === "clock.records_misdated") {
    const words = CLOCK_MISDATED_EMAIL_WORDS[language];
    if (params?.["unconfirmed"] === true) return words.unconfirmed;
    const count = params?.["count"];
    const main = count === 1 ? words.one : words.text.replaceAll("{count}", () => String(count));
    return {
      subject: words.subject,
      text: params?.["partial"] === true ? `${main} ${words.partial}` : main,
    };
  }
  return BOX_EMAIL_WORDS[code][language];
}

/** The subject and text for `code` in `language`, `{venue}` replaced by the venue's name and each
 * time placeholder by its param, written `dd/mm/yyyy hh:mm` in its own offset. */
export function boxEmailMessage(
  code: BoxEmailCode | ClockIncidentEmailCode,
  language: "en" | "es",
  venue: string,
  params?: Readonly<Record<string, unknown>>,
): { subject: string; text: string } {
  const words = wordsFor(code, language, params);
  const filled = (template: string) => {
    // A function replacement, so a name such as "$&" is not read as a pattern.
    let out = template.replaceAll("{venue}", () => venue);
    for (const [name, offsetName] of Object.entries(TIME_PLACEHOLDERS)) {
      const at = params?.[name];
      const offset = params?.[offsetName];
      if (typeof at !== "string" || typeof offset !== "number") continue;
      out = out.replaceAll(`{${name}}`, receiptDateTimeNumeric(at, "en-GB", offset));
    }
    return out;
  };
  return { subject: filled(words.subject), text: filled(words.text) };
}

/** The open alerts of `CLOCK_INCIDENT_EMAIL_CODES`, oldest first, read in one write-lock turn with
 * no change-log drain. */
export async function readOpenClockIncidents(db: Database): Promise<ClockIncident[]> {
  return db.withWriteLock(async () => {
    const rows = await db
      .select({ id: incidents.id, code: incidents.code, params: incidents.params })
      .from(incidents)
      .where(
        and(
          inArray(incidents.code, [...CLOCK_INCIDENT_EMAIL_CODES]),
          isNull(incidents.acknowledgedAt),
        ),
      )
      .orderBy(asc(incidents.detectedAt), asc(incidents.id));
    return rows.map((row) => ({ ...row, code: row.code as ClockIncidentEmailCode }));
  });
}

export const BOX_EMAIL_CHECK_MS = 60_000;

export interface BoxEmailContext {
  readonly venue: string;
  readonly recipients: readonly ManagerEmailRecipient[];
  readonly delivery: EmailDelivery;
}

/** Read in one write-lock turn with no change-log drain, so the reads answer on a full disk with a
 * change waiting. */
export async function readBoxEmailContext(
  db: Database,
  deps: {
    ring: KeyRing;
    practiceMode: boolean;
    locationId: string;
    venueLanguage: "en" | "es";
  },
): Promise<BoxEmailContext> {
  return db.withWriteLock(async () => {
    const [location] = await db
      .select({ name: locations.name })
      .from(locations)
      .where(eq(locations.id, deps.locationId));
    return {
      venue: location!.name,
      recipients: await readManagerEmailRecipients(db, deps.venueLanguage),
      delivery: await resolveEmailDeliveryIn(db, deps.ring, deps.practiceMode),
    };
  });
}

interface Episode {
  readonly code: BoxEmailCode | ClockIncidentEmailCode;
  /** The module that gave the notice; absent for the disk's episodes and the alerts'. */
  readonly owner?: string;
  /** Set for an open alert's episode, which lasts while the alert stays open. */
  readonly incident?: true;
  /** The params of the notice that began the episode, kept for its whole length. */
  readonly params?: Readonly<Record<string, unknown>>;
  readonly sentTo: Set<string>;
  readonly said: Set<string>;
  readonly logged: Map<string, Set<TextEmailOutcome>>;
}

function recipientKey(recipient: ManagerEmailRecipient): string {
  return recipient.email.trim().toLowerCase();
}

/** Checks every `intervalMs`, the first one `intervalMs` after start, each next one armed after the
 * last finished. `stop` resolves once a database read in flight has finished; nothing is read or
 * sent after it. */
export function startBoxEmailDuty(deps: {
  disk: Pick<DiskFullState, "since">;
  space: Pick<FreeSpaceState, "current">;
  /** The enabled modules' notices, read in turns. */
  moduleNotices: () => Promise<StaffNoticesRead>;
  clockIncidents: () => Promise<readonly ClockIncident[]>;
  context: () => Promise<BoxEmailContext>;
  send: TextEmailSender;
  isPrimary: () => boolean;
  intervalMs: number;
  log: Logger;
  timer?: (ms: number, fn: () => void) => Timer;
}): { stop: () => Promise<void> } {
  const timer = deps.timer ?? unrefTimer;
  const episodes = new Map<string, Episode>();
  let stopped = false;
  let reading: Promise<unknown> | null = null;

  /** Every read goes through here, so `stop` can wait for the one in flight. */
  async function read<T>(start: () => Promise<T>): Promise<T> {
    const pending = start();
    reading = pending;
    try {
      return await pending;
    } finally {
      reading = null;
    }
  }

  function begin(
    key: string,
    code: BoxEmailCode | ClockIncidentEmailCode,
    owner?: string,
    params?: Readonly<Record<string, unknown>>,
    incident?: true,
  ): Episode {
    let episode = episodes.get(key);
    if (episode === undefined) {
      episode = {
        code,
        ...(owner === undefined ? {} : { owner }),
        ...(incident === undefined ? {} : { incident }),
        ...(params === undefined ? {} : { params }),
        sentTo: new Set(),
        said: new Set(),
        logged: new Map(),
      };
      episodes.set(key, episode);
    }
    return episode;
  }

  function sayOnce(episode: Episode, event: string): void {
    if (episode.said.has(event)) return;
    episode.said.add(event);
    deps.log("warn", event, { code: episode.code });
  }

  async function deliver(
    episode: Episode,
    ctx: BoxEmailContext,
    toldAlready?: ReadonlySet<string>,
  ): Promise<void> {
    if (ctx.recipients.length === 0) return sayOnce(episode, "box_email.no_recipients");
    const pending = ctx.recipients.filter((r) => {
      const key = recipientKey(r);
      return !episode.sentTo.has(key) && !toldAlready?.has(key);
    });
    if (pending.length === 0) return;
    if (ctx.delivery.mode === "unconfigured") return sayOnce(episode, "box_email.not_configured");
    for (const recipient of pending) {
      if (stopped) return;
      let outcome: TextEmailOutcome;
      try {
        outcome = await deps.send({
          smtp: ctx.delivery.smtp,
          recipient: recipient.email,
          ...boxEmailMessage(episode.code, recipient.language, ctx.venue, episode.params),
        });
      } catch {
        outcome = "unknown";
      }
      const key = recipientKey(recipient);
      if (outcome === "sent") {
        episode.sentTo.add(key);
        deps.log("info", "box_email.sent", { code: episode.code });
        continue;
      }
      const logged = episode.logged.get(key) ?? new Set<TextEmailOutcome>();
      episode.logged.set(key, logged);
      if (logged.has(outcome)) continue;
      logged.add(outcome);
      deps.log("warn", "box_email.send_failed", { code: episode.code, outcome });
    }
  }

  async function check(): Promise<void> {
    try {
      if (stopped || !deps.isPrimary()) return;
      const due: { episode: Episode; toldAlready?: ReadonlySet<string> }[] = [];
      const full = deps.disk.since() !== null;
      const low = deps.space.current().lowSince !== null;
      if (!full && !low) {
        episodes.delete("storage.disk_full");
        episodes.delete("storage.space_low");
      } else if (full) {
        due.push({ episode: begin("storage.disk_full", "storage.disk_full") });
      } else {
        // One disk episode: a manager the full-disk email reached is not sent the low-space one.
        due.push({
          episode: begin("storage.space_low", "storage.space_low"),
          toldAlready: episodes.get("storage.disk_full")?.sentTo,
        });
      }
      const notices = await read(deps.moduleNotices);
      if (stopped) return;
      const moduleSeen = new Set<string>();
      for (const notice of notices.notices) {
        if (!isBoxEmailCode(notice.code)) continue;
        if ((STORAGE_EMAIL_CODES as readonly string[]).includes(notice.code)) continue;
        const key = `module:${notice.owner}:${notice.key}`;
        begin(key, notice.code, notice.owner, notice.params);
        moduleSeen.add(key);
      }
      const open = await read(deps.clockIncidents);
      if (stopped) return;
      const incidentSeen = new Set<string>();
      for (const incident of open) {
        const key = `incident:${incident.id}`;
        begin(key, incident.code, undefined, incident.params, true);
        incidentSeen.add(key);
      }
      for (const [key, episode] of episodes) {
        if (episode.incident) {
          // A handled alert is never open again, so its episode ends for good.
          if (incidentSeen.has(key)) due.push({ episode });
          else episodes.delete(key);
          continue;
        }
        if (episode.owner === undefined) continue;
        // While an owner's check fails, its episodes neither start nor end.
        if (moduleSeen.has(key) || notices.unavailable.includes(episode.owner)) {
          due.push({ episode });
        } else {
          episodes.delete(key);
        }
      }
      if (due.length === 0) return;
      // Read at every check while an episode lasts, so a manager added during it is found.
      const ctx = await read(deps.context);
      if (stopped) return;
      for (const { episode, toldAlready } of due) {
        if (stopped) return;
        await deliver(episode, ctx, toldAlready);
      }
    } catch (error) {
      deps.log("warn", "box_email.check_failed", { errorCode: codeOf(error) });
    } finally {
      if (!stopped) armed = timer(deps.intervalMs, () => void check());
    }
  }

  let armed = timer(deps.intervalMs, () => void check());

  return {
    stop: async () => {
      stopped = true;
      armed.cancel();
      await reading?.catch(() => undefined);
    },
  };
}
