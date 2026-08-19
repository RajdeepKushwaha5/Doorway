export { observeOnce, type ObserveDeps, type ObserveResult } from './observe.js';

export {
  attemptRepair,
  promoteRepair,
  type RepairDeps,
  type RepairOutcome,
} from './repair.js';

export { buildFeed } from './feed.js';

export {
  computeImpact,
  type ImpactStats,
  type WithheldValue,
} from './impact.js';

export {
  compareBestDeal,
  type DealCandidate,
  type DealComparison,
} from './consumer.js';

export { notifyIncident, type NotifyConfig } from './notify.js';
export { reportIncidentToGitHub, type GitHubConfig } from './github.js';
