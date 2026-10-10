/**
 * Build the order folder + ZIP for a READY print order, only from what was
 * frozen at payment: print_orders.snapshot and the copies under
 * print-orders/<order id>/ in the photos bucket. Never reads live session rows.
 * Refuses unless the order is "ready". Uses the same validation and XML as the
 * webhook. Sends nothing anywhere — the output is what would be handed to
 * Photo Finale by hand until delivery exists.
 *
 *   npm run print-order:build -- <numeric-shopify-order-id> [--out DIR]
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import { supabaseAdmin } from "@/lib/supabase-server";
import { buildFromSnapshot, frozenOnly, requireReadySnapshot } from "@/lib/print-orders/build-from-snapshot";
import { LocalFolderDestination, orderToZip, writeOrderFolder } from "@/lib/print-orders/destination";
import type { PrintSnapshot } from "@/lib/print-orders/paid-order";

async function main() {
  const args = process.argv.slice(2);
  const orderId = args[0];
  if (!orderId || orderId.startsWith("--") || !/^\d+$/.test(orderId)) {
    throw new Error("usage: print-order:build <numeric-shopify-order-id> [--out DIR]");
  }
  const outIdx = args.indexOf("--out");
  const outDir = path.resolve(outIdx >= 0 ? args[outIdx + 1] : "print-orders-out");

  const { data: row, error } = await supabaseAdmin
    .from("print_orders")
    .select("status, snapshot, external_id, print_count")
    .eq("shopify_order_id", orderId)
    .maybeSingle();
  if (error) throw new Error(`print_orders lookup failed: ${error.message}`);
  const snapshot = requireReadySnapshot(orderId, row ? { status: row.status as string, snapshot: row.snapshot as PrintSnapshot | null } : null);

  const download = async (storagePath: string): Promise<Buffer> => {
    const { data, error: dlError } = await supabaseAdmin.storage.from("photos").download(storagePath);
    if (dlError || !data) throw new Error(`download failed: ${dlError?.message ?? "no data"}`);
    return Buffer.from(await data.arrayBuffer());
  };
  const order = await buildFromSnapshot(orderId, snapshot, frozenOnly(orderId, download));

  // The rebuilt order must be the one that was recorded as ready.
  if (row!.external_id && row!.external_id !== order.folderName) {
    throw new Error(`rebuilt id ${order.folderName} differs from the recorded ${row!.external_id} — refusing`);
  }
  if (row!.print_count != null && row!.print_count !== order.printCount) {
    throw new Error(`rebuilt ${order.printCount} prints but ${row!.print_count} were recorded — refusing`);
  }

  const { location } = await writeOrderFolder(order, new LocalFolderDestination(outDir));
  const zipPath = path.join(outDir, `${order.folderName}.zip`);
  await fs.writeFile(zipPath, await orderToZip(order));
  console.log(`Order folder: ${location}`);
  console.log(`ZIP:          ${zipPath}`);
  console.log(`Prints: ${order.printCount}`, order.countBySize);
  console.log(`Destination (not used yet): ${order.destination.kind} dealer ${order.destination.dealer}`);
  for (const w of order.warnings) console.log(`WARNING: ${w}`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
