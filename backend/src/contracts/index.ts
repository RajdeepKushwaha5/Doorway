export { collectPathValues, getPath, leafPaths, type PathLookup } from './paths.js';

export {
  characterShape,
  median,
  medianAbsoluteDeviation,
  quantile,
  robustZScore,
  sampleConfidence,
} from './statistics.js';

export {
  extendContract,
  findProfile,
  learnContract,
  uniqueRatio,
  type BaselineRun,
} from './learn.js';

export { hasHardFailure, hasSuspicion, validateRun, type ValidationInput } from './validate.js';

export {
  collectorContractSchema,
  DEFAULT_THRESHOLDS,
  fieldProfileSchema,
  invariantSchema,
  type CollectorContract,
  type ContractThresholds,
  type FieldProfile,
  type Invariant,
} from './types.js';
