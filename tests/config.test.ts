import test from "node:test";
import assert from "node:assert/strict";
import { getConfig } from "../src/config";

test("getConfig defaults to snapshot persistence when DATABASE_URL is absent", () => {
  const previousPort = process.env.PORT;
  const previousDatabaseUrl = process.env.DATABASE_URL;
  const previousJwtSecret = process.env.MRI_REVIEWER_JWT_HS256_SECRET;

  delete process.env.DATABASE_URL;
  process.env.PORT = "4010";
  process.env.MRI_REVIEWER_JWT_HS256_SECRET = "test-reviewer-jwt-secret-0123456789";

  try {
    const config = getConfig();
    assert.equal(config.persistenceMode, "snapshot");
    assert.equal(config.databaseUrl, undefined);
  } finally {
    process.env.PORT = previousPort;
    if (previousDatabaseUrl === undefined) {
      delete process.env.DATABASE_URL;
    } else {
      process.env.DATABASE_URL = previousDatabaseUrl;
    }
    if (previousJwtSecret === undefined) {
      delete process.env.MRI_REVIEWER_JWT_HS256_SECRET;
    } else {
      process.env.MRI_REVIEWER_JWT_HS256_SECRET = previousJwtSecret;
    }
  }
});

test("getConfig enables automatic inference lease recovery by default", () => {
  const previousPort = process.env.PORT;
  const previousJwtSecret = process.env.MRI_REVIEWER_JWT_HS256_SECRET;
  const previousRecoveryInterval = process.env.MRI_INFERENCE_LEASE_RECOVERY_INTERVAL_MS;
  const previousRecoveryMaxAge = process.env.MRI_INFERENCE_LEASE_RECOVERY_MAX_CLAIM_AGE_MS;

  process.env.PORT = "4010";
  process.env.MRI_REVIEWER_JWT_HS256_SECRET = "test-reviewer-jwt-secret-0123456789";
  delete process.env.MRI_INFERENCE_LEASE_RECOVERY_INTERVAL_MS;
  delete process.env.MRI_INFERENCE_LEASE_RECOVERY_MAX_CLAIM_AGE_MS;

  try {
    const config = getConfig();
    assert.equal(config.inferenceLeaseRecoveryIntervalMs, 30_000);
    assert.equal(config.inferenceLeaseRecoveryMaxClaimAgeMs, 300_000);
  } finally {
    process.env.PORT = previousPort;
    if (previousJwtSecret === undefined) {
      delete process.env.MRI_REVIEWER_JWT_HS256_SECRET;
    } else {
      process.env.MRI_REVIEWER_JWT_HS256_SECRET = previousJwtSecret;
    }
    if (previousRecoveryInterval === undefined) {
      delete process.env.MRI_INFERENCE_LEASE_RECOVERY_INTERVAL_MS;
    } else {
      process.env.MRI_INFERENCE_LEASE_RECOVERY_INTERVAL_MS = previousRecoveryInterval;
    }
    if (previousRecoveryMaxAge === undefined) {
      delete process.env.MRI_INFERENCE_LEASE_RECOVERY_MAX_CLAIM_AGE_MS;
    } else {
      process.env.MRI_INFERENCE_LEASE_RECOVERY_MAX_CLAIM_AGE_MS = previousRecoveryMaxAge;
    }
  }
});

test("getConfig allows disabling automatic inference lease recovery", () => {
  const previousPort = process.env.PORT;
  const previousJwtSecret = process.env.MRI_REVIEWER_JWT_HS256_SECRET;
  const previousRecoveryInterval = process.env.MRI_INFERENCE_LEASE_RECOVERY_INTERVAL_MS;
  const previousRecoveryMaxAge = process.env.MRI_INFERENCE_LEASE_RECOVERY_MAX_CLAIM_AGE_MS;

  process.env.PORT = "4010";
  process.env.MRI_REVIEWER_JWT_HS256_SECRET = "test-reviewer-jwt-secret-0123456789";
  process.env.MRI_INFERENCE_LEASE_RECOVERY_INTERVAL_MS = "0";
  process.env.MRI_INFERENCE_LEASE_RECOVERY_MAX_CLAIM_AGE_MS = "45000";

  try {
    const config = getConfig();
    assert.equal(config.inferenceLeaseRecoveryIntervalMs, 0);
    assert.equal(config.inferenceLeaseRecoveryMaxClaimAgeMs, 45_000);
  } finally {
    process.env.PORT = previousPort;
    if (previousJwtSecret === undefined) {
      delete process.env.MRI_REVIEWER_JWT_HS256_SECRET;
    } else {
      process.env.MRI_REVIEWER_JWT_HS256_SECRET = previousJwtSecret;
    }
    if (previousRecoveryInterval === undefined) {
      delete process.env.MRI_INFERENCE_LEASE_RECOVERY_INTERVAL_MS;
    } else {
      process.env.MRI_INFERENCE_LEASE_RECOVERY_INTERVAL_MS = previousRecoveryInterval;
    }
    if (previousRecoveryMaxAge === undefined) {
      delete process.env.MRI_INFERENCE_LEASE_RECOVERY_MAX_CLAIM_AGE_MS;
    } else {
      process.env.MRI_INFERENCE_LEASE_RECOVERY_MAX_CLAIM_AGE_MS = previousRecoveryMaxAge;
    }
  }
});

test("getConfig switches to postgres persistence when DATABASE_URL is present", () => {
  const previousPort = process.env.PORT;
  const previousDatabaseUrl = process.env.DATABASE_URL;
  const previousJwtSecret = process.env.MRI_REVIEWER_JWT_HS256_SECRET;

  process.env.PORT = "4010";
  process.env.DATABASE_URL = "postgresql://demo:demo@127.0.0.1:5432/mri_second_opinion";
  process.env.MRI_REVIEWER_JWT_HS256_SECRET = "test-reviewer-jwt-secret-0123456789";

  try {
    const config = getConfig();
    assert.equal(config.persistenceMode, "postgres");
    assert.equal(config.databaseUrl, process.env.DATABASE_URL);
  } finally {
    process.env.PORT = previousPort;
    if (previousDatabaseUrl === undefined) {
      delete process.env.DATABASE_URL;
    } else {
      process.env.DATABASE_URL = previousDatabaseUrl;
    }
    if (previousJwtSecret === undefined) {
      delete process.env.MRI_REVIEWER_JWT_HS256_SECRET;
    } else {
      process.env.MRI_REVIEWER_JWT_HS256_SECRET = previousJwtSecret;
    }
  }
});

test("getConfig exposes MRI_INTERNAL_API_TOKEN when configured", () => {
  const previousPort = process.env.PORT;
  const previousDatabaseUrl = process.env.DATABASE_URL;
  const previousInternalApiToken = process.env.MRI_INTERNAL_API_TOKEN;
  const previousJwtSecret = process.env.MRI_REVIEWER_JWT_HS256_SECRET;

  process.env.PORT = "4010";
  delete process.env.DATABASE_URL;
  process.env.MRI_INTERNAL_API_TOKEN = "demo-internal-token";
  process.env.MRI_REVIEWER_JWT_HS256_SECRET = "test-reviewer-jwt-secret-0123456789";

  try {
    const config = getConfig();
    assert.equal(config.persistenceMode, "snapshot");
    assert.equal(config.internalApiToken, "demo-internal-token");
  } finally {
    process.env.PORT = previousPort;
    if (previousDatabaseUrl === undefined) {
      delete process.env.DATABASE_URL;
    } else {
      process.env.DATABASE_URL = previousDatabaseUrl;
    }
    if (previousInternalApiToken === undefined) {
      delete process.env.MRI_INTERNAL_API_TOKEN;
    } else {
      process.env.MRI_INTERNAL_API_TOKEN = previousInternalApiToken;
    }
    if (previousJwtSecret === undefined) {
      delete process.env.MRI_REVIEWER_JWT_HS256_SECRET;
    } else {
      process.env.MRI_REVIEWER_JWT_HS256_SECRET = previousJwtSecret;
    }
  }
});

test("getConfig requires MRI_REVIEWER_JWT_HS256_SECRET", () => {
  const previousPort = process.env.PORT;
  const previousJwtSecret = process.env.MRI_REVIEWER_JWT_HS256_SECRET;

  process.env.PORT = "4010";
  delete process.env.MRI_REVIEWER_JWT_HS256_SECRET;

  try {
    assert.throws(
      () => getConfig(),
      /MRI_REVIEWER_JWT_HS256_SECRET is required/,
    );
  } finally {
    process.env.PORT = previousPort;
    if (previousJwtSecret === undefined) {
      delete process.env.MRI_REVIEWER_JWT_HS256_SECRET;
    } else {
      process.env.MRI_REVIEWER_JWT_HS256_SECRET = previousJwtSecret;
    }
  }
});

test("getConfig accepts valid reviewer JWT secret", () => {
  const previousPort = process.env.PORT;
  const previousJwtSecret = process.env.MRI_REVIEWER_JWT_HS256_SECRET;

  process.env.PORT = "4010";
  process.env.MRI_REVIEWER_JWT_HS256_SECRET = "reviewer-jwt-secret-0123456789abcdef";

  try {
    const config = getConfig();
    assert.equal(config.reviewerJwtSecret, "reviewer-jwt-secret-0123456789abcdef");
  } finally {
    process.env.PORT = previousPort;
    if (previousJwtSecret === undefined) {
      delete process.env.MRI_REVIEWER_JWT_HS256_SECRET;
    } else {
      process.env.MRI_REVIEWER_JWT_HS256_SECRET = previousJwtSecret;
    }
  }
});

test("getConfig defaults reviewer allowed roles to the qualified clinician baseline", () => {
  const previousPort = process.env.PORT;
  const previousJwtSecret = process.env.MRI_REVIEWER_JWT_HS256_SECRET;
  const previousReviewerRoles = process.env.MRI_REVIEWER_ALLOWED_ROLES;

  process.env.PORT = "4010";
  process.env.MRI_REVIEWER_JWT_HS256_SECRET = "reviewer-jwt-secret-0123456789abcdef";
  delete process.env.MRI_REVIEWER_ALLOWED_ROLES;

  try {
    const config = getConfig();
    assert.deepEqual(config.reviewerAllowedRoles, ["clinician", "radiologist", "neuroradiologist"]);
  } finally {
    process.env.PORT = previousPort;
    if (previousJwtSecret === undefined) {
      delete process.env.MRI_REVIEWER_JWT_HS256_SECRET;
    } else {
      process.env.MRI_REVIEWER_JWT_HS256_SECRET = previousJwtSecret;
    }
    if (previousReviewerRoles === undefined) {
      delete process.env.MRI_REVIEWER_ALLOWED_ROLES;
    } else {
      process.env.MRI_REVIEWER_ALLOWED_ROLES = previousReviewerRoles;
    }
  }
});

test("getConfig parses explicit reviewer allowed roles", () => {
  const previousPort = process.env.PORT;
  const previousJwtSecret = process.env.MRI_REVIEWER_JWT_HS256_SECRET;
  const previousReviewerRoles = process.env.MRI_REVIEWER_ALLOWED_ROLES;

  process.env.PORT = "4010";
  process.env.MRI_REVIEWER_JWT_HS256_SECRET = "reviewer-jwt-secret-0123456789abcdef";
  process.env.MRI_REVIEWER_ALLOWED_ROLES = " Neuroradiologist , reviewer , radiologist, reviewer ";

  try {
    const config = getConfig();
    assert.deepEqual(config.reviewerAllowedRoles, ["neuroradiologist", "reviewer", "radiologist"]);
  } finally {
    process.env.PORT = previousPort;
    if (previousJwtSecret === undefined) {
      delete process.env.MRI_REVIEWER_JWT_HS256_SECRET;
    } else {
      process.env.MRI_REVIEWER_JWT_HS256_SECRET = previousJwtSecret;
    }
    if (previousReviewerRoles === undefined) {
      delete process.env.MRI_REVIEWER_ALLOWED_ROLES;
    } else {
      process.env.MRI_REVIEWER_ALLOWED_ROLES = previousReviewerRoles;
    }
  }
});

test("getConfig rejects an explicitly empty reviewer role allowlist", () => {
  const previousPort = process.env.PORT;
  const previousJwtSecret = process.env.MRI_REVIEWER_JWT_HS256_SECRET;
  const previousReviewerRoles = process.env.MRI_REVIEWER_ALLOWED_ROLES;

  process.env.PORT = "4010";
  process.env.MRI_REVIEWER_JWT_HS256_SECRET = "reviewer-jwt-secret-0123456789abcdef";
  process.env.MRI_REVIEWER_ALLOWED_ROLES = " ,  , ";

  try {
    assert.throws(() => getConfig(), /MRI_REVIEWER_ALLOWED_ROLES must define at least one role/);
  } finally {
    process.env.PORT = previousPort;
    if (previousJwtSecret === undefined) {
      delete process.env.MRI_REVIEWER_JWT_HS256_SECRET;
    } else {
      process.env.MRI_REVIEWER_JWT_HS256_SECRET = previousJwtSecret;
    }
    if (previousReviewerRoles === undefined) {
      delete process.env.MRI_REVIEWER_ALLOWED_ROLES;
    } else {
      process.env.MRI_REVIEWER_ALLOWED_ROLES = previousReviewerRoles;
    }
  }
});

test("getConfig rejects production mode without internal route auth", () => {
  const previousPort = process.env.PORT;
  const previousNodeEnv = process.env.NODE_ENV;
  const previousHmac = process.env.MRI_INTERNAL_HMAC_SECRET;
  const previousToken = process.env.MRI_INTERNAL_API_TOKEN;
  const previousJwtSecret = process.env.MRI_REVIEWER_JWT_HS256_SECRET;

  process.env.PORT = "4010";
  process.env.NODE_ENV = "production";
  process.env.MRI_REVIEWER_JWT_HS256_SECRET = "test-reviewer-jwt-secret-0123456789";
  delete process.env.MRI_INTERNAL_HMAC_SECRET;
  delete process.env.MRI_INTERNAL_API_TOKEN;

  try {
    assert.throws(
      () => getConfig(),
      /set MRI_INTERNAL_HMAC_SECRET or MRI_INTERNAL_API_TOKEN/,
    );
  } finally {
    process.env.PORT = previousPort;
    if (previousNodeEnv === undefined) {
      delete process.env.NODE_ENV;
    } else {
      process.env.NODE_ENV = previousNodeEnv;
    }
    if (previousHmac === undefined) {
      delete process.env.MRI_INTERNAL_HMAC_SECRET;
    } else {
      process.env.MRI_INTERNAL_HMAC_SECRET = previousHmac;
    }
    if (previousToken === undefined) {
      delete process.env.MRI_INTERNAL_API_TOKEN;
    } else {
      process.env.MRI_INTERNAL_API_TOKEN = previousToken;
    }
    if (previousJwtSecret === undefined) {
      delete process.env.MRI_REVIEWER_JWT_HS256_SECRET;
    } else {
      process.env.MRI_REVIEWER_JWT_HS256_SECRET = previousJwtSecret;
    }
  }
});

test("getConfig accepts production mode with HMAC auth configured", () => {
  const previousPort = process.env.PORT;
  const previousNodeEnv = process.env.NODE_ENV;
  const previousHmac = process.env.MRI_INTERNAL_HMAC_SECRET;
  const previousJwtSecret = process.env.MRI_REVIEWER_JWT_HS256_SECRET;
  const previousOperatorToken = process.env.MRI_OPERATOR_API_TOKEN;

  process.env.PORT = "4010";
  process.env.NODE_ENV = "production";
  process.env.MRI_INTERNAL_HMAC_SECRET = "0123456789abcdef0123456789abcdef";
  process.env.MRI_REVIEWER_JWT_HS256_SECRET = "test-reviewer-jwt-secret-0123456789";
  process.env.MRI_OPERATOR_API_TOKEN = "test-operator-token-secret-001";

  try {
    const config = getConfig();
    assert.equal(config.hmacSecret, "0123456789abcdef0123456789abcdef");
  } finally {
    if (previousPort === undefined) {
      delete process.env.PORT;
    } else {
      process.env.PORT = previousPort;
    }
    if (previousNodeEnv === undefined) {
      delete process.env.NODE_ENV;
    } else {
      process.env.NODE_ENV = previousNodeEnv;
    }
    if (previousHmac === undefined) {
      delete process.env.MRI_INTERNAL_HMAC_SECRET;
    } else {
      process.env.MRI_INTERNAL_HMAC_SECRET = previousHmac;
    }
    if (previousJwtSecret === undefined) {
      delete process.env.MRI_REVIEWER_JWT_HS256_SECRET;
    } else {
      process.env.MRI_REVIEWER_JWT_HS256_SECRET = previousJwtSecret;
    }
    if (previousOperatorToken === undefined) {
      delete process.env.MRI_OPERATOR_API_TOKEN;
    } else {
      process.env.MRI_OPERATOR_API_TOKEN = previousOperatorToken;
    }
  }
});

test("getConfig rejects production mode without operator API token", () => {
  const previousPort = process.env.PORT;
  const previousNodeEnv = process.env.NODE_ENV;
  const previousHmac = process.env.MRI_INTERNAL_HMAC_SECRET;
  const previousJwtSecret = process.env.MRI_REVIEWER_JWT_HS256_SECRET;
  const previousOperatorToken = process.env.MRI_OPERATOR_API_TOKEN;

  process.env.PORT = "4010";
  process.env.NODE_ENV = "production";
  process.env.MRI_INTERNAL_HMAC_SECRET = "0123456789abcdef0123456789abcdef";
  process.env.MRI_REVIEWER_JWT_HS256_SECRET = "test-reviewer-jwt-secret-0123456789";
  delete process.env.MRI_OPERATOR_API_TOKEN;

  try {
    assert.throws(
      () => getConfig(),
      /MRI_OPERATOR_API_TOKEN is required in production/,
    );
  } finally {
    process.env.PORT = previousPort;
    if (previousNodeEnv === undefined) {
      delete process.env.NODE_ENV;
    } else {
      process.env.NODE_ENV = previousNodeEnv;
    }
    if (previousHmac === undefined) {
      delete process.env.MRI_INTERNAL_HMAC_SECRET;
    } else {
      process.env.MRI_INTERNAL_HMAC_SECRET = previousHmac;
    }
    if (previousJwtSecret === undefined) {
      delete process.env.MRI_REVIEWER_JWT_HS256_SECRET;
    } else {
      process.env.MRI_REVIEWER_JWT_HS256_SECRET = previousJwtSecret;
    }
    if (previousOperatorToken === undefined) {
      delete process.env.MRI_OPERATOR_API_TOKEN;
    } else {
      process.env.MRI_OPERATOR_API_TOKEN = previousOperatorToken;
    }
  }
});