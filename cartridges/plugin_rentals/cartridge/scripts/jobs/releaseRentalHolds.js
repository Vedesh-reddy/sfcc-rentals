'use strict';

var Status = require('dw/system/Status');
var Logger = require('dw/system/Logger');
var Transaction = require('dw/system/Transaction');
var CustomObjectMgr = require('dw/object/CustomObjectMgr');
var calendar = require('~/cartridge/scripts/rentals/rentalCalendar');

/**
 * Frees days nobody will use: cart holds that ran out, bookings whose order was
 * cancelled or failed after placement, and claims for days already in the past.
 * Shoppers can take over an expired hold before this runs; the job only tidies up.
 * @returns {dw.system.Status} OK, or ERROR when a booking could not be released
 */
function execute() {
    var logger = Logger.getLogger('rentals', 'rental-holds');
    var Order = require('dw/order/Order');
    var OrderMgr = require('dw/order/OrderMgr');
    var now = new Date();
    var failures = 0;
    var release = function (booking, status) {
        try {
            calendar.release(booking, status);
        } catch (e) {
            failures += 1;
            logger.error('Booking {0} not released: {1}', booking.custom.key, e.message);
        }
    };
    calendar.query('RentalBooking', 'custom.status = {0} AND custom.holdExpiresAt < {1}', ['HELD', now]).forEach(function (booking) {
        release(booking, 'EXPIRED');
    });
    calendar.query('RentalBooking', 'custom.status = {0} AND custom.type = {1}', ['RESERVED', 'RENTAL']).forEach(function (booking) {
        var order = OrderMgr.getOrder(booking.custom.orderNo);
        var status = order ? order.status.value : null;
        if (status === Order.ORDER_STATUS_CANCELLED || status === Order.ORDER_STATUS_FAILED) release(booking, 'CANCELLED');
    });
    // Past days only matter for history, which the booking keeps.
    var yesterday = calendar.addDays(calendar.today(), -1);
    calendar.query('RentalUnitDay', 'custom.day < {0}', [yesterday]).forEach(function (row) {
        Transaction.wrap(function () { CustomObjectMgr.remove(row); });
    });
    return failures ? new Status(Status.ERROR, 'ERROR', failures + ' bookings not released') : new Status(Status.OK, 'OK');
}

module.exports = { execute: execute };
