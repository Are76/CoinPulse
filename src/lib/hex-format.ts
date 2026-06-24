export const HEARTS_PER_HEX = 100_000_000n;

/**
 * Converts a Hearts integer string (HEX's base unit) to a human-readable
 * HEX display string with up to 8 decimal places.
 * Returns null for non-integer input.
 */
export function formatHeartsAsHexDisplay(hearts: string): string | null {
  if (!/^\d+$/.test(hearts)) return null;

  const rawHearts = BigInt(hearts);
  const wholeHex = rawHearts / HEARTS_PER_HEX;
  const fractionalHearts = rawHearts % HEARTS_PER_HEX;

  if (fractionalHearts === 0n) return wholeHex.toString();

  const fraction = fractionalHearts.toString().padStart(8, "0").replace(/0+$/, "");
  return `${wholeHex.toString()}.${fraction}`;
}
