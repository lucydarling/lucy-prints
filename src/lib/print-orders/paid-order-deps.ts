import { supabaseAdmin } from "@/lib/supabase-server";
import { SHOPIFY_VARIANTS } from "@/lib/shopify";
import { sendPrintOrderAlert } from "@/lib/email";
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
      return { session: { id: l.session.id, book_theme: l.session.book_theme }, photoRows: l.photoRows, extraRows: l.extraRows, fetchImage: l.fetchImage };
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
          test_mode: true,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "shopify_order_id" }
      );
      if (error) throw new Error(`print_orders write failed: ${error.message}`);
    },
  };
}
