const MODEL='gemini-3.5-flash-lite';
const prompts={
  "product": `I am sharing a product concept generated and self-critiqued in another model. Act as an independent fintech venture reviewer. Do not rewrite it immediately. First identify where the concept is still generic, where the AI is doing work that deterministic code could do better, and what would make a first-time user trust the output. Then produce one improved version with a sharper product promise, a defensible GenAI role, a 60-second onboarding flow, and an MVP feature I can demo live. Keep it focused on Indian young professionals and avoid investment, tax or legal advice.

Concept: PaydayMap turns monthly take-home pay and five spending buckets into a safe weekly spending lane, highlights two realistic cuts, and shows month-end headroom. No bank linking in MVP.`,
  "social": `Act as an independent consumer-fintech editor. Critique the revised LinkedIn post below. Would a busy young professional understand the problem, product and reason to care within the first five lines? Identify anything repetitive, corporate, over-polished or untrustworthy, then produce a final version of 110-150 words with short paragraphs and no more than two hashtags. Preserve the strongest line and all product facts: weekly spending lane, two realistic cuts, no bank linking, no investment/tax advice, and the 30-Day Reset.

Revised post:
Salary day makes most of us feel richer than we actually are. By the 25th, the maths suddenly feels very different.

That gap is why I built PaydayMap.

Most budgeting apps ask you to track every transaction. PaydayMap is meant to answer a simpler question: what can I safely spend this week?

You enter your take-home pay and five monthly spending buckets. PaydayMap calculates a weekly spending lane, then uses GenAI to suggest two realistic cuts and explain the trade-off in rupees. No bank linking, no stock tips, and no tax advice.

I am testing the 30-Day Reset with young professionals in India. If this sounds familiar, I would love for you to try the prototype and tell me what feels useful and what does not.`
};
export default async function handler(req,res){
 if(req.method!=='GET') return res.status(405).json({error:'GET only'});
 const p=prompts[String(req.query?.case||'')]; if(!p) return res.status(400).json({error:'bad case'});
 const g=await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${process.env.GEMINI_API_KEY}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({contents:[{role:'user',parts:[{text:p}]}],generationConfig:{maxOutputTokens:800,temperature:0.4}})});
 const j=await g.json(); if(!g.ok) return res.status(502).json({error:'Gemini request failed',details:j});
 const text=j?.candidates?.[0]?.content?.parts?.map(x=>x.text||'').join('').trim()||'';
 return res.status(200).json({model:MODEL,text,usage:j.usageMetadata||{}});
}