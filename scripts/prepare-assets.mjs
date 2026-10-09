import sharp from 'sharp';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
const source='design/reference/original.png';
const bytes=await readFile(source);
const hash=x=>createHash('sha256').update(x).digest('hex');
if(hash(bytes)!=='531162d78410f8a01a408d12955d0ab10d3c11d4add6e645a127bc5096ccc3ab')throw Error('Original artwork hash mismatch');
await mkdir('apps/web/public/artwork',{recursive:true});
// Lossless crops only, explicitly required by the design contract. Never regenerate artwork.
const crops={
  'header-logo': [37,7,172,39],
  'hero-logo': [40,85,776,205],
  'hero-collage': [760,55,826,766],
  'hero-left-edge':[0,55,55,766],
  'yellow-texture':[135,414,100,95],
  'deal-collage':[1104,821,482,171],
  'deal-texture':[0,821,510,42],
  'image-add':[365,438,80,70],
  'step-shirt':[62,735,53,54],
  'step-search':[290,735,51,54],
  'step-bag':[553,735,51,54],
};
const manifest={designVersion:'mockup-v1',source:{path:source,sha256:hash(bytes),width:1586,height:992,notion:'https://app.notion.com/p/3f47cdef782d8145b2a8ee2543d43d7c'},assets:[],fonts:[],logoDecision:'Preserve original PNG crops; uploaded larger logos remain unapproved restoration candidates.'};
for(const [name,[left,top,width,height]] of Object.entries(crops)){
 const png=await sharp(bytes).extract({left,top,width,height}).png().toBuffer();
 const path=`apps/web/public/artwork/${name}.png`; await writeFile(path,png);
 manifest.assets.push({path,sourceRect:{left,top,width,height},sha256:hash(png),transform:'lossless crop'});
}
// Clear mutable upload copy and controls for accessible DOM replacement.
// Static captions, step illustrations and typography remain original pixels.
const cutouts=[[202,459,427,77],[182,542,450,70],[289,613,250,25]];
const mask=Buffer.from(`<svg width="1586" height="766">${cutouts.map(([x,y,w,h])=>`<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="white"/>`).join('')}</svg>`);
const surface=await sharp(bytes).extract({left:0,top:55,width:1586,height:766}).ensureAlpha().composite([{input:mask,blend:'dest-out'}]).png().toBuffer();
await writeFile('apps/web/public/artwork/hero-surface.png',surface);
manifest.assets.push({path:'apps/web/public/artwork/hero-surface.png',sourceRect:{left:0,top:55,width:1586,height:766},sha256:hash(surface),transform:'original pixels; functional regions cleared for DOM text',cutouts});
// Preserve the header and lower industrial texture around the real navigation/search controls.
for(const [name,top,height,cutouts] of [
 ['header-surface',0,55,[[1277,10,274,39]]],
 ['deal-surface',821,171,[[515,24,590,116]]],
]){
 const mask=Buffer.from(`<svg width="1586" height="${height}">${cutouts.map(([x,y,w,h])=>`<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="white"/>`).join('')}</svg>`);
 const png=await sharp(bytes).extract({left:0,top,width:1586,height}).ensureAlpha().composite([{input:mask,blend:'dest-out'}]).png().toBuffer();
 const path=`apps/web/public/artwork/${name}.png`;await writeFile(path,png);
 manifest.assets.push({path,sourceRect:{left:0,top,width:1586,height},sha256:hash(png),transform:'original pixels; functional regions cleared for DOM text',cutouts});
}
// Reuse clean adjacent yellow texture behind actual UI text; never synthesize artwork.
const fills=[
 ['subhead-fill',[50,388,707,12],707,44],
 ['upload-copy-fill',[202,509,427,8],427,77],
 ['upload-control-fill',[182,587,450,10],450,70],
 ['upload-help-fill',[289,697,250,10],250,25],
 ['steps-fill',[59,799,698,16],698,68],
];
for(const [name,[left,top,width,height],w,h] of fills){
 const png=await sharp(bytes).extract({left,top,width,height}).resize(w,h,{fit:'fill'}).png().toBuffer();
 const path=`apps/web/public/artwork/${name}.png`;await writeFile(path,png);
 manifest.assets.push({path,sourceRect:{left,top,width,height},sha256:hash(png),transform:'adjacent original texture resized for accessible UI text backdrop'});
}
for(const [name,url,version,license] of [
 ['PretendardVariable.woff2','https://github.com/orioncactus/pretendard/releases/tag/v1.3.9','1.3.9','design/font-license/Pretendard-OFL.txt'],
 ['GmarketSansBold.ttf','https://corp.gmarket.com/fonts/GmarketSansTTF.zip','official distribution downloaded 2026-10-09','design/font-license/GmarketSans-OFL.txt']]){
 const path=`apps/web/public/fonts/${name}`;manifest.fonts.push({path,source:url,version,license,sha256:hash(await readFile(path))});
}
await writeFile('design/asset-manifest.json',JSON.stringify(manifest,null,2)+'\n');
console.log(`Original hash verified; ${manifest.assets.length} source-derived assets and font manifest written.`);
