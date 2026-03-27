import pandas as pd
from typing import Any

from vectordb.parsers.base import TicketParser


class JiraCsvParser(TicketParser):
    """Parse JIRA CSV exports."""

    def parse(self, file_path: str) -> list[dict[str, Any]]:
        """Parse tickets from a CSV file."""
        df = pd.read_csv(file_path)

        # Map common CSV column names to our schema
        column_map = {
            "Issue key": "jira_key",
            "Key": "jira_key",
            "Summary": "summary",
            "Description": "description",
            "Resolution": "resolution",
            "Status": "status",
            "Priority": "priority",
            "Issue Type": "issue_type",
            "Assignee": "assignee",
            "Reporter": "reporter",
            "Labels": "labels",
            "Components": "components",
            "Created": "created_date",
            "Resolved": "resolved_date",
            "Updated": "updated_date",
        }

        result = []
        for _, row in df.iterrows():
            ticket = {}
            for csv_col, our_col in column_map.items():
                if csv_col in df.columns:
                    value = row[csv_col]
                    # Handle NaN values
                    if pd.isna(value):
                        value = None if our_col not in ["labels", "components"] else []
                    # Parse comma-separated lists
                    elif our_col in ["labels", "components"] and isinstance(value, str):
                        value = [x.strip() for x in value.split(",") if x.strip()]
                    ticket[our_col] = value
                else:
                    ticket[our_col] = [] if our_col in ["labels", "components"] else None

            result.append(ticket)

        return result
