import { Resend } from "resend";

const resend = process.env.RESEND_API_KEY
  ? new Resend(process.env.RESEND_API_KEY)
  : (null as unknown as Resend);

export async function sendMagicLinkEmail({
  to,
  babyName,
  token,
  photoCount,
}: {
  to: string;
  babyName?: string;
  token: string;
  photoCount: number;
}) {
  const resumeUrl = `${process.env.NEXT_PUBLIC_APP_URL}/resume/${token}`;
  const subject = babyName
    ? `Your photo book for ${babyName} is saved`
    : "Your Lucy Darling photo book is saved";

  const greeting = babyName ? `${babyName}'s` : "Your";

  await resend.emails.send({
    from: "Lucy Darling Prints <prints@lucydarling.com>",
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
        <img src="${process.env.NEXT_PUBLIC_APP_URL}/logo.png" alt="Lucy Darling" width="150" style="display:block;" />
        <p style="font-size:12px;color:#FAB8A9;margin:4px 0 0 0;font-weight:500;">Photo Prints</p>
      </td>
    </tr>
    <tr>
      <td style="background:#FFFFFF;border-radius:12px;padding:32px 24px;border:1px solid #F3F4F6;">
        <h1 style="font-size:20px;color:#1F2937;margin:0 0 8px 0;font-weight:600;">
          ${greeting} photo book is saved!
        </h1>
        <p style="font-size:14px;color:#6B7280;line-height:1.6;margin:0 0 20px 0;">
          You have ${photoCount} photo${photoCount !== 1 ? "s" : ""} saved so far.
          Pick up right where you left off on any device.
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
  });
}
