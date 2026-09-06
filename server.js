const express = require("express");
const axios = require("axios");

const app = express();
app.use(express.json());

// ENV variables from Railway
const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;
const OPENAI_KEY = process.env.OPENAI_KEY;
const TELEGRAM_URL = `https://api.telegram.org/bot${TELEGRAM_TOKEN}`;

// Simple in-memory storage (Hermes Memory)
let assetInventory = []; // [{name, ip, cluster, dc, owner, status}]
let lastTasks = [];

// Logging helper
function log(msg) {
  console.log(`[Hermes LOG] ${msg}`);
}

// Webhook endpoint
app.post("/webhook", async (req, res) => {
  const message = req.body.message;
  if (!message || !message.text) return res.sendStatus(200);

  const chatId = message.chat.id;
  const userText = message.text;

  log(`Incoming message: ${userText}`);

  // Detect language (RU or EN)
  const isRussian = /[а-яА-Я]/.test(userText);

  // Hermes Passport + Rules + Skills
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
- /add — добавить актив.
- /list — показать список активов.
- /report — сформировать отчёт.
- /update — обновить статус актива.
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
- /add — add asset.
- /list — show asset list.
- /report — generate report.
- /update — update asset status.
- /audit — help with SOC2 / PCI DSS / DORA.
- /jira — help with Jira structures.

Memory:
You store asset list, statuses, last tasks, audit context.
  `;

  const systemPrompt = isRussian ? hermesPassportRU : hermesPassportEN;

  // Local skill handlers BEFORE sending to OpenAI
  if (userText.startsWith("/add")) {
    const parts = userText.split(" ").slice(1);
    const name = parts[0];
    if (!name) {
      return send(chatId, "Укажи имя актива: /add server01");
    }
    assetInventory.push({ name, status: "new" });
    log(`Added asset: ${name}`);
    return send(chatId, `Актив **${name}** добавлен.`);
  }

  if (userText.startsWith("/list")) {
    if (assetInventory.length === 0) {
      return send(chatId, "Список активов пуст.");
    }
    let table = "| Актив | Статус |\n|-------|--------|\n";
    assetInventory.forEach(a => {
      table += `| ${a.name} | ${a.status} |\n`;
    });
    return send(chatId, table);
  }

  if (userText.startsWith("/update")) {
    const parts = userText.split(" ").slice(1);
    const name = parts[0];
    const status = parts[1];
    if (!name || !status) {
      return send(chatId, "Используй: /update server01 active");
    }
    const asset = assetInventory.find(a => a.name === name);
    if (!asset) return send(chatId, "Актив не найден.");
    asset.status = status;
    log(`Updated asset ${name} → ${status}`);
    return send(chatId, `Статус актива **${name}** обновлён на **${status}**.`);
  }

  // If no local skill — send to OpenAI
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
    await send(chatId, "⚠️ Error processing request. Please try again.");
  }

  res.sendStatus(200);
});

// Helper to send messages
async function send(chatId, text) {
  await axios.post(`${TELEGRAM_URL}/sendMessage`, {
    chat_id: chatId,
    text,
    parse_mode: "Markdown"
  });
}

// Start server
app.listen(process.env.PORT || 3000, () =>
  console.log("Hermes AI Agent running on port 3000")
);
