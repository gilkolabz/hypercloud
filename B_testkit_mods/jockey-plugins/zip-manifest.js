/**
 * zip-manifest — wrap any jockey object as a manifest (+1), then stash
 * manifests into navi.storage.item("stagejockey-zip-manifest") (+1).
 *
 * Zip produces a *new* scrollbuffer object: types are only manifest+json.
 * Prior nesting / DOM / htmf parts are not inherited (payload lives on .json).
 */

const STORAGE_KEY = "stagejockey-zip-manifest";

function hasType(context, name) {
    const types = Array.isArray(context?.types) ? context.types : [];
    return types.includes(name) || context?.kind === name;
}

function resolvePart(context) {
    if (context?.part) return String(context.part).toLowerCase();
    if (context?.presentation?.type) {
        return String(context.presentation.type).toLowerCase();
    }
    if (
        context?.type &&
        context.type !== "offstage-member" &&
        context.type !== "stage-member"
    ) {
        return String(context.type).toLowerCase();
    }
    return "";
}

function looksLikeJson(context) {
    if (hasType(context, "json")) return true;
    if (context?.json != null && typeof context.json === "object") return true;
    if (context?.value != null && typeof context.value === "object") return true;
    if (context?.frame != null && typeof context.frame === "object") return true;
    if (context?.record != null && typeof context.record === "object") return true;
    return false;
}

/** Drop DOM nodes / functions so the zip array stays serializable. */
function snapshot(context) {
    try {
        return JSON.parse(
            JSON.stringify(context, (_key, value) => {
                if (typeof value === "function") return undefined;
                if (value && typeof value === "object" && value.nodeType) {
                    return undefined;
                }
                // Nesting is DOM-tied parentage — never carry into a zip tip.
                if (
                    _key === "nesting" ||
                    _key === "element" ||
                    _key === "hostElement" ||
                    _key === "zoneElement"
                ) {
                    return undefined;
                }
                return value;
            })
        );
    } catch {
        return {
            types: Array.isArray(context?.types) ? context.types.slice() : [],
            kind: context?.kind || null,
            label: context?.label || null,
            part: context?.part || null,
            parts: Array.isArray(context?.parts) ? context.parts.slice() : [],
        };
    }
}

function zipAsManifest(context) {
    const part = resolvePart(context);
    const json = looksLikeJson(context)
        ? (context.json ??
          context.frame ??
          context.record ??
          (typeof context.value === "object" && context.value != null
              ? context.value
              : snapshot(context)))
        : snapshot(context);

    // Distinct object: do not spread prior context (nesting/htmf claims/legend).
    return {
        types: ["manifest", "json"],
        kind: "manifest",
        parts: ["manifest", "json"],
        label: context?.label ? `zip ${context.label}` : "zip-manifest",
        json,
        zipped: true,
        ...(part ? { sourcePart: part } : {}),
    };
}

const HELP = [
    "zip_manifest — pack anything into a manifest and stash manifests for later.",
    "use: select anything with stagejockey → +1 \"zip-manifest\" to make a new manifest+json object from it;",
    "     select a manifest → +1 \"zip-store-manifest\" to save it in navi.storage (stagejockey-zip-manifest).",
    "needs: stagejockey",
].join("\n");

export const register = (navi) => {
    const scrollbufferPlugin = {
        id: "zip-manifest",
        name: "zip-manifest",
        claims: [
            {
                id: "zip",
                direction: 1,
                types: ["*"],
                color: "#00f0c8",
                describe: () => ({
                    text: "zip-manifest",
                    color: "#00f0c8",
                    textShadow: "0 1px 2px #003328, 0 0 2px #000, 0 0 1px #000",
                }),
                matches: (context) => !!context,
                execute: (context) => zipAsManifest(context),
            },
            {
                id: "zip-store-manifest",
                direction: 1,
                types: ["manifest"],
                color: "#2dff9a",
                describe: () => ({
                    text: "zip-store-manifest",
                    color: "#2dff9a",
                    textShadow: "0 1px 2px #003320, 0 0 2px #000, 0 0 1px #000",
                }),
                matches: (context) => hasType(context, "manifest"),
                async execute(context) {
                    const prev = await navi.storage.item.get(STORAGE_KEY);
                    const list = Array.isArray(prev) ? prev.slice() : [];
                    list.push(snapshot(context));
                    await navi.storage.item.set(STORAGE_KEY, list);
                    const msg = `[zip-manifest] appended → ${STORAGE_KEY} (${list.length})`;
                    if (typeof navi.callout === "function") navi.callout(msg);
                    else console.log(msg);
                    // Stay on a clean zip object (no DOM nesting bleed).
                    return zipAsManifest(context);
                },
            },
        ],
    };

    return {
        name: "zip_manifest",
        commands: {
            zip_manifest: { name: "zip_manifest", description: "help", execute: async () => HELP },
        },
        version: "0.2.6",
        description:
            "Scrollbuffer: any→clean manifest,json zip (+1); manifest→stagejockey-zip-manifest stash (+1)",
        moduleInfo: {
            name: "zip_manifest",
            version: "0.2.6",
            description:
                "Scrollbuffer: any→clean manifest,json zip (+1); does not inherit prior nesting/htmf",
        },
        STORAGE_KEY,
        scrollbufferPlugin,
    };
};
