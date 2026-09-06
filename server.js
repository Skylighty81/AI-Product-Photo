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
const DOCS_DIR = path.join(DATA_DIR, "docs");

// Ensure data directories exist
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
if (!fs.existsSync(DOCS_DIR)) fs.mkdirSync(DOCS_DIR, { recursive: true });

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

// Normalize asset name
function normalizeName(name) {
  return name.trim().toLowerCase();
}

// Webhook endpoint
app.post("/webhook", async (req, res) => {
  const message = req.body.message;
  if (!message) return res.sendStatus(200);

  const chatId = message.chat.id;
  const userText = message.text ? message.text.trim() : null;

  log(`Incoming message: ${userText || "[file]"}`);

  // Detect language (RU or EN)
  const isRussian = userText && /[а-яА-Я]/.test(userText);

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
- поддерживать Jira‑структуры;
- анализировать документы.

Рабочие правила:
1. Не придумывай факты.
2. Не меняй данные без подтверждения.
3. Если данных мало — уточняй.
4. Всегда отвечай структурно.
5. Используй Markdown‑таблицы.
6. Логируй каждое действие в консоль Railway.
7. Если команда начинается с "/" — выполняй скилл.
8. Если текстовая задача — анализируй и выполняй.
9. Всегда уточняй неполные задачи.
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
- /check — анализ документов.

Память:
Ты хранишь список активов, статусы, последние задачи и документы.
  `;

  const hermesPassportEN = `
You are Hermes — a professional AI agent.
Respond in English.
You work structured, concise, and professional.
You are Eleonora's corporate assistant (Project Manager for audits, SOC2, DORA, PCI DSS).

Your role:
AI asset inventory agent, audit assistant, and document analyst.

Your mission:
Automate Eleonora's repetitive tasks:
- maintain asset inventory;
- update tables;
- generate reports;
- assist with audit preparation;
- structure data;
- clarify statuses;
- support Jira structures;
- analyze documents.

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
- /check — analyze documents.

Memory:
You store asset list, statuses, tasks, and documents.
  `;

  const systemPrompt = isRussian ? hermesPassportRU : hermesPassportEN;

  // ---------- COMMANDS ----------

  // /help
  if (userText && userText.startsWith("/help")) {
    const helpText = isRussian
      ? `
Доступные команды Hermes:

/help — показать список команд.
/add <name> — добавить актив.
/list — показать список активов.
/update <name> <status> — обновить статус.
/report — отчёт по активам.
/status — сводка по состояниям.
/find <name> — найти актив.
/audit — помощь с SOC2 / PCI DSS / DORA.
/jira — структура Jira.
/check — анализ документов.
      `
      : `
Available Hermes commands:

/help — show commands.
/add <name> — add asset.
/list — show assets.
/update <name> <status> — update status.
/report — asset report.
/status — status summary.
/find <name> — find asset.
/audit — SOC2 / PCI DSS / DORA help.
/jira — Jira structure.
/check — document analysis.
      `;
    await send(chatId, helpText);
    return res.sendStatus(200);
  }

  // /check — request document
  if (userText && userText.startsWith("/check")) {
    const msg = isRussian
      ? "Отправь документ (PDF, DOCX, XLSX, TXT), и я его проверю."
      : "Send a document (PDF, DOCX, XLSX, TXT) and I will analyze it.";
    await send(chatId, msg);
    return res.sendStatus(200);
  }

  // ---------- DOCUMENT HANDLING ----------
  if (message.document) {
    try {
      const fileId = message.document.file_id;

      // Get file path from Telegram
      const fileInfo = await axios.get(`${TELEGRAM_URL}/getFile?file_id=${fileId}`);
      const filePath = fileInfo.data.result.file_path;

      // Download file
      const fileUrl = `https://api.telegram.org/file/bot${TELEGRAM_TOKEN}/${filePath}`;
      const fileName = message.document.file_name;
      const localPath = path.join(DOCS_DIR, fileName);

      const fileData = await axios.get(fileUrl, { responseType: "arraybuffer" });
      fs.writeFileSync(localPath, fileData.data);

      log(`Document saved: ${localPath}`);

      let textContent = "Документ загружен. Содержимое будет проанализировано ChatGPT.";

      // Send to OpenAI for analysis
      const analysisPrompt = isRussian
        ? `Проанализируй документ:\n\n${textContent}\n\nСформируй summary, ошибки, несоответствия, completeness и рекомендации.`
        : `Analyze the document:\n\n${textContent}\n\nProvide summary, issues, gaps, completeness and recommendations.`;

      const aiResponse = await axios.post(
        "https://api.openai.com/v1/chat/completions",
        {
          model: "gpt-4.1",
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: analysisPrompt }
          ]
        },
        {
          headers: {
            Authorization: `Bearer ${OPENAI_KEY}`,
            "Content-Type": "application/json"
          }
        }
      );

      const botReply = aiResponse.data.choices[0].message.content;
      await send(chatId, botReply);

    } catch (error) {
      console.error("Document error:", error.response?.data || error.message);
      const msg = isRussian
        ? "⚠️ Ошибка обработки документа."
        : "⚠️ Error processing document.";
      await send(chatId, msg);
    }

    return res.sendStatus(200);
  }

  // ---------- ASSET COMMANDS ----------
  if (userText && userText.startsWith("/add")) {
    const parts = userText.split(" ").slice(1);
    const name = parts[0];
    if (!name) {
      await send(chatId, isRussian ? "Укажи имя: /add server01" : "Provide name: /add server01");
      return res.sendStatus(200);
    }
    const normalized = normalizeName(name);
    const existing = memory.assets.find(a => a.name === normalized);
    if (existing) {
      await send(chatId, isRussian ? "Актив уже существует." : "Asset already exists.");
      return res.sendStatus(200);
    }
    memory.assets.push({ name: normalized, status: "new" });
    saveMemory();
    await send(chatId, isRussian ? `Актив ${name} добавлен.` : `Asset ${name} added.`);
    return res.sendStatus(200);
  }

  if (userText && userText.startsWith("/list")) {
    if (memory.assets.length === 0) {
      await send(chatId, isRussian ? "Список пуст." : "List is empty.");
      return res.sendStatus(200);
    }
    let table = isRussian
      ? "| Актив | Статус |\n|-------|--------|\n"
      : "| Asset | Status |\n|-------|--------|\n";
    memory.assets.forEach(a => {
      table += `| ${a.name} | ${a.status} |\n`;
    });
    await send(chatId, table);
    return res.sendStatus(200);
  }

  if (userText && userText.startsWith("/update")) {
    const parts = userText.split(" ").slice(1);
    const name = parts[0];
    const status = parts[1];
    if (!name || !status) {
      await send(chatId, isRussian ? "Используй: /update server01 active" : "Use: /update server01 active");
      return res.sendStatus(200);
    }
    const normalized = normalizeName(name);
    const asset = memory.assets.find(a => a.name === normalized);
    if (!asset) {
      await send(chatId, isRussian ? "Актив не найден." : "Asset not found.");
      return res.sendStatus(200);
    }
    asset.status = status;
    saveMemory();
    await send(chatId, isRussian ? "Статус обновлён." : "Status updated.");
    return res.sendStatus(200);
  }

  if (userText && userText.startsWith("/status")) {
    const counts = {};
    memory.assets.forEach(a => {
      counts[a.status] = (counts[a.status] || 0) + 1;
    });
    let table = isRussian
      ? "| Статус | Кол-во |\n|--------|--------|\n"
      : "| Status | Count |\n|--------|--------|\n";
    Object.entries(counts).forEach(([s, c]) => {
      table += `| ${s} | ${c} |\n`;
    });
    await send(chatId, table);
    return res.sendStatus(200);
  }

  if (userText && userText.startsWith("/find")) {
    const name = userText.split(" ")[1];
    if (!name) {
      await send(chatId, isRussian ? "Укажи имя: /find server01" : "Provide name: /find server01");
      return res.sendStatus(200);
    }
    const normalized = normalizeName(name);
    const asset = memory.assets.find(a => a.name === normalized);
    if (!asset) {
      await send(chatId, isRussian ? "Актив не найден." : "Asset not found.");
      return res.sendStatus(200);
    }
    let table = isRussian
      ? "| Поле | Значение |\n|------|----------|\n"
      : "| Field | Value |\n|-------|--------|\n";
    Object.entries(asset).forEach(([k, v]) => {
      table += `| ${k} | ${v || "-"} |\n`;
    });
    await send(chatId, table);
    return res.sendStatus(200);
  }

  if (userText && userText.startsWith("/report")) {
    if (memory.assets.length === 0) {
      await send(chatId, isRussian ? "Нет активов." : "No assets.");
      return res.sendStatus(200);
    }
    let table = isRussian
      ? "| Актив | Статус |\n|-------|--------|\n"
      : "| Asset | Status |\n|-------|--------|\n";
    memory.assets.forEach(a => {
      table += `| ${a.name} | ${a.status} |\n`;
    });
    await send(chatId, table);
    return res.sendStatus(200);
  }

  if (userText && userText.startsWith("/audit")) {
    await send(chatId, isRussian
      ? "Опиши задачу по аудиту, и я помогу."
      : "Describe your audit task and I will help.");
    return res.sendStatus(200);
  }

  if (userText && userText.startsWith("/jira")) {
    await send(chatId, isRussian
      ? "Опиши процесс, и я создам Jira‑структуру."
      : "Describe the process and I will create a Jira structure.");
    return res.sendStatus(200);
  }

  // ---------- TEXT TASKS → OpenAI ----------
  if (userText) {
    memory.tasks.push({ text: userText, date: new Date().toISOString() });
    saveMemory();

    try {
      const response = await axios.post(
        "https://api.openai.com/v1/chat/completions",
        {
          model: "gpt-4.1",
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: userText }
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
      await send(chatId, isRussian
        ? "⚠️ Ошибка обработки запроса."
        : "⚠️ Error processing request.");
    }
  }

  res.sendStatus(200);
});

// Start server
app.listen(process.env.PORT || 3000, () =>
  console.log("Hermes AI Agent running on port 3000")
);
