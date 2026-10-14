import { Resend } from "resend";
import { TEST_MODE } from "@/lib/print-orders/config";
import { recordEmailSend, type EmailRoute, type EmailSendInput } from "@/lib/email-sends";

const resend = process.env.RESEND_API_KEY
  ? new Resend(process.env.RESEND_API_KEY)
  : (null as unknown as Resend);

export const FROM_ADDRESS = "Lucy Darling Prints <prints@lucydarling.com>";

/**
 * Base URL for resume links. Falls back to the real production host so a
 * missing env var can never render links as "undefined/resume/<token>".
 */
export function resolveAppUrl(): string {
  return (
    process.env.NEXT_PUBLIC_APP_URL?.replace(/\/+$/, "") ||
    "https://memories.lucydarling.com"
  );
}

/**
 * Thrown when Resend rejects a send. Carries the provider's own error so
 * callers can log the real reason (unverified domain, bad key, rate limit)
 * instead of a generic failure.
 */
export class EmailSendError extends Error {
  readonly providerName: string;
  readonly providerStatus?: number;

  constructor(providerName: string, providerMessage: string, providerStatus?: number) {
    super(`Resend rejected the send [${providerName}]: ${providerMessage}`);
    this.name = "EmailSendError";
    this.providerName = providerName;
    this.providerStatus = providerStatus;
  }
}

/** Which email this is, for the `email_sends` record. */
export interface EmailMeta {
  route: EmailRoute;
  sessionId?: string | null;
}

export interface EmailParams {
  to: string;
  subject: string;
  html: string;
  replyTo?: string;
}

type ResendPayload = EmailParams & { from: string };
type ResendResult = {
  data: { id: string } | null;
  error: { name?: string; message?: string; statusCode?: number } | null;
};

export interface SendEmailDeps {
  /** null when RESEND_API_KEY is not set. */
  send: ((payload: ResendPayload) => Promise<ResendResult>) | null;
  record: (input: EmailSendInput) => Promise<boolean>;
}

const realSendDeps: SendEmailDeps = {
  send: resend
    ? (p) =>
        resend.emails.send({
          from: p.from,
          to: p.to,
          subject: p.subject,
          html: p.html,
          ...(p.replyTo ? { replyTo: p.replyTo } : {}),
        }) as Promise<ResendResult>
    : null,
  record: (input) => recordEmailSend(input),
};

/**
 * Send via Resend, surface failures, and record the outcome in `email_sends`.
 *
 * The Resend SDK does NOT throw on API errors — it resolves with
 * `{ data: null, error }`. Awaiting it without inspecting the result makes a
 * rejected send indistinguishable from a delivered one, which is exactly how
 * the 403 "domain is not verified" failure stayed invisible: the route kept
 * returning 200 while zero mail left the building. Always check `error`.
 *
 * The record is written AFTER the send and never throws, so a failed insert
 * can't stop an email; a failed send is recorded before it is re-thrown.
 */
export async function sendEmailWith(deps: SendEmailDeps, params: EmailParams, meta: EmailMeta): Promise<{ id: string } | null> {
  let data: { id: string } | null;
  try {
    if (!deps.send) {
      throw new EmailSendError(
        "missing_api_key",
        "RESEND_API_KEY is not set in this environment"
      );
    }

    const result = await deps.send({ from: FROM_ADDRESS, ...params });

    if (result.error) {
      throw new EmailSendError(
        result.error.name ?? "unknown_error",
        result.error.message ?? "no message returned",
        result.error.statusCode
      );
    }
    data = result.data;
  } catch (err) {
    const errorCode = err instanceof EmailSendError ? err.providerName : err instanceof Error ? err.name || "exception" : "exception";
    await deps.record({ route: meta.route, outcome: "send-failed", sessionId: meta.sessionId, errorCode, to: params.to });
    throw err;
  }

  await deps.record({ route: meta.route, outcome: "sent", sessionId: meta.sessionId, resendId: data?.id ?? null, to: params.to });
  return data;
}

function sendEmail(params: EmailParams, meta: EmailMeta) {
  return sendEmailWith(realSendDeps, params, meta);
}

export async function sendMyBooksEmail({
  to,
  sessions,
  sessionId = null,
}: {
  to: string;
  sessions: Array<{ token: string; themeName: string; babyName?: string | null; photoCount: number; printedSoFar?: number; bookSlots?: number }>;
  /** For the email_sends record: the book's session when there is exactly one, else null. */
  sessionId?: string | null;
}) {
  const subject =
    sessions.length === 1
      ? sessions[0].babyName
        ? `Your photo book for ${sessions[0].babyName}`
        : "Your Lucy Darling photo book"
      : `Your ${sessions.length} Lucy Darling photo books`;

  const appUrl = resolveAppUrl();

  const booksHtml = sessions
    .map((s) => {
      const resumeUrl = `${appUrl}/resume/${s.token}`;
      const label = s.babyName ? `${s.babyName} — ${s.themeName}` : s.themeName;
      return `
        <div style="border:1px solid #F3F4F6;border-radius:10px;padding:16px 20px;margin-bottom:12px;">
          <p style="font-size:14px;font-weight:600;color:#1F2937;margin:0 0 2px 0;">${label}</p>
          <p style="font-size:13px;color:#9CA3AF;margin:0 0 12px 0;">${s.photoCount} photo${s.photoCount !== 1 ? "s" : ""} saved${s.printedSoFar ? ` &middot; <strong style="color:#6B7280;">${s.printedSoFar} of ${s.bookSlots} printed</strong>` : ""}</p>
          <a href="${resumeUrl}" style="display:inline-block;background-color:#F43F5E;color:#FFFFFF;padding:10px 20px;border-radius:8px;font-size:14px;font-weight:600;text-decoration:none;">
            Continue This Book
          </a>
        </div>`;
    })
    .join("");

  await sendEmail({
    to,
    subject,
    html: `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="margin:0;padding:0;background-color:#F9FAFB;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;margin:0 auto;padding:32px 16px;">
    <tr>
      <td align="center" style="padding-bottom:24px;">
        <img src="${appUrl}/logo.png" alt="Lucy Darling" width="150" style="display:block;" />
        <p style="font-size:12px;color:#FAB8A9;margin:4px 0 0 0;font-weight:500;">Photo Prints</p>
      </td>
    </tr>
    <tr>
      <td style="background:#FFFFFF;border-radius:12px;padding:32px 24px;border:1px solid #F3F4F6;">
        <h1 style="font-size:20px;color:#1F2937;margin:0 0 8px 0;font-weight:600;">Your saved photo books</h1>
        <p style="font-size:14px;color:#6B7280;line-height:1.6;margin:0 0 20px 0;">
          Here ${sessions.length === 1 ? "is" : "are"} your saved book${sessions.length !== 1 ? "s" : ""}. Each link picks up right where you left off.
        </p>
        ${booksHtml}
        <p style="font-size:12px;color:#9CA3AF;margin:16px 0 0 0;line-height:1.5;text-align:center;">
          Bookmark this email to come back anytime.
        </p>
      </td>
    </tr>
    <tr>
      <td align="center" style="padding-top:24px;">
        <p style="font-size:11px;color:#D1D5DB;margin:0;">Lucy Darling &mdash; Premium Baby Keepsakes</p>
      </td>
    </tr>
  </table>
</body>
</html>`.trim(),
  }, { route: "my-books-email", sessionId });
}

/**
 * The "book is saved" email. It quotes NO photo count: the browser asks for it
 * right after the save, before its uploads land, so any count read here is 0.
 */
export function buildMagicLinkEmail({
  babyName,
  token,
  appUrl = resolveAppUrl(),
}: {
  babyName?: string;
  token: string;
  appUrl?: string;
}): { subject: string; html: string } {
  const resumeUrl = `${appUrl}/resume/${token}`;
  const subject = babyName
    ? `Your photo book for ${babyName} is saved`
    : "Your Lucy Darling photo book is saved";

  const greeting = babyName ? `${babyName}'s` : "Your";

  return {
    subject,
    html: `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="margin:0;padding:0;background-color:#F9FAFB;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;margin:0 auto;padding:32px 16px;">
    <tr>
      <td align="center" style="padding-bottom:24px;">
        <img src="${appUrl}/logo.png" alt="Lucy Darling" width="150" style="display:block;" />
        <p style="font-size:12px;color:#FAB8A9;margin:4px 0 0 0;font-weight:500;">Photo Prints</p>
      </td>
    </tr>
    <tr>
      <td style="background:#FFFFFF;border-radius:12px;padding:32px 24px;border:1px solid #F3F4F6;">
        <h1 style="font-size:20px;color:#1F2937;margin:0 0 8px 0;font-weight:600;">
          ${greeting} photo book is saved!
        </h1>
        <p style="font-size:14px;color:#6B7280;line-height:1.6;margin:0 0 20px 0;">
          <!-- DRAFT copy, pending Haily -->
          Your photos are saved as you add them, and this link brings your book back on any device.
        </p>
        <a href="${resumeUrl}"
           style="display:block;text-align:center;background-color:#FAB8A9;color:#FFFFFF;padding:14px 24px;border-radius:10px;font-size:15px;font-weight:600;text-decoration:none;">
          Continue My Photo Book
        </a>
        <p style="font-size:12px;color:#9CA3AF;margin:20px 0 0 0;line-height:1.5;text-align:center;">
          This link is unique to you. Bookmark it or save this email to come back anytime.
        </p>
      </td>
    </tr>
    <tr>
      <td align="center" style="padding-top:24px;">
        <p style="font-size:11px;color:#D1D5DB;margin:0;">
          Lucy Darling &mdash; Premium Baby Keepsakes
        </p>
      </td>
    </tr>
  </table>
</body>
</html>
    `.trim(),
  };
}

export async function sendMagicLinkEmail({ to, babyName, token, sessionId }: { to: string; babyName?: string; token: string; sessionId: string }) {
  await sendEmail({ to, ...buildMagicLinkEmail({ babyName, token }) }, { route: "magic-link", sessionId });
}

/**
 * Tell Kevin a print order was held or refused, or that the print partner's
 * pfRouter rejected one we sent (status "error"), or that the photo upload
 * size check is down and uploads are going through unchecked ("upload-check").
 * Nothing here touches the customer.
 */
export async function sendPrintOrderAlert(info: {
  status: "held" | "refused" | "error" | "upload-check";
  shopifyOrderId: string;
  shopifyOrderName?: string;
  sessionToken?: string;
  reasons: string[];
}) {
  const to = process.env.PRINT_ORDER_ALERT_TO || "kevin@lucydarling.com";
  const esc = (t: string) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const name = info.shopifyOrderName || info.shopifyOrderId;
  const isError = info.status === "error";
  if (info.status === "upload-check") {
    return sendEmail({
      to,
      subject: "[Photo Lab] Upload size check is DOWN — uploads accepted unchecked",
      html: `<p>The photo upload size/damage check could not run (the image library failed), so uploads are being <strong>accepted without it</strong>. Customers are not affected; only the check is off.</p>
<ul>${info.reasons.map((r) => `<li style="white-space:pre-wrap">${esc(r)}</li>`).join("")}</ul>`,
    }, { route: "alert" });
  }
  return sendEmail({
    to,
    subject: isError
      ? `[Photo Lab] Print order ERROR at the printer: ${name}`
      : `[Photo Lab] Print order ${info.status.toUpperCase()}: ${name}`,
    html: `<p>${isError
      ? "The print partner's system (pfRouter) <strong>rejected</strong> a print order we sent. It is now <strong>error</strong> in print_orders."
      : `A paid print order was <strong>${info.status}</strong> and needs a person.`}</p>
<ul>
<li>Order: ${esc(name)} (Shopify id ${esc(info.shopifyOrderId)})</li>
${isError ? "" : `<li>Session token: ${esc(info.sessionToken || "(none on the order)")}</li>`}
</ul>
<p>${isError ? "pfRouter's reason" : "Reason"}:</p>
<ul>${info.reasons.map((r) => `<li style="white-space:pre-wrap">${esc(r)}</li>`).join("")}</ul>
<p>${isError ? "Nothing is retried automatically. This alert is sent once." : "Nothing was sent to the print partner."}</p>${info.status === "held" ? `<p>A held order stays editable by the customer. Once photos are added, retry with <code>npm run print-order:retry -- ${esc(info.shopifyOrderId)}</code> — it takes a fresh snapshot.</p>` : ""}`,
  }, { route: "alert" });
}


// ---------------------------------------------------------------------------
// Customer print-order emails. Sent from prints@lucydarling.com via Resend.
// While TEST_MODE is on, nothing is sent to an address outside @lucydarling.com
// (the send is skipped and logged) so a test order can never email a real customer.
// A refused order sends NO customer email — Kevin gets the alert and handles it.
// ---------------------------------------------------------------------------

const escHtml = (t: string) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** True when a customer email to `to` may go out right now. */
export function customerEmailAllowed(to: string, testMode: boolean = TEST_MODE): boolean {
  return !testMode || /@lucydarling\.com$/i.test(to.trim());
}

export async function sendCustomerEmail(
  params: { to: string; subject: string; html: string },
  meta: EmailMeta
): Promise<"sent" | "skipped"> {
  if (!customerEmailAllowed(params.to)) {
    console.warn(`[print-order-email] TEST_MODE: not sending "${params.subject}" to a non-lucydarling.com address`);
    return "skipped";
  }
  // Replies go to the support inbox (PRINT_REPLY_TO), not the send-only prints@ address.
  await sendEmail({ ...params, replyTo: process.env.PRINT_REPLY_TO?.trim() || undefined }, meta);
  return "sent";
}

/** The shared frame: logo, card, footer. `body` is trusted HTML built from escaped values. */
function printEmailShell(title: string, body: string): string {
  const appUrl = resolveAppUrl();
  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="margin:0;padding:0;background-color:#F9FAFB;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;margin:0 auto;padding:32px 16px;">
    <tr>
      <td align="center" style="padding-bottom:24px;">
        <img src="${appUrl}/logo.png" alt="Lucy Darling" width="150" style="display:block;" />
        <p style="font-size:12px;color:#FAB8A9;margin:4px 0 0 0;font-weight:500;">Photo Prints</p>
      </td>
    </tr>
    <tr>
      <td style="background:#FFFFFF;border-radius:12px;padding:32px 24px;border:1px solid #F3F4F6;">
        <h1 style="font-size:20px;color:#1F2937;margin:0 0 8px 0;font-weight:600;">${escHtml(title)}</h1>
        ${body}
      </td>
    </tr>
    <tr>
      <td align="center" style="padding-top:24px;">
        <p style="font-size:11px;color:#D1D5DB;margin:0;">Lucy Darling &mdash; Premium Baby Keepsakes</p>
      </td>
    </tr>
  </table>
</body>
</html>`.trim();
}

const P = `font-size:14px;color:#6B7280;line-height:1.6;margin:0 0 16px 0;`;

export interface PrintEmailShipTo {
  fname?: string; lname?: string; address1?: string; address2?: string;
  city?: string; state?: string; zip?: string; country?: string;
}

function shipToHtml(a: PrintEmailShipTo): string {
  const lines = [
    [a.fname, a.lname].filter(Boolean).join(" "),
    a.address1,
    a.address2,
    [a.city, a.state].filter(Boolean).join(", ") + (a.zip ? ` ${a.zip}` : ""),
    a.country,
  ].filter((l): l is string => Boolean(l && l.trim()));
  return lines.map(escHtml).join("<br>");
}

/** "Order received": sent once, when the paid order is checked and ready to print. */
export function printOrderReceivedEmail(info: {
  bookName: string;
  babyName?: string | null;
  /** This round's counts. */
  newPhotos: number;
  extraPrints: number;
  reprints: number;
  /** Progress after this order: distinct book slots printed, out of the book's slots. */
  printedSoFar: number;
  bookSlots: number;
  shipTo: PrintEmailShipTo;
  orderName?: string;
}): { subject: string; html: string } {
  const what = info.babyName ? `${info.babyName}'s ${info.bookName}` : info.bookName;
  const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
  const parts = [
    info.newPhotos > 0 ? plural(info.newPhotos, "new photo") : "",
    info.extraPrints > 0 ? plural(info.extraPrints, "extra print") : "",
    info.reprints > 0 ? plural(info.reprints, "reprint") : "",
  ].filter(Boolean);
  const printing = parts.length > 1 ? `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}` : parts[0] ?? "";
  const progress = info.bookSlots > 0 ? `${info.printedSoFar} of ${info.bookSlots} photos printed so far` : "";
  return {
    subject: `We've got your photo order${info.orderName ? ` (${info.orderName})` : ""}`,
    html: printEmailShell("We've got your photo order", `
        <p style="${P}">Your photos for <strong>${escHtml(what)}</strong> are on their way to print.</p>
        <div style="border:1px solid #F3F4F6;border-radius:10px;padding:16px 20px;margin:0 0 16px 0;">
          <p style="font-size:13px;color:#9CA3AF;margin:0 0 4px 0;">Printing</p>
          <p style="font-size:14px;font-weight:600;color:#1F2937;margin:0 0 ${progress ? "4px" : "12px"} 0;">${escHtml(printing)}</p>
          ${progress ? `<p style="font-size:13px;color:#6B7280;margin:0 0 12px 0;">${escHtml(progress)}</p>` : ""}
          <p style="font-size:13px;color:#9CA3AF;margin:0 0 4px 0;">Shipping to</p>
          <p style="font-size:14px;color:#1F2937;line-height:1.5;margin:0;">${shipToHtml(info.shipTo)}</p>
        </div>
        <p style="${P}">What happens next: we prepare your prints and mail them to the address above.</p>
        <p style="font-size:12px;color:#9CA3AF;line-height:1.5;margin:0;">The photos in this order are now locked. Your book stays open, so you can keep adding photos for your next order.</p>`),
  };
}

/** "We're checking your order": paid, but part of the book changed between checkout and payment. */
export function printOrderHeldEmail(info: { resumeUrl: string; orderName?: string }): { subject: string; html: string } {
  return {
    subject: "We're checking your print order",
    html: printEmailShell("We're checking your order", `
        <p style="${P}">We received your print order${info.orderName ? ` (${escHtml(info.orderName)})` : ""}, but part of your book changed between checkout and payment, so we&rsquo;re checking it before it goes to print. You don&rsquo;t need to pay again.</p>
        <p style="${P}">If you removed a photo by mistake, add it back and reply to this email.</p>
        <a href="${escHtml(info.resumeUrl)}" style="display:block;text-align:center;background-color:#FAB8A9;color:#FFFFFF;padding:14px 24px;border-radius:10px;font-size:15px;font-weight:600;text-decoration:none;">
          Back to My Photo Book
        </a>`),
  };
}

/** "Shipped": built but NOT wired to anything until tracking details arrive from Photo Finale. */
export function printOrderShippedEmail(info: {
  bookName: string;
  babyName?: string | null;
  carrier?: string;
  trackingNumber?: string;
  trackingUrl?: string;
  orderName?: string;
}): { subject: string; html: string } {
  const what = info.babyName ? `${info.babyName}'s ${info.bookName}` : info.bookName;
  const tracking = info.trackingNumber
    ? `<div style="border:1px solid #F3F4F6;border-radius:10px;padding:16px 20px;margin:0 0 16px 0;">
          <p style="font-size:13px;color:#9CA3AF;margin:0 0 4px 0;">${info.carrier ? escHtml(info.carrier) : "Tracking"}</p>
          <p style="font-size:14px;font-weight:600;color:#1F2937;margin:0;">${escHtml(info.trackingNumber)}</p>
        </div>
        ${info.trackingUrl ? `<a href="${escHtml(info.trackingUrl)}" style="display:block;text-align:center;background-color:#FAB8A9;color:#FFFFFF;padding:14px 24px;border-radius:10px;font-size:15px;font-weight:600;text-decoration:none;">Track My Order</a>` : ""}`
    : "";
  return {
    subject: `Your photo prints have shipped${info.orderName ? ` (${info.orderName})` : ""}`,
    html: printEmailShell("Your photo prints have shipped", `
        <p style="${P}">The prints for <strong>${escHtml(what)}</strong> are on their way.</p>
        ${tracking}`),
  };
}

export async function sendPrintOrderReceived(to: string, info: Parameters<typeof printOrderReceivedEmail>[0]) {
  return sendCustomerEmail({ to, ...printOrderReceivedEmail(info) }, { route: "print-order-received" });
}
export async function sendPrintOrderHeld(to: string, info: Parameters<typeof printOrderHeldEmail>[0]) {
  return sendCustomerEmail({ to, ...printOrderHeldEmail(info) }, { route: "print-order-held" });
}
/** Not called from anywhere yet — waiting on tracking details from Photo Finale. */
export async function sendPrintOrderShipped(to: string, info: Parameters<typeof printOrderShippedEmail>[0]) {
  return sendCustomerEmail({ to, ...printOrderShippedEmail(info) }, { route: "print-order-shipped" });
}
