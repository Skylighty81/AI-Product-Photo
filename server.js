const express = require("express");
const axios = require("axios");
const FormData = require("form-data");

const app = express();
app.use(express.json());

const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;
const OPENAI_KEY = process.env.OPENAI_KEY;

const TELEGRAM_URL = `https://api.telegram.org/bot${TELEGRAM_TOKEN}`;

const users = {};

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

async function showStart(chatId) {
  await sendMessage(
    chatId,
    `
✨ <b>AI Product Photo</b>

Turn an ordinary product photo into a professional advertising image.

📸 Upload a photo of your product.

I'll keep the product recognizable and create a polished commercial scene around it.

<b>Your first generation will be free.</b>

👇 Send me a product photo to begin.
`
  );
}

async function showStyleSelector(chatId) {
  const keyboard = {
    inline_keyboard: [
      [
        { text: "🤍 Clean Studio", callback_data: "style_clean" },
        { text: "✨ Luxury", callback_data: "style_luxury" }
      ],
      [
        { text: "🏠 Lifestyle", callback_data: "style_lifestyle" },
        { text: "📱 Instagram Ad", callback_data: "style_instagram" }
      ],
      [
        { text: "🌿 Natural", callback_data: "style_natural" }
      ]
    ]
  };

  await sendMessage(
    chatId,
    `
Great — I received your product. ✅

Now choose the style for your new product photo:
`,
    keyboard
  );
}

async function showFormatSelector(chatId) {
  const keyboard = {
    inline_keyboard: [
      [
        { text: "⬜ Square 1:1", callback_data: "format_square" }
      ],
      [
        { text: "📱 Instagram 4:5", callback_data: "format_portrait" }
      ],
      [
        { text: "🎬 Story / Reels 9:16", callback_data: "format_story" }
      ]
    ]
  };

  await sendMessage(
    chatId,
    `
Perfect. 🎨

Now choose the image format:
`,
    keyboard
  );
}

function getSize(format) {
  if (format === "square") return "1024x1024";

  if (format === "portrait") return "1024x1280";

  if (format === "story") return "1024x1792";

  return "1024x1024";
}

function getStylePrompt(style) {
  const styles = {
    clean: `
Create a premium clean studio product photograph.
Use a minimal light neutral studio background.
Soft professional lighting.
Subtle realistic shadows.
High-end ecommerce photography.
No text.
`,

    luxury: `
Create a premium luxury advertising photograph.
Elegant sophisticated environment.
Cinematic premium lighting.
Refined materials and subtle reflections.
Luxury brand campaign aesthetic.
No text.
`,

    lifestyle: `
Create a realistic premium lifestyle advertising photograph.
Place the product naturally in an attractive real-life setting.
Professional commercial photography.
Natural lighting.
No text.
`,

    instagram: `
Create a bold modern social media advertising photograph.
Premium commercial composition suitable for Instagram.
Dynamic lighting and visually striking background.
Professional brand campaign quality.
No text or captions.
`,

    natural: `
Create a premium natural organic product photograph.
Use soft daylight and natural textures.
Elegant earthy atmosphere.
Professional commercial photography.
No text.
`
  };

  return styles[style] || styles.clean;
}

function buildPrompt(style) {
  return `
Use the uploaded image as the exact product reference.

IMPORTANT:
Preserve the product faithfully.

Do not redesign the product.
Do not alter its logo, branding, printed artwork, colors, shape, proportions, materials, stitching, texture, labels, or distinctive details.

The exact product from the reference image must remain clearly recognizable.

Only improve the presentation, environment, lighting, composition and advertising quality around the product.

${getStylePrompt(style)}

The result must look like a professional commercial product photoshoot.
Photorealistic.
Sharp product details.
No invented text.
No extra logos.
No watermark.
`;
}

async function downloadTelegramPhoto(fileId) {
  const fileResponse = await axios.get(
    `${TELEGRAM_URL}/getFile`,
    {
      params: {
        file_id: fileId
      }
    }
  );

  const filePath = fileResponse.data.result.file_path;

  const fileUrl =
    `https://api.telegram.org/file/bot${TELEGRAM_TOKEN}/${filePath}`;

  const imageResponse = await axios.get(fileUrl, {
    responseType: "arraybuffer"
  });

  return Buffer.from(imageResponse.data);
}

async function generateProductPhoto(photoBuffer, style, format) {
  const form = new FormData();

  form.append("model", "gpt-image-2");

  form.append(
    "image[]",
    photoBuffer,
    {
      filename: "product.jpg",
      contentType: "image/jpeg"
    }
  );

  form.append("prompt", buildPrompt(style));

  form.append("size", getSize(format));

  // Medium first: good MVP balance between quality and cost.
  form.append("quality", "medium");

  form.append("output_format", "jpeg");

  form.append("output_compression", "90");

  const response = await axios.post(
    "https://api.openai.com/v1/images/edits",
    form,
    {
      headers: {
        Authorization: `Bearer ${OPENAI_KEY}`,
        ...form.getHeaders()
      },

      // Image generation can take a while.
      timeout: 180000,

      maxContentLength: Infinity,
      maxBodyLength: Infinity
    }
  );

  const imageBase64 = response.data?.data?.[0]?.b64_json;

  if (!imageBase64) {
    throw new Error("OpenAI returned no image");
  }

  return Buffer.from(imageBase64, "base64");
}

async function sendPhoto(chatId, imageBuffer) {
  const form = new FormData();

  form.append("chat_id", String(chatId));

  form.append(
    "photo",
    imageBuffer,
    {
      filename: "product-photo.jpg",
      contentType: "image/jpeg"
    }
  );

  form.append(
    "caption",
    "✨ Your AI product photo is ready."
  );

  await axios.post(
    `${TELEGRAM_URL}/sendPhoto`,
    form,
    {
      headers: form.getHeaders(),
      maxContentLength: Infinity,
      maxBodyLength: Infinity
    }
  );
}

app.post("/webhook", async (req, res) => {
  res.sendStatus(200);

  try {
    const update = req.body;

    if (update.callback_query) {
      const callback = update.callback_query;

      const chatId = callback.message.chat.id;
      const userId = callback.from.id;
      const data = callback.data;

      await answerCallbackQuery(callback.id);

      if (!users[userId]) {
        users[userId] = {};
      }

      if (data.startsWith("style_")) {
        const style = data.replace("style_", "");

        users[userId].style = style;

        log(`User ${userId} selected style: ${style}`);

        await showFormatSelector(chatId);

        return;
      }

      if (data.startsWith("format_")) {
        const format = data.replace("format_", "");

        users[userId].format = format;

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
⏳ <b>Creating your product photo...</b>

Style: <b>${user.style}</b>
Format: <b>${format}</b>

This can take around 30–120 seconds.
`
        );

        log(
          `Generating for user ${userId}: ${user.style}, ${format}`
        );

        try {
          const originalPhoto =
            await downloadTelegramPhoto(user.photoFileId);

          log(
            `Downloaded Telegram image for user ${userId}`
          );

          const generatedPhoto =
            await generateProductPhoto(
              originalPhoto,
              user.style,
              format
            );

          log(
            `OpenAI generation completed for user ${userId}`
          );

          await sendPhoto(chatId, generatedPhoto);

          log(
            `Generated image sent to user ${userId}`
          );

          await sendMessage(
            chatId,
            `
Want another version?

📸 Send another product photo or resend the same one and choose a different style.
`
          );
        } catch (error) {
          console.error(
            "IMAGE GENERATION ERROR:",
            error.response?.data || error.message
          );

          await sendMessage(
            chatId,
            `
⚠️ <b>I couldn't generate the image.</b>

Please try again in a moment.

If the problem continues, we'll check the Railway logs.
`
          );
        }

        return;
      }

      return;
    }

    const message = update.message;

    if (!message) {
      return;
    }

    const chatId = message.chat.id;
    const userId = message.from.id;

    if (!users[userId]) {
      users[userId] = {};
    }

    if (
      message.text &&
      message.text.trim().toLowerCase().startsWith("/start")
    ) {
      log(`User ${userId} started the bot`);

      await showStart(chatId);

      return;
    }

    if (
      message.photo &&
      message.photo.length > 0
    ) {
      const largestPhoto =
        message.photo[message.photo.length - 1];

      users[userId].photoFileId =
        largestPhoto.file_id;

      users[userId].style = null;
      users[userId].format = null;

      log(
        `Photo received from user ${userId}`
      );

      await showStyleSelector(chatId);

      return;
    }

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

app.get("/", (req, res) => {
  res.send("AI Product Photo Bot is running.");
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  log(`Server running on port ${PORT}`);
});
