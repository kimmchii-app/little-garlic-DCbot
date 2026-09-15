// Workers 沒有檔案系統，不能像 Node 那樣掃資料夾自動載入。
// 新增指令 = 在這裡多 import 一行、多加進陣列。
// /help 會自動列出這份清單，不必另外維護。
import * as ping from './ping.js';
import * as help from './help.js';
import * as configSheet from './config-sheet.js';
import * as refreshSheet from './refresh-sheet.js';
import * as dbInfo from './db-info.js';
import * as logView from './log-view.js';
import * as persona from './persona.js';
import * as addPersona from './add-persona.js';
import * as editPersona from './edit-persona.js';
import * as deletePersona from './delete-persona.js';

const modules = [
  ping,
  help,
  configSheet,
  refreshSheet,
  dbInfo,
  logView,
  persona,
  addPersona,
  editPersona,
  deletePersona,
];

export const commandList = modules.map((m) => m.data);

export const commands = new Map(modules.map((m) => [m.data.name, m]));

// 讓 /help 列出實際註冊的指令。用注入而不是讓 help.js 反向 import 這裡，
// 否則會形成循環相依，且能不能跑取決於模組載入順序。
help.setCommandNames(commandList.map((c) => c.name));
