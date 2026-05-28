import { exit } from "node:process";

const requiredVariables = [
  "DATABASE_URL",
  "REDIS_URL",
  "PULSECHAIN_RPC_URL",
] as const;

const missingVariables = requiredVariables.filter(
  (variableName) => !process.env[variableName],
);

if (missingVariables.length === 0) {
  console.log("CoinPulse validation environment OK.");
  exit(0);
}

console.error("Missing required validation environment variables:");

for (const variableName of missingVariables) {
  console.error(`- ${variableName}`);
}

console.error("\nSee docs/validation-env-requirements.md for validation setup guidance.");

exit(1);
