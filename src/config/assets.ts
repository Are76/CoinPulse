export const PULSECHAIN_NATIVE_ASSET_ID =
  "chain:369:native:0x0000000000000000000000000000000000000000";
export const PULSECHAIN_NATIVE_TOKEN_ADDRESS =
  "0x0000000000000000000000000000000000000000";
export const PHEX_ADDRESS = "0x2b591e99afe9f32eaa6214f7b7629768c40eeb39";
export const PHEX_DECIMALS = 8;

// Bridged DAI on PulseChain — the PulseX router's routing reference asset.
// Canonical identity source for pDAI quote-eligibility checks; see
// src/services/pricing/price-resolver.ts.
export const PDAI_ADDRESS = "0xefD766cCb38EaF1dfd701853BFCe31359239F305";
export const PDAI_DECIMALS = 18;

export const CORE_ASSETS = {
  nativePls: {
    assetId: PULSECHAIN_NATIVE_ASSET_ID,
    chainId: 369,
    address: PULSECHAIN_NATIVE_TOKEN_ADDRESS,
    symbol: "PLS",
    decimals: 18,
    isNative: true,
  },
  phex: {
    assetId: `chain:369:erc20:${PHEX_ADDRESS}`,
    chainId: 369,
    address: PHEX_ADDRESS,
    symbol: "pHEX",
    decimals: PHEX_DECIMALS,
    isNative: false,
  },
  pdai: {
    assetId: `chain:369:erc20:${PDAI_ADDRESS}`,
    chainId: 369,
    address: PDAI_ADDRESS,
    symbol: "pDAI",
    decimals: PDAI_DECIMALS,
    isNative: false,
  },
} as const;
