/**
 * Tenant-scoped tables that have been RENAMED or DROPPED, so an older backup
 * naming them can still be read.
 *
 * THE CONTRACT: a migration that renames or drops a tenant-scoped table MUST add
 * an entry here. A missing entry is a deliberate hard refusal, not an oversight to
 * paper over.
 *
 * Why this file has to exist: "the table is not in the current schema" means two
 * completely different things, and the schema cannot tell them apart.
 *
 * - Dropped with its feature → the rows are meaningless now, skipping is correct.
 * - RENAMED → skipping silently discards real data AND orphans everything that
 *   references it, while the restore reports success. That is strictly worse than
 *   refusing, because nobody finds out.
 *
 * Guessing between those two is how a restore quietly loses a customer's data, so
 * an unmapped missing table blocks the restore and names itself.
 *
 * Deliberately starts EMPTY. No historical entries have been invented — a wrong
 * mapping is worse than no mapping, since it would redirect rows into a table that
 * was never their home.
 */
export const TABLE_RENAMES: Record<string, string | null> = {};
