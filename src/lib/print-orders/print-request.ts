import { BOOK_THEMES, getProductForTheme, getSlots } from "@/lib/photo-slots";
import { EXTRAS_FREE_CAP } from "./config";

/** The price tier a theme sells at ("retiring" books sell at the standard price). */
export function tierForTheme(themeId: string): "standard" | "luxury" | null {
  const t = BOOK_THEMES.find((b) => b.id === themeId);
  if (!t) return null;
  return t.tier === "luxury" ? "luxury" : "standard";
}

export interface PrintRequest {
  bookTheme: string;
  /** Book slots that have a photo (not extras). */
  filledBookSlots: number;
  /** Extra prints, counted by quantity. */
  extraPrints: number;
  /** Extra prints bought on top of the free allowance (from the paid order; 0 at the button). */
  paidExtras?: number;
  /** The tier of the print product the customer is paying for (the webhook knows it; the button picks it from the theme). */
  variantTier?: "standard" | "luxury";
}

export interface PrintRequestCheck {
  /** Things the customer must fix (button) / that refuse the order (webhook). */
  errors: string[];
  /** Nothing to print at all. The button blocks it; the webhook holds the order. */
  empty: boolean;
  printing: number;
  of: number;
  extras: number;
  maxExtras: number;
}

/**
 * ONE function for "can this be printed?" — called by the checkout button
 * (before the customer pays) and by the orders/paid webhook (after). Anything
 * a customer can cause must be caught here, so a refusal at the webhook is
 * unreachable in normal use. It reads only what it is given: the button
 * passes the customer's own counts, the webhook passes the frozen snapshot's.
 */
export function validatePrintRequest(r: PrintRequest): PrintRequestCheck {
  const errors: string[] = [];
  const maxExtras = EXTRAS_FREE_CAP + (r.paidExtras ?? 0);
  const theme = BOOK_THEMES.find((b) => b.id === r.bookTheme);
  if (!r.bookTheme) {
    errors.push("no book is selected");
  } else if (!theme) {
    errors.push(`unknown book "${r.bookTheme}"`);
  } else if (getProductForTheme(r.bookTheme) !== "memory_book") {
    errors.push(`${theme.name} cannot be printed through the Photo Lab yet`);
  }
  if (theme && r.variantTier && tierForTheme(r.bookTheme) !== r.variantTier) {
    errors.push(`paid for the ${r.variantTier} print product but ${r.bookTheme} is a ${tierForTheme(r.bookTheme)} book`);
  }
  if (r.extraPrints > maxExtras) {
    errors.push(`${r.extraPrints} extra prints is over the limit of ${maxExtras} — please choose ${maxExtras} extras to print`);
  }
  return {
    errors,
    empty: r.filledBookSlots + r.extraPrints === 0,
    printing: r.filledBookSlots,
    of: theme ? getSlots(r.bookTheme).length : 0,
    extras: r.extraPrints,
    maxExtras,
  };
}

/** The line the checkout button shows before redirecting to Shopify. */
export function printingMessage(c: PrintRequestCheck): string {
  const extras = c.extras > 0 ? ` plus ${c.extras} extra print${c.extras === 1 ? "" : "s"}` : "";
  return `You're printing ${c.printing} of ${c.of} photos${extras}`;
}
