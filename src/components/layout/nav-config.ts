/**
 * Verified active app routes for CoinPulse shell navigation.
 *
 * PRIMARY_NAV_LINKS: user-facing pages
 * OPERATOR_NAV_LINKS: operator/debug tools (mirror of OperatorToolsNav)
 *
 * Only routes with a corresponding src/app/.../page.tsx file are listed here.
 * Do not add routes that do not exist as active app pages.
 */

export const PRIMARY_NAV_LINKS = [
  { href: "/", label: "Dashboard" },
  { href: "/transactions", label: "Transactions" },
  { href: "/hexmining", label: "HexMining" },
] as const;

export const OPERATOR_NAV_LINKS = [
  { href: "/debug/sync", label: "Debug sync" },
  { href: "/debug/wallets/import", label: "Wallet import" },
  { href: "/debug/wallets/tracked", label: "Tracked wallets" },
  { href: "/debug/prices/status", label: "Pricing status" },
] as const;

export type NavLink = (typeof PRIMARY_NAV_LINKS)[number] | (typeof OPERATOR_NAV_LINKS)[number];
