import { codeOf } from "@waitron/server-kit";
import type { DiskFullState } from "./disk-full-state.js";
import type { EmailDelivery } from "./email-delivery.js";
import type { FreeSpaceState } from "./free-space-watch.js";
import { BOX_EMAIL_WORDS } from "./i18n/box-emails.js";
import type { Logger } from "./logger.js";
import type { ManagerEmailRecipient } from "./manager-email-recipients.js";
import type { StaffNoticesRead } from "./staff-notices.js";
import type { TextEmailOutcome, TextEmailSender } from "./text-email.js";
import { unrefTimer, type Timer } from "./unref-timer.js";

export type BoxEmailCode = keyof typeof BOX_EMAIL_WORDS;

/** The codes the duty reads from the stop and the warning; every other code from module notices. */
export const STORAGE_EMAIL_CODES = ["storage.space_low", "storage.disk_full"] as const;

export function isBoxEmailCode(code: string): code is BoxEmailCode {
  return Object.hasOwn(BOX_EMAIL_WORDS, code);
}

/** The subject and text for `code` in `language`, `{venue}` replaced by the venue's name. */
export function boxEmailMessage(
  code: BoxEmailCode,
  language: "en" | "es",
  venue: string,
): { subject: string; text: string } {
  const words = BOX_EMAIL_WORDS[code][language];
  // A function replacement, so a name such as "$&" is not read as a pattern.
  const named = (template: string) => template.replaceAll("{venue}", () => venue);
  return { subject: named(words.subject), text: named(words.text) };
}

export const BOX_EMAIL_CHECK_MS = 60_000;

export interface BoxEmailContext {
  readonly venue: string;
  readonly recipients: readonly ManagerEmailRecipient[];
  readonly delivery: EmailDelivery;
}

interface Episode {
  readonly code: BoxEmailCode;
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
  context: () => Promise<BoxEmailContext>;
  send: TextEmailSender;
  isPrimary: () => boolean;
  intervalMs: number;
  now: () => Date;
  log: Logger;
  timer?: (ms: number, fn: () => void) => Timer;
}): { stop: () => Promise<void> } {
  const timer = deps.timer ?? unrefTimer;
  const episodes = new Map<string, Episode>();
  let stopped = false;

  function want(key: string, code: BoxEmailCode, wanted: string[]): void {
    if (!episodes.has(key)) {
      episodes.set(key, { code, sentTo: new Set(), said: new Set(), logged: new Map() });
    }
    wanted.push(key);
  }

  function sayOnce(episode: Episode, event: string): void {
    if (episode.said.has(event)) return;
    episode.said.add(event);
    deps.log("warn", event, { code: episode.code });
  }

  async function deliver(episode: Episode, ctx: BoxEmailContext): Promise<void> {
    if (ctx.recipients.length === 0) return sayOnce(episode, "box_email.no_recipients");
    const pending = ctx.recipients.filter((r) => !episode.sentTo.has(recipientKey(r)));
    if (pending.length === 0) return;
    if (ctx.delivery.mode === "unconfigured") return sayOnce(episode, "box_email.not_configured");
    for (const recipient of pending) {
      if (stopped) return;
      let outcome: TextEmailOutcome;
      try {
        outcome = await deps.send({
          smtp: ctx.delivery.smtp,
          recipient: recipient.email,
          ...boxEmailMessage(episode.code, recipient.language, ctx.venue),
        });
      } catch {
        outcome = "unknown";
      }
      if (outcome === "sent") {
        episode.sentTo.add(recipientKey(recipient));
        deps.log("info", "box_email.sent", { code: episode.code });
      }
    }
  }

  async function check(): Promise<void> {
    try {
      if (stopped) return;
      const wanted: string[] = [];
      const full = deps.disk.since() !== null;
      const low = deps.space.current().lowSince !== null;
      if (!full && !low) {
        episodes.delete("storage.disk_full");
        episodes.delete("storage.space_low");
      } else {
        if (full) want("storage.disk_full", "storage.disk_full", wanted);
        // Once the stop has been emailed, a low disk around it is the same episode.
        if (low && !full && !episodes.has("storage.disk_full")) {
          want("storage.space_low", "storage.space_low", wanted);
        }
      }
      if (wanted.length === 0) return;
      // Read at every check while an episode lasts, so a manager added during it is found.
      const ctx = await deps.context();
      for (const key of wanted) {
        if (stopped) return;
        await deliver(episodes.get(key)!, ctx);
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
    },
  };
}
