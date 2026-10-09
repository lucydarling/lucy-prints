import { BOOK_THEMES, getProductForTheme, getSlots } from "@/lib/photo-slots";
import { EXTRAS_FREE_CAP } from "./config";
import { buildOrder, PrintOrderHeld, type PaidEntitlement, type SessionExtraRow, type SessionPhotoRow } from "./build-order";
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

export type PaidOrderStatus = "ignored" | "ready" | "held" | "refused";

export interface PaidOrderResult {
  status: PaidOrderStatus;
  reasons: string[];
  warnings: string[];
  externalId?: string;
  printCount?: number;
  sessionId?: string;
}

export interface PaidOrderDeps {
  variants: VariantConfig;
  loadSession: (token: string) => Promise<{
    session: { id: string; book_theme: string };
    photoRows: SessionPhotoRow[];
    extraRows: SessionExtraRow[];
    fetchImage: (path: string) => Promise<Buffer>;
  }>;
  /** True when a DIFFERENT paid order already has a ready print order for this session. */
  otherReadyOrderForSession: (sessionId: string, shopifyOrderId: string) => Promise<boolean>;
  record: (r: PaidOrderResult & { shopifyOrderId: string; shopifyOrderName?: string }) => Promise<void>;
}

const attr = (o: ShopifyPaidOrder, name: string) =>
  o.note_attributes?.find((a) => a.name === name)?.value?.trim() || "";

/**
 * Decide what a paid Shopify order means for printing, and (if it is a print
 * order) build and validate it. NOTHING is written to Photo Finale; the only
 * side effect is `deps.record`. Orders with no print line item are ignored.
 *
 * What was paid for comes ONLY from the Shopify order and the code:
 *  - the book: the print product's variant (standard/luxury, quantity 1) +
 *    the theme's slot list from code (the theme's tier must match the variant);
 *  - extras: EXTRAS_FREE_CAP + units of the paid extra-print variants.
 * The session rows are only what is being printed, never what was paid for.
 */
export async function handlePaidOrder(order: ShopifyPaidOrder, deps: PaidOrderDeps): Promise<PaidOrderResult> {
  const orderId = String(order.id);
  const done = async (r: PaidOrderResult) => {
    if (r.status !== "ignored") await deps.record({ ...r, shopifyOrderId: orderId, shopifyOrderName: order.name });
    return r;
  };
  const refuse = (...reasons: string[]) => done({ status: "refused", reasons, warnings: [] });

  const v = deps.variants;
  const lines = order.line_items ?? [];
  const bookLines = lines.filter((l) => [v.standardVariantId, v.luxuryVariantId].includes(String(l.variant_id)));
  if (bookLines.length === 0) return { status: "ignored", reasons: ["no print line item"], warnings: [] };
  if (bookLines.length > 1 || (bookLines[0].quantity ?? 1) !== 1) {
    return refuse("print line item must appear once with quantity 1 — handle this order by hand");
  }
  const tier = String(bookLines[0].variant_id) === v.luxuryVariantId ? "luxury" : "standard";

  const token = attr(order, "session_token");
  const theme = attr(order, "book_theme");
  if (!token) return refuse("order has no session_token attribute");
  const themeDef = BOOK_THEMES.find((t) => t.id === theme);
  if (!themeDef) return refuse(`unknown book_theme "${theme}"`);
  if (getProductForTheme(theme) !== "memory_book") {
    return refuse(`${themeDef.product} orders are not supported for printing yet`);
  }
  const themeTier = themeDef.tier === "luxury" ? "luxury" : "standard"; // "retiring" books sell at the standard price
  if (themeTier !== tier) {
    return refuse(`paid for the ${tier} print product but ${theme} is a ${themeTier} book`);
  }

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

  let loaded;
  try {
    loaded = await deps.loadSession(token);
  } catch (err) {
    return refuse((err as Error).message);
  }
  if (loaded.session.book_theme !== theme) {
    return refuse(`order says ${theme} but the session is ${loaded.session.book_theme}`);
  }
  if (await deps.otherReadyOrderForSession(loaded.session.id, orderId)) {
    return refuse("this session already has a ready print order from another purchase");
  }

  const extraQty = lines
    .filter((l) => v.extraVariantIds.includes(String(l.variant_id)))
    .reduce((n, l) => n + (l.quantity ?? 0), 0);
  const paid: PaidEntitlement = {
    bookSlotKeys: getSlots(theme).map((s) => s.key),
    maxExtras: EXTRAS_FREE_CAP + extraQty,
  };

  try {
    const built = await buildOrder({
      bookTheme: theme,
      photoRows: loaded.photoRows,
      extraRows: loaded.extraRows,
      fetchImage: loaded.fetchImage,
      externalId: orderId,
      shipTo,
      customer,
      paid,
    });
    return done({
      status: "ready", reasons: [], warnings: built.warnings,
      externalId: built.folderName, printCount: built.printCount, sessionId: loaded.session.id,
    });
  } catch (err) {
    if (err instanceof PrintOrderHeld) {
      return done({ status: "held", reasons: [err.message], warnings: [], sessionId: loaded.session.id });
    }
    return done({ status: "refused", reasons: [(err as Error).message], warnings: [], sessionId: loaded.session.id });
  }
}
