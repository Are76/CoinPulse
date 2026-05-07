export const PULSECHAIN_NATIVE_ASSET_ID = "chain:369:native:PLS";
export const PULSECHAIN_NATIVE_TOKEN_ADDRESS =
  "0x0000000000000000000000000000000000000000";
export const PHEX_ADDRESS = "0x2b591e99afe9f32eaa6214f7b7629768c40eeb39";
export const PHEX_DECIMALS = 8;

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
} as const;
