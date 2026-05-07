import "dotenv/config";

import { PrismaClient } from "@prisma/client";

import {
  CORE_ASSETS,
  PHEX_ADDRESS,
  PHEX_DECIMALS,
  PULSECHAIN_NATIVE_TOKEN_ADDRESS,
} from "@/config/assets";
import { PULSECHAIN_CHAIN, PULSECHAIN_REFERENCE } from "@/config/chains";
import { CORE_PROTOCOLS } from "@/config/protocols";
import { createPrismaAdapter } from "@/lib/prisma-adapter";

const prisma = new PrismaClient({
  adapter: createPrismaAdapter(),
});

async function main() {
  await prisma.chain.upsert({
    where: { id: PULSECHAIN_CHAIN.id },
    update: {
      slug: PULSECHAIN_REFERENCE.slug,
      name: PULSECHAIN_REFERENCE.name,
      rpcUrl: PULSECHAIN_REFERENCE.rpcUrl,
      nativeAssetId: PULSECHAIN_REFERENCE.nativeAssetId,
    },
    create: {
      id: PULSECHAIN_CHAIN.id,
      slug: PULSECHAIN_REFERENCE.slug,
      name: PULSECHAIN_REFERENCE.name,
      rpcUrl: PULSECHAIN_REFERENCE.rpcUrl,
      nativeAssetId: PULSECHAIN_REFERENCE.nativeAssetId,
    },
  });

  const nativeToken = await prisma.token.upsert({
    where: { assetId: CORE_ASSETS.nativePls.assetId },
    update: {
      address: PULSECHAIN_NATIVE_TOKEN_ADDRESS,
      addressLower: PULSECHAIN_NATIVE_TOKEN_ADDRESS.toLowerCase(),
      chainId: PULSECHAIN_CHAIN.id,
      symbol: "PLS",
      name: "Pulse",
      decimals: 18,
      decimalsSource: "seed:native-pls",
      isNative: true,
    },
    create: {
      chainId: PULSECHAIN_CHAIN.id,
      address: PULSECHAIN_NATIVE_TOKEN_ADDRESS,
      addressLower: PULSECHAIN_NATIVE_TOKEN_ADDRESS.toLowerCase(),
      assetId: CORE_ASSETS.nativePls.assetId,
      symbol: "PLS",
      name: "Pulse",
      decimals: 18,
      decimalsSource: "seed:native-pls",
      isNative: true,
    },
  });

  const phexToken = await prisma.token.upsert({
    where: { assetId: CORE_ASSETS.phex.assetId },
    update: {
      address: PHEX_ADDRESS,
      addressLower: PHEX_ADDRESS.toLowerCase(),
      chainId: PULSECHAIN_CHAIN.id,
      symbol: "pHEX",
      name: "PulseChain HEX",
      decimals: PHEX_DECIMALS,
      decimalsSource: "seed:phex",
    },
    create: {
      chainId: PULSECHAIN_CHAIN.id,
      address: PHEX_ADDRESS,
      addressLower: PHEX_ADDRESS.toLowerCase(),
      assetId: CORE_ASSETS.phex.assetId,
      symbol: "pHEX",
      name: "PulseChain HEX",
      decimals: PHEX_DECIMALS,
      decimalsSource: "seed:phex",
    },
  });

  await prisma.tokenMetadataSource.upsert({
    where: {
      tokenId_sourceKind_sourceRef: {
        tokenId: nativeToken.id,
        sourceKind: "SEED",
        sourceRef: "seed:native-pls",
      },
    },
    update: {
      decimals: 18,
      symbol: "PLS",
      name: "Pulse",
    },
    create: {
      tokenId: nativeToken.id,
      sourceKind: "SEED",
      sourceRef: "seed:native-pls",
      decimals: 18,
      symbol: "PLS",
      name: "Pulse",
    },
  });

  await prisma.tokenMetadataSource.upsert({
    where: {
      tokenId_sourceKind_sourceRef: {
        tokenId: phexToken.id,
        sourceKind: "SEED",
        sourceRef: "seed:phex",
      },
    },
    update: {
      decimals: PHEX_DECIMALS,
      symbol: "pHEX",
      name: "PulseChain HEX",
    },
    create: {
      tokenId: phexToken.id,
      sourceKind: "SEED",
      sourceRef: "seed:phex",
      decimals: PHEX_DECIMALS,
      symbol: "pHEX",
      name: "PulseChain HEX",
    },
  });

  for (const protocol of Object.values(CORE_PROTOCOLS)) {
    await prisma.protocol.upsert({
      where: {
        chainId_slug: {
          chainId: PULSECHAIN_CHAIN.id,
          slug: protocol.slug,
        },
      },
      update: {
        name: protocol.name,
        category: protocol.category,
        safeStartBlock: protocol.safeStartBlock,
      },
      create: {
        chainId: PULSECHAIN_CHAIN.id,
        slug: protocol.slug,
        name: protocol.name,
        category: protocol.category,
        safeStartBlock: protocol.safeStartBlock,
      },
    });
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
