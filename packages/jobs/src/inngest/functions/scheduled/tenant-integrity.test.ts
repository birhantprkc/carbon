import {
  type DatabaseConnection,
  type Driver,
  DummyDriver,
  Kysely,
  PostgresAdapter,
  PostgresIntrospector,
  PostgresQueryCompiler,
  type QueryResult
} from "kysely";
import { describe, expect, it } from "vitest";
import type { JobDatabase } from "../../../db";
import type { Catalog, ColumnInfo, TableInfo } from "../tasks/company-backup";
import { findExportScopeViolations } from "../tasks/company-backup";
import { exportScope } from "./tenant-integrity";

/** Compiles SQL without a connection; every query returns no rows. */
const emptyDb = new Kysely<never>({
  dialect: {
    createAdapter: () => new PostgresAdapter(),
    createDriver: () => new DummyDriver(),
    createIntrospector: (i) => new PostgresIntrospector(i),
    createQueryCompiler: () => new PostgresQueryCompiler()
  }
}) as unknown as JobDatabase;

/** Same, but every count query answers with `n` rows out of scope. */
function dbReturningCount(n: number): JobDatabase {
  const connection: DatabaseConnection = {
    executeQuery: async <R>(): Promise<QueryResult<R>> => ({
      rows: [{ n: String(n) } as unknown as R]
    }),
    // biome-ignore lint/correctness/useYield: never streamed in these tests
    streamQuery: async function* () {}
  };
  const driver: Driver = {
    init: async () => {},
    acquireConnection: async () => connection,
    beginTransaction: async () => {},
    commitTransaction: async () => {},
    rollbackTransaction: async () => {},
    releaseConnection: async () => {},
    destroy: async () => {}
  };
  return new Kysely<never>({
    dialect: {
      createAdapter: () => new PostgresAdapter(),
      createDriver: () => driver,
      createIntrospector: (i) => new PostgresIntrospector(i),
      createQueryCompiler: () => new PostgresQueryCompiler()
    }
  }) as unknown as JobDatabase;
}

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
  foreignKeys: TableInfo["foreignKeys"] = []
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

/** A child with a NOT-NULL FK to a scoped parent — the shape the guard checks. */
const catalogWithOneNotNullFk = (): Catalog => ({
  schemaVersion: "test",
  tables: [
    table("job", [col("id"), col("companyId")]),
    table(
      "jobOperationDependency",
      [col("jobId"), col("companyId")],
      [{ column: "jobId", refTable: "job", refColumn: "id" }]
    )
  ]
});

describe("exportScope", () => {
  it("excludes secret tables and indexes every table by name", () => {
    const catalog: Catalog = {
      schemaVersion: "test",
      tables: [
        table("job", [col("id"), col("companyId")]),
        table("apiKey", [col("id"), col("companyId")])
      ]
    };
    const { exportable, byName } = exportScope(catalog);

    // apiKey is in SECRET_TABLES: it must never be exported...
    expect(exportable.map((t) => t.name)).toEqual(["job"]);
    // ...but it stays in the name index, because another table's FK may still
    // resolve through it.
    expect([...byName.keys()].sort()).toEqual(["apiKey", "job"]);
  });
});

describe("findExportScopeViolations", () => {
  it("reports nothing when every reference resolves in scope", async () => {
    const { exportable, byName } = exportScope(catalogWithOneNotNullFk());

    const violations = await findExportScopeViolations(
      emptyDb,
      exportable,
      byName,
      "company-a",
      "group-a"
    );

    expect(violations).toEqual([]);
  });

  it("names the table and column when a NOT-NULL reference escapes scope", async () => {
    const { exportable, byName } = exportScope(catalogWithOneNotNullFk());

    const violations = await findExportScopeViolations(
      dbReturningCount(3),
      exportable,
      byName,
      "company-a",
      "group-a"
    );

    expect(violations).toEqual(["jobOperationDependency.jobId → job (3 rows)"]);
  });

  it("ignores a nullable reference, which a restore nulls rather than dangles", async () => {
    const catalog: Catalog = {
      schemaVersion: "test",
      tables: [
        table("job", [col("id"), col("companyId")]),
        table(
          "jobOperationDependency",
          [col("jobId", true), col("companyId")],
          [{ column: "jobId", refTable: "job", refColumn: "id" }]
        )
      ]
    };
    const { exportable, byName } = exportScope(catalog);

    const violations = await findExportScopeViolations(
      dbReturningCount(3),
      exportable,
      byName,
      "company-a",
      "group-a"
    );

    expect(violations).toEqual([]);
  });
});
