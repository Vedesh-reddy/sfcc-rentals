# Troubleshooting

[← README](../README.md) · [Installation](INSTALLATION.md)

| Symptom | Likely cause | Fix |
| --- | --- | --- |
| No rental panel on the product page | `RentalsEnabled` off; product not `rentalEnabled`; another cartridge overrides `productAvailability.isml` | Check the preference and the attribute; merge the include into the other override |
| Panel disappears after choosing a duration | The include was moved into `product/components/options.isml` | Keep it outside `.product-options`, which SFRA re-renders |
| Every date says "fully booked" | No `ACTIVE` `RentalUnit` for the selected **variant** | Create units with `productID` set to the variant ID |
| "Please choose a size first" | The master product is selected | Select a size; units belong to variants |
| "Please choose a rental duration" | The product has no `rentalDuration` option, or its value IDs are not numbers | Add the option with value IDs `3`, `5`, `7` |
| Add to bag fails with "out of stock" | Platform inventory is not perpetual for the variant | Mark the variant perpetual in the inventory list |
| Deposit is taxed | Another cartridge's `basketCalculationHelpers` sits left of `plugin_rentals` and does not call `module.superModule` | Put `plugin_rentals` first, or chain the other wrapper |
| No dates on cart lines | Another cartridge overrides `cartProductCardAvailability.isml` | Merge the rental dates line into that override |
| Checkout says the hold ran out | The shopper waited past `RentalHoldMinutes` and another shopper took a day | Remove the line and pick new dates; raise the preference if this is common |
| Catalog import: `Invalid content … sorting-mode` | Wrong element name | Use `sort-mode` |
| Catalog import: `NullPointerException … JAXOptionValue.isDefault` | An option value without `default` | Add `default="false"` to every non-default value |
| Units skipped: "site scope but this import is for organization scope" | File under `custom-objects/` | Move it to `sites/<site>/custom-objects/` |
| Desk: "You tried to access a module without permissions" | Role lacks the module, or no site selected | Grant **Rentals → Rental Desk** for the site; open the desk from the site's menu |
| Desk menu missing | `plugin_rentals` not on the Business Manager cartridge path | Add it to the Business Manager Site's cartridge path |
| Desk action says the session expired | CSRF token too old | Reload the booking page |
| Photos not saved | Wrong type, larger than 2 MB, or more than four | Use JPEG, PNG or WebP within the limits |
| Job ends with `ERROR` | A booking failed | Check the `rentals` log; the next run retries |
