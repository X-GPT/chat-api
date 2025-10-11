"""Unit tests for verifying FilterOperator behavior with collection_ids.

These tests check how LlamaIndex constructs filters for Qdrant,
without requiring a running Qdrant instance.
"""

import pytest
from llama_index.core.vector_stores.types import (
    FilterCondition,
    FilterOperator,
    MetadataFilter,
    MetadataFilters,
)


def test_filter_operator_contains():
    """Test FilterOperator.CONTAINS construction."""
    filter = MetadataFilter(
        key="collection_ids",
        value=[100, 200, 300],
        operator=FilterOperator.CONTAINS,
    )

    assert filter.key == "collection_ids"
    assert filter.value == [100, 200, 300]
    assert filter.operator == FilterOperator.CONTAINS
    print(f"CONTAINS filter: {filter}")


def test_filter_operator_in():
    """Test FilterOperator.IN construction."""
    filter = MetadataFilter(
        key="collection_ids",
        value=[100, 200, 300],
        operator=FilterOperator.IN,
    )

    assert filter.key == "collection_ids"
    assert filter.value == [100, 200, 300]
    assert filter.operator == FilterOperator.IN
    print(f"IN filter: {filter}")


def test_filter_operator_any():
    """Test FilterOperator.ANY construction."""
    # ANY might be used differently - test if it accepts list
    filter = MetadataFilter(
        key="collection_ids",
        value=[100, 200, 300],
        operator=FilterOperator.ANY,
    )

    assert filter.key == "collection_ids"
    assert filter.value == [100, 200, 300]
    assert filter.operator == FilterOperator.ANY
    print(f"ANY filter: {filter}")


def test_filter_operator_eq_single():
    """Test FilterOperator.EQ with single value (alternative approach)."""
    filter = MetadataFilter(
        key="collection_ids",
        value=200,  # Single value
        operator=FilterOperator.EQ,
    )

    assert filter.key == "collection_ids"
    assert filter.value == 200
    assert filter.operator == FilterOperator.EQ
    print(f"EQ filter (single): {filter}")


def test_multiple_filters_combined():
    """Test combining multiple filters with AND logic."""
    filters = MetadataFilters(
        filters=[
            MetadataFilter(
                key="member_code",
                value="test_user",
                operator=FilterOperator.EQ,
            ),
            MetadataFilter(
                key="collection_ids",
                value=[100, 200],
                operator=FilterOperator.CONTAINS,
            ),
        ],
        condition=FilterCondition.AND,  # Default is AND
    )

    assert len(filters.filters) == 2
    assert filters.condition == FilterCondition.AND
    print(f"Combined filters: {filters}")


def test_filter_operators_available():
    """Document all available FilterOperator enum values."""
    operators = [attr for attr in dir(FilterOperator) if attr.isupper()]

    print("\n=== Available FilterOperators ===")
    for op in operators:
        val = getattr(FilterOperator, op)
        print(f"  FilterOperator.{op} = {val}")

    # Verify operators we're testing exist
    assert hasattr(FilterOperator, "CONTAINS")
    assert hasattr(FilterOperator, "IN")
    assert hasattr(FilterOperator, "ANY")
    assert hasattr(FilterOperator, "EQ")


def test_filter_semantics_documentation():
    """Document expected semantics for array filtering.

    This test serves as documentation for how we expect
    collection_ids filtering to work.
    """
    print("\n=== Expected Filter Semantics ===")
    print("\nGiven:")
    print("  Summary 1: collection_ids = [100, 200]")
    print("  Summary 2: collection_ids = [200, 300]")
    print("  Summary 3: collection_ids = [400]")

    print("\nFilter: collection_ids with [200, 300]")
    print("Expected matches:")
    print("  ✓ Summary 1 (contains 200)")
    print("  ✓ Summary 2 (contains 200 and 300)")
    print("  ✗ Summary 3 (doesn't contain 200 or 300)")

    print("\nThis is 'ANY' semantics (OR):")
    print("  Match if array contains ANY of the filter values")

    print("\nQdrant native equivalent:")
    print("  FieldCondition(key='collection_ids', match=MatchAny(any=[200, 300]))")


def test_operator_enum_values():
    """Check the actual enum values/strings for each operator."""
    print("\n=== Operator Enum String Values ===")

    operators_to_test = ["CONTAINS", "IN", "ANY", "EQ", "ALL"]

    for op_name in operators_to_test:
        if hasattr(FilterOperator, op_name):
            op = getattr(FilterOperator, op_name)
            # FilterOperator is a string enum
            print(f"  FilterOperator.{op_name} = '{op}'")
            assert isinstance(op, str), f"{op_name} should be a string enum"


if __name__ == "__main__":
    # Run tests with verbose output
    pytest.main([__file__, "-v", "-s"])
