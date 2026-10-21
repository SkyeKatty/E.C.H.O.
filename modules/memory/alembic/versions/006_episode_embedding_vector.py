"""Episode pgvector column for hybrid retrieval

Revision ID: 006
Revises: 005
"""

from typing import Sequence, Union

from alembic import op

revision: str = "006"
down_revision: Union[str, None] = "005"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("CREATE EXTENSION IF NOT EXISTS vector")
    op.execute(
        """
        ALTER TABLE episodes
        ADD COLUMN IF NOT EXISTS summary_hash VARCHAR(64)
        """
    )
    op.execute(
        """
        ALTER TABLE episodes
        ADD COLUMN IF NOT EXISTS embedding vector(384)
        """
    )
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS ix_episodes_embedding_hnsw
        ON episodes USING hnsw (embedding vector_cosine_ops)
        WHERE embedding IS NOT NULL
        """
    )


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS ix_episodes_embedding_hnsw")
    op.execute("ALTER TABLE episodes DROP COLUMN IF EXISTS embedding")
    op.execute("ALTER TABLE episodes DROP COLUMN IF EXISTS summary_hash")
