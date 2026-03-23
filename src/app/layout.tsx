import { clsx } from "clsx";
import { GeistMono } from "geist/font/mono";
import localFont from "next/font/local";
import type { Metadata } from "next";
import type React from "react";
import "./globals.css";

const InterVariable = localFont({
  variable: "--font-inter",
  src: [
    { path: "./InterVariable.woff2", style: "normal" },
    { path: "./InterVariable-Italic.woff2", style: "italic" },
  ],
});

export const metadata: Metadata = {
  title: {
    template: "%s - Mox Market",
    default: "Mox Market - MTG Card Price Monitor",
  },
  description:
    "Track Magic: The Gathering card prices in real time. Build watchlists, import decklists, and monitor price movements.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html
      lang="en"
      className={clsx(
        GeistMono.variable,
        InterVariable.variable,
        "dark scroll-pt-16 font-sans antialiased dark:bg-gray-950",
      )}
    >
      <body>
        <div className="isolate">{children}</div>
      </body>
    </html>
  );
}
