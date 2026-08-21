import type { DoorwayProfile, DoorwayWorld, Opportunity, OpportunityMatch } from './types.js';

export function buildWorld(
  profile: DoorwayProfile,
  opportunities: Opportunity[],
  now = new Date(),
): DoorwayWorld {
  const matches = opportunities
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

  const interestText = [...opportunity.interests, opportunity.title, opportunity.summary].join(' ').toLowerCase();
  const interestMatches = profile.interests.filter((interest) =>
    interestText.includes(interest.toLowerCase()),
  );
  if (interestMatches.length > 0) {
    score += Math.min(25, interestMatches.length * 10);
    matched.push(`Matches ${interestMatches.join(', ')}`);
  } else if (opportunity.interests.length === 0) {
    unknown.push('The source did not publish structured subject areas');
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
