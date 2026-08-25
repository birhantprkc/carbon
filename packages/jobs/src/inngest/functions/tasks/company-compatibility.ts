import type { SupabaseClient } from "@supabase/supabase-js";
import type { Catalog, CompatibilityFinding, Manifest } from "./company-backup";
import { EXPORTS_PREFIX, reportBackupCompatibility } from "./company-backup";

/**
 * The precomputed "can this still be restored?" verdict, stored beside the
 * backup it describes.
 *
 * WHY A FILE. The comparison needs `reportBackupCompatibility` and a live schema
 * read, both of which live on the jobs side — and `@carbon/jobs` deliberately
 * exposes only `.`, `./events`, `./inngest` and `./worker`, with its AGENTS.md
 * forbidding app code from importing job internals. Rather than widen that
 * contract, the jobs side computes the verdict once and writes it where the app
 * already reads: storage. The app then treats it like any other stored fact, and
 * the Backups page costs no `information_schema` query per render.
 *
 * Written ONCE, by the export job, so a fresh backup has a verdict immediately.
 * It is never refreshed, and `checkedAt` is therefore always the export date —
 * the verdict is a dated fact about the schema of that day, not a claim about
 * today's. A nightly re-check existed and was removed (2026-08-25): rot is
 * prevented at commit time by `pnpm db:check:backups`, and re-deciding it after
 * the breaking change is already in production repaired nothing and alerted
 * nobody. The live gate is `assertBackupImportable` inside the restore itself.
 */
/**
 * Not exported: nothing outside this file can use it. `backupCompatibilityPath`
 * below is the only way to build the path, and the ERP reader cannot import from
 * here at all — `listCompanyBackups` in `apps/erp/app/modules/settings/
 * backups.service.ts` repeats this string and the status union by hand, because app
 * code may not import job internals. Change either one and that reader silently
 * finds nothing, which the UI reports as "not yet checked". Update both together.
 */
const COMPATIBILITY_FILE = "compatibility.json";

export type BackupCompatibilityStatus =
  | "ready"
  | "restorable-with-changes"
  | "not-restorable";

export type StoredCompatibility = {
  /** When this verdict was computed — a verdict is only true of one schema. */
  checkedAt: string;
  /** The schema it was checked against, so a stale verdict is recognisable. */
  schemaVersion: string;
  status: BackupCompatibilityStatus;
  findings: CompatibilityFinding[];
};

export function backupCompatibilityPath(name: string): string {
  return `${EXPORTS_PREFIX}/${name}/${COMPATIBILITY_FILE}`;
}

/** Map a compatibility report onto the shared five-word status vocabulary. */
export function compatibilityStatus(report: {
  findings: CompatibilityFinding[];
  blocked: boolean;
}): BackupCompatibilityStatus {
  if (report.blocked) return "not-restorable";
  return report.findings.length > 0 ? "restorable-with-changes" : "ready";
}

/**
 * Compute the verdict for one backup and store it next to its manifest.
 *
 * MUST be called after `writeBackupManifest`, never before: `manifest.json` is the
 * completion flag for the whole folder, and a verdict appearing first would
 * describe a backup the UI still considers unfinished.
 */
export async function writeBackupCompatibility(
  client: SupabaseClient,
  companyId: string,
  name: string,
  catalog: Catalog,
  manifest: Manifest,
  checkedAt: string
): Promise<StoredCompatibility> {
  const report = reportBackupCompatibility(catalog, manifest);
  const stored: StoredCompatibility = {
    checkedAt,
    schemaVersion: catalog.schemaVersion,
    status: compatibilityStatus(report),
    findings: report.findings
  };

  const up = await client.storage
    .from(companyId)
    .upload(
      backupCompatibilityPath(name),
      Buffer.from(JSON.stringify(stored)),
      {
        contentType: "application/json",
        upsert: true
      }
    );
  if (up.error) throw new Error(`compatibility: ${up.error.message}`);

  return stored;
}
