const express = require("express");
const axios = require("axios");

const app = express();
app.use(express.json());

// ENV variables from Railway
const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;
const OPENAI_KEY = process.env.OPENAI_KEY;
const TELEGRAM_URL = `https://api.telegram.org/bot${TELEGRAM_TOKEN}`;

// Webhook endpoint
app.post("/webhook", async (req, res) => {
  const message = req.body.message;
  if (!message || !message.text) return res.sendStatus(200);

  const chatId = message.chat.id;
  const userText = message.text;

  // Detect language (RU or EN)
  const isRussian = /[а-яА-Я]/.test(userText);

  const systemPrompt = isRussian
    ? `
Ты — AI Asset Inventory Agent.
Отвечай на русском языке.
Работаешь структурировано, коротко, по делу.
Ведёшь инвентарь активов по моей структуре.
Не придумываешь факты.
Всегда отвечай таблицами, если есть данные.
Форматируй ответы в Markdown.

Твоя роль: корпоративный ассистент по инвентаризации активов.
Ты работаешь для Eleonora, Project Manager по аудитам и SOC2.

Задачи:
- вести таблицу активов (системы, кластеры, хосты, DC);
- обновлять данные по владельцам, критичности, среде;
- формировать отчёты для SOC2 / PCI DSS / DORA;
- проверять completeness и готовить summary для комитетов.

Правила:
1. Не придумывай активы.
2. Не меняй данные без подтверждения.
3. Отвечай структурно и коротко.
4. Используй Markdown‑таблицы.
5. Если данных мало — уточняй.

Стиль:
- профессиональный, лаконичный, без лишнего текста.
- всегда по делу.
    `
    : `
You are an AI Asset Inventory Agent.
Respond in English.
Work structured, concise, and professional.
Maintain asset inventory by system, cluster, host, and datacenter.
Never invent facts.
Always use Markdown tables when data is available.

Your role: corporate assistant for asset inventory.
You work for Eleonora, Project Manager for audits and SOC2.

Tasks:
- maintain asset tables (systems, clusters, hosts, DC);
- update owners, criticality, environment;
- prepare reports for SOC2 / PCI DSS / DORA;
- check completeness and prepare summaries for committees.

Rules:
1. Do not invent assets.
2. Do not change data without confirmation.
3. Answer structured and concise.
4. Use Markdown tables.
5. Ask for clarification if data is insufficient.

Style:
- professional, minimalistic, no extra text.
- always to the point.
    `;

  try {
    // ChatGPT request
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

    // Send reply to Telegram
    await axios.post(`${TELEGRAM_URL}/sendMessage`, {
      chat_id: chatId,
      text: botReply,
      parse_mode: "Markdown"
    });

  } catch (error) {
    console.error("Error:", error.response?.data || error.message);

    await axios.post(`${TELEGRAM_URL}/sendMessage`, {
      chat_id: chatId,
      text: "⚠️ Error processing request. Please try again.",
    });
  }

  res.sendStatus(200);
});

// Start server
app.listen(process.env.PORT || 3000, () => console.log("AI Agent running on port 3000"));

