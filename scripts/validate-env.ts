type RequiredVariableName = "DATABASE_URL" | "REDIS_URL" | "PULSECHAIN_RPC_URL";
type OptionalVariableName = "PULSECHAIN_RPC_URL_2" | "PULSECHAIN_RPC_URL_3";

type ValidationRule = {
  name: RequiredVariableName | OptionalVariableName;
  validate: (value: string) => string | null;
  optional?: boolean;
};

const validateUrl = (value: string, allowedProtocols: readonly string[]) => {
  let parsedUrl: URL;

  try {
    parsedUrl = new URL(value);
  } catch {
    return `must be a valid URL`;
  }

  if (!allowedProtocols.includes(parsedUrl.protocol)) {
    return `must use one of these protocols: ${allowedProtocols.join(", ")}`;
  }

  return null;
};

const validationRules: readonly ValidationRule[] = [
  {
    name: "DATABASE_URL",
    validate: (value) => validateUrl(value, ["postgresql:", "postgres:"] as const),
  },
  {
    name: "REDIS_URL",
    validate: (value) => validateUrl(value, ["redis:", "rediss:"] as const),
  },
  {
    name: "PULSECHAIN_RPC_URL",
    validate: (value) => validateUrl(value, ["http:", "https:"] as const),
  },
  {
    name: "PULSECHAIN_RPC_URL_2",
    validate: (value) => validateUrl(value, ["http:", "https:"] as const),
    optional: true,
  },
  {
    name: "PULSECHAIN_RPC_URL_3",
    validate: (value) => validateUrl(value, ["http:", "https:"] as const),
    optional: true,
  },
];

const validationErrors = validationRules.flatMap(({ name, validate, optional }) => {
  const value = process.env[name];

  if (!value) {
    return optional ? [] : [`${name} is missing`];
  }

  const validationError = validate(value);

  if (validationError) {
    return [`${name} ${validationError}`];
  }

  return [];
});

if (validationErrors.length === 0) {
  console.log("CoinPulse validation environment OK.");
} else {
  console.error("Invalid CoinPulse validation environment:");

  for (const validationError of validationErrors) {
    console.error(`- ${validationError}`);
  }

  console.error("\nSee docs/validation-env-requirements.md for validation setup guidance.");
  process.exitCode = 1;
}
