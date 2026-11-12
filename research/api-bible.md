# API.Bible as a provider

Status: noted 2026-11-12 from live calls with our Starter key. Plan step 10. The license terms are in `licensing.md`, closed-license translations.

## The key

The key is `API_BIBLE_KEY` in `.env` at the repo root, which git ignores. Send it as the `api-key` header. `https://rest.api.bible/v1` and `https://api.scripture.api.bible/v1` gave the same answers on 2026-11-12. Starter allows 5,000 calls a month, so fetch each chapter once and keep it (`licensing.md`).

## Which Bibles the key reaches

`GET /v1/bibles?language=eng` lists the Bibles the key may read. On 2026-11-12 it listed 38 English Bibles. Every copyrighted one was among the three the plan allows: CSB (`a556c5305ee15c3f-01`), NASB 1995 (`b8ee27bcd1cae43a-01`) and NKJV (`63097d2a0a2f7db3-01`). The rest are public domain or open, among them KJV (`de4e12af7f28f599-02`, Protestant canon, and `-01`, with the deuterocanon), BSB, WEB and Brenton.

The owner then chose NASB 1995, NLT and NIV in the dashboard. Later that day the list still showed CSB, NASB 1995 and NKJV, so the change hadn't reached the key yet. Check the list again before any NLT or NIV work.

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

Not seen yet: published or alternate verse numbers (`\vp`, `\va`) and a verse bridge. NLT Numbers 1:20-21 will show whether a bridge's `number` is `20-21`, as `\v 20-21` gives in USFM.

## Samples

| Bible | Chapter | Markers |
|---|---|---|
| KJV `de4e12af7f28f599-02` | JHN 3 | `c p v wj add` |
| KJV | PSA 3 | `c d q1 b v nd add f fr ft` |
| NASB 1995 | JHN 3 | `c s p v wj it f ft`, plus `verse-span` |

API.Bible's KJV prints the pilcrow (`¶ For God so loved`) and our ebible KJV doesn't, so they are two editions. The two KJV chapters are committed as fixtures (`src/provider/fixtures/`), because the KJV is public domain. The NASB sample stays off the repo.

Every marker in the samples is on our supported list (ADR-0001, step 7 amendment). `src/provider/api-bible.ts` converts the JSON, and keeps the text of any marker outside the list.
