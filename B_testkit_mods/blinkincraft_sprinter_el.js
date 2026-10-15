/**
 * blinkincraft_sprinter_el — blinkincraft row that flashes whenever sprinter_client
 * brings an element up to date (window event `sprinter:el-update`).
 *
 * Row:  ● sprinter-el 3  <div> 9f2c41aa… data-yt-t
 *       count of updates this session, then the last element and the attributes that changed.
 */

const HELP = [
    "blinkincraft_sprinter_el — a blinkincraft row that flashes on each sprinter element update.",
    "needs: blinkincraft (shows the row), sprinter_client (sends the updates)",
].join("\n");

export const register = (navi) => {
    const NAME = "blinkincraft_sprinter_el";
    const VERSION = "0.1.1";
    const IDLE = "#999";
    const LIT = "#1fbf3a";

    const blinkincraftPlugin = {
        id: "sprinter-el",
        order: 20,
        mount(slot, api) {
            slot.innerHTML =
                '<span data-se-dot style="color:' + IDLE + '">●</span> ' +
                '<span data-bc-label style="margin-right:4px">sprinter-el</span>' +
                '<span data-se-n>0</span> <span data-se-last style="opacity:.75"></span>';
            const dot = slot.querySelector("[data-se-dot]");
            const nEl = slot.querySelector("[data-se-n]");
            const lastEl = slot.querySelector("[data-se-last]");
            let n = 0;
            let fade = null;
            const onUpdate = (e) => {
                const d = e?.detail || {};
                n++;
                nEl.textContent = String(n);
                const hash = String(d.hash || "");
                lastEl.textContent = `<${d.tag || "?"}> ${hash.slice(0, 8)}${hash.length > 8 ? "…" : ""} ${(d.changed || []).join(",")}`;
                slot.title = `${hash} rev ${d.rev ?? "?"}: ${(d.changed || []).join(", ")}`;
                dot.style.color = LIT;
                api.blink(dot);
                api.blink(nEl);
                clearTimeout(fade);
                fade = setTimeout(() => (dot.style.color = IDLE), 1500);
            };
            window.addEventListener("sprinter:el-update", onUpdate);
            return () => {
                clearTimeout(fade);
                window.removeEventListener("sprinter:el-update", onUpdate);
            };
        },
    };

    return {
        name: NAME,
        version: VERSION,
        description: "blinkincraft row: flashes on sprinter_client element updates",
        moduleInfo: {
            name: NAME,
            version: VERSION,
            description: "blinkincraft plugin — sprinter-el update blinker",
        },
        commands: {
            [NAME]: { name: NAME, description: "help", execute: async () => HELP },
        },
        blinkincraftPlugin,
    };
};
