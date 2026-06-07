import {test, describe} from "node:test";
import assert from "node:assert/strict";
import {existsSync} from "node:fs";
import {fileURLToPath} from "node:url";
import path from "node:path";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const ESM_PATH = path.join(ROOT, "dist/index.mjs");
const CJS_PATH = path.join(ROOT, "dist/index.cjs");

const buildAvailable = existsSync(ESM_PATH) && existsSync(CJS_PATH);
const skipReason = buildAvailable ? false : "build artifacts missing — run `npm run build` first";

const esm = buildAvailable ? await import(ESM_PATH) : null;
const cjsMod = buildAvailable ? await import(CJS_PATH) : null;
const cjs = cjsMod ? (cjsMod.default || cjsMod) : null;

describe("build artifacts", () => {
    test("ESM and CJS expose the same set of named exports", {skip: skipReason}, () => {
        const esmKeys = Object.keys(esm).filter((k) => k !== "default").sort();
        const cjsKeys = Object.keys(cjs).filter((k) => k !== "default").sort();
        assert.deepEqual(esmKeys, cjsKeys, "ESM/CJS export sets differ");
    });

    test("ESM and CJS exports are all functions/values of the same type", {skip: skipReason}, () => {
        for (const k of Object.keys(esm)) {
            if (k === "default") continue;
            assert.equal(
                typeof esm[k],
                typeof cjs[k],
                `type mismatch for export "${k}": esm=${typeof esm[k]} cjs=${typeof cjs[k]}`,
            );
        }
    });

    // If the public API is deterministic (e.g. seeded), uncomment and adapt:
    //
    // test("ESM and CJS produce identical seeded output", {skip: skipReason}, () => {
    //     for (const seed of [0, 1, 42, "abc"]) {
    //         assert.deepEqual(esm.someFunction({seed}), cjs.someFunction({seed}));
    //     }
    // });
});
