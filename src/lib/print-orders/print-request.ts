import { BOOK_THEMES, getProductForTheme, getSlots } from "@/lib/photo-slots";
import { MAX_EXTRAS_PER_ORDER, MIN_PRINTS_PER_ORDER } from "./config";

/** The counts for one round — what the next order would print. */
export interface PrintRequest {
  bookTheme: string;
  /** Book photos not yet printed. */
  newPhotos: number;
  /** Extra prints not yet printed, counted by quantity. */
  extraPrints: number;
  /** Pending paid reprints. */
  reprints: number;
  /** Distinct book slots already printed (for the progress line). */
  printedSoFar?: number;
}

export interface PrintRequestCheck {
  /** Things the customer must fix. */
  errors: string[];
  /** Nothing new to print at all. */
  empty: boolean;
  newPhotos: number;
  extras: number;
  reprints: number;
  total: number;
  printedSoFar: number;
  /** Slots in the whole book (the "49"). */
  of: number;
}

/**
 * ONE function for "can this round be printed?" — the checkout route calls it
 * before the customer pays, and the webhook calls it on the round it recorded.
 */
export function validatePrintRequest(r: PrintRequest): PrintRequestCheck {
  const errors: string[] = [];
  const theme = BOOK_THEMES.find((b) => b.id === r.bookTheme);
  if (!r.bookTheme) {
    errors.push("no book is selected");
  } else if (!theme) {
    errors.push(`unknown book "${r.bookTheme}"`);
  } else if (getProductForTheme(r.bookTheme) !== "memory_book") {
    errors.push(`${theme.name} cannot be printed through the Photo Lab yet`);
  }
  const total = r.newPhotos + r.extraPrints + r.reprints;
  const empty = total === 0;
  if (empty) {
    errors.push("there is nothing new to print yet — add and save some photos first");
  } else if (total < MIN_PRINTS_PER_ORDER) {
    errors.push(`an order needs at least ${MIN_PRINTS_PER_ORDER} prints — you have ${total} so far. Add ${MIN_PRINTS_PER_ORDER - total} more and try again.`);
  }
  if (r.extraPrints > MAX_EXTRAS_PER_ORDER) {
    errors.push(`${r.extraPrints} extra prints in one order looks like a mistake — please check your extras`);
  }
  return {
    errors,
    empty,
    newPhotos: r.newPhotos,
    extras: r.extraPrints,
    reprints: r.reprints,
    total,
    printedSoFar: r.printedSoFar ?? 0,
    of: theme ? getSlots(r.bookTheme).length : 0,
  };
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** The line the confirm step shows before redirecting to Shopify. */
export function printingMessage(c: PrintRequestCheck): string {
  const parts = [
    c.newPhotos > 0 ? plural(c.newPhotos, "new photo") : "",
    c.extras > 0 ? plural(c.extras, "extra print") : "",
    c.reprints > 0 ? plural(c.reprints, "reprint") : "",
  ].filter(Boolean);
  const list = parts.length > 1 ? `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}` : parts[0] ?? "nothing new";
  return `You're printing ${list}. ${c.printedSoFar} of ${c.of} printed so far.`;
}
