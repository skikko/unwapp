# Field

Campo di form: label, controllo (input, select, textarea, checkbox, switch), helper o errore.

- Struttura: `div.un-field` > `label.un-label` > controllo > `span.un-help` oppure `span.un-error`. Errore: aggiungere `un-field--invalid` al contenitore e collegare il messaggio con `aria-describedby`.
- Label sempre visibile sopra il campo (mai solo placeholder). "opzionale" in `<small>` dentro la label; i campi obbligatori non hanno asterisco.
- Valori tecnici (SID, token, URL) in `un-input--mono`.
- Disposizione: `un-form-grid` a due colonne, `un-span-2` per textarea e campi lunghi. Su mobile una colonna.
- Validazione al blur e al submit, non a ogni tasto.
