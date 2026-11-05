-- Migration 014: Allow small original cover files to keep their MIME type.
-- Files larger than 400 KiB are still converted to WebP by the client.

update storage.buckets
set allowed_mime_types = array[
  'image/webp',
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/bmp',
  'image/svg+xml',
  'image/avif'
]::text[],
    file_size_limit = 409600
where id = 'game-covers';
