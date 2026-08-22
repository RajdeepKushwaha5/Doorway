import { z } from 'zod';

export const opportunityTypeSchema = z.enum([
  'scholarship',
  'fellowship',
  'internship',
  'grant',
  'hackathon',
  'research-program',
]);

export type OpportunityType = z.infer<typeof opportunityTypeSchema>;

export const profileSchema = z.object({
  country: z.string().trim().min(1).max(80),
  educationLevel: z.string().trim().min(1).max(80),
  interests: z.array(z.string().trim().min(1).max(80)).max(12),
  skills: z.array(z.string().trim().min(1).max(80)).max(20).default([]),
  opportunityTypes: z.array(opportunityTypeSchema).min(1),
  fundingRequirement: z.enum(['full', 'partial', 'any']).default('any'),
  locations: z.array(z.string().trim().min(1).max(80)).max(12).default([]),
});

export type DoorwayProfile = z.infer<typeof profileSchema>;

export interface OpportunityTrust {
  /**
   * How far this system will vouch for the record.
   *
   * `discovered` is the weakest and the newest. It means a page was found by
   * searching the live web and read once, moments ago, by a single sensor,
   * with no history to check it against and no second reading to agree with.
   *
   * It exists because the alternative was worse. Opportunities found live had
   * no way into the world at all, so the world only ever held the handful of
   * sources under continuous observation, and a student whose interest was not
   * among them saw a nearly empty map and concluded nothing was happening. The
   * answer is not to quietly promote live results to the same standing as
   * verified ones; it is to let them in and say exactly what they are.
   */
  status: 'verified' | 'partially_verified' | 'stale' | 'quarantined' | 'discovered';
  confirmedBy: 'two_sensors' | 'contract_only' | 'single_sensor';
  lastVerifiedAt: string;
  incidentId: string | null;
  fieldsDegraded: string[];
}

export interface Opportunity {
  id: string;
  collectorId: string;
  sourceUrl: string;
  title: string;
  provider: string;
  type: OpportunityType;
  summary: string;
  eligibility: string[];
  interests: string[];
  funding: {
    amount: number | null;
    currency: string | null;
    coverage: string[];
    level: 'full' | 'partial' | 'unspecified';
  };
  deadline: string | null;
  deadlineRaw: string | null;
  locations: string[];
  remote: boolean | null;
  requiredDocuments: string[];
  applicationUrl: string;
  trust: OpportunityTrust;
}

export interface OpportunityMatch {
  opportunity: Opportunity;
  score: number;
  eligible: true | false | 'unknown';
  matchedRequirements: string[];
  unmetRequirements: string[];
  unknownRequirements: string[];
  explanation: string[];
}

export interface DoorwayWorld {
  generatedAt: string;
  profile: DoorwayProfile;
  matches: OpportunityMatch[];
  stats: {
    sources: number;
    opportunities: number;
    verified: number;
    closingSoon: number;
  };
}
