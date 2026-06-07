# background-job

[![npm version](https://img.shields.io/npm/v/background-job.svg)](https://www.npmjs.com/package/background-job)

Managed background jobs for Node.js. Provides suspension, disabling, and controlled execution loops for long-running worker processes.
## Installation

```bash
npm i background-job
```

Ships a dual ESM/CJS build, so both forms are supported:

```javascript
// ES Module
import {BackgroundJob, BackgroundJobRunner} from "background-job";

// CommonJS
const {BackgroundJob, BackgroundJobRunner} = require("background-job");
```

## Usage

Subclass `BackgroundJob` for the work and `BackgroundJobRunner` to enumerate which jobs run.

### Fixed worker pool

A set of identical workers that each loop with a delay — sized from config, backing off when there is nothing to do:

```javascript
import {BackgroundJob, BackgroundJobRunner} from "background-job";

class QueueWorker extends BackgroundJob {
    async execute() {
        const item = await pullNextItem();
        if (!item) {
            return this.disable(); // stop and cool down; a later poll re-enables it
        }
        await processItem(item);
    }
}

class QueueRunner extends BackgroundJobRunner {
    async getExecutableJobs() {
        const workers = config.get("queue.workers", 3);
        return this.constructor.iteratingJobList(workers, QueueWorker, {delayMs: 1000});
    }
}

await new QueueRunner("queue").executeJobs(); // runs forever, polling for executable jobs
```

### One job per entity

When the work is dynamic — one job per row from a data source — return the `BackgroundJobDefinition` objects directly.
`initParams` carries per-job context into `init()`, and the lifecycle hooks set up and tear down resources:

```javascript
import {BackgroundJob, BackgroundJobRunner} from "background-job";

class AccountJob extends BackgroundJob {
    init(account) {
        this.account = account;          // the definition's initParams
        this.api = createApiClient(account);
    }

    async execute() {
        await this.api.sync(this.account);
    }

    destroy() {
        this.api.close();                // called once when the job stops
    }
}

class AccountRunner extends BackgroundJobRunner {
    async getExecutableJobs() {
        const accounts = await loadActiveAccounts(); // dynamic, e.g. from a DB
        return accounts.map((account) => ({
            id: account.id,
            jobClass: AccountJob,
            initParams: account,
            delayMs: 2500,
        }));
    }
}

await new AccountRunner("account").executeJobs();
```

Returning a job's id keeps it running; omitting it on a later poll disables it (and triggers its `destroy()`).
`getExecutableJobs()` is the single source of truth for what should be active.

## How it works

`executeJobs()` runs a polling loop every `pollIntervalMs`. On each tick it calls `getExecutableJobs()`, lifts any
expired suspensions, and starts every enabled job that is not already running. Each started job is jittered to avoid a
thundering herd, then loops its own `execute()` with the configured delay until it is disabled.

## API

### `BackgroundJob`

Base class for an individual job. The runner instantiates it for you — subclass and override the hooks.

| Member                              | Description                                                                                     |
|-------------------------------------|-------------------------------------------------------------------------------------------------|
| `async execute()`                   | **Abstract.** The job's work; must be overridden or it throws. Called repeatedly while enabled. |
| `init(params)`                      | Optional setup hook, called once before the loop starts.                                        |
| `destroy()`                         | Optional teardown hook, called once after the loop ends.                                        |
| `isEnabled()`                       | `boolean` — whether this job is still enabled in the runner.                                    |
| `disable(suspendDurationMs = 5000)` | Disables the job and suspends it for a cooldown; pass `0` to disable without suspending.        |
| `runner` / `id` / `name`            | The owning runner, this job's id, and its derived name (`"<base> #<id>"`).                      |

### `BackgroundJobRunner`

Orchestrator that owns enabled/running/suspended state per job id.

| Member                                              | Description                                                                                                   |
|-----------------------------------------------------|---------------------------------------------------------------------------------------------------------------|
| `new BackgroundJobRunner(name = "BackgroundJob")`   | `name` is the base name jobs derive from; `" Runner"` is appended for the runner's own name.                  |
| `async getExecutableJobs()`                         | **Abstract.** Return the `BackgroundJobDefinition[]` that should be running; must be overridden or it throws. |
| `async executeJobs(pollIntervalMs = 1000)`          | Starts the main loop. Runs indefinitely.                                                                      |
| `isJobEnabled(id)` / `isJobRunning(id)`             | `boolean` state checks by id.                                                                                 |
| `disableJob(id)`                                    | Disables a job by id (stops its loop on the next iteration).                                                  |
| `suspendJob(id, durationMs)`                        | Suspends a job by id for `durationMs`, preventing re-enable until it elapses.                                 |
| `static iteratingJobList(count, jobClass, options)` | Builds `count` identical definitions with sequential 1-based index ids.                                       |

### `BackgroundJobDefinition`

The object returned (per job) by `getExecutableJobs()`:

| Field         | Type                   | Description                                                                                                                                                       |
|---------------|------------------------|-------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| `id`          | `string \| number`     | Unique job identifier.                                                                                                                                            |
| `jobClass`    | `typeof BackgroundJob` | The `BackgroundJob` subclass to instantiate.                                                                                                                      |
| `initParams`  | `*`                    | Optional — passed to the job's `init()`.                                                                                                                          |
| `delayMs`     | `number`               | Optional (default `0`) — delay between executions in ms.                                                                                                          |
| `isFixedRate` | `boolean`              | Optional (default `false`) — when `true`, execute time counts toward the delay (fixed-rate); otherwise the full delay is waited after each execute (fixed-delay). |

## License

The MIT License (MIT). Please see [License File](LICENSE) for more information.