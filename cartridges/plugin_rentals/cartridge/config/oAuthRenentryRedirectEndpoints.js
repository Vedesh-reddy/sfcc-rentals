'use strict';

// Slot 6 returns shoppers to their rentals after login; slots 3-5 belong to other plugins.
var endpoints = {};
Object.keys(module.superModule).forEach(function (key) {
    endpoints[key] = module.superModule[key];
});
endpoints[6] = 'Rental-Bookings';
module.exports = endpoints;
