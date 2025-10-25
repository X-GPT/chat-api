#!/usr/bin/env python3
"""Test script to verify the batch creation optimization works correctly."""

import asyncio
from uuid import uuid4

from supabase import acreate_client

from rag_python.core.logging import setup_logging
from rag_python.migration.config import MigrationSettings


async def test_batch_creation():
    """Test that create_batches_from_summary_ids function works correctly."""
    setup_logging()

    settings = MigrationSettings()

    if not settings.supabase_url or not settings.supabase_key:
        print("Error: SUPABASE_URL and SUPABASE_KEY must be set")
        return

    print("Connecting to Supabase...")
    supabase = await acreate_client(settings.supabase_url, settings.supabase_key)

    # Test with a temporary job ID
    test_job_id = uuid4()
    test_batch_size = 100

    print(f"\nTesting batch creation with:")
    print(f"  Job ID: {test_job_id}")
    print(f"  Batch size: {test_batch_size}")

    try:
        # Create a test job record
        job_data = {
            "id": str(test_job_id),
            "status": "pending",
            "total_batches": 0,
            "total_records": 0,
        }
        await supabase.table("ingestion_job").insert(job_data).execute()
        print("✓ Created test job")

        # Call the batch creation function
        print("\nCalling create_batches_from_summary_ids...")
        response = await supabase.rpc(
            "create_batches_from_summary_ids",
            {
                "p_job_id": str(test_job_id),
                "p_batch_size": test_batch_size,
            },
        ).execute()

        if not response.data:
            print("✗ Function returned no data")
            return

        result = response.data[0]
        total_records = int(result["total_records"])
        total_batches = int(result["total_batches"])
        inserted_batches = int(result["inserted_batches"])

        print(f"✓ Function completed successfully")
        print(f"  Total records: {total_records:,}")
        print(f"  Total batches: {total_batches:,}")
        print(f"  Inserted batches: {inserted_batches:,}")

        # Verify batches were created
        batch_response = await (
            supabase.table("ingestion_batch")
            .select("id, batch_number, start_id, end_id, record_ids")
            .eq("job_id", str(test_job_id))
            .order("batch_number")
            .limit(5)
            .execute()
        )

        print(f"\n✓ Created {len(batch_response.data)} sample batches:")
        for batch in batch_response.data:
            num_ids = len(batch.get("record_ids", []))
            print(
                f"  Batch {batch['batch_number']}: "
                f"IDs {batch['start_id']} to {batch['end_id']} ({num_ids} records)"
            )

        # Count total batches created
        count_response = await (
            supabase.table("ingestion_batch")
            .select("id", count="exact")
            .eq("job_id", str(test_job_id))
            .execute()
        )

        actual_batches = count_response.count
        print(f"\n✓ Total batches created in DB: {actual_batches}")

        if actual_batches == total_batches:
            print("✓ Batch count matches expected value")
        else:
            print(
                f"✗ Batch count mismatch: expected {total_batches}, got {actual_batches}"
            )

        # Test idempotency: run the function again
        print("\n🔄 Testing idempotency (running function again)...")
        response2 = await supabase.rpc(
            "create_batches_from_summary_ids",
            {
                "p_job_id": str(test_job_id),
                "p_batch_size": test_batch_size,
            },
        ).execute()

        result2 = response2.data[0]
        inserted_batches_2nd = int(result2["inserted_batches"])

        if inserted_batches_2nd == 0:
            print("✓ Idempotency test passed: 0 batches inserted on second run")
            print(f"  (All {total_batches:,} batches already existed)")
        else:
            print(
                f"✗ Idempotency test failed: {inserted_batches_2nd} batches inserted on second run"
            )

    except Exception as e:
        print(f"\n✗ Error: {e}")
        import traceback

        traceback.print_exc()

    finally:
        # Cleanup: Delete test batches and job
        print("\nCleaning up test data...")
        try:
            await supabase.table("ingestion_batch").delete().eq(
                "job_id", str(test_job_id)
            ).execute()
            await supabase.table("ingestion_job").delete().eq(
                "id", str(test_job_id)
            ).execute()
            print("✓ Cleanup complete")
        except Exception as e:
            print(f"✗ Cleanup error: {e}")


if __name__ == "__main__":
    asyncio.run(test_batch_creation())
