/**
 * Navi Eval
 *
 * Evaluates an async JavaScript expression with `navi` in scope.
 * This module intentionally grants arbitrary code execution to whoever can use
 * its callin verbs. Mount it only in spaces where that authority is acceptable.
 */

export const register = (navi) => {
    const MODULE_NAME = "navi_eval";
    const VERSION = "1.0.0";
    const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;

    const evaluate = async (source) => {
        const code = String(source || "").trim();
        if (!code) {
            navi.callout("[navi_eval] usage: eval <javascript expression>");
            return undefined;
        }

        try {
            const fn = new AsyncFunction(
                "navi",
                `"use strict"; return (${code});`
            );
            const result = await fn(navi);
            navi.callout("[navi_eval] success");
            navi.callout(result);
        } catch (error) {
            const message =
                error && typeof error.message === "string"
                    ? error.message
                    : String(error);
            navi.callout(`[navi_eval] error: ${message}`);
        }

        // Callouts above are deliberate; do not return the result and cause the
        // shell's command dispatcher to emit it again.
        return undefined;
    };

    const execute = async (...args) => evaluate(args.join(" "));

    return {
        name: MODULE_NAME,
        version: VERSION,
        description:
            "Evaluate async JavaScript expressions and call out the resolved value.",
        moduleInfo: {
            name: MODULE_NAME,
            version: VERSION,
            description:
                "Evaluate async JavaScript expressions and call out the resolved value.",
        },
        evaluate,
        commands: {
            navi_eval: {
                name: "navi_eval",
                description: "navi_eval <javascript expression>",
                execute,
            },
            eval: {
                name: "eval",
                description: "eval <javascript expression>",
                execute,
            },
        },
    };
};
