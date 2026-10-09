'use strict';

var Status = require('dw/system/Status');
var Logger = require('dw/system/Logger');
var Transaction = require('dw/system/Transaction');
var calendar = require('~/cartridge/scripts/rentals/rentalCalendar');
var rentals = require('~/cartridge/scripts/rentals/rentalBooking');

/**
 * Updates the running late fee of every rental still out after its return date
 * and keeps its unit blocked until it can be back and cleaned. The fee is final
 * when the desk records the return.
 * @returns {dw.system.Status} OK, or ERROR when a booking failed and needs a retry
 */
function execute() {
    var logger = Logger.getLogger('rentals', 'rental-late-fees');
    var day = calendar.today();
    var failures = 0;
    calendar.query('RentalBooking', '(custom.status = {0} OR custom.status = {1}) AND custom.endDate < {2}', ['DISPATCHED', 'WITH_CUSTOMER', day]).forEach(function (booking) {
        try {
            var late = rentals.lateFee(booking.custom.endDate, day);
            var atRisk = Transaction.wrap(function () {
                booking.custom.lateDays = late.days;
                booking.custom.lateFee = late.fee;
                return calendar.extendOverdue(booking, day);
            });
            if (atRisk) logger.warn('Overdue booking {0} blocks unit {1}; booking {2} is at risk', booking.custom.key, booking.custom.unitID, atRisk);
        } catch (e) {
            failures += 1;
            logger.error('Late fee not updated for booking {0}: {1}', booking.custom.key, e.message);
        }
    });
    return failures ? new Status(Status.ERROR, 'ERROR', failures + ' bookings failed') : new Status(Status.OK, 'OK');
}

module.exports = { execute: execute };
