import { EXTRAS_FREE_CAP } from "./config";
import { buildOrder, type BuiltOrder } from "./build-order";
import type { PrintSnapshot } from "./paid-order";
import { getSlots } from "@/lib/photo-slots";

/**
 * Build the order folder from the photos frozen at payment — and from nothing
 * else. The snapshot carries the frozen rows (pointing at copies under
 * print-orders/<order id>/), the book, the paid extras and the ship-to, so no
 * live session row is ever read. The webhook and the manual
 * `print-order:build` script both call this, so they validate and write the
 * same XML.
 */
export async function buildFromSnapshot(
  shopifyOrderId: string,
  snapshot: PrintSnapshot,
  fetchImage: (storagePath: string) => Promise<Buffer>
): Promise<BuiltOrder> {
  const info = snapshot.order;
  if (!info) {
    throw new Error("snapshot has no order details (book, ship-to) — it predates build-from-snapshot; re-run the retry for this order");
  }
  return buildOrder({
    bookTheme: info.bookTheme,
    photoRows: snapshot.photoRows,
    extraRows: snapshot.extraRows,
    fetchImage,
    externalId: shopifyOrderId,
    shipTo: info.shipTo,
    customer: info.customer,
    paid: {
      bookSlotKeys: getSlots(info.bookTheme).map((s) => s.key),
      maxExtras: EXTRAS_FREE_CAP + info.paidExtras,
    },
  });
}

/** Where the frozen copies of an order live in the photos bucket. */
export const frozenPrefix = (shopifyOrderId: string) => `print-orders/${shopifyOrderId}/`;

/**
 * Only an order recorded as `ready` may be built by hand, and only from its
 * own frozen copies. Returns the snapshot, or throws a clear reason.
 */
export function requireReadySnapshot(
  shopifyOrderId: string,
  row: { status: string; snapshot?: PrintSnapshot | null } | null
): PrintSnapshot {
  if (!row) throw new Error(`no print order recorded for Shopify order ${shopifyOrderId}`);
  if (row.status !== "ready") {
    throw new Error(`order ${shopifyOrderId} is "${row.status}", not ready — refusing to build it`);
  }
  if (!row.snapshot) throw new Error(`order ${shopifyOrderId} has no saved snapshot`);
  const prefix = frozenPrefix(shopifyOrderId);
  const outside = [...row.snapshot.photoRows, ...row.snapshot.extraRows]
    .map((r) => r.storage_path)
    .filter((p): p is string => typeof p === "string" && !p.startsWith(prefix));
  if (outside.length > 0) {
    throw new Error(`snapshot points outside ${prefix} (${outside[0]}) — refusing to read live files`);
  }
  return row.snapshot;
}

/** Wrap a fetcher so it can only read this order's frozen copies. */
export function frozenOnly(
  shopifyOrderId: string,
  fetchImage: (storagePath: string) => Promise<Buffer>
): (storagePath: string) => Promise<Buffer> {
  const prefix = frozenPrefix(shopifyOrderId);
  return async (p) => {
    if (!p.startsWith(prefix)) throw new Error(`refusing to read ${p}: not a frozen copy of order ${shopifyOrderId}`);
    return fetchImage(p);
  };
}
