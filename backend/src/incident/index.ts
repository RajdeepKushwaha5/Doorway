export { classify, type Classification, type ClassificationInput } from './classify.js';

export {
  PROMPT_CHARACTER_LIMIT,
  synthesizeRepairPrompt,
  type PromptInput,
  type SynthesizedPrompt,
} from './prompt.js';

export {
  evaluateGate,
  formatGateMatrix,
  type GateCaseResult,
  type GateDecision,
  type GateInput,
  type GoldenCase,
} from './gate.js';

export {
  alreadyEntered,
  canTransition,
  currentState,
  IllegalTransitionError,
  TERMINAL_STATES,
  transition,
  type TransitionRecord,
} from './state.js';
