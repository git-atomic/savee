"""Add blocks source type

Revision ID: add_blocks_type
Revises: 
Create Date: 2024-12-24

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = 'add_blocks_type'
down_revision = None  # Set to the latest migration if you have one
branch_labels = None
depends_on = None


def upgrade():
    # Add 'blocks' to the enum
    op.execute("ALTER TYPE enum_sources_source_type ADD VALUE IF NOT EXISTS 'blocks'")


def downgrade():
    # Note: PostgreSQL doesn't support removing enum values directly
    # You would need to recreate the enum type to remove a value
    pass
