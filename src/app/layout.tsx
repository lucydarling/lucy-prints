import type { Metadata, Viewport } from "next";
import { Geist } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#FAB8A9",
};

export const metadata: Metadata = {
  title: "Lucy Darling Photo Prints",
  description:
    "Upload and print photos for your Lucy Darling memory book. Guided prompts, perfect crops, delivered to your door.",
  openGraph: {
    title: "Lucy Darling Photo Prints",
    description:
      "Upload and print photos for your Lucy Darling memory book. Guided prompts, perfect crops, delivered to your door.",
    siteName: "Lucy Darling",
    type: "website",
    url: "https://lucy-prints.vercel.app",
  },
  twitter: {
    card: "summary",
    title: "Lucy Darling Photo Prints",
    description:
      "Upload and print photos for your Lucy Darling memory book.",
  },
  icons: {
    icon: "/favicon.ico",
    apple: "/apple-touch-icon.png",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body
        className={`${geistSans.variable} antialiased bg-gray-50`}
      >
        {children}
      </body>
    </html>
  );
}
