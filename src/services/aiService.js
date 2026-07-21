const OpenAI = require('openai');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const ragService = require('./ragService');
const messageRepo = require('../repos/messageRepo');
const secretService = require('./secretService');

function apiKeyFor(bot) {
  return secretService.decrypt(bot.ai_api_key_encrypted);
}

const FALLBACK_PROMPT_BY_LANG = {
  en: 'You are a helpful virtual assistant. Answer concisely and politely.',
  it: 'Sei un assistente virtuale disponibile. Rispondi in modo chiaro e cortese.',
  es: 'Eres un asistente virtual útil. Responde de forma clara y cortés.',
  fr: 'Vous êtes un assistant virtuel utile. Répondez clairement et poliment.',
  de: 'Du bist ein hilfsbereiter virtueller Assistent. Antworte klar und höflich.',
};

function systemPromptFor(bot) {
  if (bot.system_prompt && bot.system_prompt.trim()) {
    return bot.system_prompt;
  }
  return FALLBACK_PROMPT_BY_LANG[bot.language] || FALLBACK_PROMPT_BY_LANG.en;
}

async function buildUserPrompt(bot, userMessage, history, ragContext) {
  const parts = [];
  if (history) parts.push(`Conversation history:\n${history}`);
  parts.push(`User message: ${userMessage}`);
  if (ragContext) {
    parts.push(
      `Relevant knowledge base excerpts (do not cite sources, present as your own knowledge):\n${ragContext}`
    );
  }
  return parts.join('\n\n');
}

async function generateResponse(bot, conversation, userMessage) {
  const history = await messageRepo.recentHistoryText(conversation.id, 20);

  let ragContext = '';
  if (bot.rag_enabled) {
    try {
      ragContext = await ragService.getRelevantContext(bot, userMessage);
    } catch (err) {
      console.error('[aiService] RAG error:', err.message);
    }
  }

  const systemPrompt = systemPromptFor(bot);
  const userPrompt = await buildUserPrompt(bot, userMessage, history, ragContext);

  if (bot.provider === 'gemini') {
    return generateWithGemini(bot, systemPrompt, userPrompt);
  }
  return generateWithOpenAI(bot, systemPrompt, userPrompt);
}

async function generateWithOpenAI(bot, systemPrompt, userPrompt) {
  const openai = new OpenAI({ apiKey: apiKeyFor(bot) });
  const completion = await openai.chat.completions.create({
    model: bot.model || 'gpt-4o',
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ],
    max_tokens: 1000,
    temperature: bot.temperature ?? 0.7,
  });
  return completion.choices[0].message.content;
}

async function generateWithGemini(bot, systemPrompt, userPrompt) {
  const gemini = new GoogleGenerativeAI(apiKeyFor(bot));
  const model = gemini.getGenerativeModel({
    model: bot.model || 'gemini-1.5-flash',
    systemInstruction: systemPrompt,
    generationConfig: { temperature: bot.temperature ?? 0.7 },
  });
  const result = await model.generateContent(userPrompt);
  return result.response.text();
}

async function shouldTransferToHuman(bot, conversation, userMessage) {
  // 1) Fast path: bot-configured keywords
  const kws = (bot.transfer_keywords || []).map((k) => k.toLowerCase());
  const lower = userMessage.toLowerCase();
  if (kws.some((k) => k && lower.includes(k))) return true;

  // 2) LLM check (only for openai provider — cheap call)
  if (bot.provider !== 'openai' || !bot.ai_api_key_encrypted) return false;

  try {
    const history = await messageRepo.recentHistoryText(conversation.id, 10);
    const prompt = `Decide if this WhatsApp conversation should be transferred to a human operator.
Answer strictly "YES" or "NO".

Transfer when: customer is frustrated/angry, explicitly asks for a person, complex issue,
complaint/refund/cancellation, or safety concerns.

History:
${history}

Last message: ${userMessage}`;

    const openai = new OpenAI({ apiKey: apiKeyFor(bot) });
    const completion = await openai.chat.completions.create({
      model: bot.model || 'gpt-4o',
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 4,
      temperature: 0,
    });
    return completion.choices[0].message.content.trim().toUpperCase().startsWith('Y');
  } catch (err) {
    console.error('[aiService] transfer check failed:', err.message);
    return false;
  }
}

module.exports = {
  generateResponse,
  shouldTransferToHuman,
  systemPromptFor,
};
