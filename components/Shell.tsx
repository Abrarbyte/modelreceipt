"use client";

/**
 * Site chrome: header, nav, theme toggle, the tour, the particle field.
 *
 * The nav is deliberately grouped rather than flat. Eleven equal links read as
 * eleven products; three groups read as one product with an obvious way in:
 *   Try it   - the three live applications
 *   Check it - verify, log, compliance, audit
 *   Learn    - what it is, how it works
 */

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ThemeProvider, ThemeToggle } from "@/components/Theme";
import { Tour, useTour } from "@/components/Tour";

function NavLink({ href, children }: { href: string; children: React.ReactNode }) {
  const path = usePathname();
  const active = path === href;
  return (
    <Link href={href} className={active ? "active" : ""}>
      {children}
    </Link>
  );
}

function Header({ onTour }: { onTour: () => void }) {
  return (
    <header className="site-header">
      <Link href="/" className="brand">
        <span className="brand-mark">▣</span> ModelReceipt
      </Link>
      <nav>
        <NavLink href="/">Home</NavLink>
        <span className="nav-group">
          <NavLink href="/chat">Chat</NavLink>
          <NavLink href="/decisions">Decisions</NavLink>
          <NavLink href="/vehicle">Vehicle</NavLink>
        </span>
        <NavLink href="/verify">Verify</NavLink>
        <NavLink href="/log">Log</NavLink>
        <NavLink href="/compliance">Compliance</NavLink>
        <NavLink href="/audit">Audit</NavLink>
        <NavLink href="/why">About</NavLink>
        <button className="nav-btn" onClick={onTour} title="Show the introduction">
          ? Tour
        </button>
        <ThemeToggle />
      </nav>
    </header>
  );
}

function ShellInner({ children }: { children: React.ReactNode }) {
  const tour = useTour();
  return (
    <>
      <Header onTour={() => tour.setOpen(true)} />
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
      <Tour open={tour.open} onClose={tour.close} />
    </>
  );
}

export function Shell({ children }: { children: React.ReactNode }) {
  return (
    <ThemeProvider>
      <ShellInner>{children}</ShellInner>
    </ThemeProvider>
  );
}
