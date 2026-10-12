ALTER TABLE courts
  ADD COLUMN IF NOT EXISTS image_urls TEXT[] NOT NULL DEFAULT '{}';

-- Giữ lại ảnh sân đã tải lên trước đây.
UPDATE courts
SET image_urls = ARRAY[image_url]
WHERE cardinality(image_urls) = 0
  AND NULLIF(BTRIM(image_url), '') IS NOT NULL;
