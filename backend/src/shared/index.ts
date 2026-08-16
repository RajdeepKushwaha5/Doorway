export {
  acquisitionContextSchema,
  compareAcquisitionContexts,
  type AcquisitionContext,
  type ContextAlignment,
} from './acquisition.js';

export {
  collapseSelfRepetition,
  comparisonKey,
  compareValues,
  normalizeMoney,
  normalizeText,
  parseLooseNumber,
  type NormalizedMoney,
  type ValueAgreement,
} from './normalize.js';

export { assertNoSecrets, redact, redactString, REDACTED } from './redact.js';

export {
  aggregateChecks,
  checkResultSchema,
  healthEnvelopeSchema,
  incidentClassificationSchema,
  incidentStateSchema,
  shouldAttemptRepair,
  type CheckResult,
  type HealthEnvelope,
  type IncidentClassification,
  type IncidentState,
} from './types.js';
