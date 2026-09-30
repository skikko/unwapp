# UN Platform

Piattaforma con due aree applicative separate: WhatsApp Manager per messaggistica e broadcast, CRM per contatti e invii email. Il progetto è portabile e non dipende da uno specifico provider di hosting.

## Manuale operativo

La guida completa alla configurazione Twilio, agli endpoint dei nuovi numeri e all'utilizzo della webapp è disponibile in [output/pdf/UN-WhatsApp-Manager-Manuale-configurazione-e-utilizzo.pdf](output/pdf/UN-WhatsApp-Manager-Manuale-configurazione-e-utilizzo.pdf).

## Funzioni

- creazione di BOT con numero WhatsApp Twilio, provider AI, modello, prompt e lingua;
- passaggio tra risposte AI e modalità solo operatore senza eliminare la chiave API;
- API key OpenAI o Gemini per singolo BOT, cifrata nel database e mai restituita al browser;
- webhook Twilio firmati, risposte automatiche e passaggio a operatore;
- base di conoscenza PDF con testo ed embedding conservati in PostgreSQL/pgvector;
- import CSV fino a 10.000 contatti con anteprima, rilevamento separatore, validazione E.164 e deduplicazione;
- creazione dei Content Template Twilio dalla pagina **Broadcast**, richiesta di approvazione WhatsApp e mappatura dei placeholder sulle colonne CSV;
- template testuali, con media, call to action, risposte rapide e card;
- broadcast asincroni, ripresa dopo riavvio, avanzamento e dettaglio errori per destinatario;
- chat operatore con testo, immagini, documenti, audio, video e pulsanti interattivi;
- interfaccia “UN WhatsApp Manager” ispirata al design system di [United Network](https://www.unitednetwork.it/en/home-en/).
- accesso con username e password, sessioni revocabili e ruoli `admin`, `whatsapp_user` e `crm_user`;
- configurazione Twilio cifrata dalla pagina **Impostazioni**, senza modificare il file `.env`.
- CRM leggero con rubrica unificata, import ed export CSV, appartenenza alle liste, modifica massiva dei contatti, liste dinamiche, builder email visuale con preview e invio di test, single send e sequenze con trigger di ingresso nelle liste e monitoraggio dei contatti;
- sender Gmail o SMTP configurabile, con credenziali cifrate nel database;
- API ingest autenticata per WordPress, Meta e altri sistemi; i contatti WhatsApp vengono sincronizzati automaticamente.

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
npm run migrate:check
```

Lo script usa la tabella `schema_migrations` per registrare nome, checksum SHA-256 e data di ogni migrazione. `npm run migrate:check` fallisce se esistono migrazioni pendenti o se il contenuto di una migrazione già applicata è cambiato. Le migrazioni vengono eseguite separatamente dall'avvio dell'applicazione.

## CSV contatti

La prima riga deve contenere le intestazioni. Sono accettati separatori virgola, punto e virgola e tab. Una colonna deve contenere il numero WhatsApp completo di prefisso internazionale.

```csv
Numero di telefono,Nome,Cognome,Citta
+393331234567,Mario,Rossi,Roma
+393491234567,Giulia,Bianchi,Milano
```

Le colonne `Nome` e `Cognome` vengono associate alla conversazione e mostrate sopra il numero di telefono. Le colonne aggiuntive possono essere collegate ai placeholder `{{1}}`, `{{2}}`, ecc. del template Twilio.

Nel CRM è disponibile un import separato dalla rubrica. Il modello CSV si scarica dalla pagina `/crm`; durante l'importazione è possibile aggiungere tag comuni e inserire i contatti in una lista. Email e telefono vengono usati per evitare duplicati, mentre le colonne non mappate sono conservate come campi personalizzati.

## Template Twilio e messaggi evoluti

Dalla pagina **Broadcast** è possibile creare un template Twilio, aggiungere media o pulsanti e inviarlo direttamente all'approvazione WhatsApp. La pubblicazione del template non è immediata: finché Twilio/Meta non lo approva, il template resta visibile ma non è selezionabile per un broadcast.

Il Sandbox Twilio consente di verificare chat, webhook e invio media, ma non l'uso completo dei template personalizzati. Per i broadcast reali servono un WhatsApp Sender Twilio registrato e i template approvati. Gli allegati possono pesare fino a 5 MB per le immagini e 16 MB per audio, video e documenti.

In locale gli allegati possono essere conservati nel database. In produzione è supportato uno storage S3 compatibile, configurato tramite `MEDIA_STORAGE_PROVIDER=s3` e le variabili `OBJECT_STORAGE_*`. Gli URL pubblici restano casuali e non enumerabili. Per trasferire gli allegati esistenti dal database allo storage configurato:

```bash
npm run migrate:media
```

Eseguire prima un backup e verificare il conteggio dei file. Lo script conserva i metadati nel database e rimuove il contenuto binario solo dopo il caricamento riuscito.

## URL applicativi

- `/`: selezione dell'applicazione;
- `/whatsapp`: conversazioni e operatore;
- `/whatsapp/broadcast`: import CSV, template e stato invii;
- `/whatsapp/bots`: creazione e configurazione BOT;
- `/whatsapp/settings`: credenziali Twilio;
- `/crm`: contatti, liste, template email, sequenze e invii;
- `/crm/settings`: sender email e documentazione API;
- `/users`: gestione centralizzata degli account;
- `/login`: accesso con username e password;
- `/webhook/whatsapp`: webhook messaggi Twilio;
- `/webhook/status`: callback stato Twilio;
- `/media/:token/:filename`: download pubblico degli allegati tramite token casuale;
- `/health`: stato applicazione e database.

## API CRM

L’endpoint `POST /api/ingest/contacts` usa chiavi dedicate create da `/crm/settings`. Ogni chiave ha una sorgente obbligatoria, scope, scadenza opzionale, rotazione e revoca. Per importare contatti serve lo scope `contacts:write`; per l'invio WhatsApp serve `whatsapp:send`. La chiave completa viene mostrata una sola volta.

Ogni richiesta di ingest deve includere `Authorization: Bearer crm_live_...` e un header `Idempotency-Key` univoco. Accetta un singolo contatto o un array `contacts` fino a 1.000 elementi. Il batch è atomico: se un elemento non è valido, non viene salvato alcun contatto. La ripetizione della stessa richiesta restituisce il risultato già registrato; il riuso della stessa idempotency key con un contenuto diverso restituisce `409`.

```json
{
  "source": "wordpress",
  "email": "nome@example.com",
  "firstName": "Nome",
  "contactType": "student",
  "webinarRegisteredAt": "2026-09-15",
  "utmSource": "google",
  "utmMedium": "cpc",
  "utmCampaign": "webinar_settembre",
  "tags": ["landing"],
  "customFields": {
    "formId": "newsletter-footer"
  }
}
```

Le API operative sotto `/api/crm` usano la sessione applicativa e i permessi `crm:read` e `crm:write`. Il ruolo amministratore configura il sender da `/crm/settings`. Per Gmail è richiesta una app password; la password principale dell’account non va usata.

## Hosting

L'app ascolta su `0.0.0.0:$PORT`, usa una normale `DATABASE_URL` PostgreSQL ed è distribuibile tramite il `Dockerfile` su qualsiasi piattaforma compatibile con container e WebSocket. Il percorso webhook deve essere raggiungibile pubblicamente da Twilio; le pagine e le API amministrative sono protette dall'autenticazione applicativa.

I destinatari dei broadcast vengono prenotati atomicamente in PostgreSQL. Durante un deploy, istanze sovrapposte non possono acquisire lo stesso destinatario. Un invio interrotto con esito non verificabile viene marcato come fallito dopo 60 minuti e non viene reinviato automaticamente.

### Deploy su Render

Il file `render.yaml` descrive i servizi esistenti con questi identificativi:

- Web Service Docker `un-whatsapp-manager`, piano `0.5c-512mb`, regione Francoforte;
- database `un-whatsapp-manager-db`, PostgreSQL 15, piano `0.5c-1g`, disco da 1 GB;
- collegamento automatico tramite `DATABASE_URL`;
- `APP_ENCRYPTION_KEY` come segreto `sync: false`, mai generato dal Blueprint;
- health check su `/health`.

Le migrazioni non vengono eseguite all'avvio del container. Render le esegue nel comando `preDeployCommand`, seguito dalla verifica dei checksum e della chiave di cifratura. Prima di avviare il deploy, da una macchina autorizzata:

```bash
export DATABASE_URL='postgresql://...'
export APP_ENCRYPTION_KEY='valore-attuale-di-render'
npm run backup
npm run verify:encryption-key
```

Il backup viene scritto in `backups/` nel formato custom di PostgreSQL, verificato con `pg_restore` e accompagnato da checksum SHA-256. È possibile cambiare la destinazione impostando `BACKUP_DIR`.

Per pubblicare il codice:

1. inviare il repository su GitHub, GitLab o Bitbucket;
2. in Render scegliere **New > Blueprint** e collegare il repository;
3. verificare che i nomi del Web Service e del database corrispondano a quelli esistenti, senza creare nuove risorse;
4. inserire `BOOTSTRAP_ADMIN_USERNAME` e una `BOOTSTRAP_ADMIN_PASSWORD` di almeno 10 caratteri;
5. verificare che `APP_ENCRYPTION_KEY` conservi il valore attuale;
6. attendere il completamento del deploy e aprire l'URL `onrender.com`;
7. accedere e configurare Twilio dalla pagina **Impostazioni**.

L'applicazione registra nel database un controllo cifrato. Se un deploy usa una `APP_ENCRYPTION_KEY` diversa, il `preDeployCommand` fallisce e la nuova versione non viene promossa. Se esistono dati cifrati precedenti al controllo, vengono verificati prima di registrarlo.

## Account e permessi

- `admin`: accesso completo a WhatsApp Manager, CRM, impostazioni e utenti;
- `whatsapp_user`: accesso esclusivo a conversazioni e broadcast WhatsApp;
- `crm_user`: accesso esclusivo a contatti, liste, template, sequenze e invii email.

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
