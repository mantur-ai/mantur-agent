/** Local budget for real hook subprocess work and its teardown; larger coverage lanes remain authoritative. */
import { COVERAGE_TEST_TIMEOUT_ENV, coverageTestTimeoutConfig } from '../../../../scripts/coverage-partitions.ts'

/** Budget shared by real-spawn cases, detached completion waits and fixture cleanup. */
export const hookSubprocessTimeout = Math.max(
  15_000,
  coverageTestTimeoutConfig(process.env[COVERAGE_TEST_TIMEOUT_ENV]).testTimeout ?? 0,
)
