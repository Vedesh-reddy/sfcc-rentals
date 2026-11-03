'use strict';

/**
 * The job's step functions. Each one notes a failure in the job context, because a job carries on
 * after a failed step and would end OK unless its last step reports it.
 */

var Status = require('dw/system/Status');

/**
 * @param {Function} step - job step
 * @returns {Function} the step, noting a failure in the job context
 */
function track(step) {
    return function (params, stepExecution) {
        var note = function () {
            var context = stepExecution.getJobExecution().getContext();
            var failed = context.get('failedSteps');
            context.put('failedSteps', (failed ? failed + ', ' : '') + stepExecution.getStepID());
        };
        var status;
        try {
            status = step(params, stepExecution);
        } catch (e) {
            note();
            throw e;
        }
        if (status.error) note();
        return status;
    };
}

/**
 * Last step of the job: fails the job when an earlier step failed.
 * @param {Object} params - job parameters
 * @param {dw.job.JobStepExecution} stepExecution - the running step
 * @returns {dw.system.Status} ERROR naming the failed steps, otherwise OK
 */
function reportFailures(params, stepExecution) {
    var failed = stepExecution.getJobExecution().getContext().get('failedSteps');
    return failed ? new Status(Status.ERROR, 'ATTENTION', 'Failed steps: ' + failed) : new Status(Status.OK, 'OK', 'No failed steps');
}

module.exports = {
    releaseHolds: track(require('./releaseRentalHolds').execute),
    lateFees: track(require('./rentalLateFees').execute),
    reportFailures: reportFailures
};
