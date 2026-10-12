import { getBookSlots, parsePrintLabel, regionChoicesFromStoredPhotos, type PrintSize } from "@/lib/photo-slots";
import {
  PRICE_CENTS_BY_VARIANT_KEY,
  SHIPPING_AND_HANDLING_CENTS,
  variantIdForKey,
  variantKeyFor,
  type PrintItemKind,
  type PrintVariantKey,
} from "./config";
import type { SessionExtraRow, SessionPhotoRow } from "./build-order";
import type { PrintedState } from "./printed";

/** One pending replacement crop for an already-printed slot (print_reprints row). */
export interface ReprintRow {
  id: string;
  slot_key: string;
  storage_path: string;
  print_size: string | null;
  status?: string;
}

/** Exactly what one checkout click will print. Recorded before payment (print_rounds.items). */
export interface RoundItems {
  slots: Array<{ slot_key: string }>;
  extras: Array<{ extra_id: string; quantity: number }>;
  reprints: Array<{ reprint_id: string; slot_key: string }>;
}

export interface RoundSummary {
  items: RoundItems;
  /** Prints per Shopify variant id. */
  quantities: Record<string, number>;
  newPhotos: number;
  extras: number;
  reprints: number;
  total: number;
  /** Prints by variant key, for the price breakdown. */
  byKey: Partial<Record<PrintVariantKey, number>>;
}

export interface RoundInput {
  bookTheme: string;
  photoRows: SessionPhotoRow[];
  extraRows: SessionExtraRow[];
  reprintRows: ReprintRow[];
  printed: PrintedState;
  /** Resolves a variant key to its Shopify id (injectable for tests). */
  variantId?: (key: PrintVariantKey) => string;
}

/** The size each book slot prints at, exactly as buildOrder resolves it. */
export function slotSizes(bookTheme: string, photoRows: SessionPhotoRow[]): Map<string, PrintSize> {
  const choices = regionChoicesFromStoredPhotos(
    bookTheme,
    Object.fromEntries(photoRows.map((r) => [r.slot_key, { printSize: r.print_size }]))
  );
  return new Map(getBookSlots(bookTheme, choices).map((s) => [s.key, s.size]));
}

/**
 * What the next order would print: book photos not yet printed, extras not yet
 * printed, and pending reprints of printed slots. Pure — reads only what it is given.
 */
export function computeRound(r: RoundInput): RoundSummary {
  const variantId = r.variantId ?? ((k: PrintVariantKey) => variantIdForKey(k));
  const sizes = slotSizes(r.bookTheme, r.photoRows);
  const items: RoundItems = { slots: [], extras: [], reprints: [] };
  const quantities: Record<string, number> = {};
  const byKey: Partial<Record<PrintVariantKey, number>> = {};
  const add = (size: PrintSize | undefined, kind: PrintItemKind, qty: number) => {
    const key = variantKeyFor(size ?? "4x4", kind);
    byKey[key] = (byKey[key] ?? 0) + qty;
    const id = variantId(key);
    quantities[id] = (quantities[id] ?? 0) + qty;
  };

  for (const row of r.photoRows) {
    if (!row.storage_path || row.status === "empty") continue;
    if (!sizes.has(row.slot_key)) continue; // not a slot of this book
    if (r.printed.slots.has(row.slot_key)) continue; // printed: locked, only a reprint can print it again
    items.slots.push({ slot_key: row.slot_key });
    add(sizes.get(row.slot_key), "book", 1);
  }
  for (const row of r.extraRows) {
    if (!row.storage_path || r.printed.extras.has(row.extra_id)) continue;
    const quantity = row.quantity ?? 0;
    if (quantity < 1) continue;
    items.extras.push({ extra_id: row.extra_id, quantity });
    add(parsePrintLabel(row.print_size)?.size, "extra", quantity);
  }
  for (const rp of r.reprintRows) {
    if (rp.status && rp.status !== "pending") continue;
    if (!r.printed.slots.has(rp.slot_key)) continue; // only a printed slot can be reprinted
    items.reprints.push({ reprint_id: rp.id, slot_key: rp.slot_key });
    add(sizes.get(rp.slot_key) ?? parsePrintLabel(rp.print_size)?.size, "reprint", 1);
  }

  const extras = items.extras.reduce((n, e) => n + e.quantity, 0);
  return {
    items,
    quantities,
    newPhotos: items.slots.length,
    extras,
    reprints: items.reprints.length,
    total: items.slots.length + extras + items.reprints.length,
    byKey,
  };
}

/** Variants whose paid quantity differs from the round's (empty = they match exactly). */
export function quantityMismatches(paid: Record<string, number>, round: Record<string, number>): string[] {
  const out: string[] = [];
  for (const id of new Set([...Object.keys(paid), ...Object.keys(round)])) {
    if ((paid[id] ?? 0) !== (round[id] ?? 0)) out.push(`variant ${id}: paid ${paid[id] ?? 0}, round has ${round[id] ?? 0}`);
  }
  return out;
}

/** Price lines for the confirm step, from the (placeholder) config prices. */
export function priceBreakdown(byKey: Partial<Record<PrintVariantKey, number>>) {
  const lines = (Object.keys(byKey) as PrintVariantKey[]).map((k) => {
    const quantity = byKey[k] ?? 0;
    const unitCents = PRICE_CENTS_BY_VARIANT_KEY[k];
    return { key: k, quantity, unitCents, cents: quantity * unitCents };
  });
  const printsCents = lines.reduce((n, l) => n + l.cents, 0);
  return { lines, printsCents, shippingCents: SHIPPING_AND_HANDLING_CENTS, totalCents: printsCents + SHIPPING_AND_HANDLING_CENTS };
}
export const dollars = (cents: number) => `$${(cents / 100).toFixed(2)}`;
