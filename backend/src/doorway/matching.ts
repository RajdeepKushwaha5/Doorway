import type { DoorwayProfile, DoorwayWorld, Opportunity, OpportunityMatch } from './types.js';

export function buildWorld(
  profile: DoorwayProfile,
  opportunities: Opportunity[],
  now = new Date(),
): DoorwayWorld {
  /*
   * The type toggles are a filter, and were being scored rather than obeyed.
   *
   * A student who unticks Fellowships and asks for Internships is not saying
   * "prefer internships"; they are saying they do not want the other thing. The
   * type only contributed to a match score, so a fellowship still appeared,
   * marked twenty percent, in a search for internships. A filter that can be
   * overruled by a score is not a filter, and the toggle looked broken because
   * it was.
   *
   * An empty selection still means everything, since that is what an untouched
   * form should do rather than showing nothing at all.
   */
  const wanted = new Set(profile.opportunityTypes);

  const matches = opportunities
    .filter((opportunity) => wanted.size === 0 || wanted.has(opportunity.type))
    .map((opportunity) => matchOpportunity(profile, opportunity))
    .filter((match) => match.eligible !== false)
    .sort((a, b) => b.score - a.score);

  const closingSoon = matches.filter((match) => {
    if (match.opportunity.deadline === null) return false;
    const days = (Date.parse(match.opportunity.deadline) - now.getTime()) / 86_400_000;
    return days >= 0 && days <= 30;
  }).length;

  return {
    generatedAt: now.toISOString(),
    profile,
    matches,
    stats: {
      sources: new Set(matches.map((match) => match.opportunity.collectorId)).size,
      opportunities: matches.length,
      verified: matches.filter((match) => match.opportunity.trust.status === 'verified').length,
      closingSoon,
    },
  };
}

/**
 * Forms of the same subject that a page might use.
 *
 * Deliberately tiny and one-directional. This exists so an abbreviation on the
 * page can be found from the full term a student typed, and it is not a
 * taxonomy, a classifier, or an opinion about what an opportunity is for.
 */
const ALIASES: Record<string, string[]> = {
  'artificial intelligence': ['ai', 'machine learning', 'ml', 'deep learning'],
  'machine learning': ['ml', 'ai', 'artificial intelligence'],
  'computer science': ['cs', 'computing', 'software'],
  'data science': ['data', 'analytics'],
  robotics: ['robot'],
  biotechnology: ['biotech'],
  'renewable energy': ['clean energy', 'solar', 'wind'],
};

/** Whether the page text mentions this interest, in any form we know of. */
function mentions(haystack: string, interest: string): boolean {
  const term = interest.toLowerCase().trim();
  if (term === '') return false;
  if (haystack.includes(term)) return true;

  return (ALIASES[term] ?? []).some((alias) =>
    // Whole-word only, so "ai" does not match "chair" or "available".
    new RegExp(`\\b${alias.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`).test(haystack),
  );
}

export function matchOpportunity(
  profile: DoorwayProfile,
  opportunity: Opportunity,
): OpportunityMatch {
  let score = 35;
  const matched: string[] = [];
  const unmet: string[] = [];
  const unknown: string[] = [];
  const explanation: string[] = [];

  if (profile.opportunityTypes.includes(opportunity.type)) {
    score += 20;
    matched.push(`${opportunity.type} is one of your selected opportunity types`);
  } else {
    score -= 20;
  }

  /*
   * Does this page mention what the student asked for?
   *
   * Plain substring matching missed the most ordinary case there is. A student
   * interested in "Artificial intelligence" looking at a page titled "AI
   * Research Fellowship" matched nothing, because that string does not contain
   * that string. Every real source writes the short form somewhere.
   *
   * So the eligibility text is searched as well, and a small table of forms
   * that mean the same thing is consulted. That table is knowledge about
   * language, not an inference about the opportunity: it lets "AI" find
   * "artificial intelligence" and nothing more. Where a term genuinely is not
   * on the page, that is reported as the page not mentioning it, rather than
   * as the source having published no subject areas, which was describing our
   * own parsing as though it were a fact about the source.
   */
  const interestText = [
    ...opportunity.interests,
    opportunity.title,
    opportunity.summary,
    ...opportunity.eligibility,
  ]
    .join(' ')
    .toLowerCase();

  const interestMatches = profile.interests.filter((interest) =>
    mentions(interestText, interest),
  );

  if (interestMatches.length > 0) {
    score += Math.min(25, interestMatches.length * 10);
    matched.push(`Matches ${interestMatches.join(', ')}`);
  } else if (profile.interests.length > 0) {
    unknown.push(
      `This page does not mention ${profile.interests.join(' or ')}, so the subject fit could not be confirmed`,
    );
  }

  const locationText = opportunity.locations.join(' ').toLowerCase();
  const locationMatch =
    opportunity.remote === true ||
    opportunity.locations.length === 0 ||
    [profile.country, ...profile.locations].some((location) =>
      locationText.includes(location.toLowerCase()),
    );
  if (locationMatch) {
    score += 10;
    matched.push(opportunity.remote === true ? 'Available remotely' : 'Location is compatible');
  } else {
    unknown.push('Location compatibility needs manual review');
  }

  if (profile.fundingRequirement === 'full') {
    if (opportunity.funding.level === 'full') {
      score += 10;
      matched.push('Source states full funding');
    } else if (opportunity.funding.level === 'partial') {
      unmet.push('You require full funding, but the source states partial funding');
    } else {
      unknown.push('The source does not clearly state the funding level');
    }
  }

  if (opportunity.eligibility.length === 0) {
    unknown.push('Eligibility rules were not available as structured data');
  }

  if (opportunity.trust.status === 'verified') {
    score += 5;
    explanation.push('Important fields were confirmed by two independent sensors');
  } else if (opportunity.trust.status === 'quarantined') {
    score -= 25;
    explanation.push('Some fields are quarantined while the source is rechecked');
  } else {
    explanation.push('This record has a weaker verification state; inspect the source before acting');
  }

  explanation.unshift(...matched);
  const eligible = unmet.length > 0 ? false : unknown.length > 0 ? 'unknown' : true;

  return {
    opportunity,
    score: Math.max(0, Math.min(100, Math.round(score))),
    eligible,
    matchedRequirements: matched,
    unmetRequirements: unmet,
    unknownRequirements: unknown,
    explanation,
  };
}
