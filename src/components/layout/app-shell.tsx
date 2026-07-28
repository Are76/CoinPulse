"use client";

import { Suspense, type ReactNode } from "react";

import Link from "next/link";
import { useSearchParams } from "next/navigation";

import {
  buildWalletNavHref,
  parseWalletNavContext,
} from "@/lib/navigation/wallet-query-params";

import { OPERATOR_NAV_LINKS, PRIMARY_NAV_LINKS } from "./nav-config";

/**
 * Primary links rendered without wallet context. Used directly as the
 * Suspense fallback so navigation is always present, and as the no-context
 * render path in tests/environments without a router.
 */
function StaticPrimaryNavLinks({ linkClassName }: { linkClassName: string }) {
  return (
    <>
      {PRIMARY_NAV_LINKS.map((link) => (
        <Link key={link.href} href={link.href} className={linkClassName}>
          {link.label}
        </Link>
      ))}
    </>
  );
}

/**
 * Primary links that forward validated walletAddress/chainId from the current
 * URL. Destination hrefs are computed at render time; PRIMARY_NAV_LINKS is
 * never mutated. Invalid or absent params fall back to the plain hrefs, and
 * assetId (or any other param) is never forwarded.
 */
function WalletContextPrimaryNavLinks({ linkClassName }: { linkClassName: string }) {
  const searchParams = useSearchParams();
  const walletNavContext = parseWalletNavContext(searchParams);

  return (
    <>
      {PRIMARY_NAV_LINKS.map((link) => (
        <Link
          key={link.href}
          href={buildWalletNavHref(link.href, walletNavContext)}
          className={linkClassName}
        >
          {link.label}
        </Link>
      ))}
    </>
  );
}

function PrimaryNavLinks({ linkClassName }: { linkClassName: string }) {
  return (
    <Suspense fallback={<StaticPrimaryNavLinks linkClassName={linkClassName} />}>
      <WalletContextPrimaryNavLinks linkClassName={linkClassName} />
    </Suspense>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  return (
    <div className="coin-shell">
      <aside className="coin-sidebar" aria-label="Main navigation">
        <div className="coin-sidebar__brand">
          <span className="coin-sidebar__brand-text">CoinPulse</span>
        </div>

        <nav className="coin-sidebar__primary" aria-label="Primary">
          <PrimaryNavLinks linkClassName="coin-sidebar__link" />
        </nav>

        <div className="coin-sidebar__section-label">Operator</div>

        <nav className="coin-sidebar__operator" aria-label="Operator tools">
          {OPERATOR_NAV_LINKS.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className="coin-sidebar__link coin-sidebar__link--muted"
            >
              {link.label}
            </Link>
          ))}
        </nav>
      </aside>

      <div className="coin-shell__body">
        <nav className="coin-mobile-nav" aria-label="Mobile navigation">
          <details className="coin-mobile-nav__menu">
            <summary className="coin-mobile-nav__toggle">CoinPulse</summary>
            <div className="coin-mobile-nav__links">
              <PrimaryNavLinks linkClassName="coin-mobile-nav__link" />
              <div className="coin-mobile-nav__section-label">Operator</div>
              {OPERATOR_NAV_LINKS.map((link) => (
                <Link
                  key={link.href}
                  href={link.href}
                  className="coin-mobile-nav__link coin-mobile-nav__link--muted"
                >
                  {link.label}
                </Link>
              ))}
            </div>
          </details>
        </nav>

        {children}
      </div>
    </div>
  );
}
