export { observeOnce, type ObserveDeps, type ObserveResult } from './observe.js';

export {
  attemptRepair,
  promoteRepair,
  type RepairDeps,
  type RepairOutcome,
} from './repair.js';

export { buildFeed } from './feed.js';

export {
  compareBestDeal,
  type DealCandidate,
  type DealComparison,
} from './consumer.js';
