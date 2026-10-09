# Testing and validation

[← README](../README.md) · [Code reference](CODE-REFERENCE.md)

## Repeatable local checks

```sh
npm ci
npm run validate          # lint (JS, ISML, docs links) + tests + build
npm run package:metadata  # dist/rentals-metadata.zip
```

CI runs the same on Node 22 and 24 for every push and pull request.

## Unit tests (23)

`test/unit/plugin_rentals/harness.js` is a small in-memory Script API double. It provides:
- custom objects with a unique key per type
- transaction rollback that restores deleted and changed rows
- queries with `AND`, `OR`, comparisons and parentheses
- a switch that hides committed day rows from queries, to simulate a claim that races past the availability check

| Area | Covers |
| --- | --- |
| Calendar | Real calendar days only, buffer days across a year end, booking window |
| Quotes | Next free start after return and cleaning; a new rental can't run into the next one's start |
| Claims | One unit per day with fallback to the next unit; maintenance units skipped; the concurrent claim rolled back with no partial rows; expired holds taken over, live holds never; size trials without buffer; release |
| Overdue | Unit block extended; the next booking flagged at risk; late fee per day |
| Desk | Full lifecycle from dispatch to refund, with tracking, damage limit, photos, maintenance and history; actions out of order refused; refund never below zero; cancel frees the days |
| Basket and order | Duration from posted options or the default; hold before the line exists; attaching only to a matching line; checkout refusal for missing holds and quantity above 1; confirmation with the amounts paid |

## Sandbox checks behind the screenshots

These checks ran on sandbox `zyeu-002`, site `RefArch_Practice`, on October 9, 2026. The demo was the Floral Dress `25592581M` with:
- options at +$0, +$40 and +$70 for 3, 5 and 7 days
- a $200 deposit
- one unit in size 4, two in size 6 and one in size 8

A headless browser drove the storefront and the desk. The desk login was approved in Salesforce Authenticator.

| Check | Result |
| --- | --- |
| Size 4, 5 days, from 3 Nov | "Available from 3 Nov 2026. Please return it by 7 Nov 2026."; price $369 |
| Add to bag | "We are holding the piece for you for 30 minutes"; cart line "Rental: 3 Nov 2026 to 7 Nov 2026" |
| Second shopper, size 4, 3 days, from 5 Nov | "These dates are taken. The next free start date is 10 Nov 2026."; adding anyway refused |
| Cart tax | $8.95 = 5% of $129 + $40 + $9.99 shipping; the deposit untaxed |
| Guest order 00000312, size 6, 3 days | Placed |
| Registered order 00000313, size 8, 7 days | Tax $10.75 = 5% of $199 + $15.99; booking `RESERVED` with fee $199 and deposit $200 |
| Size trial on 15 Oct | Booked; listed in My rentals and in the desk's trial queue |
| Desk on 00000313 | Dispatched with tracking, delivered, returned with 0 late days, inspected with $35 and a photo, unit sent to maintenance, refunded $165 with a reference |
| My rentals after the refund | "Deposit refunded", "Refunded $165.00", "Deducted $35.00" |

Not exercised live:
- the two jobs, which were imported but not run;
- late fees, because no booking could end before the capture date;
- cancellation of a placed order.

Unit tests cover all of these.

## Defects found on the sandbox and fixed

| Symptom | Cause | Fix |
| --- | --- | --- |
| The rental panel disappeared after choosing a duration | SFRA re-renders `.product-options` from the variation response, where a remote include cannot run | The panel moved to `productAvailability.isml`, outside that block |
| Adding a taken date failed with a server error instead of a message | Quota `api.basket.addRemoveInSameRequest`: the line was added, then removed when the claim failed | The unit is claimed before the base route creates the line |
| Catalog import rejected the options | The element is `sort-mode`; option values without `default` crash the importer | Corrected XML in the installation guide |
| Units not imported | `RentalUnit` is site-scoped | Unit files go under `sites/<site>/custom-objects/` |
