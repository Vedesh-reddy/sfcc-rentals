# Merchant guide

[← README](../README.md) · [Installation](INSTALLATION.md)

## Site preferences

**Merchant Tools → Site Preferences → Custom Preferences → Rentals**

| Preference | Default | Effect |
| --- | --- | --- |
| `RentalsEnabled` | false | Switches the panel, cart and checkout checks, and the `Rental-*` routes on or off |
| `RentalLeadDays` | 3 | Earliest start, in days from today; time to dispatch |
| `RentalHorizonDays` | 180 | Latest start, in days from today |
| `RentalBufferDays` | 2 | Cleaning and return-transit days blocked after each rental |
| `RentalHoldMinutes` | 30 | How long a piece stays held in the bag |
| `RentalLateFeePerDay` | 500 | Late fee per day, in the site currency, deducted from the deposit |

Changing `RentalBufferDays` applies to new bookings. Existing bookings keep the days they claimed.

## Products and pricing

- **Turning a product on.** Set `rentalEnabled` on the master; variants inherit it. Each variant is a size, and units belong to a variant.
- **Duration prices.** Set them on the `rentalDuration` option values. The value ID is the number of days, and its price is added to the price-book price, so a common setup prices the variant at the shortest rental and uses +0 for it.
- **Deposit.** Set it on the single `rentalDeposit` value. It is refundable and tax-exempt.

## Units

**Merchant Tools → Custom Objects → Custom Object Editor → `RentalUnit`**

| Attribute | Use |
| --- | --- |
| Key | The unit's tag, printed on the garment bag |
| `productID` | The variant ID, which fixes the size |
| `status` | `ACTIVE` can be booked. `MAINTENANCE` is set by an inspection or by hand. `RETIRED` takes the piece out for good. |
| `notes` | Condition notes |

Setting a unit back to `ACTIVE` makes it bookable again. Existing bookings on a unit in maintenance are not moved; use the desk to cancel them, or swap the piece.

## The rental desk

*Merchant Tools → Rentals → Rental Desk*

| Queue | What to do |
| --- | --- |
| To dispatch | Pack the piece and record the courier tracking number |
| Size trials | Prepare the piece for the studio visit; close the trial afterwards |
| Out with customers | Mark delivery; record the return when the piece arrives. **OVERDUE** means past the return date. |
| Returned, awaiting inspection | Inspect, record any damage with photos, send the unit to maintenance if needed |
| Inspected, deposit to refund | Refund the amount shown through your payment provider, then record its reference |
| At risk | The unit is still out with the previous customer. Swap in another unit or call the customer. |

The refund due is the deposit minus the damage deduction and the late fee, never below zero. The desk does not send money; it records what was refunded.

## Jobs

| Job | What to expect |
| --- | --- |
| `Rentals-ReleaseHolds` | Expires holds older than `RentalHoldMinutes`, cancels bookings whose order was cancelled or failed, and deletes day claims before yesterday. `ERROR` means a booking could not be released; see the `rentals` log. |
| `Rentals-LateFees` | Updates the running late fee of overdue rentals and keeps their units blocked. A booking it puts at risk appears in the desk's *At risk* queue. |

## Custom objects

| Type | Use it to |
| --- | --- |
| `RentalUnit` | Add pieces, retire them, or take them out for maintenance. |
| `RentalBooking` | See any booking's status, dates, unit, order, amounts, damage, refund and history. Use the desk to change it. |
| `RentalUnitDay` | Do not edit. Each row is one day of one unit claimed by a booking; the key guarantees a day is never sold twice. |

## Orders

Every rental line carries `rentalStart` and `rentalBookingNo`. The booking stores the order number, so the desk can look up a booking by order. Cancelling the order in Business Manager frees the dates on the next `Rentals-ReleaseHolds` run.
