function cleanText(value, maxLength = 4000) {
  if (typeof value !== "string") return "";
  return value.trim().slice(0, maxLength);
}

function cleanList(value, maxItems = 12, maxLength = 240) {
  if (Array.isArray(value)) {
    return value
      .map((item) => cleanText(item, maxLength))
      .filter(Boolean)
      .slice(0, maxItems);
  }

  if (typeof value === "string") {
    return value
      .split(/\r?\n/)
      .map((item) => cleanText(item, maxLength))
      .filter(Boolean)
      .slice(0, maxItems);
  }

  return [];
}

function uniq(items) {
  return [...new Set(items.filter(Boolean))];
}

function extractJsonBlock(text) {
  if (typeof text !== "string") return null;
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) return null;

  try {
    return JSON.parse(match[0]);
  } catch {
    return null;
  }
}

function buildFeedbackSummary(feedback) {
  const summary = {
    positive: [],
    negative: [],
    admin: [],
  };

  for (const entry of feedback.slice(-24)) {
    const details = cleanText(entry?.payload?.details || entry?.reason || entry?.payload?.note || "", 200);
    const short = details || `${entry.kind} via ${entry.actor || entry.channel || "runtime"}`;

    if (entry.kind === "vote") {
      if (entry.payload?.direction === "chosen" || entry.payload?.direction === "up") summary.positive.push(short);
      if (entry.payload?.direction === "rejected" || entry.payload?.direction === "down") summary.negative.push(short);
      continue;
    }

    if (entry.kind === "implicit_preference" || entry.kind === "implicit_positive" || entry.kind === "implicit_negative") {
      if (
        entry.payload?.direction === "positive"
        || entry.payload?.direction === "up"
        || entry.kind === "implicit_positive"
      ) summary.positive.push(short);
      if (
        entry.payload?.direction === "negative"
        || entry.payload?.direction === "down"
        || entry.kind === "implicit_negative"
      ) summary.negative.push(short);
      continue;
    }

    if (entry.kind === "admin_edit" || entry.kind === "auto_apply") {
      summary.admin.push(short);
    }
  }

  return {
    positive: uniq(summary.positive).slice(0, 6),
    negative: uniq(summary.negative).slice(0, 6),
    admin: uniq(summary.admin).slice(0, 6),
  };
}

function buildRuntimeSignalsSummary(runtimeSignals) {
  const training = Array.isArray(runtimeSignals?.training) ? runtimeSignals.training : [];
  const dpo = Array.isArray(runtimeSignals?.dpo) ? runtimeSignals.dpo : [];

  return {
    training: uniq(
      training
        .map((entry) => cleanText(
          [
            entry.channel ? `${entry.channel}` : "",
            entry.user ? `user:${entry.user}` : "",
            entry.assistant ? `assistant:${entry.assistant}` : "",
          ].filter(Boolean).join(" | "),
          240
        ))
        .filter(Boolean)
    ).slice(0, 4),
    dpo: uniq(
      dpo
        .map((entry) => cleanText(
          [
            entry.prompt ? `prompt:${entry.prompt}` : "",
            entry.chosenModel ? `chosen:${entry.chosenModel}` : "",
            entry.rejectedModel ? `rejected:${entry.rejectedModel}` : "",
          ].filter(Boolean).join(" | "),
          240
        ))
        .filter(Boolean)
    ).slice(0, 4),
  };
}

function buildFallbackPatch(persona, source, feedback, runtimeSignals) {
  const feedbackSummary = buildFeedbackSummary(feedback);
  const runtimeSummary = buildRuntimeSignalsSummary(runtimeSignals);
  const preferredName = cleanText(source.preferredName, 20) || persona.name;
  const preferredModel = cleanText(source.preferredModel, 120) || persona.model;
  const tone = cleanText(source.tone, 300);
  const facts = cleanList(source.facts, 8, 180);
  const themes = cleanList(source.themes, 8, 120);
  const lexicon = cleanList(source.lexicon, 8, 80);
  const quotes = cleanList(source.quotes, 4, 160);
  const notes = cleanText(source.notes, 400);

  const styleSections = [persona.style];

  const sourceDirectives = [];
  if (tone) sourceDirectives.push(`Ton et posture: ${tone}.`);
  if (themes.length) sourceDirectives.push(`Thèmes dominants: ${themes.join(", ")}.`);
  if (lexicon.length) sourceDirectives.push(`Lexique privilégié: ${lexicon.join(", ")}.`);
  if (facts.length) sourceDirectives.push(`Faits stables à respecter: ${facts.join(" | ")}.`);
  if (quotes.length) sourceDirectives.push(`Citations ou formulations de référence: ${quotes.join(" | ")}.`);
  if (notes) sourceDirectives.push(`Notes éditoriales: ${notes}.`);

  if (sourceDirectives.length) {
    styleSections.push(`Repères source:\n- ${sourceDirectives.join("\n- ")}`);
  }

  const feedbackDirectives = [];
  if (feedbackSummary.positive.length) {
    feedbackDirectives.push(`À renforcer: ${feedbackSummary.positive.join(" | ")}.`);
  }
  if (feedbackSummary.negative.length) {
    feedbackDirectives.push(`À éviter ou corriger: ${feedbackSummary.negative.join(" | ")}.`);
  }
  if (feedbackSummary.admin.length) {
    feedbackDirectives.push(`Décisions éditoriales récentes: ${feedbackSummary.admin.join(" | ")}.`);
  }

  if (feedbackDirectives.length) {
    styleSections.push(`Synthèse Pharmacius:\n- ${feedbackDirectives.join("\n- ")}`);
  }

  const runtimeDirectives = [];
  if (runtimeSummary.training.length) {
    runtimeDirectives.push(`Échos conversationnels récents: ${runtimeSummary.training.join(" | ")}.`);
  }
  if (runtimeSummary.dpo.length) {
    runtimeDirectives.push(`Préférences explicites récentes: ${runtimeSummary.dpo.join(" | ")}.`);
  }

  if (runtimeDirectives.length) {
    styleSections.push(`Signaux runtime bornés:\n- ${runtimeDirectives.join("\n- ")}`);
  }

  return {
    name: preferredName,
    model: preferredModel,
    style: styleSections.filter(Boolean).join("\n\n").trim(),
    reason: [
      source.subjectName ? `source:${source.subjectName}` : null,
      source.sources?.length ? `${source.sources.length} source(s)` : null,
      feedback.length ? `${feedback.length} signal(s) chat` : null,
      feedbackSummary.negative.length ? `${feedbackSummary.negative.length} correction(s)` : null,
      runtimeSignals?.counts?.training ? `${runtimeSignals.counts.training} signal(aux) training` : null,
      runtimeSignals?.counts?.dpo ? `${runtimeSignals.counts.dpo} signal(aux) dpo` : null,
    ].filter(Boolean).join(" | ") || "fallback heuristique Pharmacius",
    generator: "heuristic",
  };
}

function normalizePatch(candidate, fallback) {
  if (!candidate || typeof candidate !== "object") return fallback;

  return {
    name: cleanText(candidate.name, 20) || fallback.name,
    model: cleanText(candidate.model, 120) || fallback.model,
    style: cleanText(candidate.style, 12000) || fallback.style,
    reason: cleanText(candidate.reason, 400) || fallback.reason,
    generator: cleanText(candidate.generator, 40) || fallback.generator,
  };
}

function normalizeAttachmentBrief(candidate, fallback) {
  if (!candidate || typeof candidate !== "object") return fallback;

  return {
    summary: cleanText(candidate.summary, 400) || fallback.summary,
    prompt: cleanText(candidate.prompt, 6000) || fallback.prompt,
    warnings: cleanList(candidate.warnings, 6, 200).length
      ? cleanList(candidate.warnings, 6, 200)
      : fallback.warnings,
    generator: cleanText(candidate.generator, 40) || fallback.generator,
  };
}

function buildPrompt(pharmacius, persona, source, feedback, proposals, runtimeSignals) {
  const recentFeedback = feedback.slice(-12);
  const recentProposals = proposals.slice(0, 6);

  return [
    {
      role: "system",
      content: [
        `Tu es ${pharmacius.name} (${pharmacius.desc}).`,
        pharmacius.style,
        "Tu réponds uniquement en JSON valide, sans markdown.",
        'Format strict: {"name":"...","model":"...","style":"...","reason":"...","generator":"llm"}',
        "Tu peux ajuster name, model et style.",
        "Tu dois t'appuyer sur les sources et le feedback. Pas d'invention biographique.",
      ].join("\n"),
    },
    {
      role: "user",
      content: JSON.stringify({
        persona: {
          id: persona.id,
          name: persona.name,
          model: persona.model,
          desc: persona.desc,
          style: persona.style,
        },
        source,
        feedback: recentFeedback,
        proposals: recentProposals,
        runtimeSignals: runtimeSignals || { relevantModels: [], training: [], dpo: [], counts: { training: 0, dpo: 0 } },
      }),
    },
  ];
}

function buildAttachmentFallback({ pharmacius, attachment, analysis, info }) {
  const actor = cleanText(info?.nick, 40) || "utilisateur";
  const channel = cleanText(info?.channel, 40) || "#general";
  const warnings = cleanList(analysis?.warnings, 6, 160);
  const title = cleanText(analysis?.title || attachment?.originalName || "pièce jointe", 120);
  const sourceSummary = cleanText(analysis?.sourceSummary, 320) || "Pièce jointe locale.";
  const extractedText = cleanText(analysis?.extractedText, 2200);
  const transcript = cleanText(analysis?.transcript, 2200);
  const caption = cleanText(analysis?.caption, 500);

  const summaryParts = [
    `${pharmacius?.name || "Pharmacius"}: ${title}`,
    sourceSummary,
  ];
  if (warnings.length) summaryParts.push(`Vigilance: ${warnings.join(" | ")}`);

  const promptParts = [
    "=== BRIEF PHARMACIUS ===",
    `Canal: ${channel}`,
    `Auteur: ${actor}`,
    `Fichier: ${title}`,
    `Type: ${attachment?.kind || analysis?.kind || "unknown"} (${attachment?.mime || "application/octet-stream"})`,
    `Résumé: ${sourceSummary}`,
  ];

  if (caption) promptParts.push(`Légende: ${caption}`);
  if (transcript) promptParts.push(`Transcription:\n${transcript}`);
  if (extractedText) promptParts.push(`Texte extrait:\n${extractedText}`);
  if (warnings.length) promptParts.push(`Avertissements: ${warnings.join(" | ")}`);
  promptParts.push("Consigne: réponds au contenu du fichier et à son contexte, sans prétendre avoir vu ou entendu plus que ce qui est fourni ici.");
  promptParts.push("=== FIN BRIEF PHARMACIUS ===");

  return {
    summary: cleanText(summaryParts.join(" — "), 400),
    prompt: cleanText(promptParts.join("\n"), 6000),
    warnings,
    generator: "heuristic",
  };
}

function buildAttachmentPrompt(pharmacius, attachment, analysis, info) {
  return [
    {
      role: "system",
      content: [
        `Tu es ${pharmacius.name} (${pharmacius.desc}).`,
        pharmacius.style,
        "Tu orchestres l'analyse de pièces jointes pour KXKM_Clown.",
        "Tu réponds uniquement en JSON valide, sans markdown.",
        'Format strict: {"summary":"...","prompt":"...","warnings":["..."],"generator":"llm"}',
        "summary = note très courte visible dans le chat.",
        "prompt = brief opératoire textuel destiné aux autres personas.",
        "N'invente jamais de contenu absent du fichier ou du paquet d'analyse.",
      ].join("\n"),
    },
    {
      role: "user",
      content: JSON.stringify({
        attachment: {
          id: attachment.id,
          kind: attachment.kind,
          mime: attachment.mime,
          originalName: attachment.originalName,
          sizeBytes: attachment.sizeBytes,
          nick: attachment.nick,
          channel: attachment.channel,
        },
        analysis,
        context: {
          nick: info?.nick || attachment.nick,
          channel: info?.channel || attachment.channel,
        },
      }),
    },
  ];
}

function createPharmaciusGenerator({ getPersonaById, ollamaChat }) {
  return async function generatePersonaPatch({ persona, source, feedback, proposals, runtimeSignals }) {
    const fallback = buildFallbackPatch(persona, source, feedback, runtimeSignals);
    const pharmacius = getPersonaById("pharmacius");

    if (!pharmacius || typeof ollamaChat !== "function") {
      return fallback;
    }

    try {
      const response = await ollamaChat(
        pharmacius.model,
        buildPrompt(pharmacius, persona, source, feedback, proposals, runtimeSignals),
        () => {}
      );
      const parsed = extractJsonBlock(response);
      return normalizePatch(parsed, fallback);
    } catch {
      return fallback;
    }
  };
}

function createPharmaciusAttachmentOrchestrator({ getPersonaById, ollamaChat }) {
  return async function orchestrateAttachment({ attachment, analysis, info }) {
    const pharmacius = getPersonaById("pharmacius");
    const fallback = buildAttachmentFallback({
      pharmacius,
      attachment,
      analysis,
      info,
    });

    if (!pharmacius || typeof ollamaChat !== "function") {
      return fallback;
    }

    try {
      const response = await ollamaChat(
        pharmacius.model,
        buildAttachmentPrompt(pharmacius, attachment, analysis, info),
        () => {}
      );
      const parsed = extractJsonBlock(response);
      return normalizeAttachmentBrief(parsed, fallback);
    } catch {
      return fallback;
    }
  };
}

module.exports = {
  createPharmaciusGenerator,
  createPharmaciusAttachmentOrchestrator,
};
