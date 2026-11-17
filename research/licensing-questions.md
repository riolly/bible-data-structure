# Licensing questions to send

Two letters that only a person can send. API.Bible has answered. The Lockman letter is ready to paste. Put your name at the end, send it, and record the answer under "Answers" with its date. An answer that changes a limit also changes the edition's rights record in `src/contract/rights.ts`.

Both letters say what is true today: one developer, no registered organization. The facts behind each question are in [licensing.md](licensing.md), "Closed-license translations".

## To API.Bible

Send through the Contact link on [care.api.bible](https://care.api.bible/), API.Bible's help site, and name the account that owns the API key. API.Bible's terms cover "any individual or entity", so this letter can go out now.

> Subject: Four questions about the terms, for a free Bible reading app
>
> Hello,
>
> I am an individual developer, not an organization. I am building a free, non-commercial Bible reading app for English readers, with no ads, revenue, subscriptions or in-app purchases. It reads the NASB 1995, the NLT and the NIV through API.Bible on the Starter plan. Before I release it I want to be sure that four things are within your terms.
>
> 1. Converting the JSON for display. I request chapters with `content-type=json` and convert that JSON into my own chapter format, which the app draws on screen. I keep every word, the punctuation, the capitalization, the footnotes and the copyright line you send, and I change no text. Does this conversion count as a change to "any part of the structure or content" under section 4.1 of the terms?
> 2. Storing chapters on a device. The terms allow offline storage with a refresh every 30 days. The Express Licensing FAQ says caching is allowed and recommended, and the developer FAQ asks for fewer than 500 consecutive verses. May the app keep a whole Bible on the user's device for offline reading if it refreshes each chapter within 30 days? If not, what is the limit in verses or chapters, and does it differ between the NASB 1995, the NLT and the NIV?
> 3. Caching on my server. May my own server keep the chapters it fetched and serve them to the app, with the same 30-day refresh, so that each reader's request does not call your API?
> 4. Moving to an organization later. If I register an organization to publish the app, does the account and its Express license carry over, or do I apply again?
>
> I will follow whatever limits you give me. A written answer lets me build them into the app.
>
> Thank you,
> [name]

## To the Lockman Foundation

Send through Lockman's [Email Us form](https://www.lockman.org/email-us/), which takes a name, an email address, a subject and a message. The [permission to quote request form](https://www.lockman.org/permission-to-quote-request-form/) is for quoting verses in a work, not for licensing text files, so it doesn't fit. Nothing in the repo waits on this answer: NASB stays a Reading edition (ADR-0008) until a license for files with Strong's numbers exists. Lockman may only license to an organization, and the first question asks.

> Subject: License for NASB text files with Strong's numbers, for a free app
>
> Hello,
>
> I am an individual developer, not an organization. I am building a free, non-commercial Bible reading app for English readers. Today it shows the NASB 1995 through API.Bible, whose responses carry no Strong's numbers. I would like a reader to tap an English word and see the Hebrew or Greek word it translates, and that needs a Strong's number on each word of the NASB.
>
> 1. Do you license NASB 1995 text files with a Strong's number on each word to an individual developer of a free app, or only to an organization? Is the NASB 2020 available the same way?
> 2. Which file format would I receive (USFM, USX, OSIS or another), and does it mark the words the translators supplied, which print in italics?
> 3. What are the terms: the fee, the attribution text, and whether the app may keep the whole Bible on the user's device for offline reading and search?
> 4. Your permissions page allows up to 1,000 verses stored in an electronic retrieval system without written permission. API.Bible told me in writing that an app may keep a whole NASB 1995 on a device under its license, refreshing each chapter within 30 days. Can you confirm that your 1,000-verse limit does not apply to chapters received that way?
>
> Thank you,
> [name]

## Answers

- API.Bible: sent on 2026-11-14 through the help site's contact widget. Answered by 2026-11-17, in full below. Its effect on the rights records is in [licensing.md](licensing.md), "Answered on 2026-11-17".

  > Thanks for thinking this through so carefully before release, and for laying it out so clearly. Taking your four in order:
  >
  > Converting the JSON for display. This is fine and doesn't run against section 4.1. That section prohibits altering the structure or content of the text itself: the wording, punctuation, capitalization, verse and paragraph structure, footnotes, headings, and the attribution. Reformatting the delivery JSON into your own chapter model for rendering, while preserving all of that exactly as you describe, is a layout change, not a content change. Our own guidance says it plainly: you may change the font or layout, but not the content (for example, you can't remove "thee/thou" or change punctuation). You're keeping everything intact, so you're clear.
  >
  > Storing chapters on a device. Yes, you may keep a whole Bible on the device for offline reading, as long as each chapter is refreshed at least every 30 days, updated or removed if it changes on our side, removed within 24 hours if we ask, and kept in a protected local store rather than baked into the app binary. There is no cap on how much you may cache, so a full offline Bible is fine, and this is the same for the NASB 1995, the NLT, and the NIV. The "fewer than 500 consecutive verses" you saw is not a limit on offline storage; it concerns how many verses you pull or show in a single continuous passage, not how much your app caches over time. Because you fetch chapter by chapter, each request stays well within any passage-size limit, and the 30-day refresh is the rule that governs the cache.
  >
  > Caching on your server. Yes. Your own server may cache the chapters it fetches and serve them to your app under the same 30-day refresh and the same update and removal conditions. This is ordinary caching, and only your server's calls to us count toward your allowance, not each reader's request. Two things to keep in mind: keep that cache serving only your own app, not exposed as a general feed or redistributed to third parties, and keep your API key on the server rather than in the app. If any part of your app is web-based, FUMS reporting is required and should be reported per display, reusing the token from the original fetch; a purely native app with no web view is exempt.
  >
  > Moving to an organization later. If you keep your existing account and simply update your registration from individual to your new organization in your account and application details, your app, its API key, and its Express license stay in place, since you're updating information rather than creating a new entity. If instead you set up a separate new account under the organization and move the app there, that new account and app would go through Express Licensing again. So the simplest path for continuity is to update the organization details on your current account.
- Lockman Foundation: not sent.
