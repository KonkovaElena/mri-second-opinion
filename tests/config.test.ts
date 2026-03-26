import test from "node:test";
import assert from "node:assert/strict";
import { getConfig } from "../src/config";

test("getConfig defaults to snapshot persistence when DATABASE_URL is absent", () => {
  const previousPort = process.env.PORT;
  const previousDatabaseUrl = process.env.DATABASE_URL;

  delete process.env.DATABASE_URL;
  process.env.PORT = "4010";

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
  }
});

test("getConfig switches to postgres persistence when DATABASE_URL is present", () => {
  const previousPort = process.env.PORT;
  const previousDatabaseUrl = process.env.DATABASE_URL;

  process.env.PORT = "4010";
  process.env.DATABASE_URL = "postgresql://demo:demo@127.0.0.1:5432/mri_second_opinion";

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
  }
});

test("getConfig exposes MRI_INTERNAL_API_TOKEN when configured", () => {
  const previousPort = process.env.PORT;
  const previousDatabaseUrl = process.env.DATABASE_URL;
  const previousInternalApiToken = process.env.MRI_INTERNAL_API_TOKEN;

  process.env.PORT = "4010";
  delete process.env.DATABASE_URL;
  process.env.MRI_INTERNAL_API_TOKEN = "demo-internal-token";

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
  }
});

test("getConfig defaults reviewer identity source to request-body", () => {
  const previousPort = process.env.PORT;
  const previousIdentitySource = process.env.MRI_REVIEWER_IDENTITY_SOURCE;

  process.env.PORT = "4010";
  delete process.env.MRI_REVIEWER_IDENTITY_SOURCE;

  try {
    const config = getConfig();
    assert.equal(config.reviewerIdentitySource, "request-body");
  } finally {
    process.env.PORT = previousPort;
    if (previousIdentitySource === undefined) {
      delete process.env.MRI_REVIEWER_IDENTITY_SOURCE;
    } else {
      process.env.MRI_REVIEWER_IDENTITY_SOURCE = previousIdentitySource;
    }
  }
});

test("getConfig rejects unsupported reviewer identity source", () => {
  const previousPort = process.env.PORT;
  const previousIdentitySource = process.env.MRI_REVIEWER_IDENTITY_SOURCE;

  process.env.PORT = "4010";
  process.env.MRI_REVIEWER_IDENTITY_SOURCE = "header";

  try {
    assert.throws(() => getConfig(), /MRI_REVIEWER_IDENTITY_SOURCE must be request-body/);
  } finally {
    process.env.PORT = previousPort;
    if (previousIdentitySource === undefined) {
      delete process.env.MRI_REVIEWER_IDENTITY_SOURCE;
    } else {
      process.env.MRI_REVIEWER_IDENTITY_SOURCE = previousIdentitySource;
    }
  }
});