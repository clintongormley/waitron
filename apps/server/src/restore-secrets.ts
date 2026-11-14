import { INCOMING_SUFFIX as STAGED_SECRET_SUFFIX, TRADING_ENV_FILE } from "@waitron/store";

import { rename, rm, stat } from "node:fs/promises";
import { dirname, join } from "node:path";
import { AppError, isAppError } from "@waitron/shared";
import type { ArchiveEntry } from "./backup-archive.js";
import { errnoOf } from "./errno.js";
import { stagedPath, syncFolderHolding } from "./fs-atomic.js";
import type { Logger } from "./logger.js";
import { unpackStateFiles } from "./state-secrets.js";
import "./errors.js";

const SECRETS_PREFIX = "secrets/";

export { INCOMING_SUFFIX as STAGED_SECRET_SUFFIX } from "@waitron/store";
/** A killed restore can leave `.incoming`, `.incoming.tmp` and
 * `.restore-previous` files beside the secrets. One killed while publishing can leave a target
 * missing, with the box's old file as `.restore-previous` and the backup's as `.incoming`. The next
 * restore replaces only those of the names its own archive carries, so a `tls/*.restore-previous`
 * copy of an old private key can survive. */
export const PREVIOUS_SECRET_SUFFIX = ".restore-previous";
/** The set-aside identity's name, `trading.env.replaced`, in `restore.ts`. */
const REPLACED_IDENTITY_SUFFIX = ".replaced";

/** A secret named with one of these could be written over another secret's working file, or over
 * the set-aside identity. Lower case: a case-insensitive filesystem treats `.INCOMING` as the same. */
const WORKING_FILE_SUFFIXES = [
  STAGED_SECRET_SUFFIX,
  PREVIOUS_SECRET_SUFFIX,
  stagedPath(""),
  REPLACED_IDENTITY_SUFFIX,
];

export interface StagedSecrets {
  /** Renames each staged file over its target, trading.env last, setting a replaced one aside as
   * `<target>.restore-previous`; on a failure, puts back what it renamed, removes the staged
   * files, then throws the failure. */
  publish(): Promise<void>;
  /** After publish: removes the `.restore-previous` copies. Logs, never throws. */
  finish(): Promise<void>;
  /** Instead of publish: removes the staged files. Logs, never throws. */
  discard(): Promise<void>;
}

interface Secret {
  /** Relative to the state folder, posix: `tls/server.pem`. */
  rel: string;
  entryName: string;
  contents: string;
}

/**
 * Writes every `secrets/` entry beside its target as `<target>.incoming`, durably and 0600, and
 * changes no target. A target that exists as a folder, or a name ending in one of a restore's own
 * working-file suffixes, is refused `restore.unsafe_entry_path` before any file is written; any
 * other failure removes what was staged and is thrown.
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
  const identity = secrets.find((secret) => secret.rel === TRADING_ENV_FILE);
  const others = secrets.filter((secret) => secret !== identity);
  const target = (secret: Secret) => join(stateDir, secret.rel);
  const staged = (secret: Secret) => `${target(secret)}${STAGED_SECRET_SUFFIX}`;
  const previous = (secret: Secret) => `${target(secret)}${PREVIOUS_SECRET_SUFFIX}`;

  for (const secret of secrets) {
    const name = secret.rel.toLowerCase();
    if (WORKING_FILE_SUFFIXES.some((suffix) => name.endsWith(suffix)))
      throw new AppError("restore.unsafe_entry_path", { name: secret.entryName });
  }
  for (const secret of secrets) {
    if ((await statOrUndefined(target(secret)))?.isDirectory())
      throw new AppError("restore.unsafe_entry_path", { name: secret.entryName });
  }

  const removeStaged = (which: readonly Secret[]) =>
    removeEach(which, staged, log, "restore.secrets.incoming_kept");

  const written: Secret[] = [];
  for (const secret of secrets) {
    try {
      await unpackStateFiles({ [secret.rel]: secret.contents }, stateDir, {
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

  /** Syncs each folder holding one of `which` once; a failure is thrown unless `onFailure` takes it. */
  const syncFolders = async (
    which: readonly Secret[],
    onFailure?: (secret: Secret, error: unknown) => void,
  ) => {
    const synced = new Set<string>();
    for (const secret of which) {
      const folder = dirname(target(secret));
      if (synced.has(folder)) continue;
      synced.add(folder);
      try {
        await syncFolderHolding(target(secret));
      } catch (error) {
        if (onFailure === undefined) throw error;
        onFailure(secret, error);
      }
    }
  };

  return {
    async publish() {
      const replaced: { secret: Secret; setAside: boolean }[] = [];
      const place = async (secret: Secret) => {
        const setAside = await setAsidePrevious(target(secret), previous(secret));
        replaced.push({ secret, setAside });
        await rename(staged(secret), target(secret));
      };
      try {
        for (const secret of others) await place(secret);
        // On disk as well as in program order: the identity is never in place without the rest.
        await syncFolders(others);
        if (identity !== undefined) {
          await place(identity);
          await syncFolders([identity]);
        }
      } catch (error) {
        const putBackFailed = (secret: Secret, putBackError: unknown) =>
          log("warn", "restore.secrets.put_back_failed", {
            file: secret.rel,
            errno: errnoOf(putBackError),
          });
        const putBack = [...replaced].reverse();
        for (const { secret, setAside } of putBack) {
          try {
            if (setAside) await rename(previous(secret), target(secret));
            else await rm(target(secret), { force: true });
          } catch (putBackError) {
            putBackFailed(secret, putBackError);
          }
        }
        await syncFolders(
          putBack.map(({ secret }) => secret),
          putBackFailed,
        );
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

/** Renames `target`'s current file to `previous`, replacing any `previous` a killed restore left.
 * False when there is no `target`. */
async function setAsidePrevious(target: string, previous: string): Promise<boolean> {
  try {
    await rename(target, previous);
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

/** Follows a link, so a link to a folder counts as a folder. */
async function statOrUndefined(path: string) {
  try {
    return await stat(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}
