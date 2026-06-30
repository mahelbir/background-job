import {forever, randomInteger, sleepMs} from "melperjs";
import {notImplemented} from "./utils.js";


/**
 * @typedef {Object} BackgroundJobDefinition
 * @property {string|number} id - Unique job identifier
 * @property {typeof import("./background-job.js").BackgroundJob} jobClass - BackgroundJob subclass constructor
 * @property {*} [initParams] - Parameters passed to init()
 * @property {number} [delayMs=0] - Delay between executions in ms
 * @property {boolean} [isFixedDelay=true] - When true (default), the full delay is waited after each execute (fixed-delay); when false, execute time counts toward the delay (fixed-rate)
 */

/**
 * Orchestrates background jobs, owning enabled/running/suspended state per job id.
 * Subclass and override {@link BackgroundJobRunner#getExecutableJobs} to enumerate work.
 */
export class BackgroundJobRunner {

    /**
     * @param {string} [name="BackgroundJob"] - Base name; jobs derive their name from it and " Runner" is appended to form {@link BackgroundJobRunner#name}
     */
    constructor(name = "BackgroundJob") {
        /** @type {string} */
        this.baseName = name;
        /** @type {string} */
        this.name = `${name} Runner`;
        /** @type {Object<string|number, boolean>} */
        this.enabledJobs = {};
        /** @type {Object<string|number, import("./background-job.js").BackgroundJob>} */
        this.runningJobs = {};
        /** @type {Object<string|number, number>} */
        this.suspendedJobs = {};
    }

    /**
     * Whether the job with the given id is currently enabled.
     * @param {string|number} id - Job identifier
     * @returns {boolean}
     */
    isJobEnabled(id) {
        return id in this.enabledJobs;
    }

    /**
     * Whether the job with the given id is currently running.
     * @param {string|number} id - Job identifier
     * @returns {boolean}
     */
    isJobRunning(id) {
        return id in this.runningJobs;
    }

    /**
     * Disables the job, stopping its execution loop on the next iteration.
     * @param {string|number} id - Job identifier
     */
    disableJob(id) {
        delete this.enabledJobs[id];
    }

    /**
     * Suspends the job until the cooldown elapses, preventing it from being re-enabled.
     * @param {string|number} id - Job identifier
     * @param {number} durationMs - Cooldown duration in ms from now
     */
    suspendJob(id, durationMs) {
        this.suspendedJobs[id] = Date.now() + durationMs;
    }

    /**
     * Instantiates (or reuses) the job, runs its init/execute/destroy lifecycle,
     * and loops execute() with the configured delay while the job stays enabled.
     * @private
     * @param {BackgroundJobDefinition} definition - Definition describing the job to run
     * @returns {Promise<void>}
     */
    async _startJob(definition) {
        definition.delayMs = definition.delayMs || 0;
        definition.isFixedDelay = definition.isFixedDelay !== false;
        const id = definition.id;
        if (!this.runningJobs[id]) {
            this.runningJobs[id] = new definition.jobClass(this, id);
        }
        const ref = this.runningJobs[id];
        ref.init(definition.initParams);
        while (this.isJobEnabled(id)) {
            const startTime = Date.now();
            try {
                await ref.execute();
            } catch (e) {
                console.error(`[${ref.name}] error`, e);
            }
            if (definition.delayMs > 0) {
                if (definition.isFixedDelay) {
                    await sleepMs(definition.delayMs);
                } else {
                    const remaining = definition.delayMs - (Date.now() - startTime);
                    if (remaining > 0) {
                        await sleepMs(remaining);
                    }
                }
            }
        }
        ref.destroy();
        delete this.runningJobs[id];
    }

    /**
     * Runs the main loop: periodically refreshes the executable job set, lifts
     * expired suspensions, and starts any enabled job that is not already running.
     * @param {number} [pollIntervalMs=1000] - Interval in ms between job status checks
     * @returns {Promise<void>}
     */
    async executeJobs(pollIntervalMs = 1000) {
        await forever(pollIntervalMs, async () => {
            const jobs = await this.getExecutableJobs();
            this.enabledJobs = {};
            for (const job of jobs) {
                const id = job.id;

                if (id in this.suspendedJobs) {
                    if (Date.now() > this.suspendedJobs[id]) {
                        delete this.suspendedJobs[id];
                        this.enabledJobs[id] = true;
                    }
                } else {
                    this.enabledJobs[id] = true;
                }

                if (this.isJobEnabled(id) && !this.isJobRunning(id)) {
                    await sleepMs(randomInteger(300, 1000));
                    this._startJob(job).catch(console.error);
                }
            }
        }, (e) => {
            console.error(`[${this.name}] error`, e);
        });
    }

    /**
     * @abstract Override in a subclass to enumerate executable jobs.
     * @returns {Promise<BackgroundJobDefinition[]>}
     */
    async getExecutableJobs() {
        notImplemented("getExecutableJobs");
    }

    /**
     * Builds a list of identical job definitions with sequential 1-based ids.
     * @param {number} count - Number of definitions to generate
     * @param {typeof import("./background-job.js").BackgroundJob} jobClass - BackgroundJob subclass to use for every definition
     * @param {{initParams?: *, delayMs?: number, isFixedDelay?: boolean}} [options] - Shared options applied to every definition
     * @returns {BackgroundJobDefinition[]}
     */
    static iteratingJobList(count, jobClass, {initParams = null, delayMs = 0, isFixedDelay = true} = {}) {
        return Array.from({length: count}, (_, i) => ({
            id: i + 1,
            jobClass,
            initParams,
            delayMs,
            isFixedDelay
        }));
    }

}