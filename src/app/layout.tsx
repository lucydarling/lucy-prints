import type { Metadata, Viewport } from "next";
import Script from "next/script";
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
  title: "Lucy Darling — Photo Lab",
  description:
    "Get your photos print-ready for every page of your Lucy Darling memory book. Photo Lab guides you through each section — just upload, crop, and print.",
  openGraph: {
    title: "Lucy Darling — Photo Lab",
    description:
      "Get your photos print-ready for every page of your Lucy Darling memory book. Photo Lab guides you through each section — just upload, crop, and print.",
    siteName: "Lucy Darling",
    type: "website",
    url: "https://memories.lucydarling.com",
    images: [
      {
        url: "https://memories.lucydarling.com/og-image.jpg",
        width: 1200,
        height: 630,
        alt: "Lucy Darling Photo Lab",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "Lucy Darling — Photo Lab",
    description:
      "Get your photos print-ready for every page of your Lucy Darling memory book.",
    images: ["https://memories.lucydarling.com/og-image.jpg"],
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
      <head>
        <Script id="meta-pixel" strategy="afterInteractive">
          {`
            !function(f,b,e,v,n,t,s)
            {if(f.fbq)return;n=f.fbq=function(){n.callMethod?
            n.callMethod.apply(n,arguments):n.queue.push(arguments)};
            if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';
            n.queue=[];t=b.createElement(e);t.async=!0;
            t.src=v;s=b.getElementsByTagName(e)[0];
            s.parentNode.insertBefore(t,s)}(window, document,'script',
            'https://connect.facebook.net/en_US/fbevents.js');
            fbq('init', '186501195088070');
            fbq('track', 'PageView');
          `}
        </Script>
        <noscript>
          <img
            height="1"
            width="1"
            style={{ display: "none" }}
            src="https://www.facebook.com/tr?id=186501195088070&ev=PageView&noscript=1"
            alt=""
          />
        </noscript>
      </head>
      <body
        className={`${geistSans.variable} antialiased bg-gray-50`}
      >
        {children}
        <footer className="text-center text-xs text-gray-400 py-6 mt-12 border-t border-gray-100">
          <a href="https://lucydarling.com" className="hover:text-gray-600 transition-colors">Lucy Darling</a>
          <span className="mx-2">·</span>
          <a href="https://lucydarling.com/pages/privacy-policy" className="hover:text-gray-600 transition-colors">Privacy</a>
          <span className="mx-2">·</span>
          <a href="mailto:customerservice@lucydarling.com" className="hover:text-gray-600 transition-colors">Contact</a>
        </footer>
      </body>
    </html>
  );
}
