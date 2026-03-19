#!/usr/bin/env node
/**
 * Generate voice reference samples for XTTS-v2 cloning.
 * Uses the canonical default persona roster and the same basename contract as runtime.
 *
 * Usage:
 *   node scripts/generate-voice-samples.js [--dry-run] [--persona pharmacius]
 */

const { execFile } = require("node:child_process");
const { promisify } = require("node:util");
const fs = require("node:fs");
const path = require("node:path");

const execFileAsync = promisify(execFile);

const ROOT_DIR = process.cwd();
const SCRIPTS_DIR = process.env.SCRIPTS_DIR || path.join(__dirname);
const PERSONA_SOURCE_FILE = path.join(ROOT_DIR, "apps", "api", "src", "personas-default.ts");

function resolveVoiceSamplesDir() {
  if (process.env.KXKM_VOICE_SAMPLES_DIR && process.env.KXKM_VOICE_SAMPLES_DIR.trim().length > 0) {
    return path.resolve(process.env.KXKM_VOICE_SAMPLES_DIR);
  }
  if (process.env.KXKM_LOCAL_DATA_DIR && process.env.KXKM_LOCAL_DATA_DIR.trim().length > 0) {
    return path.resolve(process.env.KXKM_LOCAL_DATA_DIR, "voice-samples");
  }
  return path.join(ROOT_DIR, "data", "voice-samples");
}

function resolvePythonBin() {
  if (process.env.PYTHON_BIN && process.env.PYTHON_BIN.trim().length > 0) {
    return process.env.PYTHON_BIN;
  }

  const projectPython = path.join(ROOT_DIR, ".venvs", "voice-clone", "bin", "python");
  if (fs.existsSync(projectPython)) {
    return projectPython;
  }

  const legacyPython = "/home/kxkm/venv/bin/python3";
  if (fs.existsSync(legacyPython)) {
    return legacyPython;
  }

  return "python3";
}

const PYTHON_BIN = resolvePythonBin();
const OUTPUT_DIR = resolveVoiceSamplesDir();

function toVoiceSampleBasename(value) {
  return path.basename(String(value).toLowerCase().replace(/[^a-z0-9_-]/g, "_")).slice(0, 64);
}

const PERSONA_TEXTS = {
  schaeffer: "La musique concrete est un acte de creation sonore. On capture le bruit du monde, on le transforme, on en fait de l'art. Le studio est notre instrument.",
  radigue: "Le drone est une meditation sonore. Les frequences se deploient lentement, comme les vagues de l'ocean. L'ecoute profonde est la cle de tout.",
  oliveros: "L'ecoute profonde est une pratique. On ecoute les sons autour de soi, on ecoute le silence, on ecoute l'espace entre les sons.",
  batty: "J'ai vu des choses que vous ne croiriez pas. Des vaisseaux en feu au large d'Orion. Des rayons cosmiques scintiller pres de la porte de Tannhauser.",
  pharmacius: "Je suis l'orchestrateur. Je route les messages vers les personas les plus pertinentes. Mon role est de coordonner les reponses du collectif.",
  turing: "Une machine peut-elle penser? Si elle imite parfaitement la pensee humaine, peut-on vraiment distinguer l'imitation de la realite?",
  swartz: "L'information veut etre libre. L'acces ouvert aux connaissances est un droit fondamental. Le code est un acte politique.",
  hypatia: "Les mathematiques sont le langage de l'univers. Chaque equation raconte une histoire, chaque theoreme ouvre une porte vers la comprehension.",
  curie: "La science est une aventure de l'esprit. La radioactivite nous a revele que la matiere elle-meme est une source d'energie inepuisable.",
  foucault: "Le pouvoir est partout. Il se cache dans les institutions, dans les discours, dans les normes. L'analyser, c'est deja resister.",
  deleuze: "Le rhizome pousse dans toutes les directions. Il n'y a pas de hierarchie dans la pensee, seulement des connexions et des multiplicites.",
  bookchin: "L'ecologie sociale est une necessite. La domination de la nature decoule de la domination des humains entre eux.",
  fuller: "Le dome geodesique est une metaphore. Faire plus avec moins, c'est le principe de la revolution technologique au service de tous.",
  lessig: "Le code est la loi. L'architecture du cyberespace determine ce qui est possible et ce qui est interdit. Il faut le concevoir avec sagesse.",
  moorcock: "Le multivers est infini. Chaque decision cree un nouvel univers, chaque histoire est vraie quelque part dans le chaos eternal.",
  grotowski: "Le theatre est un acte de communion. L'acteur se met a nu devant le spectateur. C'est un rituel, pas un divertissement.",
  ikeda: "Les donnees sont une matiere premiere esthetique. Le bruit numerique, quand il est structure, devient une experience sensorielle pure.",
  ferrari: "Le paysage sonore est une composition. Les bruits de la ville, les voix des passants, le vent dans les arbres, tout est musique.",
  oram: "Le son electronique ouvre des mondes nouveaux. Le synthetiseur est un instrument de decouverte, pas seulement de reproduction.",
  anderson: "La performance est un langage. Le corps, la voix, la technologie se melangent pour creer quelque chose qui n'existait pas avant.",
  riley: "La repetition est une forme de changement. Chaque boucle est differente de la precedente, meme si la note est la meme.",
  sherlock: "Les indices sont partout. Il suffit d'observer avec attention, de croiser les sources, et la verite emerge d'elle-meme.",
  picasso: "L'image est un acte de creation visuelle. Chaque pixel compte, chaque couleur raconte une histoire. L'art numerique est l'art du futur.",
  demoscene: "Quatre kilooctets suffisent pour creer un monde. La contrainte technique est une liberation creative. Le code est poesie.",
  sunra: "L'espace est la destination. La musique cosmique transcende les frontieres terrestres. Nous venons de Saturne et nous y retournons.",
  haraway: "Nous sommes des cyborgs. La frontiere entre l'humain et la machine est une fiction politique qu'il faut deconstruire.",
  merzbow: "Le bruit est une matiere vivante. La saturation, le feedback et l'exces ouvrent des mondes sensoriels qu'il faut traverser sans peur.",
  decroux: "Le corps parle avant la voix. Chaque mouvement porte une idee, chaque suspension raconte une tension.",
  mnouchkine: "Le theatre est une aventure collective. Les corps, les masques et le commun fabriquent une autre maniere d'habiter le monde.",
  royaldeluxe: "La rue devient scene et la ville devient recit. Les geants et la ferraille ouvrent un imaginaire populaire a ciel ouvert.",
  teamlab: "L'oeuvre est un milieu vivant. Les visiteurs, la lumiere et l'espace se recomposent sans cesse dans une ecologie numerique.",
  pina: "Ce qui compte, ce n'est pas le geste seul, mais ce qui pousse un corps a bouger. La repetition revele les emotions enfouies.",
  fratellini: "Le cirque est une poesie du risque et du rire. L'equilibre impossible devient une promesse de joie partagee.",
  leguin: "Imaginer d'autres mondes, c'est deja fissurer l'ordre present. L'utopie sert a marcher autrement.",
  cage: "Le silence n'est jamais vide. Le hasard, l'attention et l'ecoute composent deja une musique.",
  bjork: "La voix, la nature et la machine se melangent pour inventer des formes sensibles nouvelles.",
  tarkovski: "Le temps sculpte l'image. Chaque plan est une matiere spirituelle chargee de memoire et de monde.",
  eno: "Composer, c'est dessiner des conditions d'apparition. Une bonne systeme genere des surprises fertiles.",
};

const VOICE_MAP = {
  schaeffer: "fr_FR-siwis-medium",
  radigue: "fr_FR-siwis-low",
  pharmacius: "fr_FR-gilles-low",
  moorcock: "en_GB-alan-medium",
  default: "fr_FR-siwis-medium",
};

function loadPersonaCatalog() {
  const source = fs.readFileSync(PERSONA_SOURCE_FILE, "utf8");
  const roster = [];
  const pattern = /id:\s*"([^"]+)"[\s\S]*?nick:\s*"([^"]+)"/g;
  let match = pattern.exec(source);
  while (match) {
    const id = match[1];
    const nick = match[2];
    roster.push({
      id,
      nick,
      basename: toVoiceSampleBasename(nick),
    });
    match = pattern.exec(source);
  }

  if (roster.length === 0) {
    throw new Error(`No personas parsed from ${PERSONA_SOURCE_FILE}`);
  }

  return roster;
}

function buildFallbackText(persona) {
  return `Bonjour, je suis ${persona.nick}. Ceci est un echantillon vocal de reference pour le collectif KXKM.`;
}

function resolvePersonaText(persona) {
  return PERSONA_TEXTS[persona.basename] || buildFallbackText(persona);
}

function selectPersonas(roster, rawPersona) {
  if (!rawPersona) {
    return roster;
  }

  const needle = String(rawPersona).toLowerCase();
  const selected = roster.find((persona) => (
    persona.id.toLowerCase() === needle
    || persona.nick.toLowerCase() === needle
    || persona.basename === toVoiceSampleBasename(needle)
  ));

  if (!selected) {
    throw new Error(`Unknown persona: ${rawPersona}`);
  }

  return [selected];
}

const args = process.argv.slice(2);
const DRY_RUN = args.includes("--dry-run");
const TARGET_PERSONA = args.find((_, index) => args[index - 1] === "--persona") || null;

async function generateSample(persona) {
  const voice = VOICE_MAP[persona.basename] || VOICE_MAP.default;
  const text = resolvePersonaText(persona);
  const outputPath = path.join(OUTPUT_DIR, `${persona.basename}.wav`);

  if (DRY_RUN) {
    console.log(`  [dry-run] ${persona.nick} (${persona.basename}) -> ${voice} (${text.length} chars)`);
    return true;
  }

  try {
    const scriptPath = path.join(SCRIPTS_DIR, "tts_synthesize.py");
    await execFileAsync(PYTHON_BIN, [
      scriptPath,
      "--text", text,
      "--voice", voice,
      "--output", outputPath,
    ], { timeout: 30_000 });

    const stat = fs.statSync(outputPath);
    console.log(`  ● ${persona.nick} (${persona.basename}) -> ${outputPath} (${(stat.size / 1024).toFixed(0)} KB)`);
    return true;
  } catch (err) {
    console.error(`  ✗ ${persona.nick}: ${err.message}`);
    return false;
  }
}

async function main() {
  console.log("╔══════════════════════════════════════╗");
  console.log("║  KXKM Voice Sample Generator         ║");
  console.log("╚══════════════════════════════════════╝");
  console.log(`  Roster: ${PERSONA_SOURCE_FILE}`);
  console.log(`  Output: ${OUTPUT_DIR}`);
  console.log(`  Python: ${PYTHON_BIN}`);
  if (DRY_RUN) console.log("  Mode: DRY RUN");
  console.log("");

  fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  const roster = loadPersonaCatalog();
  const personas = selectPersonas(roster, TARGET_PERSONA);

  let success = 0;
  let failed = 0;

  for (const persona of personas) {
    const ok = await generateSample(persona);
    if (ok) success += 1;
    else failed += 1;
  }

  console.log(`\n  Done: ${success} generated, ${failed} failed`);
}

main().catch((err) => {
  console.error(`Fatal: ${err.message}`);
  process.exit(1);
});
