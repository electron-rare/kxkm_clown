#!/usr/bin/env node
/**
 * Generate voice reference samples for XTTS-v2 cloning.
 * Uses piper-tts to create a 6-second reference WAV per persona.
 *
 * Each persona gets a unique sample based on their identity text.
 * These samples are then used by tts_clone_voice.py for zero-shot cloning.
 *
 * Usage: node scripts/generate-voice-samples.js [--dry-run] [--persona schaeffer]
 * Requires: PYTHON_BIN with piper-tts installed
 */

const { execFile } = require("node:child_process");
const { promisify } = require("node:util");
const fs = require("node:fs");
const path = require("node:path");

const execFileAsync = promisify(execFile);

const PYTHON_BIN = process.env.PYTHON_BIN || "python3";
const SCRIPTS_DIR = process.env.SCRIPTS_DIR || path.join(__dirname);
const OUTPUT_DIR = path.join(process.cwd(), "data", "voice-samples");

// Reference texts per persona (6-10 seconds of speech each)
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
  oram: "Le son electronique ouvre des mondes nouveaux. Le synthétiseur est un instrument de decouverte, pas seulement de reproduction.",
  anderson: "La performance est un langage. Le corps, la voix, la technologie se melangent pour creer quelque chose qui n'existait pas avant.",
  riley: "La repetition est une forme de changement. Chaque boucle est differente de la precedente, meme si la note est la meme.",
  sherlock: "Les indices sont partout. Il suffit d'observer avec attention, de croiser les sources, et la verite emerge d'elle-meme.",
  picasso: "L'image est un acte de creation visuelle. Chaque pixel compte, chaque couleur raconte une histoire. L'art numerique est l'art du futur.",
  demoscene: "Quatre kilooctets suffisent pour creer un monde. La contrainte technique est une liberation creative. Le code est poesie.",
  sun_ra: "L'espace est la destination. La musique cosmique transcende les frontieres terrestres. Nous venons de Saturne et nous y retournons.",
  haraway: "Nous sommes des cyborgs. La frontiere entre l'humain et la machine est une fiction politique qu'il faut deconstruire.",
};

// Piper voice mapping per persona
const VOICE_MAP = {
  schaeffer: "fr_FR-siwis-medium",
  radigue: "fr_FR-siwis-low",
  pharmacius: "fr_FR-gilles-low",
  moorcock: "en_GB-alan-medium",
  default: "fr_FR-siwis-medium",
};

const args = process.argv.slice(2);
const DRY_RUN = args.includes("--dry-run");
const TARGET_PERSONA = args.find((a, i) => args[i - 1] === "--persona") || null;

async function generateSample(nick, text) {
  const voice = VOICE_MAP[nick] || VOICE_MAP.default;
  const outputPath = path.join(OUTPUT_DIR, `${nick}.wav`);

  if (DRY_RUN) {
    console.log(`  [dry-run] ${nick} → ${voice} (${text.length} chars)`);
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
    console.log(`  ● ${nick} → ${outputPath} (${(stat.size / 1024).toFixed(0)} KB)`);
    return true;
  } catch (err) {
    console.error(`  ✗ ${nick}: ${err.message}`);
    return false;
  }
}

async function main() {
  console.log("╔══════════════════════════════════════╗");
  console.log("║  KXKM Voice Sample Generator         ║");
  console.log("╚══════════════════════════════════════╝");
  console.log(`  Output: ${OUTPUT_DIR}`);
  console.log(`  Python: ${PYTHON_BIN}`);
  if (DRY_RUN) console.log("  Mode: DRY RUN");
  console.log("");

  fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  const personas = TARGET_PERSONA
    ? { [TARGET_PERSONA]: PERSONA_TEXTS[TARGET_PERSONA] || "Test de voix pour cette persona." }
    : PERSONA_TEXTS;

  let success = 0;
  let failed = 0;

  for (const [nick, text] of Object.entries(personas)) {
    const ok = await generateSample(nick, text);
    if (ok) success++;
    else failed++;
  }

  console.log(`\n  Done: ${success} generated, ${failed} failed`);
}

main().catch(err => {
  console.error(`Fatal: ${err.message}`);
  process.exit(1);
});
