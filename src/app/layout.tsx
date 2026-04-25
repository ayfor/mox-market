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
    template: "%s — Mox Market",
    default: "Mox Market — Should you buy it?",
  },
  description:
    "Mox Market evaluates a single Magic: The Gathering card listing against the 30-day market. Enter a card and a price; get a verdict.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={InterVariable.variable}>
      <body>{children}</body>
    </html>
  );
}
