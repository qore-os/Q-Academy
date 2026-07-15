ALTER TABLE "submissions" ADD COLUMN "content_format" varchar(20) DEFAULT 'plain_text' NOT NULL;--> statement-breakpoint
ALTER TABLE "submissions" ADD COLUMN "rich_text" jsonb;--> statement-breakpoint
ALTER TABLE "submissions" ADD COLUMN "content_projection_version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "submissions" ADD CONSTRAINT "submissions_content_length_check" CHECK ("submissions"."content" is null or char_length("submissions"."content") <= 50000);--> statement-breakpoint
ALTER TABLE "submissions" ADD CONSTRAINT "submissions_content_document_shape_check" CHECK ((
        "submissions"."content_format" = 'plain_text'
        and "submissions"."rich_text" is null
        and "submissions"."content_projection_version" = 1
      ) or (
        "submissions"."content_format" = 'rich_text'
        and "submissions"."content" is not null
        and btrim("submissions"."content") <> ''
        and "submissions"."rich_text" is not null
        and jsonb_typeof("submissions"."rich_text") = 'object'
        and "submissions"."rich_text" ->> 'version' = '1'
        and jsonb_typeof("submissions"."rich_text" -> 'blocks') = 'array'
        and char_length("submissions"."rich_text"::text) <= 100000
        and "submissions"."content_projection_version" = 1
      ));--> statement-breakpoint
CREATE FUNCTION "prevent_submission_content_update"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
	IF NEW.content IS DISTINCT FROM OLD.content
		OR NEW.content_format IS DISTINCT FROM OLD.content_format
		OR NEW.rich_text IS DISTINCT FROM OLD.rich_text
		OR NEW.content_projection_version IS DISTINCT FROM OLD.content_projection_version THEN
		RAISE EXCEPTION 'submission content is immutable' USING ERRCODE = '55000';
	END IF;
	RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE TRIGGER "submissions_prevent_content_update"
BEFORE UPDATE OF "content", "content_format", "rich_text", "content_projection_version" ON "submissions"
FOR EACH ROW
EXECUTE FUNCTION "prevent_submission_content_update"();
