-- Clear stock / generated face avatar URLs so the app shows local initials.
-- Real user uploads (data:image/... base64) and other custom URLs are left alone.
UPDATE people
SET avatar_url = ''
WHERE avatar_url LIKE '%pravatar.cc%'
   OR avatar_url LIKE '%ui-avatars.com%';
