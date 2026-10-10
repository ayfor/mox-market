// T1 (AC-1, AC-3): the test-time spec reader (S2.2d6), on inline fixtures and
// on the real docs/specs/attribution-footer.md.
import { describe, expect, test } from "vitest";
import {
  AFFILIATE_HEADING,
  DISCLAIMER_HEADING,
  FOOTER_HEADING,
  readSpec,
  readSpecBlockquotes,
  readSpecLinkTarget,
  SpecSectionError,
} from "./attribution-spec";

const fixture = (...lines: string[]) => lines.join("\n");

const FOOTER_AND_AFFILIATE = fixture(
  "# Title",
  "",
  "## Site footer, every page",
  "",
  "Intro paragraph.",
  "",
  "> Line one.",
  "",
  '"Fan Content Policy" links to https://example.test/fcp',
  "",
  "> Line two.",
  "",
  "> Line three.",
  "",
  "## At affiliate launch (not Phase 1)",
  "",
  "> Affiliate line.",
);

describe("readSpecBlockquotes on fixtures (T1)", () => {
  test("returns the section's blockquotes in order", () => {
    expect(readSpecBlockquotes(FOOTER_AND_AFFILIATE, FOOTER_HEADING)).toEqual([
      "Line one.",
      "Line two.",
      "Line three.",
    ]);
  });

  test("a missing heading throws SpecSectionError naming the heading", () => {
    const read = () => readSpecBlockquotes("## Other\n\n> x", FOOTER_HEADING);
    expect(read).toThrow(SpecSectionError);
    expect(read).toThrow(`"## ${FOOTER_HEADING}" not found`);
  });

  test("a heading with no blockquote throws", () => {
    const md = fixture(
      "## Site footer, every page",
      "",
      "Just text.",
      "",
      "## Next",
      "> y",
    );
    expect(() => readSpecBlockquotes(md, FOOTER_HEADING)).toThrow(
      `"## ${FOOTER_HEADING}" has no blockquote`,
    );
  });

  test("a duplicated heading throws instead of picking one", () => {
    const md = fixture(
      "## Site footer, every page",
      "> a",
      "## Site footer, every page",
      "> b",
    );
    expect(() => readSpecBlockquotes(md, FOOTER_HEADING)).toThrow(
      "appears 2 times",
    );
  });

  test.each([
    ["a suffixed heading", "## Site footer, every page (draft)"],
    ["a level-3 heading", "### Site footer, every page"],
    ["a level-1 heading", "# Site footer, every page"],
    ["a prefix", "## Site footer"],
    ["no space after ##", "##Site footer, every page"],
  ])("%s does not match", (_name, heading) => {
    const md = fixture(heading, "", "> Wrong section.");
    expect(() => readSpecBlockquotes(md, FOOTER_HEADING)).toThrow(
      SpecSectionError,
    );
  });

  test("trailing whitespace on the heading line still matches", () => {
    expect(
      readSpecBlockquotes("## Site footer, every page  \n> ok", FOOTER_HEADING),
    ).toEqual(["ok"]);
  });

  test("the section ends at the next ## heading, so a following affiliate section is never returned", () => {
    const quotes = readSpecBlockquotes(FOOTER_AND_AFFILIATE, FOOTER_HEADING);
    expect(quotes).not.toContain("Affiliate line.");
    expect(quotes.join(" ")).not.toContain("Affiliate");
  });

  test("the section also ends at a # heading", () => {
    const md = fixture(
      "## Site footer, every page",
      "> in",
      "# Appendix",
      "> out",
    );
    expect(readSpecBlockquotes(md, FOOTER_HEADING)).toEqual(["in"]);
  });

  test("a ### subsection stays inside the section", () => {
    const md = fixture(
      "## Site footer, every page",
      "> a",
      "### Sub",
      "> b",
      "## Next",
      "> c",
    );
    expect(readSpecBlockquotes(md, FOOTER_HEADING)).toEqual(["a", "b"]);
  });

  test("a two-line blockquote joins with one space", () => {
    const md = fixture(
      "## Site footer, every page",
      "> First half",
      "> second half.",
    );
    expect(readSpecBlockquotes(md, FOOTER_HEADING)).toEqual([
      "First half second half.",
    ]);
  });

  test("> with no following space is stripped", () => {
    const md = fixture("## Site footer, every page", ">Tight.");
    expect(readSpecBlockquotes(md, FOOTER_HEADING)).toEqual(["Tight."]);
  });

  test("only one space after > is stripped, and the line is then trimmed", () => {
    const md = fixture("## Site footer, every page", ">    Padded.   ");
    expect(readSpecBlockquotes(md, FOOTER_HEADING)).toEqual(["Padded."]);
  });

  test("CRLF input gives the same result as LF", () => {
    expect(
      readSpecBlockquotes(
        FOOTER_AND_AFFILIATE.replace(/\n/g, "\r\n"),
        FOOTER_HEADING,
      ),
    ).toEqual(readSpecBlockquotes(FOOTER_AND_AFFILIATE, FOOTER_HEADING));
  });

  test("a heading or a > line inside a code fence is ignored", () => {
    const md = fixture(
      "```md",
      "## Site footer, every page",
      "> fenced",
      "```",
      "## Site footer, every page",
      "> real",
      "```",
      "> fenced too",
      "```",
    );
    expect(readSpecBlockquotes(md, FOOTER_HEADING)).toEqual(["real"]);
  });

  test("blank lines separate blockquotes", () => {
    const md = fixture("## Site footer, every page", "> one", "", "> two");
    expect(readSpecBlockquotes(md, FOOTER_HEADING)).toEqual(["one", "two"]);
  });
});

describe("readSpecLinkTarget on fixtures (T1)", () => {
  test("returns the URL from the links-to sentence", () => {
    expect(
      readSpecLinkTarget(
        FOOTER_AND_AFFILIATE,
        FOOTER_HEADING,
        "Fan Content Policy",
      ),
    ).toBe("https://example.test/fcp");
  });

  test("a trailing full stop is not part of the URL", () => {
    const md = fixture(
      "## Site footer, every page",
      '"Fan Content Policy" links to https://example.test/x.',
    );
    expect(readSpecLinkTarget(md, FOOTER_HEADING, "Fan Content Policy")).toBe(
      "https://example.test/x",
    );
  });

  test("throws when the sentence is missing", () => {
    const md = fixture("## Site footer, every page", "> Line one.");
    expect(() =>
      readSpecLinkTarget(md, FOOTER_HEADING, "Fan Content Policy"),
    ).toThrow(SpecSectionError);
  });

  test("throws when the sentence names other link text", () => {
    const md = fixture(
      "## Site footer, every page",
      '"Fan Policy" links to https://example.test/x',
    );
    expect(() =>
      readSpecLinkTarget(md, FOOTER_HEADING, "Fan Content Policy"),
    ).toThrow('"Fan Content Policy" links to <url>');
  });

  test("a sentence in another section is not found", () => {
    const md = fixture(
      "## Site footer, every page",
      "> Line one.",
      "## Other",
      '"Fan Content Policy" links to https://example.test/x',
    );
    expect(() =>
      readSpecLinkTarget(md, FOOTER_HEADING, "Fan Content Policy"),
    ).toThrow(SpecSectionError);
  });
});

describe("the real spec (T1)", () => {
  const spec = readSpec();

  test("the footer heading gives exactly 3 blockquotes", () => {
    expect(readSpecBlockquotes(spec, FOOTER_HEADING)).toHaveLength(3);
  });

  test("the disclaimer heading gives exactly 1 blockquote", () => {
    expect(readSpecBlockquotes(spec, DISCLAIMER_HEADING)).toHaveLength(1);
  });

  test("the affiliate heading gives exactly 1, and its text is in neither other section", () => {
    const affiliate = readSpecBlockquotes(spec, AFFILIATE_HEADING);
    expect(affiliate).toHaveLength(1);
    const others = [
      ...readSpecBlockquotes(spec, FOOTER_HEADING),
      ...readSpecBlockquotes(spec, DISCLAIMER_HEADING),
    ];
    for (const quote of others) {
      expect(quote).not.toContain(affiliate[0]);
      expect(quote).not.toMatch(/commission/i);
    }
  });

  test("the footer section names the Fan Content Policy link target", () => {
    expect(
      readSpecLinkTarget(spec, FOOTER_HEADING, "Fan Content Policy"),
    ).toMatch(/^https:\/\//);
  });
});
