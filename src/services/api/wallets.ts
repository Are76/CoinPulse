import "server-only";

import { getDb } from "@/lib/db";
import { SUPPORTED_CHAINS } from "@/config/chains";

export class WalletImportError extends Error {
  code: "UNSUPPORTED_CHAIN";

  constructor(message: string) {
    super(message);
    this.name = "WalletImportError";
    this.code = "UNSUPPORTED_CHAIN";
  }
}

export async function resolveTrackedWalletByAddress(args: {
  walletAddress: string;
  chainId: number;
}) {
  return getDb().wallet.findUnique({
    where: {
      chainId_addressLower: {
        chainId: args.chainId,
        addressLower: args.walletAddress.toLowerCase(),
      },
    },
    select: {
      id: true,
      address: true,
      chainId: true,
    },
  });
}

export async function importTrackedWallet(args: {
  walletAddress: string;
  chainId: number;
  label?: string;
}) {
  if (!(args.chainId in SUPPORTED_CHAINS)) {
    throw new WalletImportError("Chain is not supported for wallet import.");
  }

  const walletAddress = args.walletAddress.toLowerCase();

  return getDb().wallet.upsert({
    where: {
      chainId_addressLower: {
        chainId: args.chainId,
        addressLower: walletAddress,
      },
    },
    update: {
      label: args.label,
    },
    create: {
      chainId: args.chainId,
      address: walletAddress,
      addressLower: walletAddress,
      label: args.label,
    },
    select: {
      id: true,
      address: true,
      chainId: true,
      label: true,
      createdAt: true,
      updatedAt: true,
    },
  });
}
