# Sidebar

Navigazione principale navy, comune a tutte le app.

- In alto lo switcher di workspace (`un-switcher`): apre un menu con Home, WhatsApp Manager, CRM, Utenti e accessi. Sostituisce la tab "Home" della v1 e il blocco "Workspace CRM".
- Voci `a.un-nav__item` con icona, label e contatore opzionale; la pagina attiva ha `aria-current="page"` (sfondo `navy-raised`, barra `accent`).
- Gruppi con `un-nav__section` (Workspace, Configurazione). Impostazioni dell'app in fondo al gruppo Configurazione.
- In basso utente e ruolo; "Esci" e preferenze nel menu dell'utente.
- Comprimibile a 64px (`un-shell--collapsed`): restano le icone con tooltip.
- Il riquadro "API ingest" della v1 si sposta in Impostazioni > Integrazioni come CopyField.
