'use strict';

/**
 * Rental bookings from cart hold to deposit refund. The calendar itself lives in
 * rentalCalendar; this module ties bookings to basket lines and runs the desk lifecycle.
 */

var CustomObjectMgr = require('dw/object/CustomObjectMgr');
var Transaction = require('dw/system/Transaction');
var Logger = require('dw/system/Logger');
var calendar = require('~/cartridge/scripts/rentals/rentalCalendar');

var DURATION_OPTION = 'rentalDuration';
var DEPOSIT_OPTION = 'rentalDeposit';
var MAX_PHOTOS = 4;
var MAX_PHOTO_BYTES = 2 * 1024 * 1024;
var PHOTO_TYPES = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };

// Desk actions: the statuses each one may start from and the status it leads to.
var ACTIONS = {
    dispatch: { from: ['RESERVED'], to: 'DISPATCHED', type: 'RENTAL' },
    deliver: { from: ['DISPATCHED'], to: 'WITH_CUSTOMER', type: 'RENTAL' },
    receive: { from: ['DISPATCHED', 'WITH_CUSTOMER'], to: 'RETURNED', type: 'RENTAL' },
    inspect: { from: ['RETURNED'], to: 'INSPECTED', type: 'RENTAL' },
    refund: { from: ['INSPECTED'], to: 'DEPOSIT_REFUNDED', type: 'RENTAL' },
    complete: { from: ['RESERVED'], to: 'COMPLETED', type: 'TRIAL' },
    cancel: { from: ['HELD', 'RESERVED'], to: 'CANCELLED' }
};

var customLogger = Logger.getLogger('rentals', 'rental-bookings');

/**
 * @returns {boolean} true when rentals are switched on for the site
 */
function enabled() {
    return !!calendar.pref('RentalsEnabled', false);
}

/**
 * @param {?dw.catalog.Product} product - product
 * @returns {boolean} true for a rentable product (variants inherit the flag from the master)
 */
function isRental(product) {
    return !!product && !!product.custom.rentalEnabled;
}

/**
 * @param {number} value - amount
 * @returns {number} rounded to cents
 */
function round(value) {
    return Math.round((value || 0) * 100) / 100;
}

/**
 * @param {dw.order.ProductLineItem} pli - rental line
 * @param {string} optionID - option ID
 * @returns {?dw.order.ProductLineItem} the option line
 */
function optionLine(pli, optionID) {
    return pli.optionProductLineItems.toArray().filter(function (option) { return option.optionID === optionID; })[0] || null;
}

/**
 * @param {dw.order.ProductLineItem} pli - rental line
 * @returns {number} rental days from the selected duration option, 0 when missing
 */
function durationOf(pli) {
    var option = optionLine(pli, DURATION_OPTION);
    var days = option ? parseInt(option.optionValueID, 10) : 0;
    return days > 0 && days <= 30 ? days : 0;
}

/**
 * @param {string} bookingNo - booking number
 * @returns {?dw.object.CustomObject} booking
 */
function get(bookingNo) {
    return bookingNo ? CustomObjectMgr.getCustomObject('RentalBooking', String(bookingNo)) : null;
}

/**
 * @param {dw.order.LineItemCtnr} container - basket or order
 * @returns {dw.order.ProductLineItem[]} lines holding a rental booking
 */
function rentalLines(container) {
    return container.productLineItems.toArray().filter(function (pli) { return !!pli.custom.rentalBookingNo; });
}

/**
 * @returns {Date} expiry for a hold that starts now
 */
function holdExpiry() {
    return new Date(Date.now() + (calendar.pref('RentalHoldMinutes', 30) * 60000));
}

/**
 * Reads the duration from add-to-cart options the way the base cart does: the
 * posted value when the product has it, the option's default otherwise.
 * @param {dw.catalog.Product} product - rental variant
 * @param {Array} options - posted [{optionId, selectedValueId}]
 * @returns {number} rental days, 0 when the product has no valid duration
 */
function durationFromOptions(product, options) {
    var model = product.optionModel;
    var option = model.getOption(DURATION_OPTION);
    if (!option) return 0;
    var posted = (options || []).filter(function (o) { return o && o.optionId === DURATION_OPTION; })[0];
    var value = (posted && model.getOptionValue(option, String(posted.selectedValueId))) || model.getSelectedOptionValue(option);
    var days = value ? parseInt(value.ID, 10) : 0;
    return days > 0 && days <= 30 ? days : 0;
}

/**
 * Holds a unit before the line is added. The platform does not allow a line to be
 * added and removed in the same request, so a refused claim must never create one.
 * @param {dw.catalog.Product} product - rental variant
 * @param {string} start - first rental day
 * @param {number} duration - rental days
 * @returns {{booking: ?dw.object.CustomObject, error: ?string}} the hold, or an error resource key
 */
function hold(product, start, duration) {
    if (!duration) return { booking: null, error: 'error.duration' };
    var quote = calendar.quote(product.ID, start, duration);
    if (!quote.valid) return { booking: null, error: 'error.dates' };
    var booking = quote.available && calendar.claim({
        productID: product.ID,
        productName: product.name,
        start: start,
        duration: duration,
        type: 'RENTAL',
        holdExpiresAt: holdExpiry()
    });
    return booking ? { booking: booking, error: null } : { booking: null, error: 'error.unavailable' };
}

/**
 * Ties a hold to the line the base route created for it.
 * @param {dw.order.ProductLineItem} pli - new rental line
 * @param {dw.object.CustomObject} booking - hold taken for it
 * @returns {boolean} false when the line does not match the hold
 */
function attachHold(pli, booking) {
    if (pli.productID !== booking.custom.productID || durationOf(pli) !== booking.custom.durationDays) return false;
    Transaction.wrap(function () {
        pli.custom.rentalStart = booking.custom.startDate;
        pli.custom.rentalBookingNo = booking.custom.key;
    });
    return true;
}

/**
 * @param {dw.order.ProductLineItem} pli - rental line
 * @returns {boolean} true when the line still matches a hold that owns its days
 */
function lineHeld(pli) {
    var booking = get(pli.custom.rentalBookingNo);
    var c = booking && booking.custom;
    return !!c && c.status === 'HELD' && c.productID === pli.productID && c.startDate === pli.custom.rentalStart
        && c.durationDays === durationOf(pli) && pli.quantityValue === 1 && calendar.renewHold(booking, holdExpiry());
}

/**
 * Re-checks every rental line before the order is created and keeps the holds
 * alive while the shopper pays.
 * @param {dw.order.Basket} basket - basket
 * @returns {?string} error resource key
 */
function validateBasket(basket) {
    var invalid = basket.productLineItems.toArray().filter(function (pli) {
        if (pli.custom.rentalBookingNo) return !lineHeld(pli);
        return isRental(pli.product);
    });
    return invalid.length ? 'error.hold.lost' : null;
}

/**
 * Makes the holds of a placed order permanent and records what was paid.
 * @param {dw.order.Order} order - placed order
 */
function confirmOrder(order) {
    rentalLines(order).forEach(function (pli) {
        var booking = get(pli.custom.rentalBookingNo);
        if (!booking) return;
        var duration = optionLine(pli, DURATION_OPTION);
        var deposit = optionLine(pli, DEPOSIT_OPTION);
        var owned = calendar.renewHold(booking, null);
        Transaction.wrap(function () {
            var c = booking.custom;
            c.status = 'RESERVED';
            c.orderNo = order.orderNo;
            c.customerNo = order.customerNo || null;
            c.customerEmail = order.customerEmail;
            c.customerName = order.customerName;
            c.currency = order.currencyCode;
            c.rentalFee = round(pli.proratedPrice.value + (duration ? duration.proratedPrice.value : 0));
            c.depositAmount = round(deposit ? deposit.proratedPrice.value : 0);
            // Only possible when the hold ran out during payment and another shopper took a day.
            if (!owned) c.atRisk = true;
        });
        if (!owned) customLogger.error('Booking {0} of order {1} lost part of its days during payment', booking.custom.key, order.orderNo);
    });
}

/**
 * Adds the rental dates to a line item view model. Read from the line itself,
 * so cart and order pages do not look up the booking.
 * @param {Object} model - line item view model
 * @param {dw.order.ProductLineItem} pli - line
 */
function decorate(model, pli) {
    var start = pli && pli.custom.rentalBookingNo ? pli.custom.rentalStart : null;
    if (!start) return;
    model.rental = {
        bookingNo: pli.custom.rentalBookingNo,
        start: calendar.formatDay(start),
        end: calendar.formatDay(calendar.addDays(start, Math.max(durationOf(pli), 1) - 1))
    };
}

/**
 * Frees the hold of a line that left the basket.
 * @param {string} bookingNo - booking number
 */
function releaseHold(bookingNo) {
    var booking = get(bookingNo);
    if (booking && booking.custom.status === 'HELD') calendar.release(booking, 'CANCELLED');
}

/**
 * @param {string} endDate - return due
 * @param {string} returnDay - day the piece came back
 * @returns {{days: number, fee: number}} late days and fee
 */
function lateFee(endDate, returnDay) {
    var days = Math.max(0, calendar.daysBetween(endDate, returnDay));
    return { days: days, fee: round(days * calendar.pref('RentalLateFeePerDay', 0)) };
}

/**
 * @param {dw.object.CustomObject} booking - inspected booking
 * @returns {number} deposit left after damage and late fee
 */
function refundDue(booking) {
    var c = booking.custom;
    return round(Math.max(0, (c.depositAmount || 0) - (c.damageAmount || 0) - (c.lateFee || 0)));
}

/**
 * @param {*} value - untrusted amount
 * @returns {number} non-negative amount, NaN when invalid
 */
function amount(value) {
    var number = Number(value === null || value === undefined || value === '' ? 0 : value);
    return number >= 0 ? round(number) : NaN;
}

/**
 * Applies one desk action.
 * @param {dw.object.CustomObject} booking - booking
 * @param {string} action - key of ACTIONS
 * @param {Object} input - validated form values (tracking, damage, notes, photos, maintenance, reference)
 * @param {string} user - Business Manager user
 * @returns {?string} error resource key, null on success
 */
function advance(booking, action, input, user) {
    var rule = ACTIONS[action];
    var c = booking.custom;
    if (!rule || rule.from.indexOf(c.status) < 0 || (rule.type && rule.type !== c.type)) return 'desk.error.state';
    if (action === 'dispatch' && !input.tracking) return 'desk.error.tracking';
    if (action === 'inspect' && !(input.damage <= (c.depositAmount || 0))) return 'desk.error.damage';
    if (action === 'refund' && !input.reference) return 'desk.error.reference';
    if (action === 'cancel') {
        calendar.release(booking, 'CANCELLED');
    }
    Transaction.wrap(function () {
        var now = new Date();
        if (action === 'dispatch') {
            c.trackingNumber = input.tracking;
            c.dispatchedAt = now;
        } else if (action === 'deliver') {
            c.deliveredAt = now;
        } else if (action === 'receive') {
            var late = lateFee(c.endDate, calendar.today());
            c.returnedAt = now;
            c.lateDays = late.days;
            c.lateFee = late.fee;
        } else if (action === 'inspect') {
            c.inspectedAt = now;
            c.damageAmount = input.damage;
            c.damageNotes = input.notes || null;
            c.damagePhotos = Array.prototype.slice.call(c.damagePhotos || []).concat(input.photos || []);
            var unit = input.maintenance && CustomObjectMgr.getCustomObject('RentalUnit', c.unitID);
            if (unit) unit.custom.status = 'MAINTENANCE';
        } else if (action === 'refund') {
            c.refundAmount = refundDue(booking);
            c.refundReference = input.reference;
            c.refundedAt = now;
        }
        c.status = rule.to;
        c.history = (c.history ? c.history + '\n' : '') + now.toISOString() + ' ' + rule.to + ' by ' + user;
    });
    customLogger.info('Booking {0} moved to {1} by {2}', c.key, rule.to, user);
    return null;
}

/**
 * Stores uploaded damage photos under IMPEX/src/rentals/<booking>. The file name is
 * built here, never taken from the upload, and only known image types are kept.
 * @param {dw.web.HttpParameterMap} params - multipart request parameters
 * @param {string} bookingNo - booking number
 * @returns {string[]} stored file names
 */
function savePhotos(params, bookingNo) {
    var File = require('dw/io/File');
    var dir = new File(File.IMPEX + '/src/rentals/' + bookingNo);
    var count = 0;
    var files = params.processMultipart(function (field, contentType) {
        var extension = PHOTO_TYPES[String(contentType).toLowerCase()];
        if (field !== 'photos' || !extension || count >= MAX_PHOTOS) return null;
        count += 1;
        dir.mkdirs();
        return new File(dir, 'damage-' + Date.now() + '-' + count + '.' + extension);
    });
    var names = [];
    if (!files) return names;
    files.values().toArray().forEach(function (file) {
        if (!file || !file.exists()) return;
        if (file.length() > MAX_PHOTO_BYTES || file.length() === 0) {
            file.remove();
        } else {
            names.push(file.name);
        }
    });
    return names;
}

/**
 * @param {string} bookingNo - booking number
 * @param {string} name - stored photo name
 * @returns {?string} data URI, so the desk can show IMPEX files without a public URL
 */
function photoData(bookingNo, name) {
    var File = require('dw/io/File');
    var Encoding = require('dw/crypto/Encoding');
    var RandomAccessFileReader = require('dw/io/RandomAccessFileReader');
    var extension = String(name).split('.').pop();
    var type = Object.keys(PHOTO_TYPES).filter(function (key) { return PHOTO_TYPES[key] === extension; })[0];
    var file = new File(File.IMPEX + '/src/rentals/' + bookingNo + '/' + name);
    if (!type || name.indexOf('/') >= 0 || !file.exists()) return null;
    var reader = new RandomAccessFileReader(file);
    var parts = [];
    try {
        // Chunks are a multiple of three bytes, so the base64 pieces join without padding.
        var chunk = reader.readBytes(10239);
        while (chunk && chunk.length > 0) {
            parts.push(Encoding.toBase64(chunk));
            chunk = reader.readBytes(10239);
        }
    } finally {
        reader.close();
    }
    return 'data:' + type + ';base64,' + parts.join('');
}

module.exports = {
    ACTIONS: ACTIONS,
    DEPOSIT_OPTION: DEPOSIT_OPTION,
    enabled: enabled,
    isRental: isRental,
    durationOf: durationOf,
    get: get,
    rentalLines: rentalLines,
    durationFromOptions: durationFromOptions,
    hold: hold,
    attachHold: attachHold,
    validateBasket: validateBasket,
    confirmOrder: confirmOrder,
    decorate: decorate,
    releaseHold: releaseHold,
    lateFee: lateFee,
    refundDue: refundDue,
    amount: amount,
    advance: advance,
    savePhotos: savePhotos,
    photoData: photoData
};
