const express = require("express");
const axios = require("axios");
const fs = require("fs");
const path = require("path");

const app = express();
app.use(express.json());

// ENV variables from Railway
const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;
const OPENAI_KEY = process.env.OPENAI_KEY;
const TELEGRAM_URL = `https://api.telegram.org/bot${TELEGRAM_TOKEN}`;

// Paths for JSON memory
const DATA_DIR = path.join(__dirname, "data");
const MEMORY_FILE = path.join(DATA_DIR, "memory.json");

// Ensure data directory exists
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

// Load memory from JSON
let memory = {
  assets: [],   // [{ name, ip, cluster, dc, owner, status, criticality, env }]
  tasks: []     // [{ text, date }]
};

function loadMemory() {
  try {
    if (fs.existsSync(MEMORY_FILE)) {
      const raw = fs.readFileSync(MEMORY_FILE, "utf8");
      memory = JSON.parse(raw);
      log("Memory loaded from JSON");
    } else {
      saveMemory();
      log("Memory file created");
    }
  } catch (e) {
    console.error("Error loading memory:", e.message);
  }
}

function saveMemory() {
  try {
    fs.writeFileSync(MEMORY_FILE, JSON.stringify(memory, null, 2), "utf8");
    log("Memory saved to JSON");
  } catch (e) {
    console.error("Error saving memory:", e.message);
  }
}

function log(msg) {
  console.log(`[Hermes LOG] ${msg}`);
}

// Initialize memory on start
loadMemory();

// Helper to send messages
async function send(chatId, text) {
  await axios.post(`${TELEGRAM_URL}/sendMessage`, {
    chat_id: chatId,
    text,
    parse_mode: "Markdown"
  });
}

// Normalize asset name (simple)
function normalizeName(name) {
  return name.trim().toLowerCase();
}

// Webhook endpoint
app.post("/webhook", async (req, res) => {
  const message = req.body.message;
  if (!message || !message.text) return res.sendStatus(200);

  const chatId = message.chat.id;
  const userText = message.text.trim();

  log(`Incoming message: ${userText}`);

  // Detect language (RU or EN)
  const isRussian = /[а-яА-Я]/.test(userText);

  // Hermes Passport (system prompt)
  const hermesPassportRU = `
Ты — профессиональный AI‑агент Hermes.
Отвечай на русском языке.
Работаешь структурировано, коротко, по делу.
Ты — корпоративный ассистент Eleonora (Project Manager по аудитам, SOC2, DORA, PCI DSS).

Твоя должность:
AI‑инвентаризатор активов и помощник по аудиту.

Цель работы:
Автоматизировать рутинные задачи Eleonora:
- вести учёт активов;
- обновлять таблицы;
- формировать отчёты;
- помогать в подготовке к аудитам;
- структурировать данные;
- уточнять статусы;
- поддерживать Jira‑структуры.

Рабочие правила:
1. Не придумывай факты.
2. Не меняй данные без подтверждения.
3. Если данных мало — уточняй.
4. Всегда отвечай структурно.
5. Используй Markdown‑таблицы.
6. Логируй каждое действие в консоль Railway.
7. Если команда начинается с "/" — выполняй скилл.
8. Если текстовая задача — анализируй и выполняй.
9. Всегда уточняй, если задача неполная.
10. Не игнорируй контекст предыдущих сообщений.

Скиллы:
- /help — показать список команд.
- /add — добавить актив.
- /list — показать список активов.
- /update — обновить статус актива.
- /report — сформировать отчёт по активам.
- /status — сводка по состояниям.
- /find — найти актив.
- /audit — помощь с SOC2 / PCI DSS / DORA.
- /jira — помощь со структурами Jira.

Память:
Ты хранишь список активов, статусы, последние задачи и контекст аудита.
  `;

  const hermesPassportEN = `
You are Hermes — a professional AI agent.
Respond in English.
You work structured, concise, and professional.
You are Eleonora's corporate assistant (Project Manager for audits, SOC2, DORA, PCI DSS).

Your role:
AI asset inventory agent and audit assistant.

Your mission:
Automate Eleonora's repetitive tasks:
- maintain asset inventory;
- update tables;
- generate reports;
- assist with audit preparation;
- structure data;
- clarify statuses;
- support Jira structures.

Rules:
1. Never invent facts.
2. Never change data without confirmation.
3. If data is missing — ask.
4. Always respond structurally.
5. Use Markdown tables.
6. Log every action to Railway console.
7. If command starts with "/" — execute skill.
8. If it's a task — analyze and perform.
9. Always clarify incomplete tasks.
10. Never ignore previous context.

Skills:
- /help — show commands.
- /add — add asset.
- /list — show assets.
- /update — update asset status.
- /report — generate asset report.
- /status — status summary.
- /find — find asset.
- /audit — help with SOC2 / PCI DSS / DORA.
- /jira — help with Jira structures.

Memory:
You store asset list, statuses, last tasks, audit context.
  `;

  const systemPrompt = isRussian ? hermesPassportRU : hermesPassportEN;

  // ---------- COMMANDS ----------

  // /help
  if (userText.startsWith("/help")) {
    const helpText = isRussian
      ? `
Доступные команды Hermes:

/help — показать список команд.
/add <name> — добавить актив (минимум имя).
/list — показать список активов.
/update <name> <status> — обновить статус актива.
/report — сформировать отчёт по активам.
/status — сводка по состояниям.
/find <name> — найти актив по имени.
/audit — помощь с задачами SOC2 / PCI DSS / DORA.
/jira — помощь со структурами Jira.

Пиши обычным текстом, если хочешь дать задачу, а не команду.
      `
      : `
Available Hermes commands:

/help — show this help.
/add <name> — add asset (at least name).
/list — show asset list.
/update <name> <status> — update asset status.
/report — generate asset report.
/status — status summary.
/find <name> — find asset by name.
/audit — help with SOC2 / PCI DSS / DORA.
/jira — help with Jira structures.

Use plain text if you want to give a task, not a command.
      `;
    log("Help requested");
    await send(chatId, helpText);
    return res.sendStatus(200);
  }

  // /add <name>
  if (userText.startsWith("/add")) {
    const parts = userText.split(" ").slice(1);
    const name = parts[0];
    if (!name) {
      const msg = isRussian
        ? "Укажи имя актива: `/add server01`"
        : "Provide asset name: `/add server01`";
      await send(chatId, msg);
      return res.sendStatus(200);
    }
    const normalized = normalizeName(name);
    const existing = memory.assets.find(a => a.name === normalized);
    if (existing) {
      const msg = isRussian
        ? `Актив **${name}** уже существует.`
        : `Asset **${name}** already exists.`;
      await send(chatId, msg);
      return res.sendStatus(200);
    }
    memory.assets.push({
      name: normalized,
      status: "new",
      ip: null,
      cluster: null,
      dc: null,
      owner: null,
      criticality: null,
      env: null
    });
    saveMemory();
    log(`Added asset: ${normalized}`);
    const msg = isRussian
      ? `Актив **${name}** добавлен со статусом \`new\`.`
      : `Asset **${name}** added with status \`new\`.`;
    await send(chatId, msg);
    return res.sendStatus(200);
  }

  // /list
  if (userText.startsWith("/list")) {
    if (memory.assets.length === 0) {
      const msg = isRussian
        ? "Список активов пуст."
        : "Asset list is empty.";
      await send(chatId, msg);
      return res.sendStatus(200);
    }
    let table = isRussian
      ? "| Актив | Статус | Кластер | DC |\n|-------|--------|---------|----|\n"
      : "| Asset | Status | Cluster | DC |\n|-------|--------|---------|----|\n";
    memory.assets.forEach(a => {
      table += `| ${a.name} | ${a.status || "-"} | ${a.cluster || "-"} | ${a.dc || "-"} |\n`;
    });
    await send(chatId, table);
    return res.sendStatus(200);
  }

  // /update <name> <status>
  if (userText.startsWith("/update")) {
    const parts = userText.split(" ").slice(1);
    const name = parts[0];
    const status = parts[1];
    if (!name || !status) {
      const msg = isRussian
        ? "Используй: `/update server01 active`"
        : "Use: `/update server01 active`";
      await send(chatId, msg);
      return res.sendStatus(200);
    }
    const normalized = normalizeName(name);
    const asset = memory.assets.find(a => a.name === normalized);
    if (!asset) {
      const msg = isRussian
        ? "Актив не найден."
        : "Asset not found.";
      await send(chatId, msg);
      return res.sendStatus(200);
    }
    asset.status = status;
    saveMemory();
    log(`Updated asset ${normalized} → ${status}`);
    const msg = isRussian
      ? `Статус актива **${name}** обновлён на **${status}**.`
      : `Status of asset **${name}** updated to **${status}**.`;
    await send(chatId, msg);
    return res.sendStatus(200);
  }

  // /status
  if (userText.startsWith("/status")) {
    const counts = {};
    memory.assets.forEach(a => {
      const s = a.status || "unknown";
      counts[s] = (counts[s] || 0) + 1;
    });
    if (Object.keys(counts).length === 0) {
      const msg = isRussian
        ? "Нет данных по статусам."
        : "No status data.";
      await send(chatId, msg);
      return res.sendStatus(200);
    }
    let table = isRussian
      ? "| Статус | Кол-во |\n|--------|--------|\n"
      : "| Status | Count |\n|--------|--------|\n";
    Object.entries(counts).forEach(([status, count]) => {
      table += `| ${status} | ${count} |\n`;
    });
    await send(chatId, table);
    return res.sendStatus(200);
  }

  // /find <name>
  if (userText.startsWith("/find")) {
    const parts = userText.split(" ").slice(1);
    const name = parts[0];
    if (!name) {
      const msg = isRussian
        ? "Укажи имя актива: `/find server01`"
        : "Provide asset name: `/find server01`";
      await send(chatId, msg);
      return res.sendStatus(200);
    }
    const normalized = normalizeName(name);
    const asset = memory.assets.find(a => a.name === normalized);
    if (!asset) {
      const msg = isRussian
        ? "Актив не найден."
        : "Asset not found.";
      await send(chatId, msg);
      return res.sendStatus(200);
    }
    let table = isRussian
      ? "| Поле | Значение |\n|------|----------|\n"
      : "| Field | Value |\n|-------|--------|\n";
    table += `| name | ${asset.name} |\n`;
    table += `| status | ${asset.status || "-"} |\n`;
    table += `| ip | ${asset.ip || "-"} |\n`;
    table += `| cluster | ${asset.cluster || "-"} |\n`;
    table += `| dc | ${asset.dc || "-"} |\n`;
    table += `| owner | ${asset.owner || "-"} |\n`;
    table += `| criticality | ${asset.criticality || "-"} |\n`;
    table += `| env | ${asset.env || "-"} |\n`;
    await send(chatId, table);
    return res.sendStatus(200);
  }

  // /report
  if (userText.startsWith("/report")) {
    if (memory.assets.length === 0) {
      const msg = isRussian
        ? "Нет активов для отчёта."
        : "No assets to report.";
      await send(chatId, msg);
      return res.sendStatus(200);
    }
    let table = isRussian
      ? "| Актив | Статус | Критичность | Среда |\n|-------|--------|-------------|-------|\n"
      : "| Asset | Status | Criticality | Env |\n|-------|--------|-------------|-----|\n";
    memory.assets.forEach(a => {
      table += `| ${a.name} | ${a.status || "-"} | ${a.criticality || "-"} | ${a.env || "-"} |\n`;
    });
    await send(chatId, table);
    return res.sendStatus(200);
  }

  // /audit
  if (userText.startsWith("/audit")) {
    const msg = isRussian
      ? "Опиши задачу по аудиту (SOC2 / PCI DSS / DORA), и я помогу структурировать evidence, контрольные вопросы и summary."
      : "Describe your audit task (SOC2 / PCI DSS / DORA), and I will help structure evidence, control questions, and summary.";
    await send(chatId, msg);
    return res.sendStatus(200);
  }

  // /jira
  if (userText.startsWith("/jira")) {
    const msg = isRussian
      ? "Опиши, для какого процесса или аудита нужна Jira‑структура, и я предложу эпики, задачи и подзадачи."
      : "Describe which process or audit needs a Jira structure, and I will propose epics, tasks, and subtasks.";
    await send(chatId, msg);
    return res.sendStatus(200);
  }

  // ---------- TEXT TASKS → OpenAI ----------

  // Save task to memory
  memory.tasks.push({ text: userText, date: new Date().toISOString() });
  saveMemory();

  try {
    const response = await axios.post(
      "https://api.openai.com/v1/chat/completions",
      {
        model: "gpt-4.1",
        messages: [
          { role: "system", content: systemPrompt },
          {
            role: "user",
            content: userText
          }
        ]
      },
      {
        headers: {
          Authorization: `Bearer ${OPENAI_KEY}`,
          "Content-Type": "application/json"
        }
      }
    );

    const botReply = response.data.choices[0].message.content;
    log(`Reply: ${botReply}`);

    await send(chatId, botReply);

  } catch (error) {
    console.error("Error:", error.response?.data || error.message);
    const msg = isRussian
      ? "⚠️ Ошибка обработки запроса. Попробуй ещё раз."
      : "⚠️ Error processing request. Please try again.";
    await send(chatId, msg);
  }

  res.sendStatus(200);
});

// Start server
app.listen(process.env.PORT || 3000, () =>
  console.log("Hermes AI Agent running on port 3000")
);
