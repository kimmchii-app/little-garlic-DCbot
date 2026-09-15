// Discord 互動回應的組裝工具。
// Worker 回給 Discord 的一律是 JSON，格式由 type 決定 Discord 怎麼呈現。
import { InteractionResponseType } from 'discord-interactions';

/** 只有觸發者看得到的訊息旗標 */
export const EPHEMERAL = 1 << 6;

export function json(data, init = {}) {
  return new Response(JSON.stringify(data), {
    ...init,
    headers: { 'content-type': 'application/json; charset=utf-8', ...init.headers },
  });
}

/** 直接回一則訊息（必須在 3 秒內送出） */
export function reply(data, { ephemeral = false } = {}) {
  const payload = typeof data === 'string' ? { content: data } : { ...data };
  if (ephemeral) payload.flags = (payload.flags ?? 0) | EPHEMERAL;
  return json({ type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE, data: payload });
}

/**
 * 回「處理中…」佔位訊息，把 3 秒限制延長到 15 分鐘。
 * 真正的工作丟進 ctx.waitUntil()，做完再用 editOriginal() 覆蓋這則訊息。
 */
export function deferred({ ephemeral = false } = {}) {
  return json({
    type: InteractionResponseType.DEFERRED_CHANNEL_MESSAGE_WITH_SOURCE,
    data: ephemeral ? { flags: EPHEMERAL } : {},
  });
}

/** 更新按鈕所在的那則訊息本身（例如把按鈕改成已選取狀態） */
export function updateMessage(data) {
  return json({ type: InteractionResponseType.UPDATE_MESSAGE, data });
}

/** 從斜線指令的參數裡取值 */
export function option(interaction, name, fallback = null) {
  const found = interaction.data?.options?.find((o) => o.name === name);
  return found?.value ?? fallback;
}

/** 自動完成事件裡，使用者正在打字的那個參數 */
export function focusedOption(interaction) {
  const found = interaction.data?.options?.find((o) => o.focused);
  return { name: found?.name ?? '', value: String(found?.value ?? '') };
}

/**
 * 自動完成的選項清單。
 * Discord 限制最多 25 筆，name 與 value 各上限 100 字元。
 */
export function autocompleteChoices(choices) {
  return json({
    type: InteractionResponseType.APPLICATION_COMMAND_AUTOCOMPLETE_RESULT,
    data: { choices: choices.slice(0, 25) },
  });
}
