import { rebuildRecordedOrder, type RecordedOrderRow } from "./build-from-snapshot";
import { RESEND_ENABLED, resolveDestination, type Destination } from "./config";
import type { OrderDestination } from "./destination";

export const RESEND_DISABLED_MESSAGE =
  "resend disabled until Photo Finale confirms how a repeated external_id is handled";

export interface DeliverDeps {
  loadRow: (shopifyOrderId: string) => Promise<RecordedOrderRow | null>;
  download: (storagePath: string) => Promise<Buffer>;
  /** Where to write; given the folder name to use (the order id, or a resend name). */
  destinationFor: (dest: Destination, folderName: string) => OrderDestination;
  /**
   * Mark the order sent, only if it is still `fromStatus`. Returns false when
   * no row changed (someone else got there first).
   */
  markSent: (shopifyOrderId: string, fromStatus: string, dest: Destination, sentAt: string) => Promise<boolean>;
  warn: (msg: string) => void;
  now?: () => Date;
  resendEnabled?: boolean;
  destination?: Destination;
}

export interface DeliverResult {
  folderName: string;
  location: string;
  destination: Destination;
  printCount: number;
  warnings: string[];
  resend: boolean;
}

/**
 * Send one recorded print order to the destination, exactly once.
 * - Builds from the snapshot with the same code as print-order:build.
 * - Refuses unless the order is ready. A sent order needs --force, and even
 *   then re-sending stays disabled until RESEND_ENABLED.
 * - The order is marked sent only after the folder is in the hotfolder. If
 *   anything fails before that, the order stays ready and a retry starts clean.
 */
export async function deliverPrintOrder(
  shopifyOrderId: string,
  opts: { force?: boolean },
  deps: DeliverDeps
): Promise<DeliverResult> {
  if (!/^\d+$/.test(shopifyOrderId)) throw new Error(`not a numeric Shopify order id: ${shopifyOrderId}`);
  const dest = deps.destination ?? resolveDestination();
  const row = await deps.loadRow(shopifyOrderId);
  if (!row) throw new Error(`no print order recorded for Shopify order ${shopifyOrderId}`);

  let resend = false;
  if (row.status === "sent") {
    if (!opts.force) throw new Error(`order ${shopifyOrderId} was already sent — refusing (use --force to re-send)`);
    deps.warn(`WARNING: --force on an order that was already sent (${shopifyOrderId}). This would print it a second time.`);
    if (!(deps.resendEnabled ?? RESEND_ENABLED)) throw new Error(RESEND_DISABLED_MESSAGE);
    resend = true;
  } else if (row.status !== "ready") {
    throw new Error(`order ${shopifyOrderId} is "${row.status}", not ready — refusing to deliver it`);
  }

  const order = await rebuildRecordedOrder(shopifyOrderId, row, deps.download, resend ? ["sent"] : ["ready"]);
  const now = (deps.now ?? (() => new Date()))();
  const folderName = resend ? `${order.folderName}-resend-${now.toISOString().replace(/\D/g, "").slice(0, 14)}` : order.folderName;

  const { location } = await deps.destinationFor(dest, folderName).writeOrder(order);

  let changed: boolean;
  try {
    changed = await deps.markSent(shopifyOrderId, row.status, dest, now.toISOString());
  } catch (err) {
    throw new Error(
      `order folder was delivered to ${location} but marking ${shopifyOrderId} sent failed (${(err as Error).message}) — set it to sent by hand; do not re-run`
    );
  }
  if (!changed) {
    throw new Error(
      `order folder was delivered to ${location} but print_orders for ${shopifyOrderId} was no longer "${row.status}" — check it by hand; do not re-run`
    );
  }
  return { folderName, location, destination: dest, printCount: order.printCount, warnings: order.warnings, resend };
}
