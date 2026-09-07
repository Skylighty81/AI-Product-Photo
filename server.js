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

async function sendMessage(chatId, text, replyMarkup = null) {
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

async function answerCallbackQuery(callbackQueryId) {
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

<b>Your first generation is free.</b>

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
// BUY CREDITS SCREEN
// ======================================================

async function showBuyCredits(chatId) {
  const keyboard = {
    inline_keyboard: [
      [
        {
          text: "⭐ 75 — 5 images",
          callback_data: "buy_5"
        }
      ],
      [
        {
          text: "⭐ 180 — 15 images",
          callback_data: "buy_15"
        }
      ],
      [
        {
          text: "⭐ 390 — 40 images",
          callback_data: "buy_40"
        }
      ]
    ]
  };

  await sendMessage(
    chatId,
    `
💎 <b>Buy credits</b>

Choose the package that works for you:

⭐ <b>75 Stars</b> — 5 images
⭐ <b>180 Stars</b> — 15 images
⭐ <b>390 Stars</b> — 40 images

Your credits never expire.
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

  return Buffer.from(imageResponse.data);
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

    // Telegram gets HTTP 200 immediately.
    res.sendStatus(200);

    try {
      const update = req.body;

      // ==================================================
      // TELEGRAM STARS — PRE-CHECKOUT
      // ==================================================

      if (update.pre_checkout_query) {
        const query =
          update.pre_checkout_query;

        console.log(
          `[PAYMENT] Pre-checkout from user ${query.from.id}: ${query.invoice_payload}`
        );

        await axios.post(
          `${TELEGRAM_URL}/answerPreCheckoutQuery`,
          {
            pre_checkout_query_id:
              query.id,

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

      if (update.message?.successful_payment) {
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

        const packages = {

          credits_5: {
            credits: 5,
            stars: 75
          },

          credits_15: {
            credits: 15,
            stars: 180
          },

          credits_40: {
            credits: 40,
            stars: 390
          }
        };

        const selectedPackage =
          packages[payload];

        // ----------------------------------------------
        // SAFETY CHECK 1 — KNOWN PACKAGE
        // ----------------------------------------------

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

        // ----------------------------------------------
        // SAFETY CHECK 2 — CURRENCY
        // ----------------------------------------------

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

        // ----------------------------------------------
        // SAFETY CHECK 3 — AMOUNT
        // ----------------------------------------------

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

        try {
          await client.query(
            "BEGIN"
          );

          // ----------------------------------------------
          // DUPLICATE PAYMENT PROTECTION
          // ----------------------------------------------

          const existingPayment =
            await client.query(
              `
              SELECT id
              FROM payments
              WHERE telegram_payment_charge_id = $1
              `,
              [chargeId]
            );

          if (
            existingPayment.rows.length > 0
          ) {
            await client.query(
              "ROLLBACK"
            );

            console.log(
              `[PAYMENT] Duplicate payment ignored: ${chargeId}`
            );

            const balanceResult =
              await pool.query(
                `
                SELECT credits
                FROM users
                WHERE telegram_id = $1
                `,
                [userId]
              );

            const currentCredits =
              balanceResult.rows[0]?.credits ?? 0;

            await sendMessage(
              chatId,
              `
✅ This payment was already processed.

💎 Your balance: <b>${currentCredits} credits</b>
`
            );

            return;
          }

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
              message.from.username ||
                null,
              message.from.first_name ||
                null
            ]
          );

          // ----------------------------------------------
          // SAVE PAYMENT
          // ----------------------------------------------

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
          // ADD CREDITS
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

          const newCredits =
            balanceResult
              .rows[0]
              .credits;

          // ----------------------------------------------
          // COMMIT TRANSACTION
          // ----------------------------------------------

          await client.query(
            "COMMIT"
          );

          console.log(
            `[PAYMENT] User ${userId} received ${selectedPackage.credits} credits. New balance: ${newCredits}`
          );

          await sendMessage(
            chatId,
            `
✅ <b>Payment successful!</b>

⭐ Paid: <b>${totalAmount} Stars</b>
💎 Added: <b>${selectedPackage.credits} credits</b>

Your new balance: <b>${newCredits} credits</b>

📸 Send me a product photo to continue.
`
          );

        } catch (error) {
          await client.query(
            "ROLLBACK"
          );

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

        } finally {
          client.release();
        }

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

          if (
            !user.photoFileId
          ) {
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
            creditResult
              .rows[0]
              .credits;

          console.log(
            `[DATABASE] User ${userId} credits before generation: ${credits}`
          );

          // ----------------------------------------------
          // NO CREDITS
          // ----------------------------------------------

          if (
            credits <= 0
          ) {
            await sendMessage(
              chatId,
              "💎 <b>You’re out of credits.</b>"
            );

            await showBuyCredits(
              chatId
            );

            return;
          }

          // ----------------------------------------------
          // GENERATION
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
            // DEDUCT CREDIT ONLY AFTER SUCCESS
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
              updatedBalanceResult
                .rows[0]
                .credits;

            console.log(
              `[DATABASE] User ${userId} credit used. New balance: ${updatedCredits}`
            );

            await sendMessage(
              chatId,
              `
✅ Done!

💎 Credits remaining: <b>${updatedCredits}</b>

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
        // BUY CREDITS → TELEGRAM STARS INVOICE
        // ==================================================

        if (
          data.startsWith("buy_")
        ) {
          const packages = {

            buy_5: {
              credits: 5,
              stars: 75,
              title:
                "5 AI Product Photos"
            },

            buy_15: {
              credits: 15,
              stars: 180,
              title:
                "15 AI Product Photos"
            },

            buy_40: {
              credits: 40,
              stars: 390,
              title:
                "40 AI Product Photos"
            }
          };

          const selectedPackage =
            packages[data];

          if (
            !selectedPackage
          ) {
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
                `${selectedPackage.credits} credits for AI product photo generation`,

              payload:
                `credits_${selectedPackage.credits}`,

              provider_token: "",

              currency: "XTR",

              prices: [
                {
                  label:
                    selectedPackage.title,

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
            message.from.username ||
              null,
            message.from.first_name ||
              null
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
          userResult
            .rows[0]
            .credits;

        console.log(
          `[DATABASE] User ${userId} balance: ${credits}`
        );

        await showStart(
          chatId
        );

        await sendMessage(
          chatId,
          `💎 Your balance: <b>${credits} credit${credits === 1 ? "" : "s"}</b>`
        );

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

I'll turn it into a professional product image.
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
  process.env.PORT ||
  3000;

app.listen(
  PORT,
  () => {
    log(
      `Server running on port ${PORT}`
    );
  }
);
