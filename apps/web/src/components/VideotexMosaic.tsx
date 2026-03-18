/**
 * VideotexMosaic — Decorative VIDEOTEX-style block elements
 *
 * The Minitel VIDEOTEX standard (CCETT, 1980) used 2×3 sub-cell mosaic
 * characters to render low-res graphics on the 40×25 grid. We replicate
 * this with Unicode block elements: ▀▄█░▒▓▌▐╔═╗║╚╝
 *
 * Usage:
 *   <VideotexSeparator />           — horizontal line
 *   <VideotexBorder>content</VideotexBorder> — boxed content
 *   <VideotexPageHeader title="..." /> — page header with mosaïque
 *   <VideotexBanner>text</VideotexBanner> — alert/info banner
 */

import React from "react";

// ── Mosaic separator ──
export function VideotexSeparator({ color = "green" }: { color?: "green" | "pink" | "amber" | "cyan" }) {
  const pattern = "░▒▓█▓▒░";
  const line = pattern.repeat(6);
  return (
    <div className={`vtx-separator vtx-${color}`} aria-hidden="true">
      {line}
    </div>
  );
}

// ── Mosaic page header ──
export function VideotexPageHeader({
  title,
  subtitle,
  color = "green",
}: {
  title: string;
  subtitle?: string;
  color?: "green" | "pink" | "amber" | "cyan";
}) {
  const top = "╔" + "═".repeat(38) + "╗";
  const bot = "╚" + "═".repeat(38) + "╝";
  const pad = (s: string, len: number) => {
    const trimmed = s.slice(0, len);
    const spaces = len - trimmed.length;
    const left = Math.floor(spaces / 2);
    const right = spaces - left;
    return " ".repeat(left) + trimmed + " ".repeat(right);
  };

  return (
    <div className={`vtx-page-header vtx-${color}`}>
      <div className="vtx-line">{top}</div>
      <div className="vtx-line">║{pad(title, 38)}║</div>
      {subtitle && (
        <div className="vtx-line vtx-dim">║{pad(subtitle, 38)}║</div>
      )}
      <div className="vtx-line">{bot}</div>
    </div>
  );
}

// ── Mosaic box border ──
export function VideotexBorder({
  children,
  color = "green",
}: {
  children: React.ReactNode;
  color?: "green" | "pink" | "amber" | "cyan";
}) {
  return (
    <div className={`vtx-border vtx-${color}`}>
      <div className="vtx-border-top" aria-hidden="true">
        ▄{"▀".repeat(38)}▄
      </div>
      <div className="vtx-border-content">{children}</div>
      <div className="vtx-border-bottom" aria-hidden="true">
        ▀{"▄".repeat(38)}▀
      </div>
    </div>
  );
}

// ── Mosaic info banner ──
export function VideotexBanner({
  children,
  color = "amber",
}: {
  children: React.ReactNode;
  color?: "green" | "pink" | "amber" | "cyan";
}) {
  return (
    <div className={`vtx-banner vtx-${color}`}>
      <span className="vtx-banner-deco" aria-hidden="true">▌</span>
      <span className="vtx-banner-text">{children}</span>
      <span className="vtx-banner-deco" aria-hidden="true">▐</span>
    </div>
  );
}

// ── Mosaic decorative blocks (purely visual) ──
export function VideotexBlocks({ pattern = "checker", width = 40 }: { pattern?: "checker" | "gradient" | "wave"; width?: number }) {
  const chars = { checker: "▚▞", gradient: "░▒▓█", wave: "▁▂▃▄▅▆▇█" };
  const set = chars[pattern] || chars.checker;
  const line = Array.from({ length: width }, (_, i) => set[i % set.length]).join("");
  return (
    <div className="vtx-blocks" aria-hidden="true">
      {line}
    </div>
  );
}
