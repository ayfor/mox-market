import type { Metadata } from "next";
import localFont from "next/font/local";
import type React from "react";

import { SiteFooter } from "@/components/site-footer";
import { SITE_COPY } from "@/lib/copy/entry-points";
import "./globals.css";

const InterVariable = localFont({
  variable: "--font-inter",
  src: [
    { path: "./InterVariable.woff2", style: "normal" },
    { path: "./InterVariable-Italic.woff2", style: "italic" },
  ],
});

// The title and its template are the one place these two strings live
// (S2.4d5); every other string on the site comes from a copy module.
export const metadata: Metadata = {
  title: {
    template: "%s — Mox Market",
    default: "Mox Market — Should you buy it?",
  },
  description: SITE_COPY.description,
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={InterVariable.variable}>
      <body>
        {children}
        <SiteFooter />
      </body>
    </html>
  );
}
