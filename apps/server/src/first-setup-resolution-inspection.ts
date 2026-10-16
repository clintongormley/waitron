import { constants } from "node:fs";
import { lstat, open, readdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import { basename, dirname, join } from "node:path";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { AppError } from "@waitron/shared";
import type { SQLWrapper } from "drizzle-orm";
import { SQLiteSyncDialect } from "drizzle-orm/sqlite-core";
import { lockVenueDatabase, type Database } from "@waitron/db";
import {
  assertFirstSetupBootTarget,
  firstSetupAnchorFor,
  readOperationalVenueIds,
  readTenantIdentities,
  type FirstSetupStore,
} from "@waitron/provisioning";
export interface FirstSetupRoots {
  stateDir: string;
  venueDir: string;
}
type Status = "missing" | "present" | "invalid" | "unreadable";
export interface FirstSetupArtifact {
  name: string;
  status: Status;
  digest?: string;
}
export interface FirstSetupInspection {
  version: 2;
  inspectionId: string;
  pair: "missing" | "partial" | "invalid" | "valid" | "repairable";
  database:
    "missing" | "unreadable" | "corrupt" | "partial" | "unknown" | "no-venue-rows" | "occupied";
  password: "checkable" | "uncheckable";
  revision: number | null;
  ownerGeneration: number | null;
  repairEligible: boolean;
  artifacts: FirstSetupArtifact[];
}
const digest = (bytes: Uint8Array | string) => createHash("sha256").update(bytes).digest("hex");
const missing = (error: unknown) =>
  typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
async function artifact(
  root: string,
  name: string,
  limit = 1024 * 1024,
  json = true,
): Promise<FirstSetupArtifact> {
  let handle;
  try {
    const parent = await lstat(root);
    if (!parent.isDirectory() || parent.isSymbolicLink()) return { name, status: "unreadable" };
    handle = await open(
      join(root, name),
      constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
    );
    const info = await handle.stat();
    if (!info.isFile() || info.size > limit) return { name, status: "unreadable" };
    const bytes = await handle.readFile();
    if (bytes.length > limit) return { name, status: "unreadable" };
    const value = { name, digest: digest(bytes) };
    if (json) {
      try {
        const parsed: unknown = JSON.parse(bytes.toString("utf8"));
        if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed))
          return { ...value, status: "invalid" };
      } catch {
        return { ...value, status: "invalid" };
      }
    }
    return { ...value, status: "present" };
  } catch (error) {
    return { name, status: missing(error) ? "missing" : "unreadable" };
  } finally {
    await handle?.close();
  }
}
async function inspectDatabase(
  roots: FirstSetupRoots,
  file: FirstSetupArtifact,
): Promise<FirstSetupInspection["database"]> {
  if (file.status === "missing") return "missing";
  if (file.status !== "present") return "unreadable";
  let connection: DatabaseSync | undefined;
  try {
    connection = new DatabaseSync(join(roots.venueDir, "venue.db"), { readOnly: true });
    const dialect = new SQLiteSyncDialect();
    const target: Pick<Database, "execute"> = {
      execute<Row extends Record<string, unknown>>(query: SQLWrapper | string) {
        const compiled =
          typeof query === "string"
            ? { sql: query, params: [] }
            : dialect.sqlToQuery(query.getSQL());
        return {
          rows: connection!
            .prepare(compiled.sql)
            .all(...(compiled.params as SQLInputValue[])) as Row[],
        };
      },
    };
    const tenants = await readTenantIdentities(target);
    const locations = await readOperationalVenueIds(target);
    return tenants.length === 0 && locations.length === 0 ? "no-venue-rows" : "occupied";
  } catch (error) {
    if (error instanceof Error && /no such table/.test(error.message)) return "partial";
    if (
      typeof error === "object" &&
      error !== null &&
      "errcode" in error &&
      [11, 26].includes(Number(error.errcode))
    )
      return "corrupt";
    return "unknown";
  } finally {
    connection?.close();
  }
}
export function createFirstSetupResolutionInspection(
  options: FirstSetupRoots & {
    store: FirstSetupStore;
    publicEvidencePaths?: readonly string[];
    publicEvidenceDirectories?: readonly string[];
  },
) {
  const service = {
    async captureFirstSetupOriginals() {
      const inspection = await service.inspectFirstSetupResolution();
      const originals: { name: string; bytes: Buffer | null }[] = [];
      const capture = async (path: string, name: string, limit = 128 * 1024 * 1024) => {
        let file;
        try {
          file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
          const info = await file.stat();
          if (!info.isFile() || info.size > limit) throw new AppError("setup.not_ready", {});
          const bytes = await file.readFile();
          if (bytes.length > limit) throw new AppError("setup.not_ready", {});
          originals.push({ name, bytes });
        } catch (error) {
          if (!missing(error)) throw error;
          originals.push({ name, bytes: null });
        } finally {
          await file?.close();
        }
      };
      for (const file of inspection.artifacts) {
        if (file.name.startsWith("outside-") || file.name === "first-fiscal-documents") continue;
        const venue = ["first-setup-claim.json", "venue.db", "venue.db-wal"].includes(file.name);
        await capture(
          join(venue ? options.venueDir : options.stateDir, file.name),
          `${venue ? "venue" : "state"}/${file.name}`,
        );
      }
      const directory = async (path: string, name: string, fileName: (name: string) => string) => {
        try {
          const info = await lstat(path);
          if (!info.isDirectory() || info.isSymbolicLink())
            throw new AppError("setup.not_ready", {});
          const names = (await readdir(path)).sort();
          if (names.length > 1024) throw new AppError("setup.not_ready", {});
          originals.push({ name, bytes: Buffer.from(JSON.stringify(names)) });
          for (const item of names) {
            const label = fileName(item);
            if (!originals.some((original) => original.name === label))
              await capture(join(path, item), label, 8 * 1024 * 1024);
          }
        } catch (error) {
          if (!missing(error)) throw error;
          originals.push({ name, bytes: null });
        }
      };
      await directory(
        join(options.stateDir, "first-fiscal-documents"),
        "directory:state/first-fiscal-documents",
        (name) => `state/first-fiscal-documents/${name}`,
      );
      for (const path of options.publicEvidencePaths ?? [])
        await capture(path, `outside-file:${path}`, 8 * 1024 * 1024);
      for (const path of options.publicEvidenceDirectories ?? [])
        await directory(
          path,
          `directory:outside:${path}`,
          (name) => `outside-file:${join(path, name)}`,
        );
      if ((await service.inspectFirstSetupResolution()).inspectionId !== inspection.inspectionId)
        throw new AppError("setup.attempt_conflict", {});
      return { inspection, originals };
    },
    async withVenueExclusion<T>(body: () => Promise<T>): Promise<T> {
      const anchor = await firstSetupAnchorFor(options);
      const hold = await lockVenueDatabase(anchor.venueDir);
      let target: Awaited<ReturnType<typeof lockVenueDatabase>> | undefined;
      try {
        await assertFirstSetupBootTarget(options);
        if (anchor.venueDir !== options.venueDir)
          target = await lockVenueDatabase(options.venueDir);
        await assertFirstSetupBootTarget(options);
        return await body();
      } finally {
        target?.release();
        hold.release();
      }
    },
    async inspectFirstSetupResolution(): Promise<FirstSetupInspection> {
      const artifacts: FirstSetupArtifact[] = [];
      for (const name of [
        "first-setup.json",
        "module-operation-public.json",
        "first-setup-node-key.json",
        "setup-operation.json",
        "restore-request.json",
        "reset-request.json",
        "modules.json",
        "cloud-replacement.json",
      ])
        artifacts.push(await artifact(options.stateDir, name));
      artifacts.push(await artifact(options.stateDir, "trading.env", 65536, false));
      artifacts.push(await artifact(options.venueDir, "first-setup-claim.json", 16384));
      for (const name of ["venue.db", "venue.db-wal"])
        artifacts.push(await artifact(options.venueDir, name, 128 * 1024 * 1024, false));
      const documents = join(options.stateDir, "first-fiscal-documents");
      try {
        const directory = await lstat(documents);
        if (!directory.isDirectory() || directory.isSymbolicLink())
          artifacts.push({ name: "first-fiscal-documents", status: "unreadable" });
        else {
          artifacts.push({ name: "first-fiscal-documents", status: "present" });
          const names = await readdir(documents);
          if (names.length > 1024)
            artifacts.push({ name: "first-fiscal-documents", status: "unreadable" });
          else
            for (const name of names.sort()) {
              const file = await artifact(documents, name, 48000);
              artifacts.push({ ...file, name: `first-fiscal-documents/${name}` });
            }
        }
      } catch (error) {
        if (!missing(error))
          artifacts.push({ name: "first-fiscal-documents", status: "unreadable" });
      }
      for (const [index, path] of (options.publicEvidencePaths ?? []).entries()) {
        const file = await artifact(dirname(path), basename(path), 8 * 1024 * 1024);
        artifacts.push({ ...file, name: `outside-evidence-${index}` });
      }
      for (const [index, directory] of (options.publicEvidenceDirectories ?? []).entries()) {
        const label = `outside-receipts-${index}`;
        try {
          const info = await lstat(directory);
          if (!info.isDirectory() || info.isSymbolicLink())
            artifacts.push({ name: label, status: "unreadable" });
          else {
            const names = await readdir(directory);
            if (names.length > 1024) artifacts.push({ name: label, status: "unreadable" });
            else {
              artifacts.push({ name: label, status: "present" });
              for (const name of names.sort()) {
                const file = await artifact(directory, name, 8 * 1024 * 1024);
                artifacts.push({ ...file, name: `${label}/${digest(name)}` });
              }
            }
          }
        } catch (error) {
          artifacts.push({ name: label, status: missing(error) ? "missing" : "unreadable" });
        }
      }
      const stateFile = artifacts.find((a) => a.name === "first-setup.json")!;
      const marker = artifacts.find((a) => a.name === "first-setup-claim.json")!;
      let pair: FirstSetupInspection["pair"],
        repair = null;
      try {
        repair = await options.store.readForRepair();
        pair = repair === null ? "missing" : repair.repairMarker === null ? "valid" : "repairable";
      } catch {
        pair =
          stateFile.status === "missing" || marker.status === "missing" ? "partial" : "invalid";
      }
      const database = await inspectDatabase(
        options,
        artifacts.find((a) => a.name === "venue.db")!,
      );
      const noOtherEvidence = artifacts.every(
        (a) =>
          ["first-setup.json", "first-setup-claim.json", "venue.db", "venue.db-wal"].includes(
            a.name,
          ) ||
          (!a.name.startsWith("outside-") && a.status === "missing"),
      );
      const result = {
        version: 2 as const,
        pair,
        database,
        password: repair === null ? ("uncheckable" as const) : ("checkable" as const),
        revision: repair?.state.revision ?? null,
        ownerGeneration: repair?.state.ownerGeneration ?? null,
        repairEligible: pair === "repairable" && database === "no-venue-rows" && noOtherEvidence,
        artifacts,
      };
      return {
        ...result,
        inspectionId: digest(
          JSON.stringify([
            result,
            options.publicEvidencePaths ?? [],
            options.publicEvidenceDirectories ?? [],
          ]),
        ),
      };
    },
  };
  return service;
}
