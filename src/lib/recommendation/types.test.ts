// T2 (AC-1): runtime enum tuples and engine purity.
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, test } from "vitest";
import {
  CONFIDENCE_LEVELS,
  FINISHES,
  RECOMMENDATION_KINDS,
  TREND_DIRECTIONS,
} from "./types";

const ENGINE_DIR = path.resolve(__dirname);

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) return sourceFiles(full);
    return /\.(ts|tsx|mts|cts|js|mjs)$/.test(name) ? [full] : [];
  });
}

// Static imports, dynamic imports, re-exports and require calls.
const SPECIFIER =
  /(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s+|\brequire\s*\(\s*)["']([^"']+)["']/g;

function importsOf(source: string): string[] {
  return [...source.matchAll(SPECIFIER)].map((m) => m[1]);
}

const FORBIDDEN = (spec: string) =>
  spec === "react" ||
  spec.startsWith("react/") ||
  spec === "react-dom" ||
  spec.startsWith("react-dom/") ||
  spec === "next" ||
  spec.startsWith("next/") ||
  spec === "@/app" ||
  spec.startsWith("@/app/");

describe("enum tuples", () => {
  test("equal the F1 values in order", () => {
    expect(FINISHES).toEqual(["normal", "foil", "etched"]);
    expect(RECOMMENDATION_KINDS).toEqual([
      "buy",
      "fair",
      "wait",
      "insufficient_data",
    ]);
    expect(CONFIDENCE_LEVELS).toEqual(["high", "medium", "low"]);
    expect(TREND_DIRECTIONS).toEqual(["rising", "falling", "flat"]);
  });
});

describe("engine purity", () => {
  test("the import scanner catches every import form", () => {
    const sample = [
      'import React from "react";',
      "import { useState } from 'react';",
      'import "next/headers";',
      'export { x } from "@/app/page";',
      'const m = await import("react-dom/client");',
      'const r = require("next");',
      'import type { Metadata } from "next";',
    ].join("\n");
    expect(importsOf(sample).filter(FORBIDDEN)).toEqual([
      "react",
      "react",
      "next/headers",
      "@/app/page",
      "react-dom/client",
      "next",
      "next",
    ]);
    expect(FORBIDDEN("next-auth")).toBe(false);
    expect(FORBIDDEN("@/apparel")).toBe(false);
    expect(FORBIDDEN("./react")).toBe(false);
  });

  test("no file under src/lib/recommendation imports React, Next or @/app", () => {
    // This file is skipped: its scanner sample holds forbidden specifiers as data.
    const files = sourceFiles(ENGINE_DIR).filter((f) => f !== __filename);
    expect(files.length).toBeGreaterThan(0);
    const offenders = files.flatMap((file) =>
      importsOf(readFileSync(file, "utf8"))
        .filter(FORBIDDEN)
        .map((spec) => `${path.relative(ENGINE_DIR, file)} → ${spec}`),
    );
    expect(offenders).toEqual([]);
  });
});
