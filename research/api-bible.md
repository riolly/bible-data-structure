# API.Bible as a provider

Status: noted 2026-11-12 from live calls with our Starter key. Plan step 10. The license terms are in `licensing.md`, closed-license translations.

## The key

The key is `API_BIBLE_KEY` in `.env` at the repo root, which git ignores. Send it as the `api-key` header. `https://rest.api.bible/v1` and `https://api.scripture.api.bible/v1` gave the same answers on 2026-11-12. Starter allows 5,000 calls a month, so fetch each chapter once and keep it (`licensing.md`).

## Which Bibles the key reaches

`GET /v1/bibles?language=eng` lists the Bibles the key may read. On 2026-11-12 it listed 38 English Bibles. Every copyrighted one was among the three the plan allows: CSB (`a556c5305ee15c3f-01`), NASB 1995 (`b8ee27bcd1cae43a-01`) and NKJV (`63097d2a0a2f7db3-01`). The rest are public domain or open, among them KJV (`de4e12af7f28f599-02`, Protestant canon, and `-01`, with the deuterocanon), BSB, WEB and Brenton.

The owner then chose NASB 1995, NLT and NIV in the dashboard. By the evening of 2026-11-12 the key reached NLT (`d6e14a625393b4da-01`) and NIV 2011 (`78a9f6124f344018-01`), and the list still showed CSB and NKJV.

## A chapter

```
GET /v1/bibles/{bibleId}/chapters/{BOOK}.{n}?content-type=json&include-notes=true
    &include-titles=true&include-chapter-numbers=true&include-verse-numbers=true
    &include-verse-spans=false
```

`data` holds `id` (`JHN.3`), `bookId` (the USFM code), `number`, `reference`, `copyright`, `verseCount`, `next`, `previous` and `content`. A book's introduction is the chapter `intro`. `meta.fumsToken` is the usage token that section 3.3 of the terms asks web apps to report.

`content` is USX turned into JSON. Each node is `{type: "text", text}` or `{type: "tag", name, attrs, items}`, and `attrs.style` holds the USFM marker:

| `name` | `attrs` | Our USJ |
|---|---|---|
| `chapter` | `number`, `style: "c"`, `sid` | `{type: "chapter", marker: "c", number, sid}`. `items` repeats the number, and USJ leaves it out |
| `verse` | `number`, `style: "v"`, `sid` | `{type: "verse", marker: "v", number, sid}`, same |
| `para` | `style` | `{type: "para", marker: style, content}` |
| `char` | `style` (`closed` inside notes) | `{type: "char", marker: style, content}` |
| `note` | `caller`, `style`, `id`, `verseId` | `{type: "note", marker: style, caller, content}` |
| `verse-span` | `verseId`, `verseOrgIds` | Only with `include-verse-spans=true`. A wrapper, unwrapped |

Text nodes carry `verseId` and `verseOrgIds` (`PSA.3.1` and `PSA.3.2` in KJV), which is API.Bible's own mapping to the Hebrew numbering. We map through our pivot (ADR-0006) and drop these.

Not seen yet: published or alternate verse numbers (`\vp`, `\va`).

## Samples

| Bible | Chapter | Markers |
|---|---|---|
| KJV `de4e12af7f28f599-02` | JHN 3 | `c p v wj add` |
| KJV | PSA 3 | `c d q1 b v nd add f fr ft` |
| NASB 1995 | JHN 3 | `c s p v wj it f ft`, plus `verse-span` when asked |
| NASB 1995 | PSA 119 | 176 verse units, no unsupported marker |

API.Bible's KJV prints the pilcrow (`¶ For God so loved`) at six verses of John 3, the same six as our ebible KJV. An earlier note here said ebible's had none, which was wrong. Verse text leaves the pilcrow out ([source-markup.md](source-markup.md)). The two KJV chapters are committed as fixtures (`src/provider/fixtures/`), because the KJV is public domain. The NASB sample stays off the repo.

Every marker in the samples is on our supported list (ADR-0001, step 7 amendment). `src/provider/api-bible.ts` converts the JSON, and keeps the text of any marker outside the list. `bun run api-bible:chapter NASB95 PSA 119` prints a chapter's verse units, stamp and unsupported markers.

## Whole editions, for their schemes

`GET /v1/bibles/{bibleId}/passages/{start}-{end}` returns at most 200 verses from `start` and names the range it returned in `data.id` (`PSA.1.1-PSA.18.21`). A start past a chapter's end begins at the next chapter, and an end past the book's end is fine, so `bun run api-bible:facts NASB95` walks each book from `BOOK.1.1` to `BOOK.<last>.999`. A Bible takes 196 calls. The passages stay in `build/api-bible/` and the counts go to `src/provider/facts/<edition>.json` (ADR-0006, licensed editions amendment).

Collected 2026-11-12:

| Edition | Against `kjv` | Bridges | Numbers with no unit | Markers outside our list |
|---|---|---|---|---|
| NASB 1995 | 3 John ends at 15 | none | none | `\bd`, `\bdit` |
| NIV 2011 | 3 John ends at 15 | none | none | `\lh`, `\lf`, `\litl`, `\pm`, `\po`, `\qm1`, `\qm2`, `\qc`, `\pr`, `\iex`, `\pmc`, `\fv`, `\cat`, and `ref` inside notes |
| NLT | 3 John ends at 15, Revelation 12 at 18: `eng`'s numbering | 24, in Numbers 1-2 (1:20-21 to 2:29-30) | the 16 verses BSB also lacks (`MAT 17:21` and the rest) | `\pm`, `\qm1`, `\qm2`, `\lim1`, `\fv`, `\sup`, and 17 tables |

Each edition's 116 Psalm titles fall on KJV's titled Psalms. NIV and NLT print them as `\d`. NASB 1995 prints `\ms PSALM 3`, an editor's `\s` heading, then the title as another `\ms` (`\ms BOOK 2` stands above Psalm 42), so its edition entry tests for that.

Each edition has its own scheme derived from `kjv` (`nasb95`, `niv`, `nlt`, in `src/ingest/schemes.ts`), as BSB does, because the text tests give it its own rows. NIV and NLT take the critical order of Philippians 1:16-17, as BSB does. NASB 1995 prints that order too, but its counts (18 against 21) are too close for the test, so `nasb95` records the decision by hand (`textDecisions`, ADR-0006, #20).
