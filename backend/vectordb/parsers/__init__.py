from vectordb.parsers.base import TicketParser
from vectordb.parsers.json_parser import JiraJsonParser

# CSV parser requires pandas - import conditionally
try:
    from vectordb.parsers.csv_parser import JiraCsvParser
    CSV_AVAILABLE = True
except ImportError:
    CSV_AVAILABLE = False


def get_parser(format_type: str = "json") -> TicketParser:
    """Return the appropriate parser based on format type."""
    if format_type == "json":
        return JiraJsonParser()
    elif format_type == "csv":
        if not CSV_AVAILABLE:
            raise ImportError("pandas is required for CSV parsing")
        return JiraCsvParser()
    else:
        raise ValueError(f"Unsupported format: {format_type}")
