'use strict';

var base = module.superModule;

module.exports = Object.assign({}, base, {
    placeOrder: function (order, fraudDetectionStatus) {
        var result = base.placeOrder(order, fraudDetectionStatus);
        if (!result.error) {
            try {
                require('~/cartridge/scripts/rentals/rentalBooking').confirmOrder(order);
            } catch (e) {
                // The order is placed and its holds still block the days; the desk can confirm it by hand.
                require('dw/system/Logger').getLogger('rentals', 'rental-bookings').error('Rental bookings of order {0} not confirmed: {1}', order.orderNo, e.message);
            }
        }
        return result;
    }
});
