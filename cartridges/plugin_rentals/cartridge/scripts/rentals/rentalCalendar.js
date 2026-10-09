'use strict';

/**
 * Calendar-based reservation engine on top of count-based SFCC inventory.
 *
 * Every blocked day of every unit is its own RentalUnitDay custom object keyed
 * "unit|yyyy-MM-dd". Claiming a booking creates all of its day rows in one
 * transaction, and the unique key makes the database reject a second booking
 * of the same day, even when two shoppers commit at the same moment.
 */

var CustomObjectMgr = require('dw/object/CustomObjectMgr');
var Transaction = require('dw/system/Transaction');
var Logger = require('dw/system/Logger');

var DAY_MS = 86400000;
var customLogger = Logger.getLogger('rentals', 'rental-calendar');

/**
 * @param {string} name - site preference ID
 * @param {*} fallback - value when the preference is not set
 * @returns {*} preference value
 */
function pref(name, fallback) {
    var value = require('dw/system/Site').current.getCustomPreferenceValue(name);
    return value === null || value === undefined ? fallback : value;
}

/**
 * @param {string} day - yyyy-MM-dd
 * @param {number} count - days to add, may be negative
 * @returns {string} yyyy-MM-dd
 */
function addDays(day, count) {
    return new Date(Date.parse(day + 'T00:00:00Z') + (count * DAY_MS)).toISOString().slice(0, 10);
}

/**
 * @param {string} from - yyyy-MM-dd
 * @param {string} to - yyyy-MM-dd
 * @returns {number} whole days from one to the other
 */
function daysBetween(from, to) {
    return Math.round((Date.parse(to + 'T00:00:00Z') - Date.parse(from + 'T00:00:00Z')) / DAY_MS);
}

/**
 * @param {*} value - untrusted input
 * @returns {boolean} true for a real calendar day in yyyy-MM-dd form
 */
function isDay(value) {
    // The round trip rejects days such as 2026-02-30.
    return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value)) && addDays(value, 0) === value;
}

/**
 * @returns {string} today in the site time zone
 */
function today() {
    var Site = require('dw/system/Site');
    return require('dw/util/StringUtils').formatCalendar(Site.getCalendar(), 'yyyy-MM-dd');
}

/**
 * @param {string} day - yyyy-MM-dd
 * @returns {string} the day as shoppers read it, e.g. 14 Nov 2026
 */
function formatDay(day) {
    var Calendar = require('dw/util/Calendar');
    var calendar = new Calendar(new Date(Date.parse(day + 'T00:00:00Z')));
    // Days are stored as UTC midnights; formatting in the site zone could shift them back a day.
    calendar.setTimeZone('UTC');
    return require('dw/util/StringUtils').formatCalendar(calendar, 'd MMM yyyy');
}

/**
 * @returns {{first: string, last: string}} the start dates a shopper may choose
 */
function bookingWindow() {
    var now = today();
    return { first: addDays(now, pref('RentalLeadDays', 3)), last: addDays(now, pref('RentalHorizonDays', 180)) };
}

/**
 * @param {string} start - first rental day
 * @param {number} duration - rental days
 * @param {number} buffer - cleaning days after the return
 * @returns {string[]} every day the unit is away from other customers
 */
function blockedDays(start, duration, buffer) {
    var days = [];
    for (var i = 0; i < duration + buffer; i += 1) days.push(addDays(start, i));
    return days;
}

/**
 * @param {string} type - custom object type
 * @param {string} condition - query
 * @param {Array} args - query arguments
 * @returns {dw.object.CustomObject[]} matches
 */
function query(type, condition, args) {
    var iterator = CustomObjectMgr.queryCustomObjects.apply(CustomObjectMgr, [type, condition, 'creationDate asc'].concat(args));
    var result = [];
    try {
        while (iterator.hasNext()) result.push(iterator.next());
    } finally {
        iterator.close();
    }
    return result;
}

/**
 * @param {dw.object.CustomObject} row - RentalUnitDay
 * @param {number} now - epoch millis
 * @returns {boolean} false when the row is an abandoned cart hold
 */
function isLive(row, now) {
    return !row.custom.holdExpiresAt || row.custom.holdExpiresAt.getTime() > now;
}

/**
 * @param {string} productID - variant ID
 * @returns {string[]} tags of the units that can be booked
 */
function activeUnits(productID) {
    return query('RentalUnit', 'custom.productID = {0} AND custom.status = {1}', [productID, 'ACTIVE'])
        .map(function (unit) { return unit.custom.key; })
        .sort();
}

/**
 * @param {string} unitID - unit tag
 * @param {string} from - first day
 * @param {string} to - last day
 * @param {number} now - epoch millis
 * @returns {Object} day => true for every live claim in the range
 */
function busyDays(unitID, from, to, now) {
    var busy = {};
    query('RentalUnitDay', 'custom.unitID = {0} AND custom.day >= {1} AND custom.day <= {2}', [unitID, from, to]).forEach(function (row) {
        if (isLive(row, now)) busy[row.custom.day] = true;
    });
    return busy;
}

/**
 * Checks the requested dates and, when they are taken, finds the next start that is free.
 * @param {string} productID - variant ID
 * @param {string} start - first rental day
 * @param {number} duration - rental days
 * @returns {{valid: boolean, available: boolean, endDate: string, nextStart: ?string}} quote
 */
function quote(productID, start, duration) {
    var range = bookingWindow();
    if (!isDay(start) || start < range.first || start > range.last || !(duration > 0)) {
        return { valid: false, available: false, endDate: null, nextStart: null, first: range.first, last: range.last };
    }
    var buffer = pref('RentalBufferDays', 2);
    var now = Date.now();
    var last = addDays(range.last, duration + buffer);
    var calendars = activeUnits(productID).map(function (unitID) { return busyDays(unitID, range.first, last, now); });
    var fits = function (day) {
        var days = blockedDays(day, duration, buffer);
        return calendars.some(function (busy) { return days.every(function (d) { return !busy[d]; }); });
    };
    var available = fits(start);
    var nextStart = null;
    for (var day = start; !available && !nextStart && day <= range.last; day = addDays(day, 1)) {
        if (fits(day)) nextStart = day;
    }
    return { valid: true, available: available, endDate: addDays(start, duration - 1), nextStart: nextStart, first: range.first, last: range.last };
}

/**
 * Deletes abandoned holds on the given days so their keys can be claimed again.
 * Each row is re-read inside the transaction, so a row another shopper has just
 * claimed is left alone.
 * @param {string} unitID - unit tag
 * @param {string[]} days - days about to be claimed
 * @param {number} now - epoch millis
 */
function purgeAbandoned(unitID, days, now) {
    days.forEach(function (day) {
        try {
            Transaction.wrap(function () {
                var row = CustomObjectMgr.getCustomObject('RentalUnitDay', unitID + '|' + day);
                if (row && !isLive(row, now)) CustomObjectMgr.remove(row);
            });
        } catch (e) {
            customLogger.info('Abandoned hold {0}|{1} already gone: {2}', unitID, day, e.message);
        }
    });
}

/**
 * @returns {string} new booking number
 */
function bookingNumber() {
    return 'RB' + require('dw/util/UUIDUtils').createUUID().slice(0, 10).toUpperCase();
}

/**
 * Claims a free unit for the dates. Units are tried in tag order; a unit that
 * another shopper claims first simply fails its transaction and the next is tried.
 * @param {Object} request - booking request
 * @param {string} request.productID - variant ID
 * @param {string} request.productName - name shown at the desk
 * @param {string} request.start - first day
 * @param {number} request.duration - rental days
 * @param {string} request.type - RENTAL or TRIAL
 * @param {?Date} request.holdExpiresAt - cart hold expiry; null books immediately
 * @param {Object} [request.customer] - customerNo, email, name
 * @returns {?dw.object.CustomObject} the booking, or null when nothing is free
 */
function claim(request) {
    var buffer = request.type === 'TRIAL' ? 0 : pref('RentalBufferDays', 2);
    var days = blockedDays(request.start, request.duration, buffer);
    var now = Date.now();
    var units = activeUnits(request.productID).filter(function (unitID) {
        var busy = busyDays(unitID, days[0], days[days.length - 1], now);
        return days.every(function (day) { return !busy[day]; });
    });
    for (var i = 0; i < units.length; i += 1) {
        var unitID = units[i];
        purgeAbandoned(unitID, days, now);
        try {
            return Transaction.wrap(createBooking.bind(null, request, unitID, days));
        } catch (e) {
            customLogger.info('Unit {0} was claimed concurrently for {1}: {2}', unitID, request.start, e.message);
        }
    }
    return null;
}

/**
 * @param {Object} request - see claim
 * @param {string} unitID - unit tag
 * @param {string[]} days - blocked days
 * @returns {dw.object.CustomObject} booking
 */
function createBooking(request, unitID, days) {
    var bookingNo = bookingNumber();
    days.forEach(function (day) {
        // Throws on an existing key, which rolls the whole claim back.
        var row = CustomObjectMgr.createCustomObject('RentalUnitDay', unitID + '|' + day);
        row.custom.unitID = unitID;
        row.custom.day = day;
        row.custom.bookingNo = bookingNo;
        row.custom.holdExpiresAt = request.holdExpiresAt;
    });
    var booking = CustomObjectMgr.createCustomObject('RentalBooking', bookingNo);
    var customer = request.customer || {};
    booking.custom.type = request.type;
    booking.custom.status = request.holdExpiresAt ? 'HELD' : 'RESERVED';
    booking.custom.unitID = unitID;
    booking.custom.productID = request.productID;
    booking.custom.productName = request.productName;
    booking.custom.startDate = request.start;
    booking.custom.endDate = addDays(request.start, request.duration - 1);
    booking.custom.blockedUntil = days[days.length - 1];
    booking.custom.durationDays = request.duration;
    booking.custom.holdExpiresAt = request.holdExpiresAt;
    booking.custom.customerNo = customer.customerNo || null;
    booking.custom.customerEmail = customer.email || null;
    booking.custom.customerName = customer.name || null;
    return booking;
}

/**
 * @param {string} bookingNo - booking number
 * @returns {dw.object.CustomObject[]} the booking's day rows
 */
function dayRows(bookingNo) {
    return query('RentalUnitDay', 'custom.bookingNo = {0}', [bookingNo]);
}

/**
 * Moves the expiry of a held booking and its days, or clears it to make the
 * booking permanent. The days are counted after the write: an expired hold whose
 * day was purged by another shopper in the meantime comes back short.
 * @param {dw.object.CustomObject} booking - RentalBooking
 * @param {?Date} expiresAt - new expiry, or null
 * @returns {boolean} true when the booking still owns every blocked day
 */
function renewHold(booking, expiresAt) {
    Transaction.wrap(function () {
        dayRows(booking.custom.key).forEach(function (row) { row.custom.holdExpiresAt = expiresAt; });
        booking.custom.holdExpiresAt = expiresAt;
    });
    var c = booking.custom;
    return dayRows(c.key).length === daysBetween(c.startDate, c.blockedUntil) + 1;
}

/**
 * Frees the unit's days and closes the booking.
 * @param {dw.object.CustomObject} booking - RentalBooking
 * @param {string} status - CANCELLED or EXPIRED
 */
function release(booking, status) {
    Transaction.wrap(function () {
        dayRows(booking.custom.key).forEach(function (row) { CustomObjectMgr.remove(row); });
        booking.custom.status = status;
        booking.custom.holdExpiresAt = null;
    });
}

/**
 * Keeps an overdue unit blocked until it can be back and cleaned. Days already
 * claimed by the next customer are not taken; that booking is flagged instead so
 * the desk can swap in another unit. Runs inside the caller's transaction.
 * @param {dw.object.CustomObject} booking - overdue RentalBooking
 * @param {string} day - today
 * @returns {?string} booking number put at risk
 */
function extendOverdue(booking, day) {
    var unitID = booking.custom.unitID;
    var until = addDays(day, pref('RentalBufferDays', 2));
    var now = Date.now();
    for (var next = addDays(booking.custom.blockedUntil, 1); next <= until; next = addDays(next, 1)) {
        var existing = CustomObjectMgr.getCustomObject('RentalUnitDay', unitID + '|' + next);
        if (existing && isLive(existing, now)) {
            var other = CustomObjectMgr.getCustomObject('RentalBooking', existing.custom.bookingNo);
            if (other) other.custom.atRisk = true;
            return existing.custom.bookingNo;
        }
        // An abandoned hold is taken over rather than deleted and re-created under the same key.
        var row = existing || CustomObjectMgr.createCustomObject('RentalUnitDay', unitID + '|' + next);
        row.custom.unitID = unitID;
        row.custom.day = next;
        row.custom.bookingNo = booking.custom.key;
        row.custom.holdExpiresAt = null;
        booking.custom.blockedUntil = next;
    }
    return null;
}

module.exports = {
    pref: pref,
    addDays: addDays,
    daysBetween: daysBetween,
    isDay: isDay,
    today: today,
    formatDay: formatDay,
    bookingWindow: bookingWindow,
    blockedDays: blockedDays,
    query: query,
    quote: quote,
    claim: claim,
    renewHold: renewHold,
    release: release,
    extendOverdue: extendOverdue
};
