export const SEARCH_VERSIONS = Object.freeze({
  pipelineVersion: 'similar-search-v3', visionPromptVersion: 'vision-attributes-v3',
  queryExpanderVersion: 'query-v3', attributeTaxonomyVersion: 'attribute-taxonomy-v3-bootstrap-1',
  compatibilityMatrixVersion: 'attribute-compatibility-v3-bootstrap-1',
  rankerVersion: 'ranker-v3-bootstrap-1', gateVersion: 'gate-v3-bootstrap-1',
  pricePolicyVersion: 'unconditional-cohort-v3', sourcePolicyVersion: 'domestic-new-v3',
  dealRankerVersion: 'deal-relevance-v3-bootstrap-1', urlPolicyVersion: 'public-https-v3-1',
});
export const GATE = Object.freeze({ visualCoverage: .75, attributeCoverage: .60, visualSimilarity: .65, attributeSimilarity: .60, totalSimilarity: .65 });
export const VISUAL_WEIGHTS = Object.freeze({ silhouette: .35, color: .20, graphic: .25, detail: .20 });
export const ATTRIBUTE_GROUPS = Object.freeze([
  { weight: .15, fields: ['category'] },
  { weight: .20, fields: ['fit', 'shoulder', 'length'] },
  { weight: .15, fields: ['color'] },
  { weight: .10, fields: ['neck'] },
  { weight: .10, fields: ['closure'] },
  { weight: .10, fields: ['graphic', 'graphicPlacement', 'graphicScale'] },
  { weight: .08, fields: ['pattern'] },
  { weight: .07, fields: ['pocket', 'detail'] },
  { weight: .05, fields: ['wash', 'materialAppearance'] },
] as const);
