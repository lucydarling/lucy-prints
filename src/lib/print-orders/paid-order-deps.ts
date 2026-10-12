import { supabaseAdmin } from "@/lib/supabase-server";
import { sendPrintOrderAlert, sendPrintOrderHeld, sendPrintOrderReceived, resolveAppUrl } from "@/lib/email";
import { BOOK_THEMES, getSlots } from "@/lib/photo-slots";
import { allPrintVariantIds } from "./config";
import { loadSessionForPrint } from "./load-session";
import { getPrintedState } from "./printed";
import type { CommitResult, PaidOrderDeps, PrintSnapshot, RoundRecord } from "./paid-order";
import type { ReprintRow } from "./round";

/** Real dependencies (Supabase + env). Server-side only. */
export function realPaidOrderDeps(): PaidOrderDeps {
  return {
    printVariantIds: allPrintVariantIds(),
    loadSession: async (token) => {
      const l = await loadSessionForPrint(token);
      return { session: { id: l.session.id, book_theme: l.session.book_theme, baby_name: l.session.baby_name }, photoRows: l.photoRows, extraRows: l.extraRows, fetchImage: l.fetchImage };
    },
    loadRound: async (roundId) => {
      const { data, error } = await supabaseAdmin
        .from("print_rounds")
        .select("id, session_id, items, quantities, total_prints, status, expires_at")
        .eq("id", roundId)
        .maybeSingle();
      if (error) throw new Error(`print_rounds lookup failed: ${error.message}`);
      return (data ?? null) as RoundRecord | null;
    },
    loadReprints: async (sessionId) => {
      const { data, error } = await supabaseAdmin
        .from("print_reprints")
        .select("id, slot_key, storage_path, print_size, status")
        .eq("session_id", sessionId)
        .eq("status", "pending");
      if (error) throw new Error(`print_reprints lookup failed: ${error.message}`);
      return (data ?? []) as ReprintRow[];
    },
    loadPrinted: (sessionId) => getPrintedState(sessionId),
    roundUsedByOtherOrder: async (roundId, shopifyOrderId) => {
      const { data, error } = await supabaseAdmin
        .from("print_orders")
        .select("shopify_order_id")
        .eq("round_id", roundId)
        .in("status", ["ready", "sent", "error"])
        .neq("shopify_order_id", shopifyOrderId)
        .limit(1);
      if (error) throw new Error(`print_orders lookup failed: ${error.message}`);
      return (data ?? []).length > 0;
    },
    loadExisting: async (shopifyOrderId) => {
      const { data, error } = await supabaseAdmin
        .from("print_orders")
        .select("status, snapshot")
        .eq("shopify_order_id", shopifyOrderId)
        .maybeSingle();
      if (error) throw new Error(`print_orders lookup failed: ${error.message}`);
      return data ? { status: data.status as string, snapshot: (data.snapshot ?? undefined) as PrintSnapshot | undefined } : null;
    },
    // Copies are made inside the bucket under print-orders/<order id>/ — nothing is deleted or moved.
    freeze: async (shopifyOrderId, photoRows, extraRows) => {
      const copy = async (from: string) => {
        const to = `print-orders/${shopifyOrderId}/${from.replace(/\//g, "__")}`;
        const { error } = await supabaseAdmin.storage.from("photos").copy(from, to);
        // An existing copy (a retry that crashed half-way) is fine; anything else is not.
        if (error && !/already exists|Duplicate/i.test(error.message)) {
          throw new Error(`could not freeze ${from}: ${error.message}`);
        }
        return to;
      };
      const frozenPhotos = [];
      for (const r of photoRows) frozenPhotos.push({ ...r, storage_path: r.storage_path ? await copy(r.storage_path) : r.storage_path });
      const frozenExtras = [];
      for (const r of extraRows) frozenExtras.push({ ...r, storage_path: r.storage_path ? await copy(r.storage_path) : r.storage_path });
      return { frozenAt: new Date().toISOString(), photoRows: frozenPhotos, extraRows: frozenExtras };
    },
    commitRound: (args) => commitRound(args),
    alert: async (info) => {
      await sendPrintOrderAlert(info);
    },
    // At most one email of each kind per order: the sent-at column is checked first and
    // set after a successful send. If the column can't be read (migration 011 not applied)
    // nothing is sent — better silent than a duplicate.
    notify: async (n) => {
      const col = n.kind === "received" ? "received_email_sent_at" : "held_email_sent_at";
      const { data, error } = await supabaseAdmin
        .from("print_orders")
        .select(col)
        .eq("shopify_order_id", n.shopifyOrderId)
        .maybeSingle();
      if (error) throw new Error(`could not check ${col}: ${error.message}`);
      if ((data as Record<string, unknown> | null)?.[col]) return;
      const bookName = BOOK_THEMES.find((t) => t.id === n.bookTheme)?.name ?? n.bookTheme;
      const result =
        n.kind === "received"
          ? await sendPrintOrderReceived(n.to, {
              bookName, babyName: n.babyName, newPhotos: n.newPhotos, extraPrints: n.extraPrints, reprints: n.reprints,
              printedSoFar: n.printedSoFar, bookSlots: n.bookSlots, shipTo: n.shipTo, orderName: n.shopifyOrderName,
            })
          : await sendPrintOrderHeld(n.to, { resumeUrl: `${resolveAppUrl()}/resume/${n.sessionToken}`, orderName: n.shopifyOrderName });
      // A TEST_MODE skip is not a send: leave the column empty.
      if (result !== "sent") return;
      const { error: markError } = await supabaseAdmin
        .from("print_orders")
        .update({ [col]: new Date().toISOString() })
        .eq("shopify_order_id", n.shopifyOrderId);
      if (markError) console.error(`sent ${n.kind} email but could not record ${col}:`, markError.message);
    },
    record: async (r) => {
      const { error } = await supabaseAdmin.from("print_orders").upsert(
        {
          shopify_order_id: r.shopifyOrderId,
          shopify_order_name: r.shopifyOrderName ?? null,
          session_id: r.sessionId ?? null,
          status: r.status,
          reasons: r.reasons,
          warnings: r.warnings,
          snapshot: r.snapshot ?? null,
          external_id: r.externalId ?? null,
          print_count: r.printCount ?? null,
          round_id: r.roundId ?? null,
          paid_quantity: r.paidQuantity ?? null,
          ...(r.customerEmail ? { customer_email: r.customerEmail } : {}),
          test_mode: true,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "shopify_order_id" }
      );
      if (error) throw new Error(`print_orders write failed: ${error.message}`);
    },
  };
}

/**
 * Make a ready order's photos count as printed. Idempotent for the same order
 * (a webhook retry re-runs it harmlessly); an item already owned by ANOTHER
 * order returns { ok: false }. Never deletes or overwrites a file.
 */
async function commitRound(args: { shopifyOrderId: string; sessionId: string; roundId: string; snapshot: PrintSnapshot }): Promise<CommitResult> {
  const { shopifyOrderId, sessionId, roundId, snapshot } = args;
  const { data: orderRow, error: orderErr } = await supabaseAdmin
    .from("print_orders").select("id").eq("shopify_order_id", shopifyOrderId).maybeSingle();
  if (orderErr || !orderRow) throw new Error(`commit: print order ${shopifyOrderId} not found (${orderErr?.message ?? "no row"})`);
  const orderId = orderRow.id as string;

  const { data: existing, error: exErr } = await supabaseAdmin
    .from("print_order_items").select("print_order_id, kind, item_key, generation").eq("session_id", sessionId);
  if (exErr) throw new Error(`commit: could not read items: ${exErr.message}`);
  const items = (existing ?? []) as Array<{ print_order_id: string; kind: string; item_key: string; generation: number }>;

  const reprintSlots = new Set((snapshot.reprints ?? []).map((r) => r.slot_key));
  const rows: Array<Record<string, unknown>> = [];
  for (const r of snapshot.photoRows) {
    if (r.status === "empty" || !r.storage_path) continue;
    let generation = 1;
    if (reprintSlots.has(r.slot_key)) {
      const mine = items.find((i) => i.kind === "slot" && i.item_key === r.slot_key && i.print_order_id === orderId);
      generation = mine ? mine.generation : Math.max(1, ...items.filter((i) => i.kind === "slot" && i.item_key === r.slot_key).map((i) => i.generation)) + 1;
    }
    rows.push({ print_order_id: orderId, session_id: sessionId, kind: "slot", item_key: r.slot_key, generation, quantity: 1, print_size: r.print_size, frozen_path: r.storage_path });
  }
  for (const r of snapshot.extraRows) {
    if (!r.storage_path) continue;
    rows.push({ print_order_id: orderId, session_id: sessionId, kind: "extra", item_key: r.extra_id, generation: 1, quantity: r.quantity ?? 1, print_size: r.print_size, frozen_path: r.storage_path });
  }

  const { error: insErr } = await supabaseAdmin
    .from("print_order_items")
    .upsert(rows, { onConflict: "session_id,kind,item_key,generation", ignoreDuplicates: true });
  if (insErr) throw new Error(`commit: could not write items: ${insErr.message}`);

  // Every item must now belong to THIS order; one owned by another order is a double print.
  const { data: after, error: afErr } = await supabaseAdmin
    .from("print_order_items").select("print_order_id, kind, item_key, generation").eq("session_id", sessionId);
  if (afErr) throw new Error(`commit: could not verify items: ${afErr.message}`);
  const owner = new Map((after ?? []).map((i) => [`${i.kind}|${i.item_key}|${i.generation}`, i.print_order_id as string]));
  const clash = rows.filter((r) => owner.get(`${r.kind}|${r.item_key}|${r.generation}`) !== orderId);
  if (clash.length > 0) {
    return { ok: false, reason: `already printed by another order: ${clash.map((c) => String(c.item_key)).join(", ")}` };
  }

  await supabaseAdmin.from("print_rounds").update({ status: "paid" }).eq("id", roundId);

  // Reprints: mark included and move each slot's live pointer to the new photo (no file is touched).
  const reprintIds = (snapshot.reprints ?? []).map((r) => r.reprint_id);
  if (reprintIds.length > 0) {
    const { data: rps } = await supabaseAdmin
      .from("print_reprints").select("id, slot_key, storage_path, print_size").in("id", reprintIds);
    for (const rp of rps ?? []) {
      await supabaseAdmin
        .from("session_photos")
        .update({ storage_path: rp.storage_path, ...(rp.print_size ? { print_size: rp.print_size } : {}) })
        .eq("session_id", sessionId).eq("slot_key", rp.slot_key);
    }
    await supabaseAdmin
      .from("print_reprints")
      .update({ status: "included", included_in_order: orderId, updated_at: new Date().toISOString() })
      .in("id", reprintIds);
  }

  const printedSoFar = new Set((after ?? []).filter((i) => i.kind === "slot").map((i) => i.item_key as string)).size;
  const bookSlots = getSlots(snapshot.order?.bookTheme ?? "").length;
  return { ok: true, printedSoFar, bookSlots };
}
