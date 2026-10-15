/**
 * scripter — fetch a path, turn the text into navi.script snippets, run them.
 *
 *   scripter run torus/testkit/myscript
 *
 * File format: JS snippets separated by blank lines. Consecutive non-empty
 * lines are one snippet. Lines whose trim starts with # are ignored.
 */

export const register = (navi) => {
  const NAME = "scripter";
  const VERSION = "1.0.1";

  const help = () =>
    [
      "scripter — fetch text, run as navi.script",
      "",
      "Usage:",
      "  scripter run <path>",
      "",
      "Remainder after run is the path. Fetch that; build snippets; navi.script.",
      "Blank line separates snippets; # lines are comments.",
    ].join("\n");

  const textToScript = (text) => {
    const raw = String(text ?? "")
      .replace(/^\uFEFF/, "")
      .replace(/\r\n/g, "\n");
    if (!String(text ?? "").trim()) {
      throw new Error("scripter: empty text (expected multiline JS snippets)");
    }
    const chunks = [];
    let cur = [];
    const flush = () => {
      const snippet = cur.join("\n").trim();
      cur = [];
      if (snippet) chunks.push(snippet);
    };
    for (const line of raw.split("\n")) {
      const t = line.trim();
      if (!t || t.startsWith("#")) {
        if (!t) flush();
        continue;
      }
      cur.push(line.replace(/\s+$/, ""));
    }
    flush();
    if (!chunks.length) {
      throw new Error("scripter: no script lines after stripping blanks/# comments");
    }
    return chunks;
  };

  const run = async (...args) => {
    const path = args.join(" ").trim();
    if (!path) return help();
    if (typeof navi.script !== "function") {
      throw new Error("scripter: navi.script is not available");
    }
    if (typeof fetch !== "function" || typeof navi.resolveUrl !== "function") {
      throw new Error("scripter: fetch is unavailable");
    }
    const url = encodeURI(navi.resolveUrl(path));
    const res = await fetch(url, {
      method: "GET",
      headers: { Accept: "text/plain, text/javascript, */*" },
    });
    if (!res.ok) {
      throw new Error(
        "scripter: HTTP " + res.status + " " + res.statusText + " for " + path
      );
    }
    const lines = textToScript(await res.text());
    navi.callout("[scripter] " + path + " → " + lines.length + " snippet(s)");
    await navi.script(lines);
    return "[scripter] ran " + lines.length + " snippet(s) from " + path;
  };

  const execute = async (sub, ...rest) => {
    if (!sub || sub === "help") return help();
    if (sub === "run") return await run(...rest);
    return "scripter: unknown subcommand '" + sub + "'\n" + help();
  };

  return {
    name: NAME,
    version: VERSION,
    description: "Fetch a text path and execute it with navi.script.",
    moduleInfo: {
      name: NAME,
      version: VERSION,
      description: "Fetch a text path and execute it with navi.script.",
    },
    run,
    textToScript,
    commands: {
      scripter: {
        name: "scripter",
        description: "scripter run <path>",
        execute,
      },
      run: {
        name: "run",
        description: "run <path>  (scripter)",
        execute: run,
      },
    },
  };
};
