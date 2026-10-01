# DataTable

Tabella dati con toolbar filtri, selezione multipla, bulk bar e paginazione, dentro una Card.

- Ordine fisso: `un-toolbar` (ricerca 280px, filtri a chip `un-filter`, spaziatore, menu Colonne) > `un-bulkbar` (solo con righe selezionate) > `un-table-wrap` > `un-pager`.
- Filtri: chip tratteggiato "+ Origine" apre un popover; quando attivo diventa pieno con il valore e la X per rimuoverlo. Si applicano subito, niente bottone "Applica filtri".
- Prima colonna: avatar + nome in `ink` + metadato in `caption`. Le altre celle in `ink-soft`. Numeri allineati a destra con `un-num`; telefoni e ID in `un-code`.
- Header sticky, scroll orizzontale solo dentro `un-table-wrap`. Colonne oltre 7: nasconderle di default e renderle attivabili da "Colonne".
- Click sulla riga apre il dettaglio in un drawer laterale (`pane-detail`), non una nuova pagina.
- Azioni di riga nel menu "..." a fine riga. Densita' compatta con `un-table--compact`.
- Il consumer fornisce: righe, colonne visibili, stato di selezione, paginazione server-side.
