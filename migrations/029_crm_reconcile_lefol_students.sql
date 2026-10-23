CREATE TEMP TABLE crm_lefol_memberships_to_reconcile ON COMMIT DROP AS
SELECT DISTINCT membership.contact_id
FROM crm_list_memberships membership
JOIN crm_lists list ON list.id = membership.list_id
WHERE membership.source = 'lefol-appscript'
  AND lower(list.name) = lower('Primo Step su CRM Lefol');

DELETE FROM crm_list_memberships membership
USING crm_lists list
WHERE membership.list_id = list.id
  AND membership.source = 'lefol-appscript'
  AND lower(list.name) = lower('Primo Step su CRM Lefol');

UPDATE crm_contacts contact
SET contact_status_id = status.id,
    updated_at = now()
FROM crm_contact_statuses status,
     crm_lefol_memberships_to_reconcile affected
WHERE contact.id = affected.contact_id
  AND lower(status.name) = lower(
    CASE
      WHEN EXISTS (
        SELECT 1
        FROM crm_list_memberships membership
        JOIN crm_lists list ON list.id = membership.list_id
        WHERE membership.contact_id = contact.id
          AND lower(list.name) IN ('da ricontattare', 'last call lefol', 'last call lefol crm')
      ) THEN 'Richiesta di contatto'
      ELSE 'Lead'
    END
  );
