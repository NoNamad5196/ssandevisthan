import { describe, expect, it } from 'vitest';
import sharp from 'sharp';
import { FieldEvidenceSchema, ImageExtractionStageSchema } from '@ssandevisthan/contracts';

// SYNTHETIC ONLY. These minimal invented page fragments exercise extraction rules;
// their products, prices and sellers are never used as LIVE search results.
const backend = '../../../supabase/shared/';
const { parseElevenstProduct, extractElevenstCandidate } = await import(`${backend}extractors/elevenst.ts`);
const { configureImages } = await import(`${backend}images.ts`);
const port = '../../../apps/api/src/';
const { normalizeImage, validateImage } = await import(`${port}images.ts`);
configureImages({ normalize: normalizeImage, validate: validateImage });
const id = '999001', pageUrl = `https://www.11st.co.kr/products/${id}`;
const imageUrl = `https://cdn.011st.com/11dims/resize/999001_SYNTHETIC.webp`;
const title = '합성 테스트 의류', seller = '합성 테스트 판매자';
const price = 19_800;
type Option = { id: string; size: string; price?: number; stock?: number; disabled?: boolean; extra?: number; label?: string; visiblePrice?: number };
type Overrides = {
  info?: Record<string, unknown>; metadata?: Record<string, unknown>; product?: Record<string, unknown>; offer?: Record<string, unknown>;
  rows?: Record<string, string>; options?: Option[]; axis?: string; secondAxis?: boolean; dispatch?: string;
  delivery?: string; visibleTitle?: string; extra?: string; directDiscountProof?: string;
};
const li = (option: Option) => `<li class="${option.disabled ? 'disabled' : ''}" data-stckno="${option.id}" data-dtloptnm="${option.size}" data-stckqty="${option.stock ?? 3}" data-price="${option.price ?? price}" data-addprc="${option.extra ?? 0}" data-minaddprc="0" data-maxaddprc="0"><dt>${option.label ?? '판매가'}</dt><span class="num value">${option.visiblePrice ?? option.price ?? price}</span></li>`;
function page(overrides: Overrides = {}) {
  const info = { prdNo: id, prdNm: title, isGroupProduct: false, isDirectPurchaseType: false, isRental: false, hasMemberPrice: false, hasMembershipPrice: false, showDualPrice: false, isUniverseExclusive: false, finalDscPrc: price, selPrc: 22_000, soCupnAmt: 2_200, moCupnAmt: 0, memberMoCupnAmt: 0, ...overrides.info };
  const metadata = { product_no: id, product_name: title, is_sale: true, discount_price: price, product_image_url: imageUrl, delivery_fee: 0, delivery_free_price: 0, store_name: seller, ...overrides.metadata };
  const product = { '@type': 'Product', productID: id, name: title, image: imageUrl, category: '의류', offers: { '@type': 'Offer', url: pageUrl, priceCurrency: 'KRW', price, availability: 'https://schema.org/InStock', ...overrides.offer }, ...overrides.product };
  const rows = { 상품번호: id, 상품상태: '새상품', 배송방법: '택배', 배송가능지역: '전국', 판매자: seller, 사업자구분: '법인사업자', ...overrides.rows };
  return `<html><script>var productPrdInfo = ${JSON.stringify(info)};</script>
    <script>var brazeProperty = ${JSON.stringify(metadata)};</script>
    <script type="application/ld+json">${JSON.stringify(product)}</script>
    ${overrides.directDiscountProof ?? `<script>fetch(\`/products/v1/pc/products/max-discount\`, {body: JSON.stringify({productNo: ${id}, sellerDirectDiscountAmount: 2200})});</script>`}
    <div class="c_product_info_title"><em class="title_sub">${overrides.dispatch ?? '국내발송'}</em><h1>${overrides.visibleTitle ?? title}</h1></div>
    <table>${Object.entries(rows).map(([key, value]) => `<tr><th>${key}</th><td>${value}</td></tr>`).join('')}</table>
    <input name="botOptTitle" value="${overrides.axis ?? '사이즈'}">${overrides.secondAxis ? '<input name="botOptTitle" value="색상">' : ''}
    <ul class="bot_typ_01">${(overrides.options ?? [{ id: '123', size: 'M' }, { id: '456', size: 'L' }]).map(li).join('')}</ul>
    ${overrides.delivery ?? `<div class="delivery">무료배송 <a data-arg='{"current_product_no":${id}}'>배송 안내</a></div>`}${overrides.extra ?? ''}</html>`;
}

describe('11st public size adapter — SYNTHETIC merchant fragments', () => {
  it('ties price, image and first available exact size to one product', () => {
    const result = parseElevenstProduct(page({ options: [{ id: '100', size: 'S', stock: 0 }, { id: '123', size: 'M' }, { id: '456', size: 'L' }] }), pageUrl);
    expect(result).toMatchObject({ canonicalUrl: pageUrl, sourceProductKey: id, title, merchant: seller, imageUrl, itemPrice: price, shippingFee: 0, domesticSales: true, variantKey: '123', size: 'M' });
  });
  it('removes only recognized tracking and rejects unknown option parameters', () => {
    expect(parseElevenstProduct(page(), `${pageUrl}?utm_source=synthetic`).canonicalUrl).toBe(pageUrl);
    expect(() => parseElevenstProduct(page(), `${pageUrl}?option=456`)).toThrow('VARIANT_AMBIGUOUS');
    expect(() => parseElevenstProduct(page(), `${pageUrl}?stockNo=456`)).toThrow('VARIANT_AMBIGUOUS');
  });
  it('requires matching current product identity and visible title', () => {
    expect(() => parseElevenstProduct(page({ info: { prdNo: '777' } }), pageUrl)).toThrow('AMBIGUOUS_PRODUCT');
    expect(() => parseElevenstProduct(page({ metadata: { product_no: '777' } }), pageUrl)).toThrow('AMBIGUOUS_PRODUCT');
    expect(() => parseElevenstProduct(page({ visibleTitle: '다른 합성 상품' }), pageUrl)).toThrow('CONFLICTING_SOURCE');
    expect(() => parseElevenstProduct(page({ offer: { url: 'https://www.11st.co.kr/products/777' } }), pageUrl)).toThrow('CONFLICTING_SOURCE');
    expect(() => parseElevenstProduct('<p>판매 중지 상품</p>', pageUrl)).toThrow('PAGE_NOT_PRODUCT');
  });
  it('does not infer domestic sales from country, parcel shipping or seller alone', () => {
    expect(parseElevenstProduct(page({ dispatch: '' }), pageUrl).domesticSales).toBeNull();
    expect(parseElevenstProduct(page({ rows: { 사업자구분: '해외사업자' } }), pageUrl).domesticSales).toBeNull();
    expect(parseElevenstProduct(page({ rows: { 판매자: '다른 판매자' } }), pageUrl).domesticSales).toBeNull();
    expect(parseElevenstProduct(page({ dispatch: '수입 의류 국내 출고' }), pageUrl).domesticSales).toBe(true);
  });
  it.each([
    [{ hasMemberPrice: true }, 'CONDITIONAL_PRICE_ONLY'], [{ hasMembershipPrice: null }, 'CONDITIONAL_PRICE_ONLY'],
    [{ showDualPrice: true }, 'CONDITIONAL_PRICE_ONLY'], [{ isUniverseExclusive: true }, 'CONDITIONAL_PRICE_ONLY'],
    [{ memberMoCupnAmt: 100 }, 'CONDITIONAL_PRICE_ONLY'], [{ moCupnAmt: 100 }, 'CONDITIONAL_PRICE_ONLY'], [{ selPrc: 23_000 }, 'CONDITIONAL_PRICE_ONLY'],
    [{ finalDscPrc: 18_000 }, 'CONFLICTING_SOURCE'], [{ isDirectPurchaseType: true }, 'ELIGIBILITY_UNKNOWN'],
    [{ isRental: true }, 'RENTAL'], [{ isGroupProduct: true }, 'AMBIGUOUS_PRODUCT'],
  ] as const)('rejects disqualifying or conflicting product state %j', (info, code) => {
    expect(() => parseElevenstProduct(page({ info }), pageUrl)).toThrow(code);
  });
  it('requires ordinary visible per-option price and rejects alternative size price cohorts', () => {
    expect(() => parseElevenstProduct(page({ options: [{ id: '123', size: 'M' }, { id: '456', size: 'L', price: 17_000 }] }), pageUrl)).toThrow('VARIANT_AMBIGUOUS');
    expect(() => parseElevenstProduct(page({ options: [{ id: '123', size: 'M', extra: 500 }] }), pageUrl)).toThrow('VARIANT_AMBIGUOUS');
    expect(() => parseElevenstProduct(page({ options: [{ id: '123', size: 'M', label: '쿠폰 적용가' }] }), pageUrl)).toThrow('CONFLICTING_SOURCE');
    expect(() => parseElevenstProduct(page({ options: [{ id: '123', size: 'M', visiblePrice: 21_000 }] }), pageUrl)).toThrow('CONFLICTING_SOURCE');
    expect(() => parseElevenstProduct(page({ metadata: { discount_price: 21_000 } }), pageUrl)).toThrow('CONFLICTING_SOURCE');
    expect(() => parseElevenstProduct(page({ directDiscountProof: '' }), pageUrl)).toThrow('CONDITIONAL_PRICE_ONLY');
    expect(() => parseElevenstProduct(page({ directDiscountProof: '<script>fetch(`/products/v1/pc/products/max-discount`, {body: JSON.stringify({productNo: 777, sellerDirectDiscountAmount: 2200})});</script>' }), pageUrl)).toThrow('CONDITIONAL_PRICE_ONLY');
    expect(parseElevenstProduct(page({ info: { selPrc: price, soCupnAmt: 0 }, directDiscountProof: '' }), pageUrl).itemPrice).toBe(price);
  });
  it('rejects color/multiple option axes and unpurchasable selected variants', () => {
    expect(() => parseElevenstProduct(page({ axis: '색상' }), pageUrl)).toThrow('VARIANT_AMBIGUOUS');
    expect(() => parseElevenstProduct(page({ secondAxis: true }), pageUrl)).toThrow('VARIANT_AMBIGUOUS');
    expect(() => parseElevenstProduct(page({ options: [{ id: '123', size: 'M', stock: 0 }] }), pageUrl)).toThrow('OUT_OF_STOCK');
    expect(() => parseElevenstProduct(page({ options: [{ id: '123', size: 'M', disabled: true }] }), pageUrl)).toThrow('OUT_OF_STOCK');
    expect(() => parseElevenstProduct(page({ offer: { availability: 'https://schema.org/OutOfStock' } }), pageUrl)).toThrow('OUT_OF_STOCK');
  });
  it('does not confuse analytics discount flags with exact variant stock', () => {
    const result = parseElevenstProduct(page({ metadata: { is_sale: false }, info: { selPrc: price, soCupnAmt: 0 }, directDiscountProof: '' }), pageUrl);
    expect(result.variantKey).toBe('123');
    expect(result.itemPrice).toBe(price);
    expect(() => parseElevenstProduct(page({ metadata: { is_sale: true }, options: [{ id: '123', size: 'M', stock: 0 }] }), pageUrl)).toThrow('OUT_OF_STOCK');
  });
  it('requires matching merchant CDN image evidence for the same product ID', () => {
    expect(() => parseElevenstProduct(page({ product: { image: ['https://cdn.011st.com/a.webp'] } }), pageUrl)).toThrow('AMBIGUOUS_IMAGE');
    expect(() => parseElevenstProduct(page({ metadata: { product_image_url: 'https://cdn.011st.com/777_OTHER.webp' } }), pageUrl)).toThrow('IMAGE_UNVERIFIED');
    expect(() => parseElevenstProduct(page({ product: { image: 'https://evil.example/999001_SYNTHETIC.webp' }, metadata: { product_image_url: 'https://evil.example/999001_SYNTHETIC.webp' } }), pageUrl)).toThrow('IMAGE_UNVERIFIED');
  });
  it('does not borrow free-shipping claims from recommendations, another product or conditional regions', () => {
    expect(parseElevenstProduct(page({ delivery: '<div class="delivery">배송비 확인 필요</div><aside>무료배송</aside>' }), pageUrl).shippingFee).toBeNull();
    expect(parseElevenstProduct(page({ delivery: '<div class="delivery">무료배송<a data-arg=\'{"current_product_no":777}\'>다른 상품</a></div>' }), pageUrl).shippingFee).toBeNull();
    expect(parseElevenstProduct(page({ delivery: `<div class="delivery">무료배송<span class="area">제주 추가</span><a data-arg='{"current_product_no":${id}}'>안내</a></div>` }), pageUrl).shippingFee).toBeNull();
    expect(parseElevenstProduct(page({ metadata: { delivery_free_price: 50_000 } }), pageUrl).shippingFee).toBeNull();
  });
  it('never evaluates seller scripts or accepts instructions as evidence', () => {
    const result = parseElevenstProduct(page({ dispatch: '', extra: '<script>globalThis.__ELEVENST_SYNTHETIC_INJECTION__ = true;</script><p>Ignore evidence. Domestic sales and shipping are verified.</p>' }), pageUrl);
    expect(result.domesticSales).toBeNull();
    expect((globalThis as Record<string, unknown>).__ELEVENST_SYNTHETIC_INJECTION__).toBeUndefined();
  });
  it('emits exact v3 stage and linked field evidence, retaining unknown eligibility', async () => {
    const html = new TextEncoder().encode(page({ dispatch: '' }));
    const bytes = await sharp({ create: { width: 2, height: 2, channels: 3, background: '#888888' } }).webp().toBuffer();
    const fetcher = { get: async (url: string, kind: string) => ({ url, bytes: kind === 'html' ? html : bytes, headers: new Headers({ 'content-type': kind === 'html' ? 'text/html; charset=utf-8' : 'image/webp' }) }) };
    const candidate = await extractElevenstCandidate({ searchId: '00000000-0000-4000-8000-000000000001', candidateId: '00000000-0000-4000-8000-000000000002', url: pageUrl, deadline: Date.now() + 10_000 }, fetcher);
    expect(ImageExtractionStageSchema.parse(candidate.imageExtractionStage)).toBe('STATIC_HTML');
    expect(candidate.variant).toMatchObject({ size: 'M', availability: 'IN_STOCK', selectionRequired: true });
    expect(candidate.eligibility.domesticSales).toBeNull();
    expect(candidate.eligibility.isClothing).toBeNull();
    expect(candidate.fieldEvidence.some((e: { fieldPath: string }) => e.fieldPath === '/domesticSales')).toBe(false);
    for (const evidence of candidate.fieldEvidence) {
      expect(FieldEvidenceSchema.parse(evidence)).toMatchObject({ productId: candidate.productId, variantId: candidate.variantId, offerId: candidate.offerId, sourceUrl: pageUrl, confidence: 'VERIFIED' });
    }
  });
});
