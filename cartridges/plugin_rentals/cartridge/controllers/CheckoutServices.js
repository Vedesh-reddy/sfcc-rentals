'use strict';

var server = require('server');
server.extend(module.superModule);

// Every rental line must still own its days, and the holds are renewed so they outlast the payment.
server.prepend('PlaceOrder', function (req, res, next) {
    var rentals = require('~/cartridge/scripts/rentals/rentalBooking');
    var basket = require('dw/order/BasketMgr').getCurrentBasket();
    var errorKey = basket && rentals.enabled() ? rentals.validateBasket(basket) : null;
    if (errorKey) {
        res.json({ error: true, errorMessage: require('dw/web/Resource').msg(errorKey, 'rentals', null) });
        this.done(req, res);
        return null;
    }
    return next();
});

module.exports = server.exports();
