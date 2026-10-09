# Font provenance and notices

Verified 2026-10-09. The fonts are functional text replacements selected in the design contract; they are not claimed to be the unknown original PNG typography. Logos remain original image assets.

## Gmarket Sans Bold

- Official information: https://corp.gmarket.com/fonts/
- Official distribution: https://corp.gmarket.com/fonts/GmarketSansTTF.zip
- Distributed file: `GmarketSansTTFBold.ttf`; copied without modification as `apps/web/public/fonts/GmarketSansBold.ttf`.
- File SHA-256: `ff7c354dd1a324e4cecc1223c4f71e74fa81be7027e0c7f6324c475909cacefc`.
- Font metadata version: `Version 1.000;hotconv 1.0.109;makeotfexe 2.5.65596`.
- Embedded copyright: `Copyright © 2019 eBay Korea Co., Ltd. All rights reserved.`
- The official website states commercial and noncommercial usage under SIL Open Font License. The archive has no standalone license file, so `scripts/verify-assets.mjs` extracts the exact English and Korean license records from the official TTF SFNT name table (name ID 13).
- `GmarketSans-OFL.txt` preserves those records, including the vendor's sixth condition concerning promotion; it is not replaced with a generic OFL template. `GmarketSans-metadata.json` records copyright, family, version, license and vendor URL directly from the unmodified font.

## Pretendard Variable

- Official tagged release: https://github.com/orioncactus/pretendard/releases/tag/v1.3.9
- Official versioned license: https://raw.githubusercontent.com/orioncactus/pretendard/v1.3.9/LICENSE
- File: `apps/web/public/fonts/PretendardVariable.woff2`.
- File SHA-256: `9599f12fd42fc0bce1cd50b47a0c022e108d7aa64dd0d1bb0ed44f3282d900b4`.
- `Pretendard-OFL.txt` is the unabridged official versioned license, downloaded directly on the verification date. It contains the copyright of Kil Hyung-jin and the reserved font name Pretendard.

Run `node scripts/verify-assets.mjs` to verify the original artwork, all crop pixels, both font hashes, and license notice presence. This check does not imply screenshot approval or LIVE service verification.
