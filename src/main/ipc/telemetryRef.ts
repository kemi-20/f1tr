import type { TelemetryService } from '../telemetry/TelemetryService'

/**
 * Indirection so ipc/register.ts can reach the running TelemetryService
 * without a circular import with index.ts.
 */
let svc: TelemetryService | null = null

export function setTelemetry(s: TelemetryService | null): void {
  svc = s
}

export function getTelemetry(): TelemetryService | null {
  return svc
}

