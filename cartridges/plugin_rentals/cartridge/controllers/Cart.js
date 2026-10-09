'use strict';

var server = require('server');
server.extend(module.superModule);

/**
 * @param {string} uuid - line UUID from the request
 * @returns {?dw.order.ProductLineItem} the basket line holding a rental booking
 */
function rentalLine(uuid) {
    var basket = require('dw/order/BasketMgr').getCurrentBasket();
    var pli = basket && uuid ? basket.productLineItems.toArray().filter(function (line) { return line.UUID === uuid; })[0] : null;
    return pli && pli.custom.rentalBookingNo ? pli : null;
}

/**
 * Stops a cart route with the error shape the cart scripts display.
 * @param {Object} route - route context (this)
 * @param {Object} req - request
 * @param {Object} res - response
 * @param {string} key - rentals resource key
 * @returns {null} so the prepend can return it
 */
function reject(route, req, res, key) {
    res.setStatusCode(500);
    res.json({ error: true, errorMessage: require('dw/web/Resource').msg(key, 'rentals', null) });
    route.done(req, res);
    return null;
}

// The unit is held before the base route adds the line: the platform refuses to add and remove
// a line in the same request, so a refused claim must stop the request before the line exists.
server.prepend('AddProduct', function (req, res, next) {
    var rentals = require('~/cartridge/scripts/rentals/rentalBooking');
    var product = require('dw/catalog/ProductMgr').getProduct(String(req.form.pid || ''));
    if (!rentals.enabled() || !rentals.isRental(product)) return next();
    var basket = require('dw/order/BasketMgr').getCurrentBasket();
    var error = null;
    var held = null;
    if (product.master || req.form.pidsObj) {
        error = 'error.size';
    } else if (!require('~/cartridge/scripts/rentals/rentalCalendar').isDay(req.form.rentalStart)) {
        error = 'error.dates';
    } else if (parseInt(req.form.quantity, 10) !== 1) {
        error = 'error.quantity';
    } else if (basket && rentals.rentalLines(basket).some(function (pli) { return pli.productID === product.ID; })) {
        // One booking per piece and basket keeps every line tied to exactly one hold.
        error = 'error.duplicate';
    } else {
        var options;
        try {
            options = JSON.parse(req.form.options || '[]');
        } catch (e) {
            options = [];
        }
        held = rentals.hold(product, req.form.rentalStart, rentals.durationFromOptions(product, options));
        error = held.error;
    }
    if (error) {
        res.json({ error: true, message: require('dw/web/Resource').msg(error, 'rentals', null) });
        this.done(req, res);
        return null;
    }
    res.setViewData({ rentalHoldNo: held.booking.custom.key });
    return next();
});

server.append('AddProduct', function (req, res, next) {
    var viewData = res.getViewData();
    if (!viewData.rentalHoldNo) return next();
    var rentals = require('~/cartridge/scripts/rentals/rentalBooking');
    var booking = rentals.get(viewData.rentalHoldNo);
    var basket = require('dw/order/BasketMgr').getCurrentBasket();
    var pli = !viewData.error && viewData.pliUUID && basket
        ? basket.productLineItems.toArray().filter(function (line) { return line.UUID === viewData.pliUUID; })[0] : null;
    if (pli && rentals.attachHold(pli, booking)) {
        var minutes = String(require('~/cartridge/scripts/rentals/rentalCalendar').pref('RentalHoldMinutes', 30));
        res.setViewData({ message: require('dw/web/Resource').msgf('hold.added', 'rentals', null, minutes) });
    } else {
        // A line left without a hold is stopped again at checkout.
        rentals.releaseHold(viewData.rentalHoldNo);
    }
    return next();
});

server.prepend('UpdateQuantity', function (req, res, next) {
    if (rentalLine(req.querystring.uuid) && parseInt(req.querystring.quantity, 10) !== 1) {
        return reject(this, req, res, 'error.quantity');
    }
    return next();
});

server.prepend('EditProductLineItem', function (req, res, next) {
    if (rentalLine(req.form.uuid)) return reject(this, req, res, 'error.edit');
    return next();
});

server.prepend('RemoveProductLineItem', function (req, res, next) {
    var pli = rentalLine(req.querystring.uuid);
    if (pli) res.setViewData({ rentalRemovedBookingNo: pli.custom.rentalBookingNo });
    next();
});

server.append('RemoveProductLineItem', function (req, res, next) {
    var bookingNo = res.getViewData().rentalRemovedBookingNo;
    if (bookingNo && !rentalLine(req.querystring.uuid)) {
        require('~/cartridge/scripts/rentals/rentalBooking').releaseHold(bookingNo);
    }
    next();
});

module.exports = server.exports();
