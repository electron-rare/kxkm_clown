const { MAX_UPLOAD_BYTES, getAcceptedMimeTypes, pickAttachmentKind, assertSupportedUpload, analyzeAttachment } = require("./attachment-pipeline");

function createAttachmentService({
  attachmentStore,
  getSession,
  clients,
  broadcastAll,
  enqueueChannel,
  handleAttachmentAnalysis,
  orchestrateAttachment,
  rememberAttachmentUpload,
  rememberAttachmentAnalysis,
  rememberAttachmentFailure,
}) {
  function ensureUploadToken(session) {
    if (!session.uploadToken) {
      session.uploadToken = `upl_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
    }
    return session.uploadToken;
  }

  function buildUploadCapability(info, session = getSession(info.sessionId)) {
    return {
      type: "upload_capability",
      sessionId: info.sessionId,
      channel: info.channel,
      uploadToken: ensureUploadToken(session),
      maxUploadBytes: MAX_UPLOAD_BYTES,
      acceptedMimeTypes: getAcceptedMimeTypes(),
      acceptedKinds: ["text", "image", "audio"],
    };
  }

  function findUploadContext(sessionId, uploadToken) {
    if (!sessionId || !uploadToken) return null;

    const session = getSession(sessionId);
    if (!session || ensureUploadToken(session) !== uploadToken) return null;

    for (const [, info] of clients) {
      if (info.sessionId === sessionId) {
        return { info: { ...info }, session };
      }
    }

    return null;
  }

  async function ingestAttachment({ sessionId, uploadToken, fileName, mime, buffer }) {
    const context = findUploadContext(sessionId, uploadToken);
    if (!context) {
      const error = new Error("Session d'upload invalide ou expirée");
      error.statusCode = 403;
      throw error;
    }

    const kind = assertSupportedUpload({
      mime,
      fileName,
      sizeBytes: buffer.length,
    });

    const record = attachmentStore.createAttachmentRecord({
      sessionId,
      nick: context.info.nick,
      channel: context.info.channel,
      kind: pickAttachmentKind(mime, fileName) || kind,
      mime,
      originalName: fileName,
      buffer,
    });

    const clientAttachment = attachmentStore.toClientAttachment(record);
    broadcastAll(context.info.channel, {
      type: "attachment_uploaded",
      attachment: clientAttachment,
    });
    if (typeof rememberAttachmentUpload === "function") {
      rememberAttachmentUpload(context.info.channel, clientAttachment);
    }

    void processAttachment(record.id, context.info).catch((error) => {
      const failed = attachmentStore.updateAttachment(record.id, {
        status: "failed",
        error: {
          message: error.message,
        },
      });
      const clientFailedAttachment = attachmentStore.toClientAttachment(failed);

      broadcastAll(context.info.channel, {
        type: "attachment_failed",
        attachment: clientFailedAttachment,
        error: error.message,
      });
      if (typeof rememberAttachmentFailure === "function") {
        rememberAttachmentFailure(context.info.channel, clientFailedAttachment, error.message);
      }
    });

    return clientAttachment;
  }

  async function processAttachment(id, info) {
    const current = attachmentStore.getAttachment(id);
    if (!current) return;

    attachmentStore.updateAttachment(id, { status: "extracting", error: null });

    const buffer = attachmentStore.readAttachmentBuffer(id);
    if (!buffer) {
      throw new Error("Pièce jointe introuvable sur disque");
    }

    const analysis = await analyzeAttachment(current, buffer);
    const readyRecord = attachmentStore.updateAttachment(id, {
      status: "ready",
      analysis,
      error: null,
    });

    const orchestrated = await orchestrateAttachment({
      attachment: readyRecord,
      analysis,
      info,
    });

    const clientAttachment = attachmentStore.toClientAttachment(readyRecord);
    broadcastAll(info.channel, {
      type: "attachment_analysis",
      attachment: clientAttachment,
      summary: orchestrated.summary,
      generator: orchestrated.generator,
      warnings: orchestrated.warnings || [],
    });
    if (typeof rememberAttachmentAnalysis === "function") {
      rememberAttachmentAnalysis(info.channel, clientAttachment, orchestrated);
    }

    if (typeof handleAttachmentAnalysis === "function") {
      await enqueueChannel(info.channel, () => handleAttachmentAnalysis(info, readyRecord, analysis, orchestrated));
    }
  }

  function getAttachment(id) {
    return attachmentStore.getAttachment(id);
  }

  function getClientAttachment(id) {
    return attachmentStore.toClientAttachment(getAttachment(id));
  }

  function readAttachmentBuffer(id) {
    return attachmentStore.readAttachmentBuffer(id);
  }

  return {
    buildUploadCapability,
    ingestAttachment,
    getAttachment,
    getClientAttachment,
    readAttachmentBuffer,
  };
}

module.exports = {
  createAttachmentService,
};
