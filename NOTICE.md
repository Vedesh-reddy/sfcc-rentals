# Attribution and terms

This repository contains the `plugin_rentals` extension developed by Vedesh Reddy for
Salesforce Storefront Reference Architecture (SFRA) storefronts, plus two template overlays
derived from SFRA. It is an SFRA extension, not an official Salesforce product.

The following overlays are adapted from SFRA templates, each with a small addition:

- `product/components/productAvailability.isml`
- `cart/productCard/cartProductCardAvailability.isml`

The cartridge also uses `module.superModule` to wrap these SFRA modules:

- `checkoutHelpers`
- `basketCalculationHelpers`
- the `productLineItem` and `orderLineItem` models
- `oAuthRenentryRedirectEndpoints`

It extends the `Cart` and `CheckoutServices` controllers, and uses SFRA's `server` module, middleware and helpers.
The applicable Salesforce terms are preserved in [SFRA-TERMS.txt](licenses/SFRA-TERMS.txt).

No MIT, Apache, or other open-source license is granted by this repository.
The npm package is marked private and `UNLICENSED`; it is not intended for npm publication.

Screenshots were captured on the author's sandbox on October 9, 2026.
Salesforce and Commerce Cloud names belong to their respective owners.
