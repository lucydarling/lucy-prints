import { buildFreshCartCheckoutUrl } from "@/lib/shopify";
import { printingMessage, validatePrintRequest } from "./print-request";
import { computeRound, priceBreakdown, type ReprintRow, type RoundSummary } from "./round";
import { printedSlotCount, type PrintedState } from "./printed";
import type { SessionExtraRow, SessionPhotoRow } from "./build-order";

export type CheckoutPrepared =
  | {
      ok: true;
      url: string;
      message: string;
      roundId: string;
      newPhotos: number;
      extras: number;
      reprints: number;
      total: number;
      printedSoFar: number;
      of: number;
      price: ReturnType<typeof priceBreakdown>;
    }
  | { ok: false; errors: string[] };

/**
 * What the "Print my photos" button may do for a saved book, decided from the
 * rows in the database (not the browser's copy): block with reasons, or record
 * the round and return the line to confirm and the Shopify checkout URL.
 * The route supplies the rows; `createRound` writes the print_rounds row and
 * returns its id (the only side effect).
 */
export async function prepareCheckout(input: {
  token: string;
  bookTheme: string;
  photoRows: SessionPhotoRow[];
  extraRows: SessionExtraRow[];
  reprintRows: ReprintRow[];
  printed: PrintedState;
  createRound: (round: RoundSummary) => Promise<string>;
  /** Throws if the Shopify variant env vars are missing. */
  buildUrl?: typeof buildFreshCartCheckoutUrl;
  variantId?: Parameters<typeof computeRound>[0]["variantId"];
}): Promise<CheckoutPrepared> {
  const round = computeRound({
    bookTheme: input.bookTheme,
    photoRows: input.photoRows,
    extraRows: input.extraRows,
    reprintRows: input.reprintRows,
    printed: input.printed,
    variantId: input.variantId,
  });
  const check = validatePrintRequest({
    bookTheme: input.bookTheme,
    newPhotos: round.newPhotos,
    extraPrints: round.extras,
    reprints: round.reprints,
    printedSoFar: printedSlotCount(input.printed),
  });
  if (check.errors.length > 0) return { ok: false, errors: check.errors };

  const roundId = await input.createRound(round);
  const url = (input.buildUrl ?? buildFreshCartCheckoutUrl)({
    quantities: round.quantities,
    sessionToken: input.token,
    bookTheme: input.bookTheme,
    roundId,
    printCount: round.total,
  });
  return {
    ok: true,
    url,
    message: printingMessage(check),
    roundId,
    newPhotos: round.newPhotos,
    extras: round.extras,
    reprints: round.reprints,
    total: round.total,
    printedSoFar: check.printedSoFar,
    of: check.of,
    price: priceBreakdown(round.byKey),
  };
}
