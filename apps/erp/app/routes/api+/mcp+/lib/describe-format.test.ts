import type { ManifestEntry } from "@carbon/api";
import { describe, expect, test } from "vitest";
import {
  deriveNameDescription,
  formatParamSummary,
  formatToolDescription
} from "./describe-format";
import { MCP_DEFAULT_LIMIT } from "./format-result";
import { getServerInstructions } from "./instructions";
import toolMetadata from "./tool-metadata.json";

const baseTool: ManifestEntry = {
  name: "sales_getCustomer",
  module: "sales",
  classification: "READ",
  description: "get customer",
  paramCount: 1,
  serviceParams: ["client", "id"],
  injectAuth: ["companyId"],
  permission: { module: "sales", actions: ["view"] },
  schema: {
    type: "object",
    properties: {
      id: { type: "string" },
      includeContacts: { type: "boolean" },
      status: { type: "string" }
    },
    required: ["id"]
  },
  responseSchema: {
    type: "object",
    properties: { id: { type: "string" }, name: { type: "string" } }
  }
};

describe("deriveNameDescription", () => {
  test("mirrors the generator's name-derived description", () => {
    expect(deriveNameDescription("sales_getCustomers")).toBe("get customers");
    expect(deriveNameDescription("production_upsertJobMaterial")).toBe(
      "upsert job material"
    );
  });
});

describe("formatParamSummary", () => {
  test("spells out required params and counts optionals", () => {
    expect(formatParamSummary(baseTool)).toBe("(id, +2 optional)");
  });

  test("renders an argless tool as empty parens", () => {
    expect(
      formatParamSummary({
        ...baseTool,
        schema: { type: "object", properties: {} }
      })
    ).toBe("()");
  });
});

describe("formatToolDescription", () => {
  test("prints the full contract including the response schema", () => {
    const text = formatToolDescription(baseTool, { isList: false });
    expect(text).toContain("Tool: sales_getCustomer");
    expect(text).toContain("Permission: sales_view");
    expect(text).toContain("Input Schema:\n{");
    expect(text).toContain(
      "Response Schema (null fields are omitted from results):"
    );
    expect(text).not.toContain("List operation:");
  });

  test("marks list operations with the default page size", () => {
    const text = formatToolDescription(baseTool, { isList: true });
    expect(text).toContain(
      `List operation: pages with limit/offset (default limit ${MCP_DEFAULT_LIMIT})`
    );
  });

  test("omits the permission line for key-only operations", () => {
    const text = formatToolDescription(
      { ...baseTool, permission: { module: null, actions: ["view"] } },
      { isList: false }
    );
    expect(text).not.toContain("Permission:");
  });

  test("omits the response schema section when none was derived", () => {
    const text = formatToolDescription(
      { ...baseTool, responseSchema: undefined },
      { isList: false }
    );
    expect(text).not.toContain("Response Schema");
  });
});

describe("getServerInstructions", () => {
  const instructions = getServerInstructions("2026-09-11");

  test("lists every module name", () => {
    const modules = [...new Set(toolMetadata.tools.map((t) => t.module))];
    for (const module of modules) {
      expect(instructions).toContain(module);
    }
  });

  test("derives the default page size from the constant", () => {
    expect(instructions).toContain(
      `List reads default to ${MCP_DEFAULT_LIMIT} rows`
    );
  });

  test("documents describe_tool batching", () => {
    expect(instructions).toContain('names: ["sales_getCustomers"');
  });
});
