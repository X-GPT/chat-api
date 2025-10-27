#!/usr/bin/env python
"""Insert data from CSV file to Supabase table.

Usage:
    python -m rag_python.migration.scripts.csv_to_supabase \
        --csv path/to/data.csv \
        --table table_name \
        [--batch-size 1000] \
        [--skip-header] \
        [--columns col1,col2,col3] \
        [--dry-run]

Examples:
    # Basic usage - insert CSV with header row
    python -m rag_python.migration.scripts.csv_to_supabase \
        --csv data.csv \
        --table my_table

    # Skip first row and specify column names
    python -m rag_python.migration.scripts.csv_to_supabase \
        --csv data.csv \
        --table my_table \
        --skip-header \
        --columns id,name,email

    # Custom batch size and dry run
    python -m rag_python.migration.scripts.csv_to_supabase \
        --csv data.csv \
        --table my_table \
        --batch-size 500 \
        --dry-run
"""

import argparse
import asyncio
import csv
import sys
from pathlib import Path
from typing import Any

from supabase import AsyncClient, acreate_client

from rag_python.core.logging import get_logger, setup_logging
from rag_python.migration.config import MigrationSettings

logger = get_logger(__name__)


async def insert_batch(client: AsyncClient, table_name: str, batch: list[dict[str, Any]]) -> int:
    """Insert a batch of rows into Supabase table.

    Args:
        client: Supabase async client
        table_name: Name of the table to insert into
        batch: List of row dictionaries

    Returns:
        Number of rows inserted

    Raises:
        Exception: If insertion fails
    """
    try:
        response = await client.table(table_name).insert(batch).execute()
        return len(response.data)
    except Exception as e:
        logger.error(f"Failed to insert batch: {e}")
        raise


async def csv_to_supabase(
    csv_path: str,
    table_name: str,
    batch_size: int = 1000,
    skip_header: bool = False,
    column_names: list[str] | None = None,
    dry_run: bool = False,
) -> tuple[int, int]:
    """Insert data from CSV file to Supabase table.

    Args:
        csv_path: Path to CSV file
        table_name: Target Supabase table name
        batch_size: Number of rows to insert per batch
        skip_header: Skip first row of CSV
        column_names: Custom column names (overrides CSV header)
        dry_run: Preview data without inserting

    Returns:
        Tuple of (total_rows_processed, total_rows_inserted)
    """
    # Validate CSV file exists
    csv_file = Path(csv_path)
    if not csv_file.exists():
        raise FileNotFoundError(f"CSV file not found: {csv_path}")

    logger.info(f"Reading CSV file: {csv_path}")
    logger.info(f"Target table: {table_name}")
    logger.info(f"Batch size: {batch_size}")
    logger.info(f"Dry run: {dry_run}")

    # Load settings and create client
    settings = MigrationSettings()
    if not settings.supabase_url or not settings.supabase_key:
        raise ValueError("SUPABASE_URL and SUPABASE_KEY must be set in .env file")

    client = None
    if not dry_run:
        client = await acreate_client(settings.supabase_url, settings.supabase_key)
        logger.info("Connected to Supabase")

    # Read and process CSV
    total_rows = 0
    inserted_rows = 0
    batch: list[dict[str, Any]] = []

    try:
        with open(csv_file, "r", encoding="utf-8") as f:
            reader = csv.reader(f)

            # Handle header
            if skip_header:
                next(reader)  # Skip first row
                if not column_names:
                    raise ValueError("Must provide --columns when using --skip-header")
                headers = column_names
            else:
                # First row is header
                headers = next(reader)
                if column_names:
                    logger.warning("Ignoring --columns flag, using CSV header row")

            logger.info(f"Columns: {', '.join(headers)}")

            # Preview mode - show first 5 rows
            if dry_run:
                logger.info("\n--- Preview (first 5 rows) ---")
                preview_count = 0
                for row in reader:
                    if preview_count >= 5:
                        break
                    row_dict = dict(zip(headers, row))
                    logger.info(f"Row {preview_count + 1}: {row_dict}")
                    preview_count += 1
                    total_rows += 1

                # Count remaining rows
                for _ in reader:
                    total_rows += 1

                logger.info(f"\n✓ Total rows in CSV: {total_rows:,}")
                logger.info("Dry run complete - no data inserted")
                return (total_rows, 0)

            assert client is not None
            # Process rows in batches
            for row in reader:
                # Convert CSV row to dictionary
                row_dict = dict(zip(headers, row))

                # Handle empty values (convert to None for NULL in database)
                row_dict = {k: (v if v.strip() != "" else None) for k, v in row_dict.items()}

                batch.append(row_dict)
                total_rows += 1

                # Insert when batch is full
                if len(batch) >= batch_size:
                    logger.info(
                        f"Inserting batch ({inserted_rows:,} to {inserted_rows + len(batch):,})..."
                    )
                    count = await insert_batch(client, table_name, batch)
                    inserted_rows += count
                    batch = []
                    logger.info(f"✓ Inserted {count:,} rows (total: {inserted_rows:,})")

            # Insert remaining rows
            if batch:
                logger.info(f"Inserting final batch ({len(batch)} rows)...")
                count = await insert_batch(client, table_name, batch)
                inserted_rows += count
                logger.info(f"✓ Inserted {count:,} rows (total: {inserted_rows:,})")

        logger.info(
            f"\n✓✓✓ Successfully inserted {inserted_rows:,} rows from {total_rows:,} total rows"
        )
        return (total_rows, inserted_rows)

    except Exception as e:
        logger.error(f"✗ Error processing CSV: {e}", exc_info=True)
        raise


def main():
    """Entry point."""
    parser = argparse.ArgumentParser(
        description="Insert data from CSV file to Supabase table",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  # Insert CSV with header row
  python -m rag_python.migration.scripts.csv_to_supabase --csv data.csv --table users

  # Skip header and specify columns
  python -m rag_python.migration.scripts.csv_to_supabase --csv data.csv --table users --skip-header --columns id,name,email

  # Preview without inserting
  python -m rag_python.migration.scripts.csv_to_supabase --csv data.csv --table users --dry-run
        """,
    )
    parser.add_argument(
        "--csv",
        required=True,
        help="Path to CSV file",
    )
    parser.add_argument(
        "--table",
        required=True,
        help="Target Supabase table name",
    )
    parser.add_argument(
        "--batch-size",
        type=int,
        default=1000,
        help="Number of rows to insert per batch (default: 1000)",
    )
    parser.add_argument(
        "--skip-header",
        action="store_true",
        help="Skip first row of CSV (use with --columns)",
    )
    parser.add_argument(
        "--columns",
        help="Comma-separated column names (e.g., id,name,email)",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Preview data without inserting into database",
    )

    args = parser.parse_args()

    # Parse column names if provided
    column_names = None
    if args.columns:
        column_names = [col.strip() for col in args.columns.split(",")]

    # Setup logging
    setup_logging()

    # Run the import
    try:
        _, inserted = asyncio.run(
            csv_to_supabase(
                csv_path=args.csv,
                table_name=args.table,
                batch_size=args.batch_size,
                skip_header=args.skip_header,
                column_names=column_names,
                dry_run=args.dry_run,
            )
        )

        if not args.dry_run:
            logger.info(f"\n🎉 Import complete! Inserted {inserted:,} rows")

        sys.exit(0)

    except Exception as e:
        logger.error(f"\n❌ Import failed: {e}")
        sys.exit(1)


if __name__ == "__main__":
    main()
