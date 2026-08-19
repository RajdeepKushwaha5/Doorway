export { extractField, extractFields } from './extract.js';

export {
  findCrossFieldMatch,
  hashContent,
  observeMarkdown,
  reconcile,
  type FieldComparison,
  type ReconciliationSummary,
} from './compare.js';

export {
  witnessFieldSpecSchema,
  type EvidenceSpan,
  type WitnessFieldSpec,
  type WitnessObservation,
  type WitnessValue,
} from './spec.js';

export {
  compareShapes,
  isSamePage,
  pageShape,
  SAME_PAGE_THRESHOLD,
  type PageShape,
  type ShapeComparison,
} from './shape.js';
