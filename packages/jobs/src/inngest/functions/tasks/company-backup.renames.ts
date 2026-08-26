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

/**
 * Move a just-read backup's tables onto their CURRENT names. Runs once, right after
 * `readBackup`, so the gate, the closure preflight and `wipeAndLoad` all agree on
 * what the backup contains without any of them knowing this file exists.
 */
export function applyTableRenames<
  T extends {
    manifest: {
      tables: Array<{ name: string; rows: number; columns: string[] }>;
    };
    data: Record<string, Record<string, unknown>[]>;
  }
>(catalog: { tables: Array<{ name: string }> }, backup: T): T {
  const live = new Set(catalog.tables.map((t) => t.name));

  // Only consulted for a name the schema no longer has, which is what makes a
  // rename cycle (A→B→A) safe: the stale `A: "B"` entry is never read.
  const resolve = (name: string): string | null => {
    if (live.has(name)) return name;
    const mapped = TABLE_RENAMES[name];
    if (mapped === null) return null;
    // Can't resolve confidently — leave it for the gate to refuse by name rather
    // than dropping rows, or merging two tables, in silence.
    if (mapped === undefined || !live.has(mapped) || backup.data[mapped]) {
      return name;
    }
    return mapped;
  };

  const tables: typeof backup.manifest.tables = [];
  const data: Record<string, Record<string, unknown>[]> = { ...backup.data };
  for (const t of backup.manifest.tables) {
    const to = resolve(t.name);
    if (to === null) {
      delete data[t.name];
      continue;
    }
    tables.push(to === t.name ? t : { ...t, name: to });
    if (to !== t.name && backup.data[t.name]) {
      data[to] = backup.data[t.name]!;
      delete data[t.name];
    }
  }

  return { ...backup, manifest: { ...backup.manifest, tables }, data };
}
