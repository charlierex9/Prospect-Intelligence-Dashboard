/**
 * ============================================================
 *  PROSPECT — INTELLIGENCE SCANNER (dashboard edition)
 *  Writes an encrypted data.json for the Prospect dashboard.
 *  No email. Runs on manual trigger via GitHub Actions.
 * ============================================================
 */
const fs = require("fs");

const CONFIG = {
  ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY || "",
  DATA_PASSPHRASE:   process.env.DATA_PASSPHRASE   || "",
  THRESHOLD_M: 10,
  MODEL:       "claude-opus-4-8",   // Stage 2 formatting
  SCOUT_MODEL: "claude-opus-4-8",   // Stage 1 web search — best available
};

// ─── OBFUSCATION (matches the dashboard's deobfuscate) ───────
function obfuscate(text, key){
  const tb = Buffer.from(text, "utf8");
  const kb = Buffer.from(key, "utf8");
  const out = Buffer.alloc(tb.length);
  for (let i = 0; i < tb.length; i++) out[i] = tb[i] ^ kb[i % kb.length];
  return out.toString("base64");
}

// ─── STAGE 1: scout (prose findings) ─────────────────────────
function buildScoutPrompt(){
  const today = new Date().toLocaleDateString("en-GB",{weekday:"long",year:"numeric",month:"long",day:"numeric"});
  const y = new Date().getFullYear(); const ly = y-1;
  const m = new Date().toLocaleString("en-GB",{month:"long"});
  return `You are a private banking intelligence analyst. Today is ${today}.

Search the web and return a DETAILED PROSE report (not JSON) of UK liquidity events — founders, entrepreneurs and significant shareholders likely to receive or who recently received £${CONFIG.THRESHOLD_M}m+ personally. One paragraph per company: name the individual, their role, the company, what happened, when, estimated deal size, and any shareholding detail.

Use the "government customer test": include any company selling to UK Government, MoD, GCHQ, UKIC, NATO, Five Eyes, NHS security, Border Force, or critical national infrastructure — even if the founder doesn't call themselves "defence".

YOU MUST RUN ALL OF THESE SEARCHES — do not stop after one or two:

Search 1:  "UK defence technology acquisition ${y}"
Search 2:  "UK cyber security funding round ${m} ${y}"
Search 3:  "UK quantum computing raises ${y}"
Search 4:  "UK deep tech startup investment ${m} ${y}"
Search 5:  "UK founder exit acquisition ${y} ${ly}"
Search 6:  "UK sports club sold ownership ${y} ${ly}"
Search 7:  "UK AI company acquired ${y}"
Search 8:  "DASA award ${y} company"
Search 9:  "UK director share sale RNS defence cyber ${y}"
Search 10: "UK private equity defence technology exit ${y}"
Search 11: "UK IPO AIM technology defence ${y}"
Search 12: "Sifted UK deeptech raises ${m} ${y}"
Search 13: "companies house SH01 defence cyber UK ${m} ${y}"
Search 14: "UK semiconductor space biosurveillance OSINT funding ${y}"
Search 15: "UK sports technology esports investment ${y}"

Run EVERY search above. After each search, write a paragraph on what you found before moving to the next.

SECTORS: Hard tech (quantum, semiconductors, space, advanced materials, directed energy, hypersonics); Cyber (CNI, zero-trust, threat intel, IAM, deepfake detection); Bio security (biosurveillance, CBRN); Intelligence (OSINT, GEOINT, SIGINT); Border/maritime (screening, maritime awareness, counter-drone); Sports (clubs, stadiums, media rights, sports tech, esports); GovTech.

For each: estimate the individual's stake % (Pre-seed ~80%, Post-seed ~60%, Post-A ~45%, Post-B ~32%, Post-C ~22%) and personal liquidity (stake % x deal/valuation). Include EVERY credible name. Prose only.`;
}

// ─── STAGE 2: formatter (dashboard JSON) ─────────────────────
function buildFormatterPrompt(raw, today){
  return `Convert the intelligence findings below into a JSON object for a dashboard. Return ONLY valid JSON — no markdown, no preamble.

RULES:
- One entry per company/individual. Never merge. Include every finding.
- Keep text fields short (under 22 words).
- "sector" MUST be exactly one of: "Defence", "Critical Tech", "Sports".
- "horizon": "week" (last 7 days), "month" (last 30 days), or "year" (last 12 months).
- "priority": "urgent" or "active" or "emerging" for week/month; use "missed" for year items.
- "low"/"high"/"stakePct"/"cap[].p" are NUMBERS (no £ or % symbol).
- "cap" is the shareholding split; exactly ONE entry has "target": true (the individual). Percentages should total ~100.
- Use null for any URL/value you don't know. Estimate financials conservatively if not stated.

FINDINGS:
${raw.substring(0, 26000)}

Output exactly this shape, with as many opps/watch entries as the findings support:
{
  "opps": [
    {
      "horizon":"week","priority":"urgent",
      "name":"Full name","role":"Founder & CEO","company":"Company Ltd","sector":"Critical Tech",
      "event":"Secondary share sale","low":40,"high":60,"timing":"SH01 filed this week","stakePct":32,
      "stakeNote":"Selling part of holding into the round",
      "blurb":"One sentence on what the company does and who its customers are.",
      "fin":{"revenue":"£9m","valType":"Valuation","valuation":"£160m","employees":"130","founded":"2018"},
      "cap":[{"n":"Full name (Founder)","p":32,"target":true},{"n":"Co-founder","p":15},{"n":"Lead VC","p":26},{"n":"Other investors","p":19},{"n":"Option pool","p":8}],
      "why":"One sentence on why this is a private-banking opportunity.",
      "rationale":"Why it sits in this time window specifically.",
      "angle":"One-line suggested approach and relevant service.",
      "source":"Companies House"
    }
  ],
  "watch": [
    {"company":"Company","sector":"Critical Tech","stage":"Series A","horizon":"12–24 mo","why":"Why it's a future liquidity candidate.","signal":"What triggered inclusion."}
  ]
}`;
}

async function callAnthropic(messages, useSearch, maxTokens, model){
  const body = { model: model || CONFIG.MODEL, max_tokens: maxTokens, messages };
  if (useSearch) body.tools = [{ type:"web_search_20250305", name:"web_search" }];
  const res = await fetch("https://api.anthropic.com/v1/messages",{
    method:"POST",
    headers:{ "Content-Type":"application/json", "x-api-key":CONFIG.ANTHROPIC_API_KEY, "anthropic-version":"2023-06-01" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Anthropic API error ${res.status}: ${await res.text()}`);
  const data = await res.json();
  return data.content.filter(b=>b.type==="text").map(b=>b.text).join("");
}

function parseJSON(text){
  let clean = text.replace(/```json|```/g,"").trim();
  const fb = clean.indexOf("{"); const lb = clean.lastIndexOf("}");
  if (fb!==-1 && lb!==-1) clean = clean.substring(fb, lb+1);
  try { return JSON.parse(clean); } catch(e){ console.warn("clean parse failed:", e.message); }
  // repair truncation
  try {
    let r=clean, br=0,bk=0,ins=false,esc=false;
    for (const ch of r){
      if(esc){esc=false;continue;}
      if(ch==="\\"&&ins){esc=true;continue;}
      if(ch==='"'){ins=!ins;continue;}
      if(ins)continue;
      if(ch==="{")br++; if(ch==="}")br--; if(ch==="[")bk++; if(ch==="]")bk--;
    }
    if(ins)r+='"'; while(bk>0){r+="]";bk--;} while(br>0){r+="}";br--;}
    return JSON.parse(r);
  } catch(e){ console.warn("repair failed:", e.message); return null; }
}

// normalise so the dashboard never breaks on partial data
const SECTORS = ["Defence","Critical Tech","Sports"];
function normalise(obj, today){
  const opps = Array.isArray(obj && obj.opps) ? obj.opps : [];
  const watch = Array.isArray(obj && obj.watch) ? obj.watch : [];
  const cleanOpps = opps.map((o,i)=>{
    const sector = SECTORS.includes(o.sector) ? o.sector : "Critical Tech";
    const horizon = ["week","month","year"].includes(o.horizon) ? o.horizon : "month";
    let priority = o.priority;
    if (horizon==="year") priority = ["missed","still_active"].includes(priority)?"missed":"missed";
    else if (!["urgent","active","emerging"].includes(priority)) priority="active";
    let cap = Array.isArray(o.cap) ? o.cap.map(c=>({n:String(c.n||"—"),p:Number(c.p)||0,target:!!c.target})) : [];
    if (cap.length && !cap.some(c=>c.target)) cap[0].target = true;
    return {
      id: i+1, horizon, priority,
      name: o.name||"Unnamed individual", role: o.role||"", company: o.company||"—",
      sector, event: o.event||"Liquidity event",
      low: Number(o.low)||0, high: Number(o.high)||Number(o.low)||0,
      timing: o.timing||"", stakePct: Number(o.stakePct)||0, stakeNote: o.stakeNote||"",
      blurb: o.blurb||"", 
      fin: { revenue:(o.fin&&o.fin.revenue)||"n/a", valType:(o.fin&&o.fin.valType)||"Valuation", valuation:(o.fin&&o.fin.valuation)||"n/a", employees:(o.fin&&o.fin.employees)||"n/a", founded:(o.fin&&o.fin.founded)||"n/a" },
      cap,
      why: o.why||"", rationale: o.rationale||"", angle: o.angle||"", source: o.source||"Press",
    };
  });
  const cleanWatch = watch.map(w=>({
    company:w.company||"—", sector:SECTORS.includes(w.sector)?w.sector:"Critical Tech",
    stage:w.stage||"—", horizon:w.horizon||"", why:w.why||"", signal:w.signal||"",
  }));
  return { scan_date: today, generated: new Date().toISOString(), opps: cleanOpps, watch: cleanWatch };
}

async function main(){
  const t = Date.now();
  console.log("Prospect scanner —", new Date().toLocaleString("en-GB"));
  if (!CONFIG.ANTHROPIC_API_KEY) { console.error("ERROR: ANTHROPIC_API_KEY secret not set."); process.exit(1); }
  if (!CONFIG.DATA_PASSPHRASE)   { console.error("ERROR: DATA_PASSPHRASE secret not set."); process.exit(1); }

  const today = new Date().toLocaleDateString("en-GB",{weekday:"long",year:"numeric",month:"long",day:"numeric"});

  console.log("Stage 1: scouting with web search…");
  const raw = await callAnthropic([{role:"user",content:buildScoutPrompt()}], true, 16000, CONFIG.SCOUT_MODEL);
  console.log("Stage 1 done:", raw.length, "chars");

  console.log("Pausing 65s for rate-limit reset…");
  await new Promise(r=>setTimeout(r,65000));

  console.log("Stage 2: formatting…");
  const jsonText = await callAnthropic([{role:"user",content:buildFormatterPrompt(raw,today)}], false, 12000, CONFIG.MODEL);
  console.log("Stage 2 done:", jsonText.length, "chars");

  const parsed = parseJSON(jsonText);
  const payload = normalise(parsed || {}, today);
  console.log("Prospects:", payload.opps.length, "· Watch:", payload.watch.length);

  if (payload.opps.length === 0) {
    // keep whatever exists; still write so the app shows the timestamp
    console.warn("No opportunities parsed — writing empty set.");
  }

  const blob = obfuscate(JSON.stringify(payload), CONFIG.DATA_PASSPHRASE);
  fs.writeFileSync("data.json", blob);
  console.log(`Wrote data.json (${blob.length} bytes) in ${((Date.now()-t)/1000).toFixed(1)}s`);
}

main().catch(e=>{ console.error("ERROR:", e.message); process.exit(1); });
