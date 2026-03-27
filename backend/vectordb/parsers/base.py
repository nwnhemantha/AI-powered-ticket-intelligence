from abc import ABC, abstractmethod
from typing import Any


class TicketParser(ABC):
    """Base class for JIRA ticket parsers."""

    @abstractmethod
    def parse(self, data: Any) -> list[dict[str, Any]]:
        """Parse data and return a list of normalized ticket dicts.

        Each dict must have at minimum:
          - jira_key: str
          - summary: str
          - description: str (may be empty)
          - resolution: str or None
          - status: str or None
          - priority: str or None
          - issue_type: str or None
          - assignee: str or None
          - reporter: str or None
          - labels: list[str]
          - components: list[str]
          - created_date: str or None (ISO format)
          - resolved_date: str or None (ISO format)
          - updated_date: str or None (ISO format)
        """
        pass
