# Card

Pannello bianco con header, body e footer opzionali: il contenitore base di ogni pagina.

- `section.un-card` > `header.un-card__head` (titolo `un-card__title`, descrizione `un-card__desc`, a destra badge o azioni) > `div.un-card__body` > `footer.un-card__foot` (azioni allineate a destra, primaria per ultima).
- Bordo `line` + `shadow-sm`, raggio `radius-md`. Non annidare card dentro card: usare divisori `line-soft`.
- Una tabella occupa la card senza padding: Toolbar e DataTable vanno direttamente dentro `un-card`.
- La numerazione "01/02" dei passi della v1 si sostituisce con lo Stepper.
