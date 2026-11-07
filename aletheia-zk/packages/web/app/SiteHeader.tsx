"use client";

import Link from "next/link";

/**
 * The Aletheia brand bar and primary nav, shared by both flows so branding and the
 * Holder/Verifier switch stay identical across pages. `active` marks the current flow.
 */
export function SiteHeader({ active }: { active: "holder" | "verify" }) {
  return (
    <header className="brandbar">
      <Link href="/" className="brand" aria-label="Aletheia home">
        <span className="brand-mark" aria-hidden="true">
          {/* An eye/aperture mark — aletheia, "disclosure / truth". */}
          <svg viewBox="0 0 24 24" width="20" height="20" role="img" aria-hidden="true">
            <path
              d="M1.5 12S5 5 12 5s10.5 7 10.5 7-3.5 7-10.5 7S1.5 12 1.5 12Z"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.7"
              strokeLinejoin="round"
            />
            <circle cx="12" cy="12" r="3.4" fill="currentColor" />
          </svg>
        </span>
        <span className="brand-text">
          <span className="brand-name">Aletheia</span>
          <span className="brand-tag">Verify the claim, not the document</span>
        </span>
      </Link>
      <nav className="nav" aria-label="Primary">
        <Link href="/" data-active={active === "holder" ? "true" : undefined}>
          Holder
        </Link>
        <Link href="/verify" data-active={active === "verify" ? "true" : undefined}>
          Verifier
        </Link>
      </nav>
    </header>
  );
}
