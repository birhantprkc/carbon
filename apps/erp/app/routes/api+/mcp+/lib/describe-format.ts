// Text formatting for describe_tool / search_tools output, extracted from the
// @ts-nocheck server.ts so it is typed and unit-testable. Schemas print as
// compact JSON on purpose — pretty-printing roughly doubles the whitespace
// tokens and models parse compact JSON just as well.
import type { ManifestEntry } from "@carbon/api";
import { MCP_DEFAULT_LIMIT } from "./format-result";

/**
 * The description the generator derives from a bare tool name
 * ("sales_getCustomers" → "get customers"). A tool whose description equals
 * this carries no information beyond its name, so search output skips it.
 */
export function deriveNameDescription(name: string): string {
  const separator = name.indexOf("_");
  const func = separator === -1 ? name : name.slice(separator + 1);
  return func
    .replace(/([A-Z])/g, " $1")
    .trim()
    .toLowerCase();
}

/**
 * One-line argument summary for search results: required params spelled out,
 * optionals as a count — enough to call a simple tool without a describe round
 * trip. "(id)" / "(jobId, _operation, +12 optional)" / "()".
 */
export function formatParamSummary(tool: ManifestEntry): string {
  const schema = tool.schema as {
    properties?: Record<string, unknown>;
    required?: string[];
  };
  const properties = Object.keys(schema?.properties ?? {});
  const required = Array.isArray(schema?.required)
    ? schema.required.filter((name) => properties.includes(name))
    : [];
  const optionalCount = properties.length - required.length;
  const parts = [...required];
  if (optionalCount > 0) parts.push(`+${optionalCount} optional`);
  return `(${parts.join(", ")})`;
}

/** Full describe_tool text for one tool. */
export function formatToolDescription(
  tool: ManifestEntry,
  options: { isList: boolean }
): string {
  let output = `Tool: ${tool.name}\n`;
  output += `Module: ${tool.module}\n`;
  output += `Classification: ${tool.classification}\n`;
  output += `Description: ${tool.description}\n`;
  if (tool.permission.module) {
    const scopes = tool.permission.actions
      .map((action) => `${tool.permission.module}_${action}`)
      .join(" or ");
    output += `Permission: ${scopes} (required for API-key callers)\n`;
  }
  if (options.isList) {
    output += `List operation: pages with limit/offset (default limit ${MCP_DEFAULT_LIMIT})\n`;
  }
  output += `\nInput Schema:\n${JSON.stringify(tool.schema ?? {})}`;
  if (tool.responseSchema) {
    output += `\n\nResponse Schema (null fields are omitted from results):\n${JSON.stringify(
      tool.responseSchema
    )}`;
  }
  return output;
}
