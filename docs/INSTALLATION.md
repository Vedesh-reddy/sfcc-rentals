# Installation

[← README](../README.md) · [Merchant guide](MERCHANT-GUIDE.md) · [Troubleshooting](TROUBLESHOOTING.md)

## Requirements

- An SFRA storefront (`app_storefront_base`) on Salesforce B2C Commerce.
- Node.js 22 or later to build and test.
- Business Manager access to import a site archive, edit cartridge paths, products, inventory, custom objects, roles and jobs.

## 1. Build

```sh
npm ci
npm run validate          # lint, 23 unit tests, builds cartridge/static/default/js/rentals.js
npm run package:metadata  # dist/rentals-metadata.zip
```

## 2. Deploy the cartridge

Upload `cartridges/plugin_rentals`, including the generated `cartridge/static`, to your code version with your usual tool, for example:

```sh
npx sgmf-scripts --uploadCartridge plugin_rentals
```

`dw.example.json` shows the expected `dw.json` fields. Keep `dw.json` out of Git.

## 3. Cartridge paths

**Storefront.** In **Administration → Sites → Manage Sites → your site → Settings**, put the cartridge first:

```text
plugin_rentals:app_storefront_base
```

With other overlays, keep `plugin_rentals` leftmost. Its overlays chain to the next cartridge through `module.superModule`:

- the `Cart` and `CheckoutServices` controllers;
- `checkoutHelpers` and `basketCalculationHelpers`;
- the `productLineItem` and `orderLineItem` models;
- `config/oAuthRenentryRedirectEndpoints`.

If another cartridge already uses login return slot `6`, change `LOGIN_RETURN` in `controllers/Rental.js` and the slot in the endpoint config.

Two SFRA templates are overlaid, each a copy with a small addition:

- `product/components/productAvailability.isml`, which gets the rental panel include;
- `cart/productCard/cartProductCardAvailability.isml`, which gets the rental dates line.

If another cartridge overrides either one, merge the addition into that copy.

**Business Manager.** In **Administration → Sites → Manage Sites → Business Manager Site → Settings**, add `plugin_rentals` to the cartridge path. The desk is a Business Manager extension (`bm_extensions.xml`).

## 4. Import metadata

The archive `metadata/rentals` contains:

| File | Contents |
| --- | --- |
| `meta/custom-objecttype-definitions.xml` | `RentalUnit`, `RentalUnitDay`, `RentalBooking` (site scope) |
| `meta/system-objecttype-extensions.xml` | Product `rentalEnabled`; ProductLineItem `rentalStart`, `rentalBookingNo`; the **Rentals** site preferences |
| `jobs.xml` | `Rentals-ReleaseHolds`, `Rentals-LateFees` |
| `sites/RefArch/preferences.xml` | `RentalsEnabled = true` |

1. Rename `sites/RefArch` to your site ID and set `site-id` in `jobs.xml`.
2. `npm run package:metadata`.
3. **Administration → Site Development → Site Import & Export**: upload and import `dist/rentals-metadata.zip`.

## 5. Rental products

1. Set `rentalEnabled` on the master product. Variants inherit it.
2. Give the product two options in its **master** catalog. Importing them into the storefront catalog fails with "Product belongs to another catalog".
   - `rentalDuration`: one value per duration. The value ID is the number of days, and its price is the surcharge over the price-book price.
   - `rentalDeposit`: a single value priced at the deposit.
3. Mark the rental variants **perpetual** in the inventory list. Availability comes from the calendar; platform stock must never be what stops a rental.

Catalog XML for the two options:

```xml
<product product-id="YOUR-MASTER-ID">
    <custom-attributes>
        <custom-attribute attribute-id="rentalEnabled">true</custom-attribute>
    </custom-attributes>
    <options>
        <option option-id="rentalDuration">
            <display-name xml:lang="x-default">Rental duration</display-name>
            <sort-mode>position</sort-mode>
            <option-values>
                <option-value value-id="3" default="true">
                    <display-value xml:lang="x-default">3 days</display-value>
                    <option-value-prices><option-value-price currency="USD">0</option-value-price></option-value-prices>
                </option-value>
                <option-value value-id="5" default="false">
                    <display-value xml:lang="x-default">5 days</display-value>
                    <option-value-prices><option-value-price currency="USD">40</option-value-price></option-value-prices>
                </option-value>
                <option-value value-id="7" default="false">
                    <display-value xml:lang="x-default">7 days</display-value>
                    <option-value-prices><option-value-price currency="USD">70</option-value-price></option-value-prices>
                </option-value>
            </option-values>
        </option>
        <option option-id="rentalDeposit">
            <display-name xml:lang="x-default">Refundable security deposit</display-name>
            <sort-mode>position</sort-mode>
            <option-values>
                <option-value value-id="standard" default="true">
                    <display-value xml:lang="x-default">Refunded after inspection</display-value>
                    <option-value-prices><option-value-price currency="USD">200</option-value-price></option-value-prices>
                </option-value>
            </option-values>
        </option>
    </options>
</product>
```

The element is `sort-mode`, and every `option-value` needs an explicit `default`. Without it, the import fails with a null pointer in `JAXOptionValue.isDefault`.

## 6. Units

Create one `RentalUnit` per physical piece, either in **Merchant Tools → Custom Objects → Custom Object Editor** or by import. Units are site-scoped, so the import file goes under `sites/<site>/custom-objects/`:

```xml
<custom-objects xmlns="http://www.demandware.com/xml/impex/customobject/2006-10-31">
    <custom-object type-id="RentalUnit" object-id="LEH-RED-M-01">
        <object-attribute attribute-id="productID">YOUR-VARIANT-ID</object-attribute>
        <object-attribute attribute-id="status">ACTIVE</object-attribute>
    </custom-object>
</custom-objects>
```

## 7. Desk permission

**Administration → Organization → Roles & Permissions → role → Business Manager Modules**: choose your site and tick **Rentals → Rental Desk**.

## 8. Jobs

**Administration → Operations → Jobs**:

| Job | Schedule | Purpose |
| --- | --- | --- |
| `Rentals-ReleaseHolds` | Every 15 minutes | Releases expired holds and bookings of cancelled or failed orders, and removes past day claims |
| `Rentals-LateFees` | Daily | Updates late fees, extends overdue units' blocks, flags bookings at risk |

## 9. Check

1. Open a rental product and choose a size, a duration and a start date: the panel shows the return date.
2. Add it to the bag: the message says the piece is held.
3. In a private window, try the same dates on the same size until no unit is left: the quote names the next free date, and adding is refused.
4. Check out: the cart line shows the dates and the deposit is not taxed.
5. Open the desk, find the order number and move the booking through dispatch, return, inspection and refund.
