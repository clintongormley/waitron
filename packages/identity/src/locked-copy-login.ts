import "./errors.js";
import {
  openText,
  openTextWithPurposeKeys,
  type KeyEntry,
  type KeyRing,
} from "@waitron/credentials";
import type { BackupQuery, BackupRow } from "@waitron/store";
import { AppError } from "@waitron/shared";
import { foldedLoginEmail } from "./manager-login.js";
import { hashPassword, verifyPassword } from "./verify-password.js";
import { verifyTotp } from "./totp.js";
import { recoveryHash } from "./mfa.js";
import { holdsInCopy } from "./authority.js";
import type { Permission } from "./permissions.js";

const DUMMY_PASSWORD_HASH = hashPassword("locked-copy-timing-dummy");

export async function checkLockedCopyLogin(
  query: BackupQuery,
  input: {
    email: string;
    password: string;
    totp?: string;
    recoveryCode?: string;
    totpPurposeKeys: readonly KeyEntry[];
  },
): Promise<{ personId: string; recoveryCodeId: string | null }> {
  let person: BackupRow | undefined;
  for await (const row of query.rows(
    "select id, status, password_hash, totp_secret from persons where email_folded = ?",
    [foldedLoginEmail(input.email)],
  ))
    person = row;
  const eligible = person?.status === "active" && typeof person.password_hash === "string";
  const matches = await verifyPassword(
    input.password,
    eligible ? String(person!.password_hash) : DUMMY_PASSWORD_HASH,
  );
  const refuse = () => {
    throw new AppError("password.invalid", {});
  };
  if (!eligible || !matches || typeof person?.totp_secret !== "string") refuse();
  const personId = String(person!.id);
  const secret = openTextWithPurposeKeys(
    input.totpPurposeKeys,
    "totp",
    String(person!.totp_secret),
  );
  let recoveryCodeId: string | null = null;
  if (!(input.totp !== undefined && secret !== null && verifyTotp(input.totp, secret.value))) {
    if (input.recoveryCode !== undefined) {
      for await (const row of query.rows(
        "select id from recovery_codes where person_id = ? and code_hash = ? and used_at is null",
        [personId, recoveryHash(input.recoveryCode)],
      ))
        recoveryCodeId = String(row.id);
    }
    if (recoveryCodeId === null) refuse();
  }
  if (!(await holdsInCopy(query, personId, "node.manage")))
    throw new AppError("authorization.not_permitted", { permission: "node.manage" });
  return { personId, recoveryCodeId };
}

/**
 * A password sign-in judged entirely by reading `query`: no session, no recovery code (using one
 * marks it), so a box that writes nothing to its database can still let someone in. Refusals answer
 * as `loginManager`'s do; the cause is only the log-only `reason`.
 */
export async function checkPasswordInCopy(
  query: BackupQuery,
  input: { email: string; password: string; totp?: string },
  options: { permission: Permission; totpKeyRing: KeyRing },
): Promise<{ personId: string }> {
  let person: BackupRow | undefined;
  for await (const row of query.rows(
    "select id, status, password_hash, totp_secret from persons where email_folded = ?",
    [foldedLoginEmail(input.email)],
  ))
    person = row;
  if (person?.status !== "active" || typeof person.password_hash !== "string") {
    await verifyPassword(input.password, DUMMY_PASSWORD_HASH);
    const reason =
      person === undefined
        ? "unknown_account"
        : person.status === "active"
          ? "no_password"
          : String(person.status);
    throw new AppError("password.invalid", {}, { reason });
  }
  if (!(await verifyPassword(input.password, person.password_hash)))
    throw new AppError("password.invalid", {}, { reason: "wrong_password" });
  if (typeof person.totp_secret === "string") {
    if (input.totp === undefined)
      throw new AppError("totp.required", {}, { reason: "missing_code" });
    const secret = openText(options.totpKeyRing, "totp", person.totp_secret);
    if (secret === null)
      throw new AppError("password.invalid", {}, { reason: "unreadable_secret" });
    if (!verifyTotp(input.totp, secret.value))
      throw new AppError("password.invalid", {}, { reason: "wrong_code" });
  }
  const personId = String(person.id);
  if (!(await holdsInCopy(query, personId, options.permission)))
    throw new AppError("authorization.not_permitted", { permission: options.permission });
  return { personId };
}
