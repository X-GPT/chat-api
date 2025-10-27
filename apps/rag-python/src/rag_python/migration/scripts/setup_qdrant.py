#!/usr/bin/env python3
"""Setup script to create Qdrant collection before running migration.

This script should be run ONCE before starting the migration to ensure
the Qdrant collection exists with the correct schema.

Usage:
    uv run python -m rag_python.migration.scripts.setup_qdrant
"""

import asyncio
import sys

from qdrant_client.http.models import VectorsConfig

from rag_python.config import get_settings
from rag_python.core.logging import get_logger, setup_logging
from rag_python.services.qdrant_service import QdrantService

logger = get_logger(__name__)


async def setup_qdrant_collection() -> bool:
    """Create Qdrant collection if it doesn't exist.

    Returns:
        True if successful, False otherwise
    """
    try:
        logger.info("=== Qdrant Collection Setup ===")

        # Load settings
        settings = get_settings()
        logger.info(f"Qdrant URL: {settings.qdrant_url}")
        logger.info(f"Collection name: {settings.qdrant_collection_name}")

        # Initialize Qdrant service
        qdrant_service = QdrantService(settings)

        # Check if collection already exists
        collection_exists = await qdrant_service.collection_exists()
        vectors: VectorsConfig | None = None

        if collection_exists:
            # Collection exists, get info and ask for confirmation
            collection_info = await qdrant_service.aclient.get_collection(
                settings.qdrant_collection_name
            )
            logger.info(f"✓ Collection '{settings.qdrant_collection_name}' already exists")
            logger.info(f"  Points count: {collection_info.points_count}")
            vectors = collection_info.config.params.vectors
            assert vectors is not None
            assert isinstance(vectors, dict)
            logger.info(f"  Vectors: {vectors.keys()}")

            # Ask if user wants to continue
            response = (
                input(
                    f"\nCollection '{settings.qdrant_collection_name}' already exists with "
                    f"{collection_info.points_count} points.\n"
                    "Do you want to continue with this collection? (Y/n): "
                )
                .strip()
                .lower()
            )

            if response and response not in ("y", "yes"):
                logger.warning("Setup cancelled by user")
                await qdrant_service.aclose()
                return False
        else:
            # Collection doesn't exist, create it
            logger.info(f"Collection '{settings.qdrant_collection_name}' does not exist yet")
            logger.info("Creating new collection...")

            # Create the collection with ensure_schema
            await qdrant_service.ensure_schema()

            # Verify creation
            collection_info = await qdrant_service.aclient.get_collection(
                settings.qdrant_collection_name
            )
            logger.info(f"✓ Collection '{settings.qdrant_collection_name}' created successfully!")

        # Display collection details
        logger.info("\n=== Collection Configuration ===")
        logger.info(f"Collection: {settings.qdrant_collection_name}")
        logger.info(f"Status: {collection_info.status}")

        vectors = collection_info.config.params.vectors
        assert vectors is not None
        assert isinstance(vectors, dict)
        # Dense vector config
        if "child" in vectors:
            child_config = vectors["child"]
            logger.info("\nDense Vector ('child'):")
            logger.info(f"  Size: {child_config.size}")
            logger.info(f"  Distance: {child_config.distance}")
            logger.info(
                f"  On-disk: {child_config.on_disk if hasattr(child_config, 'on_disk') else 'N/A'}"
            )

        # Sparse vector config
        if collection_info.config.params.sparse_vectors:
            logger.info("\nSparse Vectors:")
            for name, config in collection_info.config.params.sparse_vectors.items():
                logger.info(f"  {name}: {config}")

        # Payload indexes
        if collection_info.payload_schema:
            logger.info("\nPayload Indexes:")
            for field, schema in collection_info.payload_schema.items():
                logger.info(f"  {field}: {schema}")
        else:
            logger.info("No payload schema found")

        logger.info("\n=== Setup Complete ===")
        logger.info("✓ Qdrant collection is ready for migration")
        logger.info("\nNext steps:")
        logger.info("1. Verify Supabase tables are created (run create_tables.sql)")
        logger.info("2. Add migration environment variables to .env file")
        logger.info("3. Run the migration controller:")
        logger.info("   uv run python -m rag_python.migration.controller")

        await qdrant_service.aclose()
        return True

    except Exception as e:
        logger.error(f"Failed to setup Qdrant collection: {e}", exc_info=True)
        return False


async def main():
    """Main entry point."""
    setup_logging()

    success = await setup_qdrant_collection()

    if not success:
        logger.error("Setup failed!")
        sys.exit(1)

    logger.info("Setup completed successfully!")
    sys.exit(0)


if __name__ == "__main__":
    asyncio.run(main())
