import { validatePrintRequest } from "./print-request";
import { buildFromSnapshot } from "./build-from-snapshot";
import { PrintOrderHeld, type SessionExtraRow, type SessionPhotoRow } from "./build-order";
import type { ShipTo } from "./order-xml";

/** The parts of a Shopify order (webhook body or Admin REST order) that we read. */
export interface ShopifyPaidOrder {
  id: number | string;
  name?: string;
  financial_status?: string;
  line_items?: Array<{ variant_id?: number | string | null; quantity?: number }>;
  /** Cart attributes (set by buildCheckoutUrl) arrive here. */
  note_attributes?: Array<{ name?: string; value?: string }>;
  shipping_address?: {
    first_name?: string | null; last_name?: string | null; company?: string | null;
    address1?: string | null; address2?: string | null; city?: string | null;
    province_code?: string | null; province?: string | null; zip?: string | null;
    country_code?: string | null; phone?: string | null;
  } | null;
  customer?: { first_name?: string | null; last_name?: string | null } | null;
}

export interface VariantConfig {
  standardVariantId: string;
  luxuryVariantId: string;
  /** Variants of an (optional) paid "extra print" product. Each unit bought = one extra print allowed. */
  extraVariantIds: string[];
}

export type PaidOrderStatus = "ignored" | "ready" | "held" | "refused" | "sent" | "error";

/** The exact rows a paid order prints, frozen at payment. Builds and retries read ONLY this. */
export interface PrintSnapshot {
  frozenAt: string;
  photoRows: SessionPhotoRow[];
  extraRows: SessionExtraRow[];
  /** What the order was for, taken from the Shopify order at payment — so a build needs nothing live. */
  order?: SnapshotOrderInfo;
}

export interface SnapshotOrderInfo {
  bookTheme: string;
  /** Extra prints paid for on top of the free allowance. */
  paidExtras: number;
  shipTo: ShipTo;
  customer: { fname?: string; lname?: string };
}

export interface PaidOrderResult {
  status: PaidOrderStatus;
  reasons: string[];
  warnings: string[];
  externalId?: string;
  printCount?: number;
  sessionId?: string;
  snapshot?: PrintSnapshot;
}

export interface AlertInfo {
  status: "held" | "refused";
  shopifyOrderId: string;
  shopifyOrderName?: string;
  sessionToken: string;
  reasons: string[];
}

export interface PaidOrderDeps {
  variants: VariantConfig;
  loadSession: (token: string) => Promise<{
    session: { id: string; book_theme: string };
    photoRows: SessionPhotoRow[];
    extraRows: SessionExtraRow[];
    fetchImage: (path: string) => Promise<Buffer>;
  }>;
  /** What we already recorded for this Shopify order (webhook retries, manual retries). */
  loadExisting: (shopifyOrderId: string) => Promise<{ status: string; snapshot?: PrintSnapshot } | null>;
  /**
   * Freeze the rows: copy each stored image to a path nobody else writes to
   * (e.g. print-orders/<order id>/…) and return rows pointing at the copies.
   */
  freeze: (shopifyOrderId: string, photoRows: SessionPhotoRow[], extraRows: SessionExtraRow[]) => Promise<PrintSnapshot>;
  /** Email Kevin about a refused or held order. Failures here must never fail the order. */
  alert: (info: AlertInfo) => Promise<void>;
  /** True when a DIFFERENT paid order already has a ready, sent or error print order for this session. */
  otherReadyOrderForSession: (sessionId: string, shopifyOrderId: string) => Promise<boolean>;
  record: (r: PaidOrderResult & { shopifyOrderId: string; shopifyOrderName?: string }) => Promise<void>;
}

const attr = (o: ShopifyPaidOrder, name: string) =>
  o.note_attributes?.find((a) => a.name === name)?.value?.trim() || "";

export interface HandleOptions {
  /**
   * Take a fresh snapshot of the session instead of reusing the saved one,
   * even for a refused order (never for a ready one). A HELD order always
   * re-freezes on retry: its customer is still allowed to add photos.
   */
  refreeze?: boolean;
}

/**
 * Decide what a paid Shopify order means for printing, and (if it is a print
 * order) build and validate it. NOTHING is written to Photo Finale; the only
 * side effects are `deps.freeze`, `deps.record` and `deps.alert`. Orders with
 * no print line item are ignored.
 *
 * What was paid for comes ONLY from the Shopify order and the code: the book
 * (Standard/Luxury variant, quantity 1, slot list from code) and extras
 * (the free cap + units of the paid extra-print variants). What is printed is
 * the snapshot frozen the first time the order is seen — payment means the
 * book is finished — and every later build or retry reuses that snapshot.
 */
export async function handlePaidOrder(
  order: ShopifyPaidOrder,
  deps: PaidOrderDeps,
  opts: HandleOptions = {}
): Promise<PaidOrderResult> {
  const orderId = String(order.id);
  const token = attr(order, "session_token");
  const v = deps.variants;
  const lines = order.line_items ?? [];
  const bookLines = lines.filter((l) => [v.standardVariantId, v.luxuryVariantId].includes(String(l.variant_id)));
  if (bookLines.length === 0) return { status: "ignored", reasons: ["no print line item"], warnings: [] };

  const existing = await deps.loadExisting(orderId);
  // Sent to the printer (or failed there): never re-checked, re-frozen or overwritten here.
  if (existing?.status === "sent" || existing?.status === "error") {
    if (opts.refreeze) throw new Error(`order is already ${existing.status} — refusing to re-freeze it`);
    return { status: existing.status, reasons: [], warnings: [], snapshot: existing.snapshot };
  }
  if (existing?.status === "ready" && !opts.refreeze) {
    // A webhook retry for an order we already finished: nothing to redo, nothing to re-alert.
    return { status: "ready", reasons: [], warnings: [], snapshot: existing.snapshot };
  }
  if (opts.refreeze && existing?.status === "ready") {
    throw new Error("order is already ready — refusing to re-freeze it");
  }

  const done = async (r: PaidOrderResult) => {
    await deps.record({ ...r, shopifyOrderId: orderId, shopifyOrderName: order.name });
    if ((r.status === "held" || r.status === "refused") && existing?.status !== r.status) {
      try {
        await deps.alert({ status: r.status, shopifyOrderId: orderId, shopifyOrderName: order.name, sessionToken: token, reasons: r.reasons });
      } catch (err) {
        console.error("print order alert failed:", err);
      }
    }
    return r;
  };
  const refuse = (...reasons: string[]) => done({ status: "refused", reasons, warnings: [] });

  if (bookLines.length > 1 || (bookLines[0].quantity ?? 1) !== 1) {
    return refuse("print line item must appear once with quantity 1 — handle this order by hand");
  }
  const tier = String(bookLines[0].variant_id) === v.luxuryVariantId ? "luxury" : "standard";
  const theme = attr(order, "book_theme");
  if (!token) return refuse("order has no session_token attribute");

  // Checks that need no session first (unknown / unsupported book, wrong price tier).
  const early = validatePrintRequest({ bookTheme: theme, filledBookSlots: 0, extraPrints: 0, variantTier: tier });
  if (early.errors.length > 0) return refuse(...early.errors);

  let loaded;
  try {
    loaded = await deps.loadSession(token);
  } catch (err) {
    return refuse((err as Error).message);
  }
  if (loaded.session.book_theme !== theme) {
    return refuse(`order says ${theme || "(no book_theme)"} but the session is ${loaded.session.book_theme}`);
  }
  if (await deps.otherReadyOrderForSession(loaded.session.id, orderId)) {
    return refuse("this session already has a ready print order from another purchase");
  }

  // Freeze at payment (first sight), or reuse what was frozen. Never live rows after that.
  const extraQty = lines
    .filter((l) => v.extraVariantIds.includes(String(l.variant_id)))
    .reduce((n, l) => n + (l.quantity ?? 0), 0);
  const a = order.shipping_address;
  const shipTo: ShipTo = {
    fname: a?.first_name ?? "", lname: a?.last_name ?? "", address1: a?.address1 ?? "",
    address2: a?.address2 ?? undefined, city: a?.city ?? "", state: a?.province_code || a?.province || "",
    zip: a?.zip ?? "", country: a?.country_code ?? "", company: a?.company ?? undefined, phone: a?.phone ?? undefined,
  };
  const customer = {
    fname: order.customer?.first_name ?? a?.first_name ?? undefined,
    lname: order.customer?.last_name ?? a?.last_name ?? undefined,
  };

  // Freeze at payment (first sight), or reuse what was frozen. Never live rows after that.
  const frozen =
    existing?.snapshot && existing.status !== "held" && !opts.refreeze
      ? existing.snapshot
      : await deps.freeze(orderId, loaded.photoRows, loaded.extraRows);
  // The snapshot also records what the order was for, so building it later needs nothing live.
  const snapshot: PrintSnapshot = { ...frozen, order: { bookTheme: theme, paidExtras: extraQty, shipTo, customer } };
  const finish = (r: PaidOrderResult) => done({ ...r, sessionId: loaded.session.id, snapshot });

  const check = validatePrintRequest({
    bookTheme: theme,
    filledBookSlots: snapshot.photoRows.filter((r) => r.status !== "empty").length,
    extraPrints: snapshot.extraRows.filter((r) => r.storage_path).reduce((n, r) => n + (r.quantity ?? 0), 0),
    paidExtras: extraQty,
    variantTier: tier,
  });
  if (check.errors.length > 0) return finish({ status: "refused", reasons: check.errors, warnings: [] });

  try {
    const built = await buildFromSnapshot(orderId, snapshot, loaded.fetchImage);
    return finish({ status: "ready", reasons: [], warnings: built.warnings, externalId: built.folderName, printCount: built.printCount });
  } catch (err) {
    if (err instanceof PrintOrderHeld) return finish({ status: "held", reasons: [err.message], warnings: [] });
    return finish({ status: "refused", reasons: [(err as Error).message], warnings: [] });
  }
}
