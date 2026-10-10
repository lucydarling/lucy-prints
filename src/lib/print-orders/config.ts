import { isAlwaysPaddedTo4x4, type PrintSize } from "@/lib/photo-slots";

/**
 * Everything about print orders that is not yet known. Each value marked
 * PLACEHOLDER must be confirmed with Photo Finale / Persnickety before any
 * order is delivered. Nothing here is a real product code.
 */

/** PLACEHOLDER — confirm with Photo Finale/Persnickety: name of this system in `apm_order/@vendor`. */
export const VENDOR_NAME = "Lucy Darling Photo Lab";

/** PLACEHOLDER — confirm with Photo Finale/Persnickety: must match an active shipping method of this type. */
export const DEFAULT_DELIVERY_TYPE = "standard" as const;

/** While true, every external_id is prefixed so test orders can't be mistaken for real ones. */
export const TEST_MODE = true;
export const TEST_ID_PREFIX = "TEST-";

/**
 * Where orders go. Testing goes to a separate DEMO dealer account, never the
 * real one. Neither value is used for delivery yet (delivery is a stub).
 * PLACEHOLDER — confirm the demo dealer name and its hotfolder with Photo Finale.
 */
export const DESTINATION = {
  kind: "demo" as "demo" | "live",
  dealer: "PLACEHOLDER-DEMO-DEALER",
  hotfolder: "PLACEHOLDER-DEMO-HOTFOLDER",
};

/** Files smaller than this are treated as broken (a real 300 DPI print is hundreds of KB). */
export const MIN_VALID_IMAGE_BYTES = 5_000;

export interface PrintProductConfig {
  /** PLACEHOLDER — confirm with Photo Finale/Persnickety: the dealer's product code (fulfillment_id or ProductID). */
  productCode: string;
  /**
   * The product's paper shape: long side ÷ short side (1 = square, 1.5 = 4x6).
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
}

// PLACEHOLDER — confirm with Photo Finale/Persnickety for every entry below.
// Typed Record<PrintSize, …> so a new PrintSize cannot silently drop out.
export const PRINT_PRODUCTS: Record<PrintSize, PrintProductConfig> = {
  "3x3": { productCode: "TBD-3X3", aspect: 1, printedAs: "native" },
  "3.5x3.5": { productCode: "TBD-4X4", aspect: 1, printedAs: isAlwaysPaddedTo4x4("3.5x3.5") ? "sheet" : "native", sheetWidth: 1200, sheetHeight: 1200 },
  "4x3": { productCode: "TBD-4X4", aspect: 1, printedAs: isAlwaysPaddedTo4x4("4x3") ? "sheet" : "native", sheetWidth: 1200, sheetHeight: 1200 },
  "4x4": { productCode: "TBD-4X4", aspect: 1, printedAs: "native" },
  "4x6": { productCode: "TBD-4X6", aspect: 1.5, printedAs: "native" },
  "5x5": { productCode: "TBD-5X5", aspect: 1, printedAs: "native" },
};

/** Print resolution. Images under it are flagged (warning); under HARD_MIN_FRACTION of it they are refused. */
export const TARGET_DPI = 300;
export const HARD_MIN_FRACTION = 0.5;
// Photo Finale accepts any resolution; these two guards only catch broken or placeholder files.

/** How far a file's shape may differ from its product's (relative) before the order is refused. */
export const ASPECT_TOLERANCE = 0.005;

/**
 * Extra prints (the Extra Prints section) are currently free — there is no price
 * anywhere in the app. This is the most a PRINT ORDER may include (enforced by
 * validatePrintRequest only; the ZIP flow and the extras UI are NOT capped).
 * Final: 12 (Kevin, 2026-10-09).
 */
export const EXTRAS_FREE_CAP = 12;
