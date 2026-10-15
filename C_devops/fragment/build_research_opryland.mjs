import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { COMPANIES, EXCLUDED, RESEARCH_META } from "./research_opryland_data.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(__dirname, "research_opryland.html");

const esc = (s) =>
  String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

const badge = (type) => {
  const t = String(type || "").toLowerCase();
  if (t === "direct")
    return '<span style="background:#c6f6d5;color:#22543d;padding:0.1rem 0.35rem;border-radius:3px;font-size:0.72rem;">CONFIRMED</span>';
  if (t === "ecosystem")
    return '<span style="background:#faf089;color:#744210;padding:0.1rem 0.35rem;border-radius:3px;font-size:0.72rem;">ECOSYSTEM</span>';
  return '<span style="background:#bee3f8;color:#2a4365;padding:0.1rem 0.35rem;border-radius:3px;font-size:0.72rem;">PROSPECT</span>';
};

const priColor = (p) => {
  if (!p || p === "N/A") return "#718096";
  if (String(p).includes("VERY")) return "#9b2c2c";
  if (p === "HIGH") return "#c53030";
  if (p === "MEDIUM") return "#dd6b20";
  return "#718096";
};

const row = (c, alt) => {
  const link = c.url
    ? `<a href="${esc(c.url)}" rel="noopener">source</a>`
    : "—";
  const web = c.web
    ? `<a href="${esc(c.web)}" rel="noopener">${esc(c.web.replace(/^https?:\/\//, ""))}</a>`
    : "—";
  return `<tr style="${alt ? "background:#fafafa;" : ""}">
    <td style="padding:0.45rem 0.55rem;border:1px solid #e2e8f0;vertical-align:top;">${c.n}</td>
    <td style="padding:0.45rem 0.55rem;border:1px solid #e2e8f0;vertical-align:top;"><strong>${esc(c.co)}</strong>${c.addr ? `<br /><span style="color:#718096;font-size:0.82rem;">${esc(c.addr)}</span>` : ""}${c.phone ? `<br /><span style="color:#718096;font-size:0.82rem;">${esc(c.phone)}</span>` : ""}</td>
    <td style="padding:0.45rem 0.55rem;border:1px solid #e2e8f0;vertical-align:top;">${esc(c.cat)}<br /><em style="font-size:0.82rem;color:#4a5568;">${esc(c.sub)}</em></td>
    <td style="padding:0.45rem 0.55rem;border:1px solid #e2e8f0;vertical-align:top;font-size:0.85rem;">${esc(c.svc)}</td>
    <td style="padding:0.45rem 0.55rem;border:1px solid #e2e8f0;vertical-align:top;font-size:0.82rem;">${badge(c.type)} ${esc(c.ev)}<br />${link}</td>
    <td style="padding:0.45rem 0.55rem;border:1px solid #e2e8f0;vertical-align:top;">${esc(c.rel)}</td>
    <td style="padding:0.45rem 0.55rem;border:1px solid #e2e8f0;vertical-align:top;">${esc(c.emp || "—")}</td>
    <td style="padding:0.45rem 0.55rem;border:1px solid #e2e8f0;vertical-align:top;"><strong style="color:${priColor(c.pri)}">${esc(c.pri || "—")}</strong></td>
    <td style="padding:0.45rem 0.55rem;border:1px solid #e2e8f0;vertical-align:top;font-size:0.82rem;">${esc(c.sw)}</td>
    <td style="padding:0.45rem 0.55rem;border:1px solid #e2e8f0;vertical-align:top;">${web}</td>
  </tr>`;
};

const tableHead = `<thead><tr style="background:#edf2f7;text-align:left;font-size:0.82rem;">
<th style="padding:0.5rem;border:1px solid #cbd5e0;">#</th>
<th style="padding:0.5rem;border:1px solid #cbd5e0;">Company</th>
<th style="padding:0.5rem;border:1px solid #cbd5e0;">Category</th>
<th style="padding:0.5rem;border:1px solid #cbd5e0;">Service</th>
<th style="padding:0.5rem;border:1px solid #cbd5e0;">Evidence</th>
<th style="padding:0.5rem;border:1px solid #cbd5e0;">Relationship</th>
<th style="padding:0.5rem;border:1px solid #cbd5e0;">Employees</th>
<th style="padding:0.5rem;border:1px solid #cbd5e0;">Priority</th>
<th style="padding:0.5rem;border:1px solid #cbd5e0;">Software angle</th>
<th style="padding:0.5rem;border:1px solid #cbd5e0;">Website</th>
</tr></thead>`;

const smbProspects = COMPANIES.filter(
  (c) =>
    ["VERY HIGH", "HIGH"].includes(c.pri) &&
    !["Owner", "Operator", "Event anchor", "N/A"].includes(c.rel) &&
    !String(c.emp).includes("Enterprise") &&
    !String(c.emp).includes("1000+") &&
    !String(c.emp).includes("7000") &&
    !String(c.emp).includes("6000") &&
    !String(c.emp).includes("3000") &&
    !String(c.emp).includes("500+") &&
    c.co !== "NRMCA / ConcreteWorks (show)"
);

const html = `<div
  name="research_opryland"
  data-path="research/opryland"
  data-part="htmf"
  style="max-width:90rem;margin:0 auto;padding:1rem 1.25rem 2.5rem;font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;line-height:1.55;color:#1a1a1a;"
>
  <header style="border-bottom:2px solid #2c5282;padding-bottom:1rem;margin-bottom:1.5rem;">
    <p style="margin:0 0 0.35rem;font-size:0.85rem;letter-spacing:0.04em;text-transform:uppercase;color:#4a5568;">Prospecting intelligence · Nashville · ${esc(RESEARCH_META.pass)}</p>
    <h1 style="margin:0 0 0.5rem;font-size:1.85rem;line-height:1.2;color:#1a365d;">Gaylord Opryland — Vendor &amp; Software Prospect Database</h1>
    <p style="margin:0;font-size:1rem;color:#4a5568;"><strong>${RESEARCH_META.companyCount}</strong> evidence-backed entries (target ${esc(RESEARCH_META.target)}). Property: ${esc(RESEARCH_META.address)}. Sources: exhibitor manuals, permits, portfolios, press, case studies — not generic Nashville lists.</p>
  </header>

  <section style="margin-bottom:2rem;padding:1rem;background:#f0fff4;border:1px solid #9ae6b4;border-radius:6px;">
    <h2 style="margin:0 0 0.5rem;font-size:1.1rem;color:#276749;">Key findings from research</h2>
    <ul style="margin:0;padding-left:1.25rem;font-size:0.92rem;">
      <li><strong>Active $131M expansion</strong> — D.F. Chase (GC), Baker + SRM (concrete), Structural Evolution (CFS). Completion Q2 2027.</li>
      <li><strong>Permanent outsourced layers</strong> — Heart of the House (115 HK associates), Five Star Laundry (outsourced 2019), Encore (AV), Freeman/GES/Shepard/T3 (per-show).</li>
      <li><strong>Permit goldmine</strong> — Beech Construction alone has 15+ permits @ 28 Opryland Dr (TI, ICE, Cascades ceiling $1M).</li>
      <li><strong>Horticulture mostly in-house</strong> — ~40 staff; Grasshopper equipment supplier; 18–20 nurseries (names not all documented).</li>
      <li><strong>Security stack</strong> — Herring Technology integrator + Hanwha cameras + Milestone VMS (~$2.5M, ~1,500 cameras).</li>
      <li><strong>Convention = rotating GC ecosystem</strong> — each show appoints official contractor; EACs like Trade Show Tools / Nashville AV work beneath them.</li>
    </ul>
  </section>

  <section style="margin-bottom:2rem;">
    <h2 style="margin:0 0 0.75rem;font-size:1.35rem;color:#2c5282;">Top SMB software prospects (${smbProspects.length})</h2>
    <p style="margin:0 0 0.75rem;font-size:0.9rem;color:#4a5568;">Filtered: VERY HIGH/HIGH priority, likely 10–200 employees, not enterprise GCs/show anchors.</p>
    <ol style="margin:0;padding-left:1.25rem;columns:2;column-gap:2rem;font-size:0.9rem;">
      ${smbProspects.map((c) => `<li><strong>${esc(c.co)}</strong> — ${esc(c.sw)}</li>`).join("\n      ")}
    </ol>
  </section>

  <section style="margin-bottom:2rem;">
    <h2 style="margin:0 0 0.75rem;font-size:1.35rem;color:#2c5282;">Full database</h2>
    <div style="overflow-x:auto;">
      <table style="width:100%;border-collapse:collapse;font-size:0.88rem;">
        ${tableHead}
        <tbody>
          ${COMPANIES.map((c, i) => row(c, i % 2 === 1)).join("\n          ")}
        </tbody>
      </table>
    </div>
  </section>

  <section style="margin-bottom:2rem;">
    <h2 style="margin:0 0 0.75rem;font-size:1.35rem;color:#2c5282;">Excluded (no Opryland evidence)</h2>
    <ul style="margin:0;padding-left:1.25rem;font-size:0.9rem;">
      ${EXCLUDED.map((e) => `<li><strong>${esc(e.name)}</strong> — ${esc(e.reason)}</li>`).join("\n      ")}
    </ul>
  </section>

  <section style="margin-bottom:2rem;">
    <h2 style="margin:0 0 0.75rem;font-size:1.35rem;color:#2c5282;">Next research trails</h2>
    <ol style="margin:0;padding-left:1.25rem;columns:2;column-gap:2rem;font-size:0.88rem;">
      <li>Exhaust CheckPermit contractors @ 28/2800/2801 Opryland Dr</li>
      <li>Chase/Baker expansion sub-bid lists (MEP, drywall, fire)</li>
      <li>Verify Anthony Cox exterior maintenance employer</li>
      <li>More exhibitor kits (GES/Freeman/Shepard/T3/Fern @ Opryland)</li>
      <li>OSHA / TN contractor license searches tied to Opryland</li>
      <li>Marriott/Avendra supplier registrations</li>
      <li>ICE!/Christmas seasonal food &amp; temp labor vendors</li>
      <li>Nursery suppliers from Hollis Malone interviews</li>
    </ol>
  </section>

  <hr style="border:none;border-top:2px solid #2c5282;margin:2.5rem 0 2rem;" />

  <section style="margin-bottom:2rem;">
    <h2 style="margin:0 0 0.5rem;font-size:1.35rem;color:#2c5282;">Product bet — what to sell through this network</h2>
    <p style="margin:0 0 0.75rem;font-size:0.95rem;color:#4a5568;">Working conclusion from the research conversation: the easiest repeat sales are <strong>not</strong> into Marriott/Ryman. They are into the 25–150 person contractors and local show vendors who keep getting called back to Opryland. Same buyer type, short cycles, referral-friendly.</p>

    <h3 style="margin:1.25rem 0 0.5rem;font-size:1.1rem;color:#1a365d;">Ranked by sell often + sell easily</h3>
    <ol style="margin:0;padding-left:1.25rem;font-size:0.92rem;">
      <li style="margin-bottom:0.65rem;"><strong>Job / crew / punch-list software (construction TI + FF&amp;E)</strong> — Best fit. Beech, AZ Contracting, Tennessee Tile, Wolfe &amp; Travis, Sunrise, SUNDEK, Walker-type shops already do repeat campus work. They care about crew scheduling across rooms/floors, punch lists / room-ready, permit &amp; inspection status, receiving / install sequencing. Buyer is usually owner/PM, not IT. One win at Beech or AZ can refer across the Chase/Beech sub network. Highest volume + easiest close.</li>
      <li style="margin-bottom:0.65rem;"><strong>Field service + recurring work-order software (maintenance / specialty trades)</strong> — Second easiest. Exterior cleaning, laundry routes (Five Star), landscape material (TerraScape), pool decks (SUNDEK), seasonal tent installs. Pain is dispatch + recurring jobs, not “enterprise CMMS.” Sell FSM lite: schedule → complete → invoice. Fast demos, monthly SaaS, sticky once adopted.</li>
      <li style="margin-bottom:0.65rem;"><strong>Small-event labor / equipment ops tools (local EAC / indie AV)</strong> — Trade Show Tools, Nashville AV, Clarity, avad3, TLC floral. They compete under Encore/Freeman/GES and need labor call sheets, gear inventory / checkout, show-by-show CRM. Not another GSC portal — they already live in those. Sell the local operator stack. Very high intent, tiny companies, founder buys.</li>
      <li style="margin-bottom:0.65rem;"><strong>Workforce scheduling + QA for outsourced hotel labor</strong> — Heart of the House (115 associates on-site) and similar hospitality staffing. Scheduling, call-offs, QA scores. One big account, harder sell than #1–3, but huge annual contract value if you land it. Fewer deals, bigger checks.</li>
    </ol>

    <h3 style="margin:1.25rem 0 0.5rem;font-size:1.1rem;color:#1a365d;">What not to chase first</h3>
    <ul style="margin:0;padding-left:1.25rem;font-size:0.92rem;">
      <li><strong>Marriott/Gaylord IT</strong> (PMS, VMS, Boomer) — enterprise, incumbent, long procurement.</li>
      <li><strong>Milestone / Hanwha replacement</strong> — already deployed; Herring owns the relationship.</li>
      <li><strong>Freeman / GES / Encore “better portal”</strong> — they’re the platform; sell around them.</li>
      <li><strong>In-house horticulture ops</strong> — mostly staffed internally; few vendor seats.</li>
    </ul>

    <h3 style="margin:1.25rem 0 0.5rem;font-size:1.1rem;color:#1a365d;">Go-to-market shape</h3>
    <p style="margin:0 0 0.5rem;font-size:0.92rem;">Treat Opryland as a <strong>referral hub</strong>, not the customer:</p>
    <ol style="margin:0;padding-left:1.25rem;font-size:0.92rem;">
      <li>Beachhead: Beech + AZ + Tennessee Tile + Nashville AV / Trade Show Tools.</li>
      <li>Story: “You’re always on campus — here’s how crews/punch/inventory stop leaking between jobs.”</li>
      <li>Expand: other Chase/Beech subs, then other Music Valley / hotel campus vendors.</li>
      <li>Later: Heart of the House / Five Star for bigger workforce deals.</li>
    </ol>
    <p style="margin:0.75rem 0 0;font-size:0.92rem;">If you only build one product first: <strong>construction + specialty-trade field ops</strong> (jobs, crews, punch, photos, simple scheduling). That wedge covers the densest HIGH / VERY HIGH SMB cluster in this database.</p>
  </section>

  <section style="margin-bottom:2rem;">
    <h2 style="margin:0 0 0.5rem;font-size:1.35rem;color:#2c5282;">Three product bets defined</h2>
    <p style="margin:0 0 0.75rem;font-size:0.92rem;">When we say “TI punch vs EAC labor vs FSM,” these are the three concrete product bets:</p>
    <ol style="margin:0;padding-left:1.25rem;font-size:0.92rem;">
      <li style="margin-bottom:0.5rem;"><strong>TI punch</strong> — software for interior renovation crews tracking room punch lists and installs.</li>
      <li style="margin-bottom:0.5rem;"><strong>EAC labor</strong> — software for local show vendors scheduling booth labor and gear.</li>
      <li style="margin-bottom:0.5rem;"><strong>FSM</strong> — software for outdoor/service vendors dispatching recurring field jobs.</li>
    </ol>
  </section>

  <section style="margin-bottom:2rem;">
    <h2 style="margin:0 0 0.5rem;font-size:1.35rem;color:#2c5282;">Glossary (acronyms used here)</h2>
    <dl style="margin:0;font-size:0.9rem;">
      <dt style="margin-top:0.55rem;font-weight:700;">TI — Tenant Improvement</dt>
      <dd style="margin:0.15rem 0 0 1rem;color:#4a5568;">Interior build-outs and renovations inside an existing building (retail, restaurants, ballrooms). Not new construction from dirt.</dd>
      <dt style="margin-top:0.55rem;font-weight:700;">Punch / punch list</dt>
      <dd style="margin:0.15rem 0 0 1rem;color:#4a5568;">Leftover fix list at end of a job (paint, trim, fixtures). Tracked room-by-room until “room-ready.”</dd>
      <dt style="margin-top:0.55rem;font-weight:700;">EAC — Exhibitor Appointed Contractor</dt>
      <dd style="margin:0.15rem 0 0 1rem;color:#4a5568;">Company an exhibitor hires to set up their booth, instead of (or in addition to) the show’s official contractor. Local AV/labor/scenic shops often work as EACs.</dd>
      <dt style="margin-top:0.55rem;font-weight:700;">FSM — Field Service Management</dt>
      <dd style="margin:0.15rem 0 0 1rem;color:#4a5568;">Software for companies that send crews to job sites: schedule, dispatch, log work, invoice. Cleaning, laundry routes, landscape delivery, pool decks, exterior maintenance.</dd>
      <dt style="margin-top:0.55rem;font-weight:700;">GC — General Contractor</dt>
      <dd style="margin:0.15rem 0 0 1rem;color:#4a5568;">Main builder who holds the overall contract and hires subcontractors (Chase, Beech, Hardaway).</dd>
      <dt style="margin-top:0.55rem;font-weight:700;">Sub / subcontractor</dt>
      <dd style="margin:0.15rem 0 0 1rem;color:#4a5568;">Trade company hired by the GC (concrete, steel, tile, electrical, FF&amp;E).</dd>
      <dt style="margin-top:0.55rem;font-weight:700;">FF&amp;E — Furniture, Fixtures &amp; Equipment</dt>
      <dd style="margin:0.15rem 0 0 1rem;color:#4a5568;">Guest-room furniture, lamps, art, TVs, etc. AZ Contracting does this kind of install.</dd>
      <dt style="margin-top:0.55rem;font-weight:700;">GSC — General Service Contractor</dt>
      <dd style="margin:0.15rem 0 0 1rem;color:#4a5568;">Official show contractor appointed by a trade show for freight, booth labor, carpet, furniture (Freeman, GES, Shepard, T3, Fern, RPMXPO, Alliance).</dd>
      <dt style="margin-top:0.55rem;font-weight:700;">AV — Audio/Visual</dt>
      <dd style="margin:0.15rem 0 0 1rem;color:#4a5568;">Sound, screens, lighting, production (Encore in-house; Nashville AV / Clarity / avad3 as independents).</dd>
      <dt style="margin-top:0.55rem;font-weight:700;">WFM — Workforce Management</dt>
      <dd style="margin:0.15rem 0 0 1rem;color:#4a5568;">Scheduling people, call-offs, hours, quality — what Heart of the House needs for housekeeping associates.</dd>
      <dt style="margin-top:0.55rem;font-weight:700;">CMMS — Computerized Maintenance Management System</dt>
      <dd style="margin:0.15rem 0 0 1rem;color:#4a5568;">Heavier facility-maintenance software hotels use for building work orders. Different from lighter FSM sold to outside vendors.</dd>
      <dt style="margin-top:0.55rem;font-weight:700;">VMS — Video Management System</dt>
      <dd style="margin:0.15rem 0 0 1rem;color:#4a5568;">Software that runs security cameras (Milestone at Opryland).</dd>
      <dt style="margin-top:0.55rem;font-weight:700;">MEP — Mechanical, Electrical, Plumbing</dt>
      <dd style="margin:0.15rem 0 0 1rem;color:#4a5568;">Engineering disciplines for building systems (I.C. Thomasson).</dd>
      <dt style="margin-top:0.55rem;font-weight:700;">CFS — Cold-Formed Steel</dt>
      <dd style="margin:0.15rem 0 0 1rem;color:#4a5568;">Lightweight steel framing (Structural Evolution on the expansion).</dd>
      <dt style="margin-top:0.55rem;font-weight:700;">AESS — Architecturally Exposed Structural Steel</dt>
      <dd style="margin:0.15rem 0 0 1rem;color:#4a5568;">Steel meant to be seen, not covered (Wylie on the Delta atrium).</dd>
      <dt style="margin-top:0.55rem;font-weight:700;">ACV — Annual Contract Value</dt>
      <dd style="margin:0.15rem 0 0 1rem;color:#4a5568;">How much a customer pays per year. Bigger ACV usually means longer, harder sales.</dd>
      <dt style="margin-top:0.55rem;font-weight:700;">SMB — Small/Medium Business</dt>
      <dd style="margin:0.15rem 0 0 1rem;color:#4a5568;">Roughly 10–200 employee companies — easier to sell than Marriott or Freeman.</dd>
      <dt style="margin-top:0.55rem;font-weight:700;">Boomer / GOIT</dt>
      <dd style="margin:0.15rem 0 0 1rem;color:#4a5568;">Hotel exhibitor ordering portal (Boomer Commerce) and Gaylord Opryland IT. In-house electrical/internet for shows — not your primary buyer.</dd>
    </dl>
  </section>

  <section style="margin-bottom:2rem;padding:1rem;background:#ebf8ff;border:1px solid #90cdf4;border-radius:6px;">
    <h2 style="margin:0 0 0.5rem;font-size:1.35rem;color:#2c5282;">Path to finalize the product bet</h2>
    <p style="margin:0 0 0.75rem;font-size:0.92rem;">Do not pick the product in a vacuum. Validate against real buyers in this network, then lock the wedge.</p>
    <ol style="margin:0;padding-left:1.25rem;font-size:0.92rem;">
      <li style="margin-bottom:0.55rem;"><strong>Pick a 15-account outreach list</strong> — 8 TI/punch construction shops (Beech, AZ, Tennessee Tile, Wolfe &amp; Travis, Sunrise, SUNDEK, Shaub, Southland), 4 EAC/AV/labor (Trade Show Tools, Nashville AV, Clarity, avad3), 3 FSM candidates (TerraScape, Five Star Laundry, exterior maintenance once employer verified).</li>
      <li style="margin-bottom:0.55rem;"><strong>Run 10 short discovery calls</strong> — same script for all three bets: what tools do you use today (Excel, texts, Jobber, Buildertrend, nothing)? Where do jobs leak (missed punch, no-show labor, botched dispatch)? Who buys software (owner vs PM)? Budget range and last tool they paid for?</li>
      <li style="margin-bottom:0.55rem;"><strong>Score each bet on four axes</strong> — (a) how often the pain shows up in calls, (b) how fast a founder/owner can say yes, (c) how many similar companies sit in the Opryland referral graph, (d) how thin a first product can be and still be useful.</li>
      <li style="margin-bottom:0.55rem;"><strong>Choose one primary wedge</strong> — default bias from research: TI punch / construction field ops, unless discovery shows EAC labor or FSM pain is louder and more urgent.</li>
      <li style="margin-bottom:0.55rem;"><strong>Write a one-page product thesis</strong> — who buys, first 5 features, first 5 design partners, price band, what you will not build in v1.</li>
      <li style="margin-bottom:0.55rem;"><strong>Close 2–3 design partners</strong> from the beachhead list before writing serious code. Prefer companies already on campus repeatedly.</li>
      <li style="margin-bottom:0.55rem;"><strong>Ship a narrow pilot</strong> — one workflow only (e.g. punch + photo + room-ready, or labor call sheet + checkout). Measure weekly usage for 4–6 weeks.</li>
      <li style="margin-bottom:0.55rem;"><strong>Decide expand / pivot</strong> — if pilots use it without hand-holding, expand features and chase Chase/Beech referrals. If not, use call notes to pivot to the next-ranked bet without rebuilding the whole company list.</li>
    </ol>
    <p style="margin:0.85rem 0 0;font-size:0.9rem;color:#2c5282;"><strong>Decision gate:</strong> product bet is “final” when you have (1) a written thesis, (2) ≥2 design partners verbally committed, and (3) a 4–6 week pilot plan — not when the spreadsheet feels complete.</p>
  </section>

  <footer style="border-top:1px solid #e2e8f0;padding-top:1rem;font-size:0.85rem;color:#718096;">
    <p style="margin:0;">HTMF: <code>research/opryland</code> · Flowerpot: <code>flowerpot/research/opryland</code> · Rebuild: <code>node C_devops/fragment/build_research_opryland.mjs</code></p>
  </footer>
</div>
`;

fs.writeFileSync(OUT, html);
console.log(`Wrote ${OUT} (${COMPANIES.length} companies)`);
