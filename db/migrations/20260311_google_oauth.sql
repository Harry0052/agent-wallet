ALTER TABLE app_users
ADD COLUMN IF NOT EXISTS oauth_provider TEXT;

ALTER TABLE app_users
ADD COLUMN IF NOT EXISTS oauth_provider_id TEXT;

ALTER TABLE app_users
ADD COLUMN IF NOT EXISTS profile_picture TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS uq_app_users_oauth_identity
ON app_users (oauth_provider, oauth_provider_id)
WHERE oauth_provider IS NOT NULL
  AND oauth_provider_id IS NOT NULL;
