'use strict';

var server = require('server');
var URLUtils = require('dw/web/URLUtils');
var Resource = require('dw/web/Resource');
var csrfProtection = require('*/cartridge/scripts/middleware/csrf');
var userLoggedIn = require('*/cartridge/scripts/middleware/userLoggedIn');
var rentals = require('~/cartridge/scripts/rentals/rentalBooking');
var calendar = require('~/cartridge/scripts/rentals/rentalCalendar');

// Login-Show return slot registered in config/oAuthRenentryRedirectEndpoints.js.
var LOGIN_RETURN = 6;
var MAX_ACTIVE_TRIALS = 2;

/**
 * Stops the route with a 404 when rentals are switched off.
 * @param {Object} req - request
 * @param {Object} res - response
 * @param {Function} next - next middleware
 * @returns {void}
 */
function requireRentals(req, res, next) {
    if (!rentals.enabled()) {
        res.setStatusCode(404);
        res.render('error/notFound');
        this.done(req, res);
        return;
    }
    next();
}

/**
 * @param {*} pid - untrusted product ID
 * @returns {?dw.catalog.Product} a rentable product
 */
function rentalProduct(pid) {
    var product = require('dw/catalog/ProductMgr').getProduct(String(pid || ''));
    return rentals.isRental(product) ? product : null;
}

// Uncached remote include on the cached PDP: the trial form needs the shopper's login state and a CSRF token.
server.get('Panel', server.middleware.include, csrfProtection.generateToken, function (req, res, next) {
    res.cachePeriod = 0;
    var product = rentals.enabled() ? rentalProduct(req.querystring.pid) : null;
    var range = calendar.bookingWindow();
    res.render('rental/panel', {
        show: !!product,
        first: range.first,
        last: range.last,
        bufferDays: String(calendar.pref('RentalBufferDays', 2)),
        quoteUrl: URLUtils.url('Rental-Quote').toString(),
        trialUrl: URLUtils.url('Rental-BookTrial').toString(),
        loginUrl: URLUtils.https('Login-Show', 'rurl', LOGIN_RETURN).toString(),
        bookingsUrl: URLUtils.https('Rental-Bookings').toString(),
        loggedIn: !!req.currentCustomer.profile
    });
    next();
});

server.get('Quote', requireRentals, function (req, res, next) {
    var product = rentalProduct(req.querystring.pid);
    var duration = parseInt(req.querystring.duration, 10);
    if (!product || product.master) {
        res.json({ available: false, message: Resource.msg('error.size', 'rentals', null) });
        return next();
    }
    var quote = calendar.quote(product.ID, req.querystring.start, duration > 0 && duration <= 30 ? duration : 0);
    var message;
    if (!quote.valid) {
        message = Resource.msgf('quote.window', 'rentals', null, calendar.formatDay(quote.first), calendar.formatDay(quote.last));
    } else if (quote.available) {
        message = Resource.msgf('quote.available', 'rentals', null, calendar.formatDay(req.querystring.start), calendar.formatDay(quote.endDate));
    } else if (quote.nextStart) {
        message = Resource.msgf('quote.next', 'rentals', null, calendar.formatDay(quote.nextStart));
    } else {
        message = Resource.msg('quote.none', 'rentals', null);
    }
    res.json({ available: quote.available, nextStart: quote.nextStart, message: message });
    return next();
});

server.post('BookTrial', server.middleware.https, requireRentals, userLoggedIn.validateLoggedInAjax, csrfProtection.validateAjaxRequest, function (req, res, next) {
    if (!res.getViewData().loggedin) {
        res.json({ success: false, redirectUrl: URLUtils.https('Login-Show', 'rurl', LOGIN_RETURN).toString() });
        return next();
    }
    var profile = req.currentCustomer.profile;
    var product = rentalProduct(req.form.pid);
    var start = req.form.trialDate;
    var range = calendar.bookingWindow();
    var errorKey = null;
    if (!product || product.master) {
        errorKey = 'error.size';
    } else if (!calendar.isDay(start) || start < range.first || start > range.last) {
        errorKey = 'error.dates';
    } else if (calendar.query('RentalBooking', 'custom.customerNo = {0} AND custom.type = {1} AND custom.status = {2}', [profile.customerNo, 'TRIAL', 'RESERVED']).length >= MAX_ACTIVE_TRIALS) {
        errorKey = 'error.trial.limit';
    }
    var booking = !errorKey && calendar.claim({
        productID: product.ID,
        productName: product.name,
        start: start,
        duration: 1,
        type: 'TRIAL',
        holdExpiresAt: null,
        customer: { customerNo: profile.customerNo, email: profile.email, name: profile.firstName + ' ' + profile.lastName }
    });
    if (!errorKey && !booking) errorKey = 'error.unavailable';
    res.json(errorKey
        ? { success: false, message: Resource.msg(errorKey, 'rentals', null) }
        : { success: true, message: Resource.msgf('trial.booked', 'rentals', null, booking.custom.key, calendar.formatDay(start)) });
    return next();
});

server.get('Bookings', server.middleware.https, requireRentals, userLoggedIn.validateLoggedIn, function (req, res, next) {
    if (!req.currentCustomer.profile) return next();
    var StringUtils = require('dw/util/StringUtils');
    var Money = require('dw/value/Money');
    var money = function (value, currency) { return currency ? StringUtils.formatMoney(new Money(value || 0, currency)) : ''; };
    var bookings = calendar.query('RentalBooking', 'custom.customerNo = {0} AND custom.status != {1} AND custom.status != {2}', [req.currentCustomer.profile.customerNo, 'HELD', 'EXPIRED'])
        .reverse()
        .slice(0, 50)
        .map(function (booking) {
            var c = booking.custom;
            var refunded = c.status === 'DEPOSIT_REFUNDED';
            return {
                bookingNo: c.key,
                trial: c.type === 'TRIAL',
                productName: c.productName,
                dates: c.type === 'TRIAL' ? calendar.formatDay(c.startDate) : calendar.formatDay(c.startDate) + ' – ' + calendar.formatDay(c.endDate),
                status: Resource.msg('status.' + c.status, 'rentals', c.status),
                orderNo: c.orderNo,
                deposit: c.depositAmount ? money(c.depositAmount, c.currency) : '',
                deductions: refunded && (c.damageAmount || c.lateFee) ? money((c.damageAmount || 0) + (c.lateFee || 0), c.currency) : '',
                refund: refunded ? money(c.refundAmount, c.currency) : ''
            };
        });
    res.render('rental/bookings', {
        bookings: bookings,
        breadcrumbs: [
            { htmlValue: Resource.msg('global.home', 'common', null), url: URLUtils.home().toString() },
            { htmlValue: Resource.msg('page.title.myaccount', 'account', null), url: URLUtils.url('Account-Show').toString() }
        ]
    });
    return next();
});

module.exports = server.exports();
