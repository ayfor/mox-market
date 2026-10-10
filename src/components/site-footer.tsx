import { FAN_CONTENT_LINE, SITE_FOOTER_LINES } from "@/lib/copy/legal";
import "./site-footer.css";

/**
 * Site footer (ruling R6, S2.2). RootLayout renders it once, after the page,
 * on every route. Three lines of plain, always-visible text from the legal
 * copy module: no hover, no expand, no modal (AC-6). A server component, so
 * it ships as HTML with no client JavaScript.
 */
export function SiteFooter() {
  const { before, link, after } = FAN_CONTENT_LINE;
  const [, tcgplayerLine, pricesLine] = SITE_FOOTER_LINES;
  return (
    <footer className="mm-site-footer">
      <p className="mm-site-footer-line">
        {before}
        <a className="mm-site-footer-link" href={link.href}>
          {link.text}
        </a>
        {after}
      </p>
      <p className="mm-site-footer-line">{tcgplayerLine}</p>
      <p className="mm-site-footer-line">{pricesLine}</p>
    </footer>
  );
}
