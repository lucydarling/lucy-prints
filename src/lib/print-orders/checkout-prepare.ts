import { buildFreshCartCheckoutUrl } from "@/lib/shopify";
import { printingMessage, tierForTheme, validatePrintRequest } from "./print-request";
import type { PrintLock } from "./freeze";
import type { SessionExtraRow, SessionPhotoRow } from "./build-order";

export type CheckoutPrepared =
  | { ok: true; url: string; message: string; printing: number; of: number; extras: number }
  | { ok: false; errors: string[] };

/**
 * What the "Print my photos" button may do for a saved book, decided from the
 * rows in the database (not the browser's copy): block with reasons, or return
 * the line to confirm and the Shopify checkout URL. Pure — the route supplies
 * the rows and the lock. Counts the same way the orders/paid webhook does
 * (a slot with a stored file and a status other than "empty").
 */
export function prepareCheckout(input: {
  token: string;
  bookTheme: string;
  photoRows: SessionPhotoRow[];
  extraRows: SessionExtraRow[];
  lock: PrintLock;
  /** Throws if the Shopify variant env vars are missing. */
  buildUrl?: typeof buildFreshCartCheckoutUrl;
}): CheckoutPrepared {
  const { bookTheme, lock } = input;
  if (lock === "frozen") return { ok: false, errors: ["this book already has a print order — start a new book to order again"] };
  if (lock === "held") return { ok: false, errors: ["your print order is waiting for photos — add photos to this book to finish it"] };

  const filledBookSlots = input.photoRows.filter((r) => r.storage_path && r.status !== "empty").length;
  const extraPrints = input.extraRows.filter((r) => r.storage_path).reduce((n, r) => n + (r.quantity ?? 0), 0);
  const check = validatePrintRequest({ bookTheme, filledBookSlots, extraPrints });
  const errors = [...check.errors];
  if (check.empty && errors.length === 0) errors.push("there are no saved photos to print yet — add and save some photos first");
  const tier = tierForTheme(bookTheme);
  if (errors.length > 0 || !tier) return { ok: false, errors: errors.length > 0 ? errors : ["this book cannot be printed"] };

  const url = (input.buildUrl ?? buildFreshCartCheckoutUrl)({
    tier,
    sessionToken: input.token,
    bookTheme,
    photoCount: filledBookSlots,
  });
  return { ok: true, url, message: printingMessage(check), printing: check.printing, of: check.of, extras: check.extras };
}
