import { link, lstat, rename, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { AppError, isAppError } from "@waitron/shared";
import type { ArchiveEntry } from "./backup-archive.js";
import { errnoOf } from "./errno.js";
import { syncFolderHolding } from "./fs-atomic.js";
import type { Logger } from "./logger.js";
import { unpackBundleToDir } from "./state-secrets.js";
import "./errors.js";

const SECRETS_PREFIX = "secrets/";
const TRADING_ENV_FILE = "trading.env";

export const STAGED_SECRET_SUFFIX = ".incoming";
/** A killed restore can leave `.incoming` and `.previous` files beside the secrets; the next
 * restore's staging and publish replace them. */
export const PREVIOUS_SECRET_SUFFIX = ".previous";

export interface StagedSecrets {
  /** Renames each staged file over its target, trading.env last, keeping a replaced one as
   * `<target>.previous`; on a failure, puts back what it renamed, removes the staged files, then
   * throws the failure. */
  publish(): Promise<void>;
  /** After publish: removes the `.previous` copies. Logs, never throws. */
  finish(): Promise<void>;
  /** Instead of publish: removes the staged files. Logs, never throws. */
  discard(): Promise<void>;
}

interface Secret {
  /** Relative to the state folder, posix: `tls/server.key`. */
  rel: string;
  entryName: string;
  contents: string;
}

/**
 * Writes every `secrets/` entry beside its target as `<target>.incoming`, durably and 0600, and
 * changes no target. A target that exists as a folder is refused `restore.unsafe_entry_path` before
 * any file is written; any other failure removes what was staged and is thrown.
 */
export async function stageSecrets(args: {
  entries: readonly ArchiveEntry[];
  stateDir: string;
  log: Logger;
}): Promise<StagedSecrets> {
  const { stateDir, log } = args;
  const secrets: Secret[] = args.entries.map((entry) => ({
    rel: entry.name.slice(SECRETS_PREFIX.length),
    entryName: entry.name,
    contents: Buffer.from(entry.bytes).toString("utf8"),
  }));
  secrets.sort((a, b) => Number(a.rel === TRADING_ENV_FILE) - Number(b.rel === TRADING_ENV_FILE));
  const target = (secret: Secret) => join(stateDir, secret.rel);
  const staged = (secret: Secret) => `${target(secret)}${STAGED_SECRET_SUFFIX}`;
  const previous = (secret: Secret) => `${target(secret)}${PREVIOUS_SECRET_SUFFIX}`;

  for (const secret of secrets) {
    if ((await lstatOrUndefined(target(secret)))?.isDirectory())
      throw new AppError("restore.unsafe_entry_path", { name: secret.entryName });
  }

  const removeStaged = (which: readonly Secret[]) =>
    removeEach(which, staged, log, "restore.secrets.incoming_kept");

  const written: Secret[] = [];
  for (const secret of secrets) {
    try {
      await unpackBundleToDir({ [secret.rel]: secret.contents }, stateDir, {
        durable: true,
        suffix: STAGED_SECRET_SUFFIX,
      });
    } catch (error) {
      // A path refusal wrote nothing for this entry, and its path may lead outside the state folder.
      await removeStaged(isAppError(error) ? written : [...written, secret]);
      throw error;
    }
    written.push(secret);
  }

  return {
    async publish() {
      const renamed: { secret: Secret; hadPrevious: boolean }[] = [];
      try {
        for (const secret of secrets) {
          const hadPrevious = await keepPrevious(target(secret), previous(secret));
          try {
            await rename(staged(secret), target(secret));
          } catch (error) {
            if (hadPrevious)
              await removeEach([secret], previous, log, "restore.secrets.previous_kept");
            throw error;
          }
          renamed.push({ secret, hadPrevious });
        }
        const synced = new Set<string>();
        for (const secret of secrets) {
          const folder = dirname(target(secret));
          if (synced.has(folder)) continue;
          synced.add(folder);
          await syncFolderHolding(target(secret));
        }
      } catch (error) {
        for (const { secret, hadPrevious } of renamed.reverse()) {
          try {
            if (hadPrevious) await rename(previous(secret), target(secret));
            else await rm(target(secret), { force: true });
          } catch (putBackError) {
            log("warn", "restore.secrets.put_back_failed", {
              file: secret.rel,
              errno: errnoOf(putBackError),
            });
          }
        }
        await removeStaged(secrets);
        throw error;
      }
      log("info", "restore.secrets.done", { count: secrets.length });
    },
    async finish() {
      await removeEach(secrets, previous, log, "restore.secrets.previous_kept");
    },
    async discard() {
      await removeStaged(secrets);
    },
  };
}

/** Links `target`'s current file as `previous`, so `target` is never absent while it is replaced.
 * False when there is no `target`. */
async function keepPrevious(target: string, previous: string): Promise<boolean> {
  await rm(previous, { force: true });
  try {
    await link(target, previous);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

async function removeEach(
  secrets: readonly Secret[],
  pathOf: (secret: Secret) => string,
  log: Logger,
  event: string,
): Promise<void> {
  for (const secret of secrets) {
    try {
      await rm(pathOf(secret), { force: true });
    } catch (error) {
      log("warn", event, { file: secret.rel, errno: errnoOf(error) });
    }
  }
}

async function lstatOrUndefined(path: string) {
  try {
    return await lstat(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}
