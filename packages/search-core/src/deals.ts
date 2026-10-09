import type { DealCategory } from '@ssandevisthan/contracts';

export interface TextMatch { query: string; candidate: string | null }
export interface DealRelevanceInput { category: TextMatch | null; model: TextMatch | null; modifiers: TextMatch[] }
export interface DealRelevanceResult { pass: boolean; dealRelevance: number | null; reasons: string[] }
export const DEAL_TAXONOMY_VERSION = 'deal-synonyms-v3-bootstrap-1';
const synonyms = [
  ['맨투맨', '스웨트셔츠', 'sweatshirt'], ['후디', '후드티', 'hoodie'], ['티셔츠', 't-shirt'],
  ['오버핏', '오버사이즈', 'oversized'], ['회색', '그레이', 'gray', 'grey'],
  ['검정', '검정색', '블랙', 'black'], ['흰색', '화이트', 'white'],
  ['냉장고', 'refrigerator'], ['세탁기', 'washing machine'], ['청소기', 'vacuum cleaner'],
] as const;
const normalize = (value: string) => value.normalize('NFC').trim().toLocaleLowerCase('en-US').replace(/\s+/g, ' ');
function textCompatibility(match: TextMatch, kind: 'category' | 'model' | 'modifier'): 0 | .5 | 1 {
  if (!match.candidate) return 0;
  const a = normalize(match.query), b = normalize(match.candidate);
  if (a === b) return 1;
  if (kind === 'model') return 0;
  if (synonyms.some((group) => (group as readonly string[]).includes(a) && (group as readonly string[]).includes(b))) return 1;
  if (kind === 'modifier' && ['블랙|차콜', 'black|charcoal', 'regular|relaxed', '레귤러핏|릴랙스핏'].includes([a, b].sort().join('|'))) return .5;
  return 0;
}
export function evaluateDealRelevance(input: DealRelevanceInput): DealRelevanceResult {
  let denominator = 0, numerator = 0;
  const reasons: string[] = [];
  if (input.category) {
    denominator += .50;
    const score = textCompatibility(input.category, 'category'); numerator += .50 * score;
    if (input.category.candidate && score === 0) reasons.push('CATEGORY_MISMATCH');
  }
  if (input.model) {
    denominator += .25;
    const score = textCompatibility(input.model, 'model'); numerator += .25 * score;
    if (input.model.candidate && score === 0) reasons.push('MODEL_MISMATCH');
    if (!input.model.candidate) reasons.push('MODEL_UNKNOWN');
  }
  if (input.modifiers.length) {
    denominator += .25;
    for (const modifier of input.modifiers) {
      const score = textCompatibility(modifier, 'modifier');
      numerator += .25 / input.modifiers.length * score;
      // Conservative intersection of backend §8 and operations §6.4: known required
      // qualifier mismatches are hard failures; the .6 formula itself is unchanged.
      if (modifier.candidate && score === 0) reasons.push('REQUIRED_MODIFIER_MISMATCH');
    }
  }
  if (!denominator) return { pass: false, dealRelevance: null, reasons: ['INVALID_INPUT'] };
  const dealRelevance = numerator / denominator;
  if (dealRelevance < .60) reasons.push('LOW_TEXT_RELEVANCE');
  return { pass: !reasons.length, dealRelevance, reasons };
}

const categoryTerms: { canonical: string; filter: Exclude<DealCategory, 'ALL'>; terms: readonly string[] }[] = [
  { canonical: 'SWEATSHIRT', filter: 'FASHION', terms: ['맨투맨', '스웨트셔츠', 'sweatshirt'] },
  { canonical: 'HOODIE', filter: 'FASHION', terms: ['후드티', '후디', '후드 집업', 'hoodie'] },
  { canonical: 'T_SHIRT', filter: 'FASHION', terms: ['티셔츠', '반팔티', 't-shirt'] },
  { canonical: 'CARDIGAN', filter: 'FASHION', terms: ['가디건', 'cardigan'] },
  { canonical: 'BLOUSE', filter: 'FASHION', terms: ['블라우스', 'blouse'] },
  { canonical: 'SHIRT', filter: 'FASHION', terms: ['셔츠', 'shirt'] },
  { canonical: 'KNITWEAR', filter: 'FASHION', terms: ['니트', '스웨터', 'knitwear', 'sweater'] },
  { canonical: 'JACKET', filter: 'FASHION', terms: ['재킷', '자켓', 'jacket'] },
  { canonical: 'COAT', filter: 'FASHION', terms: ['코트', 'coat'] },
  { canonical: 'JEANS', filter: 'FASHION', terms: ['청바지', '데님 팬츠', 'jeans'] },
  { canonical: 'SHORTS', filter: 'FASHION', terms: ['반바지', '쇼츠', 'shorts'] },
  { canonical: 'PANTS', filter: 'FASHION', terms: ['바지', '팬츠', 'pants', 'trousers'] },
  { canonical: 'SKIRT', filter: 'FASHION', terms: ['치마', '스커트', 'skirt'] },
  { canonical: 'DRESS', filter: 'FASHION', terms: ['원피스', 'dress'] },
  { canonical: 'REFRIGERATOR', filter: 'LIVING', terms: ['냉장고', 'refrigerator'] },
  { canonical: 'WASHING_MACHINE', filter: 'LIVING', terms: ['세탁기', 'washing machine'] },
  { canonical: 'VACUUM_CLEANER', filter: 'LIVING', terms: ['청소기', 'vacuum cleaner'] },
  { canonical: 'DETERGENT', filter: 'LIVING', terms: ['세탁세제', '세제', 'detergent'] },
  { canonical: 'TISSUE', filter: 'LIVING', terms: ['화장지', '휴지', 'tissue'] },
  { canonical: 'TOWEL', filter: 'LIVING', terms: ['수건', '타월', 'towel'] },
  { canonical: 'TUMBLER', filter: 'LIVING', terms: ['텀블러', 'tumbler'] },
];
const modifierGroups: readonly (readonly (readonly string[])[])[] = [
  [['회색', '그레이', 'gray', 'grey'], ['검정', '블랙', 'black'], ['차콜', 'charcoal'], ['흰색', '화이트', 'white'], ['베이지', 'beige'], ['네이비', 'navy'], ['파란색', '블루', 'blue']],
  [['오버핏', '오버사이즈', 'oversized'], ['레귤러핏', 'regular'], ['릴랙스핏', 'relaxed'], ['슬림핏', 'slim'], ['크롭', 'cropped']],
  [['반집업', '하프집업', 'half zip'], ['풀집업', 'full zip'], ['크루넥', '라운드넥', 'crew neck'], ['브이넥', 'v-neck']],
  [['무지', 'plain'], ['작은 레터링', 'small lettering'], ['큰 프린트', 'large print']],
];
const containsTerm = (text: string, term: string) => {
  const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return /^[a-z]/.test(term) ? new RegExp(`(?:^|[^a-z0-9])${escaped}(?:$|[^a-z0-9])`).test(text) : text.includes(term);
};
const findCategory = (text: string) => categoryTerms.find((entry) => entry.terms.some((term) => containsTerm(text, term)));
const modelTokens = (text: string) => text.split(/[\s,()\/]+/).filter((token) => /^[a-z0-9][a-z0-9_+.-]{2,}$/i.test(token) && /[a-z]/i.test(token) && /\d/.test(token));

/** Conservative title evidence parser; unknowns remain null, no semantic LLM score is trusted. */
export function deriveDealRelevanceInput(query: string, candidateTitle: string, categoryFilter: DealCategory = 'ALL'): DealRelevanceInput {
  const queryText = normalize(query), titleText = normalize(candidateTitle);
  const target = findCategory(queryText), candidate = findCategory(titleText);
  if (!target) throw new Error('INVALID_INPUT');
  if (categoryFilter !== 'ALL' && target.filter !== categoryFilter) throw new Error('UNSUPPORTED_CATEGORY');
  const queryModels = modelTokens(queryText), candidateModels = modelTokens(titleText);
  // Multiple explicit model IDs are ambiguous and must not be silently reduced to one.
  if (queryModels.length > 1) throw new Error('INVALID_INPUT');
  const model = queryModels.length ? { query: queryModels[0]!, candidate: candidateModels.includes(queryModels[0]!) ? queryModels[0]! : candidateModels[0] ?? null } : null;
  const modifiers: TextMatch[] = [];
  for (const group of modifierGroups) {
    for (const terms of group) {
      if (!terms.some((term) => containsTerm(queryText, term))) continue;
      const matching = terms.some((term) => containsTerm(titleText, term));
      const alternative = group.find((other) => other.some((term) => containsTerm(titleText, term)));
      modifiers.push({ query: terms[0]!, candidate: matching ? terms[0]! : alternative?.[0] ?? null });
    }
  }
  return { category: { query: target.canonical, candidate: candidate?.canonical ?? null }, model, modifiers };
}
