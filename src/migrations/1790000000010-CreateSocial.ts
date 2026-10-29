import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateSocial1790000000010 implements MigrationInterface {
  async up(runner: QueryRunner): Promise<void> {
    await runner.query(`
      CREATE TABLE social_account (
        user_id varchar PRIMARY KEY, name varchar NOT NULL,
        allow_friend_requests boolean NOT NULL DEFAULT true,
        club_invites varchar NOT NULL DEFAULT 'anyone' CHECK (club_invites IN ('anyone','friends','nobody'))
      );
      CREATE TABLE social_friendship (
        low_id varchar NOT NULL, high_id varchar NOT NULL, id uuid NOT NULL UNIQUE,
        requester_id varchar NOT NULL, status varchar NOT NULL CHECK (status IN ('pending','accepted','declined','cancelled','removed')),
        created_at timestamptz NOT NULL DEFAULT now(), resolved_at timestamptz,
        PRIMARY KEY (low_id,high_id), CHECK (low_id < high_id),
        CHECK (requester_id IN (low_id,high_id))
      );
      CREATE TABLE social_block (
        user_id varchar NOT NULL, blocked_id varchar NOT NULL, PRIMARY KEY(user_id,blocked_id),
        CHECK(user_id <> blocked_id)
      );
      CREATE INDEX social_block_reverse ON social_block(blocked_id,user_id);
      CREATE TABLE social_club_invitation (
        id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        club_id uuid NOT NULL REFERENCES book_club_entity(id) ON DELETE CASCADE,
        inviter_id varchar NOT NULL, invitee_id varchar NOT NULL,
        status varchar NOT NULL CHECK (status IN ('pending','accepted','declined','cancelled','expired')),
        created_at timestamptz NOT NULL DEFAULT now(), expires_at timestamptz NOT NULL,
        resolved_at timestamptz, CHECK(inviter_id <> invitee_id), CHECK(expires_at > created_at)
      );
      CREATE UNIQUE INDEX social_invitation_pending ON social_club_invitation(club_id,invitee_id) WHERE status='pending';
      CREATE INDEX social_invitation_recipient ON social_club_invitation(invitee_id,status);
      CREATE INDEX social_invitation_resend ON social_club_invitation(club_id,invitee_id,resolved_at DESC);
      CREATE TABLE social_club_mute (
        club_id uuid NOT NULL REFERENCES book_club_entity(id) ON DELETE CASCADE,
        user_id varchar NOT NULL, muted boolean NOT NULL DEFAULT false, PRIMARY KEY(club_id,user_id)
      );
      CREATE TABLE social_notification (
        id uuid PRIMARY KEY DEFAULT uuid_generate_v4(), recipient_id varchar NOT NULL,
        actor_id varchar NOT NULL, kind varchar NOT NULL, event_key varchar NOT NULL,
        club_id uuid, thread_id uuid, reply_id uuid, request_id uuid,
        created_at timestamptz NOT NULL DEFAULT now(), read_at timestamptz, dismissed_at timestamptz,
        UNIQUE(recipient_id,event_key), CHECK(recipient_id <> actor_id)
      );
      CREATE INDEX social_notification_inbox ON social_notification(recipient_id,created_at DESC) WHERE dismissed_at IS NULL;
      CREATE TABLE social_rate (
        user_id varchar NOT NULL, scope varchar NOT NULL, window_start timestamptz NOT NULL,
        count integer NOT NULL CHECK(count > 0), PRIMARY KEY(user_id,scope)
      );
    `);
  }

  async down(runner: QueryRunner): Promise<void> {
    await runner.query(
      `DROP TABLE social_rate,social_notification,social_club_mute,social_club_invitation,social_block,social_friendship,social_account`,
    );
  }
}
