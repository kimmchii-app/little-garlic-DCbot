import { reply } from '../lib/respond.js';

export const data = {
  name: 'ping',
  description: '測試機器人是否正常運作',
};

export async function execute(interaction) {
  return reply('Pong! 小蒜頭活得好好的 🧄', { ephemeral: true });
}
