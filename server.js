const express = require("express");
const axios = require("axios");

const app = express();
app.use(express.json());

const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;
const OPENAI_KEY = process.env.OPENAI_KEY;
const TELEGRAM_URL = `https://api.telegram.org/bot${TELEGRAM_TOKEN}`;

app.post("/webhook", async (req, res) => {
  const message = req.body.message;
  if (!message || !message.text) return res.sendStatus(200);

  const chatId = message.chat.id;
  const userText = message.text;

  const response = await axios.post(
    "https://api.openai.com/v1/chat/completions",
    {
      model: "gpt-4.1",
      messages: [
        {
          role: "system",
          content: `
Ты — AI Asset Inventory Agent.
Работаешь структурировано, коротко, по делу.
Ведёшь инвентарь активов по моей структуре.
Не придумываешь факты.
Всегда отвечаешь таблицами, если есть данные.
Форматируешь ответы в Markdown.
          `
        },
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

  await axios.post(`${TELEGRAM_URL}/sendMessage`, {
    chat_id: chatId,
    text: botReply,
    parse_mode: "Markdown"
  });

  res.sendStatus(200);
});

app.listen(3000, () => console.log("AI Agent running"));
