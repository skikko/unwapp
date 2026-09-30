const PHONE_COLUMNS = [
  'phone', 'phone_number', 'telefono', 'cellulare', 'mobile',
  'whatsapp', 'numero', 'numero_telefono',
];

function detectDelimiter(text) {
  const line = String(text || '').split(/\r?\n/).find((item) => item.trim()) || '';
  const candidates = [',', ';', '\t'];
  let best = ',';
  let bestCount = -1;
  for (const delimiter of candidates) {
    let count = 0;
    let quoted = false;
    for (let i = 0; i < line.length; i += 1) {
      if (line[i] === '"') quoted = !quoted;
      if (!quoted && line[i] === delimiter) count += 1;
    }
    if (count > bestCount) {
      best = delimiter;
      bestCount = count;
    }
  }
  return best;
}

function parseRows(text, delimiter) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  const input = String(text || '').replace(/^\uFEFF/, '');

  for (let i = 0; i < input.length; i += 1) {
    const char = input[i];
    if (char === '"') {
      if (quoted && input[i + 1] === '"') {
        field += '"';
        i += 1;
      } else {
        quoted = !quoted;
      }
    } else if (char === delimiter && !quoted) {
      row.push(field.trim());
      field = '';
    } else if ((char === '\n' || char === '\r') && !quoted) {
      if (char === '\r' && input[i + 1] === '\n') i += 1;
      row.push(field.trim());
      if (row.some((value) => value !== '')) rows.push(row);
      row = [];
      field = '';
    } else {
      field += char;
    }
  }

  if (quoted) throw new Error('CSV non valido: virgolette non chiuse');
  row.push(field.trim());
  if (row.some((value) => value !== '')) rows.push(row);
  return rows;
}

function uniqueHeaders(values) {
  const used = new Map();
  return values.map((value, index) => {
    const base = String(value || '').trim() || `colonna_${index + 1}`;
    const count = used.get(base) || 0;
    used.set(base, count + 1);
    return count ? `${base}_${count + 1}` : base;
  });
}

function parseCsv(buffer, { maxRows = 10_000 } = {}) {
  const text = Buffer.isBuffer(buffer) ? buffer.toString('utf8') : String(buffer || '');
  if (!text.trim()) throw new Error('Il file CSV è vuoto');
  const delimiter = detectDelimiter(text);
  const rawRows = parseRows(text, delimiter);
  if (rawRows.length < 2) throw new Error('Il CSV deve contenere intestazioni e almeno un contatto');
  if (rawRows.length - 1 > maxRows) throw new Error(`Il CSV supera il limite di ${maxRows} contatti`);

  const headers = uniqueHeaders(rawRows[0]);
  const rows = rawRows.slice(1).map((values, index) => {
    const data = {};
    headers.forEach((header, columnIndex) => {
      data[header] = values[columnIndex] || '';
    });
    return { rowNumber: index + 2, data };
  });

  const normalized = headers.map((header) => header.toLowerCase().replace(/[\s-]+/g, '_'));
  const phoneIndex = normalized.findIndex((header) => PHONE_COLUMNS.includes(header));
  return {
    delimiter: delimiter === '\t' ? 'tab' : delimiter,
    headers,
    rows,
    suggestedPhoneColumn: phoneIndex >= 0 ? headers[phoneIndex] : null,
  };
}

function normalizePhone(value) {
  let phone = String(value || '').trim().replace(/^whatsapp:/i, '');
  phone = phone.replace(/[\s().-]/g, '');
  if (phone.startsWith('00')) phone = `+${phone.slice(2)}`;
  if (!phone.startsWith('+') && /^\d+$/.test(phone)) phone = `+${phone}`;
  if (!/^\+[1-9]\d{6,14}$/.test(phone)) return null;
  return phone;
}

function normalizeHeader(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function extractContactName(data = {}) {
  const values = new Map(
    Object.entries(data).map(([key, value]) => [normalizeHeader(key), String(value || '').trim()])
  );
  const firstValue = (aliases) => aliases.map((alias) => values.get(alias)).find(Boolean) || '';
  const fullName = firstValue(['nome_cognome', 'full_name', 'fullname', 'display_name']);
  if (fullName) return fullName.replace(/\s+/g, ' ').slice(0, 180);

  const firstName = firstValue(['nome', 'name', 'first_name', 'firstname', 'given_name']);
  const lastName = firstValue(['cognome', 'surname', 'last_name', 'lastname', 'family_name']);
  return [firstName, lastName].filter(Boolean).join(' ').replace(/\s+/g, ' ').slice(0, 180);
}

function prepareContacts(parsed, phoneColumn, variableMapping = {}) {
  if (!parsed.headers.includes(phoneColumn)) throw new Error('Seleziona una colonna telefono valida');
  const seen = new Set();
  const contacts = [];
  const invalid = [];
  const duplicates = [];

  for (const row of parsed.rows) {
    const phone = normalizePhone(row.data[phoneColumn]);
    if (!phone) {
      invalid.push({ rowNumber: row.rowNumber, value: row.data[phoneColumn] || '' });
      continue;
    }
    if (seen.has(phone)) {
      duplicates.push({ rowNumber: row.rowNumber, value: phone });
      continue;
    }
    seen.add(phone);

    const variables = {};
    for (const [key, column] of Object.entries(variableMapping || {})) {
      if (column && parsed.headers.includes(column)) variables[key] = row.data[column] || '';
    }
    contacts.push({
      rowNumber: row.rowNumber,
      phone,
      contactName: extractContactName(row.data),
      data: row.data,
      variables,
    });
  }
  return { contacts, invalid, duplicates };
}

function csvCell(value) {
  let text = value === null || value === undefined ? '' : String(value);
  if (/^[=+\-@]/.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}

function stringifyCsv(headers, rows) {
  const lines = [headers.map(csvCell).join(',')];
  for (const row of rows) lines.push(headers.map((header) => csvCell(row[header])).join(','));
  return `\uFEFF${lines.join('\r\n')}\r\n`;
}

module.exports = { detectDelimiter, parseCsv, normalizePhone, extractContactName, prepareContacts, stringifyCsv };
