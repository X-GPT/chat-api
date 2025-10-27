#!/usr/bin/env python
"""Update Qdrant points with collection_ids from Supabase table.

This script reads summary_id and collection_ids from a Supabase table,
then updates the corresponding points in Qdrant by setting the collection_ids payload.

Usage:
    python -m rag_python.migration.scripts.update_qdrant_collection_ids \
        --table table_name \
        [--batch-size 100] \
        [--dry-run]

Examples:
    # Basic usage - read from a table and update Qdrant
    python -m rag_python.migration.scripts.update_qdrant_collection_ids \
        --table summary_collections

    # Custom batch size and dry run (preview only)
    python -m rag_python.migration.scripts.update_qdrant_collection_ids \
        --table summary_collections \
        --batch-size 50 \
        --dry-run

Table Schema Requirements:
    The Supabase table must have the following columns:
    - summary_id (BIGINT): The summary ID that corresponds to points in Qdrant
    - collection_ids (BIGINT[]): Array of collection IDs to set on the Qdrant points
"""

import argparse
import asyncio
import sys

from pydantic import BaseModel
from supabase import acreate_client

from rag_python.config import get_settings
from rag_python.core.logging import get_logger, setup_logging
from rag_python.migration.config import MigrationSettings
from rag_python.services.qdrant_service import QdrantService

logger = get_logger(__name__)


class SummaryWithCollectionIds(BaseModel):
    summary_id: int
    collection_ids: list[int]


async def update_batch(
    qdrant_service: QdrantService,
    batch: list[SummaryWithCollectionIds],
) -> tuple[int, int]:
    """Update a batch of Qdrant points with collection_ids.

    Args:
        qdrant_service: Qdrant service instance
        batch: List of SummaryWithCollectionIds

    Returns:
        Tuple of (successful_updates, failed_updates)
    """
    successful = 0
    failed = 0

    for row in batch:
        summary_id = row.summary_id
        collection_ids = row.collection_ids

        try:
            # Update the collection_ids for this summary in Qdrant
            await qdrant_service.update_collection_ids(
                summary_id=summary_id,
                collection_ids=collection_ids,
            )
            logger.debug(
                f"Updated summary_id={summary_id} with {len(collection_ids)} collection_ids"
            )
            successful += 1
        except Exception as e:
            logger.error(
                f"Failed to update summary_id={summary_id}: {e}",
                exc_info=True,
            )
            failed += 1

    return successful, failed


async def update_qdrant_from_supabase(
    table_name: str,
    batch_size: int = 100,
    dry_run: bool = False,
) -> tuple[int, int, int]:
    """Read data from Supabase and update Qdrant points with collection_ids.

    Args:
        table_name: Supabase table containing summary_id and collection_ids columns
        batch_size: Number of rows to process per batch
        dry_run: Preview data without updating Qdrant

    Returns:
        Tuple of (total_rows, successful_updates, failed_updates)
    """
    # Load settings and create clients
    migration_settings = MigrationSettings()
    app_settings = get_settings()

    if not migration_settings.supabase_url or not migration_settings.supabase_key:
        raise ValueError("SUPABASE_URL and SUPABASE_KEY must be set in .env file")

    logger.info("Connecting to Supabase...")
    supabase_client = await acreate_client(
        migration_settings.supabase_url,
        migration_settings.supabase_key,
    )
    logger.info("Connected to Supabase")

    # Initialize Qdrant service (only if not dry run)
    qdrant_service = None
    if not dry_run:
        qdrant_service = QdrantService(app_settings)
        logger.info(f"Connected to Qdrant collection: {qdrant_service.col}")

    # Fetch data from Supabase in batches
    total_rows = 0
    successful_updates = 0
    failed_updates = 0
    start = 0

    logger.info(f"Reading from table: {table_name}")
    logger.info(f"Batch size: {batch_size}")
    logger.info(f"Dry run: {dry_run}")

    try:
        while True:
            # Fetch batch from Supabase
            response = await (
                supabase_client.table(table_name)
                .select("summary_id, collection_ids")
                .order("summary_id")
                .range(start, start + batch_size - 1)
                .execute()
            )

            if not response.data:
                # No more data
                break

            batch = response.data
            batch_count = len(batch)
            total_rows += batch_count

            logger.info(
                f"Processing batch {start // batch_size + 1} "
                f"({start + 1} to {start + batch_count}) - {batch_count} rows"
            )

            if dry_run:
                # Preview mode - show first few rows of this batch
                preview_count = min(5, batch_count)
                for i, row in enumerate(batch[:preview_count]):
                    valided_row = SummaryWithCollectionIds.model_validate(row)
                    logger.info(
                        f"  Row {start + i + 1}: summary_id={valided_row.summary_id}, "
                        f"collection_ids={valided_row.collection_ids}"
                    )
                if batch_count > preview_count:
                    logger.info(f"  ... and {batch_count - preview_count} more rows")
            else:
                # Update Qdrant with this batch
                assert qdrant_service is not None
                validated_batch = [SummaryWithCollectionIds.model_validate(row) for row in batch]
                successful, failed = await update_batch(qdrant_service, validated_batch)
                successful_updates += successful
                failed_updates += failed
                logger.info(
                    f"Batch complete: {successful} successful, {failed} failed "
                    f"(total: {successful_updates}/{total_rows})"
                )

            # Check if we got fewer records than requested (last page)
            if batch_count < batch_size:
                break

            start += batch_size

        # Close Qdrant connection
        if qdrant_service:
            await qdrant_service.aclose()

        # Final summary
        if dry_run:
            logger.info(f"\n✓ Dry run complete - reviewed {total_rows:,} rows")
        else:
            logger.info(
                f"\n✓✓✓ Update complete: "
                f"{successful_updates:,} successful, "
                f"{failed_updates:,} failed "
                f"out of {total_rows:,} total rows"
            )

        return total_rows, successful_updates, failed_updates

    except Exception as e:
        logger.error(f"✗ Error during update: {e}", exc_info=True)
        raise


def main():
    """Entry point."""
    parser = argparse.ArgumentParser(
        description="Update Qdrant points with collection_ids from Supabase table",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  # Update Qdrant from a Supabase table
  python -m rag_python.migration.scripts.update_qdrant_collection_ids --table summary_collections

  # Preview without updating
  python -m rag_python.migration.scripts.update_qdrant_collection_ids --table summary_collections --dry-run

  # Custom batch size
  python -m rag_python.migration.scripts.update_qdrant_collection_ids --table summary_collections --batch-size 50

Table Requirements:
  The Supabase table must have these columns:
  - summary_id (BIGINT): Links to Qdrant points with matching summary_id in payload
  - collection_ids (BIGINT[]): Array of collection IDs to set on the points
        """,
    )
    parser.add_argument(
        "--table",
        required=True,
        help="Supabase table name containing summary_id and collection_ids columns",
    )
    parser.add_argument(
        "--batch-size",
        type=int,
        default=100,
        help="Number of rows to process per batch (default: 100)",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Preview data without updating Qdrant",
    )

    args = parser.parse_args()

    # Setup logging
    setup_logging()

    # Run the update
    try:
        total, successful, failed = asyncio.run(
            update_qdrant_from_supabase(
                table_name=args.table,
                batch_size=args.batch_size,
                dry_run=args.dry_run,
            )
        )

        if args.dry_run:
            logger.info(f"\n📋 Dry run complete - reviewed {total:,} rows")
        else:
            logger.info(
                f"\n🎉 Update complete! "
                f"{successful:,} successful, {failed:,} failed "
                f"out of {total:,} total rows"
            )

        # Exit with error code if any updates failed
        if failed > 0 and not args.dry_run:
            sys.exit(1)

        sys.exit(0)

    except Exception as e:
        logger.error(f"\n❌ Update failed: {e}")
        sys.exit(1)


if __name__ == "__main__":
    main()
