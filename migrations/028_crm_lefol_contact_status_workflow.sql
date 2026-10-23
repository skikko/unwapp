INSERT INTO crm_contact_statuses (name, sort_order)
VALUES
  ('Lead', 10),
  ('Richiesta di contatto', 20),
  ('Iscritto Primo Step', 30)
ON CONFLICT (lower(name)) DO NOTHING;

INSERT INTO crm_lists (name, description, filter_json, created_by)
SELECT
  'Primo Step su CRM Lefol',
  'Contatti iscritti al Primo Step LEFOL',
  '{}'::jsonb,
  'migration'
WHERE NOT EXISTS (
  SELECT 1
  FROM crm_lists
  WHERE lower(name) = lower('Primo Step su CRM Lefol')
);

CREATE OR REPLACE FUNCTION crm_set_default_contact_status() RETURNS TRIGGER AS $$
BEGIN
  IF NEW.contact_status_id IS NULL THEN
    SELECT status.id
    INTO NEW.contact_status_id
    FROM crm_contact_statuses status
    WHERE lower(status.name) = lower('Lead')
    LIMIT 1;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_crm_contacts_default_status ON crm_contacts;
CREATE TRIGGER trg_crm_contacts_default_status
BEFORE INSERT ON crm_contacts
FOR EACH ROW EXECUTE FUNCTION crm_set_default_contact_status();

CREATE OR REPLACE FUNCTION crm_apply_list_contact_status() RETURNS TRIGGER AS $$
DECLARE
  target_list_name TEXT;
  target_status_id UUID;
  target_status_name TEXT;
  updated_rows INT;
BEGIN
  SELECT lower(list.name)
  INTO target_list_name
  FROM crm_lists list
  WHERE list.id = NEW.list_id;

  IF target_list_name IN ('da ricontattare', 'last call lefol', 'last call lefol crm') THEN
    target_status_name := 'Richiesta di contatto';
  ELSIF target_list_name = 'primo step su crm lefol' THEN
    IF EXISTS (
      SELECT 1
      FROM crm_list_memberships membership
      JOIN crm_lists list ON list.id = membership.list_id
      WHERE membership.contact_id = NEW.contact_id
        AND lower(list.name) IN ('da ricontattare', 'last call lefol', 'last call lefol crm')
    ) THEN
      RETURN NEW;
    END IF;

    target_status_name := 'Iscritto Primo Step';
  ELSE
    RETURN NEW;
  END IF;

  SELECT status.id
  INTO target_status_id
  FROM crm_contact_statuses status
  WHERE lower(status.name) = lower(target_status_name)
  LIMIT 1;

  UPDATE crm_contacts contact
  SET contact_status_id = target_status_id,
      updated_at = now()
  WHERE contact.id = NEW.contact_id
    AND contact.contact_status_id IS DISTINCT FROM target_status_id;

  GET DIAGNOSTICS updated_rows = ROW_COUNT;

  IF updated_rows > 0 THEN
    INSERT INTO crm_contact_events (contact_id, event_type, event_data, actor)
    VALUES (
      NEW.contact_id,
      'contact_status_changed',
      jsonb_build_object(
        'status', target_status_name,
        'listId', NEW.list_id,
        'source', NEW.source
      ),
      'status_rule'
    );
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_crm_list_membership_status ON crm_list_memberships;
CREATE TRIGGER trg_crm_list_membership_status
AFTER INSERT ON crm_list_memberships
FOR EACH ROW EXECUTE FUNCTION crm_apply_list_contact_status();

UPDATE crm_contacts contact
SET contact_status_id = status.id,
    updated_at = now()
FROM crm_contact_statuses status
WHERE contact.contact_status_id IS NULL
  AND lower(status.name) = lower('Lead');

CREATE TEMP TABLE crm_lefol_students_to_reclassify ON COMMIT DROP AS
SELECT DISTINCT membership.contact_id
FROM crm_list_memberships membership
JOIN crm_lists list ON list.id = membership.list_id
WHERE membership.source = 'lefol-appscript'
  AND lower(list.name) = lower('Last Call LEFOL CRM');

INSERT INTO crm_list_memberships (list_id, contact_id, source)
SELECT list.id, student.contact_id, 'lefol-appscript'
FROM crm_lefol_students_to_reclassify student
CROSS JOIN LATERAL (
  SELECT id
  FROM crm_lists
  WHERE lower(name) = lower('Primo Step su CRM Lefol')
  LIMIT 1
) list
ON CONFLICT DO NOTHING;

DELETE FROM crm_list_memberships membership
USING crm_lists list, crm_lefol_students_to_reclassify student
WHERE membership.list_id = list.id
  AND membership.contact_id = student.contact_id
  AND membership.source = 'lefol-appscript'
  AND lower(list.name) = lower('Last Call LEFOL CRM');

UPDATE crm_contacts contact
SET tags = ARRAY(
      SELECT tag
      FROM unnest(contact.tags) tag
      WHERE lower(tag) <> lower('LastCallDaLefol')
    ),
    updated_at = now()
FROM crm_lefol_students_to_reclassify student
WHERE contact.id = student.contact_id
  AND EXISTS (
    SELECT 1
    FROM unnest(contact.tags) tag
    WHERE lower(tag) = lower('LastCallDaLefol')
  );

UPDATE crm_contacts contact
SET contact_status_id = status.id,
    updated_at = now()
FROM crm_contact_statuses status,
     crm_lefol_students_to_reclassify student
WHERE contact.id = student.contact_id
  AND lower(status.name) = lower(
    CASE
      WHEN EXISTS (
        SELECT 1
        FROM crm_list_memberships membership
        JOIN crm_lists list ON list.id = membership.list_id
        WHERE membership.contact_id = contact.id
          AND lower(list.name) IN ('da ricontattare', 'last call lefol', 'last call lefol crm')
      ) THEN 'Richiesta di contatto'
      ELSE 'Iscritto Primo Step'
    END
  )
  AND contact.contact_status_id IS DISTINCT FROM status.id;

UPDATE crm_contacts contact
SET contact_status_id = status.id,
    updated_at = now()
FROM crm_contact_statuses status
WHERE lower(status.name) = lower('Iscritto Primo Step')
  AND contact.contact_status_id IS DISTINCT FROM status.id
  AND EXISTS (
    SELECT 1
    FROM crm_list_memberships membership
    JOIN crm_lists list ON list.id = membership.list_id
    WHERE membership.contact_id = contact.id
      AND lower(list.name) = lower('Primo Step su CRM Lefol')
  )
  AND NOT EXISTS (
    SELECT 1
    FROM crm_list_memberships membership
    JOIN crm_lists list ON list.id = membership.list_id
    WHERE membership.contact_id = contact.id
      AND lower(list.name) IN ('da ricontattare', 'last call lefol', 'last call lefol crm')
  );

UPDATE crm_contacts contact
SET contact_status_id = status.id,
    updated_at = now()
FROM crm_contact_statuses status
WHERE lower(status.name) = lower('Richiesta di contatto')
  AND contact.contact_status_id IS DISTINCT FROM status.id
  AND EXISTS (
    SELECT 1
    FROM crm_list_memberships membership
    JOIN crm_lists list ON list.id = membership.list_id
    WHERE membership.contact_id = contact.id
      AND lower(list.name) IN ('da ricontattare', 'last call lefol', 'last call lefol crm')
  );
