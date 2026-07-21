# UN Whatsapp Manager

Webapp per gestire più BOT WhatsApp Twilio, le conversazioni con gli operatori e gli invii broadcast da CSV. Il progetto è portabile e non dipende da uno specifico provider di hosting.

## Funzioni

- creazione di BOT con numero WhatsApp Twilio, provider AI, modello, prompt e lingua;
- API key OpenAI o Gemini per singolo BOT, cifrata nel database e mai restituita al browser;
- webhook Twilio firmati, risposte automatiche e passaggio a operatore;
- base di conoscenza PDF con testo ed embedding conservati in PostgreSQL/pgvector;
- import CSV fino a 10.000 contatti con anteprima, rilevamento separatore, validazione E.164 e deduplicazione;
- creazione dei Content Template Twilio dalla pagina **Broadcast**, richiesta di approvazione WhatsApp e mappatura dei placeholder sulle colonne CSV;
- template testuali, con media, call to action, risposte rapide e card;
- broadcast asincroni, ripresa dopo riavvio, avanzamento e dettaglio errori per destinatario;
- chat operatore con testo, immagini, documenti, audio, video e pulsanti interattivi;
- interfaccia “UN Whatsapp Manager” ispirata al design system di [United Network](https://www.unitednetwork.it/en/home-en/).
- accesso con username e password, sessioni revocabili e ruoli `admin`, `operator`, `broadcaster` e `viewer`;
- configurazione Twilio cifrata dalla pagina **Impostazioni**, senza modificare il file `.env`.

## Stack

- Node.js 20, Express 5 e Socket.IO;
- PostgreSQL 15 con estensioni `pgcrypto` e `vector`;
- Twilio Messaging e Content API;
- OpenAI o Gemini configurabili per BOT;
- HTML, CSS e JavaScript senza framework frontend.

## Avvio locale

```bash
docker run --name un-postgres -d \
  -e POSTGRES_PASSWORD=dev \
  -p 5432:5432 pgvector/pgvector:pg15

createdb -h localhost -U postgres un_whatsapp_manager
psql -h localhost -U postgres -d un_whatsapp_manager -f schema.sql

cp .env.example .env
npm install
npm run dev
```

Impostare almeno `DATABASE_URL`, `APP_ENCRYPTION_KEY`, `BOOTSTRAP_ADMIN_USERNAME` e `BOOTSTRAP_ADMIN_PASSWORD`. Al primo avvio viene creato l'amministratore iniziale; le credenziali Twilio si possono poi inserire in **Impostazioni**. Le chiavi OpenAI/Gemini si inseriscono dalla pagina **BOT**, non nel file `.env`.

## Aggiornamento di un database esistente

Prima di avviare questa versione applicare:

```bash
npm run migrate
```

Lo script applica lo schema corrente e tutte le migrazioni presenti nella cartella `migrations`, incluse le colonne per i messaggi evoluti e l'archivio media.

## CSV contatti

La prima riga deve contenere le intestazioni. Sono accettati separatori virgola, punto e virgola e tab. Una colonna deve contenere il numero WhatsApp completo di prefisso internazionale.

```csv
telefono,nome,citta
+393331234567,Mario,Roma
+393491234567,Giulia,Milano
```

Le colonne aggiuntive possono essere collegate ai placeholder `{{1}}`, `{{2}}`, ecc. del template Twilio.

## Template Twilio e messaggi evoluti

Dalla pagina **Broadcast** è possibile creare un template Twilio, aggiungere media o pulsanti e inviarlo direttamente all'approvazione WhatsApp. La pubblicazione del template non è immediata: finché Twilio/Meta non lo approva, il template resta visibile ma non è selezionabile per un broadcast.

Il Sandbox Twilio consente di verificare chat, webhook e invio media, ma non l'uso completo dei template personalizzati. Per i broadcast reali servono un WhatsApp Sender Twilio registrato e i template approvati. Gli allegati possono pesare fino a 5 MB per le immagini e 16 MB per audio, video e documenti.

Gli allegati caricati sono conservati nel database e pubblicati tramite URL casuali non enumerabili, così Twilio può recuperarli. Questa soluzione è pratica per test e bassi volumi; prima di gestire molti file o documenti sensibili è consigliato usare uno storage a oggetti con una politica di conservazione dedicata.

## URL applicativi

- `/` — conversazioni e operatore;
- `/broadcast` — import CSV, template e stato invii;
- `/admin` — creazione e configurazione BOT;
- `/settings` — credenziali Twilio e gestione degli account;
- `/login` — accesso con username e password;
- `/webhook/whatsapp` — webhook messaggi Twilio;
- `/webhook/status` — callback stato Twilio;
- `/media/:token/:filename` — download pubblico degli allegati tramite token casuale;
- `/health` — stato applicazione e database.

## Hosting

L'app ascolta su `0.0.0.0:$PORT`, usa una normale `DATABASE_URL` PostgreSQL ed è distribuibile tramite il `Dockerfile` su qualsiasi piattaforma compatibile con container e WebSocket. Il percorso webhook deve essere raggiungibile pubblicamente da Twilio; le pagine e le API amministrative sono protette dall'autenticazione applicativa.

Per i broadcast, mantenere una sola istanza applicativa oppure introdurre un sistema di coda condiviso prima di scalare orizzontalmente.

### Deploy di test su Render

Il file `render.yaml` crea, senza modificare l'architettura dell'app:

- un Web Service Docker gratuito nella regione di Francoforte;
- un database Render PostgreSQL 15 gratuito;
- collegamento automatico tramite `DATABASE_URL`;
- una chiave di cifratura generata da Render;
- health check su `/health`;
- inizializzazione automatica dello schema a ogni avvio.

Per pubblicare:

1. inviare il repository su GitHub, GitLab o Bitbucket;
2. in Render scegliere **New > Blueprint** e collegare il repository;
3. confermare il file `render.yaml`;
4. inserire `BOOTSTRAP_ADMIN_USERNAME` e una `BOOTSTRAP_ADMIN_PASSWORD` di almeno 10 caratteri;
5. attendere il completamento del deploy e aprire l'URL `onrender.com`;
6. accedere e configurare Twilio dalla pagina **Impostazioni**.

Il piano gratuito è adatto esclusivamente al test: il Web Service si sospende dopo 15 minuti senza traffico e il database gratuito scade dopo 30 giorni. Prima della scadenza è possibile aggiornare separatamente Web Service e database senza cambiare applicazione.

### Netlify

La versione attuale non è adatta a un deploy completo direttamente su Netlify: usa Socket.IO, un processo broadcast persistente e un server Express sempre attivo. Netlify può ospitare il frontend, ma API, WebSocket e worker devono restare su un servizio Node/container con PostgreSQL. Per un test completo è più semplice usare un host compatibile con Docker o processi Node persistenti.

## Account e permessi

- `admin`: configurazione, BOT, utenti, chat e broadcast;
- `operator`: lettura BOT e gestione delle conversazioni;
- `broadcaster`: lettura BOT e gestione dei broadcast;
- `viewer`: sola lettura di conversazioni e broadcast.

Solo un amministratore può creare, modificare o disabilitare gli account. L'app impedisce di eliminare o disabilitare l'ultimo amministratore attivo.

## Sicurezza

- le API key AI sono cifrate con AES-256-GCM usando `APP_ENCRYPTION_KEY`;
- anche Auth Token e API Secret Twilio salvati dalle impostazioni sono cifrati;
- le password sono salvate come hash bcrypt e le sessioni come hash non reversibili;
- cambiare `APP_ENCRYPTION_KEY` senza ricifrare i valori rende inutilizzabili le chiavi già salvate;
- i webhook verificano la firma Twilio;
- gli URL pubblici degli allegati usano token casuali non memorizzati in chiaro;
- i segreti restano nelle variabili runtime e non vanno committati;
- usare HTTPS in produzione e limitare `ALLOWED_ORIGINS` al dominio della webapp.
