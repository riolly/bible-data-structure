# bible-data-structure: domain language

The vocabulary of the Bible data model: which books exist, how text is addressed, how editions relate, and how text breaks into units. App concepts (reading modes, marks, layout) don't belong here. When a term changes, update it here first.

Terms marked *(planned)* are decided in an ADR but not yet in the code.

## Books and canons

**Book**:
One book of scripture, identified by its **USFM book code** (`GEN`, `PSA`, `JHN`, `TOB`, `1MA`). Names, abbreviations and slugs are display data per language, never ids. (ADR-0002)
_Avoid_: using an English name or slug as an id

**Canon** *(planned)*:
A named, ordered list of book codes that a tradition counts as scripture: Protestant 66 now, Catholic 73, Orthodox and Ethiopian lists later. Testament, grouping and order are properties of a canon's list, not of the book. (ADR-0002)
_Avoid_: assuming every Bible has 66 books or the same order

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

**Verse address**:
A book, chapter and verse **under a named versification scheme**. An address without a scheme is ambiguous. *(Today's code still uses one fixed av11n/KJV scheme.)*
_Avoid_: reference, citation (those are human-written strings that resolve to an address)

**Scheme mapping**:
Data that moves a verse address from one versification scheme to another, including splits, merges and verses absent in one scheme. *(Today: `versification_map`, a sparse table from an edition's native numbering to av11n, built from `.vrs` files.)*

**Word address**:
A verse address plus a **word index**: the 0-based ordinal of a word Token in that verse, punctuation excluded. A punctuation Token is addressed by the word it follows. Valid only for one edition, since editions differ in words. Its meaning depends on the tokenizer policy (ADR-0004).

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

**Segment**:
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
