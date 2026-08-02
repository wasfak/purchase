// Shared types for the Auto Tasfya feature — the multi-order supply report
// ("أوامر توريد الأصناف"), the purchase-invoices register, and the stock master.
// Dates are kept as normalized "YYYY/MM/DD" strings so they survive MongoDB and
// sort chronologically with a plain string compare.

/** One item line inside a supply order (كود / اسم / الكمية المطلوبة). */
export interface SupplyOrderItem {
  code: string;
  name: string;
  /** الكمية المطلوبة — the ordered/requested quantity. */
  order: number;
}

/** One supply order (أمر توريد) from the multi-order pos report. */
export interface SupplyOrder {
  /** رقم أمر التوريد — unique within the file. */
  orderNumber: string;
  /** المورد — the supplier/company this order is for. */
  supplier: string;
  /** Order date, "YYYY/MM/DD". */
  date: string;
  items: SupplyOrderItem[];
}

/** One purchase line from the "سجل فواتير شراء الأصناف" register. */
export interface PurchaseLine {
  code: string;
  name: string;
  /** إسم المورد — the distributor the item was bought from. */
  company: string;
  invoice: string;
  /** Purchase date, "YYYY/MM/DD". */
  date: string;
  /** كمية الوارد — received quantity on this line (incl. bonus units). */
  kmya: number;
  /** أساسي discount % (100% marks a بونص / free line). */
  basicPct: number;
  /** إضافي discount %. */
  extraPct: number;
  /** خاص discount %. */
  specialPct: number;
}

/** One item from the supplier stock master (رصيد المخزن للمورد). */
export interface StockItem {
  code: string;
  name: string;
  /** المورد — the supplier this item belongs to. */
  supplier: string;
  purchasePrice: number;
  salePrice: number;
  balance: number;
}

// ---- Settlement (tasfya) computation types ----

/** One purchase line of an item, shown in the per-supplier breakdown. */
export interface PurchaseDetail {
  supplier: string;
  invoice: string;
  date: string;
  received: number;
  basicPct: number;
  extraPct: number;
  specialPct: number;
}

/** The order side fed to the settlement: the combined items for one company. */
export interface OrderData {
  items: SupplyOrderItem[];
  /** Cutoff date "YYYY/MM/DD" — purchases before it are excluded. */
  referenceDate: string;
  /** The order number(s) this settlement covers (joined if several). */
  orderNumber: string;
  /** المورد / company this settlement is for. */
  supplierCompany: string;
}

/** The per-company slice of the stock master used for over-order detection. */
export interface StockSlice {
  byCode: Map<string, StockItem>;
  codes: Set<string>;
}

/** One settled item row. */
export interface ReportRow {
  code: string;
  name: string;
  /** Distributor(s) the item was purchased from, joined if several. */
  supplier: string;
  order: number;
  /** Total received quantity across all purchase lines (incl. bonus units). */
  received: number;
  basicPct: number;
  extraPct: number;
  specialPct: number;
  /** بونص: quantity received free (lines where أساسي = 100%). */
  bonus: number;
  /** التسوية = (received − bonus) − order. */
  tasfya: number;
  lines: PurchaseDetail[];
}

/** An over-order ("زائد") item: purchased, in the company's stock, not ordered. */
export interface ExtraItem {
  code: string;
  name: string;
  supplier: string;
  received: number;
  basicPct: number;
  extraPct: number;
  specialPct: number;
  bonus: number;
  lines: PurchaseDetail[];
}

/** The full settlement result for one company + month. */
export interface TasfyaResult {
  report: ReportRow[];
  extraItems: ExtraItem[];
  supplierCompany: string;
  referenceDate: string;
  orderNumber: string;
}
