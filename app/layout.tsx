import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";

export const metadata: Metadata = {
  title: "ModelReceipt — verifiable receipts for AI inference",
  description:
    "You paid for a model. Prove which one you got. Cryptographic, privacy-preserving receipts for every AI inference, built on the CooL SDK.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <header className="site-header">
          <Link href="/" className="brand">
            <span className="brand-mark">▣</span> ModelReceipt
          </Link>
          <nav>
            <Link href="/">Gateway</Link>
            <Link href="/verify">Verify</Link>
            <Link href="/log">Log</Link>
            <Link href="/compliance">Compliance</Link>
            <Link href="/how-it-works">How it works</Link>
            <a
              href="https://github.com/Northwind-Cipher/cool-sdk"
              target="_blank"
              rel="noreferrer"
            >
              CooL SDK ↗
            </a>
          </nav>
        </header>
        <main>{children}</main>
        <footer className="site-footer">
          <p>
            Receipts are produced by the{" "}
            <a href="https://github.com/Northwind-Cipher/cool-sdk" target="_blank" rel="noreferrer">
              CooL SDK
            </a>{" "}
            (<code>cool-nwc</code>) and are verifiable offline with{" "}
            <code>npx cool-nwc verify receipt.json</code> — no account, and no trust in this
            deployment required.
          </p>
        </footer>
      </body>
    </html>
  );
}
