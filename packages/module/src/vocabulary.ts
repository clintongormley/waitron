import { packageDirOf, type WaitronModule } from "./module.js";

/** A module that declares a `vocabulary` seat, resolved to the package that owns those terms. */
export interface VocabularyOwner {
  /** The descriptor's name — the SLOT for a swappable module (`fiscal`), not the package. */
  readonly module: string;
  /** `packages/<packageDir>`, derived from `migrations.from` (`packageDirOf`). */
  readonly packageDir: string;
  readonly terms: readonly string[];
}

/**
 * Every module declaring a `vocabulary` seat, in list order. An empty declaration is returned as
 * an owner with no terms so a guard can reject it by name (the seat's contract: omit the seat
 * rather than declare `[]`).
 */
export function vocabularyOwners(modules: readonly WaitronModule[]): VocabularyOwner[] {
  const owners: VocabularyOwner[] = [];
  for (const module of modules) {
    if (module.vocabulary === undefined) continue;
    owners.push({
      module: module.name,
      packageDir: packageDirOf(module),
      terms: module.vocabulary,
    });
  }
  return owners;
}

/**
 * The forbidden set a vocabulary guard scans generic packages for: `base` ∪ every module's
 * declared terms. Returns a new set; `base` is untouched.
 */
export function forbiddenVocabulary(
  base: ReadonlySet<string>,
  modules: readonly WaitronModule[],
): Set<string> {
  const words = new Set(base);
  for (const owner of vocabularyOwners(modules)) {
    for (const term of owner.terms) words.add(term);
  }
  return words;
}
