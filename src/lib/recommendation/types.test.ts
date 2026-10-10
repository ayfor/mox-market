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
const SRC_DIR = path.resolve(ENGINE_DIR, "..", "..");

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
// A dynamic import or require whose argument is not a string literal cannot
// be checked, so it is an offence in itself.
const NON_LITERAL = /\b(?:import|require)\s*\(\s*(?!["'\s])/g;

function importsOf(source: string): string[] {
  return [...source.matchAll(SPECIFIER)].map((m) => m[1]);
}

/** React, React DOM, Next and their scoped relatives (`@next/*`, `@scope/react`). */
const FORBIDDEN_PACKAGE = (spec: string) =>
  /^(react|react-dom|next)(\/|$)/.test(spec) ||
  /^@next\//.test(spec) ||
  /^@[^/]+\/react(-dom)?(\/|$)/.test(spec);

const insideEngine = (target: string) => {
  const rel = path.relative(ENGINE_DIR, target);
  return (
    rel === "" || (rel.split(path.sep)[0] !== ".." && !path.isAbsolute(rel))
  );
};

/**
 * Why `spec`, imported from `file`, breaks engine purity, or null. Relative
 * and `@/` specifiers must resolve inside src/lib/recommendation (ADV.5), so
 * `../../app/page` and `@/components/*` fail like `next` does. `node:`
 * builtins and other packages are allowed.
 */
function offenceOf(file: string, spec: string): string | null {
  if (spec.startsWith("node:")) return null;
  if (spec.startsWith("."))
    return insideEngine(path.resolve(path.dirname(file), spec))
      ? null
      : "leaves src/lib/recommendation";
  if (spec.startsWith("@/"))
    return insideEngine(path.resolve(SRC_DIR, spec.slice(2)))
      ? null
      : "leaves src/lib/recommendation";
  if (spec.startsWith("/")) return "absolute path";
  return FORBIDDEN_PACKAGE(spec) ? "React or Next" : null;
}

function offencesIn(file: string, source: string): string[] {
  const named = importsOf(source).flatMap((spec) => {
    const why = offenceOf(file, spec);
    return why ? [`${spec} (${why})`] : [];
  });
  const dynamic = [...source.matchAll(NON_LITERAL)].map(
    () => "non-literal import() or require()",
  );
  return [...named, ...dynamic];
}

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
  const AT = path.join(ENGINE_DIR, "engine.ts");

  test("the import scanner catches every import form", () => {
    const sample = [
      'import React from "react";',
      "import { useState } from 'react';",
      'import "next/headers";',
      'export { x } from "@/app/page";',
      'const m = await import("react-dom/client");',
      'const r = require("next");',
      'import type { Metadata } from "next";',
      'import P from "../../app/[card]/page";',
      'import { C } from "@/components/card";',
      'import { s } from "@/lib/scryfall";',
      'import x from "@/lib/recommendation/../../app/page";',
      'import { Listbox } from "@headlessui/react";',
      'import { font } from "@next/font/google";',
      "const n = await import(name);",
      "const t = require(`./${name}`);",
    ].join("\n");
    expect(offencesIn(AT, sample)).toEqual([
      "react (React or Next)",
      "react (React or Next)",
      "next/headers (React or Next)",
      "@/app/page (leaves src/lib/recommendation)",
      "react-dom/client (React or Next)",
      "next (React or Next)",
      "next (React or Next)",
      "../../app/[card]/page (leaves src/lib/recommendation)",
      "@/components/card (leaves src/lib/recommendation)",
      "@/lib/scryfall (leaves src/lib/recommendation)",
      "@/lib/recommendation/../../app/page (leaves src/lib/recommendation)",
      "@headlessui/react (React or Next)",
      "@next/font/google (React or Next)",
      "non-literal import() or require()",
      "non-literal import() or require()",
    ]);
  });

  test("allows imports that stay inside the engine, node: builtins and other packages", () => {
    const sample = [
      'import { FINISHES } from "./types";',
      'import { x } from "./tier2/adjust";',
      'import { y } from "@/lib/recommendation/params";',
      'import { createHash } from "node:crypto";',
      'import { z } from "zod";',
      'import a from "next-auth";',
      'import c from "./react";',
      'const d = await import("./limits");',
      'const e = await import( "./limits" );',
    ].join("\n");
    expect(offencesIn(AT, sample)).toEqual([]);
  });

  test("no file under src/lib/recommendation imports React, Next or anything outside the engine", () => {
    // This file is skipped: its scanner samples hold forbidden specifiers as data.
    const files = sourceFiles(ENGINE_DIR).filter((f) => f !== __filename);
    expect(files.length).toBeGreaterThan(0);
    const offenders = files.flatMap((file) =>
      offencesIn(file, readFileSync(file, "utf8")).map(
        (offence) => `${path.relative(ENGINE_DIR, file)} → ${offence}`,
      ),
    );
    expect(offenders).toEqual([]);
  });
});
