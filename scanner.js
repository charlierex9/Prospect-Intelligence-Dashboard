/**
 * ============================================================
 *  PROSPECT — INTELLIGENCE SCANNER (dashboard edition)
 *  Aligned to JPMorgan Security & Resiliency Initiative verticals.
 *  Writes an encrypted data.json. No email. Manual trigger.
 * ============================================================
 */
const fs = require("fs");

const CONFIG = {
  ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY || "",
  DATA_PASSPHRASE:   process.env.DATA_PASSPHRASE   || "",
  THRESHOLD_M: 10,
  MODEL:       "claude-sonnet-4-5-20250929",
};

// SRI verticals (canonical sector strings — must match the dashboard)
const SECTORS = [
  "Supply Chain & Manufacturing",
  "Defense & Aerospace",
  "Energy & Resilience",
  "Frontier Technologies",
  "Pharma & HealthTech",
];

// ─── OBFUSCATION (matches the dashboard) ─────────────────────
function obfuscate(text, key){
  const tb=Buffer.from(text,"utf8"),kb=Buffer.from(key,"utf8"),out=Buffer.alloc(tb.length);
  for(let i=0;i<tb.length;i++)out[i]=tb[i]^kb[i%kb.length];
  return out.toString("base64");
}
function deobfuscate(b64, key){
  const bin=Buffer.from(b64,"base64"),kb=Buffer.from(key,"utf8"),out=Buffer.alloc(bin.length);
  for(let i=0;i<bin.length;i++)out[i]=bin[i]^kb[i%kb.length];
  return out.toString("utf8");
}

// ─── STAGE 1: scout (two passes, 10 searches total) ──────────
function buildScoutPrompt(searches, label){
  const today = new Date().toLocaleDateString("en-GB",{weekday:"long",year:"numeric",month:"long",day:"numeric"});
  return `You are a private banking intelligence analyst for JPMorgan's Security & Resiliency Initiative. Today is ${today}.

This is search pass: ${label}.

Find UK-based founders, entrepreneurs and significant shareholders likely to receive — or who recently received — £${CONFIG.THRESHOLD_M}m+ personally. Use the SRI verticals: Supply Chain & Advanced Manufacturing (critical minerals, robotics, shipbuilding, nanomaterials); Defense & Aerospace (defence tech, autonomous systems, drones, secure comms, space, munitions, hypersonics); Energy Independence & Resilience (battery storage, grid, nuclear, distributed energy); Frontier & Strategic Technologies (AI, cybersecurity, quantum, semiconductors, data centres); Pharma & HealthTech.

Government customer test: include any company selling to UK Government, MoD, GCHQ, UKIC, NATO, Five Eyes, NHS, or critical national infrastructure.

SIGNALS TO CAPTURE (all are valuable):
- Capital raises / equity financings (Series A–D, growth rounds) — founders often take secondary
- New government / defence contract awards (MoD, DASA, Innovate UK, framework wins) — pre-fundraise signal
- M&A, trade sales, founder exits
- PE buyouts, recapitalisations, MBOs
- IPOs and AIM admissions; director share disposals (RNS/PDMR)
- Companies House signals: SH01 share allotments, PSC changes, capital reductions

PRIORITISE HIGH-SIGNAL SOURCES: Companies House filings, Contracts Finder / MoD contract awards, London Stock Exchange RNS, and named trade press (Sifted, Tech.eu, Jane's, The Engineer, UK Defence Journal). Filings and contract wins are the earliest signals — weight them heavily.

Run these ${searches.length} searches IN ORDER. After EACH search, write a detailed paragraph naming every company and individual found, with role, what happened, when, estimated deal/raise size, and estimated personal liquidity (stake % × size). Be specific with names.

${searches.map((s,i)=>`Search ${i+1}: ${s}`).join("\n")}

Return PROSE only (not JSON). Include EVERY credible name.`;
}

async function callAnthropic(messages, useSearch, maxTokens){
  const body = { model: CONFIG.MODEL, max_tokens: maxTokens, messages };
  if (useSearch) body.tools = [{ type:"web_search_20250305", name:"web_search" }];
  const res = await fetch("https://api.anthropic.com/v1/messages",{
    method:"POST",
    headers:{ "Content-Type":"application/json","x-api-key":CONFIG.ANTHROPIC_API_KEY,"anthropic-version":"2023-06-01" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Anthropic API error ${res.status}: ${await res.text()}`);
  const data = await res.json();
  console.log("Response blocks:", data.content.map(b=>b.type).join(", "));
  return data.content.map(b=>{
    if (b.type==="text") return b.text;
    if (b.type==="tool_result"){ const inner=Array.isArray(b.content)?b.content:[]; return inner.filter(c=>c.type==="text").map(c=>c.text).join("\n"); }
    return "";
  }).filter(Boolean).join("\n\n");
}

// ─── STAGE 2: formatter (dashboard JSON) ─────────────────────
function buildFormatterPrompt(raw, today){
  return `Convert the intelligence findings below into a JSON object for a dashboard. Return ONLY valid JSON — no markdown, no preamble.

RULES:
- One entry per company/individual. Never merge. Include every finding.
- Keep text fields short (under 22 words).
- "sector" MUST be exactly one of: ${SECTORS.map(s=>`"${s}"`).join(", ")}.
- "horizon": "week" (last 7 days), "month" (last 30 days), or "year" (last 12 months).
- "priority": "urgent"/"active"/"emerging" for week/month; "missed" for year items.
- "confidence": "High" if deal size/stake confirmed by a named filing or press report; "Medium" if estimated from funding stage/typical dilution; "Low" if rumoured or speculative.
- "low"/"high"/"stakePct"/"cap[].p" are NUMBERS (no symbols).
- "cap" is the shareholding split; exactly ONE entry has "target": true (the individual). Percentages ~100.
- Use null for any value you don't know. Estimate financials conservatively if not stated.

FINDINGS:
${raw.substring(0, 40000)}

Output exactly this shape, with as many entries as the findings support:
{
  "opps": [
    {
      "horizon":"week","priority":"urgent","confidence":"Medium",
      "name":"Full name","role":"Founder & CEO","company":"Company Ltd","sector":"Frontier Technologies",
      "event":"Capital raise","low":40,"high":60,"timing":"Round closed this week","stakePct":32,
      "stakeNote":"Took secondary in the round",
      "blurb":"One sentence on what the company does and who its customers are.",
      "fin":{"revenue":"£9m","valType":"Valuation","valuation":"£160m","employees":"130","founded":"2018"},
      "cap":[{"n":"Full name (Founder)","p":32,"target":true},{"n":"Co-founder","p":15},{"n":"Lead VC","p":26},{"n":"Other","p":19},{"n":"Option pool","p":8}],
      "why":"One sentence on the private-banking opportunity.",
      "rationale":"Why it sits in this time window.",
      "angle":"One-line suggested approach and service.",
      "source":"Companies House"
    }
  ],
  "watch": [
    {"company":"Company","sector":"Frontier Technologies","stage":"Series A","horizon":"12–24 mo","why":"Why it's a future candidate.","signal":"What triggered inclusion."}
  ]
}`;
}

function parseJSON(text){
  let clean = text.replace(/```json|```/g,"").trim();
  const fb=clean.indexOf("{"), lb=clean.lastIndexOf("}");
  if (fb!==-1&&lb!==-1) clean=clean.substring(fb,lb+1);
  try { return JSON.parse(clean); } catch(e){ console.warn("clean parse failed:",e.message); }
  try {
    let r=clean,br=0,bk=0,ins=false,esc=false;
    for(const ch of r){ if(esc){esc=false;continue;} if(ch==="\\"&&ins){esc=true;continue;} if(ch==='"'){ins=!ins;continue;} if(ins)continue; if(ch==="{")br++;if(ch==="}")br--;if(ch==="[")bk++;if(ch==="]")bk--; }
    if(ins)r+='"'; while(bk>0){r+="]";bk--;} while(br>0){r+="}";br--;}
    return JSON.parse(r);
  } catch(e){ console.warn("repair failed:",e.message); return null; }
}

function normalise(obj, today){
  const opps = Array.isArray(obj&&obj.opps)?obj.opps:[];
  const watch = Array.isArray(obj&&obj.watch)?obj.watch:[];
  const conf = c => ["High","Medium","Low"].includes(c)?c:"Medium";
  const cleanOpps = opps.map((o,i)=>{
    const sector = SECTORS.includes(o.sector)?o.sector:"Frontier Technologies";
    const horizon = ["week","month","year"].includes(o.horizon)?o.horizon:"month";
    let priority = horizon==="year" ? "missed" : (["urgent","active","emerging"].includes(o.priority)?o.priority:"active");
    let cap = Array.isArray(o.cap)?o.cap.map(c=>({n:String(c.n||"—"),p:Number(c.p)||0,target:!!c.target})):[];
    if (cap.length && !cap.some(c=>c.target)) cap[0].target=true;
    return {
      id:i+1, horizon, priority, confidence:conf(o.confidence),
      name:o.name||"Unnamed individual", role:o.role||"", company:o.company||"—",
      sector, event:o.event||"Liquidity event",
      low:Number(o.low)||0, high:Number(o.high)||Number(o.low)||0,
      timing:o.timing||"", stakePct:Number(o.stakePct)||0, stakeNote:o.stakeNote||"", blurb:o.blurb||"",
      fin:{revenue:(o.fin&&o.fin.revenue)||"n/a", valType:(o.fin&&o.fin.valType)||"Valuation", valuation:(o.fin&&o.fin.valuation)||"n/a", employees:(o.fin&&o.fin.employees)||"n/a", founded:(o.fin&&o.fin.founded)||"n/a"},
      cap, why:o.why||"", rationale:o.rationale||"", angle:o.angle||"", source:o.source||"Press", isNew:false,
    };
  });
  const cleanWatch = watch.map(w=>({company:w.company||"—",sector:SECTORS.includes(w.sector)?w.sector:"Frontier Technologies",stage:w.stage||"—",horizon:w.horizon||"",why:w.why||"",signal:w.signal||""}));
  return { scan_date:today, generated:new Date().toISOString(), opps:cleanOpps, watch:cleanWatch };
}

async function main(){
  const t=Date.now();
  console.log("Prospect scanner —", new Date().toLocaleString("en-GB"));
  if(!CONFIG.ANTHROPIC_API_KEY){console.error("ERROR: ANTHROPIC_API_KEY not set.");process.exit(1);}
  if(!CONFIG.DATA_PASSPHRASE){console.error("ERROR: DATA_PASSPHRASE not set.");process.exit(1);}
  const today = new Date().toLocaleDateString("en-GB",{weekday:"long",year:"numeric",month:"long",day:"numeric"});
  const y=new Date().getFullYear(), ly=y-1, m=new Date().toLocaleString("en-GB",{month:"long"});

  const passA = [
    `UK defence aerospace technology company acquired OR sold OR exit ${y} ${ly}`,
    `UK AI cyber quantum semiconductor founder exit acquisition ${y} ${ly}`,
    `UK private equity buyout MBO recapitalisation technology manufacturing ${y} site:thetakeoverpanel.org.uk`,
    `UK healthtech pharma biotech company acquired OR IPO ${y} ${ly}`,
    `UK director share sale RNS PDMR technology defence energy AIM ${y}`,
  ];
  const passB = [
    `UK defence technology startup raises Series A B C funding round ${m} ${y}`,
    `UK AI cyber quantum semiconductor capital raise investment ${m} ${y}`,
    `UK MoD defence contract award ${y} DASA "Innovate UK" grant`,
    `UK energy storage grid nuclear battery distributed energy funding ${y}`,
    `UK robotics manufacturing critical minerals healthtech funding ${y} ${ly}`,
  ];

  console.log("Stage 1A: realised-liquidity scan…");
  const rawA = await callAnthropic([{role:"user",content:buildScoutPrompt(passA,"realised liquidity")}], true, 12000);
  console.log("Stage 1A done:", rawA.length, "chars");

  console.log("Pausing 65s…");
  await new Promise(r=>setTimeout(r,65000));

  console.log("Stage 1B: capital-raises & contracts scan…");
  const rawB = await callAnthropic([{role:"user",content:buildScoutPrompt(passB,"capital raises and contracts")}], true, 12000);
  console.log("Stage 1B done:", rawB.length, "chars");

  console.log("Pausing 65s…");
  await new Promise(r=>setTimeout(r,65000));

  console.log("Stage 2: formatting…");
  const raw = "PASS A — REALISED LIQUIDITY:\n"+rawA+"\n\nPASS B — CAPITAL RAISES & CONTRACTS:\n"+rawB;
  const jsonText = await callAnthropic([{role:"user",content:buildFormatterPrompt(raw,today)}], false, 8000);
  console.log("Stage 2 done:", jsonText.length, "chars");

  const payload = normalise(parseJSON(jsonText)||{}, today);

  // NEW-since-last-scan detection
  let prevKeys = new Set();
  try {
    if (fs.existsSync("data.json")) {
      const prev = JSON.parse(deobfuscate(fs.readFileSync("data.json","utf8"), CONFIG.DATA_PASSPHRASE));
      if (prev && Array.isArray(prev.opps)) prev.opps.forEach(o=>prevKeys.add((o.company+"|"+o.name).toLowerCase()));
    }
  } catch(e){ console.warn("Could not read previous data.json:", e.message); }
  if (prevKeys.size>0) {
    payload.opps.forEach(o=>{ o.isNew = !prevKeys.has((o.company+"|"+o.name).toLowerCase()); });
    console.log("New since last scan:", payload.opps.filter(o=>o.isNew).length);
  } else {
    console.log("First populated scan — no NEW flags applied.");
  }

  console.log("Prospects:", payload.opps.length, "· Watch:", payload.watch.length);
  const blob = obfuscate(JSON.stringify(payload), CONFIG.DATA_PASSPHRASE);
  fs.writeFileSync("data.json", blob);
  console.log(`Wrote data.json (${blob.length} bytes) in ${((Date.now()-t)/1000).toFixed(1)}s`);
}

main().catch(e=>{ console.error("ERROR:", e.message); process.exit(1); });
