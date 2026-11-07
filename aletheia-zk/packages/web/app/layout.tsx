import type { Metadata } from "next";
import "./globals.css";

// The browser/tab title is exactly "Aletheia"; the social-preview title carries the tagline
// so a shared link reads well, while still leading with the Aletheia name.
const SOCIAL_TITLE = "Aletheia — verify the claim, not the document";
const DESCRIPTION =
  "Privacy-preserving credential verification. Prove your age, nationality, or that a credential " +
  "has not expired with a zero-knowledge proof on Ethereum — the verifier learns the answer, " +
  "never the data. Phase 1 uses a clearly labelled mock issuer.";

export const metadata: Metadata = {
  title: "Aletheia",
  description: DESCRIPTION,
  applicationName: "Aletheia",
  openGraph: {
    title: SOCIAL_TITLE,
    description: DESCRIPTION,
    siteName: "Aletheia",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: SOCIAL_TITLE,
    description: DESCRIPTION,
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
