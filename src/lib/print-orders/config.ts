import { getPrintDimensions, getProductForTheme, isAlwaysPaddedTo4x4, type PrintSize } from "@/lib/photo-slots";

/**
 * Everything about print orders that is not yet known. Each value marked
 * PLACEHOLDER must be confirmed with Photo Finale / Persnickety before any
 * order is delivered. Only the demo dealer's product codes are real.
 */

/** PLACEHOLDER — confirm with Photo Finale/Persnickety: name of this system in `apm_order/@vendor`. */
export const VENDOR_NAME = "Lucy Darling Photo Lab";

/** PLACEHOLDER — confirm with Photo Finale/Persnickety: must match an active shipping method of this type. */
export const DEFAULT_DELIVERY_TYPE = "standard" as const;

/** While true, every external_id is prefixed so test orders can't be mistaken for real ones. */
export const TEST_MODE = true;
export const TEST_ID_PREFIX = "TEST-";

/**
 * Where orders go. Testing goes to a separate DEMO dealer account (its own
 * hotfolder), never the real one. Only two combinations are allowed:
 *   - "demo": the default. Requires TEST_MODE on.
 *   - "live": only when the env var PRINT_DESTINATION=live is set AND TEST_MODE is off.
 * Anything else throws. LIVE_DELIVERY_ALLOWED additionally blocks every write to
 * the live hotfolder until delivery has been proven on the demo dealer.
 */
export type DestinationKind = "demo" | "live";
export interface Destination {
  kind: DestinationKind;
  dealer: string;
  /** Hotfolder name under DROPBOX_ROOT_PATH. */
  hotfolder: DestinationKind;
}
/**
 * Photo Finale DealerCodes (2026-10-14). A label for logs only: the code itself
 * is set in pfRouter's config on the Windows machine, never in the XML.
 */
const DEALERS: Record<DestinationKind, string> = {
  demo: "dealer 3404",
  live: "dealer 4013",
};
export const LIVE_DELIVERY_ALLOWED = false;

export function resolveDestination(
  envValue: string | undefined = process.env.PRINT_DESTINATION,
  testMode: boolean = TEST_MODE
): Destination {
  const want = (envValue ?? "").trim() || "demo";
  if (want === "demo") {
    if (!testMode) throw new Error("PRINT_DESTINATION is demo but TEST_MODE is off — refusing (real ids must not go to the demo dealer)");
    return { kind: "demo", dealer: DEALERS.demo, hotfolder: "demo" };
  }
  if (want === "live") {
    if (testMode) throw new Error("PRINT_DESTINATION=live but TEST_MODE is on — refusing");
    return { kind: "live", dealer: DEALERS.live, hotfolder: "live" };
  }
  throw new Error(`PRINT_DESTINATION must be "demo" or "live" (got "${want}")`);
}

/**
 * Re-sending an order that was already sent (`print-order:deliver --force`).
 * Built but OFF until Photo Finale confirms how pfRouter treats a repeated external_id.
 */
export const RESEND_ENABLED = false;

/** Files smaller than this are treated as broken (a real 300 DPI print is hundreds of KB). */
export const MIN_VALID_IMAGE_BYTES = 5_000;

export interface PrintProductConfig {
  /** The dealer's product code (from PRODUCT_CODES). Derived by productEntry — never set by hand. */
  productCode: string;
  /**
   * The product's paper shape: long side ÷ short side (1 = square, 1.5 = 4x6).
   * Derived by productEntry from printedAs — never set by hand.
   * Photo Finale: one code covers both orientations, and pfRouter SILENTLY
   * center-crops any file whose shape differs — so the builder refuses a file
   * whose shape (after padding) is not this.
   */
  aspect: number;
  /**
   * "native": the file is the print's own size.
   * "sheet": the file is placed on a sheet of `sheetWidth`×`sheetHeight` px
   * (bottom-left, white padding top/right, no trim guides) and ordered as that sheet size.
   */
  printedAs: "native" | "sheet";
  /** Only for printedAs "sheet". */
  sheetWidth?: number;
  sheetHeight?: number;
  /** Only for printedAs "sheet": the paper the sheet is ordered as (whose product code it takes). */
  sheetPaper?: Paper;
}

/** One product as configured by hand; `aspect` and `productCode` are derived, never typed in. */
export type ProductSpec = Omit<PrintProductConfig, "aspect" | "productCode">;

/**
 * The papers a dealer sells. 3.5x3.5 has none: it is always ordered on the 4x4 sheet.
 * Each dealer has its own product codes; one code covers both orientations.
 */
export type Paper = Exclude<PrintSize, "3.5x3.5">;
export type ProductCodes = Record<Paper, string>;
export const PRODUCT_CODES: Record<DestinationKind, ProductCodes> = {
  // Demo dealer 3404 (Photo Finale, 2026-10-22).
  demo: {
    "3x3": "7364", // 3x3 Press Print
    "4x3": "7960", // 3x4 Matte; only used if 4x3 is switched to native (today it prints on the 4x4 sheet)
    "4x4": "7963",
    "4x6": "7965",
    "5x5": "7969",
  },
  // PLACEHOLDER — live dealer 4013's codes, waiting on Chari.
  live: {
    "3x3": "TBD-3X3",
    "4x3": "TBD-4X3",
    "4x4": "TBD-4X4",
    "4x6": "TBD-4X6",
    "5x5": "TBD-5X5",
  },
};

/** Long side ÷ short side. */
const shapeOf = (d: { width: number; height: number }) => Math.max(d.width, d.height) / Math.min(d.width, d.height);

/**
 * Complete a product entry for one dealer. Its aspect and code follow from how
 * it is printed: on a sheet, the sheet's shape and the sheet paper's code;
 * otherwise the print's own shape and its own paper's code.
 */
export function productEntry(size: PrintSize, spec: ProductSpec, codes: ProductCodes): PrintProductConfig {
  if (spec.printedAs === "sheet") {
    if (!spec.sheetWidth || !spec.sheetHeight || !spec.sheetPaper) {
      throw new Error(`${size}: printedAs "sheet" needs sheetWidth, sheetHeight and sheetPaper`);
    }
    return { ...spec, productCode: codes[spec.sheetPaper], aspect: shapeOf({ width: spec.sheetWidth, height: spec.sheetHeight }) };
  }
  const productCode = (codes as Partial<Record<PrintSize, string>>)[size];
  if (!productCode) throw new Error(`${size}: no ${size} paper to print it on natively`);
  return { ...spec, productCode, aspect: shapeOf(getPrintDimensions(size)) };
}

const SHEET_4X4 = { sheetWidth: 1200, sheetHeight: 1200, sheetPaper: "4x4" as const };

// How each size is printed. 4x3 could print natively (3x4 Matte) but stays on the 4x4 sheet for now (2026-10-22).
// Typed Record<PrintSize, …> so a new PrintSize cannot silently drop out.
const PRODUCT_SPECS: Record<PrintSize, ProductSpec> = {
  "3x3": { printedAs: "native" },
  "3.5x3.5": { printedAs: isAlwaysPaddedTo4x4("3.5x3.5") ? "sheet" : "native", ...SHEET_4X4 },
  "4x3": { printedAs: isAlwaysPaddedTo4x4("4x3") ? "sheet" : "native", ...SHEET_4X4 },
  "4x4": { printedAs: "native" },
  "4x6": { printedAs: "native" },
  "5x5": { printedAs: "native" },
};

const productsFor = (codes: ProductCodes) =>
  Object.fromEntries(
    Object.entries(PRODUCT_SPECS).map(([size, spec]) => [size, productEntry(size as PrintSize, spec, codes)])
  ) as Record<PrintSize, PrintProductConfig>;

/** Every size's product, per dealer. Shapes are the same for both; only the codes differ. */
export const PRINT_PRODUCTS: Record<DestinationKind, Record<PrintSize, PrintProductConfig>> = {
  demo: productsFor(PRODUCT_CODES.demo),
  live: productsFor(PRODUCT_CODES.live),
};

/** Print resolution. Images under it are flagged (warning); under HARD_MIN_FRACTION of it they are refused. */
export const TARGET_DPI = 300;
export const HARD_MIN_FRACTION = 0.5;
// Photo Finale accepts any resolution; these two guards only catch broken or placeholder files.

/** How far a file's shape may differ from its product's (relative) before the order is refused. */
export const ASPECT_TOLERANCE = 0.005;

/**
 * Printing in rounds (step 5). Everything below marked PLACEHOLDER is
 * waiting on Chari — confirm before any real order.
 */

/** PLACEHOLDER — confirm with Chari: fewest prints one order may contain (new photos + extras + reprints). */
export const MIN_PRINTS_PER_ORDER = 5;

/**
 * Klaviyo "time for another print round" property (print_round_due), see
 * round-reminders.ts. Thresholds in one place so they are easy to tune.
 */
export const ROUND_REMINDER = {
  /** welcome_baby: the baby is this many whole months old (inclusive range). */
  WELCOME_BABY_MIN_MONTHS: 3,
  WELCOME_BABY_MAX_MONTHS: 12,
  /** first_year: from this age on. */
  FIRST_YEAR_MIN_MONTHS: 13,
  /** welcome_baby and first_year need at least this many unprinted prints. */
  MIN_UNPRINTED: 10,
  /** first_year: stay quiet if an order was placed in the last this-many days. */
  FIRST_YEAR_QUIET_DAYS: 60,
  /** growing_up: the child is this many whole years old or more... */
  GROWING_UP_MIN_YEARS: 5,
  /** ...and has at least this many unprinted prints (one order's minimum). */
  GROWING_UP_MIN_UNPRINTED: MIN_PRINTS_PER_ORDER,
} as const;

/**
 * Hidden sanity limit — customers are never shown it and extras are charged per
 * print with no cap. It only catches a mistake (a runaway quantity). Counted
 * by quantity, per order.
 */
export const MAX_EXTRAS_PER_ORDER = 100;

/**
 * The same limit per book: The Little Years allows 120, enough for a full book
 * of extra pages (5 ages × 24); every other book keeps 100.
 */
export function maxExtrasPerOrder(bookTheme: string | null | undefined): number {
  return getProductForTheme(bookTheme) === "little_years" ? 120 : MAX_EXTRAS_PER_ORDER;
}

/** An unpaid round (recorded when the customer clicks "Print my photos") stops being payable after this long. */
export const ROUND_TTL_HOURS = 24;

/** PLACEHOLDER — confirm with Chari: shipping and handling per order (a flat Shopify shipping-profile rate, not computed here). */
export const SHIPPING_AND_HANDLING_CENTS = 600;

/**
 * Which Shopify variant sells each kind of print. One logical key per price
 * point; today there is a single "Photo print" variant, so every size, every
 * extra and every reprint maps to the same key. To price a size differently,
 * add a key, point that size at it, and add its variant id to VARIANT_ENV.
 */
export type PrintVariantKey = "print";
export const VARIANT_KEY_BY_SIZE: Record<PrintSize, PrintVariantKey> = {
  "3x3": "print",
  "3.5x3.5": "print",
  "4x3": "print",
  "4x4": "print",
  "4x6": "print",
  "5x5": "print",
};
/** Extras and reprints are sold at the same price point as the same size of book photo. */
export type PrintItemKind = "book" | "extra" | "reprint";
export function variantKeyFor(size: PrintSize, kind: PrintItemKind): PrintVariantKey {
  void kind; // extras and reprints share the size's price point today; a per-kind price would branch here
  return VARIANT_KEY_BY_SIZE[size];
}
/**
 * PLACEHOLDER — price per print in cents, confirm with Chari. The real price is the
 * Shopify variant's; this copy is only for the breakdown shown before checkout.
 */
export const PRICE_CENTS_BY_VARIANT_KEY: Record<PrintVariantKey, number> = { print: 2000 };
/**
 * The variant id for each key: NEXT_PUBLIC_SHOPIFY_VARIANT_PRINT (variant
 * 48078680424673, "Photo print" in Shopify). Static env reads so Next inlines
 * them. Read lazily so a missing id fails with a clear message.
 */
export function variantIdForKey(key: PrintVariantKey, env: NodeJS.ProcessEnv = process.env): string {
  const id = key === "print" ? env.NEXT_PUBLIC_SHOPIFY_VARIANT_PRINT : undefined;
  if (!id) throw new Error(`Missing env var for the "${key}" print variant (NEXT_PUBLIC_SHOPIFY_VARIANT_PRINT)`);
  return id;
}
/** Every variant id that counts as a print line on a paid order. */
export function allPrintVariantIds(env: NodeJS.ProcessEnv = process.env): string[] {
  return [...new Set((Object.keys(PRICE_CENTS_BY_VARIANT_KEY) as PrintVariantKey[]).map((k) => variantIdForKey(k, env)))];
}
