'use strict';

var base = module.superModule;

/**
 * The refundable security deposit is not a sale, so its option line is kept out of tax.
 * @param {dw.order.Basket} basket - Current basket
 */
function calculateTotals(basket) {
    var exempt = require('dw/order/TaxMgr').taxExemptTaxClassID;
    var depositOption = require('~/cartridge/scripts/rentals/rentalBooking').DEPOSIT_OPTION;
    basket.getAllProductLineItems().toArray().forEach(function (pli) {
        if (pli.optionProductLineItem && pli.optionID === depositOption && pli.taxClassID !== exempt) {
            pli.setTaxClassID(exempt);
        }
    });
    base.calculateTotals(basket);
}

module.exports = Object.assign({}, base, {
    calculateTotals: calculateTotals
});
