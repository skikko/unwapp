UN Platform e' il back office di United Network: un launcher, un **WhatsApp Manager** (conversazioni, BOT, template Twilio, broadcast), un **CRM** (contatti, liste, template email, sequenze, invii) e l'area **Utenti e accessi**. Questa versione 2 mantiene la palette originale (arancio `accent` #f4512c, navy `navy` #171a23, neutri freddi) e cambia struttura, densita' e gerarchia per un uso operativo quotidiano.

## Principi

1. **Il dato prima della cornice.** Titoli di pagina a 24px (`title-lg`), non 54-72px. Lo spazio verticale va alle tabelle e alle conversazioni.
2. **Una sola shell per tutte le app.** Sidebar navy a sinistra, topbar bianca, contenuto su `surface-soft`. Niente piu' tab a pillola centrate in alto e sidebar diverse tra CRM e WhatsApp.
3. **L'arancio e' un segnale, non un riempitivo.** Al massimo un bottone primario per vista. Usare `accent` per identita' e indicatori, `accent-strong` per i bottoni, `accent-text` per testo e link.
4. **Azioni immediate.** I filtri si applicano mentre si digita (debounce 250ms): niente bottone "Applica filtri". Le azioni distruttive chiedono conferma in un Modal, le altre mostrano un Toast con "Annulla".
5. **Stati sempre a parole.** Ogni badge di stato ha testo e pallino; il colore da solo non porta mai significato.

## Contenuti e tono

- Interfaccia in italiano, registro professionale, seconda persona implicita: "Crea un BOT", "Importa CSV", "Seleziona una conversazione".
- Bottoni con verbo all'infinito o imperativo, sentence case: "Nuovo contatto", "Esporta CSV". Mai tutto maiuscolo nei bottoni.
- Maiuscolo solo per `overline` (eyebrow e intestazioni di colonna): "RUBRICA UNIFICATA", "STATO EMAIL".
- Valori mancanti: trattino lungo in `ink-placeholder` nella tabella (classe `un-empty-cell`), non la stringa "n/a" in un badge.
- Niente emoji. Sigle di prodotto come le scrive il dominio: BOT, CSV, SID, Twilio, WhatsApp.
- Empty state con titolo, una frase che dice cosa succedera', un'azione: "Nessun BOT configurato. Collega un numero Twilio per ricevere e inviare messaggi." + "Crea BOT".

## Colore

| Ruolo | Token | Regola |
| --- | --- | --- |
| Identita' | `accent` | Tile app, indicatore nav attiva, pallini non letti, barre di progresso, testo da 24px in su. Mai sotto testo bianco da 14px (3.47:1). |
| Azione primaria | `accent-strong`, hover `accent-hover` | Fill del bottone primario, checkbox e switch attivi, focus ring. |
| Testo arancio | `accent-text` | Link, eyebrow, azioni inline. |
| Selezione | `accent-soft` | Riga selezionata, conversazione aperta, filtro attivo. |
| Testo | `ink` > `ink-soft` > `ink-muted` | Titoli e valori, celle e descrizioni, metadati e helper. `ink-placeholder` solo per placeholder e disabilitati. |
| Superfici | `surface-soft` (sfondo app), `surface` (pannelli), `surface-hover` (hover) | Pannelli bianchi con bordo `line` su sfondo `surface-soft`. |
| Navy | `navy`, `navy-raised`, `navy-line` | Sidebar, tile CRM, toast, tooltip, bolle in uscita. Testo `ink-inverse` / `ink-inverse-muted` / `accent-on-navy`. |
| Bordi | `line`, `line-soft`, `line-control` | `line` e `line-soft` sono decorativi; ogni controllo (input, select, checkbox, bottone secondario) usa `line-control`. |
| Stato | `success`/`warn`/`danger`/`info` + `-soft` + `-text` | Badge e callout: sfondo `-soft`, testo `-text` (o `danger`, `info`). |

Mappatura stati di dominio, da usare ovunque allo stesso modo:

- Email: Iscritto = success, Disiscritto = warn, Bounce/Errore = danger, Da verificare = info.
- Messaggi e invii: Consegnato/Letto = success, In coda/Bozza = info, In invio = accent, Fallito = danger.
- Configurazione: Configurato = success, Non configurato = danger, Parziale = warn.

## Tipografia

Famiglia `sans` = Figtree (Google Fonts, 400-800), con fallback "Avenir Next" per restare vicini al look attuale su macOS. `mono` = IBM Plex Mono per SID, URL webhook, path API, numeri di telefono in tabella. La v1 dichiarava Inter senza caricarlo: ogni sistema mostrava un font diverso.

Scala unica di 11 stili al posto dei 22 corpi e 11 pesi della v1. Nessun testo sotto 12px (la v1 usava 8-10px). Numeri tabellari ovunque (`font-feature-settings: "tnum"`).

- `display` solo nel launcher Home. `title-lg` titolo pagina. `metric` valore delle StatCard.
- `title` titoli di card e modal. `title-sm` nomi in liste e header conversazione.
- `body` testo standard, `body-sm` righe secondarie, `label` etichette, bottoni e tab, `caption` helper e timestamp, `overline` eyebrow e intestazioni colonna.

## Spaziatura, raggi, ombre

- Griglia a 4px: `space-1` ... `space-12`. Gutter di pagina `space-6`, padding card `space-5`, gap tra campi `space-4`.
- Raggi ridotti per un aspetto piu' preciso: `radius-sm` 8px controlli, `radius-md` 12px card e tabelle, `radius-lg` 16px modal e tile Home. Il 26px della v1 non si usa piu'.
- Pannelli piatti: bordo `line` + `shadow-sm`. `shadow-md` per menu e popover, `shadow-lg` per modal e toast.
- Altezze: controlli `control-md` 36px (32px `control-sm` in toolbar e tabelle, 44px `control-lg` nel composer), righe tabella `row-height` 48px (40px in densita' compatta).

## Layout

**Shell.** `un-shell` = Sidebar (`sidebar-width` 240px, comprimibile a `sidebar-collapsed` 64px) + Topbar (`topbar-height` 56px) + contenuto. La sidebar contiene in alto lo switcher di workspace (Home, WhatsApp Manager, CRM, Utenti: un solo menu sostituisce le tab "Home" ripetute), poi la navigazione dell'app corrente, in fondo l'utente con "Esci" nel menu. La topbar ospita breadcrumb, ricerca globale con <kbd>Cmd K</kbd> e azioni contestuali.

**Pagine elenco (Contatti, Liste, Template, Sequenze, Invii, BOT).** PageHeader (overline opzionale, titolo, descrizione, max un bottone primario + azioni secondarie raggruppate in un menu "Importa/Esporta") > riga StatCard opzionale > una Card che contiene Toolbar filtri, DataTable con header sticky e scroll orizzontale interno, Pager. Le colonne si scelgono da un menu "Colonne"; la selezione mostra la BulkBar.

**Inbox WhatsApp.** Tre pannelli a tutta altezza: lista conversazioni (`pane-list` 340px) con selettore BOT nell'header e filtri a segmented control, thread al centro, dettaglio contatto (`pane-detail` 320px) richiudibile. La colonna BOT dedicata della v1 viene eliminata.

**Wizard (Broadcast, import CSV).** Stepper in alto, un passo alla volta in una Card, riepilogo/anteprima sticky a destra, footer con "Indietro" e azione del passo. Gli avvisi bloccanti (es. Twilio non configurato) sono un Callout in pagina con link alle Impostazioni, non un tooltip sovrapposto all'header.

**Impostazioni.** Colonna unica fino a `content-max`, una Card per sezione con stato a badge nell'header, footer di salvataggio per card. Valori da copiare in CopyField.

## Stati e interazione

- Focus: outline 2px `accent-strong` con offset 2px su ogni elemento interattivo (4.55:1 su `surface`).
- Hover: `surface-hover` su righe, voci di lista e bottoni ghost; `accent-hover` sul primario.
- Disabilitato: opacita' 45%, cursore not-allowed, tooltip che spiega perche'.
- Caricamento: skeleton delle righe nella tabella (non spinner a pagina intera); bottone in invio con label "Invio in corso..." e disabilitato.
- Motion: 120-150ms ease-out su colori e ombre; nessuna animazione di layout; rispettare `prefers-reduced-motion`.

## Performance (linee guida di implementazione)

- Un solo foglio `bundle.css` + `tokens.css`, niente CSS per pagina duplicato. Font in `display=swap`, idealmente self-hosted con preload del peso 600.
- Tabelle oltre 200 righe: paginazione server-side (50 per pagina) o virtualizzazione; header sticky via CSS, non JS.
- Lista conversazioni: virtualizzata, aggiornamento incrementale (solo la voce cambiata), non re-render di tutta la colonna.
- Ricerca e filtri con debounce 250ms e richiesta annullabile (AbortController).
- Ombre leggere (`shadow-sm`) sui pannelli: le ombre ampie della v1 (48-80px di blur) su molti elementi costano in repaint durante lo scroll.

## Iconografia

La v1 non ha un set di icone (solo glifi testuali). Aggiunta intenzionale: Lucide (licenza ISC), SVG inline, tratto 1.75, 16px nel testo e nei bottoni, 20px negli empty state, colore `currentColor` tramite classe `un-icon`. Le icone non sostituiscono mai la label nei bottoni primari; i bottoni solo icona hanno `aria-label` e tooltip.

## Marchio

Il marchio e' tipografico: le lettere "UN" in Figtree 800 su tile `navy` (`un-mark`), oppure su `accent` con testo navy nella sidebar. Le app usano tile con sigla ("WA", "CRM") nello stesso formato. Non esiste un file logo nei sorgenti.

## Uso del kit

Caricare `tokens.css` e `components/bundle.css`, mettere `class="un-root"` sul body. Tutte le classi hanno prefisso `un-` e leggono solo variabili dei token: per cambiare un colore si cambia il token, mai il componente. Le schermate nel gruppo "Screens" sono il riferimento di composizione per ogni area dell'app.
