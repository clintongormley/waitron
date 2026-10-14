import "./errors.js";
import { createHash, randomUUID } from "node:crypto";
import { basename } from "node:path";
import { open, rename, rm, type FileHandle } from "node:fs/promises";
import { isDeepStrictEqual } from "node:util";
import { AppError, isUuid } from "@waitron/shared";

interface Attempt {
  readonly id: string;
  readonly startedAt: string;
  readonly finishedAt: string | null;
  readonly outcome: "started" | "returned" | "threw";
}

function refuse(): never {
  throw new AppError("sif.allocation_invalid", { reason: "outside_confirmation_missing" });
}

function isAttempt(value: unknown): value is Attempt {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return (
    Reflect.ownKeys(record).length === 4 &&
    typeof record.id === "string" &&
    isUuid(record.id) &&
    typeof record.startedAt === "string" &&
    !Number.isNaN(Date.parse(record.startedAt)) &&
    ((record.outcome === "started" && record.finishedAt === null) ||
      ((record.outcome === "returned" || record.outcome === "threw") &&
        typeof record.finishedAt === "string" &&
        !Number.isNaN(Date.parse(record.finishedAt))))
  );
}

async function update(
  directory: string,
  path: string,
  consumption: Readonly<Record<string, unknown>>,
  transform: (attempts: readonly Attempt[]) => readonly Attempt[],
): Promise<void> {
  let lock: FileHandle | undefined;
  let file: FileHandle | undefined;
  let next: FileHandle | undefined;
  let parent: FileHandle | undefined;
  let printable: FileHandle | undefined;
  let ownsPrintable = false;
  let ownsNext = false;
  try {
    // A crash may leave this event locked. A fresh event spends a fresh identity instead.
    lock = await open(`${path}.lock`, "wx", 0o600);
    file = await open(path, "r");
    if (!(await file.stat()).isFile()) refuse();
    const buffer = Buffer.alloc(65537);
    let count = 0;
    while (count < buffer.length) {
      const { bytesRead } = await file.read(buffer, count, buffer.length - count, null);
      if (bytesRead === 0) break;
      count += bytesRead;
    }
    if (count > 65536) refuse();
    const current = JSON.parse(buffer.subarray(0, count).toString("utf8")) as Record<
      string,
      unknown
    >;
    if (
      typeof current !== "object" ||
      current === null ||
      Reflect.ownKeys(current).length !== Object.keys(consumption).length + 1 ||
      !Object.entries(consumption).every(([key, value]) =>
        isDeepStrictEqual(current[key], value),
      ) ||
      !Array.isArray(current.attempts) ||
      !current.attempts.every(isAttempt) ||
      new Set(current.attempts.map((attempt) => attempt.id)).size !== current.attempts.length
    )
      refuse();
    const text = JSON.stringify({ ...consumption, attempts: transform(current.attempts) });
    if (Buffer.byteLength(text) > 65536) refuse();
    parent = await open(directory, "r");
    next = await open(`${path}.next`, "wx", 0o600);
    ownsNext = true;
    await next.writeFile(text);
    await next.sync();
    await rename(`${path}.next`, path);
    ownsNext = false;
    const handover = `Emergency recovery / Recuperación de emergencia

Keep this record outside the box and its backups.
Guarda este registro fuera del equipo y sus copias de seguridad.

An interrupted attempt never releases this identity. Check the current outside record and the exact local result before retrying.
Una interrupción no libera esta identidad. Antes de reintentar, comprueba el registro externo actual y el resultado local exacto.

Check the local activation separately from this attempt result.
Comprueba la activación local aparte del resultado de este intento.

Compare the SHA-256 below with the JSON file before using this copy; a crash may leave this printout out of date.
Compara el SHA-256 siguiente con el archivo JSON antes de usar esta copia; una interrupción puede dejarla desactualizada.

${basename(path)}
SHA-256: ${createHash("sha256").update(text).digest("hex")}

${JSON.stringify(JSON.parse(text), null, 2)}
`;
    printable = await open(`${path}.txt.next`, "wx", 0o600);
    ownsPrintable = true;
    await printable.writeFile(handover);
    await printable.sync();
    await rename(`${path}.txt.next`, `${path}.txt`);
    ownsPrintable = false;
    await parent.sync();
  } catch {
    refuse();
  } finally {
    await file?.close();
    await next?.close();
    await parent?.close();
    await printable?.close();
    if (ownsPrintable) await rm(`${path}.txt.next`);
    if (ownsNext) await rm(`${path}.next`);
    if (lock !== undefined) {
      await lock.close();
      await rm(`${path}.lock`);
    }
  }
}

export async function withEmergencyAttempt<T>(
  directory: string,
  path: string,
  consumption: Readonly<Record<string, unknown>>,
  run: () => Promise<T>,
): Promise<T> {
  const attempt: Attempt = {
    id: randomUUID(),
    startedAt: new Date().toISOString(),
    finishedAt: null,
    outcome: "started",
  };
  await update(directory, path, consumption, (attempts) => [...attempts, attempt]);
  const finish = (outcome: "returned" | "threw") =>
    update(directory, path, consumption, (attempts) => {
      const held = attempts.find((entry) => entry.id === attempt.id);
      if (held === undefined || !isDeepStrictEqual(held, attempt)) refuse();
      return attempts.map((entry) =>
        entry.id === attempt.id
          ? { ...entry, finishedAt: new Date().toISOString(), outcome }
          : entry,
      );
    });
  let result: T;
  try {
    result = await run();
  } catch (error) {
    await finish("threw");
    throw error;
  }
  await finish("returned");
  return result;
}
