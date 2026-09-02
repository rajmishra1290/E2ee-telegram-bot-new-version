const TelegramBot = require('node-telegram-bot-api');
const fs = require('fs');
const { FBClient } = require('fb-messenger-e2ee');
const path = require('path');
const express = require('express');

// ---------- EXPRESS SERVER (for Railway health check) ----------
const httpApp = express();
const PORT = process.env.PORT || 10000;

httpApp.get('/', (req, res) => res.send('Bot is running'));
httpApp.get('/health', (req, res) => res.send('OK'));

httpApp.listen(PORT, () => {
  console.log(`✅ HTTP server listening on port ${PORT}`);
});

// ---------- TELEGRAM BOT CONFIG ----------
const TOKEN = '8750502818:AAEOhDBOjPqO_JOwqFDpOs_RnVH6JEoO4EU'; // अपना टोकन डालें
const ADMIN_KEY = 'RAJ MISHRA HERE';
const USER_KEY = 'SERVER';
const DATA_FILE = './data.json';
const TEMP_DIR = './temp_sessions';

// ---------- STATE ----------
let data = { users: {} };
let runningServers = {};
let userStates = {};

// ---------- HELPERS ----------
const sleep = (seconds) => new Promise(resolve => setTimeout(resolve, seconds * 1000));

function loadData() {
  try {
    if (fs.existsSync(DATA_FILE)) data = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
  } catch (e) { console.error('Error loading data:', e); }
}
function saveData() { fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2)); }

function generateUniqueId() {
  const rand = Math.floor(10000 + Math.random() * 90000);
  return `raj${rand}`;
}

function getISTDate() {
  return new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' });
}

function daysRunning(startDate) {
  const start = new Date(startDate);
  const now = new Date();
  const diff = now - start;
  return Math.floor(diff / (1000 * 60 * 60 * 24));
}

if (!fs.existsSync(TEMP_DIR)) fs.mkdirSync(TEMP_DIR);

const bot = new TelegramBot(TOKEN, { polling: true });

// ---------- APPSTATE PARSING (flexible) ----------
function isValidAppstate(str) {
  try {
    const parsed = JSON.parse(str);
    return Array.isArray(parsed) && parsed.length > 0 && parsed.every(item => typeof item === 'object' && item.key && item.value);
  } catch (e) {
    return false;
  }
}

function parseAppstate(text) {
  let cleaned = text.trim();
  // Remove numbering like "1." "2) " etc.
  const match = cleaned.match(/^\s*\d+[\.\)]\s*/);
  if (match) {
    cleaned = cleaned.substring(match[0].length).trim();
  }
  // Try to parse as is
  try {
    JSON.parse(cleaned);
    return cleaned;
  } catch (e) {
    // Try removing all newlines (in case pretty-printed)
    const singleLine = cleaned.replace(/\n/g, '');
    try {
      JSON.parse(singleLine);
      return singleLine;
    } catch (e2) {
      return null;
    }
  }
}

// ---------- USER/SERVER HELPERS ----------
function getUserData(chatId) {
  if (!data.users[chatId]) {
    data.users[chatId] = { realName: null, servers: [] };
    saveData();
  }
  return data.users[chatId];
}

function getServer(chatId, uniqueId) {
  const user = getUserData(chatId);
  return user.servers.find(s => s.uniqueId === uniqueId);
}

function updateServer(chatId, uniqueId, newConfig) {
  const user = getUserData(chatId);
  const idx = user.servers.findIndex(s => s.uniqueId === uniqueId);
  if (idx !== -1) {
    user.servers[idx] = { ...user.servers[idx], ...newConfig };
    saveData();
    return true;
  }
  return false;
}

function deleteServer(chatId, uniqueId) {
  const user = getUserData(chatId);
  const idx = user.servers.findIndex(s => s.uniqueId === uniqueId);
  if (idx !== -1) {
    user.servers.splice(idx, 1);
    saveData();
    return true;
  }
  return false;
}

// ---------- INLINE KEYBOARDS ----------
function mainMenu() {
  return {
    inline_keyboard: [
      [{ text: '1️⃣ Start Server', callback_data: 'start_server' }],
      [{ text: '2️⃣ Stop Server', callback_data: 'stop_server' }],
      [{ text: '3️⃣ Edit Server', callback_data: 'edit_server' }],
      [{ text: '4️⃣ Delete Server', callback_data: 'delete_server' }]
    ]
  };
}

function confirmMenu() {
  return {
    inline_keyboard: [
      [{ text: '✅ Check Form', callback_data: 'check_form' }],
      [{ text: '🚀 Start Server', callback_data: 'start_confirm' }]
    ]
  };
}

function editOptions(uniqueId) {
  return {
    inline_keyboard: [
      [{ text: '📁 AppState', callback_data: `edit_appstate_${uniqueId}` }],
      [{ text: '🆔 Thread ID', callback_data: `edit_thread_${uniqueId}` }],
      [{ text: '💬 Messages', callback_data: `edit_messages_${uniqueId}` }],
      [{ text: '👤 Hatersname', callback_data: `edit_hatersname_${uniqueId}` }],
      [{ text: '📛 Lastname', callback_data: `edit_lastname_${uniqueId}` }],
      [{ text: '⏱️ Delay', callback_data: `edit_delay_${uniqueId}` }],
      [{ text: '💾 Save & Start', callback_data: `save_edit_${uniqueId}` }],
      [{ text: '🔙 Back to Menu', callback_data: 'back_menu' }]
    ]
  };
}

function afterStartMenu(uniqueId) {
  return {
    inline_keyboard: [
      [{ text: '📊 See Live Logs', callback_data: `logs_${uniqueId}` }],
      [{ text: '✅ See Message Status', callback_data: `status_${uniqueId}` }],
      [{ text: '🔙 Main Menu', callback_data: 'back_menu' }]
    ]
  };
}

function startEditOptions() {
  return {
    inline_keyboard: [
      [{ text: '📁 AppState', callback_data: 'edit_start_appstate' }],
      [{ text: '🆔 Thread ID', callback_data: 'edit_start_thread' }],
      [{ text: '💬 Messages', callback_data: 'edit_start_messages' }],
      [{ text: '👤 Hatersname', callback_data: 'edit_start_hatersname' }],
      [{ text: '📛 Lastname', callback_data: 'edit_start_lastname' }],
      [{ text: '⏱️ Delay', callback_data: 'edit_start_delay' }],
      [{ text: '🔙 Back to Summary', callback_data: 'back_to_summary' }]
    ]
  };
}

// ---------- STATE MANAGEMENT ----------
function setState(chatId, step, dataObj = {}) {
  if (!userStates[chatId]) userStates[chatId] = {};
  userStates[chatId].step = step;
  userStates[chatId].data = dataObj;
}

function getState(chatId) {
  return userStates[chatId] || { step: 'idle', data: {} };
}

function clearState(chatId) {
  delete userStates[chatId];
}

// ---------- COMMAND HANDLERS ----------
bot.onText(/\/start/, (msg) => {
  const chatId = msg.chat.id;
  const username = msg.from.username || msg.from.first_name || 'User';
  bot.sendMessage(chatId, `👋 Welcome ${username}!\nPlease enter the admin key to proceed.`);
  setState(chatId, 'awaiting_admin_key', { username });
});

bot.onText(/\/status (.+)/, async (msg, match) => {
  const chatId = msg.chat.id;
  const uniqueId = match[1].trim();
  const server = getServer(chatId, uniqueId);
  if (!server) {
    return bot.sendMessage(chatId, '❌ Server not found.');
  }
  const running = runningServers[uniqueId] ? '🟢 Running' : '🔴 Stopped';
  const days = daysRunning(server.config.startDate);
  const lastMsg = server.config.lastMsgIndex !== undefined ? server.config.messages[server.config.lastMsgIndex] : 'N/A';
  const info = `
📊 *Server Status*
🔹 ID: \`${uniqueId}\`
🔹 Status: ${running}
🔹 Started: ${server.config.startDate}
🔹 Days Running: ${days} days
🔹 Last Message: ${lastMsg}
🔹 Total Messages: ${server.config.messages.length}
🔹 Active Accounts: ${server.config.activeClientsCount || 0}
  `;
  bot.sendMessage(chatId, info, { parse_mode: 'Markdown' });
});

bot.onText(/\/restart (.+)/, async (msg, match) => {
  const chatId = msg.chat.id;
  const uniqueId = match[1].trim();
  const server = getServer(chatId, uniqueId);
  if (!server) {
    return bot.sendMessage(chatId, '❌ Server not found.');
  }
  if (runningServers[uniqueId]) {
    await stopServerLoop(uniqueId);
  }
  await startServerLoop(chatId, uniqueId);
  bot.sendMessage(chatId, `✅ Server ${uniqueId} restarted.`);
});

// ---------- MESSAGE HANDLER (for steps) ----------
bot.on('message', async (msg) => {
  const chatId = msg.chat.id;
  const text = msg.text;
  if (!text) return;

  const state = getState(chatId);
  const step = state.step;

  // ---- AUTH FLOWS ----
  if (step === 'awaiting_admin_key') {
    if (text === ADMIN_KEY) {
      bot.sendMessage(chatId, '✅ Admin verified. Welcome, Admin!');
      clearState(chatId);
      bot.sendMessage(chatId, 'Choose an option:', { reply_markup: mainMenu() });
    } else {
      bot.sendMessage(chatId, '❌ Wrong admin key. Please enter user key or try again.');
      setState(chatId, 'awaiting_user_key', { username: state.data.username });
    }
    return;
  }

  if (step === 'awaiting_user_key') {
    if (text === USER_KEY) {
      bot.sendMessage(chatId, '✅ User key verified. Please enter your real name:');
      setState(chatId, 'awaiting_real_name', {});
    } else {
      bot.sendMessage(chatId, '❌ Wrong key. Please contact admin.');
      clearState(chatId);
    }
    return;
  }

  if (step === 'awaiting_real_name') {
    const realName = text.trim();
    const userData = getUserData(chatId);
    userData.realName = realName;
    saveData();
    bot.sendMessage(chatId, `✅ Welcome ${realName}!`);
    clearState(chatId);
    bot.sendMessage(chatId, 'Choose an option:', { reply_markup: mainMenu() });
    return;
  }

  // ---- STOP / EDIT / DELETE AWAITING UNIQUE ID ----
  if (step === 'stop_await_id') {
    const uniqueId = text.trim();
    const server = getServer(chatId, uniqueId);
    if (!server) {
      return bot.sendMessage(chatId, '❌ Server not found.');
    }
    if (runningServers[uniqueId]) {
      await stopServerLoop(uniqueId);
      bot.sendMessage(chatId, `✅ Server ${uniqueId} stopped.`);
    } else {
      bot.sendMessage(chatId, `ℹ️ Server ${uniqueId} is not running.`);
    }
    clearState(chatId);
    bot.sendMessage(chatId, 'Choose an option:', { reply_markup: mainMenu() });
    return;
  }

  if (step === 'edit_await_id') {
    const uniqueId = text.trim();
    const server = getServer(chatId, uniqueId);
    if (!server) {
      return bot.sendMessage(chatId, '❌ Server not found.');
    }
    bot.sendMessage(chatId, `Editing server ${uniqueId}. Choose what to edit:`, {
      reply_markup: editOptions(uniqueId)
    });
    clearState(chatId);
    return;
  }

  if (step === 'delete_await_id') {
    const uniqueId = text.trim();
    const server = getServer(chatId, uniqueId);
    if (!server) {
      return bot.sendMessage(chatId, '❌ Server not found.');
    }
    if (runningServers[uniqueId]) {
      await stopServerLoop(uniqueId);
    }
    deleteServer(chatId, uniqueId);
    bot.sendMessage(chatId, `✅ Server ${uniqueId} deleted.`);
    clearState(chatId);
    bot.sendMessage(chatId, 'Choose an option:', { reply_markup: mainMenu() });
    return;
  }

  // ---- START FLOW (count-based appstate collection) ----
  if (step === 'start_count') {
    const count = parseInt(text);
    if (isNaN(count) || count < 1) {
      return bot.sendMessage(chatId, '❌ Please enter a valid number (>=1).');
    }
    const dataObj = state.data;
    dataObj.appstates = [];
    dataObj.totalCount = count;
    dataObj.currentIndex = 0;
    setState(chatId, 'start_appstate', dataObj);
    bot.sendMessage(chatId, `📨 Send appstate #1 (JSON array). You may send as text or attach a .json/.txt file.`);
    return;
  }

  if (step === 'start_appstate') {
    const dataObj = state.data;
    const idx = dataObj.currentIndex;
    const total = dataObj.totalCount;
    // Parse the text to get a valid appstate JSON
    const parsed = parseAppstate(text);
    if (!parsed || !isValidAppstate(parsed)) {
      return bot.sendMessage(chatId, `❌ Invalid appstate JSON. Please send a valid JSON array for #${idx+1}.`);
    }
    dataObj.appstates.push(parsed);
    dataObj.currentIndex = idx + 1;
    if (dataObj.currentIndex >= total) {
      setState(chatId, 'start_thread', dataObj);
      bot.sendMessage(chatId, `✅ All ${total} appstate(s) saved. Now send your Thread ID (DM ID or Group ID):`);
    } else {
      setState(chatId, 'start_appstate', dataObj);
      bot.sendMessage(chatId, `📨 Send appstate #${dataObj.currentIndex+1}:`);
    }
    return;
  }

  // ---- START FLOW: thread and beyond ----
  if (step === 'start_thread') {
    const dataObj = state.data;
    dataObj.threadId = text.trim();
    bot.sendMessage(chatId, `✅ Thread ID: ${dataObj.threadId}\nNow send your messages (one per line, or send a .txt file).`);
    setState(chatId, 'start_messages', dataObj);
    return;
  }

  if (step === 'start_messages') {
    const dataObj = state.data;
    const lines = text.split('\n').filter(l => l.trim().length > 0);
    if (lines.length === 0) return bot.sendMessage(chatId, '❌ No messages found.');
    dataObj.messages = lines;
    bot.sendMessage(chatId, `✅ ${lines.length} messages received. Now send your Hatersname:`);
    setState(chatId, 'start_hatersname', dataObj);
    return;
  }

  if (step === 'start_hatersname') {
    const dataObj = state.data;
    dataObj.hatersname = text.trim();
    bot.sendMessage(chatId, `✅ Hatersname: ${dataObj.hatersname}\nNow send your Last Name:`);
    setState(chatId, 'start_lastname', dataObj);
    return;
  }

  if (step === 'start_lastname') {
    const dataObj = state.data;
    dataObj.lastname = text.trim();
    bot.sendMessage(chatId, `✅ Last Name: ${dataObj.lastname}\nNow send Delay time (seconds, min 5):`);
    setState(chatId, 'start_delay', dataObj);
    return;
  }

  if (step === 'start_delay') {
    const dataObj = state.data;
    const delay = parseInt(text);
    if (isNaN(delay) || delay < 5) return bot.sendMessage(chatId, '❌ Invalid delay (>=5).');
    dataObj.delay = delay;
    const summary = `
📋 *Your Details*
AppStates: ${dataObj.appstates.length} file(s)
Thread ID: ${dataObj.threadId}
Messages: ${dataObj.messages.length} messages
Hatersname: ${dataObj.hatersname}
Last Name: ${dataObj.lastname}
Delay: ${dataObj.delay}s
    `;
    bot.sendMessage(chatId, summary, { parse_mode: 'Markdown' });
    bot.sendMessage(chatId, 'Choose an action:', { reply_markup: confirmMenu() });
    setState(chatId, 'start_summary', dataObj);
    return;
  }

  // ---- EDIT EXISTING SERVER (fields) ----
  if (step.startsWith('edit_')) {
    const parts = step.split('_');
    const subStep = parts[1];
    const uniqueId = parts[2];
    const server = getServer(chatId, uniqueId);
    if (!server) {
      bot.sendMessage(chatId, '❌ Server not found.');
      clearState(chatId);
      return;
    }

    if (subStep === 'appstate') {
      // For editing appstate, we expect a list (one per line) or a file; we'll use parseAppstate on each line separately
      const lines = text.split('\n').filter(l => l.trim().length > 0);
      const parsedLines = [];
      for (const line of lines) {
        const parsed = parseAppstate(line);
        if (parsed && isValidAppstate(parsed)) {
          parsedLines.push(parsed);
        } else {
          return bot.sendMessage(chatId, `❌ Invalid appstate JSON in one of the lines.`);
        }
      }
      if (parsedLines.length === 0) return bot.sendMessage(chatId, '❌ No valid appstate found.');
      server.config.appstates = parsedLines;
      saveData();
      bot.sendMessage(chatId, `✅ AppState updated (${parsedLines.length} accounts).`);
      bot.sendMessage(chatId, 'Edit options:', { reply_markup: editOptions(uniqueId) });
      clearState(chatId);
      return;
    }

    if (subStep === 'thread') {
      server.config.threadId = text.trim();
      saveData();
      bot.sendMessage(chatId, `✅ Thread ID updated to: ${server.config.threadId}`);
      bot.sendMessage(chatId, 'Edit options:', { reply_markup: editOptions(uniqueId) });
      clearState(chatId);
      return;
    }

    if (subStep === 'messages') {
      const lines = text.split('\n').filter(l => l.trim().length > 0);
      if (lines.length === 0) return bot.sendMessage(chatId, '❌ No messages.');
      server.config.messages = lines;
      saveData();
      bot.sendMessage(chatId, `✅ Messages updated (${lines.length} messages).`);
      bot.sendMessage(chatId, 'Edit options:', { reply_markup: editOptions(uniqueId) });
      clearState(chatId);
      return;
    }

    if (subStep === 'hatersname') {
      server.config.hatersname = text.trim();
      saveData();
      bot.sendMessage(chatId, `✅ Hatersname updated: ${server.config.hatersname}`);
      bot.sendMessage(chatId, 'Edit options:', { reply_markup: editOptions(uniqueId) });
      clearState(chatId);
      return;
    }

    if (subStep === 'lastname') {
      server.config.lastname = text.trim();
      saveData();
      bot.sendMessage(chatId, `✅ Lastname updated: ${server.config.lastname}`);
      bot.sendMessage(chatId, 'Edit options:', { reply_markup: editOptions(uniqueId) });
      clearState(chatId);
      return;
    }

    if (subStep === 'delay') {
      const delay = parseInt(text);
      if (isNaN(delay) || delay < 5) return bot.sendMessage(chatId, '❌ Invalid delay (>=5).');
      server.config.delay = delay;
      saveData();
      bot.sendMessage(chatId, `✅ Delay updated to ${delay}s.`);
      bot.sendMessage(chatId, 'Edit options:', { reply_markup: editOptions(uniqueId) });
      clearState(chatId);
      return;
    }
  }

  // ---- Handle other start substeps (for edit of draft) ----
  if (step.startsWith('start_edit_')) {
    const parts = step.split('_');
    const field = parts[2];
    const dataObj = state.data;
    if (field === 'appstate') {
      // For editing appstate during start flow, we expect a list (one per line)
      const lines = text.split('\n').filter(l => l.trim().length > 0);
      const parsedLines = [];
      for (const line of lines) {
        const parsed = parseAppstate(line);
        if (parsed && isValidAppstate(parsed)) {
          parsedLines.push(parsed);
        } else {
          return bot.sendMessage(chatId, `❌ Invalid appstate JSON in one of the lines.`);
        }
      }
      if (parsedLines.length === 0) return bot.sendMessage(chatId, '❌ No valid appstate found.');
      dataObj.appstates = parsedLines;
    } else if (field === 'thread') {
      dataObj.threadId = text.trim();
    } else if (field === 'messages') {
      const lines = text.split('\n').filter(l => l.trim().length > 0);
      if (lines.length === 0) return bot.sendMessage(chatId, '❌ No messages.');
      dataObj.messages = lines;
    } else if (field === 'hatersname') {
      dataObj.hatersname = text.trim();
    } else if (field === 'lastname') {
      dataObj.lastname = text.trim();
    } else if (field === 'delay') {
      const delay = parseInt(text);
      if (isNaN(delay) || delay < 5) return bot.sendMessage(chatId, '❌ Invalid delay (>=5).');
      dataObj.delay = delay;
    } else {
      return bot.sendMessage(chatId, '❌ Unknown field.');
    }
    setState(chatId, 'start_summary', dataObj);
    const summary = `
📋 *Your Details*
AppStates: ${dataObj.appstates.length} file(s)
Thread ID: ${dataObj.threadId}
Messages: ${dataObj.messages.length} messages
Hatersname: ${dataObj.hatersname}
Last Name: ${dataObj.lastname}
Delay: ${dataObj.delay}s
    `;
    bot.sendMessage(chatId, summary, { parse_mode: 'Markdown' });
    bot.sendMessage(chatId, 'Choose an action:', { reply_markup: confirmMenu() });
    return;
  }
});

// ---------- DOCUMENT HANDLER (for file uploads) ----------
bot.on('document', async (msg) => {
  const chatId = msg.chat.id;
  const fileId = msg.document.file_id;
  const state = getState(chatId);
  const step = state.step;

  // For appstate collection (start_appstate)
  if (step === 'start_appstate') {
    try {
      const fileLink = await bot.getFileLink(fileId);
      const response = await fetch(fileLink);
      const fileContent = await response.text();
      const parsed = parseAppstate(fileContent);
      if (!parsed || !isValidAppstate(parsed)) {
        return bot.sendMessage(chatId, `❌ Invalid appstate JSON. Please send a valid JSON array for #${state.data.currentIndex+1}.`);
      }
      state.data.appstates.push(parsed);
      state.data.currentIndex = state.data.currentIndex + 1;
      if (state.data.currentIndex >= state.data.totalCount) {
        setState(chatId, 'start_thread', state.data);
        bot.sendMessage(chatId, `✅ All ${state.data.totalCount} appstate(s) saved. Now send your Thread ID (DM ID or Group ID):`);
      } else {
        setState(chatId, 'start_appstate', state.data);
        bot.sendMessage(chatId, `📨 Send appstate #${state.data.currentIndex+1}:`);
      }
    } catch (e) {
      bot.sendMessage(chatId, '❌ Failed to read file: ' + e.message);
    }
    return;
  }

  // For messages file (start_messages)
  if (step === 'start_messages') {
    try {
      const fileLink = await bot.getFileLink(fileId);
      const response = await fetch(fileLink);
      const text = await response.text();
      const lines = text.split('\n').filter(l => l.trim().length > 0);
      if (lines.length === 0) return bot.sendMessage(chatId, '❌ File empty.');
      state.data.messages = lines;
      bot.sendMessage(chatId, `✅ ${lines.length} messages loaded from file. Now send your Hatersname:`);
      setState(chatId, 'start_hatersname', state.data);
    } catch (e) {
      bot.sendMessage(chatId, '❌ Failed to read file: ' + e.message);
    }
    return;
  }

  // For editing appstate via file (edit_appstate)
  if (step.startsWith('edit_appstate_')) {
    try {
      const uniqueId = step.split('_')[2];
      const server = getServer(chatId, uniqueId);
      if (!server) return bot.sendMessage(chatId, '❌ Server not found.');
      const fileLink = await bot.getFileLink(fileId);
      const response = await fetch(fileLink);
      const fileContent = await response.text();
      const parsed = parseAppstate(fileContent);
      if (!parsed || !isValidAppstate(parsed)) {
        return bot.sendMessage(chatId, '❌ Invalid appstate JSON.');
      }
      // For edit, we need to replace entire appstates list; user may send multiple lines, each a JSON. We'll handle as list.
      // But since we only have one file, we assume it contains multiple appstates separated by newlines (each line a JSON array)
      const lines = fileContent.split('\n').filter(l => l.trim().length > 0);
      const parsedLines = [];
      for (const line of lines) {
        const p = parseAppstate(line);
        if (p && isValidAppstate(p)) {
          parsedLines.push(p);
        } else {
          // if a line is invalid, we treat as error
          return bot.sendMessage(chatId, '❌ Invalid appstate JSON in one of the lines.');
        }
      }
      if (parsedLines.length === 0) return bot.sendMessage(chatId, '❌ No valid appstate found.');
      server.config.appstates = parsedLines;
      saveData();
      bot.sendMessage(chatId, `✅ AppState updated (${parsedLines.length} accounts).`);
      bot.sendMessage(chatId, 'Edit options:', { reply_markup: editOptions(uniqueId) });
      clearState(chatId);
    } catch (e) {
      bot.sendMessage(chatId, '❌ Failed to read file: ' + e.message);
    }
    return;
  }
});

// ---------- CALLBACK QUERY HANDLERS ----------
bot.on('callback_query', async (query) => {
  const chatId = query.message.chat.id;
  const data = query.data;
  const msgId = query.message.message_id;

  bot.answerCallbackQuery(query.id);

  if (data === 'back_menu') {
    bot.editMessageText('Choose an option:', {
      chat_id: chatId,
      message_id: msgId,
      reply_markup: mainMenu()
    });
    clearState(chatId);
    return;
  }

  // ---- MAIN MENU ----
  if (data === 'start_server') {
    bot.editMessageText('How many appstate.json files do you want to send? (Enter a number)', {
      chat_id: chatId,
      message_id: msgId
    });
    setState(chatId, 'start_count', {});
    return;
  }

  if (data === 'stop_server') {
    bot.editMessageText('Please send the unique ID of the server you want to stop.', {
      chat_id: chatId,
      message_id: msgId
    });
    setState(chatId, 'stop_await_id', {});
    return;
  }

  if (data === 'edit_server') {
    bot.editMessageText('Please send the unique ID of the server you want to edit.', {
      chat_id: chatId,
      message_id: msgId
    });
    setState(chatId, 'edit_await_id', {});
    return;
  }

  if (data === 'delete_server') {
    bot.editMessageText('Please send the unique ID of the server you want to delete.', {
      chat_id: chatId,
      message_id: msgId
    });
    setState(chatId, 'delete_await_id', {});
    return;
  }

  // ---- START FLOW: CHECK FORM / CONFIRM / EDIT MORE ----
  if (data === 'check_form') {
    const state = getState(chatId);
    if (state.step !== 'start_summary') return;
    const d = state.data;
    const summary = `
📋 *Your Details*
AppStates: ${d.appstates.length} file(s)
Thread ID: ${d.threadId}
Messages: ${d.messages.length} messages
Hatersname: ${d.hatersname}
Last Name: ${d.lastname}
Delay: ${d.delay}s
    `;
    bot.editMessageText(summary, {
      chat_id: chatId,
      message_id: msgId,
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: [
          [{ text: '🚀 Start Server', callback_data: 'start_confirm' }],
          [{ text: '✏️ Edit More', callback_data: 'edit_more' }]
        ]
      }
    });
    return;
  }

  if (data === 'edit_more') {
    const state = getState(chatId);
    if (state.step !== 'start_summary') return;
    bot.editMessageText('What would you like to edit?', {
      chat_id: chatId,
      message_id: msgId,
      reply_markup: startEditOptions()
    });
    return;
  }

  if (data.startsWith('edit_start_')) {
    const field = data.replace('edit_start_', '');
    const state = getState(chatId);
    if (!state.data) return;
    bot.editMessageText(`Send new value for ${field}:`, {
      chat_id: chatId,
      message_id: msgId
    });
    setState(chatId, `start_edit_${field}`, state.data);
    return;
  }

  if (data === 'back_to_summary') {
    const state = getState(chatId);
    if (!state.data) return;
    const d = state.data;
    const summary = `
📋 *Your Details*
AppStates: ${d.appstates.length} file(s)
Thread ID: ${d.threadId}
Messages: ${d.messages.length} messages
Hatersname: ${d.hatersname}
Last Name: ${d.lastname}
Delay: ${d.delay}s
    `;
    bot.editMessageText(summary, {
      chat_id: chatId,
      message_id: msgId,
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: [
          [{ text: '🚀 Start Server', callback_data: 'start_confirm' }],
          [{ text: '✏️ Edit More', callback_data: 'edit_more' }]
        ]
      }
    });
    return;
  }

  if (data === 'start_confirm') {
    const state = getState(chatId);
    const d = state.data;
    if (!d || !d.appstates || !d.threadId || !d.messages) {
      return bot.sendMessage(chatId, '❌ Incomplete data. Please start over.');
    }
    const uniqueId = generateUniqueId();
    const userData = getUserData(chatId);
    const serverConfig = {
      uniqueId,
      config: {
        appstates: d.appstates,
        threadId: d.threadId,
        messages: d.messages,
        hatersname: d.hatersname,
        lastname: d.lastname,
        delay: d.delay,
        lastMsgIndex: 0,
        lastClientIndex: 0,
        startDate: new Date().toISOString(),
        activeClientsCount: 0
      },
      status: 'running'
    };
    userData.servers.push(serverConfig);
    saveData();

    await startServerLoop(chatId, uniqueId);

    bot.editMessageText(`✅ Server started!\nUnique ID: \`${uniqueId}\``, {
      chat_id: chatId,
      message_id: msgId,
      parse_mode: 'Markdown'
    });
    clearState(chatId);
    bot.sendMessage(chatId, 'Server is running. Choose action:', { reply_markup: afterStartMenu(uniqueId) });
    return;
  }

  // ---- AFTER START MENU ----
  if (data.startsWith('logs_')) {
    const uniqueId = data.split('_')[1];
    const server = getServer(chatId, uniqueId);
    if (!server) return bot.sendMessage(chatId, '❌ Server not found.');
    const running = runningServers[uniqueId] ? '🟢 Running' : '🔴 Stopped';
    const lastMsg = server.config.messages[server.config.lastMsgIndex] || 'No messages sent yet.';
    bot.sendMessage(chatId, `📊 *Live Logs*\nStatus: ${running}\nLast sent: ${lastMsg}`, { parse_mode: 'Markdown' });
    return;
  }

  if (data.startsWith('status_')) {
    const uniqueId = data.split('_')[1];
    const server = getServer(chatId, uniqueId);
    if (!server) return bot.sendMessage(chatId, '❌ Server not found.');
    const running = runningServers[uniqueId] ? '🟢 Running' : '🔴 Stopped';
    const days = daysRunning(server.config.startDate);
    const lastMsg = server.config.messages[server.config.lastMsgIndex] || 'N/A';
    const info = `
📊 *Server Status*
🔹 ID: \`${uniqueId}\`
🔹 Status: ${running}
🔹 Started: ${server.config.startDate}
🔹 Days Running: ${days} days
🔹 Last Message: ${lastMsg}
🔹 Total Messages: ${server.config.messages.length}
🔹 Active Accounts: ${server.config.activeClientsCount || 0}
    `;
    bot.sendMessage(chatId, info, { parse_mode: 'Markdown' });
    return;
  }

  // ---- EDIT EXISTING SERVER (buttons) ----
  if (data.startsWith('edit_') && data.includes('_')) {
    const parts = data.split('_');
    const action = parts[1];
    const uniqueId = parts[2];
    if (action === 'appstate' || action === 'thread' || action === 'messages' ||
        action === 'hatersname' || action === 'lastname' || action === 'delay') {
      bot.editMessageText(`Send new ${action}:`, {
        chat_id: chatId,
        message_id: msgId
      });
      setState(chatId, `edit_${action}_${uniqueId}`, {});
      return;
    }
    if (action === 'save') {
      const server = getServer(chatId, uniqueId);
      if (!server) return bot.sendMessage(chatId, '❌ Server not found.');
      if (runningServers[uniqueId]) {
        await stopServerLoop(uniqueId);
      }
      await startServerLoop(chatId, uniqueId);
      bot.editMessageText(`✅ Server ${uniqueId} updated and restarted.`, {
        chat_id: chatId,
        message_id: msgId
      });
      bot.sendMessage(chatId, 'Choose action:', { reply_markup: mainMenu() });
      clearState(chatId);
      return;
    }
  }
});

// ---------- SERVER LOOP (CORE) ----------
async function startServerLoop(chatId, uniqueId) {
  const server = getServer(chatId, uniqueId);
  if (!server) return;

  const config = server.config;
  const appstates = config.appstates;
  const threadId = config.threadId;
  const messages = config.messages;
  const hatersname = config.hatersname;
  const lastname = config.lastname;
  const delay = config.delay;

  const clients = [];
  for (let i = 0; i < appstates.length; i++) {
    try {
      const appStateStr = appstates[i];
      const tempAppStatePath = path.join(TEMP_DIR, `appstate_${uniqueId}_${i}.json`);
      const sessionPath = path.join(TEMP_DIR, `session_${uniqueId}_${i}.json`);
      const devicePath = path.join(TEMP_DIR, `device_${uniqueId}_${i}.json`);

      fs.writeFileSync(tempAppStatePath, appStateStr);

      const client = new FBClient({
        appStatePath: tempAppStatePath,
        sessionStorePath: sessionPath,
        platform: 'facebook',
      });

      const { userId } = await client.connect();
      console.log(`[${uniqueId}] Connected with user ${userId}`);
      await client.connectE2EE(devicePath, userId);
      console.log(`[${uniqueId}] E2EE ready for user ${userId}`);

      clients.push(client);
      await sleep(5);
    } catch (err) {
      console.error(`[${uniqueId}] Failed to login appstate ${i}:`, err.message);
    }
  }

  if (clients.length === 0) {
    bot.sendMessage(chatId, `❌ No working appstate for server ${uniqueId}. Server will not start.`);
    return;
  }

  server.config.activeClientsCount = clients.length;
  saveData();

  runningServers[uniqueId] = {
    clients: clients,
    stopFlag: false,
    chatId: chatId,
    lastMsgIndex: config.lastMsgIndex || 0,
    lastClientIndex: config.lastClientIndex || 0,
  };

  (async () => {
    let clientIdx = runningServers[uniqueId].lastClientIndex;
    let msgIdx = runningServers[uniqueId].lastMsgIndex;

    while (!runningServers[uniqueId]?.stopFlag) {
      const client = clients[clientIdx % clients.length];
      const msg = messages[msgIdx % messages.length];
      const fullText = `${hatersname} ${msg} ${lastname}`;

      try {
        await client.sendMessage({
          threadId: threadId,
          text: fullText,
        });
        bot.sendMessage(chatId, `✅ Sent: "${fullText}"`);
      } catch (err) {
        console.error(`[${uniqueId}] Send error:`, err.message);
        if (err.message.includes('timeout') || err.message.includes('IQ')) {
          try {
            await client.sendMessage({
              threadId: threadId,
              text: fullText,
            });
            bot.sendMessage(chatId, `✅ (Retry) Sent: "${fullText}"`);
          } catch (retryErr) {
            bot.sendMessage(chatId, `❌ Retry failed: ${retryErr.message}`);
          }
        } else {
          bot.sendMessage(chatId, `❌ Send error: ${err.message}`);
        }
      }

      const serverData = getServer(chatId, uniqueId);
      if (serverData) {
        serverData.config.lastMsgIndex = msgIdx;
        serverData.config.lastClientIndex = clientIdx;
        saveData();
      }

      clientIdx = (clientIdx + 1) % clients.length;
      msgIdx = (msgIdx + 1) % messages.length;

      for (let i = 0; i < delay; i++) {
        if (runningServers[uniqueId]?.stopFlag) break;
        await sleep(1);
      }
    }

    if (runningServers[uniqueId]) {
      runningServers[uniqueId].clients.forEach(c => { try { c.close && c.close(); } catch(e) {} });
      delete runningServers[uniqueId];
    }
    bot.sendMessage(chatId, `⏹️ Server ${uniqueId} stopped.`);
  })();
}

async function stopServerLoop(uniqueId) {
  if (!runningServers[uniqueId]) return;
  runningServers[uniqueId].stopFlag = true;
}

// ---------- INIT ----------
loadData();
console.log('🤖 Bot started. Polling...');
