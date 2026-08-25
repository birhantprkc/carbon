import {
  DummyDriver,
  Kysely,
  PostgresAdapter,
  PostgresIntrospector,
  PostgresQueryCompiler,
  sql
} from "kysely";
import { describe, expect, it } from "vitest";
import type { ColumnInfo, ForeignKey, TableInfo } from "./company-backup";
import {
  closureCheckedForeignKeys,
  formatScopeViolation,
  outOfScopeRefPredicate
} from "./company-backup";

/** Compiles SQL without a connection. */
const db = new Kysely<never>({
  dialect: {
    createAdapter: () => new PostgresAdapter(),
    createDriver: () => new DummyDriver(),
    createIntrospector: (i) => new PostgresIntrospector(i),
    createQueryCompiler: () => new PostgresQueryCompiler()
  }
});

const col = (name: string, isNullable = false): ColumnInfo => ({
  name,
  dataType: "text",
  udtName: "text",
  isNullable,
  isGenerated: false,
  hasDefault: false
});

const table = (
  name: string,
  columns: ColumnInfo[],
  foreignKeys: ForeignKey[] = []
): TableInfo => ({
  name,
  columns,
  scope: { kind: "direct", column: "companyId" },
  scopeColumn: "companyId",
  pkColumns: ["id", "companyId"],
  uniqueColumns: [],
  hasId: false,
  foreignKeys
});

const job = table("job", [col("id"), col("companyId")]);
const byName = new Map([["job", job]]);
const exportableNames = new Set(["job", "jobOperationDependency"]);

describe("closureCheckedForeignKeys", () => {
  it("keeps a NOT-NULL id reference to another exportable scoped table", () => {
    const t = table(
      "jobOperationDependency",
      [col("jobId"), col("companyId")],
      [{ column: "jobId", refTable: "job", refColumn: "id" }]
    );
    expect(
      closureCheckedForeignKeys(t, exportableNames).map((f) => f.column)
    ).toEqual(["jobId"]);
  });

  it("skips a nullable reference — a restore nulls it rather than dangling", () => {
    const t = table(
      "jobOperationDependency",
      [col("jobId", true), col("companyId")],
      [{ column: "jobId", refTable: "job", refColumn: "id" }]
    );
    expect(closureCheckedForeignKeys(t, exportableNames)).toEqual([]);
  });

  it("skips a reference to a retained global table", () => {
    const t = table(
      "jobOperationDependency",
      [col("createdBy"), col("companyId")],
      [{ column: "createdBy", refTable: "user", refColumn: "id" }]
    );
    expect(closureCheckedForeignKeys(t, exportableNames)).toEqual([]);
  });

  it("skips a reference to a table that is not exported at all", () => {
    const t = table(
      "apiKeyRateLimit",
      [col("apiKeyId"), col("companyId")],
      [{ column: "apiKeyId", refTable: "apiKey", refColumn: "id" }]
    );
    expect(closureCheckedForeignKeys(t, exportableNames)).toEqual([]);
  });
});

describe("outOfScopeRefPredicate", () => {
  const fk: ForeignKey = { column: "jobId", refTable: "job", refColumn: "id" };
  const compiled = () =>
    outOfScopeRefPredicate(fk, job, byName, "company-a", "group-a").compile(db)
      .sql;

  it("matches only rows whose reference is set and resolves nowhere in scope", () => {
    const s = compiled();
    expect(s).toContain(`"jobId" IS NOT NULL`);
    expect(s).toContain(`"jobId" NOT IN`);
    expect(s).toContain(`FROM "job"`);
  });

  it("widens the parent set to companyId IS NULL — shared seeded substrate", () => {
    // Global material/currency rows live in every target, so a reference to one
    // is never a closure gap. A reference to ANOTHER company's row still is.
    expect(compiled()).toContain(`"companyId" IS NULL`);
  });

  it("is the exact expression the dump negates, so guard and exclusion cannot drift", () => {
    // The whole point of exporting this predicate: the guard counts rows it
    // matches and the dump drops those same rows with NOT (...). If these two
    // ever came from separate expressions, a backup could claim to have excluded
    // unrestorable rows while still carrying some.
    const predicate = outOfScopeRefPredicate(
      fk,
      job,
      byName,
      "company-a",
      "group-a"
    );
    const inner = predicate.compile(db).sql;
    const negated = sql`true AND NOT (${predicate})`.compile(db).sql;

    expect(negated).toContain(`NOT (${inner})`);
  });
});

describe("formatScopeViolation", () => {
  it("reads like the message operators already know, and gets plurals right", () => {
    expect(
      formatScopeViolation({
        table: "pickMethod",
        column: "itemId",
        refTable: "item",
        rows: 1
      })
    ).toBe("pickMethod.itemId → item (1 row)");

    expect(
      formatScopeViolation({
        table: "jobOperationDependency",
        column: "jobId",
        refTable: "job",
        rows: 3
      })
    ).toBe("jobOperationDependency.jobId → job (3 rows)");
  });
});
