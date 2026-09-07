// Compile-time proof that @waitron/module's `ModuleRole` and @waitron/identity's `PersonRoleValue` are
// the SAME string-literal union. The tie lives here because composition is the one package that imports
// both — identity depends on the module CONTRACT, never the reverse, so neither package can name the
// other. `tsc --noEmit` (composition's typecheck) is the fail-first signal; there is no runtime.
//
// Bidirectional, unlike the old boot-call-site check: a role added to EITHER union but not the other
// breaks the direction that lost the literal — a module-side addition identity does not know, AND an
// identity-side addition `ModuleRole` still lags.
import type { ModuleRole } from "@waitron/module";
import type { PersonRoleValue } from "@waitron/identity";

// `Assignable<From, To>` only resolves when every member of `From` is a member of `To`; otherwise the
// `From extends To` constraint is violated and TypeScript errors on the reference below.
type Assignable<From extends To, To> = From;

export type ModuleRoleCoversPersonRole = Assignable<PersonRoleValue, ModuleRole>;
export type PersonRoleCoversModuleRole = Assignable<ModuleRole, PersonRoleValue>;
