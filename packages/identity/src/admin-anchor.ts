import "./errors.js";
import { AppError } from "@waitron/shared";
import type { PersonAuthority } from "./authority.js";

export function assertActorCovers(actor: PersonAuthority, target: PersonAuthority): void {
  if (
    (!actor.admin && target.admin) ||
    [...target.permissions].some((permission) => !actor.permissions.has(permission))
  )
    throw new AppError("person.holds_more", { personId: target.personId });
}
