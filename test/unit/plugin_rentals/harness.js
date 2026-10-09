'use strict';

// Small in-memory Script API double for the rental engine. It checks the calendar
// and lifecycle rules, and models the custom object unique key that the engine relies on.
var Module = require('module');
var path = require('path');

var root = path.resolve(__dirname, '../../../cartridges/plugin_rentals/cartridge');
var active = {};
var original = Module._load; // eslint-disable-line no-underscore-dangle

// Only cartridge modules are redirected, so other suites in the same mocha run are unaffected.
Module._load = function (request, parent, isMain) { // eslint-disable-line no-underscore-dangle
    var ours = parent && parent.filename && parent.filename.indexOf(root) === 0;
    if (ours && active[request]) return active[request];
    if (ours && /^[*~]\/cartridge\//.test(request)) return original.call(this, path.join(root, request.slice(12)), parent, isMain);
    return original.call(this, request, parent, isMain);
};

/**
 * @param {*} a - attribute value
 * @param {*} b - query argument
 * @param {string} op - JavaScript comparison operator
 * @returns {boolean} comparison result, false for a missing value except on equality
 */
function compare(a, b, op) {
    var left = a instanceof Date ? a.getTime() : a;
    var right = b instanceof Date ? b.getTime() : b;
    if (left === undefined) left = null;
    if (op === '===') return left === right;
    if (op === '!==') return left !== right;
    if (left === null) return false;
    if (op === '<') return left < right;
    if (op === '<=') return left <= right;
    if (op === '>') return left > right;
    return left >= right;
}

/**
 * Turns a custom object query such as
 * "(custom.status = {0} OR custom.status = {1}) AND custom.endDate < {2}" into a predicate.
 * @param {string} condition - query
 * @param {Array} args - arguments
 * @returns {Function} row => boolean
 */
function predicate(condition, args) {
    var js = condition
        .replace(/custom\.(\w+)\s*(!=|>=|<=|=|<|>)\s*\{(\d+)\}/g, function (all, field, op, index) {
            return 'compare(row.custom.' + field + ', args[' + index + '], "' + ({ '=': '===', '!=': '!==' }[op] || op) + '")';
        })
        .replace(/ AND /g, ' && ')
        .replace(/ OR /g, ' || ');
    var test = new Function('row', 'args', 'compare', 'return ' + js + ';'); // eslint-disable-line no-new-func
    return function (row) { return test(row, args, compare); };
}

function harness() {
    var db = {};
    var preferences = { RentalsEnabled: true, RentalLeadDays: 3, RentalHorizonDays: 180, RentalBufferDays: 2, RentalHoldMinutes: 30, RentalLateFeePerDay: 500 };
    var state = { today: '2026-11-01', hideDays: false, uuid: 0 };

    function transactionWrap(fn) {
        var snapshot = {};
        Object.keys(db).forEach(function (id) { snapshot[id] = { row: db[id], custom: Object.assign({}, db[id].custom) }; });
        try {
            return fn();
        } catch (e) {
            Object.keys(db).forEach(function (id) { if (!(id in snapshot)) delete db[id]; });
            Object.keys(snapshot).forEach(function (id) {
                db[id] = snapshot[id].row;
                db[id].custom = snapshot[id].custom;
            });
            throw e;
        }
    }
    var customObjectMgr = {
        getCustomObject: function (type, key) { return db[type + ':' + key] || null; },
        createCustomObject: function (type, key) {
            var id = type + ':' + key;
            if (db[id]) throw new Error('UNIQUE_CONSTRAINT ' + id);
            db[id] = { type: type, custom: { key: key }, creationDate: new Date(Date.now() + Object.keys(db).length) };
            return db[id];
        },
        remove: function (row) {
            Object.keys(db).forEach(function (id) { if (db[id] === row) delete db[id]; });
        },
        queryCustomObjects: function (type, condition) {
            var test = predicate(condition, Array.prototype.slice.call(arguments, 3));
            var matches = Object.keys(db).map(function (id) { return db[id]; }).filter(function (row) {
                // hideDays mimics a claim committed by another shopper after this request read the calendar.
                return row.type === type && !(state.hideDays && type === 'RentalUnitDay') && test(row);
            });
            var i = 0;
            return { hasNext: function () { return i < matches.length; }, next: function () { return matches[i++]; }, close: function () {} };
        }
    };

    var stubs = {
        'dw/object/CustomObjectMgr': customObjectMgr,
        'dw/system/Transaction': { wrap: transactionWrap },
        'dw/system/Site': {
            current: { getCustomPreferenceValue: function (name) { return name in preferences ? preferences[name] : null; } },
            getCalendar: function () { return { day: state.today }; }
        },
        'dw/system/Logger': { getLogger: function () { return { warn: function () {}, info: function () {}, error: function () {} }; } },
        'dw/util/StringUtils': { formatCalendar: function (calendar) { return calendar.day || calendar.date.toISOString().slice(0, 10); } },
        'dw/util/Calendar': function (date) {
            this.date = date;
            this.setTimeZone = function () {};
        },
        'dw/util/UUIDUtils': { createUUID: function () { state.uuid += 1; return ('booking' + state.uuid + '0000000000').slice(0, 10) + 'tail'; } }
    };

    function load(relative) {
        Object.keys(require.cache).forEach(function (key) { if (key.indexOf(root) === 0) delete require.cache[key]; });
        active = stubs;
        return require(path.join(root, relative));
    }

    function unit(id, productID, status) {
        var row = customObjectMgr.createCustomObject('RentalUnit', id);
        row.custom.productID = productID;
        row.custom.status = status || 'ACTIVE';
        return row;
    }

    function days(unitID) {
        return Object.keys(db).filter(function (id) { return db[id].type === 'RentalUnitDay' && db[id].custom.unitID === unitID; })
            .map(function (id) { return db[id].custom.day; }).sort();
    }

    function rows(type) {
        return Object.keys(db).filter(function (id) { return db[id].type === type; }).map(function (id) { return db[id]; });
    }

    return { db: db, preferences: preferences, state: state, load: load, unit: unit, days: days, rows: rows };
}

module.exports = harness;
