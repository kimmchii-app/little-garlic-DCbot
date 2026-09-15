// 按鈕、下拉選單等元件的處理器，用 custom_id 的前綴分派。
// custom_id 慣例：`<prefix>:<參數>`，例如 `delok:<token>`
import * as deleteConfirm from './delete-confirm.js';
import * as deleteCancel from './delete-cancel.js';

const modules = [deleteConfirm, deleteCancel];

export const components = new Map(modules.map((m) => [m.prefix, m]));

export function resolveComponent(customId) {
  return components.get(customId.split(':')[0]);
}
