import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateKoreader1790000000011 implements MigrationInterface {
  async up(runner: QueryRunner): Promise<void> {
    await runner.query(`
      CREATE TABLE koreader_device (
        id uuid PRIMARY KEY, user_id uuid NOT NULL, username varchar NOT NULL UNIQUE,
        verifier varchar NOT NULL, name varchar NOT NULL, created_at timestamptz NOT NULL,
        last_seen_at timestamptz, expires_at timestamptz NOT NULL, revoked_at timestamptz
      );
      CREATE INDEX koreader_device_user ON koreader_device(user_id);
      CREATE TABLE koreader_pairing (
        verifier varchar PRIMARY KEY, code_verifier varchar NOT NULL UNIQUE, name varchar NOT NULL,
        expires_at timestamptz NOT NULL, user_id uuid, last_poll_at timestamptz, claimed_at timestamptz
      );
      CREATE INDEX koreader_pairing_expiry ON koreader_pairing(expires_at);
      CREATE TABLE koreader_revision (
        user_id uuid PRIMARY KEY, revision bigint NOT NULL DEFAULT 0 CHECK (revision >= 0), scan_after uuid
      );
      CREATE TABLE koreader_native_progress (
        user_id uuid NOT NULL, document varchar NOT NULL, payload jsonb NOT NULL, revision bigint NOT NULL,
        PRIMARY KEY(user_id, document)
      );
      CREATE TABLE koreader_book_progress (
        user_id uuid NOT NULL, book_id uuid NOT NULL REFERENCES book_entity(id) ON DELETE CASCADE,
        percentage double precision CHECK (percentage >= 0 AND percentage <= 1),
        source varchar NOT NULL CHECK (source IN ('web','koreader')), device varchar NOT NULL,
        native_progress text, revision bigint NOT NULL, updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
        PRIMARY KEY(user_id, book_id)
      );
      CREATE TABLE koreader_annotation (
        user_id uuid NOT NULL, id varchar NOT NULL, book_id uuid NOT NULL REFERENCES book_entity(id) ON DELETE CASCADE,
        quote text NOT NULL, note text NOT NULL, color varchar NOT NULL, anchor jsonb NOT NULL,
        deleted boolean NOT NULL, revision bigint NOT NULL, updated_at timestamptz NOT NULL,
        PRIMARY KEY(user_id, id)
      );
      CREATE INDEX koreader_annotation_changes ON koreader_annotation(user_id, book_id, revision);
      CREATE TABLE koreader_mutation (
        user_id uuid NOT NULL, mutation_id varchar NOT NULL, request_hash varchar NOT NULL, result jsonb NOT NULL,
        PRIMARY KEY(user_id, mutation_id)
      );
      CREATE TABLE koreader_alias (
        user_id uuid NOT NULL, format_id uuid NOT NULL REFERENCES book_format_entity(id) ON DELETE CASCADE,
        document varchar NOT NULL, book_id uuid NOT NULL REFERENCES book_entity(id) ON DELETE CASCADE,
        content_hash varchar, fingerprint varchar NOT NULL, PRIMARY KEY(user_id, format_id, document)
      );
      CREATE INDEX koreader_alias_document ON koreader_alias(user_id, document);
      CREATE TABLE koreader_rate (bucket varchar PRIMARY KEY, count integer NOT NULL, expires_at timestamptz NOT NULL);
      CREATE INDEX koreader_rate_expiry ON koreader_rate(expires_at);
    `);
  }

  async down(runner: QueryRunner): Promise<void> {
    await runner.query(`DROP TABLE koreader_rate, koreader_alias, koreader_mutation, koreader_annotation,
      koreader_book_progress, koreader_native_progress, koreader_revision, koreader_pairing, koreader_device`);
  }
}
