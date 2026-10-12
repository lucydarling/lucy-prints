import { supabaseAdmin } from "@/lib/supabase-server";
import { SHOPIFY_VARIANTS } from "@/lib/shopify";
import { sendPrintOrderAlert, sendPrintOrderHeld, sendPrintOrderReceived, resolveAppUrl } from "@/lib/email";
import { BOOK_THEMES } from "@/lib/photo-slots";
import { loadSessionForPrint } from "./load-session";
import type { PaidOrderDeps, PrintSnapshot } from "./paid-order";

/** Real dependencies (Supabase + env). Server-side only. */
export function realPaidOrderDeps(): PaidOrderDeps {
  return {
    variants: {
      standardVariantId: SHOPIFY_VARIANTS.standard,
      luxuryVariantId: SHOPIFY_VARIANTS.luxury,
      extraVariantIds: (process.env.SHOPIFY_EXTRA_PRINT_VARIANT_IDS ?? "").split(",").map((x) => x.trim()).filter(Boolean),
    },
    loadSession: async (token) => {
      const l = await loadSessionForPrint(token);
      return { session: { id: l.session.id, book_theme: l.session.book_theme, baby_name: l.session.baby_name }, photoRows: l.photoRows, extraRows: l.extraRows, fetchImage: l.fetchImage };
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
              bookName, babyName: n.babyName, bookPrints: n.bookPrints, extraPrints: n.extraPrints,
              shipTo: n.shipTo, orderName: n.shopifyOrderName,
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
    otherReadyOrderForSession: async (sessionId, shopifyOrderId) => {
      const { data, error } = await supabaseAdmin
        .from("print_orders")
        .select("shopify_order_id")
        .eq("session_id", sessionId)
        .in("status", ["ready", "sent", "error"])
        .neq("shopify_order_id", shopifyOrderId)
        .limit(1);
      if (error) throw new Error(`print_orders lookup failed: ${error.message}`);
      return (data ?? []).length > 0;
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
