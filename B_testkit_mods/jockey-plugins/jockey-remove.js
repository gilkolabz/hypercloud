/**
 * jockey-remove — scrollbuffer claim: drop the selected stage-member.
 * Mutates the red-select origin, so execute calls api.terminate().
 */

function hasType(context, name) {
    const types = Array.isArray(context?.types) ? context.types : [];
    return types.includes(name) || context?.kind === name;
}

const HELP = [
    "jockey_remove — take a stage-member off the stage.",
    "use: select a stage-member with stagejockey → −1 \"jockey-remove\".",
    "needs: stagejockey",
].join("\n");

export const register = (navi) => {
    const scrollbufferPlugin = {
        id: "jockey-remove",
        name: "jockey-remove",
        claims: [
            {
                id: "remove",
                direction: -1,
                types: ["stage-member"],
                color: "tomato",
                describe: () => ({
                    text: "jockey-remove",
                    color: "tomato",
                    textShadow: "0 1px 2px #330000, 0 0 2px #000, 0 0 1px #000",
                }),
                matches: (context) => hasType(context, "stage-member"),
                async execute(context, api) {
                    const stage = api.stage;
                    if (!stage) throw new Error("stage unavailable");
                    const slot = context.slot;
                    const index = context.index;
                    if (slot == null || index == null) {
                        throw new Error("stage-member missing slot/index");
                    }

                    const removed = stage.removeAt(slot, index);
                    if (!removed) {
                        throw new Error(`no item at ${slot}[${index}]`);
                    }
                    await stage.persist();

                    if (typeof navi.callout === "function") {
                        navi.callout(`[jockey-remove] removed ${slot}[${index}]`);
                    }

                    // Selection slot/index is stale after remove — end the hold.
                    if (typeof api.terminate === "function") api.terminate();
                    return undefined;
                },
            },
        ],
    };

    return {
        name: "jockey_remove",
        commands: {
            jockey_remove: { name: "jockey_remove", description: "help", execute: async () => HELP },
        },
        version: "0.1.5",
        description: "Scrollbuffer: remove stage-member from the live stage",
        moduleInfo: {
            name: "jockey_remove",
            version: "0.1.5",
            description: "Scrollbuffer: remove stage-member from the live stage",
        },
        scrollbufferPlugin,
    };
};
