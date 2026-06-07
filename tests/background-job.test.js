import {describe, test} from 'node:test';
import assert from 'node:assert/strict';
import {BackgroundJob} from '../src/index.js';

/**
 * Minimal BackgroundJobRunner stub for unit-testing BackgroundJob in isolation.
 * @param {string} [baseName]
 * @returns {any}
 */
function makeFakeRunner(baseName = 'Worker') {
    return {
        baseName,
        name: `${baseName} Runner`,
        calls: {disableJob: [], suspendJob: [], isJobEnabled: []},
        enabled: new Set(),
        isJobEnabled(id) {
            this.calls.isJobEnabled.push(id);
            return this.enabled.has(id);
        },
        disableJob(id) {
            this.calls.disableJob.push(id);
        },
        suspendJob(id, duration) {
            this.calls.suspendJob.push({id, duration});
        },
    };
}

describe('BackgroundJob constructor', () => {
    test('derives name from the runner baseName and appends " #id"', () => {
        const runner = makeFakeRunner('Email');
        const job = new BackgroundJob(runner, 7);
        assert.equal(job.name, 'Email #7');
        assert.equal(job.id, 7);
        assert.equal(job.runner, runner);
    });

    test('accepts string ids', () => {
        const runner = makeFakeRunner();
        const job = new BackgroundJob(runner, 'task-42');
        assert.equal(job.id, 'task-42');
        assert.equal(job.name, 'Worker #task-42');
    });
});

describe('BackgroundJob default lifecycle methods', () => {
    test('init is a no-op and accepts an optional initParams argument', () => {
        const job = new BackgroundJob(makeFakeRunner(), 1);
        assert.doesNotThrow(() => job.init());
        assert.doesNotThrow(() => job.init({foo: 'bar'}));
    });

    test('destroy is a no-op', () => {
        const job = new BackgroundJob(makeFakeRunner(), 1);
        assert.doesNotThrow(() => job.destroy());
    });

    test('execute throws because it must be overridden by a subclass', async () => {
        const job = new BackgroundJob(makeFakeRunner(), 1);
        await assert.rejects(job.execute(), /execute\(\) must be implemented by a subclass/);
    });
});

describe('BackgroundJob.isEnabled', () => {
    test('delegates to runner with own id', () => {
        const runner = makeFakeRunner();
        runner.enabled.add(3);
        const job = new BackgroundJob(runner, 3);
        assert.equal(job.isEnabled(), true);
        assert.deepEqual(runner.calls.isJobEnabled, [3]);
    });

    test('returns whatever the runner returns', () => {
        const runner = makeFakeRunner();
        const job = new BackgroundJob(runner, 'missing');
        assert.equal(job.isEnabled(), false);
    });
});

describe('BackgroundJob.disable', () => {
    test('default suspend duration is 5000ms', () => {
        const runner = makeFakeRunner();
        const job = new BackgroundJob(runner, 5);
        job.disable();
        assert.deepEqual(runner.calls.disableJob, [5]);
        assert.deepEqual(runner.calls.suspendJob, [{id: 5, duration: 5000}]);
    });

    test('custom suspend duration is forwarded', () => {
        const runner = makeFakeRunner();
        const job = new BackgroundJob(runner, 5);
        job.disable(10_000);
        assert.deepEqual(runner.calls.suspendJob, [{id: 5, duration: 10_000}]);
    });

    test('suspendDuration of 0 disables but does not suspend', () => {
        const runner = makeFakeRunner();
        const job = new BackgroundJob(runner, 5);
        job.disable(0);
        assert.deepEqual(runner.calls.disableJob, [5]);
        assert.deepEqual(runner.calls.suspendJob, []);
    });
});