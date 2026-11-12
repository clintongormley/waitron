import type { ModuleDefaultHolder } from "@waitron/module";
import type { DefaultHolder } from "@waitron/identity";

type Assignable<From extends To, To> = From;

export type ModuleHolderCoversIdentityHolder = Assignable<DefaultHolder, ModuleDefaultHolder>;
export type IdentityHolderCoversModuleHolder = Assignable<ModuleDefaultHolder, DefaultHolder>;
