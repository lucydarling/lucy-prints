import { supabaseAdmin } from "@/lib/supabase-server";

/**
 * What has already been printed for a session, from print_order_items (a row
 * is written only when an order becomes ready, so a row = printed). Printed
 * slots and extras are locked; everything else stays editable, and the
 * session as a whole never locks.
 */
export interface PrintedState {
  /** slot_key → highest generation printed (1 = first print, 2+ = paid reprints). */
  slots: Map<string, number>;
  /** extra_id of every printed extra. */
  extras: Set<string>;
}

export const emptyPrinted = (): PrintedState => ({ slots: new Map(), extras: new Set() });

export const PRINTED_SLOT_MESSAGE =
  "This photo has already been printed, so it can't be changed or removed. To replace it, choose Replace photo — that's a paid reprint included in your next order.";
export const PRINTED_EXTRA_MESSAGE =
  "This extra print has already been printed, so it can't be changed or removed. Add a new extra if you'd like another.";

export interface PrintedItemRow {
  kind: string;
  item_key: string;
  generation: number | null;
}

export function printedStateFromItems(rows: PrintedItemRow[]): PrintedState {
  const state = emptyPrinted();
  for (const r of rows) {
    if (r.kind === "slot") state.slots.set(r.item_key, Math.max(state.slots.get(r.item_key) ?? 0, r.generation ?? 1));
    else if (r.kind === "extra") state.extras.add(r.item_key);
  }
  return state;
}

/**
 * Fails OPEN (nothing printed) if the lookup errors or the table does not exist
 * yet (migration 012 not applied): what prints in an order is fixed by the
 * frozen copies, so a missed lock can never change a printed order; a customer
 * blocked by an outage would be worse.
 */
export async function getPrintedState(sessionId: string): Promise<PrintedState> {
  const { data, error } = await supabaseAdmin
    .from("print_order_items")
    .select("kind, item_key, generation")
    .eq("session_id", sessionId);
  if (error) {
    // 42P01 / PGRST205 = table not created yet.
    if (!/42P01|PGRST205|does not exist|schema cache/i.test(`${error.code ?? ""} ${error.message}`)) {
      console.error("printed state lookup failed:", error);
    }
    return emptyPrinted();
  }
  return printedStateFromItems((data ?? []) as PrintedItemRow[]);
}

/** Progress for the labels: distinct book slots printed, out of the book's slots. */
export const printedSlotCount = (s: PrintedState) => s.slots.size;

/**
 * The one rule for what a printed slot/extra refuses, shared by the upload and
 * delete routes. Returns null when the request may go ahead, otherwise the
 * HTTP status and body to answer with:
 *  - an upload/recrop/delete on a printed slot or extra → 409 (a slot's body offers a reprint);
 *  - a reprint of something that isn't a printed book slot → 400.
 */
export function lockDecision(
  printed: PrintedState,
  req: { isExtra: boolean; key: string; reprint?: boolean }
): { status: number; body: Record<string, unknown> } | null {
  if (req.reprint) {
    if (req.isExtra || !printed.slots.has(req.key)) {
      return { status: 400, body: { error: "Only a photo that has already been printed can be replaced with a reprint" } };
    }
    return null;
  }
  if (req.isExtra) {
    return printed.extras.has(req.key) ? { status: 409, body: { error: PRINTED_EXTRA_MESSAGE, printed: true } } : null;
  }
  return printed.slots.has(req.key) ? { status: 409, body: { error: PRINTED_SLOT_MESSAGE, printed: true, canReprint: true } } : null;
}
