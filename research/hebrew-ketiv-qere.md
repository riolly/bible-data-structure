# Hebrew written and read forms (ketiv and qere)

Status: decided 2026-11-10 in [ADR-0007](../docs/adr/0007-a-qere-is-a-reading-beside-the-written-words.md). WLC comes from upstream OSHB, and each qere is a row in `reading`. Raised in a review of step 3.

## The terms

In about 1,300 places the Hebrew Bible's consonants (the **ketiv**, "what is written") differ from the word tradition reads aloud (the **qere**, "what is read"). Manuscripts keep the written consonants in the line and give the reading in the margin. The vowel points in the line belong to the qere, so a printed ketiv is either unpointed or carries another word's vowels. Translations, KJV and BSB included, almost always follow the qere.

## What the pinned WLC has

ebible's `hboWLC` keeps only the ketiv, unpointed, and drops the qere. GEN 8:17 has `הוצא`, where tradition reads `הַיְצֵא` ("bring out"). In the corpus built on 2026-11-09, 1,336 WLC word tokens in verses have no vowel point or accent (the paragraph marks of ADR-0004 v1.3 not counted), which is about the ketiv count.

Upstream OSHB ([morphhb at `3d15126`][oshb]) keeps both. A ketiv is `<w type="x-ketiv">`, followed by `<note type="variant"><catchWord>…</catchWord><rdg type="x-qere"><w>…</w></rdg></note>` holding the pointed qere with its own lemma, morphology and id. Its `wlc/*.xml` has 1,268 ketiv words and 1,260 qere readings. The counts differ because some readings span several words and some have a reading with no written word.

## Why it matters

- **Alignment (ADR-0003).** English words translate the qere. Aligned to a ketiv-only text, they meet consonants with a different lemma, or no word at all where the qere has a word the ketiv lacks.
- **Word addresses (ADR-0004).** A word index counts the ketiv tokens. If the qere is added later as its own tokens in the same verse, every later index moves. Adding it as a separate layer keyed to the ketiv word does not.
- **Licensing.** OSHB's lemma and morphology are CC BY 4.0 ([licensing.md](licensing.md)). The qere's text is public domain, like the rest of WLC.

## The shapes in OSHB

Counted in the pinned `wlc/*.xml` (`src/ingest/oshb-xml.ts` reads them):

| Ketiv `<w>` | Qere `<w>` | Notes | Example |
|---|---|---|---|
| 1 | 1 | 1,212 | `GEN 8:17` הוצא, read הַיְצֵא |
| 1 | 2 | 16 | `2SA 18:20` על, read עַל־כֵּן |
| 2 | 1 | 9 | `1SA 9:1` מבן ימין, read מִבִּנְיָמִין |
| 2 | 2 | 8 | `1KI 17:15` הוא־והיא, read הִיא־וָהוּא |
| 1 | 0 | 6 | `2KI 5:18` נא, written and not read |
| 0 | 1 | 9 | `2SA 8:3` פְּרָת, read and not written |

That makes 1,260 notes, 1,268 ketiv `<w>` elements and 1,278 qere words. The rows above count elements. Twice two ketiv elements stand with no space between them, so they are one written word (`2KI 6:25` חרייונים, `JER 18:3`), and the corpus stores 1,266 ketiv words. Every ketiv word is followed by its note, with only a maqqef or another note in between (`JER 48:44` has an exegesis note there). A multi-word qere can hold a maqqef or a paseq between its words.

## Converting OSHB, checked against ebible's copy

ebible's `hboWLC` was made from an older OSHB. Tokenizing every verse of both:

- Both have the same 23,213 verses.
- In 10 verses ebible's copy leaked OSHB markup as text, around the 11 words with a large, small or suspended letter (`DEU 6:4` reads `'l s="H8085"'שְׁמַ֖'seg type="x-large"'ע'seg''/l'`). The corpus stored the fragments as words. OSHB's XML has the plain word.
- About 3,800 words differ only in how a doubled pashta accent is encoded: the pinned OSHB writes the first mark as U+05A8, ebible's copy as U+0599. A handful more were corrected upstream after ebible's copy, such as `DAN 2:39`, which became a ketiv with a qere.
- OSHB's `/` morpheme breaks, maqqef, sof pasuq, paseq and paragraph-mark segments convert to the same words as ebible's text.

OSHB's README advises against NFC for Hebrew, because NFC reorders some point sequences. The ingest has applied NFC to WLC since ADR-0004 v1.1, and this change keeps that.

## Decided

1. WLC moves to upstream OSHB at a pinned commit, as SBLGNT moved to upstream. OSHB marks the paragraph marks as their own elements, 1,181 `<seg type="x-pe">` and 1,981 `<seg type="x-samekh">`. The converter writes them as standalone letters, so ADR-0004 rule 6 still makes them punctuation.
2. A qere is a reading on a range of written words, not a second token stream (ADR-0007).

[oshb]: https://github.com/openscriptures/morphhb/tree/3d15126fb1ef74867fc1434be1942e837932691f/wlc
