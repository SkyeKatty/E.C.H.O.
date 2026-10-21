"""pgvector column on embeddings for cosine search

Revision ID: 005
Revises: 004
"""

from typing import Sequence, Union

from alembic import op

revision: str = "005"
down_revision: Union[str, None] = "004"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("CREATE EXTENSION IF NOT EXISTS vector")
    op.execute(
        """
        ALTER TABLE embeddings
        ADD COLUMN IF NOT EXISTS embedding vector(384)
        """
    )
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS ix_embeddings_embedding_hnsw
        ON embeddings USING hnsw (embedding vector_cosine_ops)
        WHERE embedding IS NOT NULL
        """
    )


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS ix_embeddings_embedding_hnsw")
    op.execute("ALTER TABLE embeddings DROP COLUMN IF EXISTS embedding")
