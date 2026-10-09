# Architecture

[← README](../README.md) · [Code reference](CODE-REFERENCE.md)

## Principles

- **Overlay only.** No SFRA file is edited.
  - Controllers extend base routes with `server.append` and `server.prepend`.
  - Helpers, models and the login endpoint map wrap `module.superModule`.
  - Two templates are SFRA copies with a small addition each.
- **Native pricing.** Duration and deposit are catalog options, so price books, promotions, cart totals and orders work unchanged. Code only moves the deposit to the tax-exempt class.
- **Platform inventory stays count-based.** Rental variants are perpetual. The calendar lives in custom objects and decides availability.
- **The database is the lock.** Correctness depends on the `RentalUnitDay` unique key, not on the availability check that runs before it.

## Request flows

```text
Product page (cached)
  └─ productAvailability.isml ─ remote include ─> Rental-Panel (uncached: login state, CSRF token)
        └─ rentals.js: date / size / duration change ─> Rental-Quote ─> available | next free start

Cart-AddProduct (prepend)
  ├─ validate: variant, start date, quantity 1, piece not already in the bag
  └─ hold(): quote, then claim a unit ─> RentalBooking HELD + RentalUnitDay rows with holdExpiresAt
Cart-AddProduct (append) ─> attach the hold to the new line, or release it if no line was created
Cart-RemoveProductLineItem ─> release the hold
Cart-UpdateQuantity / Cart-EditProductLineItem (prepend) ─> refuse changes to a rental line

CheckoutServices-PlaceOrder (prepend) ─> every rental line still owns its days? renew holds : refuse
checkoutHelpers.placeOrder ─> confirmOrder(): clear expiry, RESERVED, record fee, deposit, customer
basketCalculationHelpers.calculateTotals ─> deposit option line → tax-exempt class

Rental-BookTrial (POST, login, CSRF) ─> claim 1 day, no buffer ─> RentalBooking TRIAL RESERVED
Rental-Bookings (login) ─> the shopper's bookings

RentalDesk-Start / -Show / -Action (Business Manager, module permission, CSRF)
```

## Booking states

```text
RENTAL
  HELD ───────────── order placed ───────────────────────→ RESERVED
  HELD ───────────── hold expired (job) ─────────────────→ EXPIRED
  HELD ───────────── line removed, or desk cancel ───────→ CANCELLED
  RESERVED ───────── dispatch ───────────────────────────→ DISPATCHED
  RESERVED ───────── desk cancel, or order cancelled/failed → CANCELLED
  DISPATCHED ─────── deliver ────────────────────────────→ WITH_CUSTOMER
  DISPATCHED or WITH_CUSTOMER ── receive (fixes late fee) → RETURNED
  RETURNED ───────── inspect ────────────────────────────→ INSPECTED
  INSPECTED ──────── refund ─────────────────────────────→ DEPOSIT_REFUNDED

TRIAL
  RESERVED ───────── complete ───────────────────────────→ COMPLETED
  RESERVED ───────── cancel ─────────────────────────────→ CANCELLED
```

Cancel and expiry delete the booking's day rows. All other transitions keep them, so the history of a unit's calendar stays until `Rentals-ReleaseHolds` removes days before yesterday.

## Data model

| Type | Key | Written by | Read by |
| --- | --- | --- | --- |
| `RentalUnit` | unit tag | merchant, inspection (maintenance) | claims, desk |
| `RentalUnitDay` | `unit\|yyyy-MM-dd` | claim, hold renewal, release, late-fee job | quotes, claims, hold checks |
| `RentalBooking` | `RB` + 10 characters | claim, order confirmation, desk, jobs | desk, My rentals, checkout |

The line items carry `rentalStart` and `rentalBookingNo`. Cart and order pages read the dates from the line, not from the booking.

## Concurrency

- **Claiming.** A claim creates every day row of the booking and the booking itself in one `Transaction.wrap`. `createCustomObject` on an existing key throws, and a concurrent commit of the same key fails on the unique index. Either way the whole transaction rolls back, so a losing claim leaves no partial days and no booking. The engine then tries the next unit of the same variant, in tag order.
- **Expired holds.** Expired holds are deleted in a separate transaction per day before the claim. Each row is re-read inside that transaction and deleted only if still expired. Deleting and re-creating the same key in one transaction is avoided on purpose.
- **Renewing.** Renewal writes the new expiry first and then counts the booking's rows. An expired hold whose day another shopper purged therefore comes back short and fails, instead of passing a stale check.
- **Removing a refused line.** The platform refuses to add and remove a line in the same request (`api.basket.addRemoveInSameRequest`). So the unit is claimed before the base `Cart-AddProduct` creates the line, and a refused claim never creates one.
- **Overdue units.** The late-fee job reuses an abandoned row rather than deleting and re-creating it. It stops at the first day another live booking owns, and flags that booking *at risk* instead of taking the day.

## Security

- **CSRF.** Every state-changing route validates CSRF: `Rental-BookTrial` with the SFRA AJAX middleware, and the desk with `CSRFProtection.validateRequest`. The desk's multipart inspection form carries the token in its action URL.
- **Server-side input checks.** Dates are validated as real calendar days inside the booking window. Amounts must be non-negative numbers, and the deduction can't exceed the deposit. Text fields are trimmed and length-capped.
- **Photo uploads.**
  - Only JPEG, PNG and WebP types are stored, at most four per inspection and 2 MB each.
  - File names are generated by the server; the uploaded name is never used.
  - Photos are read back only by name from the booking's own folder.
- **Desk access** is governed by the Business Manager module permission of the *Rental Desk* menu action.
- **Logging.** Logs use `Logger.getLogger('rentals', <category>)`. The categories are `rental-calendar`, `rental-bookings`, `rental-desk`, `rental-holds` and `rental-late-fees`. Logs record booking, unit and order numbers and the BM user name, never payment data.
