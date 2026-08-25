import { getJobDatabaseClient, type JobDatabase } from "../../../db";
import { inngest } from "../../client";
import type { Catalog, TableInfo } from "../tasks/company-backup";
import {
  findExportScopeViolations,
  getCompanyTableCatalog,
  SECRET_TABLES
} from "../tasks/company-backup";

/**
 * Cross-tenant reference monitor.
 *
 * `findExportScopeViolations` already finds NOT-NULL foreign keys that escape a
 * company's scope — it is the guard that refuses to produce an unrestorable
 * backup. The problem is that it only runs when somebody clicks "Create backup",
 * so a cross-tenant write can sit undetected until a customer's export fails.
 * This runs the same query nightly, for every company, and logs what it finds.
 *
 * Internal monitoring only: a cross-tenant reference is an engineering
 * escalation, not a message for the customer. Nothing is written and no marker
 * row is created — a finding here means a write path is attributing rows to the
 * wrong tenant, and that needs a human.
 *
 * 05:00 keeps it clear of workflow-run-retention at 04:00 and backup-maintenance
 * at 03:00, so the three never contend for the connection pool.
 */
export const tenantIntegrityFunction = inngest.createFunction(
  { id: "tenant-integrity", retries: 2 },
  { cron: "0 5 * * *" },
  async ({ step, logger }) => {
    return await step.run("scan-cross-tenant-refs", async () => {
      const db = getJobDatabaseClient(1);
      const catalog = await getCompanyTableCatalog(db);
      const { exportable, byName } = exportScope(catalog);

      const companies = await db
        .selectFrom("company")
        .select(["id", "companyGroupId"])
        .execute();

      let companiesWithViolations = 0;
      let totalViolations = 0;

      for (const company of companies) {
        const violations = await findExportScopeViolations(
          db,
          exportable,
          byName,
          company.id,
          company.companyGroupId ?? null
        );
        if (violations.length === 0) continue;

        companiesWithViolations++;
        totalViolations += violations.length;
        logger.error("Cross-tenant references found", {
          companyId: company.id,
          count: violations.length,
          violations
        });
      }

      const result = {
        companiesScanned: companies.length,
        companiesWithViolations,
        totalViolations
      };
      logger.info("tenant-integrity scan complete", result);
      return result;
    });
  }
);

/**
 * The exportable table set and name index, built exactly as `buildCompanyBackup`
 * builds them. Shared shape rather than a second definition, so the monitor and
 * the export can never disagree about what counts as a violation.
 */
export function exportScope(catalog: Catalog): {
  exportable: TableInfo[];
  byName: Map<string, TableInfo>;
} {
  const secretTables = new Set<string>(SECRET_TABLES);
  return {
    exportable: catalog.tables.filter((t) => !secretTables.has(t.name)),
    byName: new Map(catalog.tables.map((t) => [t.name, t]))
  };
}

export type { JobDatabase };
