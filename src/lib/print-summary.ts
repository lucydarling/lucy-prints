import {
  ALL_PRINT_SIZES,
  isAlwaysPaddedTo4x4,
  type PhotoSlot,
  type PrintOrientation,
  type PrintSize,
} from "@/lib/photo-slots";
import type { ExtraPrint, PhotoEntry } from "@/store/photo-store";

/** One photo that will be printed, by size. */
export interface PrintItem {
  size: PrintSize;
  orientation?: PrintOrientation;
}

export interface PrintSummaryRow {
  size: PrintSize;
  count: number;
  /** The ZIP always puts this size on a 4x4 sheet with trim guides. */
  paddedTo4x4: boolean;
}

/** Order of the review page's order summary, largest print first. */
const SUMMARY_ORDER: PrintSize[] = ["4x6", "4x3", "4x4", "3.5x3.5", "3x3"];

/**
 * Count prints by size for the review page. Every item lands in exactly one
 * row — a size missing from SUMMARY_ORDER is still listed, after the rest —
 * so the rows always add up to `total` and no photo can drop out of the
 * summary unnoticed.
 */
export function summarizePrints(items: PrintItem[]): {
  rows: PrintSummaryRow[];
  total: number;
  countBySize: Record<PrintSize, number>;
} {
  const countBySize = Object.fromEntries(
    ALL_PRINT_SIZES.map((size) => [size, 0])
  ) as Record<PrintSize, number>;
  for (const item of items) countBySize[item.size] += 1;

  const order = [
    ...SUMMARY_ORDER,
    ...ALL_PRINT_SIZES.filter((size) => !SUMMARY_ORDER.includes(size)),
  ];
  const rows = order
    .filter((size) => countBySize[size] > 0)
    .map((size) => ({
      size,
      count: countBySize[size],
      paddedTo4x4: isAlwaysPaddedTo4x4(size),
    }));

  return { rows, total: items.length, countBySize };
}

/** The print a book slot's photo becomes. */
export function slotPrint(slot: PhotoSlot): PrintItem {
  return { size: slot.size };
}

/**
 * Prints for the review page: every book slot that has a photo (cropped or
 * not yet cropped) plus every cropped extra — the same set the page has
 * always counted.
 */
export function bookPrintItems(
  slots: PhotoSlot[],
  photos: Record<string, PhotoEntry>,
  extras: ExtraPrint[]
): PrintItem[] {
  return [
    ...slots
      .filter((slot) => photos[slot.key] && photos[slot.key].status !== "empty")
      .map((slot) => slotPrint(slot)),
    ...extras
      .filter((e) => e.croppedUrl)
      .map((e) => ({ size: e.size, orientation: e.orientation })),
  ];
}
