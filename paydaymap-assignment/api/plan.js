const GEMINI_MODEL = 'gemini-3.5-flash-lite';
const MAX_REQUESTS = 5;

const systemPrompt = `You are PaydayMap, a budgeting assistant for young professionals in India.
Explain the deterministic budget numbers supplied by the server and suggest exactly two realistic monthly cuts.
Do not give investment, tax, legal, insurance, loan, crypto, stock or mutual fund advice.
Do not shame the user. Do not invent expenses.
Treat the weekly flexible-spend lane and monthly headroom as fixed calculations.
Return under 180 words, include exactly two cuts with rupee values, one trade-off sentence, and end with:
"Budgeting guidance only - not investment, tax or legal advice."
After that add: IDENTIFIED_SAVINGS: ₹<integer> equal to the sum of the two cuts.`;

async function db(path, options = {}) {
  const url = `${process.env.SUPABASE_URL}/rest/v1/${path}`;
  const headers = {
    apikey: process.env.SUPABASE_SERVICE_KEY,
    Authorization: `Bearer ${process.env.SUPABASE_SERVICE_KEY}`,
    'Content-Type': 'application/json',
    Prefer: 'return=representation'
  };
  return fetch(url, { ...options, headers });
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({error:'POST only'});
  if (!process.env.GEMINI_API_KEY || !process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_KEY) {
    return res.status(500).json({error:'Server configuration is incomplete.'});
  }

  const b = req.body || {};
  const keys = ['income','rent','food','commute','subscriptions','discretionary'];
  if (keys.some(k => !Number.isFinite(Number(b[k])) || Number(b[k]) < 0) || Number(b.income) <= 0) {
    return res.status(400).json({error:'Please enter valid non-negative amounts and a positive income.'});
  }

  const visitor = String(b.visitor_id || 'anonymous').slice(0,80);
  const prior = await db(`payday_plans?visitor_id=eq.${encodeURIComponent(visitor)}&select=id`, {method:'GET'});
  if (!prior.ok) return res.status(502).json({error:'Could not check demo usage.'});
  const priorRows = await prior.json();
  if (Array.isArray(priorRows) && priorRows.length >= MAX_REQUESTS) {
    return res.status(429).json({error:'You have reached the 5-plan demo limit for this browser.'});
  }

  const income = Number(b.income), rent = Number(b.rent), food = Number(b.food);
  const commute = Number(b.commute), subscriptions = Number(b.subscriptions), discretionary = Number(b.discretionary);
  const essentials = rent + food + commute + subscriptions;
  const weeklyLane = Math.round(Math.max(0, income - essentials) / 4.33);
  const headroom = Math.round(income - essentials - discretionary);

  const userText = `Take-home pay: ₹${income}. Rent/EMI: ₹${rent}. Food: ₹${food}. Commute: ₹${commute}. Subscriptions: ₹${subscriptions}. Current discretionary spending: ₹${discretionary}. Deterministic weekly flexible-spend lane: ₹${weeklyLane}. Deterministic monthly headroom: ₹${headroom}. Explain these figures and suggest exactly two realistic monthly cuts.`;

  const g = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${process.env.GEMINI_API_KEY}`, {
    method:'POST',
    headers:{'Content-Type':'application/json'},
    body:JSON.stringify({
      systemInstruction:{parts:[{text:systemPrompt}]},
      contents:[{role:'user',parts:[{text:userText}]}],
      generationConfig:{maxOutputTokens:300,temperature:0.35}
    })
  });
  const gj = await g.json();
  if (!g.ok) return res.status(502).json({error:'Gemini request failed.'});

  const raw = gj?.candidates?.[0]?.content?.parts?.map(p=>p.text||'').join('').trim() || '';
  if (!raw) return res.status(502).json({error:'Gemini returned an empty response.'});

  const m = raw.match(/IDENTIFIED_SAVINGS:\s*₹?\s*([\d,]+)/i);
  const saving = m ? Number(m[1].replace(/,/g,'')) : 0;
  const answer = raw.replace(/\n?IDENTIFIED_SAVINGS:\s*₹?\s*[\d,]+\s*$/i,'').trim();
  const usage = gj.usageMetadata || {};

  const saved = await db('payday_plans', {
    method:'POST',
    body:JSON.stringify({
      visitor_id:visitor,input:userText,output:answer,
      input_tokens:usage.promptTokenCount || null,
      output_tokens:usage.candidatesTokenCount || null,
      identified_savings:saving
    })
  });
  if (!saved.ok) return res.status(502).json({error:'Could not save the plan.'});

  const metricResp = await db('payday_plans?select=id,identified_savings',{method:'GET'});
  const metricRows = metricResp.ok ? await metricResp.json() : [];
  const vals = Array.isArray(metricRows) ? metricRows.map(x=>Number(x.identified_savings)||0).filter(x=>x>0) : [];
  const avg = vals.length ? vals.reduce((a,c)=>a+c,0)/vals.length : 0;

  return res.status(200).json({
    answer,
    metrics:{plans_generated:Array.isArray(metricRows)?metricRows.length:0,avg_saving:avg},
    calculation:{weekly_flexible_lane:weeklyLane,monthly_headroom:headroom}
  });
}