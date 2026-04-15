/**
 * SAR Probability of Detection (POD) Calculator
 *
 * Based on standard search theory:
 * - Koopman detection function for ESW-based POD
 * - Bayesian cumulative POD for multiple passes
 * - POA (Probability of Area) update after search
 */

/** Calculate POD from Effective Sweep Width (ESW) and coverage */
export function calculatePOD(
  sweepWidthM: number,
  areaWidthM: number,
  passes: number
): number {
  // Coverage = (ESW * passes) / area width
  const coverage = (sweepWidthM * passes) / areaWidthM;
  // Koopman: POD = 1 - e^(-coverage)
  return 1 - Math.exp(-coverage);
}

/** Calculate cumulative POD after multiple independent searches */
export function cumulativePOD(podValues: number[]): number {
  if (podValues.length === 0) return 0;
  // Cumulative = 1 - product(1 - PODi)
  const miss = podValues.reduce((prod, pod) => prod * (1 - pod), 1);
  return 1 - miss;
}

/** Bayesian POA update after searching a zone */
export function updatePOA(
  priorPOA: number,
  searchPOD: number
): number {
  // P(A|not found) = P(A) * (1-POD) / (1 - P(A)*POD)
  const numerator = priorPOA * (1 - searchPOD);
  const denominator = 1 - priorPOA * searchPOD;
  return denominator > 0 ? numerator / denominator : 0;
}

/** Redistribute POA across all zones after searching one */
export function redistributePOA(
  zones: { id: string; poa: number }[],
  searchedZoneId: string,
  searchPOD: number
): { id: string; poa: number }[] {
  const searched = zones.find((z) => z.id === searchedZoneId);
  if (!searched) return zones;

  // New POA for searched zone
  const newSearchedPOA = updatePOA(searched.poa, searchPOD);
  const poaReduction = searched.poa - newSearchedPOA;

  // Redistribute to unsearched zones proportionally
  const others = zones.filter((z) => z.id !== searchedZoneId);
  const otherTotal = others.reduce((s, z) => s + z.poa, 0);

  return zones.map((z) => {
    if (z.id === searchedZoneId) return { ...z, poa: newSearchedPOA };
    if (otherTotal > 0) {
      const share = (z.poa / otherTotal) * poaReduction;
      return { ...z, poa: z.poa + share };
    }
    return z;
  });
}

/** Standard ESW lookup table (simplified) */
export const ESW_TABLE: Record<string, Record<string, number>> = {
  open_ground: {
    responsive: 80,
    unresponsive: 20,
    object: 12,
  },
  light_forest: {
    responsive: 40,
    unresponsive: 10,
    object: 6,
  },
  dense_forest: {
    responsive: 20,
    unresponsive: 5,
    object: 3,
  },
  urban: {
    responsive: 60,
    unresponsive: 15,
    object: 8,
  },
  moorland: {
    responsive: 60,
    unresponsive: 15,
    object: 10,
  },
  shoreline: {
    responsive: 100,
    unresponsive: 25,
    object: 15,
  },
};

/** Calculate suggested searcher spacing for a target POD */
export function suggestedSpacing(
  terrain: string,
  subjectType: string,
  targetPOD: number
): number {
  const esw = ESW_TABLE[terrain]?.[subjectType] || 20;
  // For a single pass: POD = 1 - e^(-ESW/spacing)
  // spacing = -ESW / ln(1 - targetPOD)
  const spacing = -esw / Math.log(1 - Math.min(targetPOD, 0.99));
  return Math.round(spacing);
}

/** Estimate time to search a zone */
export function estimateSearchTime(
  areaM2: number,
  spacingM: number,
  teamSize: number,
  speedMps: number = 0.8 // ~3 km/h walking
): { minutes: number; passes: number } {
  const width = Math.sqrt(areaM2);
  const passes = Math.ceil(width / spacingM);
  const totalDistanceM = passes * width;
  const timePerPersonS = totalDistanceM / speedMps;
  const minutes = Math.round(timePerPersonS / teamSize / 60);
  return { minutes, passes };
}
