# Button

Bottone d'azione in quattro varianti (primary, secondary, ghost, danger) e tre taglie.

- Markup: `<button class="un-btn un-btn--primary">`; taglie `un-btn--sm` (32px, toolbar e tabelle), default 36px, `un-btn--lg` (44px, empty state). Solo icona: aggiungere `un-btn--icon` e `aria-label`.
- Un solo `primary` per vista: e' l'azione che la pagina esiste per compiere (Nuovo contatto, Invia broadcast).
- `secondary` per azioni frequenti ma non principali (Importa CSV). Esporta/Scarica modello vanno in un menu "Altre azioni", non in tre bottoni affiancati come nella v1.
- `danger` solo dentro un Modal di conferma, mai come azione diretta in tabella.
- Icona a sinistra della label, 16px. In stato di invio: label al gerundio e `disabled`.
