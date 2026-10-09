import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Link, Route, Routes, useNavigate, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ArrowRight, Upload, Search, Shirt, ShoppingBag, Truck, LoaderCircle, X, ArrowLeft, ExternalLink, ImagePlus, Check, RefreshCw } from 'lucide-react';
import { active, errorMessage, request, stageLabel, type Results, type Result, type SearchState, type Sort } from './api';

function Header(){return <header className="header"><Link to="/" aria-label="싼데비슷한 홈"><img src="/artwork/header-logo.png" alt="싼데비슷한" /></Link><nav aria-label="주 메뉴"><Link className="nav-active" to="/">비슷한 옷 찾기</Link><span aria-hidden="true"/><a href="/#deals">핫딜 찾기</a></nav></header>}

function UploadPanel(){
 const input=useRef<HTMLInputElement>(null);const nav=useNavigate();
 const [file,setFile]=useState<File>();const [preview,setPreview]=useState('');const [error,setError]=useState('');const [busy,setBusy]=useState(false);const [drag,setDrag]=useState(false);
 const operation=useRef<{key:string;uploadId?:string;stored?:boolean;ready?:boolean}>({key:crypto.randomUUID()});
 useEffect(()=>{if(!file){setPreview('');return;}const url=URL.createObjectURL(file);setPreview(url);return()=>URL.revokeObjectURL(url)},[file]);
 async function choose(next?:File){
  if(!next)return;setError('');
  if(!['image/jpeg','image/png','image/webp'].includes(next.type)){setError('JPG, PNG, WEBP 사진 한 장을 선택해 주세요.');return;}
  if(!next.size||next.size>10_000_000){setError('사진은 최대 10MB까지 올릴 수 있어요.');return;}
  try{const decoded=await createImageBitmap(next);const pixels=decoded.width*decoded.height;decoded.close();if(pixels>24_000_000){setError('사진 해상도는 최대 2,400만 화소까지 지원해요.');return;}}catch{setError('사진을 읽을 수 없어요. 다른 사진을 선택해 주세요.');return;}
  if(operation.current.uploadId)void request(`/uploads/${operation.current.uploadId}`,{method:'DELETE'}).catch(()=>{});
  operation.current={key:crypto.randomUUID()};setFile(next);
 }
 async function start(){
  if(!file||busy)return;setBusy(true);setError('');
  try{
   const op=operation.current;
   if(!op.uploadId){const upload=await request<{uploadId:string}>('/uploads',{method:'POST',body:{schemaVersion:3,declaredMimeType:file.type,declaredBytes:file.size}});op.uploadId=upload.uploadId;}
   if(!op.stored){await request(`/uploads/${op.uploadId}/content`,{method:'PUT',body:file});op.stored=true;}
   if(!op.ready){await request(`/uploads/${op.uploadId}/finalize`,{method:'POST',body:{schemaVersion:3}});op.ready=true;}
   const run=await request<SearchState>('/searches',{method:'POST',key:op.key,body:{schemaVersion:3,uploadId:op.uploadId,resultLimit:10}});
   nav(`/search/${run.searchId}`);
  }catch(e){setError(errorMessage(e));}finally{setBusy(false);}
 }
 function clear(){if(operation.current.uploadId)void request(`/uploads/${operation.current.uploadId}`,{method:'DELETE'}).catch(()=>{});operation.current={key:crypto.randomUUID()};setFile(undefined);setError('');if(input.current)input.current.value='';}
 return <div className={`upload-wrap ${drag?'dragging':''}`} onDragOver={e=>{e.preventDefault();if(!busy)setDrag(true)}} onDragLeave={()=>setDrag(false)} onDrop={e=>{e.preventDefault();setDrag(false);if(!busy){if(e.dataTransfer.files.length!==1)setError('의류 사진 한 장만 선택해 주세요.');else void choose(e.dataTransfer.files[0]);}}}>
  <div className="upload-panel">
   <input ref={input} id="clothes-photo" className="sr-only" type="file" accept="image/jpeg,image/png,image/webp" disabled={busy} onChange={e=>void choose(e.target.files?.[0])} aria-label="의류 사진 업로드" aria-describedby="upload-help upload-error" />
   {file?<>{preview&&<img className="upload-preview" src={preview} alt="선택한 의류 사진 미리보기"/>}<h2>이 옷과 비슷한 상품을 찾아볼까요?</h2><p className="upload-description">사진과 충분히 닮은 국내 새상품의 가격을 비교해요.</p><div className="file-actions"><button disabled={busy} onClick={()=>input.current?.click()}><RefreshCw/> 사진 교체</button><button disabled={busy} onClick={clear}><X/> 삭제</button></div><button className="upload-cta" disabled={busy} onClick={()=>void start()}>{busy?<LoaderCircle className="spin"/>:<Search/>}<span>{busy?'사진을 준비하고 있어요.':'비슷한 옷 찾기'}</span><ArrowRight/></button></>:
   <><img className="upload-icon" src="/artwork/image-add.png" alt=""/><h2>찾고 싶은 옷 사진을 올려주세요</h2><p className="upload-description">옷 한 장만 올리면, 같은 스타일의 더 저렴한 상품을 찾아드려요.</p><button className="upload-cta" onClick={()=>input.current?.click()}><Upload/><span>사진 올리기</span><ArrowRight/></button></>}
   <p id="upload-help" className="upload-help">JPG, PNG, WEBP (최대 10MB)</p><p id="upload-error" className="upload-error" role="alert">{error}</p>
  </div>
 </div>
}

function DealSearch(){const [query,setQuery]=useState('');const [category,setCategory]=useState<'FASHION'|'LIVING'|'ALL'>('FASHION');const [error,setError]=useState('');const [busy,setBusy]=useState(false);const key=useRef(crypto.randomUUID());const nav=useNavigate();
 async function submit(e:FormEvent){e.preventDefault();if(busy)return;if(query.trim().length<2){setError('찾고 싶은 상품을 두 글자 이상 입력해 주세요.');return;}setBusy(true);setError('');try{const run=await request<SearchState>('/deals',{method:'POST',key:key.current,body:{schemaVersion:3,query:query.trim(),category,resultLimit:10}});nav(`/search/${run.searchId}`);}catch(e){setError(errorMessage(e));}finally{setBusy(false);}}
 return <section id="deals" className="deals"><div className="deal-copy"><div className="eyebrow"><span>///</span> HOT <b>DEAL</b></div><h2>사진 없이 <em>핫딜</em>부터 찾아볼까?</h2><p>지금 인기 있는 의류와 생활용품의 핫딜을 바로 검색해보세요.</p></div><form onSubmit={e=>void submit(e)} className="deal-form"><div className="search-field"><Search/><label htmlFor="deal-query" className="sr-only">핫딜 상품 검색</label><input id="deal-query" maxLength={200} value={query} placeholder="맨투맨, 패딩, 청바지, 운동화, 세탁세제 등 무엇이든 검색해보세요." onChange={e=>{setQuery(e.target.value);key.current=crypto.randomUUID();}}/><button type="submit" disabled={busy}>{busy?<LoaderCircle className="spin"/>:'검색하기'}</button></div><div className="deal-filters" aria-label="검색 범위"><button type="button" aria-pressed={category==='FASHION'} onClick={()=>{setCategory('FASHION');key.current=crypto.randomUUID()}}><Shirt/> 의류</button><button type="button" aria-pressed={category==='LIVING'} onClick={()=>{setCategory('LIVING');key.current=crypto.randomUUID()}}><ShoppingBag/> 생활용품</button><button type="button" aria-pressed={category==='ALL'} onClick={()=>{setCategory('ALL');key.current=crypto.randomUUID()}}><Truck/> 국내 새 상품</button></div><p role="alert" className="deal-error">{error}</p></form><img className="deal-collage" src="/artwork/deal-collage.png" alt=""/></section>
}

function Home(){return <><Header/><main className="home"><section className="hero"><div className="hero-edge"/><div className="hero-content"><h1><img className="hero-logo" src="/artwork/hero-logo.png" alt="싼데비슷한"/></h1><p className="headline"><span>사진만 올려.</span> <strong>가격은 우리가 찾을게.</strong></p><p className="subhead">마음에 든 그 옷, 비슷한데 더 저렴한 것까지.</p><UploadPanel/><div className="steps"><div><Shirt/><p>사진 속 상품을<br/>AI가 분석해요</p></div><div><Search/><p>같은 스타일의<br/>더 저렴한 상품을 찾아요</p></div><div><ShoppingBag/><p>국내에서 구매 가능한<br/>새 상품만 모아드려요</p></div></div></div><img className="hero-collage" src="/artwork/hero-collage.png" alt=""/></section><DealSearch/></main></>}

const won=(n:number)=>`${new Intl.NumberFormat('ko-KR').format(n)}원`;
function Product({item}: {item:Result}){const [broken,setBroken]=useState(false);return <article className="product"><div className="product-image">{broken?<div className="image-unavailable"><ImagePlus/><span>판매처 이미지를 불러오지 못했어요</span></div>:<img src={item.imageUrl} alt={item.title} loading="lazy" referrerPolicy="no-referrer" onError={()=>setBroken(true)}/>}</div><div className="product-body"><p className="merchant">{item.merchant}</p><h3>{item.title}</h3><p className="price">{won(item.priceBasis==='TOTAL_PRICE'?item.effectivePrice!:item.itemPrice)}</p><p className="price-basis">{item.priceBasis==='TOTAL_PRICE'?`배송비 ${item.shippingFee===0?'무료':won(item.shippingFee!)} 포함`:'배송비 미확인 · 상품가 기준'}</p>{item.matchedAttributes.length>0&&<p className="match-reasons"><Check/>{item.matchedAttributes.join(' · ')}</p>}{item.differentAttributes.length>0&&<p className="difference">다른 점: {item.differentAttributes.join(' · ')}</p>}{item.warnings.filter(w=>w.code!=="SHIPPING_UNKNOWN").map(w=><p className="product-warning" key={w.code}>{w.message}</p>)}<a className="purchase" href={item.productUrl} target="_blank" rel="noopener noreferrer">{item.merchant}에서 보기 <ExternalLink/></a><details><summary>옵션·가격 근거 확인</summary><p>{[item.variant.color,item.variant.size].filter(Boolean).join(' / ')||'판매처에서 옵션을 확인해 주세요.'}</p>{item.variant.selectionRequired&&<p>구매 전 옵션 선택이 필요해요.</p>}{item.unknownAttributes.length>0&&<p>확인되지 않은 특징: {item.unknownAttributes.join(" · ")}</p>}<p>출처: {item.source}</p><p>확인 시각: {new Date(item.priceObservedAt).toLocaleString('ko-KR')}</p><p>판매처에서 가격과 재고가 변경될 수 있어요.</p>{item.conditionalPrices.length>0&&<p>조건부 혜택은 위 가격에 반영하지 않았어요.</p>}{item.unknownAttributes.length>0&&<p>확인하지 못한 점: {item.unknownAttributes.join(' · ')}</p>}</details></div></article>}

function SearchPage(){const {id}=useParams();const [sort,setSort]=useState<Sort>('RECOMMENDED');const [actionError,setActionError]=useState('');const nav=useNavigate();
 const state=useQuery({queryKey:['search',id],queryFn:()=>request<SearchState>(`/searches/${id}`),refetchInterval:q=>{const run=q.state.data;if(!active(run))return false;const age=run?Math.max(0,Date.now()-Date.parse(run.createdAt)):0;return Math.min(5000,Math.max(2000,Math.max(run?.pollAfterMs??2000,2000+age/10)*(0.9+Math.random()*.2)))},refetchIntervalInBackground:false,retry:1});
 const results=useQuery({queryKey:['results',id,sort],queryFn:()=>request<Results>(`/searches/${id}/results?sort=${sort}`),enabled:!!state.data&&!active(state.data),retry:1});
 async function cancel(){try{await request(`/searches/${id}/cancel`,{method:'POST',body:{schemaVersion:3}});await state.refetch();}catch(e){setActionError(errorMessage(e))}}
 async function remove(){try{await request(`/searches/${id}`,{method:'DELETE'});nav('/')}catch(e){setActionError(errorMessage(e))}}
 const status=state.data?.status;const inProgress=active(state.data);const data=results.data;
 const messages:Partial<Record<NonNullable<typeof status>,[string,string]>>={NO_RELIABLE_MATCH:['충분히 비슷한 상품을 찾지 못했어요.','사진이 선명하고 한 가지 옷이 잘 보이면 더 좋아요.'],FAILED:['검색을 완료하지 못했어요.',state.data?.failure?.message??'잠시 후 새 검색을 시도해 주세요.'],EXPIRED:['검색 시간이 초과되었어요.','확인되지 않은 상품은 결과에 넣지 않았어요.'],CANCELED:['검색을 취소했어요.','다른 사진으로 다시 찾아볼 수 있어요.']};
 return <><Header/><main className="result-page"><Link className="back" to="/"><ArrowLeft/> 다른 사진으로 찾기</Link><div className="result-heading"><p className="eyebrow">SSANDEVISTHAN / {state.data?.mode==='DEAL_TEXT'?'DEAL':'SIMILAR'}</p><h1>{inProgress?'비슷한 건 찾고, 가격은 낮추고.':'비슷한 상품, 확인된 가격.'}</h1></div>
 {state.isPending&&<div className="status-box" role="status"><LoaderCircle className="spin"/>검색 상태를 확인하고 있어요.</div>}
 {state.error&&<div className="status-box" role="alert"><p>{errorMessage(state.error)}</p><button onClick={()=>void state.refetch()}>다시 확인</button></div>}
 {inProgress&&<div className="status-box" role="status" aria-live="polite"><LoaderCircle className="spin"/><h2>{state.data?.stage?stageLabel[state.data.stage]:'검색을 준비하고 있어요.'}</h2><button className="outline-button" onClick={()=>void cancel()}>검색 취소</button></div>}
 {status&&messages[status]&&<div className="status-box"><h2>{messages[status]![0]}</h2><p>{messages[status]![1]}</p><Link className="yellow-button" to="/">다른 사진 올리기 <Upload/></Link></div>}
 {data?.status==='PARTIAL'&&<div className="result-notice">일부 판매처를 확인하지 못했어요. 검증된 상품만 보여드려요.</div>}
 {results.error&&<div role="alert" className="result-notice">{errorMessage(results.error)} <button onClick={()=>void results.refetch()}>결과 다시 확인</button></div>}
 {!!data?.results.length&&<><div className="result-toolbar"><p>검증된 상품 <b>{data.results.length}</b>개</p><label>정렬 <select value={sort} onChange={e=>setSort(e.target.value as Sort)}><option value="RECOMMENDED">추천순</option>{data.mode==='IMAGE_SIMILAR'&&<option value="MOST_SIMILAR">더 비슷한 순</option>}<option value="LOWEST_PRICE">낮은 가격순</option></select></label></div>{sort==='MOST_SIMILAR'?<section className="cohort"><h2>더 비슷한 순</h2><p>각 상품에 표시된 배송비 확인 여부를 함께 살펴보세요.</p><div className="product-grid">{data.results.map(item=><Product key={item.offerId} item={item}/>)}</div></section>:(['TOTAL_PRICE','ITEM_PRICE_ONLY'] as const).map(cohort=>{const items=data.results.filter(r=>r.priceBasis===cohort);return items.length?<section className="cohort" key={cohort}><h2>{cohort==='TOTAL_PRICE'?'배송비 포함 확인':'배송비 미확인'}</h2><p>{cohort==='TOTAL_PRICE'?'상품가와 배송비를 합친 가격으로 비교해요.':'배송비를 확인하지 못해 상품가끼리 비교해요.'}</p><div className="product-grid">{items.map(item=><Product key={item.offerId} item={item}/>)}</div></section>:null})}</>}
 {data?.warnings.map(w=><p className="result-notice" key={w.code}>{w.message}</p>)}
 {!!data?.references.length&&<details className="references"><summary>가격을 확인하지 못한 참고 상품 {data.references.length}개</summary><p>구매 추천·가격 순위에 포함하지 않았어요.</p>{data.references.map(r=><a key={r.productId} href={r.productUrl} target="_blank" rel="noopener noreferrer">{r.title} — {r.merchant} <ExternalLink/></a>)}</details>}
 {state.data&&!inProgress&&<button className="delete-search" onClick={()=>void remove()}>이 검색과 사진 삭제</button>}<p role="alert">{actionError}</p><details className="privacy-note"><summary>사진과 검색 기록 보관 안내</summary><p>사진은 처리 후 5분 이내, 최대 1시간 이내 삭제하고 검색 기록은 7일간 보관해요. 브라우저 저장소를 지우면 익명 세션의 검색 기록에 다시 접근할 수 없어요.</p></details>
 </main></>}
export default function App(){return <Routes><Route path="/" element={<Home/>}/><Route path="/search/:id" element={<SearchPage/>}/><Route path="*" element={<><Header/><main className="status-box"><h1>페이지를 찾을 수 없어요.</h1><Link to="/">홈으로 돌아가기</Link></main></>}/></Routes>}
