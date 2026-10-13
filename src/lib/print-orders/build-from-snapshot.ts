import { maxExtrasPerOrder } from "./config";
import { buildOrder, type BuiltOrder } from "./build-order";
import type { PrintSnapshot } from "./paid-order";
import { getSlots } from "@/lib/photo-slots";

/**
 * Build the order folder from the photos frozen at payment — and from nothing
 * else. The snapshot carries the frozen rows of that round (pointing at copies under
 * print-orders/<order id>/), the book and the ship-to, so no
 * live session row is ever read. The webhook and the manual
 * `print-order:build` script both call this, so they validate and write the
 * same XML.
 */
export async function buildFromSnapshot(
  shopifyOrderId: string,
  snapshot: PrintSnapshot,
  fetchImage: (storagePath: string) => Promise<Buffer>,
  /** The prints this order was charged for (the round's total), when known. */
  expectedPrintCount?: number
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
    expectedPrintCount,
    paid: {
      bookSlotKeys: getSlots(info.bookTheme).map((s) => s.key),
      maxExtras: maxExtrasPerOrder(info.bookTheme),
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
  row: { status: string; snapshot?: PrintSnapshot | null } | null,
  /** Statuses allowed to build. Only a re-send passes "sent" as well. */
  allowed: string[] = ["ready"]
): PrintSnapshot {
  if (!row) throw new Error(`no print order recorded for Shopify order ${shopifyOrderId}`);
  if (!allowed.includes(row.status)) {
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

export interface RecordedOrderRow {
  status: string;
  snapshot: PrintSnapshot | null;
  external_id: string | null;
  print_count: number | null;
}

/**
 * Rebuild a recorded order exactly as it was recorded: from its snapshot and
 * frozen copies only, refusing unless the status is allowed and the rebuilt
 * id and print count match the row. Used by print-order:build and print-order:deliver.
 */
export async function rebuildRecordedOrder(
  shopifyOrderId: string,
  row: RecordedOrderRow | null,
  download: (storagePath: string) => Promise<Buffer>,
  allowed: string[] = ["ready"]
): Promise<BuiltOrder> {
  const snapshot = requireReadySnapshot(shopifyOrderId, row, allowed);
  const order = await buildFromSnapshot(shopifyOrderId, snapshot, frozenOnly(shopifyOrderId, download));
  if (row!.external_id && row!.external_id !== order.folderName) {
    throw new Error(`rebuilt id ${order.folderName} differs from the recorded ${row!.external_id} — refusing`);
  }
  if (row!.print_count != null && row!.print_count !== order.printCount) {
    throw new Error(`rebuilt ${order.printCount} prints but ${row!.print_count} were recorded — refusing`);
  }
  return order;
}
