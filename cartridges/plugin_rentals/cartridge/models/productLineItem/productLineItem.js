'use strict';

var base = module.superModule;

module.exports = function productLineItem(product, apiProduct, options) {
    base(product, apiProduct, options);
    require('~/cartridge/scripts/rentals/rentalBooking').decorate(product, options.lineItem);
    return product;
};
