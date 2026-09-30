-- Separa i ruoli applicativi tra WhatsApp Manager e CRM.

ALTER TABLE app_users DROP CONSTRAINT IF EXISTS app_users_role_check;
UPDATE app_users
SET role = 'whatsapp_user'
WHERE role IN ('operator', 'broadcaster', 'viewer');
ALTER TABLE app_users ADD CONSTRAINT app_users_role_check
  CHECK (role IN ('admin', 'whatsapp_user', 'crm_user'));
