import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";
import {
  BACKUP_KIND,
  BACKUP_VERSION,
  type Catalog,
  type ColumnInfo,
  type Manifest,
  type TableInfo
} from "./company-backup";
import {
  backupCompatibilityPath,
  compatibilityStatus,
  writeBackupCompatibility
} from "./company-compatibility";

vi.mock("./company-backup.renames", () => ({ TABLE_RENAMES: {} }));

const col = (name: string, opts: Partial<ColumnInfo> = {}): ColumnInfo => ({
  name,
  dataType: "text",
  udtName: "text",
  isNullable: false,
  isGenerated: false,
  hasDefault: false,
  ...opts
});

const table = (name: string, columns: ColumnInfo[]): TableInfo => ({
  name,
  columns,
  scope: { kind: "direct", column: "companyId" },
  scopeColumn: "companyId",
  pkColumns: ["id", "companyId"],
  uniqueColumns: [],
  hasId: false,
  foreignKeys: []
});

const catalog = (tables: TableInfo[]): Catalog => ({
  schemaVersion: "20260825075035",
  tables
});

function manifest(tables: Manifest["tables"]): Manifest {
  return {
    kind: BACKUP_KIND,
    version: BACKUP_VERSION,
    schemaVersion: "20260101000000",
    sourceCompanyId: "company-a",
    sourceCompanyGroupId: "group-a",
    sourceCompanyName: "Acme",
    exportedAt: "2026-02-01T00:00:00.000Z",
    exportedBy: "user-1",
    label: null,
    includeStorage: "none",
    tables,
    storage: [],
    excludedTables: []
  };
}

/** Records what was uploaded, so a test can read the stored JSON back. */
function fakeClient(uploadError?: string) {
  const uploads: Array<{ path: string; body: string }> = [];
  const client = {
    storage: {
      from: () => ({
        upload: async (path: string, body: Buffer) => {
          uploads.push({ path, body: body.toString("utf8") });
          return uploadError
            ? { error: { message: uploadError } }
            : { error: null };
        }
      })
    }
  } as unknown as SupabaseClient;
  return { client, uploads };
}

describe("compatibilityStatus", () => {
  it("is ready when nothing differs", () => {
    expect(compatibilityStatus({ findings: [], blocked: false })).toBe("ready");
  });

  it("is restorable-with-changes when there are findings but none block", () => {
    expect(
      compatibilityStatus({
        findings: [
          { kind: "defaulted", table: "item", column: "x", reason: "r" }
        ],
        blocked: false
      })
    ).toBe("restorable-with-changes");
  });

  it("is not-restorable as soon as one finding blocks", () => {
    expect(
      compatibilityStatus({
        findings: [
          { kind: "defaulted", table: "item", column: "x", reason: "r" },
          { kind: "blocked", table: "item", column: "y", reason: "r" }
        ],
        blocked: true
      })
    ).toBe("not-restorable");
  });
});

describe("backupCompatibilityPath", () => {
  it("sits beside the manifest in the backup's own folder", () => {
    expect(backupCompatibilityPath("2026-02-01_backup")).toBe(
      "exports/2026-02-01_backup/compatibility.json"
    );
  });
});

describe("writeBackupCompatibility", () => {
  it("stores a ready verdict against the schema it was checked on", async () => {
    const { client, uploads } = fakeClient();

    const stored = await writeBackupCompatibility(
      client,
      "company-a",
      "b1",
      catalog([table("item", [col("id"), col("name")])]),
      manifest([{ name: "item", rows: 3, columns: ["id", "name"] }]),
      "2026-02-01T00:00:00.000Z"
    );

    expect(stored.status).toBe("ready");
    expect(stored.findings).toEqual([]);
    // The catalog's version, not the backup's — a verdict is only true of the
    // schema it was compared against.
    expect(stored.schemaVersion).toBe("20260825075035");
    expect(uploads).toHaveLength(1);
    expect(uploads[0]?.path).toBe("exports/b1/compatibility.json");
    expect(JSON.parse(uploads[0]?.body ?? "{}")).toEqual(stored);
  });

  it("stores the findings that make a backup restorable-with-changes", async () => {
    const { client, uploads } = fakeClient();

    const stored = await writeBackupCompatibility(
      client,
      "company-a",
      "b2",
      catalog([table("item", [col("id"), col("uom", { hasDefault: true })])]),
      manifest([{ name: "item", rows: 1, columns: ["id"] }]),
      "2026-02-01T00:00:00.000Z"
    );

    expect(stored.status).toBe("restorable-with-changes");
    expect(stored.findings).toHaveLength(1);
    expect(JSON.parse(uploads[0]?.body ?? "{}").findings[0]).toMatchObject({
      kind: "defaulted",
      column: "uom"
    });
  });

  it("stores not-restorable rather than omitting a verdict it cannot honour", async () => {
    const { client } = fakeClient();

    const stored = await writeBackupCompatibility(
      client,
      "company-a",
      "b3",
      catalog([table("item", [col("id"), col("uom")])]),
      manifest([{ name: "item", rows: 1, columns: ["id"] }]),
      "2026-02-01T00:00:00.000Z"
    );

    expect(stored.status).toBe("not-restorable");
  });

  it("throws when the upload fails, so the caller decides whether it matters", async () => {
    const { client } = fakeClient("bucket unavailable");

    await expect(
      writeBackupCompatibility(
        client,
        "company-a",
        "b4",
        catalog([table("item", [col("id")])]),
        manifest([{ name: "item", rows: 1, columns: ["id"] }]),
        "2026-02-01T00:00:00.000Z"
      )
    ).rejects.toThrow("bucket unavailable");
  });
});
