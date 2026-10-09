'use strict';

/* global response, session */

/**
 * Business Manager desk for rental staff: dispatch, delivery, returns, damage
 * inspection and deposit refunds. Access is governed by the BM module permission
 * of the "Rental Desk" menu action.
 * @module controllers/RentalDesk
 */

var ISML = require('dw/template/ISML');
var URLUtils = require('dw/web/URLUtils');
var CSRFProtection = require('dw/web/CSRFProtection');
var StringUtils = require('dw/util/StringUtils');
var Money = require('dw/value/Money');
var Logger = require('dw/system/Logger');
var rentals = require('~/cartridge/scripts/rentals/rentalBooking');
var calendar = require('~/cartridge/scripts/rentals/rentalCalendar');

var customLogger = Logger.getLogger('rentals', 'rental-desk');
var QUEUE_LIMIT = 50;

/**
 * @param {number} value - amount
 * @param {string} currency - currency code
 * @returns {string} formatted amount, empty without a currency
 */
function money(value, currency) {
    return currency ? StringUtils.formatMoney(new Money(value || 0, currency)) : '';
}

/**
 * @param {*} value - untrusted text
 * @param {number} max - maximum length
 * @returns {string} trimmed text
 */
function text(value, max) {
    return String(value || '').trim().slice(0, max);
}

/**
 * @param {dw.object.CustomObject} booking - booking
 * @param {string} day - today
 * @returns {Object} row for the desk tables
 */
function row(booking, day) {
    var c = booking.custom;
    return {
        bookingNo: c.key,
        url: URLUtils.url('RentalDesk-Show', 'booking', c.key).toString(),
        type: c.type,
        status: c.status,
        product: c.productName + ' (' + c.productID + ')',
        unitID: c.unitID,
        dates: c.startDate + (c.type === 'TRIAL' ? '' : ' → ' + c.endDate),
        customer: c.customerName || c.customerEmail || '',
        orderNo: c.orderNo || '',
        overdue: (c.status === 'DISPATCHED' || c.status === 'WITH_CUSTOMER') && c.endDate < day,
        atRisk: !!c.atRisk
    };
}

/**
 * @param {string} condition - query
 * @param {Array} args - arguments
 * @param {string} day - today
 * @returns {Object[]} first rows of a queue, by start date
 */
function queue(condition, args, day) {
    return calendar.query('RentalBooking', condition, args)
        .sort(function (a, b) { return a.custom.startDate < b.custom.startDate ? -1 : 1; })
        .slice(0, QUEUE_LIMIT)
        .map(function (booking) { return row(booking, day); });
}

/**
 * Lists the work of the day, or the bookings matching a booking or order number.
 */
function start() {
    var day = calendar.today();
    var soon = calendar.addDays(day, 7);
    var search = text(request.httpParameterMap.q.stringValue, 50);
    var found = null;
    if (search) {
        var direct = rentals.get(search);
        found = (direct ? [direct] : calendar.query('RentalBooking', 'custom.orderNo = {0}', [search])).map(function (booking) { return row(booking, day); });
    }
    ISML.renderTemplate('rental/bm/desk', {
        search: search,
        found: found,
        queues: [
            { id: 'dispatch', rows: queue('custom.status = {0} AND custom.type = {1} AND custom.startDate <= {2}', ['RESERVED', 'RENTAL', soon], day) },
            { id: 'trials', rows: queue('custom.status = {0} AND custom.type = {1} AND custom.startDate <= {2}', ['RESERVED', 'TRIAL', soon], day) },
            { id: 'out', rows: queue('custom.status = {0} OR custom.status = {1}', ['DISPATCHED', 'WITH_CUSTOMER'], day) },
            { id: 'inspect', rows: queue('custom.status = {0}', ['RETURNED'], day) },
            { id: 'refund', rows: queue('custom.status = {0}', ['INSPECTED'], day) },
            { id: 'risk', rows: queue('custom.atRisk = {0} AND custom.status = {1}', [true, 'RESERVED'], day) }
        ]
    });
}
start.public = true;

/**
 * Shows one booking with the actions its status allows.
 */
function show() {
    var booking = rentals.get(text(request.httpParameterMap.booking.stringValue, 20));
    if (!booking) {
        response.redirect(URLUtils.url('RentalDesk-Start'));
        return;
    }
    var c = booking.custom;
    var day = calendar.today();
    var actions = Object.keys(rentals.ACTIONS).filter(function (name) {
        var rule = rentals.ACTIONS[name];
        return rule.from.indexOf(c.status) >= 0 && (!rule.type || rule.type === c.type);
    });
    var late = c.status === 'DISPATCHED' || c.status === 'WITH_CUSTOMER' ? rentals.lateFee(c.endDate, day) : null;
    var result = text(request.httpParameterMap.result.stringValue, 40);
    ISML.renderTemplate('rental/bm/booking', {
        booking: row(booking, day),
        details: c,
        actions: actions,
        actionUrl: URLUtils.url('RentalDesk-Action', 'booking', c.key, CSRFProtection.getTokenName(), CSRFProtection.generateToken()).toString(),
        result: /^[a-z.]+$/.test(result) ? result : '',
        amounts: {
            fee: money(c.rentalFee, c.currency),
            deposit: money(c.depositAmount, c.currency),
            lateFee: money(late ? late.fee : c.lateFee, c.currency),
            lateDays: String(late ? late.days : c.lateDays || 0),
            damage: money(c.damageAmount, c.currency),
            refundDue: money(rentals.refundDue(booking), c.currency),
            refund: money(c.refundAmount, c.currency)
        },
        photos: Array.prototype.slice.call(c.damagePhotos || []).map(function (name) { return rentals.photoData(c.key, name); }).filter(Boolean),
        history: c.history ? c.history.split('\n') : []
    });
}
show.public = true;

/**
 * Applies a desk action. The CSRF token travels in the URL because the inspection
 * form is multipart.
 */
function action() {
    var params = request.httpParameterMap;
    var booking = rentals.get(text(params.booking.stringValue, 20));
    var result;
    if (request.httpMethod !== 'POST' || !CSRFProtection.validateRequest()) {
        result = 'desk.error.csrf';
    } else if (!booking) {
        response.redirect(URLUtils.url('RentalDesk-Start'));
        return;
    } else {
        var name = text(params.action.stringValue, 20);
        var photos = name === 'inspect' && booking.custom.status === 'RETURNED' ? rentals.savePhotos(params, booking.custom.key) : [];
        var input = {
            tracking: text(params.tracking.stringValue, 64),
            damage: rentals.amount(params.damage.stringValue),
            notes: text(params.notes.stringValue, 2000),
            maintenance: params.maintenance.booleanValue === true,
            reference: text(params.reference.stringValue, 64),
            photos: photos
        };
        result = rentals.advance(booking, name, input, session.userName) || 'desk.done';
        customLogger.info('Desk action {0} on booking {1} by {2}: {3}', name, booking.custom.key, session.userName, result);
    }
    response.redirect(URLUtils.url('RentalDesk-Show', 'booking', booking ? booking.custom.key : '', 'result', result));
}
action.public = true;

module.exports = {
    Start: start,
    Show: show,
    Action: action
};
