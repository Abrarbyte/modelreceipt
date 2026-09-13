import type { Metadata } from "next";
import "./globals.css";
import { Shell } from "@/components/Shell";
import { THEME_BOOT_SCRIPT } from "@/components/Theme";

export const metadata: Metadata = {
  title: "ModelReceipt — a receipt for every AI decision",
  description:
    "Cryptographic, privacy-preserving receipts for every AI decision — which model, what it saw, what it produced — verifiable by anyone, offline. Built on the CooL SDK.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        {/* Apply the stored theme before first paint so there is no flash. */}
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOT_SCRIPT }} />
      </head>
      <body>
        <Shell>{children}</Shell>
      </body>
    </html>
  );
}
