import { describe, expect, it } from "vitest";
import { BACKUP_SUMMARY_GROUPS, tableArea } from "./backups.areas";

describe("tableArea", () => {
  it("maps a headline entity to its popover group", () => {
    expect(tableArea("salesOrder")).toBe("Sales");
    expect(tableArea("job")).toBe("Production");
  });

  it("maps a child table the popover never lists", () => {
    // The disclosure screen names tables the popover has no headline for, so
    // the map has to reach further than the groups do.
    expect(tableArea("jobOperationDependency")).toBe("Production");
    expect(tableArea("salesOrderLine")).toBe("Sales");
  });

  it("returns Other for an unmapped table rather than guessing", () => {
    expect(tableArea("someTableThatDoesNotExist")).toBe("Other");
  });

  it("keeps every group's own tables consistent with the group title", () => {
    // Guards against the two sources drifting: a table listed under "Quality"
    // in the popover must not resolve to "Items" on the disclosure screen.
    for (const group of BACKUP_SUMMARY_GROUPS) {
      for (const [, table] of group.entities) {
        expect(tableArea(table)).toBe(group.title);
      }
    }
  });
});
