const db = require('../config/db');

function toVectorLiteral(arr) {
  // pgvector accepts string form '[1,2,3]'
  return `[${arr.join(',')}]`;
}

async function createDocument({ botId, filename, contentHash = null }) {
  const { rows } = await db.query(
    `INSERT INTO documents (bot_id, filename, content_hash)
     VALUES ($1,$2,$3)
     RETURNING *`,
    [botId, filename, contentHash]
  );
  return rows[0];
}

async function addChunks(botId, documentId, chunks) {
  // chunks: [{ index, content, embedding: number[] }, ...]
  const client = await db.getClient();
  try {
    await client.query('BEGIN');
    for (const c of chunks) {
      await client.query(
        `INSERT INTO chunks (document_id, bot_id, chunk_index, content, embedding)
         VALUES ($1,$2,$3,$4,$5::vector)`,
        [documentId, botId, c.index, c.content, toVectorLiteral(c.embedding)]
      );
    }
    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

async function listByBot(botId) {
  const { rows } = await db.query(
    `SELECT d.*,
            (SELECT count(*) FROM chunks c WHERE c.document_id = d.id) AS chunk_count
     FROM documents d
     WHERE d.bot_id = $1
     ORDER BY created_at DESC`,
    [botId]
  );
  return rows;
}

async function getById(documentId) {
  const { rows } = await db.query(
    `SELECT * FROM documents WHERE id = $1`,
    [documentId]
  );
  return rows[0] || null;
}

async function remove(documentId) {
  await db.query(`DELETE FROM documents WHERE id = $1`, [documentId]);
}

async function searchChunks(botId, queryEmbedding, { topK = 5, minSimilarity = 0.25 } = {}) {
  // 1 - cosine distance = cosine similarity
  const { rows } = await db.query(
    `SELECT c.id, c.document_id, c.chunk_index, c.content,
            1 - (c.embedding <=> $2::vector) AS similarity,
            d.filename
     FROM chunks c
     JOIN documents d ON d.id = c.document_id
     WHERE c.bot_id = $1
     ORDER BY c.embedding <=> $2::vector ASC
     LIMIT $3`,
    [botId, toVectorLiteral(queryEmbedding), topK]
  );
  return rows.filter((r) => Number(r.similarity) >= minSimilarity);
}

async function countByBot(botId) {
  const { rows } = await db.query(
    `SELECT
       (SELECT count(*) FROM documents WHERE bot_id = $1)::int AS documents,
       (SELECT count(*) FROM chunks    WHERE bot_id = $1)::int AS chunks`,
    [botId]
  );
  return rows[0];
}

module.exports = {
  createDocument,
  addChunks,
  listByBot,
  getById,
  remove,
  searchChunks,
  countByBot,
};
