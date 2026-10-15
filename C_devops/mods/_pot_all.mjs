/**
 * Publish C_devops/mods catalog entries as **hostpark short parks** + upsert
 * onto hypernetizen/warez. Default path does NOT pot to flowerpot.
 *
 * Usage:
 *   node C_devops/mods/_pot_all.mjs --yes --devnote "…"                  # foobarch.net (default)
 *   node C_devops/mods/_pot_all.mjs --yes --only scrollball --devnote "…"
 *   FOOBARCH_HOST=http://localhost:5353 node C_devops/mods/_pot_all.mjs --yes --only scrollball --devnote "…"
 *
 * Optional (legacy — commented default off):
 *   node C_devops/mods/_pot_all.mjs --flowerpot --devnote "…"   # pot subjects+sidecars on flowerpot
 *   node C_devops/mods/_pot_all.mjs --flowerpot --no-tip --devnote "…"
 *
 * about["commit-devnote"] is overwritten every publish (required). Prefer
 * --devnote or COMMIT_DEVNOTE. Agents must write a clear purpose sentence.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import {
  contentSha256,
  signAttestation,
  buildModuleManifest,
} from "../../hypernetizen/scheme/attestation_v1.mjs";
import {
  putSystems,
  loadOwner,
  BASE,
} from "../../hypernetizen/warez/_fp.mjs";
import {
  DEFAULT_HOST,
  DEFAULT_USAGE_PASSWORD,
  PROD_HOST,
  buildModParkFrame,
  buildPutEnvelope,
  getIdentity,
  loadOrCreateOwner,
  parkMethodBlock,
  saveJson,
  signHeadersForBody,
  takeUsageToken,
} from "../identity/_lib.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "../..");
const LEGACY = "hypercloud/testkit/mods/legacy";
const MAN_PREFIX = "hypercloud/testkit/mods";
function readCommitDevnote(argv = process.argv) {
  const idx = argv.indexOf("--devnote");
  const fromArg =
    idx >= 0 && argv[idx + 1] != null ? String(argv[idx + 1]).trim() : "";
  const fromEnv = String(process.env.COMMIT_DEVNOTE || "").trim();
  const note = fromArg || fromEnv;
  if (!note) {
    throw new Error(
      'commit-devnote required: pass --devnote "…" or COMMIT_DEVNOTE=… ' +
        "(overwrite every pot; one clear sentence of purpose — not description/notes copy)"
    );
  }
  if (note.length < 12) {
    throw new Error("commit-devnote too short — write a clear purpose sentence");
  }
  return note;
}

const fp = (route) =>
  String(route || "").startsWith("flowerpot/")
    ? String(route)
    : `flowerpot/${String(route || "").replace(/^\/+/, "")}`;

const bare = (route) =>
  String(route || "")
    .replace(/^flowerpot\//, "")
    .replace(/^\/+/, "");

/** Legacy subject route (no host) → flowerpot-prefixed ib for manifests. */
const sub = (rel) => fp(`${LEGACY}/${rel}`);

function underscoreName(name) {
  return String(name || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .replace(/_+/g, "_");
}

/**
 * Catalog: about.name is pot leaf + table name.
 * subjectRel = path under legacy/.
 * requires = flowerpot-prefixed subject ibs of deps.
 * warez: false = hostpark the park but never list it on hypernetizen/warez.
 */
const CATALOG = [
  {
    name: "keychain",
    subjectRel: "keychain.js",
    version: "1.5.0",
    description: "Ed25519 keychain for potter-protected overwrites.",
    requires: [],
    notes:
      "derive <label> = deterministic child key + parent-signed bind proof; signMessage/verify/verifyBind.",
  },
  {
    name: "netproposer",
    subjectRel: "netproposer.js",
    version: "0.4.2",
    description:
      "Commit bin-park network_proposals to hostparkinator_5000 (schema→policy write gates).",
    notes:
      "Callin: netproposer propose|tokens|policy|tip|host|keychain. Host preference defaults to navi.origin. Commits spend navi.tokens (refunded on refusal); keychain mount by park (mount keychain). Won't overwrite non-bin parks without --replace.",
    requires: [sub("keychain.js")],
  },
  {
    name: "potter",
    subjectRel: "potter.js",
    version: "1.8.3",
    description: "Flowerpot client / potting CLI.",
    requires: [sub("keychain.js")],
  },
  {
    name: "supermouse",
    subjectRel: "supermouse.js",
    version: "0.4.10",
    description:
      "Mouse+touch host: long-press→rightclick/up; still lift→righttap; preventleft toggle.",
    requires: [],
  },
  {
    name: "snoopy",
    subjectRel: "snoopy.js",
    version: "2.6.0",
    description:
      "SW observeFetch → tip+bin under navi:snoopy:<route>; texty bodies capped.",
    requires: [],
  },
  {
    name: "local_tools",
    subjectRel: "local_tools.js",
    version: "2.0.0",
    description:
      "Init script, tips, files, and item storage helpers for navi.storage.",
    requires: [],
    notes:
      "script → navi:init_script tip; tips → storage.tip; items → storage.item.list.",
  },
  {
    name: "scripter",
    subjectRel: "scripter.js",
    version: "1.0.1",
    description:
      "Fetch a text path, build a navi.script list, execute. Callin: scripter run <path>.",
    requires: [],
    notes:
      "Remainder after run is the path. GET text → snippets (blank line / # comments) → navi.script. Mount only where arbitrary code execution is acceptable.",
  },
  {
    name: "navi_eval",
    subjectRel: "navi_eval.js",
    version: "1.0.0",
    description:
      "Async JavaScript expression evaluator with navi_eval and eval callin aliases.",
    requires: [],
    notes:
      "Calls out success, then the resolved value. Mount only where arbitrary code execution is acceptable.",
  },
  {
    name: "notemaker",
    subjectRel: "notemaker.js",
    version: "1.3.4",
    description:
      "Passthru park + recordings; +1 notemaker claim (needs stagejockey) → offstage htmf.",
    requires: [],
    notes:
      "Default orb/border mid-grey #808080. Optional stagejockey +1 claim on data-part=note.",
  },
  {
    name: "overflow_default_scroll",
    subjectRel: "overflow_default_scroller.js",
    version: "1.0.4",
    description:
      "Enable/disable html overflow scrolling; body stays visible so fixed UI stays glued.",
    requires: [],
    notes: "Callin: overflow_default_scroll enable | disable.",
  },
  {
    name: "skelly",
    subjectRel: "skelly.js",
    version: "1.0.8",
    description:
      "Export/import navi tip+bin space (except root navi) via navi:skelly:export.",
    requires: [],
  },
  {
    name: "fetchgater",
    subjectRel: "fetchgater.js",
    version: "1.0.0",
    description: "PoC fetch allowlist gate.",
    requires: [],
  },
  {
    name: "pecklogger",
    subjectRel: "pecklogger.js",
    version: "1.2.3",
    description:
      "Viewport logger: tip lineages navi:pecklog:callouts|callins; visible vs cache; scrub modes.",
    requires: [],
    notes:
      "Panel on documentElement (not body) so body transform/overflow scroll leave it glued. Not surf.persist'd.",
  },
  {
    name: "stylishmod",
    subjectRel: "stylishmod.js",
    version: "0.5.1",
    description:
      "Page theme: bgcolor / bggradient / bgimage / text / scale % / page font; PWA colors; open web font provider (Fontsource, Bunny fallback).",
    requires: [],
    notes:
      "Callin spreads args. Prefs: stylishmod_prefs. navi.mod.stylishmod.fonts feeds jockey_stylish; stylishmod fonts on|off.",
  },
  {
    name: "tiny_ibgib_space",
    subjectRel: "tiny_ibgib_space.js",
    version: "1.2.2",
    description:
      "Local ibgib space on navi.storage.tip (loads tsgib vendor on init).",
    requires: [],
    notes:
      "Bare tip ibs; clearAll also wipes htmf/tiny-clone parts + legacy htmf:/jockey:htmf:.",
  },
  {
    name: "tinyviewport_manager",
    subjectRel: "tinyviewport_manager.js",
    version: "0.2.8",
    description:
      "Optional tinyviewport plugin host — nesting list prefs, connection sources, graph plugins.",
    requires: [],
    notes:
      "Foreign (other-ib) lineage nodes paint grey; flowchart may still override claimed tips.",
  },
  {
    name: "tinyviewport_tip_verbs",
    subjectRel: "tinyviewport_tip_verbs.js",
    version: "0.1.0",
    description:
      "Nesting companion — tip methods / commands under nested tip leaves.",
    requires: [sub("tinyviewport_manager.js")],
    notes:
      "contributeSidebar: method.* / http / relay.commands; fragment collects only when nesting is on.",
  },
  {
    name: "tinyviewport_flowchart",
    subjectRel: "tinyviewport_flowchart.js",
    version: "0.1.26",
    description:
      "Flow-model tinyviewport plugin — artifact typing, labels, journey edges, goals/ops flair.",
    requires: [sub("tinyviewport_manager.js")],
    notes:
      "Bands: cfg→boot→mods→flow→meta→ui…; config.skin_css + program layers.L3 + skin→ui/launch edges.",
  },
  {
    name: "tinyviewport_stagejockey_live",
    subjectRel: "tinyviewport_stagejockey_live.js",
    version: "0.1.1",
    description:
      "Tinyviewport plugin — expand supermouse_stagejockey_live into select/claim graph.",
    requires: [sub("tinyviewport_manager.js")],
    notes:
      "Not lineage n-squares: interaction → step(via) → types/claims/path. Disable lineage for this view.",
  },
  {
    name: "surf",
    subjectRel: "surf.js",
    version: "1.9.6",
    branch: "stage",
    description: "surf with stage compatibility: keepstage carries stage members across surfs.",
    requires: [],
    notes:
      "Stage branch of surf; the embedded branch (navi_shell surf 1.8.16) has no stage support. warez_updater check surf swaps it in. After a page lands, emits surf with that page path (settings and flags do not); embedded surf emits the same event. mount <route> installs from the host (park bypass); mount navi:<name> remounts the planted tip. surf -k / --no-k, surf -settings proscene|keepstage; data-unstage-on-leave members stay behind.",
  },
  {
    name: "warez_updater",
    subjectRel: "warez_updater.js",
    version: "0.2.4",
    description:
      "Check mounted mods against hypernetizen/warez hostpark index; remount outdated parks.",
    requires: [],
    notes:
      "Index + /{park}^{gib} eframes on foobarch_host; callin GET /{park} with X-Navi-Park-Bypass. Dropdown: warez_updater-check.",
  },
  {
    name: "stagedir",
    subjectRel: "horizon_stagedir.js",
    version: "3.8.0",
    description:
      "Live stage direction; march nested 3×3 cells (CS/R/U); data-hash on put.",
    requires: [],
    notes:
      "Park tip navi:stagedir; stagedir march <SLOT> <U|D|L|R|UL|UR|DL|DR> [n]; slots may be CS/R/U.",
  },
  {
    name: "meshyrelay_manager",
    subjectRel: "meshyrelay_manager.js",
    version: "0.1.23",
    description:
      "Mesh of navi relays — alias ping, profile telegraph, msgs, tip/bin xfer.",
    requires: [],
    notes:
      "Connect without host:- placeholder; auto-reconnect; viewport toasts.",
  },
  {
    name: "phonebook_client",
    subjectRel: "phonebook_client.js",
    version: "1.5.0",
    description: "Phonebook UI client (subscribe/ring/write).",
    requires: [sub("potter.js")],
  },
  // supermouse plugins — about.name without supermouse_plugin_ prefix (pot leaf).
  // navi.mod key remains supermouse_plugin_<name>.
  {
    name: "dropdown",
    subjectRel: "supermouse_plugin_dropdown.js",
    version: "0.5.3",
    description: "Supermouse dropdown UI — root ▸ menus or leaf action buttons.",
    requires: [sub("supermouse.js")],
    navi_name: "supermouse_plugin_dropdown",
  },
  {
    name: "no_dubclick",
    subjectRel: "supermouse_plugin_no_dubclick.js",
    version: "0.1.5",
    description:
      "Blocks double-click word select; Edge: no caret flash on non-writable clicks.",
    requires: [sub("supermouse.js")],
    navi_name: "supermouse_plugin_no_dubclick",
  },
  {
    name: "draggem_div",
    subjectRel: "supermouse_plugin_draggem_div.js",
    version: "0.3.2",
    description:
      "Draggem chrome; pointer-capture gestures; fit-to-content with slack; cooltoolbar minimize.",
    requires: [sub("supermouse.js")],
    navi_name: "supermouse_plugin_draggem_div",
    notes: "Dropdown root + plugins prefs menu; stage wraps via stage_draggem. Titlebar _ docks into cooltoolbar when that mod is mounted.",
  },
  {
    name: "stagejockey",
    subjectRel: "supermouse_plugin_stagejockey.js",
    version: "0.9.96",
    description:
      "Stage pick; middle on stage-member is opaque and drives claims only.",
    requires: [sub("supermouse.js"), sub("horizon_stagedir.js")],
    navi_name: "supermouse_plugin_stagejockey",
    notes:
      "stage-member add ▸ path:media (localpark → hostpark; replaces navi:media + hypermedia), upload:media, iframe.",
  },
  {
    name: "jockey_remove",
    subjectRel: "jockey-plugins/jockey-remove.js",
    version: "0.1.5",
    description: "Stagejockey remove claims (stage-member).",
    requires: [sub("supermouse_plugin_stagejockey.js")],
  },
  {
    name: "cursor_edit_client",
    subjectRel: "cursor_edit_client.js",
    version: "0.2.2",
    description:
      "Browser cursor_edit_v1 client — relay to native cursor_sdk, apply ops locally.",
    requires: [],
    notes:
      "Alias/origin/alias-token prefs tip navi:cursor_edit_client:prefs; token set with cursor_edit_client token <token>, sent as X-Navi-Shell-Usage-Token; registerOpHandler for new ops.",
    warez: false,
  },
  {
    name: "jockey_cursor",
    subjectRel: "jockey-plugins/jockey_cursor.js",
    version: "0.1.4",
    description:
      "Thin stagejockey +1 cursor-edit adapter → cursor_edit_client.",
    requires: [
      sub("supermouse_plugin_stagejockey.js"),
      sub("cursor_edit_client.js"),
    ],
    warez: false,
  },
  {
    name: "jockey_move",
    subjectRel: "jockey-plugins/jockey_move.js",
    version: "0.3.3",
    description:
      "3×3 claim + redselect drag; live adopt into stage-root columns; viewport grid.",
    requires: [sub("supermouse_plugin_stagejockey.js")],
  },
  {
    name: "ytplayer",
    subjectRel: "ytplayer.js",
    version: "0.3.0",
    description:
      "Old-school YouTube player controls for any [data-ytplayer] embed (play, seek, time, mute, volume, captions on/off, full screen).",
    requires: [],
    notes:
      "Delivered by testkit/youtube_search (mounts this park); each player's iframe onload mounts it when missing.",
    warez: false,
  },
  {
    name: "stage_casting",
    subjectRel: "jockey-plugins/stage_casting.js",
    version: "0.2.11",
    description: "Cast parts into offstage-member for jockey-move.",
    requires: [sub("supermouse_plugin_stagejockey.js")],
  },
  {
    name: "jockey_phone",
    subjectRel: "jockey-plugins/jockey-phone.js",
    version: "0.6.1",
    description: "Stagejockey phonebook scrollbuffer + ring-phonebook add.",
    requires: [
      sub("supermouse_plugin_stagejockey.js"),
      sub("phonebook_client.js"),
      sub("jockey-plugins/stage_casting.js"),
      sub("jockey-plugins/jockey_move.js"),
    ],
  },
  {
    name: "jockey_tiny",
    subjectRel: "jockey-plugins/jockey_tiny.js",
    version: "0.4.7",
    description:
      "Jockey: data-ibgib stamps; tip ib = data-path; parts htmf+tiny-clone.",
    requires: [
      sub("supermouse_plugin_stagejockey.js"),
      sub("tiny_ibgib_space.js"),
    ],
    notes:
      "See A_document/tiny.md. Bare tip ib; legacy htmf:/jockey:htmf: peeled.",
  },
  {
    name: "jockey_stylish",
    subjectRel: "jockey-plugins/jockey_stylish.js",
    version: "0.2.1",
    description:
      "Jockey +1 htm-element/word/phrase/char: CSS ribbon; text wraps then styles.",
    requires: [sub("supermouse_plugin_stagejockey.js")],
    notes:
      "Font section: searchable scrolling picker (web fonts via stylishmod if mounted). Layout Resize frame syncs W/H.",
  },
  {
    name: "image_resize",
    subjectRel: "jockey-plugins/image_resize.js",
    version: "0.1.9",
    description:
      "Jockey +1: resize stage images (png/jpeg/… / htm-img / htm-element).",
    requires: [sub("supermouse_plugin_stagejockey.js")],
  },
  {
    name: "jockey_netproposer",
    subjectRel: "jockey-plugins/jockey_netproposer.js",
    version: "0.9.4",
    description:
      "Jockey +1: hostpark (netproposer) or localpark text, images, htmf, or stage-members (confirm panel); post stage-members or the whole stage on a page (optionally only when arriving from a page).",
    requires: [sub("supermouse_plugin_stagejockey.js"), sub("netproposer.js")],
    notes:
      "No htm-element hostpark claim — htmf and stage-member instead. Hostparking an htmf stamps the panel path onto the outermost data-part htmf in the source. Panel takes the path from the element's own data-path (navi: dropped) or lets you type it, with the stagejockey prefix navi:pref:ix in front when set; shows host + token count, and greys out send when the host has no navi.tokens. Mount netproposer too.",
  },
  {
    name: "potter_gibbert",
    subjectRel: "jockey-plugins/potter_gibbert.js",
    version: "0.3.1",
    description:
      "Stagejockey gibbert: ib^gib_addr → host /_foobarch/frame.",
    requires: [sub("supermouse_plugin_stagejockey.js")],
  },
  {
    name: "snoopy_sniff",
    subjectRel: "jockey-plugins/snoopy_sniff.js",
    version: "0.3.4",
    description:
      "Jockey +1 sniff: path → snoopy tip (htm-element / href; no exclusive htmf).",
    requires: [
      sub("supermouse_plugin_stagejockey.js"),
      sub("snoopy.js"),
    ],
    notes: "htmf covered by htm-element-ness; types no longer list htmf.",
  },
  {
    name: "surf_persist",
    subjectRel: "jockey-plugins/surf_persist.js",
    version: "0.1.4",
    description:
      "Stagejockey surf persist/unpersist claims over htmf and draggemdiv.",
    requires: [sub("supermouse_plugin_stagejockey.js")],
    notes: "Also claims free-float x-draggem-div chrome (type draggemdiv).",
  },
  {
    name: "stage_draggem",
    subjectRel: "jockey-plugins/stage_draggem.js",
    version: "0.1.11",
    description:
      "Jockey: wrap pointed htmf / unwrap (nested stays under stage-member).",
    requires: [
      sub("supermouse_plugin_stagejockey.js"),
      sub("supermouse_plugin_draggem_div.js"),
    ],
    notes: "Needs stagejockey + supermouse_plugin_draggem_div mounted.",
  },
  {
    name: "relativespan",
    subjectRel: "jockey-plugins/relativespan.js",
    version: "0.1.13",
    description:
      "stage text / insert text / edit text on stage DOM; +1 relative-span xy; −1 unwrap.",
    requires: [
      sub("supermouse_plugin_stagejockey.js"),
      sub("supermouse_plugin_dropdown.js"),
      sub("horizon_stagedir.js"),
      sub("jockey-plugins/jockey_move.js"),
    ],
    notes:
      "+1 insert text on htm-element puts the compose input inside the claimed element.",
  },
  {
    name: "hxswapem",
    subjectRel: "jockey-plugins/hxswapem.js",
    version: "0.1.4",
    description:
      "Jockey +1 word/phrase: wrap selection in an htmx <a> that swaps itself on click.",
    requires: [sub("supermouse_plugin_stagejockey.js")],
    notes:
      "Brighter blue claim with black shadow; click hx-swaps the linked path response.",
  },
  {
    name: "parsehtm",
    subjectRel: "jockey-plugins/parsehtm.js",
    version: "0.1.1",
    description:
      "Jockey +1 parsehtm on word/phrase/text (plaintext markup→DOM); −1 unparsehtm on htm-element (element→text).",
    requires: [sub("supermouse_plugin_stagejockey.js")],
    notes:
      "Orange claim, no text-shadow. Parse splices innerHTML nodes; unparse replaces with outerHTML text node.",
  },
  {
    name: "tabletop_render",
    subjectRel: "jockey-plugins/tabletop_render.js",
    version: "0.2.3",
    description: "Stagejockey tabletop render claims.",
    requires: [sub("supermouse_plugin_stagejockey.js")],
  },
  {
    name: "zip_manifest",
    subjectRel: "jockey-plugins/zip-manifest.js",
    version: "0.2.6",
    description:
      "Stagejockey zip/manifest scrollbuffer claims (clean manifest+json; no nesting inherit).",
    requires: [sub("supermouse_plugin_stagejockey.js")],
  },
  {
    name: "link_dive",
    subjectRel: "link_dive.js",
    version: "0.1.2",
    description:
      "Viewport camera-dive toward clicked hyperlinks; snap-reset after full dive; prefs tip for scale/speed.",
    requires: [],
    notes:
      "Defaults durationMs=120 peakScale=3.44. Tip navi:link_dive:prefs. Callin: link_dive prefs …",
  },
  {
    name: "scrollball",
    subjectRel: "scrollball.js",
    version: "0.1.10",
    description:
      "Lower-center marble. Drag pans; double-tap place-mode (blue); hold 1.5s minimize (persists).",
    requires: [],
    notes:
      "Prefs tip navi:scrollball:prefs {hudX,hudY,minimized}. Start minimized if last left minimized.",
  },
  {
    name: "scranton_lobby",
    subjectRel: "scranton_lobby_v1_client.js",
    acknowledges: ["scranton/lobby/v1", "scranton/affordance/v1"],
    version: "1.14.6",
    description: "scranton_lobby_v1 — roster + append ib^gib index (hostpark), posts, affordances, trust, filter, gates, localpark",
    requires: [sub("keychain.js")],
    notes:
      "Callin: create|join|leave|kick|roster|enter|append list|push|update|delete|posts|script post|affordance list|add|rm|read|push|delete|trust|untrust|frens [add|rm|vouch|unvouch]|trusted|hide|unhide|show|hidden|park [sync|conflict|refresh|drop]|settings [set|wizard|reset]|tokens count. Navi-script posts POST the application/navi-script park (JS bin is one program); no extra interpreter mod. Settings: localpark kinds, host check timing, row capture, conflict pick, hook rerun; surfroster runs them as a wizard, affordances add steps via prefSteps. Localpark: scranton frames parked under the host ib^gib, read local-first with lazy host refresh; address rows captured as pending before the host write; host differences settle per affordance (parkConflict) or the both|host|local pick. Writes spend navi.tokens. Policy scranton/lobby/v1/policy. Alias sprinter: lobbies served by the sprinter relay mod, no tokens. Posts: append rows pointing at frames with data.post, valid when post.author = row signer. Affordances: descriptors at scranton/affordance/v1/<name> (post kinds, or address frames like comments/{page} gated by their own policy); plugins via registerAffordance or a mod's affordancePlugin(s). Trust: keys + identities whose signed <id>/frens list is trusted (hops 1-3 follow vouched identities); named editors may edit a frens list from the browser. Filter: hidden authors/kinds and trusted-only mode, local. Gates: post.gate.from / row from limit auto-apply to arrivals from that page.",
  },
  {
    name: "surfroster_stage_member",
    subjectRel: "surfroster_stage_member.js",
    acknowledges: ["scranton/affordance/v1/stage_member", "scranton/affordance/v1/stage_dir", "scranton/affordance/v1/stagedir"],
    version: "0.5.1",
    description: "scranton_lobby stage affordances: stage_member + stage_dir posts, stagedir/{page} directions",
    requires: [sub("scranton_lobby_v1_client.js"), sub("horizon_stagedir.js")],
    notes:
      "stage_member: place a posted member onto your stage. stage_dir: apply a posted whole stage (replaces it). stagedir/{page}: shared signed placement rows { member, slot, pos, from } (surfroster_stage_member direct … [--from <page>]). Trusted authors (scranton_lobby trust) apply on surf: their latest stage first, then placements; skips members already on stage or changed since posted.",
  },
  {
    name: "sprinter_server",
    subjectRel: "sprinter_server.js",
    version: "1.2.0",
    description: "we proudly bring you version S — fast relay lane for scranton_lobby_v1 lobbies and eoas element registers",
    requires: [],
    notes:
      "Runs on a relayed navi behind the hostpark park sprinter (relay path sprinter_server). GET/POST /sprinter/scranton/lobby/v1/{path}; checks proposal-write-v1 signatures and the lobby roster/append rules; state in navi storage (sprinter.lobbies). eoas: GET /sprinter/eoas/{hash} (raw html as text), /{hash}/state, /{hash}/{prop}, /{hash}/attrs/{name}; POST /sprinter/eoas {check:[…]} and /{hash}/check (stale = watched attr off the record beyond its deadzone); POST /{hash} signed register/update (first signer owns it, rev n+1), /{hash}/drop. Local: sprinter_server status|list|drop <path>|eoas list|show|drop <hash>.",
  },
  {
    name: "sprinter_client",
    subjectRel: "sprinter_client.js",
    version: "0.1.0",
    description: "sprinter eoas client: +1 sprinter-register on htm-element, interval capture by data-hash, keeps on-screen copies in step",
    requires: [sub("keychain.js")],
    notes:
      "Claim +1 sprinter-register (htm-element): asks which attributes matter and any deadzones (attr:number), stamps a data-hash if missing, and this navi's keychain key owns sprinter/eoas/{data-hash}; the owner pushes root attributes + outerHTML every interval when they changed. Every [data-hash] element on screen is checked once (batched) and gets the recorded values when sprinter says it's stale; registered elements are re-checked each interval (follow). Fires sprinter:update (element), sprinter:el-update (window), stage-dirty. Callin: sprinter_client eoas status|list|register|unregister|get|check|prefs [interval|scan|follow|ignore|reset].",
  },
  {
    name: "cooltoolbar",
    subjectRel: "cooltoolbar.js",
    version: "0.1.2",
    description:
      "Top bookmarks-style toolbar; docked chips persist on navi:cooltoolbar:frame and survive surf",
    requires: [],
    notes:
      "Pushes the page down ~30px. ☰ folds the bar to a ☰ stub (same as hide). cooltoolbar / cooltoolbar help prints hand-written help. Mods export cooltoolbarPlugin { id, mount?, renderItem?, expand? }. minimize(el) / dock / expand; -1 toolbar-minimize on stage, draggem, htmf. Draggem titlebar _ uses this when mounted. Callin: cooltoolbar show|hide|toggle|list|plugins.",
  },
  {
    name: "blinkincraft",
    subjectRel: "blinkincraft.js",
    version: "0.1.2",
    description: "Persistent top-right strip: surf path + plugin rows (blinkincraftPlugin)",
    requires: [],
    notes:
      "Lives on <html> so surfs keep it. Mods exporting blinkincraftPlugin { id, order?, mount(slot, api) → cleanup? } get a row while mounted; api.blink(el) flashes. Click ◆ to fold. Callin: blinkincraft show|hide|toggle|plugins.",
  },
  {
    name: "blinkincraft_sprinter_el",
    subjectRel: "blinkincraft_sprinter_el.js",
    version: "0.1.1",
    description: "blinkincraft row that flashes on each sprinter_client element update",
    requires: [sub("blinkincraft.js")],
    notes: "Listens for window sprinter:el-update; shows the update count, last element and the attributes that changed.",
  },
  {
    name: "token_distro_endpoint",
    subjectRel: "token_distro_endpoint.js",
    version: "0.5.3",
    description:
      "Mint + distribute foobarch usage tokens to approved keychain identities (distributor|approver|requester).",
    requires: [sub("keychain.js")],
    notes:
      "Distributor wraps relay callins to token_distro_endpoint/{ping,status,request,claim,admin}. Public front door: hostpark proxy token_distro. approve requires a signed memo; distributor keeps requester ip (never sent to the approver), signed request/approval, and per-claim 16-hex mint lead (audit [lead|pub]). approve/deny accept any unique id prefix (e.g. approve 4a1 memo…). Each approval is spent by exactly one claim of perClaim tokens; no user-facing quota.",
  },
  {
    name: "flip2welcome",
    subjectRel: "flip2welcome.js",
    version: "1.0.0",
    description:
      "Mobile/PWA only: upside-down flip surfs hypertext/welcome + welcome-back overlays.",
    requires: [],
    notes:
      "Fails mount on non-mobile. iOS needs a tap for DeviceMotion permission after mount.",
  },
];

/** Stable dependency order: required subjects before dependents. */
function topoCatalog(list) {
  const bySubject = new Map(
    list.map((d) => [sub(d.subjectRel), d])
  );
  const sorted = [];
  const seen = new Set();
  const stack = new Set();
  const visit = (d) => {
    const id = sub(d.subjectRel);
    if (seen.has(id)) return;
    if (stack.has(id)) throw new Error("catalog dependency cycle: " + id);
    stack.add(id);
    for (const r of d.requires || []) {
      const dep = bySubject.get(r);
      if (dep) visit(dep);
    }
    stack.delete(id);
    seen.add(id);
    sorted.push(d);
  };
  for (const d of list) visit(d);
  return sorted;
}

async function potLocalSubject(subjectRel) {
  // LEGACY flowerpot subject pot — only used under --flowerpot.
  const route = `${LEGACY}/${subjectRel}`;
  const local = path.join(ROOT, "B_testkit_mods", subjectRel);
  if (!fs.existsSync(local)) {
    throw new Error(`missing local subject: ${local}`);
  }
  const body = fs.readFileSync(local);
  const addr = await putSystems(route, body, "application/navi-module");
  console.log(`  subject pot ${route} → ${addr}`);
  return addr;
}

async function fetchSubject(subjectRel) {
  // LEGACY flowerpot subject GET — only used under --flowerpot.
  const route = `${LEGACY}/${subjectRel}`;
  const res = await fetch(`${BASE}/${route}`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (!res.ok) {
    throw new Error(
      `GET ${route} → ${res.status}: ${buf.toString("utf8").slice(0, 160)}`
    );
  }
  const addr = res.headers.get("x-flowerpot-ib^gib");
  if (!addr) throw new Error(`GET ${route} missing x-flowerpot-ib^gib`);
  const ct =
    res.headers.get("content-type") || "application/navi-module";
  return { route, addr, buf, ct: ct.split(";")[0].trim() };
}

async function ensureFetchgater() {
  // LEGACY — keep fetchgater on flowerpot only when --flowerpot is set.
  const route = `${LEGACY}/fetchgater.js`;
  const res = await fetch(`${BASE}/${route}`);
  await res.arrayBuffer();
  if (res.ok) return;
  const local = path.join(ROOT, "B_testkit_mods", "fetchgater.js");
  const body = fs.readFileSync(local);
  console.log("fetchgater missing live — potting legacy…");
  await putSystems(route, body, "application/navi-module");
}

function commitMethodForTip(frame) {
  const block = parkMethodBlock(frame);
  if (!block) return "PUT";
  for (const m of ["PATCH", "PUT"]) {
    const c = block[m];
    if (!c) return m;
    if (String(c.kind || "").toLowerCase() === "commit") return m;
  }
  return "PUT";
}

async function mintFoobarchToken(base, password) {
  return takeUsageToken(base, password);
}

async function getFoobarchTip(base, ib) {
  const res = await fetch(`${base}/foobarch/tip/${encodeURIComponent(ib)}`);
  if (res.status === 404) return null;
  const text = await res.text();
  if (!res.ok) throw new Error(`GET tip ${ib} → ${res.status}: ${text.slice(0, 200)}`);
  return JSON.parse(text);
}

/**
 * Hostpark short-park from local B_testkit_mods bytes, then upsert warez.
 * @returns {Promise<string|null>} tip ib^gib
 */
async function hostparkLocalMod(d, commitDevnote, ctx) {
  const { base, password, owner, policyAddr, identity } = ctx;
  const local = path.join(ROOT, "B_testkit_mods", d.subjectRel);
  if (!fs.existsSync(local)) {
    throw new Error(`missing local subject: ${local}`);
  }
  const bytes = fs.readFileSync(local);
  const parkIb = underscoreName(d.name);
  const target =
    d.navi_name != null && String(d.navi_name).trim()
      ? String(d.navi_name).trim()
      : parkIb;
  const warezSubject = `${LEGACY}/${d.subjectRel}`;

  const existing = await getFoobarchTip(base, parkIb);
  const parentAddr = existing && !existing.tombstone ? existing.addr : null;
  const n = parentAddr ? Number(existing.frame?.data?.n || 0) + 1 : 0;
  const about = {
    name: d.name,
    navi_name: target,
    version: d.version,
    description: d.description,
    requires: d.requires,
    warez_subject: warezSubject,
    "commit-devnote": commitDevnote,
  };
  if (d.notes) about.notes = d.notes;
  if (d.branch) about.branch = d.branch;
  if (d.acknowledges) about.acknowledges = d.acknowledges;

  const frame = buildModParkFrame(
    {
      ib: parkIb,
      target,
      command: target,
      about,
      gate: true,
    },
    bytes,
    { policyAddr, parentAddr, n }
  );
  const envelope = buildPutEnvelope(frame, bytes, "application/navi-module");
  const body = JSON.stringify(envelope);
  const token = await mintFoobarchToken(base, password);
  /** @type {Record<string, string>} */
  const headers = { "X-Foobarch-Usage-Token": token };
  if (parentAddr && existing.frame?.rel8ns?.policy?.[0]) {
    Object.assign(
      headers,
      signHeadersForBody(owner, { ib: parkIb, parentAddr, body })
    );
  }
  const method = existing ? commitMethodForTip(existing.frame) : "PUT";
  const res = await fetch(`${base}/${parkIb}`, {
    method,
    headers: { "Content-Type": "application/json", ...headers },
    body,
  });
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* ignore */
  }
  if (!res.ok) {
    throw new Error(`${method} /${parkIb} → ${res.status}: ${text.slice(0, 400)}`);
  }
  const addr = res.headers.get("x-foobarch-ib^gib") || json?.addr || null;
  console.log(
    `  ${parentAddr ? "mut8" : "firstGen"} ${parkIb} → ${addr} (target=${target}, ${bytes.length} bytes)`
  );

  // Local sidecar JSON for the catalog (not flowerpot-potted).
  const sha = contentSha256(bytes);
  const subject_ib = fp(warezSubject);
  const ownerKeys = loadOwner();
  const signed = signAttestation({
    privateKey: ownerKeys.owner.privateKey,
    publicKey: ownerKeys.owner.publicKey,
    subject_ib,
    subject_addr: addr || `${parkIb}^${sha.toUpperCase()}`,
    content_sha256: sha,
    content_type: "application/navi-module",
  });
  const manifest = buildModuleManifest({
    subject_ib,
    subject_addr: addr || `${parkIb}^${sha.toUpperCase()}`,
    content_sha256: sha,
    content_type: "application/navi-module",
    identity_ib: "hypernetizen",
    about: {
      name: d.name,
      version: d.version,
      description: d.description,
      requires: d.requires,
      developer: "C_devops/mods",
      notes:
        d.notes ||
        "Hostpark short park; subject bytes from B_testkit_mods.",
      "commit-devnote": commitDevnote,
      ...(d.navi_name ? { navi_name: d.navi_name } : {}),
      ...(d.acknowledges ? { acknowledges: d.acknowledges } : {}),
    },
    attestation: signed,
  });
  const localPath = path.join(__dirname, `${d.name}.json`);
  fs.writeFileSync(localPath, JSON.stringify(manifest, null, 2) + "\n");
  console.log(`  local → C_devops/mods/${d.name}.json`);

  if (addr && d.warez === false) {
    console.log("  warez: false — park only, not listed on hypernetizen/warez");
  } else if (addr) {
    const up = spawnSync(
      process.execPath,
      [path.join(ROOT, "hypernetizen", "warez", "_upsert.mjs"), addr],
      { cwd: ROOT, encoding: "utf8" }
    );
    if (up.stdout) process.stdout.write(up.stdout);
    if (up.stderr) process.stderr.write(up.stderr);
    if (up.status !== 0) {
      throw new Error(`warez upsert failed for ${addr} (exit ${up.status})`);
    }
  }
  return addr;
}

/**
 * about.version is what the warez table compares against the live module's
 * version, so it must equal the subject's own VERSION / version: "…".
 */
function sourceVersion(subjectRel) {
  const local = path.join(ROOT, "B_testkit_mods", subjectRel);
  if (!fs.existsSync(local)) return null;
  const text = fs.readFileSync(local, "utf8");
  return (
    (text.match(/const\s+VERSION\s*=\s*["']([^"']+)["']/) ||
      text.match(/\bversion:\s*["']([^"']+)["']/) ||
      [])[1] || null
  );
}

function assertCatalogMatchesSource(entries) {
  const bad = [];
  for (const d of entries) {
    const fv = sourceVersion(d.subjectRel);
    if (fv && fv !== d.version) bad.push(`${d.name}: catalog ${d.version} ≠ source ${fv}`);
  }
  if (bad.length) {
    throw new Error(
      "catalog version out of sync with source (warez table would never show 'mounted'):\n  " +
        bad.join("\n  ")
    );
  }
}

async function main() {
  const useFlowerpot = process.argv.includes("--flowerpot");
  const noTip = process.argv.includes("--no-tip");
  const yes = process.argv.includes("--yes");
  const commitDevnote = readCommitDevnote();
  const onlyIdx = process.argv.indexOf("--only");
  const only =
    onlyIdx >= 0 && process.argv[onlyIdx + 1]
      ? String(process.argv[onlyIdx + 1]).trim()
      : "";
  fs.mkdirSync(__dirname, { recursive: true });

  const catalog = only
    ? CATALOG.filter((d) => d.name === only || d.subjectRel === only)
    : topoCatalog(CATALOG);
  if (only && !catalog.length) {
    throw new Error(`--only ${only}: not in CATALOG`);
  }
  assertCatalogMatchesSource(catalog);

  // ── Default: hostpark short parks (no flowerpot) ─────────────────────
  if (!useFlowerpot) {
    if (!yes) {
      throw new Error(
        'refusing hostpark without --yes (or pass --flowerpot for legacy pots):\n' +
          '  node C_devops/mods/_pot_all.mjs --yes --only <name> --devnote "…"'
      );
    }
    const identity = getIdentity("foobarch");
    const base = (process.env.FOOBARCH_HOST || PROD_HOST).replace(/\/$/, "");
    const password = process.env.FOOBARCH_USAGE_PASSWORD || DEFAULT_USAGE_PASSWORD;
    const owner = loadOrCreateOwner(identity);
    const policyAddr = owner.policy_addr || null;
    const ctx = { base, password, owner, policyAddr, identity };
    console.log(`hostpark short parks → ${base}`);
    const addrs = [];
    for (const d of catalog) {
      console.log(`\n${d.name}`);
      const addr = await hostparkLocalMod(d, commitDevnote, ctx);
      if (addr) addrs.push(addr);
    }
    saveJson(identity.ownerPath, owner);
    console.log(`\ndone — ${addrs.length} short parks hostparked + warez upserted`);
    console.log(addrs.join("\n"));
    return;
  }

  // ── Legacy --flowerpot: pot subjects + sidecar manifests on flowerpot ─
  // (kept intact; not the default publish lane anymore)
  console.log("LEGACY --flowerpot: potting subjects + sidecars on flowerpot…");
  await ensureFetchgater();

  const owner = loadOwner();
  const manifestAddrs = [];

  for (const d of catalog) {
    await potLocalSubject(d.subjectRel);
    const { addr, buf, ct } = await fetchSubject(d.subjectRel);
    const subject_ib = fp(`${LEGACY}/${d.subjectRel}`);
    const sha = contentSha256(buf);
    const signed = signAttestation({
      privateKey: owner.owner.privateKey,
      publicKey: owner.owner.publicKey,
      subject_ib,
      subject_addr: addr,
      content_sha256: sha,
      content_type: ct,
    });
    const about = {
      name: d.name,
      version: d.version,
      description: d.description,
      requires: d.requires,
      developer: "C_devops/mods",
      notes:
        d.notes ||
        (d.navi_name
          ? `navi.mod key: ${d.navi_name}. Subject at legacy pot.`
          : "Subject bytes at hypercloud/testkit/mods/legacy/*."),
      // Always overwrite for this pot — never carry a stale note from disk.
      "commit-devnote": commitDevnote,
    };
    if (d.navi_name) about.navi_name = d.navi_name;
    if (d.branch) about.branch = d.branch;
    if (d.acknowledges) about.acknowledges = d.acknowledges;

    const manifest = buildModuleManifest({
      subject_ib,
      subject_addr: addr,
      content_sha256: sha,
      content_type: ct,
      identity_ib: "hypernetizen",
      about,
      attestation: signed,
    });
    const manBody = Buffer.from(JSON.stringify(manifest, null, 2) + "\n");
    const localPath = path.join(__dirname, `${d.name}.json`);
    fs.writeFileSync(localPath, manBody);
    const manIb = `${MAN_PREFIX}/${d.name}`;
    const manAddr = await putSystems(manIb, manBody, "application/json");
    manifestAddrs.push(manAddr);
    console.log(`  local → C_devops/mods/${d.name}.json`);
    console.log(`  subject ${subject_ib}`);
  }

  if (noTip) {
    console.log("\nskipped tip upsert (--no-tip)");
    console.log(manifestAddrs.join("\n"));
    return;
  }

  // Warez index is hostpark tip ib^gib (not flowerpot sidecars). After potting,
  // hostpark then upsert: FOOBARCH_HOST=… node C_devops/identity/_hostpark_warez_mod_parks.mjs --yes
  console.log("\nskipped hypernetizen/warez sidecar upsert");
  console.log(
    "  → hostpark mods to refresh warez: node C_devops/identity/_hostpark_warez_mod_parks.mjs --yes"
  );
  console.log(
    "  → or rebuild index: node hypernetizen/warez/_rebuild_hostpark_index.mjs --yes"
  );
  console.log(`\ndone — ${manifestAddrs.length} sidecar manifests potted (flowerpot)`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
