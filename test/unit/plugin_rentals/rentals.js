'use strict';

var assert = require('chai').assert;
var harness = require('./harness');

describe('plugin_rentals', function () {
    var h;
    var calendar;
    var rentals;

    beforeEach(function () {
        h = harness();
        rentals = h.load('scripts/rentals/rentalBooking.js');
        calendar = h.load('scripts/rentals/rentalCalendar.js');
        h.unit('LEH-RED-M-01', 'lehenga-red-m');
    });

    function claim(start, duration, extra) {
        return calendar.claim(Object.assign({
            productID: 'lehenga-red-m',
            productName: 'Red bridal lehenga',
            start: start,
            duration: duration,
            type: 'RENTAL',
            holdExpiresAt: null
        }, extra));
    }

    describe('calendar days', function () {
        it('rejects impossible and badly formatted days', function () {
            assert.isTrue(calendar.isDay('2026-11-14'));
            assert.isFalse(calendar.isDay('2026-02-30'));
            assert.isFalse(calendar.isDay('14/11/2026'));
            assert.isFalse(calendar.isDay(null));
        });

        it('blocks the rental days plus the cleaning buffer', function () {
            assert.deepEqual(calendar.blockedDays('2026-12-30', 3, 2), ['2026-12-30', '2026-12-31', '2027-01-01', '2027-01-02', '2027-01-03']);
        });
    });

    describe('quote', function () {
        it('refuses starts outside the booking window', function () {
            assert.isFalse(calendar.quote('lehenga-red-m', '2026-11-02', 3).valid);
            assert.isTrue(calendar.quote('lehenga-red-m', '2026-11-04', 3).valid);
        });

        it('offers the first start after the unit is back and cleaned', function () {
            claim('2026-11-10', 5);
            var quote = calendar.quote('lehenga-red-m', '2026-11-12', 3);
            assert.isFalse(quote.available);
            // Out 10-14, cleaning 15-16, free from 17.
            assert.equal(quote.nextStart, '2026-11-17');
        });

        it('does not let a new rental run into the next one', function () {
            claim('2026-11-20', 3);
            assert.isFalse(calendar.quote('lehenga-red-m', '2026-11-16', 3).available, 'cleaning of 18-19 would overlap the 20th');
            assert.isTrue(calendar.quote('lehenga-red-m', '2026-11-15', 3).available);
        });
    });

    describe('claim', function () {
        it('books each unit once per day and moves on to the next unit', function () {
            h.unit('LEH-RED-M-02', 'lehenga-red-m');
            var first = claim('2026-11-10', 3);
            var second = claim('2026-11-11', 3);
            var third = claim('2026-11-12', 3);
            assert.equal(first.custom.unitID, 'LEH-RED-M-01');
            assert.equal(second.custom.unitID, 'LEH-RED-M-02');
            assert.isNull(third);
            assert.deepEqual(h.days('LEH-RED-M-01'), ['2026-11-10', '2026-11-11', '2026-11-12', '2026-11-13', '2026-11-14']);
            assert.equal(first.custom.endDate, '2026-11-12');
            assert.equal(first.custom.blockedUntil, '2026-11-14');
            assert.equal(first.custom.status, 'RESERVED');
        });

        it('skips units in maintenance', function () {
            h.unit('LEH-RED-M-00', 'lehenga-red-m', 'MAINTENANCE');
            assert.equal(claim('2026-11-10', 3).custom.unitID, 'LEH-RED-M-01');
        });

        it('lets the unique day key reject a claim that raced past the availability check', function () {
            claim('2026-11-10', 3);
            // The second request reads the calendar before the first claim is visible.
            h.state.hideDays = true;
            var racer = claim('2026-11-12', 3);
            h.state.hideDays = false;
            assert.isNull(racer);
            assert.lengthOf(h.rows('RentalBooking'), 1, 'the losing claim leaves no booking behind');
            assert.lengthOf(h.rows('RentalUnitDay'), 5, 'and no partial day rows');
        });

        it('takes over abandoned cart holds but never live ones', function () {
            var held = claim('2026-11-10', 3, { holdExpiresAt: new Date(Date.now() + 60000) });
            assert.equal(held.custom.status, 'HELD');
            assert.isNull(claim('2026-11-10', 3), 'live hold blocks the dates');
            h.rows('RentalUnitDay').forEach(function (row) { row.custom.holdExpiresAt = new Date(Date.now() - 1000); }); // eslint-disable-line no-param-reassign
            var taken = claim('2026-11-10', 3);
            assert.isNotNull(taken);
            assert.isFalse(calendar.renewHold(held, new Date(Date.now() + 60000)), 'the old hold learns it lost its days');
        });

        it('books a size trial for the day only', function () {
            var trial = claim('2026-11-10', 1, { type: 'TRIAL' });
            assert.deepEqual(h.days('LEH-RED-M-01'), ['2026-11-10']);
            assert.isNotNull(claim('2026-11-11', 3));
            assert.equal(trial.custom.type, 'TRIAL');
        });

        it('frees the days on release', function () {
            var booking = claim('2026-11-10', 3);
            calendar.release(booking, 'CANCELLED');
            assert.lengthOf(h.rows('RentalUnitDay'), 0);
            assert.equal(booking.custom.status, 'CANCELLED');
            assert.isNotNull(claim('2026-11-10', 3));
        });
    });

    describe('overdue rentals', function () {
        it('keeps the unit blocked and flags the next booking', function () {
            var late = claim('2026-11-04', 3);
            var next = claim('2026-11-09', 3);
            late.custom.status = 'WITH_CUSTOMER';
            // Due back on the 6th, still out on the 8th: needs the 9th and 10th for cleaning.
            assert.equal(calendar.extendOverdue(late, '2026-11-08'), next.custom.key);
            assert.isTrue(next.custom.atRisk);
            assert.equal(late.custom.blockedUntil, '2026-11-08');
        });

        it('charges the late fee per day', function () {
            assert.deepEqual(rentals.lateFee('2026-11-06', '2026-11-06'), { days: 0, fee: 0 });
            assert.deepEqual(rentals.lateFee('2026-11-06', '2026-11-09'), { days: 3, fee: 1500 });
        });
    });

    describe('desk lifecycle', function () {
        var booking;

        beforeEach(function () {
            booking = claim('2026-11-04', 3);
            booking.custom.depositAmount = 5000;
            booking.custom.currency = 'INR';
        });

        it('walks a rental from dispatch to deposit refund', function () {
            assert.equal(rentals.advance(booking, 'dispatch', {}, 'desk'), 'desk.error.tracking');
            assert.isNull(rentals.advance(booking, 'dispatch', { tracking: 'BD123' }, 'desk'));
            assert.isNull(rentals.advance(booking, 'deliver', {}, 'desk'));
            h.state.today = '2026-11-08';
            assert.isNull(rentals.advance(booking, 'receive', {}, 'desk'));
            assert.equal(booking.custom.lateDays, 2);
            assert.equal(booking.custom.lateFee, 1000);
            assert.equal(rentals.advance(booking, 'inspect', { damage: 6000 }, 'desk'), 'desk.error.damage');
            assert.isNull(rentals.advance(booking, 'inspect', { damage: 750, notes: 'Torn dupatta hem', photos: ['damage-1.jpg'], maintenance: true }, 'desk'));
            assert.equal(h.db['RentalUnit:LEH-RED-M-01'].custom.status, 'MAINTENANCE');
            assert.isNull(rentals.advance(booking, 'refund', { reference: 'RFND-77' }, 'desk'));
            assert.equal(booking.custom.refundAmount, 3250);
            assert.equal(booking.custom.status, 'DEPOSIT_REFUNDED');
            assert.lengthOf(booking.custom.history.split('\n'), 5);
        });

        it('refuses actions out of order', function () {
            assert.equal(rentals.advance(booking, 'refund', { reference: 'X' }, 'desk'), 'desk.error.state');
            assert.equal(rentals.advance(booking, 'complete', {}, 'desk'), 'desk.error.state', 'complete is for trials');
        });

        it('never refunds below zero', function () {
            booking.custom.damageAmount = 4500;
            booking.custom.lateFee = 1500;
            assert.equal(rentals.refundDue(booking), 0);
        });

        it('cancels a reservation and frees its days', function () {
            assert.isNull(rentals.advance(booking, 'cancel', {}, 'desk'));
            assert.equal(booking.custom.status, 'CANCELLED');
            assert.lengthOf(h.rows('RentalUnitDay'), 0);
        });
    });

    describe('basket and order', function () {
        function line(days, deposit) {
            var options = [
                { optionID: 'rentalDuration', optionValueID: String(days), proratedPrice: { value: 2000 } },
                { optionID: 'rentalDeposit', optionValueID: 'standard', proratedPrice: { value: deposit } }
            ];
            return {
                productID: 'lehenga-red-m',
                productName: 'Red bridal lehenga',
                product: { custom: { rentalEnabled: true } },
                quantityValue: 1,
                proratedPrice: { value: 9000 },
                custom: {},
                optionProductLineItems: { toArray: function () { return options; } }
            };
        }
        function container(lines) {
            return { productLineItems: { toArray: function () { return lines; } } };
        }
        var product = {
            ID: 'lehenga-red-m',
            name: 'Red bridal lehenga',
            optionModel: {
                getOption: function (id) { return id === 'rentalDuration' ? { ID: id } : null; },
                getOptionValue: function (option, id) { return ['3', '5', '7'].indexOf(id) >= 0 ? { ID: id } : null; },
                getSelectedOptionValue: function () { return { ID: '3' }; }
            }
        };
        // What the cart routes do: hold before the line exists, then attach it to the line.
        function addToBag(pli, start) {
            var held = rentals.hold(product, start, rentals.durationOf(pli));
            if (held.booking) rentals.attachHold(pli, held.booking);
            return held.error;
        }

        it('reads the duration from the posted options, falling back to the default', function () {
            assert.equal(rentals.durationFromOptions(product, [{ optionId: 'rentalDuration', selectedValueId: '7' }]), 7);
            assert.equal(rentals.durationFromOptions(product, [{ optionId: 'rentalDuration', selectedValueId: '99' }]), 3);
            assert.equal(rentals.durationFromOptions(product, []), 3);
        });

        it('holds the unit before the line exists and refuses taken or invalid dates', function () {
            var held = rentals.hold(product, '2026-11-10', 5);
            assert.equal(held.booking.custom.status, 'HELD');
            assert.equal(held.booking.custom.endDate, '2026-11-14');
            assert.equal(rentals.hold(product, '2026-11-12', 5).error, 'error.unavailable');
            assert.equal(rentals.hold(product, '2026-11-02', 3).error, 'error.dates');
            assert.equal(rentals.hold(product, '2026-11-20', 0).error, 'error.duration');
        });

        it('attaches the hold only to a matching line', function () {
            var held = rentals.hold(product, '2026-11-10', 5);
            var wrong = line(3, 5000);
            assert.isFalse(rentals.attachHold(wrong, held.booking));
            assert.isUndefined(wrong.custom.rentalBookingNo);
            var pli = line(5, 5000);
            assert.isTrue(rentals.attachHold(pli, held.booking));
            assert.equal(pli.custom.rentalStart, '2026-11-10');
        });

        it('stops checkout for rental lines without a valid hold', function () {
            var held = line(3, 5000);
            addToBag(held, '2026-11-10');
            assert.isNull(rentals.validateBasket(container([held])));
            assert.equal(rentals.validateBasket(container([line(3, 5000)])), 'error.hold.lost', 'rental line without a booking');
            held.quantityValue = 2;
            assert.equal(rentals.validateBasket(container([held])), 'error.hold.lost');
        });

        it('confirms the booking with what the order paid', function () {
            var pli = line(3, 5000);
            addToBag(pli, '2026-11-10');
            var order = container([pli]);
            Object.assign(order, { orderNo: '00001234', customerNo: 'C1', customerEmail: 'asha@example.test', customerName: 'Asha Rao', currencyCode: 'INR' });
            rentals.confirmOrder(order);
            var booking = rentals.get(pli.custom.rentalBookingNo);
            assert.equal(booking.custom.status, 'RESERVED');
            assert.equal(booking.custom.rentalFee, 11000);
            assert.equal(booking.custom.depositAmount, 5000);
            assert.isNull(booking.custom.holdExpiresAt);
            assert.isTrue(h.rows('RentalUnitDay').every(function (row) { return row.custom.holdExpiresAt === null; }), 'days are permanent now');
            assert.isNotOk(booking.custom.atRisk);
        });
    });

    describe('amount', function () {
        it('accepts non-negative amounts only', function () {
            assert.equal(rentals.amount('12.345'), 12.35);
            assert.equal(rentals.amount(''), 0);
            assert.isNaN(rentals.amount('-1'));
            assert.isNaN(rentals.amount('abc'));
        });
    });
});
