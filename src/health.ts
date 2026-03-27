import type { MemoryCaseService } from "./cases";
import type { AppConfig } from "./config";

function resolvePersistenceMode(config: AppConfig) {
  if (config.persistenceMode === "postgres" || config.persistenceMode === "snapshot") {
    return config.persistenceMode;
  }

  return config.caseStoreMode === "postgres" || config.caseStoreDatabaseUrl ? "postgres" : "snapshot";
}

function buildStorageSnapshot(config: AppConfig) {
  return {
    mode: config.caseStoreMode,
    persistenceMode: resolvePersistenceMode(config),
  };
}

export function buildHealthSnapshot(config: AppConfig, requestId: string) {
  return {
    status: "ok",
    service: "mri-second-opinion",
    mode: "wave1-api",
    requestId,
    storage: buildStorageSnapshot(config),
    checks: {
      jsonBodyParser: "configured",
      caseStore: "configured",
    },
  };
}

export async function buildReadinessSnapshot(config: AppConfig, caseService: MemoryCaseService, requestId: string) {
  try {
    const [cases, deliveryJobs, inferenceJobs] = await Promise.all([
      caseService.listCases(),
      caseService.listDeliveryJobs(),
      caseService.listInferenceJobs(),
    ]);

    return {
      statusCode: 200,
      body: {
        status: "ready",
        service: "mri-second-opinion",
        mode: "wave1-api",
        requestId,
        storage: buildStorageSnapshot(config),
        summary: {
          totalCases: cases.length,
          totalDeliveryJobs: deliveryJobs.length,
          totalInferenceJobs: inferenceJobs.length,
        },
        checks: {
          caseStore: "reachable",
        },
      },
    };
  } catch (error) {
    return {
      statusCode: 503,
      body: {
        status: "not-ready",
        service: "mri-second-opinion",
        mode: "wave1-api",
        requestId,
        storage: buildStorageSnapshot(config),
        checks: {
          caseStore: "unreachable",
        },
        error: error instanceof Error ? error.message : "Unknown readiness failure",
      },
    };
  }
}
