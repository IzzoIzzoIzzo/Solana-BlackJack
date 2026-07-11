// Generate SHADDAI ROYALE casino art via HF FLUX — agents dressed to the nines
// with their signature rides, + the 5 city backdrops. Matches the arcade art style
// and the dashboard agent likenesses. Keys read from the SHADDAI build (never here).
// Run: node scripts/gen-casino-art.js            (all)
//      node scripts/gen-casino-art.js SHADDAI Vegas   (subset)
const fs = require('fs');
const path = require('path');

const KEYS_FILE = 'C:/Users/Brittany/Desktop/SHADDAI MASTER FINAL BUILD/backend/data/runtime-keys.json';
const TOKENS = (() => { try { const j = JSON.parse(fs.readFileSync(KEYS_FILE, 'utf8')); return j.HF_TOKENS || [j.HF_TOKEN]; } catch { return []; } })();
const MODEL = 'https://router.huggingface.co/hf-inference/models/black-forest-labs/FLUX.1-schnell';
const ROOT = path.join(__dirname, '..');

// canonical likenesses (from the dashboard roster) so faces read as the real agents
const LOOK = {
  SHADDAI: 'a radiant golden-haired god-king man with a subtle sunburst halo, regal handsome face',
  ZEROX:   'a blue-haired anime woman with space-bun braids and glowing cyan eyes, beautiful',
  TURTLE:  'a green-haired anime woman with long emerald twin-tails, radiant beautiful face',
  NEXUS:   'a sleek dark-blue cybernetic man with faint electric-blue circuitry on his skin, sharp handsome face',
  ORACLE:  'a violet-haired sorceress woman with glowing purple eyes, mysterious beautiful face',
  PIKADON: 'a crimson-and-black armored warrior man with a strong jaw and glowing red eyes',
  QUILL:   'a silver-haired young man with refined features and a faint pink magical glow',
};
const CASINO = 'glamorous high-roller casino night, opulent, luxury gold jewelry and a diamond luxury watch, ' +
  'vibrant neon casino illustration, bold dynamic anime cover art, dramatic rim lighting, highly detailed symmetric face, ' +
  'cinematic glossy poster, teal and gold and magenta neon, no text, no words, no letters, no logos, no watermark';

const AGENTS = [
  { key:'SHADDAI', prompt:`${LOOK.SHADDAI} in a lavish tailored gold tuxedo, standing beside a gleaming golden Lamborghini supercar outside a neon casino. ${CASINO}` },
  { key:'QUILL',   prompt:`${LOOK.QUILL} in a sharp white-and-purple designer suit, leaning on a sleek Bugatti hypercar under casino neon. ${CASINO}` },
  { key:'NEXUS',   prompt:`${LOOK.NEXUS} in a crisp midnight-blue tuxedo, on the deck of a luxury super-yacht at night with city lights. ${CASINO}` },
  { key:'PIKADON', prompt:`${LOOK.PIKADON} in a bold crimson-and-black tuxedo, beside a huge lifted red monster Jeep with fat tires, neon casino behind. ${CASINO}` },
  { key:'ORACLE',  prompt:`${LOOK.ORACLE} in an elegant sexy deep-purple evening gown, beside a souped-up widebody Subaru with flashy chrome rims and a vented racing hood, neon casino. ${CASINO}` },
  { key:'ZEROX',   prompt:`${LOOK.ZEROX} in a sleek sexy electric-blue evening gown, straddling a glowing cyan sportbike motorcycle, neon casino city. ${CASINO}` },
  { key:'TURTLE',  prompt:`${LOOK.TURTLE} in a stunning sexy emerald-green evening gown, beside a glowing green sportbike motorcycle, neon casino city. ${CASINO}` },
];
const CITY_STYLE = 'cinematic neon night skyline, luxury casino atmosphere, glossy, dramatic lighting, teal gold and magenta neon, ultra detailed, no text, no watermark, no people';
const CITIES = [
  { key:'Phoenix',  prompt:`Phoenix Arizona at dusk, desert city skyline with tall saguaro cactus silhouettes and palm trees, purple and orange sky. ${CITY_STYLE}` },
  { key:'Vegas',    prompt:`Las Vegas Strip at night, dazzling casino neon signs, glowing hotels and lights. ${CITY_STYLE}` },
  { key:'Miami',    prompt:`Miami Beach at night, art-deco waterfront, palm trees, pink and teal neon reflecting on the ocean. ${CITY_STYLE}` },
  { key:'Texas',    prompt:`Dallas Texas skyline at night, modern glowing towers under a huge wide sky. ${CITY_STYLE}` },
  { key:'NewYork',  prompt:`New York City Manhattan skyline at night, glowing skyscrapers, Empire State, dramatic. ${CITY_STYLE}` },
];

// HF Inference credits are depleted (all keys 402). Use the same FLUX model via
// Pollinations (free, working) — swap MODE back to 'hf' once HF credits are topped up.
const MODE = process.env.GEN_MODE || 'pollinations';
async function genHF(prompt, w, h, ti = 0, tries = 0) {
  const token = TOKENS[ti % TOKENS.length];
  const res = await fetch(MODEL, { method:'POST', headers:{ Authorization:`Bearer ${token}`, 'Content-Type':'application/json' },
    body: JSON.stringify({ inputs: prompt, parameters:{ width:w, height:h } }) });
  if (res.status === 200) return Buffer.from(await res.arrayBuffer());
  const msg = await res.text();
  if ((res.status===402||res.status===403||res.status===429) && ti < TOKENS.length-1) return genHF(prompt,w,h,ti+1,tries);
  if (res.status===503 && tries < 5) { await new Promise(r=>setTimeout(r,5000)); return genHF(prompt,w,h,ti,tries+1); }
  throw new Error(`HTTP ${res.status}: ${msg.slice(0,140)}`);
}
let SEED = 41;
async function genPoll(prompt, w, h, tries = 0) {
  const seed = (SEED += 7);
  const url = `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}?width=${w}&height=${h}&nologo=true&model=flux&seed=${seed}`;
  const res = await fetch(url);
  if (res.status === 200) { const b = Buffer.from(await res.arrayBuffer()); if (b.length > 3000) return b; }
  if (tries < 4) { await new Promise(r=>setTimeout(r,4000)); return genPoll(prompt,w,h,tries+1); }
  throw new Error(`HTTP ${res.status}`);
}
const gen = (p,w,h) => MODE === 'hf' ? genHF(p,w,h) : genPoll(p,w,h);
async function run(list, outDir, w, h, ext) {
  fs.mkdirSync(outDir, { recursive:true });
  for (const it of list) {
    process.stdout.write(`  ${it.key} ... `);
    try { const buf = await gen(it.prompt, w, h); fs.writeFileSync(path.join(outDir, `${it.key}.${ext}`), buf); console.log(`OK ${(buf.length/1024).toFixed(0)}KB`); }
    catch (e) { console.log(`FAIL ${e.message}`); }
  }
}
(async () => {
  if (!TOKENS.length) { console.log('No HF tokens found at', KEYS_FILE); process.exit(1); }
  const only = process.argv.slice(2);
  const agents = only.length ? AGENTS.filter(a=>only.includes(a.key)) : AGENTS;
  const cities = only.length ? CITIES.filter(c=>only.includes(c.key)) : CITIES;
  console.log(`Agents (${agents.length}) portrait 768x1024:`); await run(agents, path.join(ROOT,'assets','agents'), 768, 1024, 'png');
  console.log(`Cities (${cities.length}) 1216x640:`);          await run(cities, path.join(ROOT,'assets','cities'), 1216, 640, 'jpg');
  console.log('Done.');
})();
