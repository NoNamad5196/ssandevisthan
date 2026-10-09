import type {FieldEvidence} from '@ssandevisthan/contracts';
import {canonicalizeProductUrl} from '@ssandevisthan/search-core';
import {AppError,sha256,type Row} from '../runtime.ts';
import {SafeFetcher} from '../safe-fetch.ts';
import {validateMerchantImage} from '../images.ts';

export const EXTRACTOR_VERSION='jsonld-strict-v3-1';
function list(value:unknown):Row[]{return(Array.isArray(value)?value:[value]).filter((v):v is Row=>!!v&&typeof v==='object'&&!Array.isArray(v));}
function types(v:Row,name:string){return[v['@type']].flat().some(t=>t===name||t===`https://schema.org/${name}`||t===`http://schema.org/${name}`);}
function flatten(v:unknown):Row[]{return list(v).flatMap(o=>[o,...flatten(o['@graph']),...flatten(o.mainEntity)]);}
function urlString(value:unknown):string|null{return typeof value==='string'?value:typeof(value as Row)?.url==='string'?(value as Row).url:typeof(value as Row)?.['@id']==='string'?(value as Row)['@id']:null;}
function kr(value:unknown):boolean{return typeof value==='string'&&['KR','KOR','대한민국','South Korea','Republic of Korea'].includes(value);}
function country(value:unknown):boolean{return kr(value)||kr((value as Row)?.addressCountry)||kr((value as Row)?.name);}
function won(value:unknown):number|null{if(typeof value==='string'&&!/^\d+$/.test(value))return null;const n=Number(value);return Number.isSafeInteger(n)&&n>0?n:null;}
function schemaSuffix(v:unknown,name:string){return v===`https://schema.org/${name}`||v===`http://schema.org/${name}`;}
export interface ParsedProduct {product:Row;offer:Row;imageUrl:string;canonicalUrl:string;variantKey:string;variantLocator:string}
export function parseJsonLdProduct(html:string,pageUrl:string):ParsedProduct{
  const found:Row[]=[];const scripts=html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi);
  for(const match of scripts){if(!/\btype\s*=\s*["']application\/ld\+json["']/i.test(match[1]))continue;
    try{found.push(...flatten(JSON.parse(match[2])));}catch{/* An invalid data block never executes. */}}
  const normalized=canonicalizeProductUrl(pageUrl);
  const products=found.filter(p=>types(p,'Product')&&[urlString(p.url),urlString(p['@id'])].some(u=>{try{return !!u&&canonicalizeProductUrl(new URL(u,pageUrl).href)===normalized;}catch{return false;}}));
  if(products.length!==1)throw new AppError(products.length?'AMBIGUOUS_PRODUCT':'PAGE_NOT_PRODUCT',422);
  const product=products[0];if(typeof product.name!=='string'||!product.name.trim()||product.name.length>500)throw new AppError('PAGE_NOT_PRODUCT',422);
  const offers=list(product.offers).filter(o=>types(o,'Offer'));
  // AggregateOffer lowPrice and arbitrary cheapest variant are intentionally never selected.
  const matching=offers.filter(o=>{const u=urlString(o.url);try{return !!u&&canonicalizeProductUrl(new URL(u,pageUrl).href)===normalized;}catch{return false;}});
  if(matching.length!==1)throw new AppError('VARIANT_AMBIGUOUS',422);
  const offer=matching[0];if(product.sku&&offer.sku&&product.sku!==offer.sku)throw new AppError('VARIANT_AMBIGUOUS',422);
  // A matching URL identifies a page, not necessarily its selected variant. A
  // product family with unselected variants cannot lend one option's price to an image.
  if(list(product.hasVariant).length)throw new AppError('VARIANT_AMBIGUOUS',422);
  const explicit=(value:unknown)=>typeof value==='string'&&value.trim().length>0&&value.length<=200?value.trim():null;
  const offerSku=explicit(offer.sku),productSku=explicit(product.sku),offerId=explicit(offer['@id']);
  const color=explicit(product.color),size=explicit(product.size);
  let variantKey:string,variantLocator:string;
  if(offerSku||productSku){variantKey=offerSku??productSku!;variantLocator=offerSku?'Offer.sku':'Product.sku (one exact Offer)';}
  else if(offerId){variantKey=offerId;variantLocator='Offer.@id (one exact Offer)';}
  else if(color&&size){variantKey=JSON.stringify({color,size});variantLocator='Product.color + Product.size (one exact Offer)';}
  else throw new AppError('VARIANT_AMBIGUOUS',422);
  const images=[product.image].flat().map(urlString).filter((v):v is string=>!!v).map(v=>new URL(v,pageUrl).href);
  const unique=[...new Set(images)];if(unique.length!==1)throw new AppError(unique.length?'AMBIGUOUS_IMAGE':'NO_RELIABLE_PRODUCT_IMAGE',422);
  if(/(?:logo|banner|review|recommend|tracking|pixel)/i.test(new URL(unique[0]).pathname))throw new AppError('NO_RELIABLE_PRODUCT_IMAGE',422);
  return{product,offer,imageUrl:unique[0],canonicalUrl:normalized,variantKey,variantLocator};
}
export async function extractCandidate(context:{searchId:string;candidateId:string;url:string;deadline:number},fetcher:SafeFetcher=new SafeFetcher()):Promise<Row>{
  const page=await fetcher.get(context.url,'html',context.deadline);const pageHash=await sha256(page.bytes);
  const parsed=parseJsonLdProduct(new TextDecoder('utf-8',{fatal:true}).decode(page.bytes),page.url);
  const {product,offer}=parsed;
  const image=await fetcher.get(parsed.imageUrl,'image',context.deadline);await validateMerchantImage(image.bytes);
  const now=new Date().toISOString(),productId=crypto.randomUUID(),variantId=crypto.randomUUID(),offerId=crypto.randomUUID();
  const evidence:FieldEvidence[]=[];
  function record(fieldPath:string,value:unknown,locator:string,sourceKind:FieldEvidence['sourceKind']='MERCHANT_METADATA',hash=pageHash,sourceUrl=parsed.canonicalUrl){
    const entry:FieldEvidence={id:crypto.randomUUID(),searchId:context.searchId,candidateId:context.candidateId,productId,variantId,offerId,fieldPath,value,
      sourceUrl,sourceKind,extractionMethod:locator,evidenceExcerpt:null,contentSha256:hash,observedAt:now,confidence:'VERIFIED',extractorVersion:EXTRACTOR_VERSION};evidence.push(entry);return entry.id;
  }
  const countrySeller=country(offer.seller?.address?.addressCountry);
  const shipping=list(offer.shippingDetails).filter(d=>types(d,'OfferShippingDetails')&&list(d.shippingDestination).some(a=>country(a.addressCountry)));
  const origins=list(offer.availableAtOrFrom).map(x=>x.address).concat(list(offer.shippingOrigin));
  const fromKorea=origins.some(a=>country(a?.addressCountry));
  const condition=schemaSuffix(offer.itemCondition??product.itemCondition,'NewCondition')?'NEW':schemaSuffix(offer.itemCondition??product.itemCondition,'UsedCondition')?'USED':'UNKNOWN';
  const stock=schemaSuffix(offer.availability,'InStock')?'IN_STOCK':schemaSuffix(offer.availability,'OutOfStock')?'OUT_OF_STOCK':'UNKNOWN';
  const sell=schemaSuffix(offer.businessFunction,'Sell')||offer.businessFunction==='http://purl.org/goodrelations/v1#Sell';
  // Member/card/coupon price specifications cannot be general-price evidence.
  const conditional=list(offer.priceSpecification).some(s=>s.validForMemberTier||s.eligibleCustomerType||/member|coupon|card|회원|쿠폰|카드/i.test(String(s.name??'')));
  const price=offer.priceCurrency==='KRW'&&!conditional?won(offer.price):null;
  let shippingFee:number|null=null;
  if(shipping.length===1){const rate=shipping[0].shippingRate;const n=Number(rate?.value);
    if(rate?.currency==='KRW'&&/^\d+$/.test(String(rate.value))&&Number.isSafeInteger(n)&&n>=0&&!shipping[0].shippingConditions&&!shipping[0].eligibleTransactionVolume)shippingFee=n;}
  record('/title',product.name,'Product.name');record('/imageUrl',image.url,'Product.image + safe decoded GET','MERCHANT_IMAGE',await sha256(image.bytes),parsed.canonicalUrl);
  if(price!==null)record('/itemPrice',price,'Product.offers[exact URL].price');if(shippingFee!==null)record('/shippingFee',shippingFee,'Offer.shippingDetails.shippingRate');
  if(condition!=='UNKNOWN')record('/condition',condition,'Offer.itemCondition');if(stock!=='UNKNOWN')record('/stockStatus',stock,'Offer.availability');
  if(shipping.length)record('/domesticShipping','CONFIRMED','Offer.shippingDetails.shippingDestination');
  if(countrySeller)record('/domesticSales',true,'Offer.seller.address.addressCountry');if(fromKorea)record('/overseasDirect',false,'Offer.shippingOrigin');if(sell)record('/rental',false,'Offer.businessFunction');
  const variantKey=parsed.variantKey;
  record('/variant',variantKey,parsed.variantLocator);
  return{
    candidateId:context.candidateId,productId,offerId,variantId,resultGroupKey:`${new URL(parsed.canonicalUrl).hostname}:${variantKey}`,
    title:product.name,merchant:typeof offer.seller?.name==='string'?offer.seller.name:new URL(parsed.canonicalUrl).hostname,source:new URL(parsed.canonicalUrl).hostname,
    productUrl:parsed.canonicalUrl,imageUrl:image.url,imageSource:new URL(image.url).hostname===new URL(parsed.canonicalUrl).hostname?'merchant_metadata':'merchant_cdn',
    imageSourceUrl:parsed.canonicalUrl,imageExtractionStage:'METADATA',
    // JSON-LD cannot prove that the merchant checkout has preselected this option.
    variant:{color:typeof product.color==='string'?product.color:null,size:typeof product.size==='string'?product.size:null,availability:stock,selectionRequired:true},
    currency:'KRW',itemPrice:price,shippingFee,conditionalPrices:[],priceObservedAt:price!==null?now:null,imageObservedAt:now,stockObservedAt:stock!=='UNKNOWN'?now:null,
    evidenceIds:evidence.map(e=>e.id),fieldEvidence:evidence,matchedAttributes:[],differentAttributes:[],unknownAttributes:[],warnings:[],comparison:null,
    price:{variantPriceVerified:price!==null,unconditionalPriceVerified:price!==null,shippingFeeVerified:shippingFee!==null},
    eligibility:{isClothing:null,condition,domesticShipping:shipping.length?'CONFIRMED':'UNKNOWN',domesticSales:countrySeller?true:null,overseasDirect:fromKorea?false:null,
      rental:sell?false:null,stockStatus:stock,productPageVerified:true,imageVerifiedSameProduct:true,imageVerifiedSameVariant:true,isMerchantImage:true,variantVerified:true},
    sourceVariantKey:variantKey,sourceProductKey:product.sku??null,canonicalUrlHash:await sha256(parsed.canonicalUrl),imageHash:await sha256(image.bytes),observedAt:now,
  };
}
