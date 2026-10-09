# Code reference

[← README](../README.md) · [Architecture](ARCHITECTURE.md) · [Testing](TESTING.md)

All paths are under `cartridges/plugin_rentals/cartridge`.

## Controller routes

| Route | Method | Middleware | Behavior |
| --- | --- | --- | --- |
| `Rental-Panel` | GET | Remote include only, CSRF token | Uncached panel: date input, size-trial form or sign-in link (`Login-Show?rurl=6`), My rentals link |
| `Rental-Quote` | GET | Rentals on | JSON `{available, nextStart, message}` for `pid`, `duration`, `start` |
| `Rental-BookTrial` | POST | HTTPS, rentals on, logged in (AJAX), AJAX CSRF | Books a one-day trial; at most two active per shopper |
| `Rental-Bookings` | GET | HTTPS, rentals on, logged in | The shopper's bookings, newest first, up to 50 |
| `Cart-AddProduct` | prepend | — | Validates the rental request and claims a unit before the line is created |
| `Cart-AddProduct` | append | — | Attaches the hold to the new line, or releases it |
| `Cart-UpdateQuantity` | prepend | — | Keeps a rental line at quantity 1 |
| `Cart-EditProductLineItem` | prepend | — | Refuses edits to a rental line |
| `Cart-RemoveProductLineItem` | prepend + append | — | Releases the hold of the removed line |
| `CheckoutServices-PlaceOrder` | prepend | — | Renews every hold and refuses the order if a line lost its days |
| `RentalDesk-Start` | GET | BM module permission | Queues, and lookup by booking or order number |
| `RentalDesk-Show` | GET | BM module permission | One booking, its photos, history and allowed actions |
| `RentalDesk-Action` | POST | BM module permission, CSRF | Applies one action; saves inspection photos |

When `RentalsEnabled` is off, the `Rental-*` routes answer 404 (the panel renders nothing) and the cart and checkout extensions do nothing.

## Script modules

### `scripts/rentals/rentalCalendar.js`

The reservation engine. It knows units, days and claims, but nothing about baskets.

| Export | Purpose |
| --- | --- |
| `pref(name, fallback)` | Site preference with a default |
| `addDays(day, count)` / `daysBetween(from, to)` | Date arithmetic on `yyyy-MM-dd` strings at UTC midnight |
| `isDay(value)` | `true` for a real calendar day; rejects `2026-02-30` |
| `today()` / `formatDay(day)` | Today in the site time zone; a day as `14 Nov 2026` |
| `bookingWindow()` | First and last allowed start date |
| `blockedDays(start, duration, buffer)` | The days a booking keeps a unit away from others |
| `query(type, condition, args)` | Custom object query; closes the iterator in `finally` |
| `quote(productID, start, duration)` | Validity, availability, end date and the next free start |
| `claim(request)` | Claims a free unit for a rental or trial; `null` when none is free |
| `renewHold(booking, expiresAt)` | Moves or clears the hold expiry; `false` if the booking lost a day |
| `release(booking, status)` | Deletes the day rows and sets `CANCELLED` or `EXPIRED` |
| `extendOverdue(booking, day)` | Extends an overdue unit's block; returns the booking put at risk |

### `scripts/rentals/rentalBooking.js`

Ties bookings to baskets and orders, and runs the desk lifecycle.

| Export | Purpose |
| --- | --- |
| `enabled()` / `isRental(product)` | Feature switch; `rentalEnabled` on the product (variants inherit it) |
| `durationOf(pli)` | Days from the line's `rentalDuration` option |
| `durationFromOptions(product, options)` | Days from the posted add-to-cart options, or the option's default |
| `hold(product, start, duration)` | Quote and claim with a hold expiry; `{booking, error}` |
| `attachHold(pli, booking)` | Writes `rentalStart` and `rentalBookingNo` on a matching line |
| `validateBasket(basket)` | Renews every line's hold; error key when one is missing or lost |
| `confirmOrder(order)` | `RESERVED`, order and customer, fee and deposit from the option lines |
| `decorate(model, pli)` | Adds `rental.start` and `rental.end` to a line item view model |
| `releaseHold(bookingNo)` | Releases a `HELD` booking |
| `lateFee(endDate, returnDay)` / `refundDue(booking)` | Late days and fee; deposit minus damage and late fee, not below zero |
| `amount(value)` | Non-negative amount rounded to cents, `NaN` otherwise |
| `advance(booking, action, input, user)` | Applies one entry of `ACTIONS`; error key or `null` |
| `savePhotos(params, bookingNo)` / `photoData(bookingNo, name)` | Stores multipart uploads in IMPEX; reads one back as a data URI |

### Wrappers

| Module | Wraps | Adds |
| --- | --- | --- |
| `scripts/checkout/checkoutHelpers.js` | `placeOrder` | Confirms the bookings after a successful placement; failures are logged and never fail the order |
| `scripts/helpers/basketCalculationHelpers.js` | `calculateTotals` | Moves `rentalDeposit` option lines to `TaxMgr.taxExemptTaxClassID` |
| `models/productLineItem/productLineItem.js`, `orderLineItem.js` | model factories | `decorate()` |
| `config/oAuthRenentryRedirectEndpoints.js` | endpoint map | Login return slot `6` → `Rental-Bookings` |

## Job steps

| Step type | Module | Function |
| --- | --- | --- |
| `custom.Rentals.ReleaseHolds` | `scripts/jobs/releaseRentalHolds.js` | `execute`: expired holds, bookings of cancelled or failed orders, day rows before yesterday |
| `custom.Rentals.LateFees` | `scripts/jobs/rentalLateFees.js` | `execute`: `DISPATCHED` or `WITH_CUSTOMER` bookings past their end date |

Both are `transactional: false`. Each booking gets its own transaction, and a step returns `ERROR` when any booking failed.

## Templates

| Template | Rendered by |
| --- | --- |
| `product/components/productAvailability.isml` | SFRA copy + `Rental-Panel` remote include |
| `cart/productCard/cartProductCardAvailability.isml` | SFRA copy + the rental dates line |
| `rental/panel.isml` | `Rental-Panel` |
| `rental/bookings.isml` | `Rental-Bookings` |
| `rental/bm/desk.isml`, `rental/bm/rows.isml` | `RentalDesk-Start` |
| `rental/bm/booking.isml` | `RentalDesk-Show` |

Text lives in `templates/resources/rentals.properties`. Storefront templates use Bootstrap utilities that exist in both Bootstrap 4 and 5. Desk templates use Business Manager's own table classes inside `application/MenuFrame`.

## Browser module

`client/default/js/rentals.js` is built to `static/default/js/rentals.js`. It:

- asks `Rental-Quote` whenever the date, size or duration changes, and announces the answer in an `aria-live` region;
- adds the start date to the add-to-cart request through the SFRA `updateAddToCartFormData` event;
- posts the size-trial form and shows the result, or follows the sign-in redirect.
