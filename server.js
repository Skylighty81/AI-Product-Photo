const express = require("express");
const axios = require("axios");

const app = express();
app.use(express.json());

// ==========================
// ENV VARIABLES
// ==========================

const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;
const OPENAI_KEY = process.env.OPENAI_KEY;

const TELEGRAM_URL = `https://api.telegram.org/bot${TELEGRAM_TOKEN}`;

// Temporary user state.
// Later we will replace this with PostgreSQL.
const users = {};

// ==========================
// HELPERS
// ==========================

function log(message) {
  console.log(`[PRODUCT PHOTO BOT] ${message}`);
}

async function sendMessage(chatId, text, replyMarkup = null) {
  const payload = {
    chat_id: chatId,
    text,
    parse_mode: "HTML"
  };

  if (replyMarkup) {
    payload.reply_markup = replyMarkup;
  }

  return axios.post(`${TELEGRAM_URL}/sendMessage`, payload);
}

async function answerCallbackQuery(callbackQueryId) {
  try {
    await axios.post(`${TELEGRAM_URL}/answerCallbackQuery`, {
      callback_query_id: callbackQueryId
    });
  } catch (error) {
    console.error(
      "answerCallbackQuery error:",
      error.response?.data || error.message
    );
  }
}

// ==========================
// START SCREEN
// ==========================

async function showStart(chatId) {
  const text = `
✨ <b>AI Product Photo</b>

Turn an ordinary product photo into a professional advertising image.

📸 Upload a photo of your product.

I'll keep the product recognizable and create a polished commercial scene around it.

<b>Your first generation will be free.</b>

👇 Send me a product photo to begin.
`;

  await sendMessage(chatId, text);
}

// ==========================
// STYLE SELECTOR
// ==========================

async function showStyleSelector(chatId) {
  const text = `
Great — I received your product. ✅

Now choose the style for your new product photo:
`;

  const keyboard = {
    inline_keyboard: [
      [
        {
          text: "🤍 Clean Studio",
          callback_data: "style_clean"
        },
        {
          text: "✨ Luxury",
          callback_data: "style_luxury"
        }
      ],
      [
        {
          text: "🏠 Lifestyle",
          callback_data: "style_lifestyle"
        },
        {
          text: "📱 Instagram Ad",
          callback_data: "style_instagram"
        }
      ],
      [
        {
          text: "🌿 Natural",
          callback_data: "style_natural"
        }
      ]
    ]
  };

  await sendMessage(chatId, text, keyboard);
}

// ==========================
// FORMAT SELECTOR
// ==========================

async function showFormatSelector(chatId) {
  const text = `
Perfect. 🎨

Now choose the image format:
`;

  const keyboard = {
    inline_keyboard: [
      [
        {
          text: "⬜ Square 1:1",
          callback_data: "format_square"
        }
      ],
      [
        {
          text: "📱 Instagram 4:5",
          callback_data: "format_portrait"
        }
      ],
      [
        {
          text: "🎬 Story / Reels 9:16",
          callback_data: "format_story"
        }
      ]
    ]
  };

  await sendMessage(chatId, text, keyboard);
}

// ==========================
// WEBHOOK
// ==========================

app.post("/webhook", async (req, res) => {
  // Always acknowledge Telegram quickly
  res.sendStatus(200);

  try {
    const update = req.body;

    // ======================
    // CALLBACK BUTTONS
    // ======================

    if (update.callback_query) {
      const callback = update.callback_query;

      const chatId = callback.message.chat.id;
      const userId = callback.from.id;
      const data = callback.data;

      await answerCallbackQuery(callback.id);

      if (!users[userId]) {
        users[userId] = {};
      }

      // STYLE
      if (data.startsWith("style_")) {
        const style = data.replace("style_", "");

        users[userId].style = style;

        log(`User ${userId} selected style: ${style}`);

        await showFormatSelector(chatId);

        return;
      }

      // FORMAT
      if (data.startsWith("format_")) {
        const format = data.replace("format_", "");

        users[userId].format = format;

        log(`User ${userId} selected format: ${format}`);

        const user = users[userId];

        if (!user.photoFileId) {
          await sendMessage(
            chatId,
            "⚠️ I can't find your product photo. Please upload it again."
          );

          return;
        }

        await sendMessage(
          chatId,
          `
✅ <b>Ready to generate!</b>

Style: <b>${user.style}</b>
Format: <b>${format}</b>

AI generation will be connected in the next step.

For now, this confirms that the complete Telegram flow is working correctly. 🚀
`
        );

        return;
      }

      return;
    }

    // ======================
    // NORMAL MESSAGE
    // ======================

    const message = update.message;

    if (!message) {
      return;
    }

    const chatId = message.chat.id;
    const userId = message.from.id;

    if (!users[userId]) {
      users[userId] = {};
    }

    // ======================
    // /START
    // ======================

    if (
      message.text &&
      message.text.trim().toLowerCase().startsWith("/start")
    ) {
      log(`User ${userId} started the bot`);

      await showStart(chatId);

      return;
    }

    // ======================
    // PHOTO
    // ======================

    if (message.photo && message.photo.length > 0) {
      const largestPhoto =
        message.photo[message.photo.length - 1];

      users[userId].photoFileId =
        largestPhoto.file_id;

      users[userId].style = null;
      users[userId].format = null;

      log(
        `Photo received from user ${userId}: ${largestPhoto.file_id}`
      );

      await showStyleSelector(chatId);

      return;
    }

    // ======================
    // FALLBACK
    // ======================

    await sendMessage(
      chatId,
      `
📸 Please send me a photo of your product.

I'll turn it into a professional product image.
`
    );
  } catch (error) {
    console.error(
      "Webhook error:",
      error.response?.data || error.message
    );
  }
});

// ==========================
// HEALTH CHECK
// ==========================

app.get("/", (req, res) => {
  res.send("AI Product Photo Bot is running.");
});

// ==========================
// SERVER
// ==========================

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  log(`Server running on port ${PORT}`);
});
