-- Keep the image default separate from the conversational default model.
ALTER TABLE metering_settings ADD COLUMN default_image_model TEXT;
UPDATE metering_settings SET default_image_model='gpt-image-2.5-sunburst'
WHERE id=1 AND EXISTS (
  SELECT 1 FROM image_model_routes
  WHERE model_id='gpt-image-2.5-sunburst' AND enabled=1 AND verified_at IS NOT NULL
);
