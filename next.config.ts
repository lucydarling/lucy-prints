import type { NextConfig } from "next";

// Baseline security headers applied to every response.
// CSP is intentionally permissive on connect/img/style because the app talks to
// Supabase (storage signed URLs + REST) and Klaviyo, and uses inline styles via
// Tailwind. Tighten per-source if/when the external surface is locked down.
//
// NOTE: three allowances are required by the photo pipeline. Removing any one
// of them silently breaks it — the failures are async and swallowed, so the UI
// looks like it worked. Do not "tighten" these without re-running a real
// upload→crop→upload→download pass against production.
//   • connect-src blob: — react-advanced-cropper fetches the uploaded photo's
//     blob: object URL (to read EXIF orientation) before it can produce a
//     cropped canvas. Without it, getCanvas() returns null and the crop
//     silently yields no image → empty download ZIP.
//   • worker-src blob: — heic2any converts iPhone HEIC/HEIF uploads in a Web
//     Worker created from a blob: URL. Without it, HEIC conversion is blocked
//     and those photos can't be added at all.
//   • connect-src data: — the cropped image is a canvas.toDataURL() data: URL
//     (CropModal), and BOTH the upload path (useAutoUpload → fetch(croppedUrl)
//     → /api/photos/upload) and the ZIP path (download-zip dataUrlToBlob)
//     re-fetch it to get a Blob. fetch() on a data: URL is governed by
//     connect-src — img-src data: does NOT cover it. Without this, every photo
//     upload throws before reaching the API (zero rows in session_photos) and
//     the ZIP assembles with no bytes.
// blob: pair restored 2026-07-12; data: restored 2026-08-06.
const securityHeaders = [
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    key: "Content-Security-Policy",
    value: [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: blob: https:",
      "font-src 'self' data:",
      "connect-src 'self' data: blob: https://*.supabase.co https://a.klaviyo.com https://*.klaviyo.com",
      "worker-src 'self' blob:",
      "frame-ancestors 'none'",
      "base-uri 'self'",
      "form-action 'self'",
    ].join("; "),
  },
];

const nextConfig: NextConfig = {
  async headers() {
    return [
      {
        source: "/:path*",
        headers: securityHeaders,
      },
    ];
  },
};

export default nextConfig;
