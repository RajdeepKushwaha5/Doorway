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
  status: 'verified' | 'partially_verified' | 'stale' | 'quarantined';
  confirmedBy: 'two_sensors' | 'contract_only';
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
