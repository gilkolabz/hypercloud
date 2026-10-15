/**
 * jockey-orient — RETIRED (not in warez).
 *
 * Folded into jockey_tiny: +1 tiny-orient, +1 tiny-base,
 * stage-member add stage-tiny / tiny-orient, callin `orient …`.
 * @see A_document/tiny.md
 *
 * Keep this file only so old mount paths do not 404; claims are empty.
 * Unmount / stop potting this module.
 */

export const register = (navi) => {
    if (typeof navi?.callout === "function") {
        navi.callout(
            "[jockey-orient] retired — use jockey_tiny (tiny-orient / tiny-base / stage-tiny)"
        );
    }
    return {
        name: "jockey-orient",
        version: "0.2.0-retired",
        description:
            "RETIRED: folded into jockey_tiny (tiny-orient, tiny-base, stage-tiny).",
        moduleInfo: {
            name: "jockey-orient",
            version: "0.2.0-retired",
            description:
                "RETIRED: folded into jockey_tiny (tiny-orient, tiny-base, stage-tiny).",
        },
        scrollbufferPlugin: {
            id: "jockey-orient",
            name: "jockey-orient",
            claims: [],
        },
        onMount: async () => {
            console.warn(
                "[jockey-orient] retired — prefer jockey_tiny tiny-orient/tiny-base"
            );
        },
        onUnmount: () => {},
    };
};
