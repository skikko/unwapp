UPDATE crm_email_templates
SET editor_mode = 'html'
WHERE builder_json IS NULL;
