import type { CommandContext, CommandHandlerDeps } from "./ws-commands-types.js";
import { CHAT_COMMANDS, createChatCommandHandler } from "./ws-commands-chat.js";
import { GENERATE_COMMANDS, createGenerateCommandHandler } from "./ws-commands-generate.js";
import { INFO_COMMANDS, createInfoCommandHandler } from "./ws-commands-info.js";

// Re-export types for consumers
export type { CommandContext, CommandHandlerDeps } from "./ws-commands-types.js";

export function createCommandHandler(deps: CommandHandlerDeps) {
  const chatHandler = createChatCommandHandler(deps);
  const generateHandler = createGenerateCommandHandler(deps);
  const infoHandler = createInfoCommandHandler(deps);

  return async function handleCommand({ ws, info, text }: CommandContext): Promise<void> {
    const cmd = text.trim().split(/\s+/)[0]?.toLowerCase();

    if (CHAT_COMMANDS.has(cmd)) return chatHandler({ ws, info, text });
    if (GENERATE_COMMANDS.has(cmd)) return generateHandler({ ws, info, text });
    if (INFO_COMMANDS.has(cmd)) return infoHandler({ ws, info, text });

    deps.send(ws, { type: "system", text: `Commande inconnue: ${cmd}. Tape /help.` });
  };
}
