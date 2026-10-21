"""Episode sequence bounds and conversation compaction cursor

Revision ID: 004
Revises: 003
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "004"
down_revision: Union[str, None] = "003"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "conversations",
        sa.Column("compacted_through_sequence", sa.Integer(), nullable=False, server_default="0"),
    )
    op.add_column("episodes", sa.Column("from_sequence", sa.Integer(), nullable=True))
    op.add_column("episodes", sa.Column("to_sequence", sa.Integer(), nullable=True))
    op.add_column("episodes", sa.Column("idempotency_key", sa.String(128), nullable=True))
    op.create_index("uq_episodes_idempotency_key", "episodes", ["idempotency_key"], unique=True)
    op.create_index("ix_episodes_conversation_sequence", "episodes", ["conversation_id", "from_sequence", "to_sequence"])


def downgrade() -> None:
    op.drop_index("ix_episodes_conversation_sequence", table_name="episodes")
    op.drop_index("uq_episodes_idempotency_key", table_name="episodes")
    op.drop_column("episodes", "idempotency_key")
    op.drop_column("episodes", "to_sequence")
    op.drop_column("episodes", "from_sequence")
    op.drop_column("conversations", "compacted_through_sequence")
