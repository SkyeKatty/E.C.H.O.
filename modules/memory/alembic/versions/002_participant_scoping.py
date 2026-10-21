"""Participant scoping on messages and memories

Revision ID: 002
Revises: 001
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "002"
down_revision: Union[str, None] = "001"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_unique_constraint("uq_participant_persona_external", "participants", ["persona_id", "external_id"])

    op.add_column(
        "messages",
        sa.Column("participant_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("participants.id", ondelete="SET NULL"), nullable=True),
    )
    op.create_index("ix_messages_participant_id", "messages", ["participant_id"])

    op.add_column(
        "memories",
        sa.Column(
            "subject_participant_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("participants.id", ondelete="SET NULL"),
            nullable=True,
        ),
    )
    op.create_index("ix_memories_subject_participant_id", "memories", ["subject_participant_id"])


def downgrade() -> None:
    op.drop_index("ix_memories_subject_participant_id", table_name="memories")
    op.drop_column("memories", "subject_participant_id")
    op.drop_index("ix_messages_participant_id", table_name="messages")
    op.drop_column("messages", "participant_id")
    op.drop_constraint("uq_participant_persona_external", "participants", type_="unique")
