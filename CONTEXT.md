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

**Source pin**:
The upstream URL plus the sha256 of the downloaded file (`src/ingest/sources.ts`). A mismatch stops the download. Updating a pin is a new edition.

## Addressing

**Versification scheme**:
A numbering system for chapters and verses: KJV, Masoretic, Septuagint, Vulgate and others. The same `chapter:verse` can mean different text under different schemes (Psalm titles, Joel 2/3, Malachi 3/4, Revelation 12/13). (ADR-0002)

**Scheme id**:
A lowercase name from our registry: `kjv`, the Paratext names `org`, `eng`, `lxx`, `vul`, `rso`, `rsc`, and the derived schemes `rp`, `web`, `brenton`. Paratext `eng` is not KJV numbering.
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
A verse address plus a **word index**: the 0-based ordinal of a word Token in that verse or segment, punctuation excluded. The corpus enforces that one word address names one word. In address strings the word number counts from 1 (`MAT 2:1!3/kjv` is index 2). A punctuation Token is addressed by the word it follows. Valid only for one edition, since editions differ in words. Its meaning depends on the tokenizer policy (ADR-0004).

**Verse bridge**:
A USFM verse marker covering several verses (`\v 17-18`). Today it collapses to its first number, and the later numbers get no address (ADR-0004, rule 6; open for revisiting).

**Quote witness**:
The surface text of the words an outside reference points at, plus the edition stamp it was made against. Stored beside the address as proof, used to detect and repair drift after a revision. (ADR-0005)

## Text units

**Token**:
One word or punctuation occurrence in one edition's text: the unit of storage and of word addressing. Whitespace is never a Token. A KJV Token and a BSB Token are never the same object. (ADR-0001)
_Avoid_: word (ambiguous with Original Word)

**Block**:
A contiguous run of Tokens forming one literary unit (prose paragraph, poetry line, heading) with a genre and indent level, derived from USFM markers (`\p`, `\q#`, `\s`, `\d`). Blocks partition the token stream. Heading Tokens carry no verse and no word index. (ADR-0001)
_Avoid_: paragraph (poetry lines and headings are Blocks too)

**Structure overlay** *(planned)*:
Any further grouping laid over the token stream: sections, pericopes, literary units that cross chapter boundaries, chiasm, parallelism. Unlike Blocks, overlays may overlap. The old repo's curated literary edition was one such overlay (`docs/prior-art/old-adr-0017-*`).

## Original language

**Original Word**:
One lexical segment occurrence in an original-language edition: a whole word in Greek, a **morpheme** in Hebrew. Identified by a stable external id (`ow_id`). It is the shared hub that translation Tokens align to. (ADR-0003)
_Avoid_: lemma (dictionary form), Strong's (lexical id); assuming one written word is one Original Word

**Original-word segment**:
The grain of an Original Word. A Greek word is one Segment, a Hebrew word several. Ordered siblings rebuild the **Written Word**.

**Alignment**:
The many-to-many mapping from an edition's Tokens to Original Words. Reverse-interlinear is derived from it, never stored.
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

## Rules

- **Translations never link to each other directly.** They relate through a verse address (coarse) or an Original Word (fine). There is no Token-to-Token edge between editions.
- **Outside references point at addresses, never at row ids.** Row ids are rebuilt on every ingest. Addresses and external `ow_id`s are stable.
- **Every address names its scheme.** Moving between schemes goes through mapping data.
- **The tokenizer policy is part of the address.** A rule change is a migration.
