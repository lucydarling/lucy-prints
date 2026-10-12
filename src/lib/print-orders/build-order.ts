import {
  getBookSlots,
  getPrintDimensions,
  getPrintSizeLabel,
  isSquarePrintSize,
  parsePrintLabel,
  regionChoicesFromStoredPhotos,
  type PrintOrientation,
  type PrintSize,
} from "@/lib/photo-slots";
import {
  ASPECT_TOLERANCE,
  DEFAULT_DELIVERY_TYPE,
  PRINT_PRODUCTS,
  TEST_ID_PREFIX,
  TEST_MODE,
  VENDOR_NAME,
} from "./config";
import { prepareImage, ImageProblem } from "./image";
import { buildOrderXml, validateOrder, type PrintOrderInput, type ShipTo } from "./order-xml";

export interface SessionPhotoRow {
  slot_key: string;
  storage_path: string;
  print_size: string | null;
  status: string;
}
export interface SessionExtraRow {
  extra_id: string;
  print_size: string;
  orientation: string | null;
  storage_path: string | null;
  quantity: number;
}

export interface BuildOrderParams {
  bookTheme: string;
  photoRows: SessionPhotoRow[];
  extraRows: SessionExtraRow[];
  /** Downloads one stored image. */
  fetchImage: (storagePath: string) => Promise<Buffer>;
  externalId: string;
  shipTo: ShipTo;
  customer: { fname?: string; lname?: string };
  testMode?: boolean;
  /**
   * Exact print count to require (used by the manual sample script).
   */
  expectedPrintCount?: number;
  /**
   * What the customer paid for, computed by the caller from the Shopify
   * order and the code — never from the session rows read here.
   */
  paid?: PaidEntitlement;
}

export interface PaidEntitlement {
  /** Every book slot key the paid book includes (from getSlots, in code). */
  bookSlotKeys: string[];
  /** Most extra prints allowed in one order (the hidden sanity limit). */
  maxExtras: number;
}

/** Nothing to print at payment time — the order waits for a person; nothing is built or sent. */
export class PrintOrderHeld extends Error {
  constructor(reason: string) {
    super(`Print order held: ${reason}`);
  }
}

export interface OrderFile {
  name: string;
  data: Buffer;
}

export interface BuiltOrder {
  /** Folder name = the order's external_id. */
  folderName: string;
  input: PrintOrderInput;
  images: OrderFile[];
  xml: OrderFile;
  /** Prints in the order, extras counted by quantity. */
  printCount: number;
  /** Prints by size, extras counted by quantity. */
  countBySize: Partial<Record<PrintSize, number>>;
  warnings: string[];
}

const safe = (s: string) => s.replace(/[^a-zA-Z0-9._-]+/g, "_");

/**
 * Turn a session's stored photos into a Photo Finale order folder (in memory).
 * Refuses (throws) if anything is wrong: an uncropped photo, a missing,
 * broken or far-too-small image, a quantity that is not a whole number, a
 * print count that differs from what was charged, or any XML-spec violation.
 * Nothing is written anywhere.
 */
export async function buildOrder(p: BuildOrderParams): Promise<BuiltOrder> {
  const errors: string[] = [];
  const warnings: string[] = [];
  const testMode = p.testMode ?? TEST_MODE;

  type Job = {
    base: string;
    size: PrintSize;
    orientation?: PrintOrientation;
    path: string;
    quantity: number;
  };
  const jobs: Job[] = [];

  // Book slots — same rule as bookPrintItems: every slot with a photo row.
  const byKey = new Map(p.photoRows.map((r) => [r.slot_key, r]));
  const regionChoices = regionChoicesFromStoredPhotos(
    p.bookTheme,
    Object.fromEntries(p.photoRows.map((r) => [r.slot_key, { printSize: r.print_size }]))
  );
  for (const slot of getBookSlots(p.bookTheme, regionChoices)) {
    const row = byKey.get(slot.key);
    if (!row || row.status === "empty") continue;
    if (row.status !== "cropped" || !row.storage_path) {
      errors.push(`${slot.key}: photo is "${row.status}", not cropped — cannot be printed at the right shape`);
      continue;
    }
    const stored = parsePrintLabel(row.print_size);
    if (stored) {
      const sizeDiffers = stored.size !== slot.size;
      const turnedDiffers =
        !sizeDiffers && !isSquarePrintSize(slot.size) && row.print_size !== getPrintSizeLabel(slot.size, slot.orientation);
      if (sizeDiffers || turnedDiffers) {
        const msg = `${slot.key}: stored as ${row.print_size} but the book slot prints ${getPrintSizeLabel(slot.size, slot.orientation)}`;
        // Two squares differ only in scale, so ordering as the slot size is safe;
        // anything non-square would print at the wrong shape.
        if (isSquarePrintSize(stored.size) && isSquarePrintSize(slot.size)) {
          warnings.push(`${msg} — ordered as the slot size`);
        } else {
          errors.push(`${msg} — shapes differ, refusing`);
          continue;
        }
      }
    }
    jobs.push({ base: slot.key, size: slot.size, orientation: slot.orientation, path: row.storage_path, quantity: 1 });
  }

  // Extras — only ones with a stored (cropped) file, as on the review page.
  let extraN = 0;
  for (const row of p.extraRows) {
    if (!row.storage_path) continue;
    extraN += 1;
    const parsed = parsePrintLabel(row.print_size);
    if (!parsed) {
      errors.push(`extra ${row.extra_id}: unknown print size "${row.print_size}"`);
      continue;
    }
    if (!Number.isInteger(row.quantity) || row.quantity < 1) {
      errors.push(`extra ${row.extra_id}: quantity must be a whole number of 1 or more (got ${row.quantity})`);
      continue;
    }
    const orientation: PrintOrientation | undefined =
      row.orientation === "landscape" ? "landscape" : parsed.orientation ?? "portrait";
    jobs.push({ base: `extra_${extraN}`, size: parsed.size, orientation, path: row.storage_path, quantity: row.quantity });
  }

  if (jobs.length === 0 && !p.paid) errors.push("session has no printable photos");

  if (p.paid) {
    const paidKeys = new Set(p.paid.bookSlotKeys);
    const filled = new Set(p.photoRows.filter((r) => r.status !== "empty").map((r) => r.slot_key));
    const unpaid = [...filled].filter((k) => !paidKeys.has(k));
    if (unpaid.length > 0) {
      errors.push(`photos in slots the customer did not pay for: ${unpaid.join(", ")}`);
    }
    const extraTotal = jobs.filter((j) => j.base.startsWith("extra_")).reduce((n, j) => n + j.quantity, 0);
    if (extraTotal > p.paid.maxExtras) {
      errors.push(`session has ${extraTotal} extra prints but the limit is ${p.paid.maxExtras}`);
    }
    if (errors.length > 0) {
      throw new Error(`Print order refused:\n - ${[...new Set(errors)].join("\n - ")}`);
    }
    // Payment = finished: whatever is filled prints. Only an empty order waits.
    if (jobs.length === 0) throw new PrintOrderHeld("no photos were filled in when the order was paid");
  }

  const images: OrderFile[] = [];
  const items: PrintOrderInput["items"] = [];
  const countBySize: Partial<Record<PrintSize, number>> = {};
  let printCount = 0;

  for (const [i, job] of jobs.entries()) {
    const product = PRINT_PRODUCTS[job.size];
    const dims = getPrintDimensions(job.size, job.orientation);
    const label = `${job.base} (${getPrintSizeLabel(job.size, job.orientation)})`;
    let prepared;
    try {
      prepared = await prepareImage(await p.fetchImage(job.path), dims, product, label);
    } catch (err) {
      errors.push(err instanceof ImageProblem ? err.message : `${label}: could not load image (${(err as Error).message})`);
      continue;
    }
    // pfRouter silently center-crops a file whose shape isn't its product's: refuse instead.
    // Checked on the prepared file, i.e. after padding (a padded size is checked as its sheet).
    const ratio = Math.max(prepared.width, prepared.height) / Math.min(prepared.width, prepared.height);
    if (Math.abs(ratio / product.aspect - 1) > ASPECT_TOLERANCE) {
      errors.push(
        `${label}: file is ${prepared.width}x${prepared.height}px (shape ${ratio.toFixed(3)}:1) but ${product.productCode} is ${+product.aspect.toFixed(3)}:1 — Photo Finale would crop it`
      );
      continue;
    }
    warnings.push(...prepared.warnings);
    const name = `${String(i + 1).padStart(4, "0")}_${safe(job.base)}_${getPrintSizeLabel(job.size, job.orientation)}${
      product.printedAs === "sheet" ? "_on_4x4" : ""
    }.jpg`;
    images.push({ name, data: prepared.jpeg });
    items.push({ product: product.productCode, quantity: job.quantity, image: name });
    countBySize[job.size] = (countBySize[job.size] ?? 0) + job.quantity;
    printCount += job.quantity;
  }

  if (p.expectedPrintCount !== undefined && p.expectedPrintCount !== printCount) {
    errors.push(`order has ${printCount} prints but ${p.expectedPrintCount} were charged for`);
  }

  const externalId = `${testMode ? TEST_ID_PREFIX : ""}${p.externalId}`;
  const input: PrintOrderInput = {
    externalId,
    vendor: VENDOR_NAME,
    customer: p.customer,
    shipTo: p.shipTo,
    deliveryType: DEFAULT_DELIVERY_TYPE,
    items,
  };
  const fileNames = images.map((f) => f.name);
  errors.push(...validateOrder(input, fileNames));
  if (errors.length > 0) {
    throw new Error(`Print order refused:\n - ${[...new Set(errors)].join("\n - ")}`);
  }

  return {
    folderName: externalId,
    input,
    images,
    xml: { name: `${externalId}.xml`, data: Buffer.from(buildOrderXml(input, fileNames), "utf8") },
    printCount,
    countBySize,
    warnings,
  };
}
