import { deferred, option } from '../lib/respond.js';
import { editOriginal } from '../lib/discord.js';
import { recentLogs, RETENTION_DAYS } from '../data/command-log.js';

const MANAGE_GUILD = 1 << 5;

export const data = {
  name: '使用紀錄',
  description: '看這個伺服器最近的指令使用紀錄',
  // 紀錄含所有成員的操作，不該讓一般成員互相查看
  default_member_permissions: String(MANAGE_GUILD),
  dm_permission: false,
  options: [
    {
      type: 4, // INTEGER
      name: '筆數',
      description: '要顯示幾筆（1–25，預設 10）',
      required: false,
      min_value: 1,
      max_value: 25,
    },
    {
      type: 3, // STRING
      name: '指令',
      description: '只看某個指令的紀錄',
      required: false,
      choices: [
        { name: '人設（查詢）', value: '人設' },
        { name: '新增人設', value: '新增人設' },
        { name: '修改人設', value: '修改人設' },
        { name: '設定資料庫', value: '設定資料庫' },
        { name: '重新整理資料庫', value: '重新整理資料庫' },
      ],
    },
  ],
};

export async function execute(interaction, env, ctx) {
  ctx.waitUntil(run(interaction, env));
  return deferred({ ephemeral: true });
}

async function run(interaction, env) {
  const say = (content) => editOriginal(env, interaction.token, { content }).catch(() => {});

  const limit = option(interaction, '筆數', 10);
  const command = option(interaction, '指令');

  try {
    const rows = await recentLogs(env, interaction.guild_id, { limit, command });

    if (rows.length === 0) {
      return say(command ? `還沒有 \`/${command}\` 的使用紀錄 📭` : '還沒有任何使用紀錄 📭');
    }

    // 用 Discord 的時間戳記格式，會自動依每個人的時區顯示
    const lines = rows.map((r) => {
      const who = r.user_id ? `<@${r.user_id}>` : r.user_name || '未知';
      const detail = r.detail ? `\n　　${r.detail}` : '';
      return `<t:${r.created_at}:f>　\`/${r.command}\`　${who}${detail}`;
    });

    await editOriginal(env, interaction.token, {
      embeds: [
        {
          title: `📜 使用紀錄${command ? `：/${command}` : ''}`,
          description: lines.join('\n\n').slice(0, 4000),
          color: 0x5865f2,
          footer: {
            text: `${rows.length} 筆　|　${rows[0].guild_name || interaction.guild_id}　|　紀錄保留 ${RETENTION_DAYS} 天`,
          },
        },
      ],
    });
  } catch (error) {
    console.error('查詢使用紀錄失敗：', error);
    return say('查詢出了點狀況，等一下再試試 🙏');
  }
}
