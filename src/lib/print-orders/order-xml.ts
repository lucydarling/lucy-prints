/**
 * Photo Finale `apm_order` XML for a mail order — builder and validator.
 * Follows "Partner Order XML: Minimum Specification" (Photo Finale, 2026-10-09).
 *
 * Deliberate omissions: customer email (our system sends customer emails),
 * prices/totals (no pricing logic yet), crop attributes (images are already
 * cropped), `.pfrouter-partner.json` (pfRouter owns it).
 */

export type DeliveryType = "budget" | "standard" | "expedited" | "express";
const DELIVERY_TYPES: DeliveryType[] = ["budget", "standard", "expedited", "express"];

export interface ShipTo {
  fname: string;
  lname: string;
  address1: string;
  address2?: string;
  city: string;
  state: string;
  zip: string;
  country: string;
  company?: string;
  phone?: string;
}

/** One printed image. One order_item per image, `quantity` copies of it. */
export interface PrintOrderItem {
  product: string;
  quantity: number;
  /** File name relative to the order folder. */
  image: string;
}

export interface PrintOrderInput {
  externalId: string;
  vendor: string;
  /** Bill-to name. At least one of fname/lname is required (email is never written). */
  customer: { fname?: string; lname?: string };
  shipTo: ShipTo;
  deliveryType: DeliveryType;
  items: PrintOrderItem[];
}

/** Escape text for use inside a double-quoted XML attribute. */
export function escapeXmlAttr(value: string): string {
  return value
    // Characters XML 1.0 cannot carry at all.
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g, "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;")
    .replace(/\r?\n|\t/g, " ");
}

const blank = (v: string | undefined | null) => !v || !v.trim();
const SUPPORTED_IMAGE = /\.(jpe?g|png)$/i;

/**
 * Check every rule in the spec. `files` is the list of files that will exist
 * in the order folder (relative names). Returns readable errors; empty = valid.
 */
export function validateOrder(order: PrintOrderInput, files: string[]): string[] {
  const errors: string[] = [];
  const idLen = [...order.externalId].length;
  if (idLen < 1 || idLen > 32) {
    errors.push(`external_id must be 1-32 characters (got ${idLen}: "${order.externalId}")`);
  }
  if (blank(order.vendor)) errors.push("vendor is required");
  if (blank(order.customer.fname) && blank(order.customer.lname)) {
    errors.push("customer needs at least a first or last name (email is never written to the XML)");
  }
  for (const f of ["fname", "lname", "address1", "city", "state", "zip", "country"] as const) {
    if (blank(order.shipTo[f])) errors.push(`shipment ${f} is required for a mail order`);
  }
  if (!DELIVERY_TYPES.includes(order.deliveryType)) {
    errors.push(`delivery_type must be one of ${DELIVERY_TYPES.join(", ")} (got "${order.deliveryType}")`);
  }
  if (order.items.length < 1) errors.push("order needs at least one order_item");
  const fileSet = new Set(files);
  order.items.forEach((item, i) => {
    const where = `order_item ${i + 1}`;
    if (blank(item.product)) errors.push(`${where}: product is required`);
    if (!Number.isInteger(item.quantity) || item.quantity < 1) {
      errors.push(`${where}: quantity must be a whole number of 1 or more (got ${item.quantity})`);
    }
    if (blank(item.image)) {
      errors.push(`${where}: image path is required`);
    } else {
      if (item.image.startsWith("/") || /^[a-z]:/i.test(item.image) || item.image.split(/[\\/]/).includes("..")) {
        errors.push(`${where}: image path must be relative to the order folder ("${item.image}")`);
      }
      if (!SUPPORTED_IMAGE.test(item.image)) {
        errors.push(`${where}: image must be jpeg or png ("${item.image}")`);
      }
      if (!fileSet.has(item.image)) {
        errors.push(`${where}: image "${item.image}" is not in the order folder`);
      }
    }
  });
  return errors;
}

/** Build the XML. Throws if the order is invalid. */
export function buildOrderXml(order: PrintOrderInput, files: string[]): string {
  const errors = validateOrder(order, files);
  if (errors.length > 0) {
    throw new Error(`Invalid print order:\n - ${errors.join("\n - ")}`);
  }
  const attr = (name: string, v: string | undefined) =>
    blank(v) ? "" : ` ${name}="${escapeXmlAttr(v!.trim())}"`;

  const s = order.shipTo;
  const lines: string[] = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<apm_order external_id="${escapeXmlAttr(order.externalId)}" vendor="${escapeXmlAttr(order.vendor)}">`,
    `  <customer${attr("fname", order.customer.fname)}${attr("lname", order.customer.lname)}/>`,
    `  <shipment fulfillment_type="mail" delivery_type="${order.deliveryType}"` +
      attr("fname", s.fname) + attr("lname", s.lname) + attr("company", s.company) +
      attr("address1", s.address1) + attr("address2", s.address2) + attr("city", s.city) +
      attr("state", s.state) + attr("zip", s.zip) + attr("country", s.country) +
      attr("phone", s.phone) + ">",
  ];
  for (const item of order.items) {
    lines.push(
      `    <order_item product="${escapeXmlAttr(item.product)}" quantity="${item.quantity}">`,
      `      <image path="${escapeXmlAttr(item.image)}"/>`,
      "    </order_item>"
    );
  }
  lines.push("  </shipment>", "</apm_order>", "");
  return lines.join("\n");
}
