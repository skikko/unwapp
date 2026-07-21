const pdfParse = require('pdf-parse');
const crypto = require('crypto');
const OpenAI = require('openai');
const documentRepo = require('../repos/documentRepo');
const secretService = require('./secretService');

const CHUNK_SIZE = 800;
const CHUNK_OVERLAP_SENTENCES = 2;
const EMBEDDING_MODEL = 'text-embedding-3-small';
const EMBEDDING_DIM = 1536;

function openai(bot) {
  if (bot.provider !== 'openai') throw new Error('Il RAG richiede un BOT OpenAI');
  return new OpenAI({ apiKey: secretService.decrypt(bot.ai_api_key_encrypted) });
}

function splitIntoChunks(text, chunkSize = CHUNK_SIZE) {
  const clean = text.replace(/\s+/g, ' ').trim();
  const sentences = clean.split(/(?<=[.!?])\s+/).filter((s) => s.trim());
  const chunks = [];
  let current = '';
  let currentSentences = [];

  for (const s of sentences) {
    const next = current ? current + ' ' + s : s;
    if (next.length > chunkSize && current) {
      chunks.push(current.trim());
      const overlap = currentSentences.slice(-CHUNK_OVERLAP_SENTENCES);
      current = overlap.concat(s).join(' ');
      currentSentences = [...overlap, s];
    } else {
      current = next;
      currentSentences.push(s);
    }
  }
  if (current.trim()) chunks.push(current.trim());
  return chunks;
}

async function embed(bot, text) {
  const input = text.slice(0, 8000);
  const res = await openai(bot).embeddings.create({
    model: EMBEDDING_MODEL,
    input,
    encoding_format: 'float',
  });
  const emb = res.data[0].embedding;
  if (emb.length !== EMBEDDING_DIM) {
    throw new Error(`Unexpected embedding size: ${emb.length}`);
  }
  return emb;
}

async function embedBatch(bot, texts) {
  const out = [];
  for (const t of texts) {
    out.push(await embed(bot, t));
    await new Promise((r) => setTimeout(r, 50));
  }
  return out;
}

async function uploadDocument(bot, file) {
  const botId = bot.id;
  if (!file || !file.buffer) throw new Error('file required');
  if (file.mimetype !== 'application/pdf') throw new Error('only PDF is supported');

  const parsed = await pdfParse(file.buffer);
  const text = parsed.text || '';
  if (!text.trim()) throw new Error('empty PDF text');

  const contentHash = crypto.createHash('sha256').update(file.buffer).digest('hex');

  const document = await documentRepo.createDocument({
    botId,
    filename: file.originalname,
    contentHash,
  });

  const pieces = splitIntoChunks(text);
  const embeddings = await embedBatch(bot, pieces);
  const chunks = pieces.map((content, i) => ({
    index: i,
    content,
    embedding: embeddings[i],
  }));

  await documentRepo.addChunks(botId, document.id, chunks);

  return {
    documentId: document.id,
    filename: document.filename,
    chunks: chunks.length,
  };
}

async function getRelevantContext(bot, query, { maxTokens = 2500, topK = 5 } = {}) {
  const q = await embed(bot, query);
  const hits = await documentRepo.searchChunks(bot.id, q, { topK });
  if (hits.length === 0) return '';

  let out = '';
  let tokens = 0;
  for (const h of hits) {
    const t = Math.ceil(h.content.length / 3.5);
    if (tokens + t > maxTokens) break;
    out += h.content + '\n---\n';
    tokens += t;
  }
  return out.trim();
}

async function listDocuments(botId) {
  return documentRepo.listByBot(botId);
}

async function deleteDocument(botId, documentId) {
  const doc = await documentRepo.getById(documentId);
  if (!doc) throw new Error('document not found');
  if (doc.bot_id !== botId) throw new Error('document belongs to different bot');

  await documentRepo.remove(documentId);
}

async function stats(botId) {
  return documentRepo.countByBot(botId);
}

module.exports = {
  uploadDocument,
  getRelevantContext,
  listDocuments,
  deleteDocument,
  stats,
};
