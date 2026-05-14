const BOT_TOKEN = '8906111064:AAFhRFGA4GeV7TU2Kz0yaGWxJ3znrIb1-tE';
const ADMIN_ID = 7945013412;
const CHANNEL_ID = '@blogs_N2kurs'; // Kanal username

const API_URL = `https://api.telegram.org/bot${BOT_TOKEN}`;

addEventListener('fetch', event => {
  event.respondWith(handleRequest(event.request));
});

async function handleRequest(request) {
  if (request.method === 'POST') {
    try {
      const update = await request.json();
      await onUpdate(update);
    } catch (e) {
      console.error(e);
    }
    return new Response('OK', { status: 200 });
  }
  return new Response('Bot is running', { status: 200 });
}

async function onUpdate(update) {
  if (update.message) {
    await handleMessage(update.message);
  } else if (update.callback_query) {
    await handleCallback(update.callback_query);
  }
}

async function handleMessage(msg) {
  const chatId = msg.chat.id;
  const text = msg.text;
  const userId = msg.from.id;

  // 1. Kanalga a'zolikni tekshirish
  const isMember = await checkMembership(userId);
  if (!isMember) {
    return await sendJoinMessage(chatId);
  }

  // Admin holatini tekshirish (Test qo'shish jarayoni)
  const userState = await TEST_DATA.get(`state:${userId}`);
  if (userState) {
    return await handleState(chatId, userId, text, userState);
  }

  if (text === '/start') {
    await sendMainMenu(chatId, userId);
  } else if (text === '📝 Test topshirish') {
    await TEST_DATA.put(`state:${userId}`, 'WAITING_TEST_CODE');
    await sendMessage(chatId, 'Iltimos, test kodini kiriting (8 belgili):');
  } else if (text === '📖 Qo\'llanma') {
    await sendMessage(chatId, 'Ushbu bot orqali testlar topshirishingiz mumkin. Test kodini adminlardan oling.');
  } else if (userId === ADMIN_ID) {
    if (text === '📝 Yangi test qo\'shish') {
      await TEST_DATA.put(`state:${userId}`, 'WAITING_TEST_NAME');
      await sendMessage(chatId, 'Test nomini kiriting:');
    } else if (text === '📊 Natijalar') {
      await showResults(chatId);
    } else if (text === '📚 Testlar') {
      await listTests(chatId);
    }
  } else {
    // Agar test kodi kutilayotgan bo'lsa
    const state = await TEST_DATA.get(`state:${userId}`);
    if (state === 'WAITING_TEST_CODE') {
      await startTest(chatId, userId, text);
    }
  }
}

async function handleState(chatId, userId, text, state) {
  if (state === 'WAITING_TEST_CODE') {
    await startTest(chatId, userId, text);
  } else if (state === 'WAITING_TEST_NAME') {
    const testId = generateId(8);
    await TEST_DATA.put(`temp_test:${userId}`, JSON.stringify({ id: testId, name: text, questions: [] }));
    await TEST_DATA.put(`state:${userId}`, 'WAITING_QUESTION');
    await sendMessage(chatId, `Test nomi: ${text}\nEndi savolni kiriting (yoki "TUGATISH" deb yozing):`);
  } else if (state === 'WAITING_QUESTION') {
    if (text.toUpperCase() === 'TUGATISH') {
      const tempTest = JSON.parse(await TEST_DATA.get(`temp_test:${userId}`));
      if (tempTest.questions.length === 0) {
        await sendMessage(chatId, 'Hech bo\'lmasa bitta savol qo\'shing!');
        return;
      }
      await TEST_DATA.put(`test:${tempTest.id}`, JSON.stringify(tempTest));
      await TEST_DATA.delete(`state:${userId}`);
      await TEST_DATA.delete(`temp_test:${userId}`);
      await sendMessage(chatId, `Test muvaffaqiyatli saqlandi!\nKod: ${tempTest.id}`);
      await sendMainMenu(chatId, userId);
    } else {
      const tempTest = JSON.parse(await TEST_DATA.get(`temp_test:${userId}`));
      tempTest.questions.push({ question: text, options: [], correct: null });
      await TEST_DATA.put(`temp_test:${userId}`, JSON.stringify(tempTest));
      await TEST_DATA.put(`state:${userId}`, 'WAITING_OPTIONS');
      await sendMessage(chatId, 'Variantlarni kiriting (vergul bilan ajrating, masalan: A,B,C,D):');
    }
  } else if (state === 'WAITING_OPTIONS') {
    const options = text.split(',').map(o => o.trim());
    const tempTest = JSON.parse(await TEST_DATA.get(`temp_test:${userId}`));
    tempTest.questions[tempTest.questions.length - 1].options = options;
    await TEST_DATA.put(`temp_test:${userId}`, JSON.stringify(tempTest));
    await TEST_DATA.put(`state:${userId}`, 'WAITING_CORRECT');
    await sendMessage(chatId, `To'g'ri javobni kiriting (${options.join(', ')}):`);
  } else if (state === 'WAITING_CORRECT') {
    const tempTest = JSON.parse(await TEST_DATA.get(`temp_test:${userId}`));
    const currentQuestion = tempTest.questions[tempTest.questions.length - 1];
    if (!currentQuestion.options.includes(text.trim())) {
      await sendMessage(chatId, 'Xato! Variantlar ichidan birini tanlang.');
      return;
    }
    currentQuestion.correct = text.trim();
    await TEST_DATA.put(`temp_test:${userId}`, JSON.stringify(tempTest));
    await TEST_DATA.put(`state:${userId}`, 'WAITING_QUESTION');
    await sendMessage(chatId, 'Savol qo\'shildi. Keyingi savolni kiriting yoki "TUGATISH" deb yozing:');
  }
}

async function handleCallback(query) {
  const chatId = query.message.chat.id;
  const userId = query.from.id;
  const data = query.data;

  if (data === 'check_sub') {
    const isMember = await checkMembership(userId);
    if (isMember) {
      await sendMessage(chatId, 'Rahmat! Endi botdan foydalanishingiz mumkin.');
      await sendMainMenu(chatId, userId);
    } else {
      await answerCallback(query.id, 'Siz hali a\'zo emassiz!');
    }
  } else if (data.startsWith('ans:')) {
    const [_, testId, qIdx, option] = data.split(':');
    await processAnswer(chatId, userId, testId, parseInt(qIdx), option, query.id);
  }
}

async function checkMembership(userId) {
  try {
    const res = await fetch(`${API_URL}/getChatMember?chat_id=${CHANNEL_ID}&user_id=${userId}`);
    const data = await res.json();
    if (data.ok) {
      const status = data.result.status;
      return ['member', 'administrator', 'creator'].includes(status);
    }
  } catch (e) {
    console.error(e);
  }
  return false;
}

async function sendJoinMessage(chatId) {
  const keyboard = {
    inline_keyboard: [
      [{ text: 'Kanalga a\'zo bo\'lish', url: `https://t.me/${CHANNEL_ID.replace('@', '')}` }],
      [{ text: 'Tekshirish', callback_data: 'check_sub' }]
    ]
  };
  await sendMessage(chatId, 'Botdan foydalanish uchun kanalimizga a\'zo bo\'lishingiz shart:', keyboard);
}

async function sendMainMenu(chatId, userId) {
  const buttons = [
    [{ text: '📝 Test topshirish' }, { text: '📖 Qo\'llanma' }]
  ];
  if (userId === ADMIN_ID) {
    buttons.push([{ text: '📝 Yangi test qo\'shish' }]);
    buttons.push([{ text: '📊 Natijalar' }, { text: '📚 Testlar' }]);
  }
  const keyboard = { keyboard: buttons, resize_keyboard: true };
  await sendMessage(chatId, 'Asosiy menyu:', keyboard);
}

async function startTest(chatId, userId, testId) {
  const testData = await TEST_DATA.get(`test:${testId}`);
  if (!testData) {
    await sendMessage(chatId, 'Xato! Bunday kodli test topilmadi.');
    await TEST_DATA.delete(`state:${userId}`);
    return;
  }
  const test = JSON.parse(testData);
  await TEST_DATA.put(`user_test:${userId}`, JSON.stringify({ testId, current: 0, score: 0 }));
  await TEST_DATA.delete(`state:${userId}`);
  await sendQuestion(chatId, userId, test, 0);
}

async function sendQuestion(chatId, userId, test, qIdx) {
  const q = test.questions[qIdx];
  const keyboard = {
    inline_keyboard: q.options.map(opt => [{ text: opt, callback_data: `ans:${test.id}:${qIdx}:${opt}` }])
  };
  await sendMessage(chatId, `Savol ${qIdx + 1}/${test.questions.length}:\n\n${q.question}`, keyboard);
}

async function processAnswer(chatId, userId, testId, qIdx, option, queryId) {
  const userData = JSON.parse(await TEST_DATA.get(`user_test:${userId}`));
  const test = JSON.parse(await TEST_DATA.get(`test:${testId}`));
  
  if (test.questions[qIdx].correct === option) {
    userData.score++;
  }
  
  userData.current++;
  
  if (userData.current < test.questions.length) {
    await TEST_DATA.put(`user_test:${userId}`, JSON.stringify(userData));
    await answerCallback(queryId, 'Javob qabul qilindi');
    await sendQuestion(chatId, userId, test, userData.current);
  } else {
    const percent = Math.round((userData.score / test.questions.length) * 100);
    const resultMsg = `Test tugadi!\nNatija: ${userData.score}/${test.questions.length} (${percent}%)`;
    await sendMessage(chatId, resultMsg);
    
    // Natijani saqlash
    const results = JSON.parse(await TEST_DATA.get(`results:${testId}`) || '[]');
    results.push({ userId, score: userData.score, total: test.questions.length, date: new Date().toISOString() });
    await TEST_DATA.put(`results:${testId}`, JSON.stringify(results));
    
    await TEST_DATA.delete(`user_test:${userId}`);
    await answerCallback(queryId, 'Test yakunlandi');
    await sendMainMenu(chatId, userId);
  }
}

async function showResults(chatId) {
  const list = await TEST_DATA.list({ prefix: 'results:' });
  let msg = '📊 Test natijalari:\n\n';
  for (const key of list.keys) {
    const testId = key.name.split(':')[1];
    const results = JSON.parse(await TEST_DATA.get(key.name));
    msg += `Test: ${testId} - ${results.length} ta ishtirokchi\n`;
  }
  await sendMessage(chatId, msg || 'Hozircha natijalar yo\'q.');
}

async function listTests(chatId) {
  const list = await TEST_DATA.list({ prefix: 'test:' });
  let msg = '📚 Mavjud testlar:\n\n';
  for (const key of list.keys) {
    const test = JSON.parse(await TEST_DATA.get(key.name));
    msg += `ID: ${test.id} | Nomi: ${test.name}\n`;
  }
  await sendMessage(chatId, msg || 'Hozircha testlar yo\'q.');
}

async function sendMessage(chatId, text, keyboard = null) {
  const body = { chat_id: chatId, text: text };
  if (keyboard) body.reply_markup = keyboard;
  return await fetch(`${API_URL}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
}

async function answerCallback(queryId, text) {
  return await fetch(`${API_URL}/answerCallbackQuery`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ callback_query_id: queryId, text: text })
  });
}

function generateId(length) {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let result = '';
  for (let i = 0; i < length; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}
