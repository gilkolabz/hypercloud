/**
 * gmaps_scraper — proxy to a local google-maps-scraper web API (default :8080).
 *
 * Intended for navi_shell: native fetch has no CORS, so HTMF/callin can talk
 * to http://localhost:8080 while the page origin is flowerpot/surf.
 *
 * Callin:
 *   gmaps_scraper base [url]           show / set API base
 *   gmaps_scraper jobs                 GET /api/v1/jobs
 *   gmaps_scraper job <id>             GET /api/v1/jobs/{id}
 *   gmaps_scraper create <json>        POST /api/v1/jobs
 *   gmaps_scraper delete <id>          DELETE /api/v1/jobs/{id}
 *   gmaps_scraper download <id>        GET /api/v1/jobs/{id}/download (CSV text)
 *   gmaps_scraper help
 *
 * Programmatic (HTMF):
 *   await navi.mod.gmaps_scraper.listJobs()
 *   await navi.mod.gmaps_scraper.createJob({ name, keywords, … })
 *   await navi.mod.gmaps_scraper.deleteJob(id)
 *   await navi.mod.gmaps_scraper.downloadCsv(id)
 *   await navi.mod.gmaps_scraper.request(method, path, body?)
 */

export const register = (navi) => {
  const NAME = "gmaps_scraper";
  const VERSION = "0.1.1";
  const DESCRIPTION =
    "Proxy google-maps-scraper localhost API for HTMF / callin (no CORS).";

  const DEFAULT_BASE = "http://localhost:8080";
  const STORAGE_BASE = "gmaps_scraper.base_url";

  class GmapsScraperProxy {
    constructor() {
      this.baseUrl = DEFAULT_BASE;
    }

    log(...args) {
      console.log("[gmaps_scraper]", ...args);
    }

    async loadBase() {
      try {
        const stored = await navi?.storage?.item?.get?.(STORAGE_BASE);
        if (stored != null && String(stored).trim()) {
          this.baseUrl = String(stored).trim().replace(/\/+$/, "");
        }
      } catch {
        /* keep default */
      }
      return this.baseUrl;
    }

    async setBase(url) {
      const next = String(url || "")
        .trim()
        .replace(/\/+$/, "");
      if (!next) throw new Error("base url required");
      if (!/^https?:\/\//i.test(next)) {
        throw new Error("base url must start with http:// or https://");
      }
      this.baseUrl = next;
      try {
        await navi?.storage?.item?.set?.(STORAGE_BASE, next);
      } catch {
        /* ok */
      }
      return this.baseUrl;
    }

    /**
     * @param {string} method
     * @param {string} path  e.g. /api/v1/jobs
     * @param {unknown} [body]
     * @param {{ raw?: boolean }} [opts]
     */
    async request(method, path, body, opts = {}) {
      await this.loadBase();
      const p = String(path || "").startsWith("/")
        ? String(path)
        : "/" + String(path || "");
      const url = this.baseUrl + p;
      const headers = {};
      let payload = undefined;
      if (body !== undefined && body !== null) {
        headers["Content-Type"] = "application/json";
        payload = typeof body === "string" ? body : JSON.stringify(body);
      }
      let res;
      try {
        res = await globalThis.fetch(url, {
          method: String(method || "GET").toUpperCase(),
          headers,
          body: payload,
        });
      } catch (e) {
        const msg = String(e && e.message ? e.message : e);
        throw new Error(
          `gmaps_scraper fetch failed (${url}): ${msg}. ` +
            "Use navi_shell (native fetch) with the scraper listening, " +
            "or set base: gmaps_scraper base http://localhost:8080"
        );
      }
      const text = await res.text();
      if (opts.raw) {
        if (!res.ok) {
          throw new Error(`HTTP ${res.status} ${url}: ${text.slice(0, 240)}`);
        }
        return text;
      }
      let data = null;
      if (text) {
        try {
          data = JSON.parse(text);
        } catch {
          data = text;
        }
      }
      if (!res.ok) {
        const detail =
          data && typeof data === "object" && data.message
            ? data.message
            : typeof data === "string"
              ? data.slice(0, 240)
              : text.slice(0, 240);
        throw new Error(`HTTP ${res.status}: ${detail}`);
      }
      return data;
    }

    listJobs() {
      return this.request("GET", "/api/v1/jobs");
    }

    getJob(id) {
      const jobId = String(id || "").trim();
      if (!jobId) throw new Error("job id required");
      return this.request("GET", "/api/v1/jobs/" + encodeURIComponent(jobId));
    }

    createJob(payload) {
      if (!payload || typeof payload !== "object") {
        throw new Error("create payload object required");
      }
      return this.request("POST", "/api/v1/jobs", payload);
    }

    deleteJob(id) {
      const jobId = String(id || "").trim();
      if (!jobId) throw new Error("job id required");
      return this.request(
        "DELETE",
        "/api/v1/jobs/" + encodeURIComponent(jobId)
      );
    }

    downloadCsv(id) {
      const jobId = String(id || "").trim();
      if (!jobId) throw new Error("job id required");
      return this.request(
        "GET",
        "/api/v1/jobs/" + encodeURIComponent(jobId) + "/download",
        null,
        { raw: true }
      );
    }
  }

  const proxy = new GmapsScraperProxy();

  const tokenize = (rawArgs) => {
    if (rawArgs.length === 1 && typeof rawArgs[0] === "string") {
      return String(rawArgs[0])
        .trim()
        .split(/\s+/)
        .filter(Boolean);
    }
    return rawArgs.map((a) => String(a)).filter((a) => a.length);
  };

  const helpText = () =>
    [
      "gmaps_scraper — localhost google-maps-scraper API proxy",
      "  base [url]        show / set API base (default http://localhost:8080)",
      "  jobs              list jobs",
      "  job <id>          get one job",
      "  create <json>     POST new job (JSON object)",
      "  delete <id>       delete job",
      "  download <id>     download CSV text",
      "  help",
    ].join("\n");

  const run = async (...rawArgs) => {
    const args = tokenize(rawArgs);
    const cmd = (args[0] || "help").toLowerCase();
    if (cmd === "help" || cmd === "-h" || cmd === "--help") return helpText();
    if (cmd === "base") {
      if (args[1]) return await proxy.setBase(args.slice(1).join(" "));
      await proxy.loadBase();
      return proxy.baseUrl;
    }
    if (cmd === "jobs") {
      const jobs = await proxy.listJobs();
      return typeof jobs === "string" ? jobs : JSON.stringify(jobs, null, 2);
    }
    if (cmd === "job") {
      const job = await proxy.getJob(args[1]);
      return typeof job === "string" ? job : JSON.stringify(job, null, 2);
    }
    if (cmd === "create") {
      let raw = args.slice(1).join(" ").trim();
      if (!raw) {
        const body = navi?.callinRequest?.body;
        if (body != null && String(body).trim()) raw = String(body).trim();
      }
      if (!raw) throw new Error("create requires JSON payload (args or POST body)");
      const payload = JSON.parse(raw);
      const out = await proxy.createJob(payload);
      return typeof out === "string" ? out : JSON.stringify(out, null, 2);
    }
    if (cmd === "delete") {
      await proxy.deleteJob(args[1]);
      return "deleted " + args[1];
    }
    if (cmd === "download") {
      return await proxy.downloadCsv(args[1]);
    }
    throw new Error("unknown subcommand: " + cmd + "\n" + helpText());
  };

  return {
    name: NAME,
    version: VERSION,
    description: DESCRIPTION,
    moduleInfo: { name: NAME, version: VERSION, description: DESCRIPTION },
    gmaps_scraper: proxy,
    request: (...a) => proxy.request(...a),
    listJobs: (...a) => proxy.listJobs(...a),
    getJob: (...a) => proxy.getJob(...a),
    createJob: (...a) => proxy.createJob(...a),
    deleteJob: (...a) => proxy.deleteJob(...a),
    downloadCsv: (...a) => proxy.downloadCsv(...a),
    getBase: () => proxy.loadBase(),
    setBase: (...a) => proxy.setBase(...a),
    commands: {
      gmaps_scraper: {
        name: NAME,
        description:
          "gmaps_scraper base|jobs|job|create|delete|download — localhost Maps scraper API proxy",
        execute: async (...args) => run(...args),
      },
    },
    onMount: async () => {
      await proxy.loadBase();
      console.log(`[gmaps_scraper] ready v${VERSION} — base ${proxy.baseUrl}`);
    },
    onUnmount: () => {
      console.log("[gmaps_scraper] unmounted");
    },
  };
};
