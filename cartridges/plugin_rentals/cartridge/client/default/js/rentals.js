'use strict';

/**
 * @param {HTMLElement} panel - rental panel
 * @returns {string} the product ID currently selected on the page (the variant once a size is chosen)
 */
function currentPid(panel) {
    var detail = panel.closest('.product-detail');
    var id = detail && detail.querySelector('.product-id');
    return id ? id.textContent.trim() : '';
}

/**
 * @param {HTMLElement} panel - rental panel
 * @returns {string} selected rental days, read from the duration option select
 */
function currentDuration(panel) {
    var detail = panel.closest('.product-detail') || document;
    var select = detail.querySelector('.product-option[data-option-id="rentalDuration"] select');
    var option = select && select.options[select.selectedIndex];
    return option ? option.getAttribute('data-value-id') : '';
}

/**
 * Asks the server whether the chosen dates are free and announces the answer.
 * @param {HTMLElement} panel - rental panel
 */
function quote(panel) {
    var start = panel.querySelector('.rental-start').value;
    var status = panel.querySelector('.rental-quote-status');
    if (!start) {
        status.textContent = '';
        return;
    }
    var params = new URLSearchParams({ pid: currentPid(panel), duration: currentDuration(panel), start: start });
    fetch(panel.getAttribute('data-quote-url') + (panel.getAttribute('data-quote-url').indexOf('?') < 0 ? '?' : '&') + params.toString(), {
        credentials: 'same-origin',
        headers: { 'X-Requested-With': 'XMLHttpRequest' }
    }).then(function (response) {
        return response.json();
    }).then(function (data) {
        status.textContent = data.message || '';
        status.classList.toggle('text-success', !!data.available);
        status.classList.toggle('text-danger', !data.available);
    }).catch(function () {
        status.textContent = '';
    });
}

/**
 * Books a size trial and shows the result.
 * @param {HTMLFormElement} form - trial form
 */
function bookTrial(form) {
    var status = form.querySelector('.rental-trial-status');
    form.querySelector('[name="pid"]').value = currentPid(form.closest('[data-rental-panel]'));
    fetch(form.action, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'X-Requested-With': 'XMLHttpRequest' },
        body: new URLSearchParams(new FormData(form)).toString()
    }).then(function (response) {
        return response.json();
    }).then(function (data) {
        if (data.redirectUrl) {
            window.location.href = data.redirectUrl;
            return;
        }
        status.textContent = data.message || '';
        status.classList.toggle('text-success', !!data.success);
        status.classList.toggle('text-danger', !data.success);
    }).catch(function () {
        window.location.reload();
    });
}

document.addEventListener('change', function (event) {
    var panel = event.target.closest('[data-rental-panel]');
    if (panel && event.target.classList.contains('rental-start')) quote(panel);
});

document.addEventListener('submit', function (event) {
    var form = event.target.closest('.rental-trial-form');
    if (!form) return;
    event.preventDefault();
    bookTrial(form);
});

// The base product scripts use jQuery events, so the start date joins the add-to-cart request there.
if (window.jQuery) {
    window.jQuery(document).on('updateAddToCartFormData', function (event, form) {
        var detail = event.target.closest('.product-detail') || document;
        var input = detail.querySelector('[data-rental-panel] .rental-start');
        if (input) form.rentalStart = input.value; // eslint-disable-line no-param-reassign
    });
    // A new size or duration changes the answer.
    window.jQuery('body').on('product:afterAttributeSelect', function () {
        document.querySelectorAll('[data-rental-panel]').forEach(quote);
    });
}
