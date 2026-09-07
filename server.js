const express = require("express");
const axios = require("axios");
const FormData = require("form-data");
const { Pool } = require("pg");

const app = express();
app.use(express.json());

// ======================================================
// ENV
// ======================================================

const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;
const OPENAI_KEY = process.env.OPENAI_KEY;

const TELEGRAM_URL = `https://api.telegram.org/bot${TELEGRAM_TOKEN}`;

// ======================================================
// PRODUCT PACKAGES
// ======================================================

const PACKAGES = {
  buy_7: {
    credits: 7,
    stars: 275,
    title: "Starter — 7 AI Product Photos",
    payload: "credits_7",
    eur: "≈ €6.25"
  },

  buy_20: {
    credits: 20,
    stars: 750,
    title: "Creator — 20 AI Product Photos",
    payload: "credits_20",
    eur: "≈ €17"
  },

  buy_50: {
    credits: 50,
    stars: 1800,
    title: "Business — 50 AI Product Photos",
    payload: "credits_50",
    eur: "≈ €41"
  }
};

function getPackageByPayload(payload) {
  return Object.values(PACKAGES).find(
    (item) => item.payload === payload
  );
}

// ======================================================
// TEXT HELPERS
// ======================================================

function photoWord(count) {
  return count === 1 ? "photo" : "photos";
}

function creditWord(count) {
  return count === 1 ? "credit" : "credits";
}

// ======================================================
// DATABASE
// ======================================================

const pool = new Pool({
  connectionString: process.env.DATABASE_URL
});

async function initDatabase() {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        telegram_id BIGINT PRIMARY KEY,
        username TEXT,
        first_name TEXT,
        credits INTEGER NOT NULL DEFAULT 1,
        free_generation_used BOOLEAN NOT NULL DEFAULT FALSE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS payments (
        id SERIAL PRIMARY KEY,
        telegram_id BIGINT NOT NULL,
        stars INTEGER NOT NULL,
        credits_added INTEGER NOT NULL,
        invoice_payload TEXT NOT NULL,
        telegram_payment_charge_id TEXT UNIQUE NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    console.log("[DATABASE] PostgreSQL connected successfully");
    console.log("[DATABASE] Users table ready");
    console.log("[DATABASE] Payments table ready");

  } catch (error) {
    console.error(
      "[DATABASE] Initialization failed:",
      error.message
    );
  }
}

initDatabase();

// ======================================================
// TEMPORARY SESSION MEMORY
// ======================================================

const users = {};

// ======================================================
// LOGGING
// ======================================================

function log(message) {
  console.log(`[PRODUCT PHOTO BOT] ${message}`);
}

// ======================================================
// TELEGRAM HELPERS
// ======================================================

async function sendMessage(
  chatId,
  text,
  replyMarkup = null
) {
  const payload = {
    chat_id: chatId,
    text,
    parse_mode: "HTML"
  };

  if (replyMarkup) {
    payload.reply_markup = replyMarkup;
  }

  return axios.post(
    `${TELEGRAM_URL}/sendMessage`,
    payload
  );
}

async function answerCallbackQuery(
  callbackQueryId
) {
  try {
    await axios.post(
      `${TELEGRAM_URL}/answerCallbackQuery`,
      {
        callback_query_id: callbackQueryId
      }
    );

  } catch (error) {
    console.error(
      "answerCallbackQuery error:",
      error.response?.data || error.message
    );
  }
}

// ======================================================
// START SCREEN
// ======================================================

async function showStart(chatId) {
  await sendMessage(
    chatId,
    `
✨ <b>AI Product Photo</b>

Turn an ordinary product photo into a professional advertising image.

📸 Upload a photo of your product.

I'll keep the product recognizable and create a polished commercial scene around it.

🎁 <b>Your first generation is free.</b>

👇 Send me a product photo to begin.
`
  );
}

// ======================================================
// STYLE SELECTOR
// ======================================================

async function showStyleSelector(chatId) {
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

  await sendMessage(
    chatId,
    `
Great — I received your product. ✅

Now choose the style for your new product photo:
`,
    keyboard
  );
}

// ======================================================
// FORMAT SELECTOR
// ======================================================

async function showFormatSelector(chatId) {
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

  await sendMessage(
    chatId,
    `
Perfect. 🎨

Now choose the image format:
`,
    keyboard
  );
}

// ======================================================
// BUY PHOTO PACKS
// ======================================================

async function showBuyCredits(chatId) {
  const keyboard = {
    inline_keyboard: [
      [
        {
          text: "⭐ 7 Photos · 275 Stars · ≈ €6.25",
          callback_data: "buy_7"
        }
      ],

      [
        {
          text: "✨ 20 Photos · 750 Stars · ≈ €17",
          callback_data: "buy_20"
        }
      ],

      [
        {
          text: "🔥 50 Photos · 1,800 Stars · ≈ €41",
          callback_data: "buy_50"
        }
      ]
    ]
  };

  await sendMessage(
    chatId,
    `
✨ <b>Choose your photo pack</b>

Create professional product photos for your brand, shop or social media.

<b>⭐ Starter — 7 Photos</b>
275 Stars · ≈ €6.25
≈ €0.89 per photo

<b>✨ Creator — 20 Photos</b>
750 Stars · ≈ €17
≈ €0.85 per photo
<b>Most Popular</b>

<b>🔥 Business — 50 Photos</b>
1,800 Stars · ≈ €41
≈ €0.82 per photo
<b>Best Value</b>

Use your photos for:

📱 Social media
🛍 Online shops
📦 Marketplaces
📣 Advertising

💎 Your photo credits never expire.

<i>EUR amounts are approximate. Actual Star prices may vary in Telegram.</i>
`,
    keyboard
  );
}

// ======================================================
// IMAGE SIZE
// ======================================================

function getSize(format) {
  if (format === "square") {
    return "1024x1024";
  }

  if (format === "portrait") {
    return "1024x1280";
  }

  if (format === "story") {
    return "1024x1792";
  }

  return "1024x1024";
}

// ======================================================
// STYLE PROMPTS
// ======================================================

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

Do not alter:

- logo
- branding
- printed artwork
- colors
- shape
- proportions
- materials
- stitching
- texture
- labels
- distinctive details

The exact product from the reference image must remain clearly recognizable.

Only improve:

- presentation
- environment
- lighting
- composition
- advertising quality

${getStylePrompt(style)}

The result must look like a professional commercial product photoshoot.

Photorealistic.
Sharp product details.
No invented text.
No extra logos.
No watermark.
`;
}

// ======================================================
// DOWNLOAD TELEGRAM PHOTO
// ======================================================

async function downloadTelegramPhoto(fileId) {
  const fileResponse = await axios.get(
    `${TELEGRAM_URL}/getFile`,
    {
      params: {
        file_id: fileId
      }
    }
  );

  const filePath =
    fileResponse.data.result.file_path;

  const fileUrl =
    `https://api.telegram.org/file/bot${TELEGRAM_TOKEN}/${filePath}`;

  const imageResponse = await axios.get(
    fileUrl,
    {
      responseType: "arraybuffer"
    }
  );

  return Buffer.from(
    imageResponse.data
  );
}

// ======================================================
// OPENAI IMAGE GENERATION
// ======================================================

async function generateProductPhoto(
  photoBuffer,
  style,
  format
) {
  const form = new FormData();

  form.append(
    "model",
    "gpt-image-2"
  );

  form.append(
    "image[]",
    photoBuffer,
    {
      filename: "product.jpg",
      contentType: "image/jpeg"
    }
  );

  form.append(
    "prompt",
    buildPrompt(style)
  );

  form.append(
    "size",
    getSize(format)
  );

  form.append(
    "quality",
    "medium"
  );

  form.append(
    "output_format",
    "jpeg"
  );

  form.append(
    "output_compression",
    "90"
  );

  const response = await axios.post(
    "https://api.openai.com/v1/images/edits",
    form,
    {
      headers: {
        Authorization: `Bearer ${OPENAI_KEY}`,
        ...form.getHeaders()
      },

      timeout: 180000,

      maxContentLength: Infinity,
      maxBodyLength: Infinity
    }
  );

  const imageBase64 =
    response.data?.data?.[0]?.b64_json;

  if (!imageBase64) {
    throw new Error(
      "OpenAI returned no image"
    );
  }

  return Buffer.from(
    imageBase64,
    "base64"
  );
}

// ======================================================
// SEND GENERATED PHOTO
// ======================================================

async function sendPhoto(
  chatId,
  imageBuffer
) {
  const form = new FormData();

  form.append(
    "chat_id",
    String(chatId)
  );

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

// ======================================================
// WEBHOOK
// ======================================================

app.post(
  "/webhook",
  async (req, res) => {

    res.sendStatus(200);

    try {
      const update = req.body;

      // ==================================================
      // TELEGRAM STARS — PRE-CHECKOUT
      // ==================================================

      if (update.pre_checkout_query) {
        const query =
          update.pre_checkout_query;

        const selectedPackage =
          getPackageByPayload(
            query.invoice_payload
          );

        console.log(
          `[PAYMENT] Pre-checkout from user ${query.from.id}: ${query.invoice_payload}`
        );

        if (!selectedPackage) {
          console.error(
            `[PAYMENT] Unknown pre-checkout payload: ${query.invoice_payload}`
          );

          await axios.post(
            `${TELEGRAM_URL}/answerPreCheckoutQuery`,
            {
              pre_checkout_query_id: query.id,
              ok: false,
              error_message:
                "This package could not be verified. Please try again."
            }
          );

          return;
        }

        if (query.currency !== "XTR") {
          console.error(
            `[PAYMENT] Invalid pre-checkout currency: ${query.currency}`
          );

          await axios.post(
            `${TELEGRAM_URL}/answerPreCheckoutQuery`,
            {
              pre_checkout_query_id: query.id,
              ok: false,
              error_message:
                "Payment currency could not be verified."
            }
          );

          return;
        }

        if (
          query.total_amount !==
          selectedPackage.stars
        ) {
          console.error(
            `[PAYMENT] Invalid pre-checkout amount. Expected ${selectedPackage.stars}, received ${query.total_amount}`
          );

          await axios.post(
            `${TELEGRAM_URL}/answerPreCheckoutQuery`,
            {
              pre_checkout_query_id: query.id,
              ok: false,
              error_message:
                "Payment amount could not be verified."
            }
          );

          return;
        }

        await axios.post(
          `${TELEGRAM_URL}/answerPreCheckoutQuery`,
          {
            pre_checkout_query_id: query.id,
            ok: true
          }
        );

        console.log(
          `[PAYMENT] Pre-checkout approved for user ${query.from.id}`
        );

        return;
      }

      // ==================================================
      // TELEGRAM STARS — SUCCESSFUL PAYMENT
      // ==================================================

      if (
        update.message?.successful_payment
      ) {
        const message =
          update.message;

        const chatId =
          message.chat.id;

        const userId =
          message.from.id;

        const payment =
          message.successful_payment;

        const currency =
          payment.currency;

        const totalAmount =
          payment.total_amount;

        const payload =
          payment.invoice_payload;

        const chargeId =
          payment.telegram_payment_charge_id;

        console.log(
          `[PAYMENT] Successful payment received from user ${userId}: ${payload}, ${totalAmount} ${currency}`
        );

        const selectedPackage =
          getPackageByPayload(
            payload
          );

        if (!selectedPackage) {
          console.error(
            `[PAYMENT] Unknown payload from user ${userId}: ${payload}`
          );

          await sendMessage(
            chatId,
            `
⚠️ <b>Payment received, but the package could not be identified.</b>

Please contact support and do not pay again.
`
          );

          return;
        }

        if (currency !== "XTR") {
          console.error(
            `[PAYMENT] Invalid currency from user ${userId}: ${currency}`
          );

          await sendMessage(
            chatId,
            `
⚠️ Payment currency could not be verified.

Please contact support.
`
          );

          return;
        }

        if (
          totalAmount !==
          selectedPackage.stars
        ) {
          console.error(
            `[PAYMENT] Invalid amount from user ${userId}. Expected ${selectedPackage.stars}, received ${totalAmount}`
          );

          await sendMessage(
            chatId,
            `
⚠️ Payment amount could not be verified.

Please contact support.
`
          );

          return;
        }

        const client =
          await pool.connect();

        let newCredits = null;
        let duplicatePayment = false;

        try {
          await client.query(
            "BEGIN"
          );

          // ----------------------------------------------
          // MAKE SURE USER EXISTS
          // ----------------------------------------------

          await client.query(
            `
            INSERT INTO users (
              telegram_id,
              username,
              first_name
            )

            VALUES (
              $1,
              $2,
              $3
            )

            ON CONFLICT (
              telegram_id
            )

            DO UPDATE SET
              username =
                EXCLUDED.username,

              first_name =
                EXCLUDED.first_name,

              updated_at =
                CURRENT_TIMESTAMP
            `,
            [
              userId,
              message.from.username || null,
              message.from.first_name || null
            ]
          );

          // ----------------------------------------------
          // SAVE PAYMENT
          // ----------------------------------------------

          const paymentInsert =
            await client.query(
              `
              INSERT INTO payments (
                telegram_id,
                stars,
                credits_added,
                invoice_payload,
                telegram_payment_charge_id
              )

              VALUES (
                $1,
                $2,
                $3,
                $4,
                $5
              )

              ON CONFLICT (
                telegram_payment_charge_id
              )

              DO NOTHING

              RETURNING id
              `,
              [
                userId,
                totalAmount,
                selectedPackage.credits,
                payload,
                chargeId
              ]
            );

          // ----------------------------------------------
          // DUPLICATE PAYMENT
          // ----------------------------------------------

          if (
            paymentInsert.rows.length === 0
          ) {
            duplicatePayment = true;

            const balanceResult =
              await client.query(
                `
                SELECT credits
                FROM users
                WHERE telegram_id = $1
                `,
                [userId]
              );

            newCredits =
              balanceResult.rows[0]?.credits ?? 0;

            await client.query(
              "COMMIT"
            );

          } else {

            // ----------------------------------------------
            // ADD PURCHASED CREDITS
            // ----------------------------------------------

            await client.query(
              `
              UPDATE users

              SET
                credits =
                  credits + $1,

                updated_at =
                  CURRENT_TIMESTAMP

              WHERE telegram_id = $2
              `,
              [
                selectedPackage.credits,
                userId
              ]
            );

            // ----------------------------------------------
            // GET NEW BALANCE
            // ----------------------------------------------

            const balanceResult =
              await client.query(
                `
                SELECT credits
                FROM users
                WHERE telegram_id = $1
                `,
                [userId]
              );

            newCredits =
              balanceResult.rows[0].credits;

            await client.query(
              "COMMIT"
            );
          }

        } catch (error) {
          try {
            await client.query(
              "ROLLBACK"
            );
          } catch (rollbackError) {
            console.error(
              "[PAYMENT] Rollback error:",
              rollbackError.message
            );
          }

          console.error(
            "[PAYMENT] Processing error:",
            error.message
          );

          await sendMessage(
            chatId,
            `
⚠️ <b>Your payment was received, but credits could not be added automatically.</b>

Please contact support and do not pay again.
`
          );

          return;

        } finally {
          client.release();
        }

        // ----------------------------------------------
        // DUPLICATE PAYMENT
        // ----------------------------------------------

        if (duplicatePayment) {
          console.log(
            `[PAYMENT] Duplicate payment ignored: ${chargeId}`
          );

          await sendMessage(
            chatId,
            `
✅ This payment was already processed.

💎 Your balance: <b>${newCredits} ${creditWord(newCredits)}</b>
`
          );

          return;
        }

        // ----------------------------------------------
        // SUCCESS
        // ----------------------------------------------

        console.log(
          `[PAYMENT] User ${userId} received ${selectedPackage.credits} credits. New balance: ${newCredits}`
        );

        await sendMessage(
          chatId,
          `
✅ <b>Payment successful!</b>

⭐ Paid: <b>${totalAmount} Stars</b>
📸 Added: <b>${selectedPackage.credits} ${photoWord(selectedPackage.credits)}</b>

💎 Your new balance:
<b>${newCredits} ${creditWord(newCredits)}</b>

Send me a product photo to create your next professional image. 📸
`
        );

        return;
      }

      // ==================================================
      // CALLBACK BUTTONS
      // ==================================================

      if (update.callback_query) {
        const callback =
          update.callback_query;

        const chatId =
          callback.message.chat.id;

        const userId =
          callback.from.id;

        const data =
          callback.data;

        await answerCallbackQuery(
          callback.id
        );

        if (!users[userId]) {
          users[userId] = {};
        }

        // ==================================================
        // STYLE
        // ==================================================

        if (
          data.startsWith("style_")
        ) {
          const style =
            data.replace(
              "style_",
              ""
            );

          users[userId].style =
            style;

          log(
            `User ${userId} selected style: ${style}`
          );

          await showFormatSelector(
            chatId
          );

          return;
        }

        // ==================================================
        // FORMAT → GENERATE
        // ==================================================

        if (
          data.startsWith("format_")
        ) {
          const format =
            data.replace(
              "format_",
              ""
            );

          users[userId].format =
            format;

          const user =
            users[userId];

          if (!user.photoFileId) {
            await sendMessage(
              chatId,
              "⚠️ I can't find your product photo. Please upload it again."
            );

            return;
          }

          // ----------------------------------------------
          // CHECK CREDITS
          // ----------------------------------------------

          const creditResult =
            await pool.query(
              `
              SELECT credits
              FROM users
              WHERE telegram_id = $1
              `,
              [userId]
            );

          if (
            creditResult.rows.length === 0
          ) {
            await sendMessage(
              chatId,
              "⚠️ Please send /start first."
            );

            return;
          }

          const credits =
            creditResult.rows[0].credits;

          console.log(
            `[DATABASE] User ${userId} credits before generation: ${credits}`
          );

          // ----------------------------------------------
          // NO CREDITS
          // ----------------------------------------------

          if (credits <= 0) {
            await sendMessage(
              chatId,
              `
💎 <b>You’re out of photo credits.</b>

Choose a photo pack to continue creating professional product images.
`
            );

            await showBuyCredits(
              chatId
            );

            return;
          }

          // ----------------------------------------------
          // GENERATE
          // ----------------------------------------------

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
              await downloadTelegramPhoto(
                user.photoFileId
              );

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

            await sendPhoto(
              chatId,
              generatedPhoto
            );

            log(
              `Generated image sent to user ${userId}`
            );

            // ----------------------------------------------
            // DEDUCT CREDIT AFTER SUCCESS
            // ----------------------------------------------

            await pool.query(
              `
              UPDATE users

              SET
                credits =
                  GREATEST(
                    credits - 1,
                    0
                  ),

                free_generation_used =
                  TRUE,

                updated_at =
                  CURRENT_TIMESTAMP

              WHERE telegram_id = $1
              `,
              [userId]
            );

            const updatedBalanceResult =
              await pool.query(
                `
                SELECT credits
                FROM users
                WHERE telegram_id = $1
                `,
                [userId]
              );

            const updatedCredits =
              updatedBalanceResult.rows[0].credits;

            console.log(
              `[DATABASE] User ${userId} credit used. New balance: ${updatedCredits}`
            );

            await sendMessage(
              chatId,
              `
✅ <b>Done!</b>

💎 ${photoWord(updatedCredits) === "photo" ? "Photo" : "Photos"} remaining: <b>${updatedCredits}</b>

📸 Send another product photo to create another version.
`
            );

            if (
              updatedCredits <= 0
            ) {
              await showBuyCredits(
                chatId
              );
            }

          } catch (error) {
            console.error(
              "IMAGE GENERATION ERROR:",
              error.response?.data ||
              error.message
            );

            await sendMessage(
              chatId,
              `
⚠️ <b>I couldn't generate the image.</b>

Your credit was <b>not charged</b>.

Please try again in a moment.
`
            );
          }

          return;
        }

        // ==================================================
        // BUY PACKAGE
        // ==================================================

        if (
          data.startsWith("buy_")
        ) {
          const selectedPackage =
            PACKAGES[data];

          if (!selectedPackage) {
            await sendMessage(
              chatId,
              "⚠️ Package not found."
            );

            return;
          }

          await axios.post(
            `${TELEGRAM_URL}/sendInvoice`,
            {
              chat_id: chatId,

              title:
                selectedPackage.title,

              description:
                `${selectedPackage.credits} professional AI product photos`,

              payload:
                selectedPackage.payload,

              provider_token: "",

              currency: "XTR",

              prices: [
                {
                  label:
                    `${selectedPackage.credits} AI Product Photos`,

                  amount:
                    selectedPackage.stars
                }
              ]
            }
          );

          console.log(
            `[PAYMENT] Invoice sent to user ${userId}: ${selectedPackage.credits} credits for ${selectedPackage.stars} Stars`
          );

          return;
        }

        return;
      }

      // ==================================================
      // NORMAL MESSAGE
      // ==================================================

      const message =
        update.message;

      if (!message) {
        return;
      }

      const chatId =
        message.chat.id;

      const userId =
        message.from.id;

      if (!users[userId]) {
        users[userId] = {};
      }

      // ==================================================
      // /START
      // ==================================================

      if (
        message.text &&
        message.text
          .trim()
          .toLowerCase()
          .startsWith("/start")
      ) {
        log(
          `User ${userId} started the bot`
        );

        await pool.query(
          `
          INSERT INTO users (
            telegram_id,
            username,
            first_name
          )

          VALUES (
            $1,
            $2,
            $3
          )

          ON CONFLICT (
            telegram_id
          )

          DO UPDATE SET
            username =
              EXCLUDED.username,

            first_name =
              EXCLUDED.first_name,

            updated_at =
              CURRENT_TIMESTAMP
          `,
          [
            userId,
            message.from.username || null,
            message.from.first_name || null
          ]
        );

        console.log(
          `[DATABASE] User ${userId} saved`
        );

        const userResult =
          await pool.query(
            `
            SELECT credits
            FROM users
            WHERE telegram_id = $1
            `,
            [userId]
          );

        const credits =
          userResult.rows[0].credits;

        console.log(
          `[DATABASE] User ${userId} balance: ${credits}`
        );

        await showStart(
          chatId
        );

        // ==================================================
        // BALANCE / PURCHASE LOGIC
        // ==================================================

        if (credits > 0) {
          await sendMessage(
            chatId,
            `💎 Your balance: <b>${credits} ${creditWord(credits)}</b>`
          );

        } else {
          await sendMessage(
            chatId,
            `
💎 You currently have <b>0 photo credits</b>.

Choose a photo pack below to continue creating images.
`
          );

          await showBuyCredits(
            chatId
          );
        }

        return;
      }

      // ==================================================
      // PHOTO
      // ==================================================

      if (
        message.photo &&
        message.photo.length > 0
      ) {
        const largestPhoto =
          message.photo[
            message.photo.length - 1
          ];

        users[userId].photoFileId =
          largestPhoto.file_id;

        users[userId].style =
          null;

        users[userId].format =
          null;

        log(
          `Photo received from user ${userId}`
        );

        await showStyleSelector(
          chatId
        );

        return;
      }

      // ==================================================
      // FALLBACK
      // ==================================================

      await sendMessage(
        chatId,
        `
📸 Please send me a photo of your product.

I'll turn it into a professional advertising image.
`
      );

    } catch (error) {
      console.error(
        "Webhook error:",
        error.response?.data ||
        error.message
      );
    }
  }
);

// ======================================================
// HEALTH CHECK
// ======================================================

app.get(
  "/",
  (req, res) => {
    res.send(
      "AI Product Photo Bot is running."
    );
  }
);

// ======================================================
// START SERVER
// ======================================================

const PORT =
  process.env.PORT || 3000;

app.listen(
  PORT,
  () => {
    log(
      `Server running on port ${PORT}`
    );
  }
);
