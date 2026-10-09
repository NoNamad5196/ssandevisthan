import type { FieldEvidence } from '@ssandevisthan/contracts';
import { canonicalizeProductUrl } from '@ssandevisthan/search-core';
import { AppError, sha256, type Row } from '../runtime.ts';
import { SafeFetcher } from '../safe-fetch.ts';
import { validateMerchantImage } from '../images.ts';

export const ELEVENST_VERSION='11st-public-size-option-v3-2';
const fail=(code:string):never=>{throw new AppError(code,422);};
const plain=(s:string)=>s.replace(/<[^>]*>/g,' ').replace(/&nbsp;|&#160;/g,' ').replace(/&amp;/g,'&').replace(/\s+/g,' ').trim();
function attrs(s:string){return Object.fromEntries([...s.matchAll(/([\w-]+)\s*=\s*(["'])(.*?)\2/gs)].map(m=>[m[1],m[3]]));}
function jsonVariable(html:string,name:string):Row{
 const match=html.match(new RegExp(`\\bvar\\s+${name}\\s*=\\s*(\\{[^\\r\\n]*\\})\\s*;`));
 if(!match) return fail('PAGE_NOT_PRODUCT');
 try{const value=JSON.parse(match[1]);if(!value||typeof value!=='object'||Array.isArray(value))return fail('PAGE_NOT_PRODUCT');return value;}catch{return fail('PAGE_NOT_PRODUCT');}
}
const money=(value:unknown):number=>{const s=String(value);if(!/^(?:\d+|\d{1,3}(?:,\d{3})+)$/.test(s))return fail('CONFLICTING_SOURCE');const n=Number(s.replaceAll(',',''));return Number.isSafeInteger(n)&&n>0?n:fail('CONFLICTING_SOURCE');};
function tableValue(html:string,label:string){const match=html.match(new RegExp(`<th\\b[^>]*>\\s*${label}\\s*<\\/th>\\s*<td\\b[^>]*>([\\s\\S]*?)<\\/td>`));return match?plain(match[1]):null;}

/** The first price panel after the verified current-product title is the buybox.
 * Balance nested divs so a help panel cannot hide the sale-stopped notice. Script,
 * style, template and comment contents are data, never visible stock evidence. */
function currentPricePanel(afterTitle:string):string|null{
 const ignored=/<!--[\s\S]*?-->|<(?:script|style|template)\b[^>]*>[\s\S]*?<\/(?:script|style|template)\s*>/gi;
 const visible=afterTitle.replace(ignored,'');
 const divs=/<\/?div\b([^>]*)>/gi;let opening:RegExpExecArray|null;
 while((opening=divs.exec(visible))){
  if(opening[0].startsWith('</')||!attrs(opening[1]).class?.split(/\s+/).includes('b_product_info_price'))continue;
  const start=divs.lastIndex;let depth=1,token:RegExpExecArray|null;
  while((token=divs.exec(visible))){depth+=token[0].startsWith('</')?-1:1;if(depth===0)return visible.slice(start,token.index);}
  return fail('CONFLICTING_SOURCE');
 }
 return null;
}

/** Source-specific parsing of public page data. Never evaluates merchant scripts,
 * calls checkout APIs, or assumes eligibility from a Korean domain or title. */
export function parseElevenstProduct(html:string,pageUrl:string){
 const url=new URL(canonicalizeProductUrl(pageUrl));
 const id=url.pathname.match(/^\/products\/(\d+)\/?$/)?.[1];
 if(url.hostname!=='www.11st.co.kr'||!id)return fail('PAGE_NOT_PRODUCT');
 // Unknown option parameters must never be replaced by a different source size.
 if([...url.searchParams.keys()].length)return fail('VARIANT_AMBIGUOUS');
 const canonicalUrl=`https://www.11st.co.kr/products/${id}`;
 const info=jsonVariable(html,'productPrdInfo'),metadata=jsonVariable(html,'brazeProperty');
 if(String(info.prdNo)!==id||String(metadata.product_no)!==id||info.isGroupProduct!==false)return fail('AMBIGUOUS_PRODUCT');
 const products:Row[]=[];
 for(const script of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi)){
  if(!/\btype\s*=\s*["']application\/ld\+json["']/i.test(script[1]))continue;
  try{const p=JSON.parse(script[2]);if(p['@type']==='Product'&&String(p.productID)===id)products.push(p);}catch{/* invalid data is never executable */}
 }
 if(products.length!==1)return fail('AMBIGUOUS_PRODUCT');
 const product=products[0],offer=product.offers;
 if(!offer||Array.isArray(offer)||offer['@type']!=='Offer'||offer.url!==canonicalUrl||offer.priceCurrency!=='KRW')return fail('CONFLICTING_SOURCE');
 if(typeof product.name!=='string'||product.name!==info.prdNm||product.name!==metadata.product_name||product.name.length>500)return fail('CONFLICTING_SOURCE');
 const titleMatch=html.match(/<div\b[^>]*class=["'][^"']*\bc_product_info_title\b[^"']*["'][^>]*>([\s\S]*?<\/h1>)/);
 const titleBlock=titleMatch?.[1]??'';
 const visibleTitle=titleBlock.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/)?.[1];
 if(!visibleTitle||plain(visibleTitle)!==product.name)return fail('CONFLICTING_SOURCE');
 const pricePanel=currentPricePanel(html.slice((titleMatch!.index??0)+titleMatch![0].length));
 if(pricePanel&&[...pricePanel.matchAll(/<p\b([^>]*)>([\s\S]*?)<\/p>/gi)].some(m=>attrs(m[1]).class?.split(/\s+/).includes('text_em_lg')&&/^현재\s*판매\s*중인\s*상품이\s*아닙니다[.!]?$/.test(plain(m[2]))))return fail('OUT_OF_STOCK');
 const dispatch=plain(titleBlock.match(/<em\b[^>]*class=["']title_sub["'][^>]*>([\s\S]*?)<\/em>/)?.[1]??'');
 const domesticDispatch=/(?:^|[\s(])(?:국내|한국)\s*(?:발송|출고|재고)(?:[\s)]|$)/.test(`${dispatch} ${product.name}`);
 const domesticSales=domesticDispatch&&['개인사업자','법인사업자'].includes(tableValue(html,'사업자구분')??'')&&tableValue(html,'판매자')===metadata.store_name?true:null;
 if(tableValue(html,'상품번호')!==id||tableValue(html,'상품상태')!=='새상품')return fail('NOT_NEW');
 if(tableValue(html,'배송방법')!=='택배'||tableValue(html,'배송가능지역')!=='전국'||info.isDirectPurchaseType!==false)return fail('ELIGIBILITY_UNKNOWN');
 if(info.isRental!==false)return fail(info.isRental===true?'RENTAL':'ELIGIBILITY_UNKNOWN');
 // is_sale in analytics denotes a discount, not inventory. Stock must come
 // from the Product Offer and the actual enabled size option below.
 if(!/^https?:\/\/schema\.org\/InStock$/.test(offer.availability??''))return fail('OUT_OF_STOCK');
 // These booleans explicitly identify membership-exclusive/conditional offers.
 if(info.hasMemberPrice!==false||info.hasMembershipPrice!==false||info.showDualPrice!==false||info.isUniverseExclusive!==false)return fail('CONDITIONAL_PRICE_ONLY');
 const itemPrice=money(offer.price);
 if(itemPrice!==money(info.finalDscPrc)||itemPrice!==money(metadata.discount_price))return fail('CONFLICTING_SOURCE');
 if(info.memberMoCupnAmt!==0||info.moCupnAmt!==0||![info.selPrc,info.soCupnAmt].every(n=>Number.isSafeInteger(n)&&n>=0)||info.selPrc-info.soCupnAmt!==itemPrice)return fail('CONDITIONAL_PRICE_ONLY');
 if(info.soCupnAmt>0){
  const priceRequest=html.match(/fetch\(`\/products\/v1\/pc\/products\/max-discount`[\s\S]{0,700}?body:\s*JSON\.stringify\(\{([\s\S]{0,5000}?)\}\)/)?.[1]??'';
  if(priceRequest.match(/\bproductNo:\s*(\d+)/)?.[1]!==id||Number(priceRequest.match(/\bsellerDirectDiscountAmount:\s*(\d+)/)?.[1])!==info.soCupnAmt)return fail('CONDITIONAL_PRICE_ONLY');
 }
 const axes=[...html.matchAll(/<input\b([^>]*\bname=["']botOptTitle["'][^>]*)>/g)].map(m=>attrs(m[1]).value);
 if(axes.length!==1||!['사이즈','SIZE','Size','size'].includes(axes[0]))return fail('VARIANT_AMBIGUOUS');
 const optionList=html.match(/<ul\b[^>]*class=["'][^"']*\bbot_typ_01\b[^"']*["'][^>]*>([\s\S]*?)<\/ul>/)?.[1];
 if(!optionList)return fail('VARIANT_AMBIGUOUS');
 const options=[...optionList.matchAll(/<li\b([^>]*)>([\s\S]*?)<\/li>/g)].map(m=>({a:attrs(m[1]),body:m[2]}));
 if(!options.length||options.length>100)return fail('VARIANT_AMBIGUOUS');
 const available=options.filter(({a})=>!/(?:^|\s)disabled(?:\s|$)/.test(a.class??'')&&/^\d+$/.test(a['data-stckqty']??'')&&Number(a['data-stckqty'])>0);
 if(!available.length)return fail('OUT_OF_STOCK');
 // Do not choose the cheapest size: every available size must agree with the
 // one advertised price. Preserve the first available source option and its ID.
 if(available.some(({a})=>money(a['data-price'])!==itemPrice||a['data-addprc']!=='0'||a['data-minaddprc']!=='0'||a['data-maxaddprc']!=='0'))return fail('VARIANT_AMBIGUOUS');
 if(available.some(({body})=>!/<dt>\s*판매가\s*<\/dt>/.test(body)||money(plain(body.match(/<span\b[^>]*class=["']num value["'][^>]*>([\s\S]*?)<\/span>/)?.[1]??''))!==itemPrice))return fail('CONFLICTING_SOURCE');
 const selected=available[0].a;
 if(!/^\d+$/.test(selected['data-stckno']??'')||!selected['data-dtloptnm']||selected['data-dtloptnm'].length>80)return fail('VARIANT_AMBIGUOUS');
 if(typeof product.image!=='string'||typeof metadata.product_image_url!=='string')return fail('AMBIGUOUS_IMAGE');
 const imageUrl=new URL(product.image),otherImage=new URL(metadata.product_image_url);
 if(imageUrl.hostname!=='cdn.011st.com'||otherImage.hostname!==imageUrl.hostname||imageUrl.pathname.split('/').pop()!==otherImage.pathname.split('/').pop()||!imageUrl.pathname.split('/').pop()?.startsWith(`${id}_`))return fail('IMAGE_UNVERIFIED');
 const delivery=html.match(/<div\s+class=["']delivery["']\s*>([\s\S]*?)<\/div>/)?.[1]??'';
 const regionSpecific=/<span\b[^>]*class=["']area["']/.test(delivery);
 const deliveryProduct=delivery.match(/["']current_product_no["']\s*:\s*(\d+)/)?.[1];
 const shippingFee=metadata.delivery_fee===0&&metadata.delivery_free_price===0&&deliveryProduct===id&&!regionSpecific&&/무료배송/.test(plain(delivery))?0:null;
 if(typeof metadata.store_name!=='string'||!metadata.store_name.trim()||metadata.store_name.length>200)return fail('PAGE_NOT_PRODUCT');
 return{canonicalUrl,sourceProductKey:id,title:product.name,merchant:metadata.store_name,imageUrl:imageUrl.href,itemPrice,shippingFee,domesticSales,
  variantKey:selected['data-stckno'],size:selected['data-dtloptnm'],category:String(product.category??'')};
}

export async function extractElevenstCandidate(context:{searchId:string;candidateId:string;url:string;deadline:number},fetcher:SafeFetcher=new SafeFetcher()):Promise<Row>{
 const page=await fetcher.get(context.url,'html',context.deadline);
 const charset=page.headers.get('content-type')?.match(/charset\s*=\s*["']?([\w-]+)/i)?.[1]?.toLowerCase()??'utf-8';
 if(!['utf-8','utf8','euc-kr','ks_c_5601-1987'].includes(charset))return fail('INVALID_CONTENT_TYPE');
 const parsed=parseElevenstProduct(new TextDecoder(charset,{fatal:true}).decode(page.bytes),page.url);
 const image=await fetcher.get(parsed.imageUrl,'image',context.deadline);await validateMerchantImage(image.bytes);
 const pageHash=await sha256(page.bytes),imageHash=await sha256(image.bytes),now=new Date().toISOString();
 const productId=crypto.randomUUID(),variantId=crypto.randomUUID(),offerId=crypto.randomUUID();
 const evidence:FieldEvidence[]=[];
 function record(fieldPath:string,value:unknown,locator:string,kind:FieldEvidence['sourceKind']='MERCHANT_METADATA',hash=pageHash){
  evidence.push({id:crypto.randomUUID(),searchId:context.searchId,candidateId:context.candidateId,productId,variantId,offerId,fieldPath,value,sourceUrl:parsed.canonicalUrl,
   sourceKind:kind,extractionMethod:locator,evidenceExcerpt:null,contentSha256:hash,observedAt:now,confidence:'VERIFIED',extractorVersion:ELEVENST_VERSION});
 }
 record('/title',parsed.title,'Product.name + productPrdInfo.prdNm + brazeProperty.product_name');
 record('/imageUrl',image.url,'Product.image + brazeProperty.product_image_url: same product ID and basename; size-only options; decoded safe GET','MERCHANT_IMAGE',imageHash);
 record('/itemPrice',parsed.itemPrice,'Product.offers.price = productPrdInfo.finalDscPrc = brazeProperty.discount_price = available option data-price; conditional price flags false');
 if(parsed.shippingFee===0)record('/shippingFee',0,'brazeProperty.delivery_fee=0; delivery_free_price=0; visible free delivery');
 record('/condition','NEW','product information table: 상품상태=새상품');
 record('/domesticShipping','CONFIRMED','product information table: 배송방법=택배; 배송가능지역=전국');
 if(parsed.domesticSales===true)record('/domesticSales',true,'current product h1/title_sub explicitly declares domestic dispatch; public seller name matches metadata; seller type is domestic business');
 record('/overseasDirect',false,'productPrdInfo.isDirectPurchaseType=false');record('/rental',false,'productPrdInfo.isRental=false');
 record('/stockStatus','IN_STOCK','Product.offers.availability + enabled selected option data-stckqty>0');
 record('/variant',parsed.variantKey,'one SIZE axis; selected available option data-stckno/data-dtloptnm; all available size prices agree');
 return{candidateId:context.candidateId,productId,variantId,offerId,resultGroupKey:`11st:${parsed.sourceProductKey}`,
  title:parsed.title,merchant:parsed.merchant,source:'11st.co.kr',productUrl:parsed.canonicalUrl,imageUrl:image.url,imageSource:'merchant_cdn',imageSourceUrl:parsed.canonicalUrl,imageExtractionStage:'STATIC_HTML',
  variant:{color:null,size:parsed.size,availability:'IN_STOCK',selectionRequired:true},currency:'KRW',itemPrice:parsed.itemPrice,shippingFee:parsed.shippingFee,conditionalPrices:[],priceObservedAt:now,imageObservedAt:now,stockObservedAt:now,
  evidenceIds:evidence.map(e=>e.id),fieldEvidence:evidence,matchedAttributes:[],differentAttributes:[],unknownAttributes:[],warnings:[],comparison:null,
  price:{variantPriceVerified:true,unconditionalPriceVerified:true,shippingFeeVerified:parsed.shippingFee!==null},
  eligibility:{isClothing:null,condition:'NEW',domesticShipping:'CONFIRMED',domesticSales:parsed.domesticSales,overseasDirect:false,rental:false,stockStatus:'IN_STOCK',productPageVerified:true,imageVerifiedSameProduct:true,imageVerifiedSameVariant:true,isMerchantImage:true,variantVerified:true},
  sourceVariantKey:parsed.variantKey,sourceProductKey:parsed.sourceProductKey,canonicalUrlHash:await sha256(parsed.canonicalUrl),imageHash,observedAt:now};
}
