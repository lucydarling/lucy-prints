import { supabaseAdmin } from "@/lib/supabase-server";
import { SHOPIFY_VARIANTS } from "@/lib/shopify";
import { loadSessionForPrint } from "./load-session";
import type { PaidOrderDeps } from "./paid-order";

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
    otherReadyOrderForSession: async (sessionId, shopifyOrderId) => {
      const { data, error } = await supabaseAdmin
        .from("print_orders")
        .select("shopify_order_id")
        .eq("session_id", sessionId)
        .eq("status", "ready")
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
