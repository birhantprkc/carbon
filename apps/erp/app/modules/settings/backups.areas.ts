/**
 * Product areas for backup surfaces.
 *
 * One vocabulary, two consumers: the "what's in a backup" popover
 * (`api+/settings.backup-summary.ts`) and the pre-restore disclosure screen. The
 * disclosure screen groups its findings by area rather than by table, because
 * "Production" means something to the person deciding and `jobOperationDependency`
 * does not. Keeping both on the same list is what stops the two screens naming
 * the same data differently.
 */

export type Scope = "company" | "group";

/**
 * `scope` is the column rows are counted by: "company" (companyId, the default)
 * or "group" (companyGroupId — the shared chart of accounts / currencies /
 * dimensions).
 */
export type Entity = [label: string, table: string, scope?: Scope];

/**
 * Recognizable entities a backup carries, grouped for the popover. Not
 * exhaustive — the export covers every scoped table, these are the meaningful
 * headline counts.
 */
export const BACKUP_SUMMARY_GROUPS: {
  title: string;
  entities: Entity[];
}[] = [
  {
    title: "Sales",
    entities: [
      ["Customers", "customer"],
      ["Quotes", "quote"],
      ["Sales orders", "salesOrder"],
      ["Sales invoices", "salesInvoice"],
      ["Shipments", "shipment"]
    ]
  },
  {
    title: "Purchasing",
    entities: [
      ["Suppliers", "supplier"],
      ["Purchase orders", "purchaseOrder"],
      ["Purchase invoices", "purchaseInvoice"],
      ["Receipts", "receipt"]
    ]
  },
  {
    title: "Items",
    entities: [
      ["Parts", "part"],
      ["Materials", "material"],
      ["Tools", "tool"]
    ]
  },
  {
    title: "Production",
    entities: [
      ["Jobs", "job"],
      ["Work centers", "workCenter"],
      ["Processes", "process"]
    ]
  },
  {
    title: "Accounting",
    entities: [
      ["Accounts", "account", "group"],
      ["Currencies", "currency", "group"],
      ["Dimensions", "dimension", "group"],
      ["Journal lines", "journalLine"],
      ["Item ledger", "itemLedger"],
      ["Cost ledger", "costLedger"]
    ]
  },
  {
    title: "Quality",
    entities: [
      ["Non-conformances", "nonConformance"],
      ["Gauges", "gauge"]
    ]
  },
  { title: "People", entities: [["Employees", "employee"]] }
];

/** Every table named by the groups above, plus the child tables a compatibility
 *  finding is likely to name. Deliberately NOT exhaustive over the ~400 scoped
 *  tables — see `tableArea`. */
const TABLE_AREAS: Record<string, string> = {
  ...Object.fromEntries(
    BACKUP_SUMMARY_GROUPS.flatMap((g) =>
      g.entities.map(([, table]) => [table, g.title])
    )
  ),

  // Sales
  quoteLine: "Sales",
  salesOrderLine: "Sales",
  salesInvoiceLine: "Sales",
  shipmentLine: "Sales",
  customerContact: "Sales",
  customerLocation: "Sales",
  opportunity: "Sales",

  // Purchasing
  purchaseOrderLine: "Purchasing",
  purchaseInvoiceLine: "Purchasing",
  receiptLine: "Purchasing",
  supplierContact: "Purchasing",
  supplierLocation: "Purchasing",
  supplierPart: "Purchasing",

  // Items
  item: "Items",
  itemReplenishment: "Items",
  itemPlanning: "Items",
  itemCost: "Items",
  itemUnitSalePrice: "Items",
  makeMethod: "Items",
  methodMaterial: "Items",
  methodOperation: "Items",
  consumable: "Items",
  service: "Items",
  pickMethod: "Items",

  // Production
  jobOperation: "Production",
  jobOperationDependency: "Production",
  jobMakeMethod: "Production",
  jobMaterial: "Production",
  productionEvent: "Production",
  productionQuantity: "Production",
  rework: "Production",
  workCenterProcess: "Production",

  // Inventory — its own area, not in the popover's headline list.
  // `itemLedger` is deliberately absent: the popover already files it under
  // Accounting, and one name in two places is worse than an imperfect name.
  location: "Inventory",
  shelf: "Inventory",
  trackedEntity: "Inventory",
  kanban: "Inventory",
  warehouseTransfer: "Inventory",

  // Accounting
  accountDefault: "Accounting",
  journal: "Accounting",
  costLedger: "Accounting",
  supplierLedger: "Accounting",
  fixedAsset: "Accounting",
  period: "Accounting",
  paymentTerm: "Accounting",

  // Quality
  nonConformanceJobOperation: "Quality",
  inspection: "Quality",
  qualityDocument: "Quality",

  // People
  employeeJob: "People",
  ability: "People"
};

/**
 * The product area a table belongs to, for user-facing copy.
 *
 * Returns `"Other"` for anything unmapped, and that is the honest answer rather
 * than a failure: there are roughly 400 tenant-scoped tables and hand-mapping all
 * of them would be stale within a release. A finding in `"Other"` still shows its
 * exact table name in the details expander, so nothing is hidden — it is just
 * grouped less helpfully. Widen the map when a real finding lands in `"Other"`
 * often enough to matter.
 */
export function tableArea(table: string): string {
  return TABLE_AREAS[table] ?? "Other";
}
