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
    payload: "credits_7",
    eur: "≈ €6.25",

    title_en: "Starter — 7 AI Product Photos",
    title_ru: "Starter — 7 AI фото товара"
  },

  buy_20: {
    credits: 20,
    stars: 750,
    payload: "credits_20",
    eur: "≈ €17",

    title_en: "Creator — 20 AI Product Photos",
    title_ru: "Creator — 20 AI фото товара"
  },

  buy_50: {
    credits: 50,
    stars: 1800,
    payload: "credits_50",
    eur: "≈ €41",

    title_en: "Business — 50 AI Product Photos",
    title_ru: "Business — 50 AI фото товара"
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

function ruPhotoWord(count) {
  const mod10 = count % 10;
  const mod100 = count % 100;

  if (
    mod10 === 1 &&
    mod100 !== 11
  ) {
    return "фото";
  }

  return "фото";
}

function ruCreditWord(count) {
  const mod10 = count % 10;
  const mod100 = count % 100;

  if (
    mod10 === 1 &&
    mod100 !== 11
  ) {
    return "кредит";
  }

  if (
    mod10 >= 2 &&
    mod10 <= 4 &&
    !(
      mod100 >= 12 &&
      mod100 <= 14
    )
  ) {
    return "кредита";
  }

  return "кредитов";
}

function getModeName(mode, lang = "en") {
  const names = {
    en: {
      product: "Product Photo",
      collage: "Ad Collage",
      fashion: "Fashion Collage",
      person: "Product on Person",
      social: "Social Media Creative"
    },

    ru: {
      product: "Фото товара",
      collage: "Рекламный коллаж",
      fashion: "Fashion-коллаж",
      person: "Товар на человеке",
      social: "Креатив для соцсетей"
    }
  };

  return (
    names[lang]?.[mode] ||
    names.en.product
  );
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
        language TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Existing installations may already have the table
    // without the language column.
    await pool.query(`
      ALTER TABLE users
      ADD COLUMN IF NOT EXISTS language TEXT
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
      "[DATABASE] Language column ready"
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
// SESSION MEMORY
// ======================================================

const users = {};

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
// DATABASE USER HELPERS
// ======================================================

async function ensureUser(message) {
  const userId = message.from.id;

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
}

async function getUserData(userId) {
  const result =
    await pool.query(
      `
      SELECT
        credits,
        language

      FROM users

      WHERE
        telegram_id = $1
      `,
      [userId]
    );

  return (
    result.rows[0] || {
      credits: 0,
      language: null
    }
  );
}

async function getUserLanguage(userId) {
  const result =
    await pool.query(
      `
      SELECT language

      FROM users

      WHERE
        telegram_id = $1
      `,
      [userId]
    );

  return (
    result.rows[0]?.language ||
    "en"
  );
}

async function setUserLanguage(
  userId,
  language
) {
  await pool.query(
    `
    UPDATE users

    SET
      language = $1,
      updated_at = CURRENT_TIMESTAMP

    WHERE
      telegram_id = $2
    `,
    [
      language,
      userId
    ]
  );
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
    payload.reply_markup =
      replyMarkup;
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
// LANGUAGE SELECTOR
// ======================================================

async function showLanguageSelector(
  chatId
) {
  await sendMessage(
    chatId,
    `
🌐 <b>Choose your language</b>

🌐 <b>Выберите язык</b>
`,
    {
      inline_keyboard: [
        [
          {
            text: "🇬🇧 English",
            callback_data: "lang_en"
          },

          {
            text: "🇷🇺 Русский",
            callback_data: "lang_ru"
          }
        ]
      ]
    }
  );
}

// ======================================================
// START
// ======================================================

async function showStart(
  chatId,
  lang
) {
  if (lang === "ru") {
    await sendMessage(
      chatId,
      `
✨ <b>AI Product Photo</b>

Превратите обычные фотографии товара в профессиональный рекламный контент.

📸 Загрузите <b>1–3 фотографии</b> товара.

Дополнительные фото можно использовать, чтобы показать:

• вид спереди
• вид сзади
• упаковку
• детали
• другой ракурс

Можно создать:

📸 Профессиональное фото товара
🖼 Рекламный коллаж
👗 Fashion-коллаж
👤 Товар на человеке
📱 Креатив для социальных сетей

Я постараюсь максимально точно сохранить сам товар и внешность человека на исходной фотографии.

🎁 <b>Первая генерация бесплатно.</b>

👇 Отправьте первую фотографию товара.
`
    );

    return;
  }

  await sendMessage(
    chatId,
    `
✨ <b>AI Product Photo</b>

Turn ordinary product photos into professional advertising content.

📸 Upload <b>1–3 photos</b> of your product.

Extra photos can show:

• front view
• back view
• packaging
• important details
• another angle

You can create:

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
// BALANCE
// ======================================================

async function showBalanceOrPackages(
  chatId,
  credits,
  lang
) {
  if (credits > 0) {
    if (lang === "ru") {
      await sendMessage(
        chatId,
        `💎 Ваш баланс: <b>${credits} ${ruCreditWord(credits)}</b>`
      );

      return;
    }

    await sendMessage(
      chatId,
      `💎 Your balance: <b>${credits} ${creditWord(credits)}</b>`
    );

    return;
  }

  if (lang === "ru") {
    await sendMessage(
      chatId,
      `
💎 Сейчас у вас <b>0 кредитов</b>.

Выберите пакет, чтобы продолжить.
`
    );
  } else {
    await sendMessage(
      chatId,
      `
💎 You currently have <b>0 photo credits</b>.

Choose a photo pack below to continue.
`
    );
  }

  await showBuyCredits(
    chatId,
    lang
  );
}

// ======================================================
// REFERENCE OPTIONS
// ======================================================

async function showReferenceOptions(
  chatId,
  count,
  lang
) {
  const keyboard = {
    inline_keyboard: []
  };

  if (count < 3) {
    keyboard.inline_keyboard.push([
      {
        text:
          lang === "ru"
            ? "➕ Добавить ещё фото"
            : "➕ Add another reference photo",

        callback_data:
          "refs_add"
      }
    ]);
  }

  keyboard.inline_keyboard.push([
    {
      text:
        lang === "ru"
          ? `✅ Продолжить (${count})`
          : `✅ Continue with ${count}`,

      callback_data:
        "refs_done"
    }
  ]);

  if (lang === "ru") {
    let tip = "";

    if (count === 1) {
      tip = `
Можно продолжить сейчас или добавить ещё один ракурс.

Например:
<b>перед + спина</b>
или
<b>товар целиком + деталь</b>
`;
    }

    if (count === 2) {
      tip = `
Отлично. Можно продолжить или добавить последнюю фотографию детали / ракурса.
`;
    }

    await sendMessage(
      chatId,
      `
✅ <b>Сохранено фото: ${count}.</b>

${tip}

Можно использовать до <b>3 референсных фотографий</b>.
`,
      keyboard
    );

    return;
  }

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
✅ <b>${count} reference ${photoWord(count)} saved.</b>

${tip}

You can use up to <b>3 reference photos</b>.
`,
    keyboard
  );
}

// ======================================================
// CREATION TYPE
// ======================================================

async function showCreationTypeSelector(
  chatId,
  lang
) {
  if (lang === "ru") {
    await sendMessage(
      chatId,
      `
✨ <b>Что вы хотите создать?</b>

📸 <b>Фото товара</b>
Одно профессиональное рекламное изображение.

🖼 <b>Рекламный коллаж</b>
Три согласованных рекламных кадра в одном изображении.

👗 <b>Fashion-коллаж</b>
Для одежды, аксессуаров и fashion-товаров.

👤 <b>Товар на человеке</b>
Максимально сохраняет лицо, тело и внешность человека.

📱 <b>Креатив для соцсетей</b>
Готовый визуал для Instagram, Stories или рекламы.

👇 Выберите вариант:
`,
      {
        inline_keyboard: [
          [
            {
              text: "📸 Фото товара",
              callback_data: "mode_product"
            }
          ],

          [
            {
              text: "🖼 Рекламный коллаж · 3 кадра",
              callback_data: "mode_collage"
            }
          ],

          [
            {
              text: "👗 Fashion-коллаж",
              callback_data: "mode_fashion"
            }
          ],

          [
            {
              text: "👤 Товар на человеке",
              callback_data: "mode_person"
            }
          ],

          [
            {
              text: "📱 Креатив для соцсетей",
              callback_data: "mode_social"
            }
          ]
        ]
      }
    );

    return;
  }

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
    {
      inline_keyboard: [
        [
          {
            text: "📸 Product Photo",
            callback_data: "mode_product"
          }
        ],

        [
          {
            text: "🖼 Ad Collage · 3 Shots",
            callback_data: "mode_collage"
          }
        ],

        [
          {
            text: "👗 Fashion Collage",
            callback_data: "mode_fashion"
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
    }
  );
}

// ======================================================
// STYLE
// ======================================================

async function showStyleSelector(
  chatId,
  mode,
  lang
) {
  const keyboard = {
    inline_keyboard: [
      [
        {
          text:
            lang === "ru"
              ? "🤍 Чистая студия"
              : "🤍 Clean Studio",

          callback_data:
            "style_clean"
        },

        {
          text:
            lang === "ru"
              ? "✨ Люкс"
              : "✨ Luxury",

          callback_data:
            "style_luxury"
        }
      ],

      [
        {
          text:
            lang === "ru"
              ? "🏠 Lifestyle"
              : "🏠 Lifestyle",

          callback_data:
            "style_lifestyle"
        },

        {
          text:
            lang === "ru"
              ? "📱 Instagram-реклама"
              : "📱 Instagram Ad",

          callback_data:
            "style_instagram"
        }
      ],

      [
        {
          text:
            lang === "ru"
              ? "🌿 Натуральный"
              : "🌿 Natural",

          callback_data:
            "style_natural"
        }
      ]
    ]
  };

  if (lang === "ru") {
    let intro = `
Отлично. ✅

Теперь выберите визуальный стиль:
`;

    if (mode === "collage") {
      intro = `
🖼 <b>Рекламный коллаж</b>

Я создам одно изображение из <b>3 согласованных рекламных кадров</b>.

Выберите общий визуальный стиль:
`;
    }

    if (mode === "fashion") {
      intro = `
👗 <b>Fashion-коллаж</b>

Коллаж будет включать:

• общий fashion-кадр
• крупный план товара / детали
• альтернативную позу или реальный вид сзади, если он загружен

Выберите стиль:
`;
    }

    if (mode === "person") {
      intro = `
👤 <b>Товар на человеке</b>

Я постараюсь максимально сохранить:

• черты лица
• форму лица
• пропорции тела
• оттенок кожи
• волосы
• возраст

Выберите рекламный стиль:
`;
    }

    if (mode === "social") {
      intro = `
📱 <b>Креатив для соцсетей</b>

Создам рекламный визуал, который хорошо смотрится в социальных сетях.

Выберите стиль:
`;
    }

    await sendMessage(
      chatId,
      intro,
      keyboard
    );

    return;
  }

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
// FORMAT
// ======================================================

async function showFormatSelector(
  chatId,
  lang
) {
  await sendMessage(
    chatId,

    lang === "ru"
      ? `
Отлично. 🎨

Теперь выберите формат:
`
      : `
Perfect. 🎨

Now choose the image format:
`,

    {
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
    }
  );
}

// ======================================================
// BUY CREDITS
// ======================================================

async function showBuyCredits(
  chatId,
  lang
) {
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

  if (lang === "ru") {
    await sendMessage(
      chatId,
      `
✨ <b>Выберите пакет</b>

<b>⭐ Starter — 7 фото</b>
275 Stars · ≈ €6.25
≈ €0.89 за фото

<b>✨ Creator — 20 фото</b>
750 Stars · ≈ €17
≈ €0.85 за фото
<b>Самый популярный</b>

<b>🔥 Business — 50 фото</b>
1,800 Stars · ≈ €41
≈ €0.82 за фото
<b>Самый выгодный</b>

🖼 Один готовый коллаж считается как <b>1 кредит</b>.

💎 Кредиты не сгорают.

<i>Суммы в EUR приблизительные. Фактическая стоимость Stars в Telegram может отличаться.</i>
`,
      keyboard
    );

    return;
  }

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
// AFTER GENERATION ACTIONS
// ======================================================

async function showAfterGenerationActions(
  chatId,
  lang
) {
  if (lang === "ru") {
    await sendMessage(
      chatId,
      `
✨ <b>Что дальше?</b>
`,
      {
        inline_keyboard: [
          [
            {
              text: "🔄 Ещё один вариант",
              callback_data: "action_again"
            }
          ],

          [
            {
              text: "🎨 Изменить стиль",
              callback_data: "action_style"
            },

            {
              text: "📐 Изменить формат",
              callback_data: "action_format"
            }
          ],

          [
            {
              text: "📸 Новый товар",
              callback_data: "action_new"
            }
          ]
        ]
      }
    );

    return;
  }

  await sendMessage(
    chatId,
    `
✨ <b>What would you like to do next?</b>
`,
    {
      inline_keyboard: [
        [
          {
            text: "🔄 Another Version",
            callback_data: "action_again"
          }
        ],

        [
          {
            text: "🎨 Change Style",
            callback_data: "action_style"
          },

          {
            text: "📐 Change Format",
            callback_data: "action_format"
          }
        ],

        [
          {
            text: "📸 New Product",
            callback_data: "action_new"
          }
        ]
      ]
    }
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
// REFERENCE PROMPT
// ======================================================

function getReferencePrompt(
  referenceCount
) {
  if (referenceCount <= 1) {
    return `
REFERENCE IMAGE RULES:

The uploaded image is the primary visual truth for the real product and any real person visible in it.
`;
  }

  return `
MULTIPLE REFERENCE IMAGE RULES:

You are receiving ${referenceCount} reference images.

Treat them as different views or details of the SAME real product unless visual evidence clearly indicates otherwise.

Reference image 1 is the PRIMARY composition and identity reference.

Reference images 2 and 3 may provide factual information such as:

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

DO NOT replace a supplied real detail with an imagined detail.

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

Recommended structure:

PANEL 1 — HERO
A strong full or three-quarter advertising shot.

PANEL 2 — DETAIL
A closer product shot focused on an important real detail, print, texture, logo or craftsmanship.

PANEL 3 — CONTEXT
A complementary lifestyle shot, alternative pose or alternative angle.

If multiple references were supplied, use their real factual product details.

Do not create more than 3 panels.

Do not create a scrapbook.

Do not repeat exactly the same framing.

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

Use the SAME real garment/product throughout all three panels.

If a real person is present, use the SAME recognizable person throughout all panels.

PANEL 1 — FULL FASHION VIEW
Show the styling, silhouette, fit and overall appearance.

PANEL 2 — PRODUCT DETAIL
Show the real print, fabric, logo, texture, stitching or craftsmanship.

PANEL 3 — ALTERNATIVE VIEW
Show another natural pose, angle, lifestyle moment or real back view.

If one of the supplied reference images shows the BACK of the garment or product:

Use that exact real back design when appropriate.

Do not invent a different back print.

Do not mirror or reinterpret the front print.

If no real back reference is supplied, use another front-facing, side or three-quarter pose rather than inventing unseen artwork.

Maintain professional fashion editorial consistency.

No text.
No prices.
No watermark.
`;
  }

  if (mode === "person") {
    return `
CREATE ONE PROFESSIONAL COMMERCIAL PRODUCT-ON-PERSON PHOTO.

If a person exists in the reference image, that exact person is the identity reference.

Do not replace them with another model.

Keep the real product accurately represented.

Improve:

- environment
- professional lighting
- background
- composition
- pose presentation
- photographic quality

Do not significantly alter the person's natural appearance.

The result should look like the same real person photographed during a professional commercial photoshoot.

No text.
No watermark.
`;
  }

  if (mode === "social") {
    return `
CREATE ONE PREMIUM SOCIAL MEDIA ADVERTISING CREATIVE.

The result should be immediately usable for:

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

Leave useful negative space where appropriate.

Preserve the product and any real person faithfully.

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

No text.
No captions.
No watermark.
`;
}

// ======================================================
// BUILD PROMPT
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
// TELEGRAM IMAGE DOWNLOAD
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
// OPENAI GENERATION
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

        timeout:
          180000,

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
  mode,
  lang
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

  let caption;

  if (lang === "ru") {
    const captions = {
      product:
        "✨ Ваше профессиональное фото товара готово.",

      collage:
        "🖼 Ваш рекламный коллаж готов.",

      fashion:
        "👗 Ваш fashion-коллаж готов.",

      person:
        "👤 Ваше профессиональное фото готово.",

      social:
        "📱 Ваш креатив для соцсетей готов."
    };

    caption =
      captions[mode] ||
      captions.product;

  } else {
    const captions = {
      product:
        "✨ Your AI product photo is ready.",

      collage:
        "🖼 Your advertising collage is ready.",

      fashion:
        "👗 Your fashion advertising collage is ready.",

      person:
        "👤 Your professional product-on-person photo is ready.",

      social:
        "📱 Your social media creative is ready."
    };

    caption =
      captions[mode] ||
      captions.product;
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
// CREDIT RESERVATION
// ======================================================

async function reserveCredit(
  userId
) {
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

async function refundCredit(
  userId
) {
  await pool.query(
    `
    UPDATE users

    SET
      credits = credits + 1,
      updated_at = CURRENT_TIMESTAMP

    WHERE
      telegram_id = $1
    `,
    [userId]
  );
}

// ======================================================
// GENERATION WORKFLOW
// ======================================================

async function generateForUser(
  chatId,
  userId,
  session,
  lang
) {
  if (
    !session.photoFileIds ||
    session.photoFileIds.length === 0
  ) {
    await sendMessage(
      chatId,

      lang === "ru"
        ? "⚠️ Не могу найти фотографии товара. Загрузите их ещё раз."
        : "⚠️ I can't find your product photos. Please upload them again."
    );

    return;
  }

  if (!session.mode) {
    await showCreationTypeSelector(
      chatId,
      lang
    );

    return;
  }

  if (!session.style) {
    await showStyleSelector(
      chatId,
      session.mode,
      lang
    );

    return;
  }

  if (!session.format) {
    await showFormatSelector(
      chatId,
      lang
    );

    return;
  }

  const balanceAfterReserve =
    await reserveCredit(
      userId
    );

  if (
    balanceAfterReserve === null
  ) {
    await sendMessage(
      chatId,

      lang === "ru"
        ? `
💎 <b>У вас закончились кредиты.</b>

Выберите пакет, чтобы продолжить.
`
        : `
💎 <b>You’re out of photo credits.</b>

Choose a photo pack to continue.
`
    );

    await showBuyCredits(
      chatId,
      lang
    );

    return;
  }

  console.log(
    `[DATABASE] User ${userId} reserved 1 credit. Balance: ${balanceAfterReserve}`
  );

  if (lang === "ru") {
    await sendMessage(
      chatId,
      `
⏳ <b>Создаю: ${getModeName(session.mode, "ru")}...</b>

Референсов: <b>${session.photoFileIds.length}</b>
Стиль: <b>${session.style}</b>
Формат: <b>${session.format}</b>

Обычно это занимает 30–120 секунд.
`
    );

  } else {
    await sendMessage(
      chatId,
      `
⏳ <b>Creating your ${getModeName(session.mode, "en")}...</b>

References: <b>${session.photoFileIds.length}</b>
Style: <b>${session.style}</b>
Format: <b>${session.format}</b>

This can take around 30–120 seconds.
`
    );
  }

  let delivered = false;

  try {
    const referencePhotos =
      await downloadReferencePhotos(
        session.photoFileIds
      );

    log(
      `Downloaded ${referencePhotos.length} references for user ${userId}`
    );

    const generatedPhoto =
      await generateProductPhoto(
        referencePhotos,
        session.mode,
        session.style,
        session.format
      );

    log(
      `OpenAI generation completed for user ${userId}`
    );

    await sendPhoto(
      chatId,
      generatedPhoto,
      session.mode,
      lang
    );

    delivered = true;

    log(
      `Generated image delivered to user ${userId}`
    );

  } catch (error) {
    console.error(
      "IMAGE GENERATION ERROR:",
      error.response?.data ||
      error.message
    );

    if (!delivered) {
      try {
        await refundCredit(
          userId
        );

        console.log(
          `[DATABASE] Refunded 1 credit to user ${userId}`
        );

      } catch (refundError) {
        console.error(
          "[DATABASE] CREDIT REFUND ERROR:",
          refundError.message
        );
      }
    }

    await sendMessage(
      chatId,

      lang === "ru"
        ? `
⚠️ <b>Не удалось создать изображение.</b>

Кредит возвращён на ваш баланс.

Попробуйте ещё раз.
`
        : `
⚠️ <b>I couldn't generate the image.</b>

Your credit was returned.

Please try again.
`
    );

    return;
  }

  try {
    await pool.query(
      `
      UPDATE users

      SET
        free_generation_used = TRUE,
        updated_at = CURRENT_TIMESTAMP

      WHERE
        telegram_id = $1
      `,
      [userId]
    );

  } catch (error) {
    console.error(
      "[DATABASE] Post-generation update error:",
      error.message
    );
  }

  const result =
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
    result.rows[0]?.credits ?? 0;

  if (lang === "ru") {
    await sendMessage(
      chatId,
      `
✅ <b>Готово!</b>

💎 Осталось: <b>${credits} ${ruCreditWord(credits)}</b>
`
    );

  } else {
    await sendMessage(
      chatId,
      `
✅ <b>Done!</b>

💎 Remaining: <b>${credits} ${creditWord(credits)}</b>
`
    );
  }

  await showAfterGenerationActions(
    chatId,
    lang
  );

  if (credits <= 0) {
    await showBuyCredits(
      chatId,
      lang
    );
  }
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

        if (
          !selectedPackage ||
          query.currency !== "XTR" ||
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
                "Payment could not be verified."
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
          `[PAYMENT] Pre-checkout approved for ${query.from.id}`
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

        await ensureUser(
          message
        );

        const lang =
          await getUserLanguage(
            userId
          );

        const payment =
          message.successful_payment;

        const selectedPackage =
          getPackageByPayload(
            payment.invoice_payload
          );

        if (
          !selectedPackage ||
          payment.currency !== "XTR" ||
          payment.total_amount !==
            selectedPackage.stars
        ) {
          await sendMessage(
            chatId,

            lang === "ru"
              ? `
⚠️ Платёж получен, но его не удалось проверить.

Пожалуйста, не оплачивайте повторно и свяжитесь с поддержкой.
`
              : `
⚠️ Payment was received but could not be verified.

Please do not pay again and contact support.
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
                payment.total_amount,
                selectedPackage.credits,
                payment.invoice_payload,
                payment.telegram_payment_charge_id
              ]
            );

          if (
            paymentInsert.rows.length === 0
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
          } catch {}

          console.error(
            "[PAYMENT] Processing error:",
            error.message
          );

          await sendMessage(
            chatId,

            lang === "ru"
              ? `
⚠️ Платёж получен, но кредиты не удалось начислить автоматически.

Пожалуйста, не оплачивайте повторно.
`
              : `
⚠️ Your payment was received, but credits could not be added automatically.

Please do not pay again.
`
          );

          return;

        } finally {
          client.release();
        }

        if (duplicatePayment) {
          await sendMessage(
            chatId,

            lang === "ru"
              ? `✅ Этот платёж уже обработан.\n\n💎 Баланс: <b>${newCredits} ${ruCreditWord(newCredits)}</b>`
              : `✅ This payment was already processed.\n\n💎 Balance: <b>${newCredits} ${creditWord(newCredits)}</b>`
          );

          return;
        }

        if (lang === "ru") {
          await sendMessage(
            chatId,
            `
✅ <b>Оплата прошла успешно!</b>

⭐ Оплачено: <b>${payment.total_amount} Stars</b>
📸 Добавлено: <b>${selectedPackage.credits} ${ruPhotoWord(selectedPackage.credits)}</b>

💎 Новый баланс:
<b>${newCredits} ${ruCreditWord(newCredits)}</b>

Отправьте фотографию товара, чтобы продолжить. 📸
`
          );

        } else {
          await sendMessage(
            chatId,
            `
✅ <b>Payment successful!</b>

⭐ Paid: <b>${payment.total_amount} Stars</b>
📸 Added: <b>${selectedPackage.credits} ${photoWord(selectedPackage.credits)}</b>

💎 Your new balance:
<b>${newCredits} ${creditWord(newCredits)}</b>

Send me a product photo to continue. 📸
`
          );
        }

        return;
      }

      // ==================================================
      // CALLBACK
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
        // LANGUAGE
        // ==================================================

        if (
          data.startsWith(
            "lang_"
          )
        ) {
          const lang =
            data === "lang_ru"
              ? "ru"
              : "en";

          await setUserLanguage(
            userId,
            lang
          );

          const userData =
            await getUserData(
              userId
            );

          session.photoFileIds =
            [];

          session.collectingReferences =
            false;

          resetCreativeSettings(
            session
          );

          await showStart(
            chatId,
            lang
          );

          await showBalanceOrPackages(
            chatId,
            userData.credits,
            lang
          );

          return;
        }

        const lang =
          await getUserLanguage(
            userId
          );

        // ==================================================
        // ADD REFERENCE
        // ==================================================

        if (
          data === "refs_add"
        ) {
          session.collectingReferences =
            true;

          await sendMessage(
            chatId,

            lang === "ru"
              ? `
➕ <b>Отправьте ещё одну фотографию.</b>

Например:

👕 Спина товара
🔎 Деталь крупным планом
📦 Упаковка
📸 Другой ракурс
`
              : `
➕ <b>Send another reference photo.</b>

Examples:

👕 Back of the product
🔎 Close-up detail
📦 Packaging
📸 Another angle
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
          session.collectingReferences =
            false;

          await showCreationTypeSelector(
            chatId,
            lang
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
          session.mode =
            data.replace(
              "mode_",
              ""
            );

          session.style =
            null;

          session.format =
            null;

          await showStyleSelector(
            chatId,
            session.mode,
            lang
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
          session.style =
            data.replace(
              "style_",
              ""
            );

          await showFormatSelector(
            chatId,
            lang
          );

          return;
        }

        // ==================================================
        // FORMAT
        // ==================================================

        if (
          data.startsWith(
            "format_"
          )
        ) {
          session.format =
            data.replace(
              "format_",
              ""
            );

          await generateForUser(
            chatId,
            userId,
            session,
            lang
          );

          return;
        }

        // ==================================================
        // ACTION — ANOTHER VERSION
        // ==================================================

        if (
          data === "action_again"
        ) {
          await generateForUser(
            chatId,
            userId,
            session,
            lang
          );

          return;
        }

        // ==================================================
        // ACTION — CHANGE STYLE
        // ==================================================

        if (
          data === "action_style"
        ) {
          await showStyleSelector(
            chatId,
            session.mode,
            lang
          );

          return;
        }

        // ==================================================
        // ACTION — CHANGE FORMAT
        // ==================================================

        if (
          data === "action_format"
        ) {
          await showFormatSelector(
            chatId,
            lang
          );

          return;
        }

        // ==================================================
        // ACTION — NEW PRODUCT
        // ==================================================

        if (
          data === "action_new"
        ) {
          session.photoFileIds =
            [];

          session.collectingReferences =
            false;

          resetCreativeSettings(
            session
          );

          await sendMessage(
            chatId,

            lang === "ru"
              ? `
📸 <b>Новый товар</b>

Отправьте первую фотографию нового товара.

Можно загрузить до <b>3 фотографий</b>.
`
              : `
📸 <b>New Product</b>

Send the first photo of your new product.

You can upload up to <b>3 reference photos</b>.
`
          );

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

          if (!selectedPackage) {
            return;
          }

          const title =
            lang === "ru"
              ? selectedPackage.title_ru
              : selectedPackage.title_en;

          const description =
            lang === "ru"
              ? `${selectedPackage.credits} профессиональных AI фото товара`
              : `${selectedPackage.credits} professional AI product photos`;

          await axios.post(
            `${TELEGRAM_URL}/sendInvoice`,
            {
              chat_id:
                chatId,

              title,

              description,

              payload:
                selectedPackage.payload,

              provider_token:
                "",

              currency:
                "XTR",

              prices: [
                {
                  label:
                    title,

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

      await ensureUser(
        message
      );

      const session =
        getSession(userId);

      const userData =
        await getUserData(
          userId
        );

      // ==================================================
      // /LANGUAGE
      // ==================================================

      if (
        message.text &&
        message.text
          .trim()
          .toLowerCase()
          .startsWith(
            "/language"
          )
      ) {
        await showLanguageSelector(
          chatId
        );

        return;
      }

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
        session.photoFileIds =
          [];

        session.collectingReferences =
          false;

        resetCreativeSettings(
          session
        );

        if (!userData.language) {
          await showLanguageSelector(
            chatId
          );

          return;
        }

        await showStart(
          chatId,
          userData.language
        );

        await showBalanceOrPackages(
          chatId,
          userData.credits,
          userData.language
        );

        return;
      }

      // ==================================================
      // REQUIRE LANGUAGE FIRST
      // ==================================================

      if (!userData.language) {
        await showLanguageSelector(
          chatId
        );

        return;
      }

      const lang =
        userData.language;

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
            message.photo.length - 1
          ];

        if (
          !session.collectingReferences
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

          await showReferenceOptions(
            chatId,
            1,
            lang
          );

          return;
        }

        if (
          session.photoFileIds.length >=
            3
        ) {
          session.collectingReferences =
            false;

          await showCreationTypeSelector(
            chatId,
            lang
          );

          return;
        }

        session.photoFileIds.push(
          largestPhoto.file_id
        );

        const count =
          session.photoFileIds.length;

        resetCreativeSettings(
          session
        );

        if (count >= 3) {
          session.collectingReferences =
            false;

          await sendMessage(
            chatId,

            lang === "ru"
              ? `
✅ <b>3 фотографии сохранены.</b>

Это максимальное количество референсов.
`
              : `
✅ <b>3 reference photos saved.</b>

That's the maximum number of references.
`
          );

          await showCreationTypeSelector(
            chatId,
            lang
          );

          return;
        }

        await showReferenceOptions(
          chatId,
          count,
          lang
        );

        return;
      }

      // ==================================================
      // FALLBACK
      // ==================================================

      await sendMessage(
        chatId,

        lang === "ru"
          ? `
📸 Отправьте фотографию товара.

Можно загрузить до <b>3 референсных фото</b>: например перед, спину и деталь.
`
          : `
📸 Please send me a photo of your product.

You can upload up to <b>3 reference photos</b> — for example front, back and detail.
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
