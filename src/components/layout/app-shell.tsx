import type { ReactNode } from "react";

import Link from "next/link";

import { OPERATOR_NAV_LINKS, PRIMARY_NAV_LINKS } from "./nav-config";

export function AppShell({ children }: { children: ReactNode }) {
  return (
    <div className="coin-shell">
      <aside className="coin-sidebar" aria-label="Main navigation">
        <div className="coin-sidebar__brand">
          <span className="coin-sidebar__brand-text">CoinPulse</span>
        </div>

        <nav className="coin-sidebar__primary" aria-label="Primary">
          {PRIMARY_NAV_LINKS.map((link) => (
            <Link key={link.href} href={link.href} className="coin-sidebar__link">
              {link.label}
            </Link>
          ))}
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
              {PRIMARY_NAV_LINKS.map((link) => (
                <Link key={link.href} href={link.href} className="coin-mobile-nav__link">
                  {link.label}
                </Link>
              ))}
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
