"""Initial memory schema

Revision ID: 001
Revises:
Create Date: 2026-03-20
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "001"
down_revision: Union[str, None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # pgvector is optional for Phase 3 FTS-first retrieval; ignore if unavailable.
    op.execute(
        """
        DO $$ BEGIN
            CREATE EXTENSION IF NOT EXISTS vector;
        EXCEPTION
            WHEN others THEN NULL;
        END $$;
        """
    )

    # Create enum types once; column definitions must not re-create them (DuplicateObject).
    lifecycle = postgresql.ENUM(
        "candidate",
        "active",
        "superseded",
        "deleted",
        name="lifecyclestate",
        create_type=False,
    )
    memory_kind = postgresql.ENUM(
        "semantic",
        "episodic",
        "procedural",
        name="memorykind",
        create_type=False,
    )
    lifecycle.create(op.get_bind(), checkfirst=True)
    memory_kind.create(op.get_bind(), checkfirst=True)

    op.create_table(
        "personas",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("external_id", sa.String(128), nullable=False),
        sa.Column("display_name", sa.String(256)),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()")),
    )
    op.create_index("ix_personas_external_id", "personas", ["external_id"], unique=True)

    op.create_table(
        "participants",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("persona_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("personas.id", ondelete="CASCADE")),
        sa.Column("kind", sa.String(32), server_default="user"),
        sa.Column("display_name", sa.String(256)),
        sa.Column("external_id", sa.String(128)),
    )
    op.create_index("ix_participants_persona_id", "participants", ["persona_id"])

    op.create_table(
        "conversations",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("persona_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("personas.id", ondelete="CASCADE")),
        sa.Column("session_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("channel", sa.String(64), server_default="dashboard"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()")),
        sa.UniqueConstraint("persona_id", "session_id", name="uq_conversation_session"),
    )
    op.create_index("ix_conversations_persona_id", "conversations", ["persona_id"])
    op.create_index("ix_conversations_session_id", "conversations", ["session_id"])

    op.create_table(
        "messages",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("conversation_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("conversations.id", ondelete="CASCADE")),
        sa.Column("idempotency_key", sa.String(128), nullable=False),
        sa.Column("role", sa.String(16), nullable=False),
        sa.Column("content", sa.Text),
        sa.Column("sequence", sa.Integer, nullable=False),
        sa.Column("token_estimate", sa.Integer),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()")),
        sa.Column("search_vector", postgresql.TSVECTOR),
        sa.UniqueConstraint("conversation_id", "idempotency_key", name="uq_message_idempotency"),
    )
    op.create_index("ix_messages_conversation_id", "messages", ["conversation_id"])
    op.execute(
        """
        CREATE INDEX ix_messages_search ON messages USING gin (search_vector)
        """
    )

    op.create_table(
        "episodes",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("persona_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("personas.id", ondelete="CASCADE")),
        sa.Column("conversation_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("conversations.id", ondelete="SET NULL")),
        sa.Column("summary", sa.Text, nullable=False),
        sa.Column("importance", sa.Float, server_default="0.5"),
        sa.Column("lifecycle_state", lifecycle, server_default=sa.text("'active'::lifecyclestate")),
        sa.Column("started_at", sa.DateTime(timezone=True)),
        sa.Column("ended_at", sa.DateTime(timezone=True)),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()")),
        sa.Column("search_vector", postgresql.TSVECTOR),
    )

    op.create_table(
        "memories",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("persona_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("personas.id", ondelete="CASCADE")),
        sa.Column("kind", memory_kind, nullable=False),
        sa.Column("content", sa.Text, nullable=False),
        sa.Column("summary", sa.String(500)),
        sa.Column("lifecycle_state", lifecycle, server_default=sa.text("'candidate'::lifecyclestate")),
        sa.Column("confidence", sa.Float, server_default="0.5"),
        sa.Column("importance", sa.Float, server_default="0.5"),
        sa.Column("content_hash", sa.String(64), nullable=False),
        sa.Column("version", sa.Integer, server_default="1"),
        sa.Column("valid_from", sa.DateTime(timezone=True)),
        sa.Column("valid_to", sa.DateTime(timezone=True)),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()")),
        sa.Column("search_vector", postgresql.TSVECTOR),
    )
    op.create_index("ix_memories_persona_id", "memories", ["persona_id"])
    op.create_index("ix_memories_content_hash", "memories", ["content_hash"])
    op.execute("CREATE INDEX ix_memories_search ON memories USING gin (search_vector)")

    op.create_table(
        "memory_provenance",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("memory_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("memories.id", ondelete="CASCADE")),
        sa.Column("source_type", sa.String(32), nullable=False),
        sa.Column("source_id", postgresql.UUID(as_uuid=True)),
        sa.Column("excerpt", sa.Text),
        sa.Column("recorded_at", sa.DateTime(timezone=True), server_default=sa.text("now()")),
    )

    op.create_table(
        "memory_relations",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("from_memory_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("memories.id", ondelete="CASCADE")),
        sa.Column("to_memory_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("memories.id", ondelete="CASCADE")),
        sa.Column("relation_type", sa.String(32), nullable=False),
    )

    op.create_table(
        "procedures",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("persona_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("personas.id", ondelete="CASCADE")),
        sa.Column("title", sa.String(256), nullable=False),
        sa.Column("steps", postgresql.JSONB, server_default=sa.text("'{}'::jsonb")),
        sa.Column("lifecycle_state", lifecycle, server_default=sa.text("'active'::lifecyclestate")),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()")),
    )

    op.create_table(
        "embeddings",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("memory_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("memories.id", ondelete="CASCADE")),
        sa.Column("model_id", sa.String(128), nullable=False),
        sa.Column("model_version", sa.String(64), nullable=False),
        sa.Column("content_hash", sa.String(64), nullable=False),
        sa.Column("dimension", sa.Integer, nullable=False),
        sa.Column("vector_json", postgresql.JSONB),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()")),
    )

    op.create_table(
        "background_jobs",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("job_type", sa.String(64), nullable=False),
        sa.Column("payload", postgresql.JSONB, server_default=sa.text("'{}'::jsonb")),
        sa.Column("status", sa.String(32), server_default="pending"),
        sa.Column("attempts", sa.Integer, server_default="0"),
        sa.Column("idempotency_key", sa.String(128), nullable=False),
        sa.Column("scheduled_at", sa.DateTime(timezone=True), server_default=sa.text("now()")),
        sa.Column("started_at", sa.DateTime(timezone=True)),
        sa.Column("finished_at", sa.DateTime(timezone=True)),
        sa.Column("last_error", sa.Text),
        sa.UniqueConstraint("idempotency_key", name="uq_job_idempotency"),
    )

    op.create_table(
        "audit_events",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("event_type", sa.String(64), nullable=False),
        sa.Column("entity_type", sa.String(64), nullable=False),
        sa.Column("entity_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("actor", sa.String(128), server_default="memory-module"),
        sa.Column("metadata_json", postgresql.JSONB, server_default=sa.text("'{}'::jsonb")),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()")),
    )


def downgrade() -> None:
    for table in (
        "audit_events",
        "background_jobs",
        "embeddings",
        "procedures",
        "memory_relations",
        "memory_provenance",
        "memories",
        "episodes",
        "messages",
        "conversations",
        "participants",
        "personas",
    ):
        op.drop_table(table)
    postgresql.ENUM(name="lifecyclestate", create_type=False).drop(op.get_bind(), checkfirst=True)
    postgresql.ENUM(name="memorykind", create_type=False).drop(op.get_bind(), checkfirst=True)
