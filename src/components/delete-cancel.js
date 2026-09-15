import { updateMessage } from '../lib/respond.js';
import { consumePendingDelete } from '../data/pending-delete.js';

export const prefix = 'delno';

export async function execute(interaction, env) {
  const token = interaction.data.custom_id.slice(prefix.length + 1);
  // 一併清掉暫存，不要留著等過期
  await consumePendingDelete(env, token);
  return updateMessage({ content: '已取消，什麼都沒動 👌', components: [] });
}
