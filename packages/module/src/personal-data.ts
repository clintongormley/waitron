import { AppError } from "@waitron/shared";
import type { Transaction } from "@waitron/db";
import type { WaitronModule } from "./module.js";
import "./errors.js";

export interface PersonalDataSubject {
  readonly personId: string;
  /** The README's language; a part that writes text uses it. */
  readonly language: "en" | "es";
  /** The moment of the request, from the box's clock. */
  readonly at: Date;
  /** The venue's IANA time zone, or "UTC" when it cannot be read. */
  readonly timeZone: string;
  /** This node's location, or null when this node has no row. */
  readonly locationId: string | null;
}
export interface PersonalDataFile {
  /** A name this part declared in `files`. */
  readonly name: string;
  readonly content: string | Uint8Array;
}
export interface ModulePersonalData {
  /** Every file name this part may add; unique across all parts. */
  readonly files: readonly string[];
  /** Reads everything this part holds about the person, inside the caller's transaction, and
   * returns a function that builds the files once that transaction has closed. The returned
   * function must not use `tx`. */
  prepare(
    tx: Transaction,
    subject: PersonalDataSubject,
  ): Promise<() => Promise<readonly PersonalDataFile[]>>;
}
/** A part and who contributed it, for error messages: a module's name, or "server". */
export interface PersonalDataPart {
  readonly owner: string;
  readonly part: ModulePersonalData;
}

/** Lower-case ASCII only, so no name can collide with a `README.txt` the server adds and none
 * needs the ZIP's UTF-8 flag. */
const FILE_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*\.(?:json|csv|pdf)$/;

/** Give it the enabled set: a disabled module's tables are not migrated. */
export function personalDataParts(modules: readonly WaitronModule[]): PersonalDataPart[] {
  return modules.flatMap((m) =>
    m.personalData === undefined ? [] : [{ owner: m.name, part: m.personalData }],
  );
}

export function validatePersonalDataParts(parts: readonly PersonalDataPart[]): void {
  const seen = new Map<string, string>();
  for (const { owner, part } of parts) {
    for (const name of part.files) {
      if (!FILE_NAME.test(name))
        throw new AppError("module.config_invalid", {
          reason: `personal-data file name "${name}" from ${owner} is not allowed`,
        });
      const earlier = seen.get(name);
      if (earlier !== undefined)
        throw new AppError("module.config_invalid", {
          reason:
            earlier === owner
              ? `personal-data file name "${name}" is declared twice by ${owner}`
              : `personal-data file name "${name}" is declared by both ${earlier} and ${owner}`,
        });
      seen.set(name, owner);
    }
  }
}

export async function preparePersonalData(
  tx: Transaction,
  parts: readonly PersonalDataPart[],
  subject: PersonalDataSubject,
): Promise<() => Promise<PersonalDataFile[]>> {
  validatePersonalDataParts(parts);
  const builders: {
    owner: string;
    files: ReadonlySet<string>;
    build: () => Promise<readonly PersonalDataFile[]>;
  }[] = [];
  for (const { owner, part } of parts) {
    // In turn, never Promise.all: queries on one transaction are awaited one after another.
    builders.push({ owner, files: new Set(part.files), build: await part.prepare(tx, subject) });
  }
  return async () => {
    const files: PersonalDataFile[] = [];
    const built = new Set<string>();
    for (const { owner, files: declared, build } of builders) {
      for (const file of await build()) {
        if (!declared.has(file.name))
          throw new Error(`${owner} built personal-data file "${file.name}" it did not declare`);
        if (built.has(file.name))
          throw new Error(`personal-data file "${file.name}" was built twice`);
        built.add(file.name);
        files.push(file);
      }
    }
    return files;
  };
}
