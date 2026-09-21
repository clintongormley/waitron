/**
 * The SQLSTATE codes this repository's write paths translate.
 *
 * One home, because the alternative is what the tree carried: the same strings re-declared in each
 * file that reads a refusal, with no way to tell a typo from a deliberate difference. A code is a
 * value PostgreSQL defines, so these are quotations rather than choices — never rename one.
 */
export const UNIQUE_VIOLATION = "23505";
export const FOREIGN_KEY_VIOLATION = "23503";
/**
 * A delete or update refused by an `ON DELETE RESTRICT` foreign key. NOT `23503`, which is the other
 * direction: a written value naming no parent row.
 */
export const RESTRICT_VIOLATION = "23001";
export const CHECK_VIOLATION = "23514";
