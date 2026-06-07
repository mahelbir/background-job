import {notImplemented} from "./utils.js";


/**
 * Base class for an individual background job.
 * Subclass and override {@link BackgroundJob#execute} for the work, with
 * optional {@link BackgroundJob#init}/{@link BackgroundJob#destroy} lifecycle hooks.
 */
export class BackgroundJob {

    /**
     * @param {import("./background-job-runner.js").BackgroundJobRunner} runner - Runner that owns and orchestrates this job
     * @param {string|number} id - Unique identifier of this job within the runner
     */
    constructor(runner, id) {
        /** @type {import("./background-job-runner.js").BackgroundJobRunner} */
        this.runner = runner;
        /** @type {string|number} */
        this.id = id;
        /** @type {string} */
        this.name = `${runner.baseName} #${id}`;
    }

    /**
     * Optional setup hook, called once before the execution loop starts.
     * @param {*} [params] - Arbitrary parameters supplied via the job definition
     * @returns {void}
     */
    init(params = null) {
    }

    /**
     * Optional teardown hook, called once after the execution loop ends.
     * @returns {void}
     */
    destroy() {
    }

    /**
     * @abstract Override in a subclass to perform the job's work.
     * @returns {Promise<void>}
     */
    async execute() {
        notImplemented("execute");
    }

    /**
     * Whether this job is currently enabled in the runner.
     * @returns {boolean}
     */
    isEnabled() {
        return this.runner.isJobEnabled(this.id);
    }

    /**
     * Disables this job and optionally suspends it for a cooldown period.
     * @param {number} [suspendDurationMs=3000] - Cooldown in ms before the job may run again; 0 disables without suspending
     */
    disable(suspendDurationMs = 3000) {
        this.runner.disableJob(this.id);
        suspendDurationMs && this.runner.suspendJob(this.id, suspendDurationMs);
    }

}