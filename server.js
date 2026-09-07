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

function getModeName(mode) {
  const names = {
    product: "Product Photo",
    collage: "Ad Collage",
    person: "Product on Person",
    social: "Social Media Creative"
  };

  return names[mode] || "Product Photo";
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

Turn an ordinary product photo into professional advertising content.

📸 Upload a photo of your product.

You can create:

✨ Professional product photos
🖼 Advertising collages
👤 Product photos with people
📱 Social media creatives

I'll keep your product recognizable and preserve people in the original photo as closely as possible.

🎁 <b>Your first generation is free.</b>

👇 Send me a product photo to begin.
`
  );
}

// ======================================================
// CREATION TYPE SELECTOR
// ======================================================

async function showCreationTypeSelector(chatId) {
  const keyboard = {
    inline_keyboard: [
      [
        {
          text: "📸 Product Photo",
          callback_data: "mode_product"
        }
      ],

      [
        {
          text: "🖼 Ad Collage · 3 Photos",
          callback_data: "mode_collage"
        }
      ],

      [
        {
          text: "👤 Product on Person",
          callback_data: "mode_person"
        }
      ],

      [
        {
          text: "📱 Social Media Creative",
          callback_data: "mode_social"
        }
      ]
    ]
  };

  await sendMessage(
    chatId,
    `
✨ <b>What would you like to create?</b>

📸 <b>Product Photo</b>
A professional advertising product image.

🖼 <b>Ad Collage</b>
A polished commercial collage with 3 different product shots.

👤 <b>Product on Person</b>
Best when your original photo already contains a person. Facial features, body proportions and overall identity will be preserved as closely as possible.

📱 <b>Social Media Creative</b>
Ready-to-post advertising content.

👇 Choose an option:
`,
    keyboard
  );
}

// ======================================================
// STYLE SELECTOR
// ======================================================

async function showStyleSelector(chatId, mode) {
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

  let intro = `
Great. ✅

Now choose the visual style:
`;

  if (mode === "collage") {
    intro = `
🖼 <b>Ad Collage selected</b>

I'll create one professional advertising image containing <b>3 coordinated photo panels</b>.

Now choose the overall visual style:
`;
  }

  if (mode === "person") {
    intro = `
👤 <b>Product on Person selected</b>

I'll preserve the person's facial identity, body proportions, skin tone, hair and age appearance as closely as possible.

Now choose the advertising style:
`;
  }

  await sendMessage(
    chatId,
    intro,
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

One generated collage also uses only <b>1 photo credit</b>.

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
Create a premium clean studio advertising aesthetic.
Use a minimal light neutral studio background.
Soft professional lighting.
Subtle realistic shadows.
High-end ecommerce photography.
Elegant and uncluttered.
`,

    luxury: `
Create a premium luxury advertising aesthetic.
Elegant sophisticated environment.
Cinematic premium lighting.
Refined materials.
Subtle reflections.
Luxury brand campaign feeling.
`,

    lifestyle: `
Create a realistic premium lifestyle advertising aesthetic.
Place the product naturally in an attractive real-life environment.
Professional commercial photography.
Natural believable lighting.
`,

    instagram: `
Create a bold modern social media advertising aesthetic.
Premium commercial composition suitable for Instagram.
Dynamic lighting.
Visually striking but tasteful background.
Professional brand campaign quality.
`,

    natural: `
Create a premium natural organic advertising aesthetic.
Use soft daylight.
Natural textures.
Elegant earthy atmosphere.
Professional commercial photography.
`
  };

  return styles[style] || styles.clean;
}

// ======================================================
// PERSON PRESERVATION PROMPT
// ======================================================

function getPersonPreservationPrompt() {
  return `
IMPORTANT PERSON PRESERVATION RULE:

If a real person is visible in the uploaded reference image, preserve that person's appearance and identity as faithfully as possible.

Do not redesign, reinterpret or replace the person.

Preserve:

- facial identity
- face shape
- eyes
- eyebrows
- nose
- lips
- jawline
- skin tone
- age appearance
- hairstyle
- hair color
- body shape
- body size
- body proportions
- shoulders
- waist
- arms
- legs
- natural posture characteristics

Do not:

- make the person younger or older
- make the person thinner or heavier
- change facial proportions
- change ethnicity or skin tone
- change body proportions
- change recognizable facial features
- beautify the person into a different-looking person
- replace the person's face

The person must remain clearly recognizable as the same individual from the reference image.
`;
}

// ======================================================
// PRODUCT PRESERVATION PROMPT
// ======================================================

function getProductPreservationPrompt() {
  return `
Use the uploaded image as the exact product reference.

PRODUCT PRESERVATION IS CRITICAL.

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
- packaging details
- distinctive design details

Do not invent new branding.
Do not invent product text.

The exact product from the reference image must remain clearly recognizable.
`;
}

// ======================================================
// MODE PROMPTS
// ======================================================

function getModePrompt(mode) {
  if (mode === "collage") {
    return `
CREATE ONE PROFESSIONAL ADVERTISING COLLAGE.

The final output must be ONE single image containing exactly THREE distinct coordinated photographic panels.

The collage should look like a professional commercial campaign created by a brand photographer and art director.

Use the same exact product in all three panels.

Suggested visual structure:

Panel 1:
A strong hero product shot.

Panel 2:
A closer detail-oriented product shot showing texture, craftsmanship or an important product feature.

Panel 3:
A complementary lifestyle, alternative angle or contextual advertising shot.

The three panels should feel visually connected but not identical.

Use professional spacing and composition.

Do not create a random scrapbook.
Do not create more than 3 panels.
Do not repeat the exact same framing three times.

No text.
No captions.
No prices.
No watermark.
No invented logo.
`;
  }

  if (mode === "person") {
    return `
CREATE A PROFESSIONAL COMMERCIAL PHOTO FEATURING THE PRODUCT AND THE PERSON FROM THE ORIGINAL IMAGE.

The original person must remain the same recognizable person.

Do not replace the model.
Do not redesign the face.
Do not redesign the body.

Improve only:

- professional lighting
- environment
- composition
- commercial styling
- photographic quality
- background
- presentation

The result should look like a real professional advertising photoshoot, not an AI-generated replacement person.

No text.
No watermark.
`;
  }

  return `
CREATE ONE PROFESSIONAL COMMERCIAL PRODUCT PHOTOGRAPH.

Improve only:

- presentation
- environment
- lighting
- composition
- advertising quality
- professional photographic finish

The result should look like a real high-end commercial product photoshoot.

No text.
No captions.
No watermark.
`;
}

// ======================================================
// BUILD FINAL PROMPT
// ======================================================

function buildPrompt(mode, style) {
  return `
${getProductPreservationPrompt()}

${getPersonPreservationPrompt()}

${getModePrompt(mode)}

VISUAL STYLE:

${getStylePrompt(style)}

FINAL QUALITY REQUIREMENTS:

Photorealistic.
Professional commercial photography.
Sharp important product details.
Natural realistic lighting.
Realistic shadows.
Premium advertising quality.

Do not invent text.
Do not invent logos.
Do not distort the product.
Do not distort a person if visible.
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
  mode,
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
    buildPrompt(mode, style)
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
  imageBuffer,
  mode
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

  let caption =
    "✨ Your AI product photo is ready.";

  if (mode === "collage") {
    caption =
      "🖼 Your advertising collage is ready.";
  }

  if (mode === "person") {
    caption =
      "👤 Your professional product photo is ready.";
  }

  form.append(
    "caption",
    caption
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

        const selectedPackage =
          getPackageByPayload(payload);

        console.log(
          `[PAYMENT] Successful payment from ${userId}: ${payload}, ${totalAmount} ${currency}`
        );

        if (!selectedPackage) {
          await sendMessage(
            chatId,
            `
⚠️ <b>Payment received, but the package could not be identified.</b>

Please contact support and do not pay again.
`
          );

          return;
        }

        if (
          currency !== "XTR" ||
          totalAmount !== selectedPackage.stars
        ) {
          await sendMessage(
            chatId,
            `
⚠️ Payment could not be verified.

Please contact support and do not pay again.
`
          );

          return;
        }

        const client =
          await pool.connect();

        let newCredits = null;
        let duplicatePayment = false;

        try {
          await client.query("BEGIN");

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

            ON CONFLICT (telegram_id)

            DO UPDATE SET
              username = EXCLUDED.username,
              first_name = EXCLUDED.first_name,
              updated_at = CURRENT_TIMESTAMP
            `,
            [
              userId,
              message.from.username || null,
              message.from.first_name || null
            ]
          );

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

          if (
            paymentInsert.rows.length === 0
          ) {
            duplicatePayment = true;

          } else {
            await client.query(
              `
              UPDATE users

              SET
                credits = credits + $1,
                updated_at = CURRENT_TIMESTAMP

              WHERE telegram_id = $2
              `,
              [
                selectedPackage.credits,
                userId
              ]
            );
          }

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

          await client.query("COMMIT");

        } catch (error) {
          try {
            await client.query("ROLLBACK");
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

        if (duplicatePayment) {
          await sendMessage(
            chatId,
            `
✅ This payment was already processed.

💎 Your balance: <b>${newCredits} ${creditWord(newCredits)}</b>
`
          );

          return;
        }

        await sendMessage(
          chatId,
          `
✅ <b>Payment successful!</b>

⭐ Paid: <b>${totalAmount} Stars</b>
📸 Added: <b>${selectedPackage.credits} ${photoWord(selectedPackage.credits)}</b>

💎 Your new balance:
<b>${newCredits} ${creditWord(newCredits)}</b>

Send me a product photo to continue. 📸
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
        // MODE
        // ==================================================

        if (
          data.startsWith("mode_")
        ) {
          const mode =
            data.replace(
              "mode_",
              ""
            );

          // ----------------------------------------------
          // SOCIAL MEDIA — COMING SOON
          // ----------------------------------------------

          if (mode === "social") {
            await sendMessage(
              chatId,
              `
📱 <b>Social Media Creative</b>

This mode is coming soon.

For now, you can use <b>Product Photo</b> or <b>Ad Collage</b> to create advertising-ready content.
`
            );

            await showCreationTypeSelector(
              chatId
            );

            return;
          }

          users[userId].mode =
            mode;

          users[userId].style =
            null;

          users[userId].format =
            null;

          log(
            `User ${userId} selected mode: ${mode}`
          );

          await showStyleSelector(
            chatId,
            mode
          );

          return;
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

          if (!user.mode) {
            await showCreationTypeSelector(
              chatId
            );

            return;
          }

          if (!user.style) {
            await showStyleSelector(
              chatId,
              user.mode
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

          if (credits <= 0) {
            await sendMessage(
              chatId,
              `
💎 <b>You’re out of photo credits.</b>

Choose a photo pack to continue creating professional advertising content.
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
⏳ <b>Creating your ${getModeName(user.mode)}...</b>

Style: <b>${user.style}</b>
Format: <b>${format}</b>

This can take around 30–120 seconds.
`
          );

          log(
            `Generating for user ${userId}: mode=${user.mode}, style=${user.style}, format=${format}`
          );

          try {
            const originalPhoto =
              await downloadTelegramPhoto(
                user.photoFileId
              );

            const generatedPhoto =
              await generateProductPhoto(
                originalPhoto,
                user.mode,
                user.style,
                format
              );

            await sendPhoto(
              chatId,
              generatedPhoto,
              user.mode
            );

            // ----------------------------------------------
            // DEDUCT CREDIT
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

💎 Photos remaining: <b>${updatedCredits}</b>

📸 Send another photo to create something new.
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

Please try again.
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

        await showStart(
          chatId
        );

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

        users[userId].mode =
          null;

        users[userId].style =
          null;

        users[userId].format =
          null;

        log(
          `Photo received from user ${userId}`
        );

        await showCreationTypeSelector(
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

I'll turn it into professional advertising content.
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
