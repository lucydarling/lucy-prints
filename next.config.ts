import type { NextConfig } from "next";

// Baseline security headers applied to every response.
// CSP is intentionally permissive on connect/img/style because the app talks to
// Supabase (storage signed URLs + REST) and Klaviyo, and uses inline styles via
// Tailwind. Tighten per-source if/when the external surface is locked down.
//
// NOTE: two blob: allowances are required by the photo pipeline:
//   • connect-src blob: — react-advanced-cropper fetches the uploaded photo's
//     blob: object URL (to read EXIF orientation) before it can produce a
//     cropped canvas. Without it, getCanvas() returns null and the crop
//     silently yields no image → empty download ZIP.
//   • worker-src blob: — heic2any converts iPhone HEIC/HEIF uploads in a Web
//     Worker created from a blob: URL. Without it, HEIC conversion is blocked
//     and those photos can't be added at all.
// Both restored 2026-07-12 after the crop→download flow was found broken.
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
      "connect-src 'self' blob: https://*.supabase.co https://a.klaviyo.com https://*.klaviyo.com",
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
