# Badge

Stato breve con pallino e testo; varianti `--success`, `--warn`, `--danger`, `--accent`, default info. Include anche `un-tag` (origine, tag) e `un-count` (contatori).

- Il testo dice lo stato in parole ("Iscritto", "Fallito"): il colore non e' mai l'unico segnale.
- Mappatura fissa per dominio: vedi la sezione Colore del README.
- `un-tag` per valori liberi (origine, tag): neutro, bordo `line`. Non usare badge colorati per i tag.
- `un-count` arancio solo per i non letti; `un-count--muted` per conteggi informativi.
- Valore assente: niente badge "n/a", usare `<span class="un-empty-cell">-</span>`.
