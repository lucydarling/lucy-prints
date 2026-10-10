/**
 * Deliver one READY print order to the print hotfolder in Dropbox, then mark it sent.
 *
 *   npm run print-order:deliver -- <numeric-shopify-order-id> [--force]
 *
 * Builds from print_orders.snapshot and the frozen copies only (same code as
 * print-order:build). Uploads into DROPBOX_ROOT_PATH/staging first, then moves
 * the finished folder into the destination's hotfolder (demo while testing).
 * Refuses unless the order is ready. A sent order needs --force, and re-sending
 * is disabled until RESEND_ENABLED in config.ts. A failure before the move
 * leaves the order ready; just run it again.
 */
import { deliverPrintOrder } from "@/lib/print-orders/deliver";
import { loadRecordedRow, markSent } from "@/lib/print-orders/delivery-deps";
import { DropboxDestination, dropboxClientFor } from "@/lib/print-orders/dropbox-destination";
import { downloadPhoto } from "@/lib/print-orders/storage";

async function main() {
  const args = process.argv.slice(2);
  const orderId = args.find((a) => !a.startsWith("--"));
  const unknown = args.filter((a) => a.startsWith("--") && a !== "--force");
  if (!orderId || !/^\d+$/.test(orderId) || unknown.length > 0) {
    throw new Error("usage: print-order:deliver <numeric-shopify-order-id> [--force]");
  }
  const runId = `${Date.now()}`;
  const r = await deliverPrintOrder(orderId, { force: args.includes("--force") }, {
    loadRow: loadRecordedRow,
    download: downloadPhoto,
    destinationFor: (dest, folderName) => new DropboxDestination(dropboxClientFor(dest), dest, { runId, folderName }),
    markSent,
    warn: (m) => console.warn(m),
  });
  console.log(`Delivered ${r.folderName} (${r.printCount} prints) to ${r.location}`);
  console.log(`Destination: ${r.destination.kind} (${r.destination.dealer}). print_orders → sent.`);
  for (const w of r.warnings) console.log(`WARNING: ${w}`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
