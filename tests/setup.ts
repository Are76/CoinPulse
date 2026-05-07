import "@testing-library/jest-dom/vitest";

process.env.DATABASE_URL ??=
  "postgresql://postgres:postgres@localhost:5432/coinpulse";
process.env.REDIS_URL ??= "redis://localhost:6379";
process.env.PULSECHAIN_RPC_URL ??= "https://rpc.pulsechainstats.com";
