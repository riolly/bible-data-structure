# Versification schemes

Researched 2026-11-09 for ADR-0002, which left two things open: the exact address syntax and the mapping data to adopt. Findings come first. The recommendation is a separate section at the end.

Every claim links to the source that owns it. Where a link points at a large file without line anchors, the line number is given in the text. Anything marked *unverified* was not checked against a primary source.

## Sources read

| Source | What it is | Version read |
|---|---|---|
| Paratext `.vrs` files in [libpalaso][lp-res] | The six built-in Paratext schemes: `org`, `eng`, `lxx`, `vul`, `rso`, `rsc` | last changed 2017-05-03 (`f1f70e9`) |
| [libpalaso `Versification.cs`][lp-vers] and [`VerseRef.cs`][lp-ref] | The C# parser and reference type used by Paratext tooling | `b4f7a6d` |
| [ubsicap/versification_json][vj] | A JSON form of the `.vrs` format, with notes on data quality | 2020-03-11 |
| SWORD C++ library, [git.crosswire.org/main/sword][sw] | `include/canon_*.h` scheme and mapping data, `versificationmgr.cpp` | `a376e42`, 2026-11-01 |
| SWORD design notes [`bible-intermediate-v11n.md`][sw-pivot] and [`v11n-xml.md`][sw-xml] | A 2026 proposal for a synthetic mapping pivot, and the XML scheme format | same commit |
| [JSword][js] | The Java port, with mapping files in `.properties` form | `a2c51f3` |
| [STEPBible TVTMS][tvtms] | Tyndale House versification data and reversification rules | `5de0a47`, 2026-11-02, sha256 prefix `c42cdfec1ae82d3e` |
| [OSIS 2.1.1 user manual][osis-man] and [schema][osis-xsd] | The osisRef syntax | 2006 |
| [USFM Scripture Referencing Standard 1.0][srs] | The USFM committee's reference grammar | `4cdd83d`, 2026-08-31 |
| [Scripture Burrito schema][sb-scope] | Metadata format for scripture packages | `6ed32cc` |
| `build/corpus.db` in this repo | The 2026-11-09 KJV and BSB ingest, queried read-only | edition stamps in README.md |

SWORD moved from SVN to GitLab at git.crosswire.org in August 2026 ([announcement][sw-git]). The GitHub mirror `bibletime/crosswire-sword-mirror` is archived.

## 1. Which schemes exist

### Paratext and USFM

A Paratext scheme is a plain-text `.vrs` file. Its body is one line per book listing the last verse number of each chapter, for example `JOL 1:20 2:32 3:21` ([eng.vrs][lp-eng]). A second section holds mapping lines (section 2 below). Paratext ships six schemes, listed by the [`ScrVersType` enum][lp-vers-enum]:

| Code | Name in file header | What it follows |
|---|---|---|
| `org` | "Original" | BHS for the OT, UBS GNT for the NT ([org.vrs header][lp-org]). It is the hub that every other file maps onto. |
| `eng` | "English" | "most English (e.g. RSV) and Spanish Bibles (e.g. RVR)" ([eng.vrs header][lp-eng]) |
| `lxx` | "Septuagint" | Bibles that follow LXX numbering, mainly Orthodox ([lxx.vrs header][lp-lxx]) |
| `vul` | "Vulgate" | Catholic Bibles that follow the Vulgate. Built from the VUL83 and NVL98 Paratext projects ([vul.vrs header][lp-vul]) |
| `rso` | "Russian Orthodox" | Russian Synodal Bible, Orthodox edition ([rso.vrs][lp-rso]) |
| `rsc` | "Russian Protestant" | Russian Synodal Bible, Protestant edition ([rsc.vrs][lp-rsc]) |

A project can also carry its own custom `.vrs` that differs from one of these ([`ScrVersType.Unknown` comment][lp-vers-enum]). The ubsicap repo has an `ethiopian_custom.vrs` example ([versification_json][vj]).

**Paratext `eng` is not KJV numbering.** `eng.vrs` gives Revelation 12 eighteen verses and 3 John fifteen ([eng.vrs lines 89-91][lp-eng-nt]). SWORD's KJV gives Revelation 12 seventeen verses and 3 John fourteen ([canon.h][sw-canon-kjv]). None of the six Paratext schemes is KJV numbering.

### SWORD

A SWORD scheme is a C++ header with the book list, chapter counts and verse counts, plus an optional array of mapping rules. The library registers 18 schemes in [`versificationmgr.cpp` lines 70-87][sw-mgr-reg]:

KJV, Leningrad, MT, KJVA, NRSV, NRSVA, Synodal, SynodalProt, Vulg, German, Luther, Catholic, Catholic2, LXX, Orthodox, Calvin, DarbyFr, Segond.

Only six of them carry mapping rules in the C++ library: NRSV, Synodal, Vulg, Calvin, DarbyFr and Segond (same lines). MT, Leningrad and LXX have no C++ mappings, so the C++ library cannot translate between MT and KJV. JSword, the Java port, does ship an MT mapping ([MT.properties][js-mt]).

A module names its scheme in its `.conf` file with `Versification=`, and the default is `KJV` ([swmgr.cpp line 1008][sw-swmgr]). Since 2026 a module can also ship its own scheme as `v11n.xml` ([v11n-xml.md][sw-xml]).

"av11n" is not a scheme. It is CrossWire's name for its cross-versification mapping feature ([bible-intermediate-v11n.md lines 8-10][sw-pivot]). The scheme this repo calls av11n is SWORD's `KJV`.

### STEPBible TVTMS

TVTMS does not define schemes as fixed tables. It defines **traditions**: English (KJV numbering), Hebrew (MT), Latin (Vulgate) and Greek (LXX), plus extra columns for Bibles that fit none of them, such as Slavonic, Greek2, Bulgarian and SpanishRV ([TVTMS][tvtms] lines 83-84). Each rule carries **tests** run against a real Bible's text, such as `Jol.3:21=Last` or `Rev.12:17<Rev.13:1` (word count), to decide which tradition that Bible follows in that section (lines 106-127). One Bible can follow different traditions in different books.

The rules map each tradition onto a **Standard** numbering. The file says the English standard "is defined by the NRSV which is virtually the same as KJV" (line 109), but the expanded data uses KJV verse numbers with subverses for the NRSV splits. For example, NRSV Rev 12:18 becomes Standard `Rev.13:1!a` (line 27471).

## 2. How mappings are represented

### Paratext `.vrs` mapping lines

A mapping line reads `THIS = STANDARD`, where the right side is always `org` ([eng.vrs line 144][lp-eng-map], [Versification.cs line 999][lp-vers-map]). For example `JOL 3:1-21 = JOL 4:1-21` means English Joel 3:1-21 is original Joel 4:1-21. The parser handles these cases:

| Case | Syntax | Example |
|---|---|---|
| One to one, or equal ranges | `A = B`, `A:1-5 = B:2-6` | `MAL 4:1-6 = MAL 3:19-24` ([eng.vrs][lp-eng-map]) |
| Range to one verse | a leading `&`, only on a `#!` line | `#! &ACT 19:40-41 = ACT 19:40` ([eng.vrs line 307][lp-eng-map], [parser][lp-vers-many]) |
| Many to one, written as repeated lines | the same left side twice | `PSA 51:0 = PSA 51:1` and `PSA 51:0 = PSA 51:2` ([eng.vrs lines 230-231][lp-eng-map]) |
| Cross-book | different codes on each side | `BAR 6:1-73 = LJE 1:1-73`, `DAG 13:1-63 = SUS 1:1-63` ([eng.vrs][lp-eng-map]) |
| Segment target | a letter after the verse | `ESG 1:1 = ESG 1:1a` ([eng.vrs][lp-eng-map]) |
| Excluded (absent) verse | `#! -REF` | written by [Versification.cs line 354][lp-vers-write] |
| Segment declaration | `#! *GEN 1:22,-,a,b` | [lxx.vrs header lines 16-19][lp-lxx] |
| Verse 0 (Psalm title) | verse number 0 | `PSA 3:0-8 = PSA 3:1-9` ([eng.vrs line 201][lp-eng-map]) |

Lines prefixed `#!` are extensions from Paratext 7.3. Older readers treat them as comments ([Versification.cs lines 612-617][lp-vers-parse]). A range on one side expands verse by verse using the left side's count ([lines 1002-1030][lp-vers-map]). Ranges may not span a chapter ([eng.vrs mapping header][lp-eng-map]).

Two limits are stated in the data itself. Splits were not supported when `eng.vrs` was written: `# NUM 26:1a = NUM 25:19b # no support for splits yet` ([eng.vrs line 158][lp-eng-map]). And the ubsicap README says "historically, the mapping section has not been validated" and that examples map from verses that do not exist ([versification_json README][vj]). One case: `org.vrs` declares `S3Y 1:67` but its own mapping lines reach `S3Y 1:68` ([org.vrs lines 97 and 154][lp-org]).

### SWORD mapping rules

A SWORD rule is a breakpoint, not a row per verse. Each rule says "our book chapter:verse[..verseMax] equals the reference book chapter:verse[..verseMax]" ([canon_nrsv.h lines 267-274][sw-nrsv]). Verses after a breakpoint shift by the same offset until the next rule ([translateVerse][sw-mgr-tr]).

All translation goes through a pivot. The pivot is KJVA: a verse moves from scheme A to KJVA and then from KJVA to scheme B ([versificationmgr.cpp lines 984-1006][sw-mgr-tr]). A translation can return a verse range, so one-to-many works. A rule can name a different book (`{ "Dan", 13, 1, 0, "Sus", 1, 1, 0 }`, [canon_synodal.h][sw-syn]). The format has no segments.

SWORD's own author now calls the KJVA pivot a defect. When two source verses fall into one pivot verse, "they cannot fan back out correctly on the far side". The August 2026 draft proposes a synthetic, extend-only superset scheme named `Bible` that no text is published in, used only as the mapping hub. It cites Paratext's `org` as precedent ([bible-intermediate-v11n.md][sw-pivot]). It is a draft "for discussion on sword-devel before adoption".

### JSword mapping files

JSword maps every scheme to KJVA with lines like `Gen.32.1-Gen.32.33=Gen.31.55-Gen.32.32` ([MT.properties][js-mt]). Unlike SWORD C++, it supports **parts** on the KJV side, so a split survives a round trip ([VersificationToKJVMapper.java][js-mapper]):

```
3John.1.14=3John.1.14!a
3John.1.15=3John.1.14!b
Rev.12.18=Rev.13.1!a
Rev.13.1=Rev.13.1!b
```

That is the whole of [NRSV.properties][js-nrsv]. JSword also allows `?Name` for passages with no KJV equivalent, and `!zerosUnmapped` to control verse 0 (same sources).

### TVTMS rules

The expanded section of TVTMS has about 25,000 rows (lines 4181-27570). Each row has a SourceType (tradition), SourceRef, StandardRef, Action, note text and tests (lines 4154-4180). The actions name each kind of difference. The most common are: Keep verse, Renumber verse, Concatenation, DividedPrev verse, MergedPrev verse, IfEmpty verse, Renumber title, Psalm title, CopiedFrom verse and MovedFrom verse. An action with `*` means the verse order changes.

TVTMS covers each case the brief asked about:

- **Split and merge.** Subverses `!a`, `!b`, also written `.1`, `.2` or `a`, `b` (line 88). The left side must be unique, so it gets the subverse letter (line 55).
- **Absent verse.** "Absent" means a Standard verse with no text in the source. Three forms say whether the text is elsewhere, empty, or missing (lines 100-103).
- **Long verse.** LXX and Vulgate text with no English equivalent becomes subverses on the previous Standard verse, with subverse 0 for the shared text, as in `Jos.9:2!0-6` (lines 90-93).
- **Duplicated text.** LXX 1 Kings 2:35, 12:24 and 16:28 repeat verses from elsewhere (lines 94-98).
- **Psalm titles.** A `Title` pseudo-verse, not verse 0. `Psa.3:1` in the Hebrew tradition maps to `Psa.3:Title` (line 10295). The test `TextBeforeV1` detects an unnumbered title (line 127).
- **Moved passage.** `PassageMoved` occurs only at Romans 16:25-27 (line 150).

TVTMS also notes that some differences should be left alone. ESV's Rev 12:17 moves a verse division by a few words, and "a correction will merely add confusion" (line 58).

## 3. Trouble spots

KJV and BSB columns come from `build/corpus.db`. Other columns come from the cited files.

| Spot | KJV, BSB (this corpus) | Paratext | SWORD | TVTMS |
|---|---|---|---|---|
| Psalm titles | Title tokens have no verse. Ps 3 has 8 verses, Ps 51 has 19 | `org` counts the title as verse 1 (`PSA 3:9`). `eng` puts it at verse 0: `PSA 3:0-8 = PSA 3:1-9`. Ps 51's title is two `org` verses, both mapped to `eng` 51:0 ([eng.vrs lines 201, 230-232][lp-eng-map]) | KJVA uses verse 0 as the target: Synodal `Ps 3:1` maps to KJVA `Ps 3:0` ([canon_synodal.h line 413][sw-syn]) | Hebrew `Psa.3:1` maps to `Psa.3:Title`. Hebrew `Psa.51:1` and `51:2` both map to `Psa.51:Title` (line 10295) |
| Joel 2/3 vs 3/4 | 3 chapters, 2:32 and 3:21 | `org` and `lxx` have 4 chapters. `eng` 2:28-32 = `org` 3:1-5, `eng` 3 = `org` 4 ([eng.vrs lines 295-296][lp-eng-map]). `vul` follows English ([vul.vrs][lp-vul]) | MT has 4 chapters, 20/27/5/21 verses ([canon_mt.h][sw-mt]) | Hebrew and Greek `Jol.4:1` map to `Jol.3:1` (line 21124) |
| Malachi 3/4 | 4 chapters | `org` and `lxx` end at 3:24. `eng` 4:1-6 = `org` 3:19-24 ([eng.vrs line 305][lp-eng-map]) | MT has 3 chapters ([canon_mt.h][sw-mt]) | Hebrew `Mal.3:19` maps to `Mal.4:1` (line 21404) |
| Rev 12:18 vs 13:1 | Both have 12:17 as the last verse of ch 12 and 18 verses in ch 13. KJV starts 13:1 with "And I stood upon the sand of the sea". BSB ends 12:17 with "And the dragon stood on the shore of the sea" | `org`, `eng`, `lxx` and `vul` have 12:18. `rso` and `rsc` have 12:17 and map `REV 13:1` to both `REV 12:18` and `REV 13:1` ([rso.vrs lines 390-391][lp-rso]) | NRSV 12:18 and 13:1 both map to KJV 13:1 ([canon_nrsv.h lines 271-272][sw-nrsv]) | `Rev.12:18` maps to `Rev.13:1!a`, `Rev.13:1` to `Rev.13:1!b` (line 27471). It names three placements of the clause: end of 12:17 (ESV), its own 12:18 (NRSV, HCSB, NLT), start of 13:1 (KJV, NIV) (line 111) |
| 3 John 14-15 | Both end at 1:14 | All six schemes have 15 verses, so Paratext has no mapping here | Synodal 1:14-15 maps to KJVA 1:14 ([canon_synodal.h line 585][sw-syn]) | Greek `3Jn.1:15` maps to `3Jn.1:14!b` (line 27465) |
| Romans 16:25-27 | Both at 16:25-27 | `rso` and `rsc` place it at 14:24-26: `ROM 14:24-26 = ROM 16:25-27` ([rso.vrs line 385][lp-rso]) | Synodal Rom 14:24 maps to KJVA 16:25 ([canon_synodal.h line 583][sw-syn]) | Greek2 `Rom.14:24` maps to `Rom.16:25`, action "Renumber verse*" (line 27434) |
| Daniel 3 Greek additions | KJV ends Dan 3 at verse 30 | `org` Dan 3 has 33 verses (English 4:1-3 = `org` 3:31-33, [eng.vrs line 285][lp-eng-map]). `vul` Dan 3 has 100 verses: `DAN 3:24-90 = S3Y 1:1-67` and `DAN 3:91-100 = DAN 3:24-33` ([vul.vrs lines 528-529][lp-vul]). `rso` maps the same verses to `DAG` (Greek Daniel) instead ([rso.vrs line 414][lp-rso]) | Vulg Dan 3:24 maps to `PrAzar` 1:1 and Dan 3:91 to Dan 3:24 ([canon_vulg.h lines 595-597][sw-vulg]) | Greek and Latin `Dan.3:24` map to `S3Y.1:1`, `Dan.3:91` to `Dan.3:24` (lines 20180, 20268) |
| Esther Greek additions | KJV has no additions | Two books: `EST` (Hebrew, 10 chapters) and `ESG` (Greek Esther, 10 chapters with additions as extra verses). `eng` maps `ESG 1:1` to `ESG 1:1a` through `1:1s` ([eng.vrs][lp-eng-map]) | KJVA has a separate `AddEsth` book with 16 chapters. NRSVA has `EsthGr`, 16 chapters. Vulg and LXX have `Esth` with 16 chapters ([canon_kjva.h][sw-kjva], [canon_nrsva.h][sw-nrsva]) | Additions become Standard `Est.11-16`, for example `Est.1:1!a` maps to `Est.11:2` (line 7907). It also uses an `Ade` code for Additions to Esther (line 158) |

What does not agree, or was not verified:

- The book code for the Song of the Three Young Men differs. Paratext uses `S3Y`, SWORD uses `PrAzar`.
- The `S3Y` verse count disagrees inside Paratext: 67 in `org.vrs`, 68 in `eng.vrs` and in TVTMS.
- BSB follows KJV numbering in every verse, and OSHB matches `org` (`schemes.test.ts` checks every verse of both).
- *Unverified:* the full Esther and Greek Daniel correspondence. Only the rows quoted above were read.

## 4. Address syntaxes in real use

| Syntax | Example | Carries the scheme? | Ranges | Segments | Verse 0 |
|---|---|---|---|---|---|
| OSIS osisRef | `Bible.KJV:Gen.1.1`, `Gen.26.23-Gen.26.33` | Indirectly. The prefix names a *work*, and the work's header declares a `refSystem` ([manual §7.2.15.5][osis-man]). Reserved system names: NRSVA, NA27, KJV, LXX, MT, SamPent, Synodal, Vulg, Loeb (manual p. 16) | `A-B` with both ends written in full | `!b` grain, defined as work-specific, plus `@cp[n]` and `@s[word]` character and string pointers ([schema line 2946][osis-xsd]) | Not defined by OSIS. SWORD uses `.0` for intros, as in `Sir.0.0` ([canon_synodal.h line 33][sw-syn]) |
| Paratext VerseRef | `GEN 3:11/4` | Yes, as an integer suffix from the 7-value enum, so 4 is English ([VerseRef.cs lines 676-730][lp-ref-parse]) | `-` for ranges, `,` for sequences in the verse part ([lines 25-27][lp-ref-top]) | A letter after the verse | Yes |
| USFM Referencing Standard 1.0 | `PSA 7:0`, `LUK 11:2b`, `MAT 2:1!3`, `en+niv.GEN 1:1` | No. "A scripture reference is interpreted according to the versification of the scripture being referenced", and anything else belongs to a higher-level protocol ([SRS][srs]) | `GEN 1:1-31`, with the second end relative to the first | One lowercase letter. Words are `!n`, counting from 1 | Yes, for text before verse 1 such as a Psalm title |
| Integer BBBCCCVVV | `1001001` for GEN 1:1 | No | No | No. Paratext appends the segment as a string, `BBBCCCVVVS` ([VerseRef.cs line 402][lp-ref-int]) | Yes |
| Scripture Burrito scope | `{"GEN": ["1:1-2:3"]}` | Per package. A `.vrs` ingredient with role `versification` is "a versification file indicating the delta from the org versification" ([role.schema.json][sb-role]) | Yes | No | No. The pattern requires `[1-9]` ([scope.schema.json][sb-scope]) |
| TVTMS refs | `Gen.6:1!b`, `Jos.9:2!0-6`, `Psa.3:Title` | No. The tradition is a column, not part of the ref | Yes | `!a`, `.1` or `a` | No. It uses `Title` |
| JSword parts | `Rev.13.1!a`, `?NewPassage` | No. Files are per scheme | Yes | `!part`, on the KJV side only | Configurable |

Notes on the formats:

- **BBBCCCVVV.** Paratext computes it as `book * 1,000,000 + chapter * 1,000 + verse` ([VerseRef.cs line 1467][lp-ref-int2]). Each part tops out at 999. Book numbers come from the Paratext book list ([Canon.cs][lp-canon]). GEN is 1, REV is 66, TOB is 67, and the list goes on through the deuterocanonical and extra books. The number does not depend on any canon's book order.
- **OSIS book names.** They are case-sensitive OSIS names (`Matt`), not USFM codes ([manual §15.5][osis-man]).
- **A collision.** The SRS prefix slot is a BCP 47 language tag plus a translation id, joined to the book by `.` or `:`. Paratext scheme names collide with language tags: `eng` is the ISO 639-3 code for English. So `eng:GEN 1:1` already means "English translation", not "eng scheme".

## 5. Licenses

| Dataset | License | Where the text is | Ship in a commercial app? | Ship in a free app? |
|---|---|---|---|---|
| Paratext `.vrs` files (libpalaso copy) | MIT, (c) SIL Global | [libpalaso LICENSE][lp-lic] | Yes, with the MIT notice | Yes |
| ubsicap `versification_json` | MIT | [repo license][vj] | Yes, with notice | Yes |
| TVTMS | CC BY 4.0 | File header lines 10-20 and the [STEPBible-Data README][step-readme] | Yes, with attribution to Tyndale House and STEPBible.org, a link to STEPBible.github.io/STEPBible-Data, and a note of any changes | Yes, same terms |
| SWORD `canon_*.h` | GPL version 2 only | [LICENSE][sw-lic] and each file header ("Free Software Foundation version 2") | No, unless the app is GPL-2 | Only under GPL-2 |
| JSword `*.properties` | LGPL 2.1 or later | Header of each file, e.g. [MT.properties][js-mt] | Not without a legal read. LGPL terms for a data file embedded in an app are unclear | Same caution |
| OSIS, USFM SRS, Burrito schema | Specifications. Implementing a grammar copies no data | n/a | n/a | n/a |

Two caveats:

- **TVTMS's request not to re-post.** The header asks: "Please do not post copies of this data file elsewhere, so that this remains the single up-to-date source" (line 18). CC BY 4.0 permits redistribution, so this is a request, not a license term. Shipping tables compiled from TVTMS respects both. Committing the raw 5.8 MB file to a public repo goes against the request.
- **SWORD's view on copyright.** The SWORD draft calls mappings "near uncopyrightable fact" ([bible-intermediate-v11n.md line 164][sw-pivot]). That is one author's opinion, not a license grant. Treat SWORD data as GPL.

## 6. The carried code compared

The carried code (at commit `cf03cc0`, replaced in step 2) is `src/ingest/vrs.ts`, `src/model/versification.ts`, `src/ingest/vrs/av11n.vrs` and `src/ingest/fixtures/divergent.vrs`. It reads `NATIVE = CANONICAL` lines, where canonical is KJV numbering. It expands equal-length ranges into one row per verse, and it builds a bijective map that is identity wherever no row exists.

It gets these things right:

- Sparse storage, so a KJV-numbered edition has no rows.
- Verse 0 for a Psalm title, the same as `eng.vrs` and SWORD.
- Chapter moves such as Joel and Malachi, expressed as equal ranges.

It differs from the real formats:

- **The hub is reversed.** Real `.vrs` files map onto `org`. A Paratext `eng.vrs` dropped into this pipeline would be read as English to KJV when it says English to original.
- **The name is wrong.** "av11n" names a feature, not a scheme, and Paratext `eng` is not KJV numbering (section 1).
- **It cannot read most of the real files.** `parseVrs` would do the following with the shipped Paratext files:
  - throw on segments (`ESG 1:1a`)
  - throw on cross-book lines (`BAR 6:1-73 = LJE 1:1-73`)
  - throw on unequal ranges (`PSA 141:0 = PSA 142:0-1`, [rsc.vrs line 295][lp-rsc])
  - silently drop every `#!` line, because it strips `#` comments first. That loses `&` many-to-one lines, excluded verses and segment declarations.
  - skip the verse-count lines, so it never knows which verses exist.
- **The bijection check rejects real data.** `buildVersificationMap` throws when one verse maps twice. Real files do this on purpose: `PSA 51:0` in `eng.vrs`, `REV 13:1` in `rso.vrs`, `PSA 14:3` and `PSA 15:10` in `vul.vrs` ([vul.vrs lines 334-340][lp-vul]).

The model cannot express:

- partial verses (NRSV Rev 12:18 is KJV 13:1a)
- one verse to a range
- absent verses
- cross-book moves (Daniel 3 to S3Y, Daniel 13 to SUS)
- Psalm titles that span two source verses
- text boundaries that differ under identical numbering

The last item already happens in this corpus. KJV and BSB both number Rev 12:17 and 13:1, but the "stood on the sand" clause sits in different verses. No versification mapping can see that. Only word-level alignment or the quote witness (ADR-0005) can.

**The divergent fixture models a divergence no source has.** `divergent.vrs` maps `REV 12:18 = REV 13:1` and then shifts `REV 13:1-17 = REV 13:2-18`. Every source here gives Rev 13 eighteen verses in both numberings ([eng.vrs][lp-eng-nt], [canon.h][sw-canon-kjv]). The real difference is a partial verse, `Rev.12:18 = Rev.13:1!a` (TVTMS line 27471, [JSword NRSV.properties][js-nrsv]). The fixture round-trips, but it tests the wrong thing.

---

## Recommendation

Adopted on 2026-11-09. The address syntax and its storage columns are in ADR-0002, and the pivot and the mapping sources in ADR-0006. Two reasons are recorded only here:

- The part before `/` is valid SRS 1.0, which the USFM committee maintains.
- The scheme suffix carries a name because Paratext's 7-value integer enum cannot grow.

The pivot's three invariants are SWORD's ([bible-intermediate-v11n.md lines 62-64][sw-pivot]).

### What was decided next

Every item this section listed is settled. Word numbers in strings count from 1, and an edition that mixes traditions gets a derived scheme (ADR-0002). The pivot is the scheme `pivot`, a test checks that it only grows, and TVTMS's attribution is in the `data_source` table (ADR-0006). `src/ingest/fixtures/real-cases.vrs` replaced the Revelation 13 fixture. OSHB's numbering was checked against `org` on 2026-11-09: no verse `org` lacks and no chapter that ends early (`schemes.test.ts`). The book-identity questions went to [canons.md](canons.md) and the text tests to [tvtms-text-tests.md](tvtms-text-tests.md).

[lp-res]: https://github.com/sillsdev/libpalaso/tree/f1f70e93a79d55b1769a4e20fb36047f2fa08d99/SIL.Scripture/Resources
[lp-eng]: https://github.com/sillsdev/libpalaso/blob/f1f70e93a79d55b1769a4e20fb36047f2fa08d99/SIL.Scripture/Resources/eng.vrs.txt#L1-L60
[lp-eng-nt]: https://github.com/sillsdev/libpalaso/blob/f1f70e93a79d55b1769a4e20fb36047f2fa08d99/SIL.Scripture/Resources/eng.vrs.txt#L62-L91
[lp-eng-map]: https://github.com/sillsdev/libpalaso/blob/f1f70e93a79d55b1769a4e20fb36047f2fa08d99/SIL.Scripture/Resources/eng.vrs.txt#L139-L452
[lp-org]: https://github.com/sillsdev/libpalaso/blob/f1f70e93a79d55b1769a4e20fb36047f2fa08d99/SIL.Scripture/Resources/org.vrs.txt
[lp-lxx]: https://github.com/sillsdev/libpalaso/blob/f1f70e93a79d55b1769a4e20fb36047f2fa08d99/SIL.Scripture/Resources/lxx.vrs.txt#L1-L20
[lp-vul]: https://github.com/sillsdev/libpalaso/blob/f1f70e93a79d55b1769a4e20fb36047f2fa08d99/SIL.Scripture/Resources/vul.vrs.txt
[lp-rso]: https://github.com/sillsdev/libpalaso/blob/f1f70e93a79d55b1769a4e20fb36047f2fa08d99/SIL.Scripture/Resources/rso.vrs.txt
[lp-rsc]: https://github.com/sillsdev/libpalaso/blob/f1f70e93a79d55b1769a4e20fb36047f2fa08d99/SIL.Scripture/Resources/rsc.vrs.txt
[lp-vers]: https://github.com/sillsdev/libpalaso/blob/b4f7a6da7b868f9ae909e40fb0708f5fd4efd782/SIL.Scripture/Versification.cs
[lp-vers-enum]: https://github.com/sillsdev/libpalaso/blob/b4f7a6da7b868f9ae909e40fb0708f5fd4efd782/SIL.Scripture/Versification.cs#L1340-L1353
[lp-vers-map]: https://github.com/sillsdev/libpalaso/blob/b4f7a6da7b868f9ae909e40fb0708f5fd4efd782/SIL.Scripture/Versification.cs#L998-L1030
[lp-vers-many]: https://github.com/sillsdev/libpalaso/blob/b4f7a6da7b868f9ae909e40fb0708f5fd4efd782/SIL.Scripture/Versification.cs#L1032-L1062
[lp-vers-parse]: https://github.com/sillsdev/libpalaso/blob/b4f7a6da7b868f9ae909e40fb0708f5fd4efd782/SIL.Scripture/Versification.cs#L603-L633
[lp-vers-write]: https://github.com/sillsdev/libpalaso/blob/b4f7a6da7b868f9ae909e40fb0708f5fd4efd782/SIL.Scripture/Versification.cs#L340-L365
[lp-ref]: https://github.com/sillsdev/libpalaso/blob/b4f7a6da7b868f9ae909e40fb0708f5fd4efd782/SIL.Scripture/VerseRef.cs
[lp-ref-top]: https://github.com/sillsdev/libpalaso/blob/b4f7a6da7b868f9ae909e40fb0708f5fd4efd782/SIL.Scripture/VerseRef.cs#L25-L31
[lp-ref-parse]: https://github.com/sillsdev/libpalaso/blob/b4f7a6da7b868f9ae909e40fb0708f5fd4efd782/SIL.Scripture/VerseRef.cs#L676-L730
[lp-ref-int]: https://github.com/sillsdev/libpalaso/blob/b4f7a6da7b868f9ae909e40fb0708f5fd4efd782/SIL.Scripture/VerseRef.cs#L393-L405
[lp-ref-int2]: https://github.com/sillsdev/libpalaso/blob/b4f7a6da7b868f9ae909e40fb0708f5fd4efd782/SIL.Scripture/VerseRef.cs#L1467-L1472
[lp-canon]: https://github.com/sillsdev/libpalaso/blob/b4f7a6da7b868f9ae909e40fb0708f5fd4efd782/SIL.Scripture/Canon.cs
[lp-lic]: https://github.com/sillsdev/libpalaso/blob/b4f7a6da7b868f9ae909e40fb0708f5fd4efd782/LICENSE
[vj]: https://github.com/ubsicap/versification_json
[sw]: https://git.crosswire.org/main/sword
[sw-git]: https://crosswire.org/pipermail/sword-devel/2026-August/051067.html
[sw-lic]: https://git.crosswire.org/main/sword/-/blob/a376e42938580f446f53a4cb20e7161355fa9110/LICENSE
[sw-mgr-reg]: https://git.crosswire.org/main/sword/-/blob/a376e42938580f446f53a4cb20e7161355fa9110/src/mgr/versificationmgr.cpp#L67-89
[sw-mgr-tr]: https://git.crosswire.org/main/sword/-/blob/a376e42938580f446f53a4cb20e7161355fa9110/src/mgr/versificationmgr.cpp#L926-1010
[sw-swmgr]: https://git.crosswire.org/main/sword/-/blob/a376e42938580f446f53a4cb20e7161355fa9110/src/mgr/swmgr.cpp#L1008
[sw-canon-kjv]: https://git.crosswire.org/main/sword/-/blob/a376e42938580f446f53a4cb20e7161355fa9110/include/canon.h#L326-334
[sw-mt]: https://git.crosswire.org/main/sword/-/blob/a376e42938580f446f53a4cb20e7161355fa9110/include/canon_mt.h#L159-183
[sw-nrsv]: https://git.crosswire.org/main/sword/-/blob/a376e42938580f446f53a4cb20e7161355fa9110/include/canon_nrsv.h#L267-274
[sw-nrsva]: https://git.crosswire.org/main/sword/-/blob/a376e42938580f446f53a4cb20e7161355fa9110/include/canon_nrsva.h
[sw-kjva]: https://git.crosswire.org/main/sword/-/blob/a376e42938580f446f53a4cb20e7161355fa9110/include/canon_kjva.h
[sw-syn]: https://git.crosswire.org/main/sword/-/blob/a376e42938580f446f53a4cb20e7161355fa9110/include/canon_synodal.h
[sw-vulg]: https://git.crosswire.org/main/sword/-/blob/a376e42938580f446f53a4cb20e7161355fa9110/include/canon_vulg.h#L590-630
[sw-pivot]: https://git.crosswire.org/main/sword/-/blob/a376e42938580f446f53a4cb20e7161355fa9110/doc/bible-intermediate-v11n.md
[sw-xml]: https://git.crosswire.org/main/sword/-/blob/a376e42938580f446f53a4cb20e7161355fa9110/doc/v11n-xml.md
[js]: https://github.com/crosswire/jsword
[js-mapper]: https://github.com/crosswire/jsword/blob/a2c51f3c3a55416f3c991a67ef3d635c7ee55330/src/main/java/org/crosswire/jsword/versification/VersificationToKJVMapper.java
[js-mt]: https://github.com/crosswire/jsword/blob/a2c51f3c3a55416f3c991a67ef3d635c7ee55330/src/main/resources/org/crosswire/jsword/versification/MT.properties
[js-nrsv]: https://github.com/crosswire/jsword/blob/a2c51f3c3a55416f3c991a67ef3d635c7ee55330/src/main/resources/org/crosswire/jsword/versification/NRSV.properties
[tvtms]: https://github.com/STEPBible/STEPBible-Data/tree/5de0a47f35f0fc13dfe1430d104e5db8a4285f9c/Versification
[step-readme]: https://github.com/STEPBible/STEPBible-Data/blob/5de0a47f35f0fc13dfe1430d104e5db8a4285f9c/README.md
[osis-man]: https://crosswire.org/osis/OSIS%202.1.1%20User%20Manual%2006March2006.pdf
[osis-xsd]: https://www.crosswire.org/osis/osisCore.2.1.1.xsd
[srs]: https://github.com/usfm-bible/tcdocs/blob/4cdd83dc31849fa5b863dfdec225c25a93dc6807/docs/Scripture%20Referencing%20Standard.md
[sb-scope]: https://github.com/bible-technology/scripture-burrito/blob/6ed32ccb095a34221c16901484bd5640515901dd/schema/scope.schema.json
[sb-role]: https://github.com/bible-technology/scripture-burrito/blob/6ed32ccb095a34221c16901484bd5640515901dd/schema/role.schema.json
