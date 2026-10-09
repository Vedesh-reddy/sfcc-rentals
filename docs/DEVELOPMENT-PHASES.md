# Development phases

[← README](../README.md)

The working implementation is organized into five reviewable delivery phases. These branches describe the repository's packaging and review structure; they do not claim to reproduce the original chronological development history.

Each phase has a dedicated feature branch and PR targeting `main`. Phases are merged in order, keeping their branches and merge commits for reference.

| Phase | Feature branch | Scope | Pull request |
| --- | --- | --- | --- |
| 01 · Foundation | `feature/phase-01-foundation` | Cartridge identity, job step types, custom objects, attributes, preferences, jobs | [PR #1](https://github.com/Vedesh-reddy/sfcc-rentals/pull/1) |
| 02 · Engine and jobs | `feature/phase-02-engine-jobs` | Reservation engine, booking lifecycle, checkout and tax wrappers, job steps, unit tests | [PR #2](https://github.com/Vedesh-reddy/sfcc-rentals/pull/2) |
| 03 · Storefront and desk | `feature/phase-03-storefront-desk` | Controllers, line item models, login return slot, templates, browser module, Business Manager desk | [PR #3](https://github.com/Vedesh-reddy/sfcc-rentals/pull/3) |
| 04 · Tooling and quality | `feature/phase-04-tooling-quality` | npm dependencies, build, lint checks, metadata ZIP, GitHub Actions, PR template, contributing guide | [PR #4](https://github.com/Vedesh-reddy/sfcc-rentals/pull/4) |
| 05 · Documentation | `feature/phase-05-documentation` | Per-feature README with highlighted screenshots, guides, attribution | [PR #5](https://github.com/Vedesh-reddy/sfcc-rentals/pull/5) |

The same cartridge is integrated in [SFCC-RefArch](https://github.com/Vedesh-reddy/SFCC-RefArch) through PRs #33–#37.

## Review order

1. Start with the metadata. The `RentalUnitDay` key is the lock everything else relies on.
2. Then read `rentalCalendar.js` (`claim`, `renewHold`, `extendOverdue`) and its tests, especially the concurrent-claim rollback.
3. Next, `rentalBooking.js` for the basket hold, order confirmation and desk lifecycle.
4. Then the `Cart-AddProduct` and `CheckoutServices-PlaceOrder` prepends.
5. Finish with the templates, the browser code and the desk.

The screenshots follow each feature end to end.

The final `main` branch contains all five phases. Build output is generated locally or downloaded from a successful GitHub Actions run; it is not committed.
