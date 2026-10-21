"""Memory scope, event time, social involvements, participant last seen

Revision ID: 003
Revises: 002
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "003"
down_revision: Union[str, None] = "002"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    memoryscope = postgresql.ENUM("participant", "social", "general", name="memoryscope", create_type=False)
    memoryscope.create(op.get_bind(), checkfirst=True)

    op.add_column(
        "memories",
        sa.Column(
            "scope",
            postgresql.ENUM("participant", "social", "general", name="memoryscope", create_type=False),
            nullable=False,
            server_default="participant",
        ),
    )
    op.add_column("memories", sa.Column("occurred_at", sa.DateTime(timezone=True), nullable=True))
    op.create_index("ix_memories_scope", "memories", ["scope"])

    op.create_table(
        "memory_involvements",
        sa.Column("memory_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("memories.id", ondelete="CASCADE"), primary_key=True),
        sa.Column(
            "participant_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("participants.id", ondelete="CASCADE"),
            primary_key=True,
        ),
    )
    op.create_index("ix_memory_involvements_participant_id", "memory_involvements", ["participant_id"])

    op.add_column("participants", sa.Column("last_interaction_at", sa.DateTime(timezone=True), nullable=True))
    op.create_index("ix_participants_last_interaction_at", "participants", ["last_interaction_at"])


def downgrade() -> None:
    op.drop_index("ix_participants_last_interaction_at", table_name="participants")
    op.drop_column("participants", "last_interaction_at")
    op.drop_index("ix_memory_involvements_participant_id", table_name="memory_involvements")
    op.drop_table("memory_involvements")
    op.drop_index("ix_memories_scope", table_name="memories")
    op.drop_column("memories", "occurred_at")
    op.drop_column("memories", "scope")
    op.execute("DROP TYPE IF EXISTS memoryscope")
