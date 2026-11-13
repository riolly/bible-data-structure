# bible-data-structure: domain language

The vocabulary of the Bible data model: which books exist, how text is addressed, how editions relate, and how text breaks into units. App concepts (reading modes, marks, layout) don't belong here. When a term changes, update it here first.

Terms marked *(planned)* are decided in an ADR but not yet in the code.

## Books and canons

**Book**:
One book of scripture, identified by its **USFM book code** (`GEN`, `PSA`, `JHN`, `TOB`, `1MA`). Names, abbreviations and slugs are display data per language, never ids. (ADR-0002)
_Avoid_: using an English name or slug as an id

**Canon**:
One specific list of what a tradition counts as scripture, in its order: Protestant now, Catholic, Orthodox, Tanakh and Ethiopian lists later. Grouping and order belong to the canon, not to the book. (ADR-0002)
_Avoid_: assuming every Bible has 66 books or the same order

**Canon entry**:
One counted item in a canon, holding one or more book codes. Tanakh "Samuel" is one entry with `1SA` and `2SA`. Each entry has a status: `canonical`, `readable` (the Orthodox *anagignoskomena*) or `appendix`. Traditions count entries, not codes.

**Canon section**:
A group inside a canon (Old Testament, Pentateuch, Torah, Ketuvim, appendix). Sections form a tree.

**Book name**:
A book's long name, short name and abbreviation in one language, with optional overrides per canon (Vulgate `EZR` is "1 Esdras"). Parsing a human reference needs a canon and a language.

## Editions

**Edition**:
One specific text: a translation (KJV, BSB) or an original-language text (OSHB, a Greek New Testament), at a specific revision. Each edition declares its native versification scheme and carries an edition stamp.
_Avoid_: version (ambiguous between translation and revision)

**Edition stamp**:
A deterministic id for an edition's revision, computed as sha256 over its source text (`src/ingest/edition.ts`). A text change gives a new stamp; repackaging the zip doesn't. (ADR-0005)

**Words stamp**:
A deterministic id for what an edition's word addresses hold: sha256 over every word address and the word stored there (`translation.words_stamp`). Unlike the edition stamp, it changes when a text fix, the tokenizer or the parser changes stored words. Word anchors reconcile on it. (ADR-0005 amendment)

**Chapter stamp**:
sha256 over one chapter's stored document and its verse text (`chapter_doc.stamp`). It changes whenever what a reader sees in the chapter changes, punctuation and notes included. A quote witness stores it, and reconciles when it changes. An edition's **text stamp** hashes its chapter stamps. (ADR-0005 amendment, 2026-11-11)

**Source pin**:
The upstream URL plus the edition stamp its text must give (`src/ingest/sources.ts`). A zip rebuilt with the same text passes, and another stamp stops the download. Updating a pin is a new edition. TVTMS, which has no edition stamp, is pinned by the sha256 of its file. (ADR-0005 amendment)

**Full edition**:
An edition we hold as files, that passes the ingest checks, and whose every word that translates an original word has a Strong's number. Supplied words (`\add`) and words the tag source marks as having no original counterpart need none. Word taps, part-verse marks and whole-Bible offline use need it. Computed from the checks and the rights record, never set by hand. (ADR-0008)

**Reading edition**:
An edition that passes the numbering and markup checks but isn't Full. It connects to the original language verse by verse through the pivot. (ADR-0008)
_Avoid_: partial edition, lite edition

**Target edition**:
An edition the first apps read: the English editions in ADR-0008's support table (BSB, KJV, NASB, NLT, NIV, CSB, NKJV, ESV) and the hub texts WLC and SBLGNT. A model feature lands when a contract call or a fixture from one of them needs it. (ADR-0008)

**Rights record**:
One record per edition saying what its license allows: the route (provider), offline use (`none`, `cache` or `full`), refresh days, copy limit, AI use and attribution. The type and the records of the seven local editions and the three licensed ones are in `src/contract/rights.ts`. (ADR-0008)

**Pack**:
The file an app ships for a set of editions, built from `build/corpus.db` by `bun run pack` (`src/pack/pack.ts`). It is a SQLite file with the corpus tables, so the app contract reads it the same way. It holds the editions it names, the hub editions WLC and SBLGNT, the schemes of ADR-0008's target editions with their mappings, and no token or block rows: a word address is read from the verse text (ADR-0004, step 13 amendment). Chapter documents are deflated. An app ships one pack with all its local editions, so the hub is in it once. The corpus DB never ships.

**Provider**:
Where an edition's text comes from at read time: a local pack, or a licensed API such as API.Bible. A fetched chapter carries its own stamp, because the provider can refresh it. `src/provider/provider.ts` gives both through one app contract: local editions from the DB, licensed ones fetched a chapter at a time and refetched after the rights record's refresh days. (ADR-0008)

## Addressing

**Versification scheme**:
A numbering system for chapters and verses: KJV, Masoretic, Septuagint, Vulgate and others. The same `chapter:verse` can mean different text under different schemes (Psalm titles, Joel 2/3, Malachi 3/4, Revelation 12/13). (ADR-0002)

**Scheme id**:
A lowercase name from our registry: `kjv`, the Paratext names `org`, `eng`, `lxx`, `vul`, `rso`, `rsc`, and the derived schemes `rp`, `web`, `brenton`, `bsb`. Paratext `eng` is not KJV numbering.
_Avoid_: av11n (that is SWORD's name for its mapping feature, not a scheme)

**Verse address**:
A book, chapter, verse and optional segment **under a named versification scheme**. Verse 0 is a Psalm title. Written as a USFM reference plus `/scheme`: `PSA 51:3/org`, `REV 13:1a/kjv`. Stored as separate columns. (ADR-0002)
_Avoid_: reference, citation (those are human-written strings that resolve to an address)

**Segment**:
A lettered part of a verse (`13:1a`), used where schemes split a verse differently, and where an edition letters text it adds after a verse (Brenton's `1KI 2:35a` to `35o`). A Token carries the segment its source marks, and a word index counts within the segment (ADR-0004 v1.4). Addresses use one letter; pivot mapping rows may use TVTMS's longer subverse ids (ADR-0006).

**Derived scheme**:
A registered scheme plus a listed set of chapter-length changes, for an edition that fits no registered scheme. It has its own scheme id. `kjv` is `eng` with two changes. (ADR-0002 amendment)

**Pivot scheme**:
A synthetic scheme that only grows, which all scheme mappings go through. Its id is `pivot`. Stored addresses never use it. (ADR-0006)

**Scheme mapping**:
Data that moves a verse address from one scheme to the pivot and back, including partial verses, merges, cross-book moves and verses absent in one scheme. Compiled from STEPBible TVTMS and Paratext `.vrs`. (ADR-0006)

**Word address**:
A verse address plus a **word index**: the 0-based ordinal of a word Token in that verse unit or segment, punctuation excluded. In a bridge, each number of the range gives the same word for the same index. The corpus enforces that one word address names one word. In address strings the word number counts from 1 (`MAT 2:1!3/kjv` is index 2). A punctuation Token is addressed by the word it follows. Valid only for one edition, since editions differ in words. Its meaning depends on the tokenizer policy (ADR-0004).

**Verse unit**:
What one verse marker covers: one verse, or a range for a verse bridge. It has a first and a last verse, equal for a single verse. Within a chapter, units rise and never overlap. (ADR-0004 v1.5)

**Verse bridge**:
A USFM verse marker covering several verses (`\v 17-18`): one verse unit with a range. Every number in the range resolves to the unit, so NLT's Numbers 1:20-21 is found from 20 and from 21. Its tokens carry the first number, and its word indexes count across the whole unit. (ADR-0004 v1.5)

**Quote witness**:
The surface text of the words an outside reference points at, or its sha256 where the edition's license doesn't let an app keep the text, plus the stamp it was made against. Stored beside the address. The address and the quote together are the reference's truth, and a word index is only a hint. Used to detect and repair drift after a revision. (ADR-0005 and its step 14 amendment)

## Text units

**Chapter document**:
The stored truth of one chapter of an edition: its USJ as usfm-grammar gives it, with the whitespace, character styles, footnotes, cross-references, stanza breaks and published verse numbers. Tokens, Blocks and verse text are derived from it. Chapter 0 is the book's front matter. Only the markers listed in ADR-0001's step 7 amendment are supported, and the ingest stops on any other. (ADR-0001 amendment)

**Verse text**:
One verse unit's surface text, derived from the chapter document, without notes. Empty when the edition prints the number with no words. A verse the edition skips has none. (ADR-0001 amendment)

**Token**:
One word or punctuation occurrence in one edition's text, derived from the chapter document: the unit of word addressing. Whitespace is never a Token. A KJV Token and a BSB Token are never the same object. (ADR-0001)
_Avoid_: word (ambiguous with Original Word)

**Block**:
A contiguous run of Tokens forming one literary unit (prose paragraph, poetry line, heading). It keeps its USFM marker with the level (`p`, `q2`, `pi2`, `li2`, `s2`, `d`), and its genre (prose, poetry or heading) is derived from the marker. Blocks partition the token stream. Heading Tokens carry no verse and no word index, except a Psalm title that the edition's scheme numbers as verse 0. (ADR-0001)
_Avoid_: paragraph (poetry lines and headings are Blocks too)

**Ketiv**:
"What is written": the consonants on the line of a Hebrew manuscript where tradition reads a different word. The ketiv is in the token stream and has word addresses. The vowel points printed with it belong to the qere, so a ketiv token is usually unpointed. (ADR-0007)

**Qere**:
"What is read": the word tradition reads in place of a ketiv, given in the manuscript's margin. Translations almost always follow it. Stored as a Reading, never as Tokens. A qere can stand for several written words, or for none. (ADR-0007)

**Reading**:
Another text for a range of written words in one edition, stored beside the token stream (`reading` table): a verse address, a word range `[word_index, word_index + word_count)`, its own text and the source ids of its words. Today every Reading is a qere. A Reading never changes a word address. A range of 0 words is a qere read before word `word_index`; empty text is a ketiv not read at all. (ADR-0007)
_Avoid_: variant (OSHB's word for the note, but also used for textual variants between manuscripts)

**Structure overlay** *(planned)*:
Any further grouping laid over the token stream: sections, pericopes, literary units that cross chapter boundaries, chiasm, parallelism. Unlike Blocks, overlays may overlap. The old repo's curated literary edition was one such overlay (`docs/prior-art/old-adr-0017-*`).

## Original language

**Original Word**:
One word occurrence in WLC or SBLGNT: an OSHB `<w>` element in Hebrew, ketiv and qere words included, or a MACULA Greek word. Identified by its source's id (`ow_id`). It carries its lemma, main Strong's number, morphology and gloss, and is the shared hub that translation Tokens align to. A Hebrew word's morphemes are the `/`-separated parts of its lemma and morphology. (ADR-0003 and its step 11 amendment)
_Avoid_: lemma (dictionary form), Strong's (lexical id); assuming one written word is one Original Word (OSHB divides 12 written words in two)

**Alignment**:
The many-to-many mapping from an edition's Tokens to Original Words. Stored for the BSB, one row per English word and Original Word, keyed by the word address, with the Strong's numbers of the morphemes the word's aligned group translates (`word_alignment`). Reverse-interlinear is derived from it, never stored. (ADR-0003 and its step 12 amendment)
_Avoid_: interlinear (that is the display; Alignment is the data)

**Lemma**:
The dictionary form of a word, which occurrence statistics and dictionary entries hang off.
_Avoid_: root (a Hebrew grouping above lemmas)

**Strong's**:
A numbered lexical id (G#### / H####). A join key only, never an address.

**Morphology**:
A word's grammatical parse, stored as the source's raw code and decoded to features for display and filtering.

**Gloss**:
The editorial word-level rendering under an Original Word ("Word" under λόγος). One per Original Word, independent of any translation.

**Cross-reference**:
An editorial link between two passages (for example from the Treasury of Scripture Knowledge). Relates verse addresses, not one edition's words.

## App contract

**App contract**:
The calls an app makes to read the model: `chapter`, `passage`, `verseText`, `map`, `resolve`, `words`, `rights` and `credits` (`src/contract/contract.ts`). An app names an edition, and the edition supplies the scheme, so app code writes `JHN 3:16`. Every result carries the edition stamps, and never a row id. An app stores the addresses a result carries, with their scheme, and reads them back with `resolve`, which takes any scheme. A pack (plan step 13) or a provider (step 10) implements the same interface.

**Reference**:
A human-written string such as "1 Cor 13:4-7" or "Ps 23". `passage` resolves it to addresses under the edition's scheme with bible-passage-reference-parser, English only. A caller whose reader writes English numbers on a Hebrew or Greek edition passes the scheme the numbers follow (`kjv`). (ADR-0008)
_Avoid_: address (an address names its scheme and has one syntax)

**Lookup result**:
What an address gives in one edition: the verse, the bridge that contains it, its parts when the edition prints the verse only in parts (Brenton's Sirach 6:2a and 6:2b), or absent. Absent says why: the edition's scheme has no such verse, or the edition prints no text there (BSB's Acts 8:37). A verse printed with no words is found, with empty text.

**Mapping result**:
What `map` gives for one verse in another edition: one verse, several, part of a verse, or absent. Each kind has a display rule, written once in `src/contract/contract.ts` (`MapKind`).

## Rules

- **Translations never link to each other directly.** They relate through a verse address (coarse) or an Original Word (fine). There is no Token-to-Token edge between editions.
- **Outside references point at addresses, never at row ids.** Row ids are rebuilt on every ingest. Addresses and external `ow_id`s are stable.
- **Every address names its scheme.** Moving between schemes goes through mapping data.
- **The tokenizer policy is part of the address.** A rule change is a migration.
