import {describe, test} from 'node:test';
import assert from 'node:assert/strict';
import {sleepMs} from 'melperjs';
import {BackgroundJob, BackgroundJobRunner} from '../src/index.js';

function makeRunner(name) {
    return name === undefined ? new BackgroundJobRunner() : new BackgroundJobRunner(name);
}

describe('BackgroundJobRunner constructor', () => {
    test('appends " Runner" to default name', () => {
        assert.equal(makeRunner().name, 'BackgroundJob Runner');
    });

    test('appends " Runner" to a custom name and stores the base name', () => {
        const runner = makeRunner('Email');
        assert.equal(runner.name, 'Email Runner');
        assert.equal(runner.baseName, 'Email');
    });

    test('initializes empty job tracking maps', () => {
        const runner = makeRunner();
        assert.deepEqual(runner.enabledJobs, {});
        assert.deepEqual(runner.runningJobs, {});
        assert.deepEqual(runner.suspendedJobs, {});
    });
});

describe('BackgroundJobRunner.isJobEnabled / isJobRunning', () => {
    test('isJobEnabled reflects the enabledJobs map', () => {
        const runner = makeRunner();
        assert.equal(runner.isJobEnabled(1), false);
        runner.enabledJobs[1] = true;
        assert.equal(runner.isJobEnabled(1), true);
    });

    test('isJobRunning reflects the runningJobs map', () => {
        const runner = makeRunner();
        assert.equal(runner.isJobRunning('a'), false);
        runner.runningJobs['a'] = /** @type {any} */ ({});
        assert.equal(runner.isJobRunning('a'), true);
    });
});

describe('BackgroundJobRunner.disableJob', () => {
    test('removes the id from enabledJobs', () => {
        const runner = makeRunner();
        runner.enabledJobs[1] = true;
        runner.enabledJobs[2] = true;
        runner.disableJob(1);
        assert.deepEqual(runner.enabledJobs, {2: true});
    });

    test('disabling an unknown id is a no-op', () => {
        const runner = makeRunner();
        runner.disableJob('missing');
        assert.deepEqual(runner.enabledJobs, {});
    });
});

describe('BackgroundJobRunner.suspendJob', () => {
    test('sets a future expiry timestamp for the id', () => {
        const runner = makeRunner();
        const before = Date.now();
        runner.suspendJob(1, 5000);
        const after = Date.now();
        assert.ok(runner.suspendedJobs[1] >= before + 5000);
        assert.ok(runner.suspendedJobs[1] <= after + 5000);
    });

    test('overwrites any prior suspension for the same id', () => {
        const runner = makeRunner();
        runner.suspendJob(1, 1000);
        const first = runner.suspendedJobs[1];
        runner.suspendJob(1, 10_000);
        assert.ok(runner.suspendedJobs[1] > first);
    });
});

describe('BackgroundJobRunner.iteratingJobList', () => {
    class NoopJob extends BackgroundJob {
        async execute() {
        }
    }

    test('returns an array of N definitions with sequential 1-based ids', () => {
        const list = BackgroundJobRunner.iteratingJobList(3, NoopJob);
        assert.equal(list.length, 3);
        assert.deepEqual(list.map(d => d.id), [1, 2, 3]);
        for (const def of list) {
            assert.equal(def.jobClass, NoopJob);
            assert.equal(def.initParams, null);
            assert.equal(def.delayMs, 0);
            assert.equal(def.isFixedRate, false);
        }
    });

    test('forwards initParams, delayMs, and isFixedRate', () => {
        const list = BackgroundJobRunner.iteratingJobList(2, NoopJob, {
            initParams: {x: 1},
            delayMs: 250,
            isFixedRate: true,
        });
        assert.equal(list.length, 2);
        for (const def of list) {
            assert.deepEqual(def.initParams, {x: 1});
            assert.equal(def.delayMs, 250);
            assert.equal(def.isFixedRate, true);
        }
    });

    test('returns an empty array when count is 0', () => {
        assert.deepEqual(BackgroundJobRunner.iteratingJobList(0, NoopJob), []);
    });

    test('default getExecutableJobs throws because it must be overridden', async () => {
        await assert.rejects(makeRunner().getExecutableJobs(), /getExecutableJobs\(\) must be implemented by a subclass/);
    });
});

describe('BackgroundJobRunner._startJob loop', () => {
    test('instantiates the job, calls init with initParams, runs execute while enabled, then destroys', async () => {
        const calls = {init: [], executes: 0, destroy: 0};

        class TrackingJob extends BackgroundJob {
            init(params) {
                calls.init.push(params);
            }

            async execute() {
                calls.executes += 1;
                if (calls.executes >= 3) {
                    this.runner.disableJob(this.id);
                }
            }

            destroy() {
                calls.destroy += 1;
            }
        }

        const runner = makeRunner();
        runner.enabledJobs[1] = true;
        await runner._startJob({id: 1, jobClass: TrackingJob, initParams: {seed: 42}});

        assert.deepEqual(calls.init, [{seed: 42}]);
        assert.equal(calls.executes, 3);
        assert.equal(calls.destroy, 1);
        assert.equal(1 in runner.runningJobs, false);
    });

    test('reuses an existing instance from runningJobs instead of constructing a new one', async () => {
        let constructed = 0;

        class CountingJob extends BackgroundJob {
            constructor(runner, id) {
                super(runner, id);
                constructed += 1;
            }

            async execute() {
                this.runner.disableJob(this.id);
            }
        }

        const runner = makeRunner();
        runner.runningJobs[1] = new CountingJob(runner, 1);
        runner.enabledJobs[1] = true;

        await runner._startJob({id: 1, jobClass: CountingJob});

        assert.equal(constructed, 1);
        assert.equal(1 in runner.runningJobs, false);
    });

    test('catches errors thrown from execute and keeps looping', async () => {
        let executes = 0;
        const originalError = console.error;
        const errors = [];
        console.error = (...args) => {
            errors.push(args);
        };

        try {
            class BoomJob extends BackgroundJob {
                async execute() {
                    executes += 1;
                    if (executes === 1) {
                        throw new Error('boom');
                    }
                    this.runner.disableJob(this.id);
                }
            }

            const runner = makeRunner();
            runner.enabledJobs[1] = true;
            await runner._startJob({id: 1, jobClass: BoomJob});

            assert.equal(executes, 2);
            assert.equal(errors.length, 1);
            // Job name derives from runner.baseName, so a default runner (baseName
            // "BackgroundJob") yields "BackgroundJob #1".
            assert.match(errors[0][0], /\[BackgroundJob #1] error/);
            assert.equal(errors[0][1].message, 'boom');
        } finally {
            console.error = originalError;
        }
    });

    test('exits immediately when the id is not enabled', async () => {
        let executes = 0;

        class NeverEnabledJob extends BackgroundJob {
            async execute() {
                executes += 1;
            }
        }

        const runner = makeRunner();
        await runner._startJob({id: 'x', jobClass: NeverEnabledJob});

        assert.equal(executes, 0);
        assert.equal('x' in runner.runningJobs, false);
    });

    test('with isFixedRate=true, total time is bounded by N * delay', async () => {
        const executeMs = 30;
        const delay = 80;
        const iterations = 3;

        class SlowJob extends BackgroundJob {
            async execute() {
                this.runs = (this.runs || 0) + 1;
                await sleepMs(executeMs);
                if (this.runs >= iterations) {
                    this.runner.disableJob(this.id);
                }
            }
        }

        const runner = makeRunner();
        runner.enabledJobs[1] = true;
        const start = Date.now();
        await runner._startJob({id: 1, jobClass: SlowJob, delayMs: delay, isFixedRate: true});
        const elapsed = Date.now() - start;

        assert.ok(elapsed >= iterations * executeMs, `elapsed=${elapsed} should be >= ${iterations * executeMs}`);
        assert.ok(elapsed < iterations * (delay + executeMs), `elapsed=${elapsed} should be < ${iterations * (delay + executeMs)} (would mean delay was added on top of execute)`);
    });

    test('default mode (isFixedRate unspecified) behaves as false — sleeps full delay', async () => {
        const executeMs = 20;
        const delay = 60;
        const iterations = 3;

        class SlowJob extends BackgroundJob {
            async execute() {
                this.runs = (this.runs || 0) + 1;
                await sleepMs(executeMs);
                if (this.runs >= iterations) {
                    this.runner.disableJob(this.id);
                }
            }
        }

        const runner = makeRunner();
        runner.enabledJobs[1] = true;
        const start = Date.now();
        // Note: no isFixedRate passed — should default to false.
        await runner._startJob({id: 1, jobClass: SlowJob, delayMs: delay});
        const elapsed = Date.now() - start;

        const minExpected = iterations * (executeMs + delay) - delay;
        assert.ok(elapsed >= minExpected, `elapsed=${elapsed} should be >= ${minExpected} (default must be false-mode)`);
    });

    test('with isFixedRate=false, sleeps the full delay after each execute', async () => {
        const executeMs = 20;
        const delay = 60;
        const iterations = 3;

        class SlowJob extends BackgroundJob {
            async execute() {
                this.runs = (this.runs || 0) + 1;
                await sleepMs(executeMs);
                if (this.runs >= iterations) {
                    this.runner.disableJob(this.id);
                }
            }
        }

        const runner = makeRunner();
        runner.enabledJobs[1] = true;
        const start = Date.now();
        await runner._startJob({id: 1, jobClass: SlowJob, delayMs: delay, isFixedRate: false});
        const elapsed = Date.now() - start;

        // Expect roughly iterations * (executeMs + delay), with the final delay also waited.
        // Use a generous lower bound to avoid flakiness; the upper bound proves delay was NOT absorbed by execute.
        const minExpected = iterations * (executeMs + delay) - delay;
        assert.ok(elapsed >= minExpected, `elapsed=${elapsed} should be >= ${minExpected}`);
    });

    test('with delay=0 there is no inter-iteration sleep', async () => {
        let executes = 0;

        class FastJob extends BackgroundJob {
            async execute() {
                executes += 1;
                if (executes >= 50) {
                    this.runner.disableJob(this.id);
                }
            }
        }

        const runner = makeRunner();
        runner.enabledJobs[1] = true;
        const start = Date.now();
        await runner._startJob({id: 1, jobClass: FastJob, delayMs: 0});
        const elapsed = Date.now() - start;

        assert.equal(executes, 50);
        assert.ok(elapsed < 200, `elapsed=${elapsed} should be small with delay=0`);
    });
});