# Licensing

Status: covers every source in use, last updated 2026-11-13. Each verdict answers three questions: may an app redistribute the text, what attribution it needs, and whether the raw files may be committed here. Every text below is downloaded by `bun run ingest:download` and gitignored, so "commit raw files" only matters for test fixtures.

The ebible.org catalog with its `Redistributable` and `Copyright` columns is [translations.csv][catalog]. Each zip carries a `copr.htm`, which is the same page as the edition's `copyright.htm` linked below.

## Verdicts

| Source | Text license | Redistribute in an app | Attribution | Commit raw files | Used |
|---|---|---|---|---|---|
| KJV + Apocrypha, ebible `eng-kjv` | Public domain, Crown letters patent in the UK ([copyright.htm][kjv]) | Yes. Printing in or importing printed copies into the UK needs permission. Apps are not printing | None required | Yes | Yes, pinned in step 1 |
| BSB, ebible `engbsb` | Public domain since 2023-04-30 ([berean.bible licensing][bsb]) | Yes | None required | Yes | Yes, pinned in step 1 |
| World English Bible Classic with deuterocanon, ebible `eng-web` | Public domain, "World English Bible" is a trademark ([copyright.htm][web]) | Yes. A changed text must not be called "World English Bible" | None required | Yes | Yes |
| Westminster Leningrad Codex with OSHB morphology, upstream [openscriptures/morphhb][oshb-readme] at commit `3d15126` | WLC text, qere text included, public domain. OSHB lemma, morphology and word ids CC BY 4.0 ([morphhb LICENSE][oshb-license], [README][oshb-readme]) | Yes for the text. Since plan step 11 the converter (`src/ingest/oshb-xml.ts`) keeps each word's id, lemma and morphology in `original_word`, and the qere words' ids in `reading.ow_ids` (ADR-0007), credited in the `oshb` row of `data_source` | Text: none. OSHB ids and morphology: "Original work of the Open Scriptures Hebrew Bible available at https://github.com/openscriptures/morphhb", CC BY 4.0 | Yes for the text. The ids with the OSHB credit | Yes, since 2026-11-10 |
| Westminster Leningrad Codex, ebible `hboWLC` | As upstream. ebible's page still says CC BY-SA 3.0 ([copyright.htm][wlc]) | Yes for the text | As upstream | Yes | No. It dropped every qere and leaked markup into 10 verses (research/hebrew-ketiv-qere.md) |
| SBL Greek New Testament, upstream [LogosBible/SBLGNT][sbl] at commit `d7f35ad` | CC BY 4.0, © 2010 Society of Biblical Literature and Logos Bible Software ([SBLGNT README][sbl], [LICENSE][sbl-license]) | Yes, with attribution | "SBL Greek New Testament, © 2010 Society of Biblical Literature and Logos Bible Software, CC BY 4.0", and a note that the text was changed if it was | Yes, with the attribution next to them | Yes, since 2026-11-09. Converted from XML to USFM (`src/ingest/sblgnt-xml.ts`), words and punctuation unchanged |
| SBL Greek New Testament, ebible `grcsbl` | Same as upstream ([copyright.htm][sbl-ebible]) | Yes, with attribution | As upstream | Yes | No. Its text is damaged, see the notes |
| Robinson-Pierpont 2018 Byzantine text, ebible `grcmt` | Public domain ([copyright.htm][rp]) | Yes | None required | Yes | Yes |
| 1904 Patriarchal text, ebible `grcbyz` | Public domain ([copyright.htm][byz]) | Yes | None required | Yes | No. It fits no scheme (extra JHN 1:52, ACT 19:41, REV 15:9), and RP 2018 already covers the Byzantine placements |
| Brenton's Greek Septuagint with Apocrypha, ebible `grcbrent` | Public domain ([copyright.htm][brenton]) | Yes | None required | Yes | Yes |
| Septuaginta, ebible `grclxx` (Orthodox Media Network) | Labelled "Public Domain ℗ Orthodox Media Network", but the page asks anyone who shares it to "publish the present text" ([copyright.htm][grclxx]) | Unclear. The condition contradicts the public-domain label | The page's text, if used | No | No. Brenton covers the Septuagint without the condition |
| Rahlfs-Hanhart Septuaginta | © Deutsche Bibelgesellschaft | No | n/a | No | No |
| Douay-Rheims 1899, ebible `engDRA` | Public domain | Yes | None required | Yes | No. WEB covers the deuterocanon and fits `eng` more closely |
| MACULA Hebrew, [Clear-Bible/macula-hebrew][macula-heb] at commit `47db250`, `WLC/tsv/macula-hebrew.tsv` | CC BY 4.0, © 2022-2024 Biblica, Inc. ([LICENSE.md][macula-heb-license]). The glosses in its `gloss` and `english` columns are Cherith Glosses for the Hebrew Old Testament, CC BY 4.0. Its SDBH domains are "used with permission" of the United Bible Societies, not CC BY | Yes for the glosses, with attribution. Not the SDBH columns, which the ingest never reads | `MACULA_HEBREW.attribution` in `src/ingest/sources.ts` | No. Downloaded by `ingest:download`, pinned by sha256 | Yes, since 2026-11-13: glosses of the WLC words (plan step 11) |
| MACULA Greek, [Clear-Bible/macula-greek][macula-grc] at commit `8423afe`, `SBLGNT/tsv/macula-greek-SBLGNT.tsv` | CC BY 4.0, © 2022-2024 Biblica, Inc. ([LICENSE.md][macula-grc-license]). Its `gloss` column is the Berean Interlinear Bible's, public domain since 2023-04-30 ([terms][berean-terms]), and its `english` column Cherith's glosses, CC BY 4.0. Its Louw-Nida domains (UBS MARBLE) are "used with permission", not CC BY. Its text is SBLGNT, CC BY 4.0 | Yes for word ids, lemmas, Strong's numbers, morphology and glosses, with attribution. Not the `domain` and `ln` columns, which the ingest never reads | `MACULA_GREEK.attribution` in `src/ingest/sources.ts` | No. Downloaded by `ingest:download`, pinned by sha256 | Yes, since 2026-11-13: the SBLGNT words' ids, Strong's numbers, lemmas, morphology and glosses (plan step 11) |
| Clear Bible Alignments, [Clear-Bible/Alignments][clear-align] at commit `c99bd0a`: `SBLGNT-BSB-manual.json`, `WLCM-BSB-manual.json` and the BSB target tables `nt_BSB.tsv`, `ot_BSB.tsv` | CC BY 4.0, © 2022 Clear Bible, Inc. ([LICENSE.md][clear-align-license]). The BSB words in the target tables are public domain | Yes, with attribution | `CLEAR_BSB_ATTRIBUTION` in `src/ingest/sources.ts` | No. Downloaded by `ingest:download`, pinned by sha256 | Yes, since 2026-11-13: which original words each BSB word translates (plan step 12, research/word-tags.md) |
| The KJV's `strong=` tags in ebible `eng-kjv` | Public domain, as the text ([copyright.htm][kjv]) | Yes | None required | Yes | Yes, the tags that pass the test against the step 11 words (research/word-tags.md, plan step 12) |
| The BSB's `strong=` tags in ebible `engbsb` | Public domain, as the text | Yes | None required | Yes | No. The numbers are shifted (research/word-tags.md) |
| STEPBible TVTMS | CC BY 4.0, raw file not to be re-posted (`src/ingest/sources.ts`) | Compiled rows yes, with attribution | `TVTMS.attribution` in sources.ts | No | Yes, pinned in step 2 |
| libpalaso `.vrs` files | MIT (`src/ingest/vrs/libpalaso/LICENSE`) | Yes | MIT notice | Yes, committed | Yes, pinned in step 2 |

## Notes

- The SBLGNT ends Romans at 16:24 and keeps the doxology (16:25-27) only in a footnote. Upstream does the same ([Rom.txt][sbl-rom]), so this is the edition's text, not a conversion error.
- An earlier version of this file said the ebible SBLGNT differs from upstream only in the `‘p /’ ‘/book’` text after each book's last verse. That was wrong. Compared verse by verse with upstream's `data/sblgnt/text` at commit `d7f35ad` (2026-11-09), ebible's copy differs in 2,299 of 7,939 verses. Where ebible turned an apparatus mark into a footnote, it cut into words in 29 verses (HEB 7:4 `εωρεῖτε` for `Θεωρεῖτε`, EPH 4:7 `ἡ … ῶν` for `ἡμῶν`, which also adds a word), and dropped about 1,670 closing `⸃` signs and about 1,000 punctuation marks in 2,270 more. MRK 16:9 lost its opening `⟦`. The ingest therefore reads upstream's XML. The conversion only changes markup, and `sblgnt-xml.test.ts` checks every verse against upstream's plain-text edition. An app that ships it should still say it was converted (CC BY 4.0, section 3(a)(1)(B)).
- The ebible WEB has two places where a footnote stands between two words with no space on either side (2ES 7:36 `hell\f …\f*will`, 2ES 12:32 `will\f …\f*heap`), so the words ran together. The ingest adds the space with two counted text fixes. That changes whitespace only, not a word, which we read as outside WEB's "if you CHANGE the actual text" condition ([copyright.htm][web]). Report both to ebible.org, which asks for typo reports.
- OSHB data needs attribution. Since plan step 11 the corpus holds each word's OSHB id, lemma and morphology (`original_word`), so an app that shows them carries the OSHB credit.
- For the Hebrew glosses, MACULA Hebrew was chosen over STEPBible TAHOT because both are CC BY 4.0 and MACULA's words join to OSHB's through the read text in every verse (`src/ingest/original-words.ts`). For the Greek, MACULA Greek ships an SBLGNT edition whose words are ours, one for one, in all 7,939 verses. TAGNT was not needed.

[catalog]: https://ebible.org/Scriptures/translations.csv
[kjv]: https://ebible.org/eng-kjv/copyright.htm
[bsb]: https://berean.bible/licensing.htm
[web]: https://ebible.org/eng-web/copyright.htm
[wlc]: https://ebible.org/hboWLC/copyright.htm
[oshb-license]: https://github.com/openscriptures/morphhb/blob/3d15126fb1ef74867fc1434be1942e837932691f/LICENSE.md
[oshb-readme]: https://github.com/openscriptures/morphhb/blob/3d15126fb1ef74867fc1434be1942e837932691f/README.md
[sbl]: https://github.com/LogosBible/SBLGNT/blob/master/README.md
[sbl-rom]: https://github.com/LogosBible/SBLGNT/blob/d7f35adca9ec410e1d1499c63b4dd989d76c8d4d/data/sblgnt/text/Rom.txt
[sbl-license]: https://github.com/LogosBible/SBLGNT/blob/d7f35adca9ec410e1d1499c63b4dd989d76c8d4d/LICENSE
[sbl-ebible]: https://ebible.org/grcsbl/copyright.htm
[rp]: https://ebible.org/grcmt/copyright.htm
[byz]: https://ebible.org/grcbyz/copyright.htm
[brenton]: https://ebible.org/grcbrent/copyright.htm
[grclxx]: https://ebible.org/grclxx/copyright.htm
[macula-heb]: https://github.com/Clear-Bible/macula-hebrew/tree/47db250bd55d0d8577f2a94fba114ef16c35b23c
[macula-heb-license]: https://github.com/Clear-Bible/macula-hebrew/blob/47db250bd55d0d8577f2a94fba114ef16c35b23c/LICENSE.md
[macula-grc]: https://github.com/Clear-Bible/macula-greek/tree/8423afe47b9e8f24b7772e808af45c7159a6fe7e
[macula-grc-license]: https://github.com/Clear-Bible/macula-greek/blob/8423afe47b9e8f24b7772e808af45c7159a6fe7e/LICENSE.md
[berean-terms]: https://berean.bible/terms.htm
[clear-align]: https://github.com/Clear-Bible/Alignments/tree/c99bd0ae6946775f932517656308ca19fc706921
[clear-align-license]: https://github.com/Clear-Bible/Alignments/blob/c99bd0ae6946775f932517656308ca19fc706921/LICENSE.md

## Libraries an app ships

Status: checked 2026-11-10 for plan step 9.

| Library | License | Ship in an app | Attribution | Used |
|---|---|---|---|---|
| [bible-passage-reference-parser][bpr] 4.0.0 (npm), by Stephen Smith / OpenBible.info | MIT, "Copyright (c) 2011-2026 Stephen Smith" (`LICENSE.md` in the npm tarball, and the README's License section) | Yes | Keep the MIT notice in the shipped bundle's third-party notices | Yes, English only (`esm/lang/en.js`), in `src/contract/reference.ts` |
| [fflate][fflate] 0.8.2 (npm), by Arjun Barrett | MIT, "Copyright (c) 2023 Arjun Barrett" (`LICENSE` in the npm package) | Yes | Keep the MIT notice in the shipped bundle's third-party notices | Yes, to deflate chapter documents in a pack (`src/pack/pack.ts`) and inflate them on read (`src/db/corpus-read.ts`) |

The parser's book names and abbreviations are its own data, under the same MIT license. Its verse counts are not used: `passage` checks every verse against the edition's scheme.

[bpr]: https://github.com/openbibleinfo/Bible-Passage-Reference-Parser
[fflate]: https://github.com/101arrowz/fflate

## Closed-license translations

Status: researched 2026-11-10 from publisher pages. These texts are fetched under a license and never committed. The API.Bible clauses were read twice. The rest was read once and needs a second check before a decision rests on it.

| Translation | Route for a free app from a registered organization | Limit that shapes the design |
|---|---|---|
| NASB 1995, NASB 2020, AMP | API.Bible standard license. YouVersion Platform lists them (listing not rechecked). A direct Lockman license for files | Without a license, at most 1,000 verses, quoted or stored in an electronic retrieval system, as long as they aren't a whole book and are at most 50% of the work they appear in ([Lockman][lockman], checked 2026-11-10) |
| NLT, The Message | API.Bible. Tyndale's permissions page sends app makers there (read from a Tyndale-hosted mirror) | Exact text, punctuation and capitalization included |
| NIV | Biblica express license through API.Bible or YouVersion | Non-commercial, no AI features in the app, no unrestricted download (from search excerpts, Biblica's site refused the fetch) |
| ESV | Crossway's API, or an organization license | At most 500 stored verses or half a book ([ESV API][esv]) |
| CSB, NKJV | API.Bible | API.Bible terms |

API.Bible [terms][ab-terms], updated 2026-09-03:

- Section 4.1: no change to "any part of the structure or content".
- Section 11: content stored offline is checked for updates at least every 30 days.
- Section 12: DRM, and no printing of more than 100 verses.
- Section 10.2: content removed within 72 hours of termination.
- Section 9.2: no AI training without written consent from API.Bible and the publisher.
- Section 3.3: web apps report usage through FUMS.

API.Bible plans ([Express Licensing FAQs][ab-express], updated 2026-10-01, and the [developer FAQ][ab-faq]): Starter is free, non-commercial, three copyrighted Bibles and 5,000 calls a month. Pro for a non-commercial app is $29 a month, all eligible copyrighted Bibles and 150,000 calls a month.

The attribution in each licensed edition's rights record (`src/contract/rights.ts`) is the `copyright` field API.Bible returned with NASB 1995 John 3, NLT Numbers 1 and NIV John 3 on 2026-11-13, word for word. API.Bible sends it with every chapter, so an app can also show the field it received.

Open questions:

- Whether a whole licensed Bible may be stored on a device. The terms allow offline storage with a 30-day refresh, the Express FAQ says "Caching is allowed and recommended", and the developer FAQ asks for "fewer than 500 consecutive verses". Ask API.Bible in writing.
- Whether API.Bible delivers Strong's numbers for NASB. Lockman licenses a Strong's-keyed NASB to Bible software such as Blue Letter Bible.
- What file format a direct Lockman or Digital Bible Library license delivers.

[lockman]: https://www.lockman.org/permission-to-quote-copyright-trademark-information/
[esv]: https://api.esv.org/
[ab-terms]: https://api.bible/terms-and-conditions
[ab-express]: https://care.api.bible/article/405-express-licensing-faqs
[ab-faq]: https://docs.api.bible/common-questions/
