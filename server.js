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

const TELEGRAM_URL =
  `https://api.telegram.org/bot${TELEGRAM_TOKEN}`;

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

function referenceWord(count) {
  return count === 1
    ? "reference photo"
    : "reference photos";
}

function getModeName(mode) {
  const names = {
    product: "Product Photo",
    collage: "Ad Collage",
    fashion: "Fashion Collage",
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

    console.log(
      "[DATABASE] PostgreSQL connected successfully"
    );

    console.log(
      "[DATABASE] Users table ready"
    );

    console.log(
      "[DATABASE] Payments table ready"
    );

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
// SESSION HELPER
// ======================================================

function getSession(userId) {
  if (!users[userId]) {
    users[userId] = {
      photoFileIds: [],
      collectingReferences: false,
      mode: null,
      style: null,
      format: null
    };
  }

  return users[userId];
}

function resetCreativeSettings(session) {
  session.mode = null;
  session.style = null;
  session.format = null;
}

// ======================================================
// LOGGING
// ======================================================

function log(message) {
  console.log(
    `[PRODUCT PHOTO BOT] ${message}`
  );
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
        callback_query_id:
          callbackQueryId
      }
    );

  } catch (error) {
    console.error(
      "answerCallbackQuery error:",
      error.response?.data ||
      error.message
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

Turn ordinary product photos into professional advertising content.

📸 Upload <b>1–3 photos</b> of your product.

You can use extra photos to show:

• front view
• back view
• packaging
• important details
• another angle

Then create:

📸 Professional Product Photos
🖼 Advertising Collages
👗 Fashion Collages
👤 Product Photos with People
📱 Social Media Creatives

I'll preserve the real product and keep people recognizable as closely as possible.

🎁 <b>Your first generation is free.</b>

👇 Send your first product photo.
`
  );
}

// ======================================================
// REFERENCE PHOTO OPTIONS
// ======================================================

async function showReferenceOptions(
  chatId,
  count
) {
  const keyboard = {
    inline_keyboard: []
  };

  if (count < 3) {
    keyboard.inline_keyboard.push([
      {
        text:
          "➕ Add another reference photo",
        callback_data:
          "refs_add"
      }
    ]);
  }

  keyboard.inline_keyboard.push([
    {
      text:
        `✅ Continue with ${count} ${photoWord(count)}`,
      callback_data:
        "refs_done"
    }
  ]);

  let tip = "";

  if (count === 1) {
    tip = `
You can continue now, or add another view.

For example:
<b>front + back</b>
or
<b>full product + detail</b>
`;
  }

  if (count === 2) {
    tip = `
Great. You can continue now or add one final detail/reference photo.
`;
  }

  await sendMessage(
    chatId,
    `
✅ <b>${count} ${referenceWord(count)} saved.</b>

${tip}

You can use up to <b>3 reference photos</b>.
`,
    keyboard
  );
}

// ======================================================
// CREATION TYPE SELECTOR
// ======================================================

async function showCreationTypeSelector(
  chatId
) {
  const keyboard = {
    inline_keyboard: [
      [
        {
          text:
            "📸 Product Photo",
          callback_data:
            "mode_product"
        }
      ],

      [
        {
          text:
            "🖼 Ad Collage · 3 Shots",
          callback_data:
            "mode_collage"
        }
      ],

      [
        {
          text:
            "👗 Fashion Collage",
          callback_data:
            "mode_fashion"
        }
      ],

      [
        {
          text:
            "👤 Product on Person",
          callback_data:
            "mode_person"
        }
      ],

      [
        {
          text:
            "📱 Social Media Creative",
          callback_data:
            "mode_social"
        }
      ]
    ]
  };

  await sendMessage(
    chatId,
    `
✨ <b>What would you like to create?</b>

📸 <b>Product Photo</b>
One professional advertising image.

🖼 <b>Ad Collage</b>
Three coordinated commercial shots in one image.

👗 <b>Fashion Collage</b>
Designed for clothing, accessories and fashion products.

👤 <b>Product on Person</b>
Keeps the real person's identity and body as consistent as possible.

📱 <b>Social Media Creative</b>
A polished visual ready for Instagram, Stories or advertising.

👇 Choose an option:
`,
    keyboard
  );
}

// ======================================================
// STYLE SELECTOR
// ======================================================

async function showStyleSelector(
  chatId,
  mode
) {
  const keyboard = {
    inline_keyboard: [
      [
        {
          text:
            "🤍 Clean Studio",
          callback_data:
            "style_clean"
        },

        {
          text:
            "✨ Luxury",
          callback_data:
            "style_luxury"
        }
      ],

      [
        {
          text:
            "🏠 Lifestyle",
          callback_data:
            "style_lifestyle"
        },

        {
          text:
            "📱 Instagram Ad",
          callback_data:
            "style_instagram"
        }
      ],

      [
        {
          text:
            "🌿 Natural",
          callback_data:
            "style_natural"
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

I'll create one professional advertising image containing exactly <b>3 coordinated shots</b>.

Now choose the overall visual style:
`;
  }

  if (mode === "fashion") {
    intro = `
👗 <b>Fashion Collage selected</b>

The collage will focus on:

• full fashion view
• product/detail close-up
• alternative pose or back view when supplied

Now choose the visual style:
`;
  }

  if (mode === "person") {
    intro = `
👤 <b>Product on Person selected</b>

I'll preserve the person's:

• facial identity
• face shape
• body proportions
• skin tone
• hair
• age appearance

as closely as possible.

Now choose the advertising style:
`;
  }

  if (mode === "social") {
    intro = `
📱 <b>Social Media Creative selected</b>

I'll create a polished advertising visual designed to stand out on social media.

Now choose the visual style:
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

async function showFormatSelector(
  chatId
) {
  const keyboard = {
    inline_keyboard: [
      [
        {
          text:
            "⬜ Square 1:1",
          callback_data:
            "format_square"
        }
      ],

      [
        {
          text:
            "📱 Instagram 4:5",
          callback_data:
            "format_portrait"
        }
      ],

      [
        {
          text:
            "🎬 Story / Reels 9:16",
          callback_data:
            "format_story"
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
          text:
            "⭐ 7 Photos · 275 Stars · ≈ €6.25",
          callback_data:
            "buy_7"
        }
      ],

      [
        {
          text:
            "✨ 20 Photos · 750 Stars · ≈ €17",
          callback_data:
            "buy_20"
        }
      ],

      [
        {
          text:
            "🔥 50 Photos · 1,800 Stars · ≈ €41",
          callback_data:
            "buy_50"
        }
      ]
    ]
  };

  await sendMessage(
    chatId,
    `
✨ <b>Choose your photo pack</b>

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

🖼 A collage is one finished image and uses only <b>1 photo credit</b>.

💎 Your credits never expire.

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

Use:
- minimal neutral background
- soft professional lighting
- subtle realistic shadows
- elegant ecommerce photography
- uncluttered styling
`,

    luxury: `
Create a premium luxury campaign aesthetic.

Use:
- sophisticated environment
- cinematic premium lighting
- elegant materials
- tasteful reflections
- luxury-brand advertising quality
`,

    lifestyle: `
Create a realistic premium lifestyle advertising aesthetic.

Use:
- believable real-life environment
- natural product placement
- realistic commercial photography
- natural professional lighting
`,

    instagram: `
Create a bold modern social-media advertising aesthetic.

Use:
- eye-catching composition
- premium commercial styling
- dynamic lighting
- visually striking but tasteful environment
- high-end Instagram campaign quality
`,

    natural: `
Create a premium natural organic advertising aesthetic.

Use:
- soft daylight
- natural materials
- subtle earthy textures
- elegant organic atmosphere
- professional commercial photography
`
  };

  return styles[style] ||
    styles.clean;
}

// ======================================================
// MULTI-REFERENCE PROMPT
// ======================================================

function getReferencePrompt(
  referenceCount
) {
  if (referenceCount <= 1) {
    return `
REFERENCE IMAGE RULES:

The uploaded image is the primary visual truth for the real product and any person visible in it.
`;
  }

  return `
MULTIPLE REFERENCE IMAGE RULES:

You are receiving ${referenceCount} reference images.

Treat them as different views or details of the SAME real product unless the visual evidence clearly indicates otherwise.

Reference image 1 is the PRIMARY composition and identity reference.

Reference images 2 and 3 may provide additional factual information such as:

- back design
- side view
- print
- logo
- packaging
- stitching
- product detail
- texture
- shape
- alternative angle

Combine factual product information from the references.

DO NOT merge different views incorrectly.

DO NOT invent a back design if a back reference is supplied.

DO NOT replace a supplied real detail with a newly imagined detail.

When the same person appears in multiple references, treat them as the SAME real person.
`;
}

// ======================================================
// PRODUCT PRESERVATION
// ======================================================

function getProductPreservationPrompt() {
  return `
PRODUCT PRESERVATION IS CRITICAL.

Preserve the exact real product.

Do not redesign it.

Preserve:

- brand identity
- logos
- artwork
- print placement
- product colors
- product shape
- proportions
- materials
- texture
- stitching
- labels
- packaging
- distinctive visual details

Do not invent product text.
Do not invent logos.
Do not simplify or replace important artwork.

If a reference image clearly shows the front or back of the product, reproduce that specific design faithfully when that view is used.

The product must remain clearly recognizable as the original real product.
`;
}

// ======================================================
// PERSON PRESERVATION
// ======================================================

function getPersonPreservationPrompt() {
  return `
PERSON IDENTITY PRESERVATION IS CRITICAL WHEN A PERSON IS PRESENT.

The person must remain the same recognizable real individual.

Preserve:

- facial identity
- face shape
- forehead
- eyes
- eyebrows
- nose
- cheeks
- lips
- jawline
- chin
- skin tone
- age appearance
- hairstyle
- hair color
- body type
- height impression
- shoulders
- waist
- arms
- legs
- body size
- body proportions

Do not:

- replace the face
- create a different model
- beautify the face into another person
- change ethnicity
- change skin tone
- change age
- make the body thinner
- make the body heavier
- exaggerate curves
- modify facial proportions
- redesign distinctive facial features

Natural changes in pose are allowed only if identity remains strongly consistent.

When a person appears in multiple generated panels, they must look like the SAME person photographed during one real professional photoshoot.
`;
}

// ======================================================
// MODE PROMPTS
// ======================================================

function getModePrompt(
  mode,
  referenceCount
) {
  if (mode === "collage") {
    return `
CREATE ONE PROFESSIONAL ADVERTISING COLLAGE.

The final output must be ONE single image containing exactly THREE distinct photographic panels.

The collage must look like one coordinated professional brand photoshoot.

Use the SAME real product throughout.

If a person is visible in the source:

USE THE SAME PERSON IN ALL THREE PANELS.

The person's identity must remain visually consistent across all panels.

Do not generate three different interpretations of the same person.

Recommended structure:

PANEL 1 — HERO
A strong full or three-quarter advertising shot.

PANEL 2 — DETAIL
A closer product shot focused on an important real detail, print, texture, logo or craftsmanship.

PANEL 3 — CONTEXT
A complementary lifestyle shot, alternative pose or alternative angle.

If multiple product references were supplied, use the factual details they provide.

${referenceCount > 1
  ? `
If one reference shows the back or another unique product angle, you may use that exact supplied view in the most appropriate panel.
`
  : ""}

Do not create more than 3 panels.

Do not create a scrapbook.

Do not repeat exactly the same framing.

Use elegant spacing and professional layout.

No text.
No prices.
No captions.
No watermark.
`;
  }

  if (mode === "fashion") {
    return `
CREATE ONE PROFESSIONAL THREE-PANEL FASHION ADVERTISING COLLAGE.

The output must be ONE image containing exactly THREE photographic panels.

This mode is specifically designed for:

- T-shirts
- dresses
- hoodies
- jackets
- bags
- footwear
- jewelry
- fashion accessories

Use the SAME garment/product throughout all three panels.

If a person is present, use the SAME recognizable person throughout.

PANEL 1 — FULL FASHION VIEW
Show the full styling, silhouette, fit and overall appearance.

PANEL 2 — PRODUCT DETAIL
Show the print, fabric, logo, texture, stitching, accessory detail or craftsmanship.

PANEL 3 — ALTERNATIVE VIEW
Show another natural pose, angle, lifestyle moment or back view.

VERY IMPORTANT:

If one of the supplied reference images shows the BACK of the garment/product:

Use that exact real back design for Panel 3 where appropriate.

Do not invent a different back print.

Do not mirror the front artwork onto the back.

Do not invent unseen artwork.

If no back reference is provided, use an alternative front/side pose instead of fabricating the back.

Maintain professional fashion editorial consistency across all three panels.

No text.
No price tags.
No watermark.
`;
  }

  if (mode === "person") {
    return `
CREATE ONE PROFESSIONAL COMMERCIAL PRODUCT-ON-PERSON PHOTO.

If a person is present in the reference image, that exact person is the identity reference.

Do not replace them with another model.

Keep the real product accurately represented.

You may improve:

- environment
- professional lighting
- background
- composition
- pose presentation
- photographic quality

Do not significantly alter the person's natural appearance.

The result should look like the same real person photographed during a professional commercial photoshoot.

If no person exists in any supplied reference, create a tasteful commercial human-model context while preserving the exact real product.

No text.
No watermark.
`;
  }

  if (mode === "social") {
    return `
CREATE ONE PREMIUM SOCIAL MEDIA ADVERTISING CREATIVE.

The result should be immediately usable as a visual for:

- Instagram
- Facebook
- social advertising
- Stories
- Reels cover imagery

Prioritize:

- strong visual hierarchy
- product visibility
- scroll-stopping composition
- polished commercial lighting
- premium brand aesthetic

Do NOT add advertising copy.

Do NOT invent captions, slogans or prices.

Leave visually useful negative space where appropriate so text could be added later externally.

Preserve any person and product faithfully.

No watermark.
`;
  }

  return `
CREATE ONE PROFESSIONAL COMMERCIAL PRODUCT PHOTOGRAPH.

Keep the real product as the hero.

Improve only:

- presentation
- setting
- lighting
- composition
- visual polish
- advertising quality

If a person exists in the source, preserve that real person's identity.

The result should look like a genuine professional commercial photoshoot.

No text.
No captions.
No watermark.
`;
}

// ======================================================
// BUILD FINAL PROMPT
// ======================================================

function buildPrompt(
  mode,
  style,
  referenceCount
) {
  return `
${getReferencePrompt(referenceCount)}

${getProductPreservationPrompt()}

${getPersonPreservationPrompt()}

CREATIVE TASK:

${getModePrompt(
  mode,
  referenceCount
)}

VISUAL STYLE:

${getStylePrompt(style)}

FINAL QUALITY:

Photorealistic.
Premium commercial photography.
Natural realistic skin if a person is present.
Sharp important product details.
Realistic fabric and materials.
Professional lighting.
Realistic shadows.
High-end advertising finish.

Do not distort the product.

Do not replace a real person's identity.

Do not invent text.

Do not invent logos.

Do not add watermark.
`;
}

// ======================================================
// DOWNLOAD TELEGRAM PHOTO
// ======================================================

async function downloadTelegramPhoto(
  fileId
) {
  const fileResponse =
    await axios.get(
      `${TELEGRAM_URL}/getFile`,
      {
        params: {
          file_id: fileId
        }
      }
    );

  const filePath =
    fileResponse
      .data
      .result
      .file_path;

  const fileUrl =
    `https://api.telegram.org/file/bot${TELEGRAM_TOKEN}/${filePath}`;

  const imageResponse =
    await axios.get(
      fileUrl,
      {
        responseType:
          "arraybuffer"
      }
    );

  return Buffer.from(
    imageResponse.data
  );
}

// ======================================================
// DOWNLOAD ALL REFERENCES
// ======================================================

async function downloadReferencePhotos(
  fileIds
) {
  const buffers = [];

  for (
    let index = 0;
    index < fileIds.length;
    index++
  ) {
    const buffer =
      await downloadTelegramPhoto(
        fileIds[index]
      );

    buffers.push(buffer);
  }

  return buffers;
}

// ======================================================
// OPENAI IMAGE GENERATION
// ======================================================

async function generateProductPhoto(
  photoBuffers,
  mode,
  style,
  format
) {
  const form =
    new FormData();

  form.append(
    "model",
    "gpt-image-2"
  );

  photoBuffers.forEach(
    (buffer, index) => {
      form.append(
        "image[]",
        buffer,
        {
          filename:
            `reference-${index + 1}.jpg`,
          contentType:
            "image/jpeg"
        }
      );
    }
  );

  form.append(
    "prompt",
    buildPrompt(
      mode,
      style,
      photoBuffers.length
    )
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

  const response =
    await axios.post(
      "https://api.openai.com/v1/images/edits",
      form,
      {
        headers: {
          Authorization:
            `Bearer ${OPENAI_KEY}`,

          ...form.getHeaders()
        },

        timeout: 180000,

        maxContentLength:
          Infinity,

        maxBodyLength:
          Infinity
      }
    );

  const imageBase64 =
    response
      .data
      ?.data
      ?.[0]
      ?.b64_json;

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
  const form =
    new FormData();

  form.append(
    "chat_id",
    String(chatId)
  );

  form.append(
    "photo",
    imageBuffer,
    {
      filename:
        "product-photo.jpg",

      contentType:
        "image/jpeg"
    }
  );

  let caption =
    "✨ Your AI product photo is ready.";

  if (mode === "collage") {
    caption =
      "🖼 Your advertising collage is ready.";
  }

  if (mode === "fashion") {
    caption =
      "👗 Your fashion advertising collage is ready.";
  }

  if (mode === "person") {
    caption =
      "👤 Your professional product-on-person photo is ready.";
  }

  if (mode === "social") {
    caption =
      "📱 Your social media creative is ready.";
  }

  form.append(
    "caption",
    caption
  );

  await axios.post(
    `${TELEGRAM_URL}/sendPhoto`,
    form,
    {
      headers:
        form.getHeaders(),

      maxContentLength:
        Infinity,

      maxBodyLength:
        Infinity
    }
  );
}

// ======================================================
// RESERVE CREDIT
// ======================================================

async function reserveCredit(userId) {
  const result =
    await pool.query(
      `
      UPDATE users

      SET
        credits = credits - 1,
        updated_at = CURRENT_TIMESTAMP

      WHERE
        telegram_id = $1
        AND credits > 0

      RETURNING credits
      `,
      [userId]
    );

  if (
    result.rows.length === 0
  ) {
    return null;
  }

  return result
    .rows[0]
    .credits;
}

// ======================================================
// REFUND CREDIT
// ======================================================

async function refundCredit(userId) {
  await pool.query(
    `
    UPDATE users

    SET
      credits = credits + 1,
      updated_at = CURRENT_TIMESTAMP

    WHERE telegram_id = $1
    `,
    [userId]
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
      const update =
        req.body;

      // ==================================================
      // PRE-CHECKOUT
      // ==================================================

      if (
        update.pre_checkout_query
      ) {
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
              pre_checkout_query_id:
                query.id,

              ok: false,

              error_message:
                "This package could not be verified. Please try again."
            }
          );

          return;
        }

        if (
          query.currency !== "XTR"
        ) {
          await axios.post(
            `${TELEGRAM_URL}/answerPreCheckoutQuery`,
            {
              pre_checkout_query_id:
                query.id,

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
              pre_checkout_query_id:
                query.id,

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
      // SUCCESSFUL PAYMENT
      // ==================================================

      if (
        update.message
          ?.successful_payment
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
          getPackageByPayload(
            payload
          );

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
          totalAmount !==
            selectedPackage.stars
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

        let newCredits = 0;
        let duplicatePayment =
          false;

        try {
          await client.query(
            "BEGIN"
          );

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

              message.from
                .username || null,

              message.from
                .first_name || null
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
            paymentInsert
              .rows
              .length === 0
          ) {
            duplicatePayment =
              true;

          } else {
            await client.query(
              `
              UPDATE users

              SET
                credits =
                  credits + $1,

                updated_at =
                  CURRENT_TIMESTAMP

              WHERE
                telegram_id = $2
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

              WHERE
                telegram_id = $1
              `,
              [userId]
            );

          newCredits =
            balanceResult
              .rows[0]
              ?.credits ?? 0;

          await client.query(
            "COMMIT"
          );

        } catch (error) {
          try {
            await client.query(
              "ROLLBACK"
            );

          } catch (
            rollbackError
          ) {
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

        if (
          duplicatePayment
        ) {
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
      // CALLBACKS
      // ==================================================

      if (
        update.callback_query
      ) {
        const callback =
          update.callback_query;

        const chatId =
          callback.message.chat.id;

        const userId =
          callback.from.id;

        const data =
          callback.data;

        const session =
          getSession(userId);

        await answerCallbackQuery(
          callback.id
        );

        // ==================================================
        // ADD ANOTHER REFERENCE
        // ==================================================

        if (
          data === "refs_add"
        ) {
          if (
            session.photoFileIds
              .length >= 3
          ) {
            await sendMessage(
              chatId,
              `
✅ You already have the maximum of <b>3 reference photos</b>.

Let's continue.
`
            );

            session.collectingReferences =
              false;

            await showCreationTypeSelector(
              chatId
            );

            return;
          }

          session.collectingReferences =
            true;

          await sendMessage(
            chatId,
            `
➕ <b>Send another reference photo.</b>

Good examples:

👕 Back of the product
🔎 Close-up detail
📦 Packaging
📸 Another angle

Send the photo now.
`
          );

          return;
        }

        // ==================================================
        // REFERENCES DONE
        // ==================================================

        if (
          data === "refs_done"
        ) {
          if (
            session.photoFileIds
              .length === 0
          ) {
            await sendMessage(
              chatId,
              "📸 Please upload your product photo first."
            );

            return;
          }

          session.collectingReferences =
            false;

          await showCreationTypeSelector(
            chatId
          );

          return;
        }

        // ==================================================
        // MODE
        // ==================================================

        if (
          data.startsWith(
            "mode_"
          )
        ) {
          const mode =
            data.replace(
              "mode_",
              ""
            );

          session.mode =
            mode;

          session.style =
            null;

          session.format =
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
          data.startsWith(
            "style_"
          )
        ) {
          const style =
            data.replace(
              "style_",
              ""
            );

          session.style =
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
          data.startsWith(
            "format_"
          )
        ) {
          const format =
            data.replace(
              "format_",
              ""
            );

          session.format =
            format;

          if (
            !session.photoFileIds ||
            session.photoFileIds
              .length === 0
          ) {
            await sendMessage(
              chatId,
              "⚠️ I can't find your product photos. Please upload them again."
            );

            return;
          }

          if (!session.mode) {
            await showCreationTypeSelector(
              chatId
            );

            return;
          }

          if (!session.style) {
            await showStyleSelector(
              chatId,
              session.mode
            );

            return;
          }

          // ----------------------------------------------
          // RESERVE CREDIT ATOMICALLY
          // ----------------------------------------------

          const balanceAfterReserve =
            await reserveCredit(
              userId
            );

          if (
            balanceAfterReserve ===
            null
          ) {
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

          console.log(
            `[DATABASE] User ${userId} reserved 1 credit. Balance now: ${balanceAfterReserve}`
          );

          // ----------------------------------------------
          // GENERATE
          // ----------------------------------------------

          await sendMessage(
            chatId,
            `
⏳ <b>Creating your ${getModeName(session.mode)}...</b>

References: <b>${session.photoFileIds.length}</b>
Style: <b>${session.style}</b>
Format: <b>${format}</b>

This can take around 30–120 seconds.
`
          );

          log(
            `Generating for user ${userId}: mode=${session.mode}, style=${session.style}, format=${format}, refs=${session.photoFileIds.length}`
          );

          let outputDelivered =
            false;

          try {
            const referencePhotos =
              await downloadReferencePhotos(
                session.photoFileIds
              );

            log(
              `Downloaded ${referencePhotos.length} reference image(s) for user ${userId}`
            );

            const generatedPhoto =
              await generateProductPhoto(
                referencePhotos,
                session.mode,
                session.style,
                format
              );

            log(
              `OpenAI generation completed for user ${userId}`
            );

            await sendPhoto(
              chatId,
              generatedPhoto,
              session.mode
            );

            outputDelivered =
              true;

            log(
              `Generated image delivered to user ${userId}`
            );

            await pool.query(
              `
              UPDATE users

              SET
                free_generation_used =
                  TRUE,

                updated_at =
                  CURRENT_TIMESTAMP

              WHERE
                telegram_id = $1
              `,
              [userId]
            );

          } catch (error) {
            console.error(
              "IMAGE GENERATION ERROR:",
              error.response?.data ||
              error.message
            );

            if (!outputDelivered) {
              try {
                await refundCredit(
                  userId
                );

                console.log(
                  `[DATABASE] Refunded 1 credit to user ${userId}`
                );

              } catch (
                refundError
              ) {
                console.error(
                  "[DATABASE] CREDIT REFUND ERROR:",
                  refundError.message
                );
              }
            }

            await sendMessage(
              chatId,
              `
⚠️ <b>I couldn't generate the image.</b>

Your credit was <b>returned</b>.

Please try again.
`
            );

            return;
          }

          // ----------------------------------------------
          // FINAL BALANCE
          // ----------------------------------------------

          const updatedBalanceResult =
            await pool.query(
              `
              SELECT credits

              FROM users

              WHERE
                telegram_id = $1
              `,
              [userId]
            );

          const updatedCredits =
            updatedBalanceResult
              .rows[0]
              ?.credits ?? 0;

          await sendMessage(
            chatId,
            `
✅ <b>Done!</b>

💎 Photos remaining: <b>${updatedCredits}</b>

📸 Send a new product photo to start another creation.
`
          );

          if (
            updatedCredits <= 0
          ) {
            await showBuyCredits(
              chatId
            );
          }

          return;
        }

        // ==================================================
        // BUY PACKAGE
        // ==================================================

        if (
          data.startsWith(
            "buy_"
          )
        ) {
          const selectedPackage =
            PACKAGES[data];

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
              chat_id:
                chatId,

              title:
                selectedPackage.title,

              description:
                `${selectedPackage.credits} professional AI product photos`,

              payload:
                selectedPackage.payload,

              provider_token:
                "",

              currency:
                "XTR",

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

      const session =
        getSession(userId);

      // ==================================================
      // /START
      // ==================================================

      if (
        message.text &&
        message.text
          .trim()
          .toLowerCase()
          .startsWith(
            "/start"
          )
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

            message.from
              .username || null,

            message.from
              .first_name || null
          ]
        );

        const userResult =
          await pool.query(
            `
            SELECT credits

            FROM users

            WHERE
              telegram_id = $1
            `,
            [userId]
          );

        const credits =
          userResult
            .rows[0]
            .credits;

        session.photoFileIds =
          [];

        session.collectingReferences =
          false;

        resetCreativeSettings(
          session
        );

        await showStart(
          chatId
        );

        if (
          credits > 0
        ) {
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
        message.photo.length >
          0
      ) {
        const largestPhoto =
          message.photo[
            message.photo.length -
              1
          ];

        // ----------------------------------------------
        // NEW PROJECT
        // ----------------------------------------------

        if (
          !session
            .collectingReferences
        ) {
          session.photoFileIds =
            [
              largestPhoto.file_id
            ];

          session.collectingReferences =
            true;

          resetCreativeSettings(
            session
          );

          log(
            `New project photo received from user ${userId}`
          );

          await showReferenceOptions(
            chatId,
            1
          );

          return;
        }

        // ----------------------------------------------
        // ADDITIONAL REFERENCE
        // ----------------------------------------------

        if (
          session.photoFileIds
            .length >= 3
        ) {
          await sendMessage(
            chatId,
            `
✅ You already have <b>3 reference photos</b>, which is the maximum.

Let's continue.
`
          );

          session.collectingReferences =
            false;

          await showCreationTypeSelector(
            chatId
          );

          return;
        }

        session.photoFileIds.push(
          largestPhoto.file_id
        );

        resetCreativeSettings(
          session
        );

        const count =
          session.photoFileIds
            .length;

        log(
          `Additional reference photo received from user ${userId}. Total: ${count}`
        );

        if (count >= 3) {
          session.collectingReferences =
            false;

          await sendMessage(
            chatId,
            `
✅ <b>3 reference photos saved.</b>

Perfect — I now have the maximum number of references.
`
          );

          await showCreationTypeSelector(
            chatId
          );

          return;
        }

        await showReferenceOptions(
          chatId,
          count
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

You can upload up to <b>3 reference photos</b> — for example front, back and detail.

I'll turn them into professional advertising content.
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
