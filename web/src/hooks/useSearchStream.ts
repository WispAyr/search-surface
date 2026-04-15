import { useEffect, useRef } from "react";
import { useSearchStore } from "@/stores/search";
import type { SearchStreamEvent } from "@/types/search";

export function useSearchStream(operationId: string | null) {
  const esRef = useRef<EventSource | null>(null);
  const {
    setActiveOperation,
    updateZoneInState,
    updateTeamPosition,
    addReport,
    addCommsEntry,
  } = useSearchStore();

  useEffect(() => {
    if (!operationId) return;

    const url = `/api/search/operations/${operationId}/stream`;
    const es = new EventSource(url);
    esRef.current = es;

    es.onmessage = (ev) => {
      try {
        const event = JSON.parse(ev.data) as { type: string; data: any };

        switch (event.type) {
          case "init":
            setActiveOperation(event.data);
            break;
          case "zone_updated":
            updateZoneInState(event.data as any);
            break;
          case "team_position":
            {
              const d = event.data as any;
              updateTeamPosition(d.team_id, d.lat, d.lon, d.at);
            }
            break;
          case "report_submitted":
            addReport(event.data as any);
            break;
          case "comms":
            addCommsEntry(event.data as any);
            break;
          case "operation_updated":
            // Refetch full operation state for structural changes
            fetch(`/api/search/operations/${operationId}`)
              .then((r) => r.json())
              .then((op) => setActiveOperation(op))
              .catch(() => {});
            break;
        }
      } catch {
        // ignore parse errors
      }
    };

    es.onerror = () => {
      // EventSource auto-reconnects
    };

    return () => {
      es.close();
      esRef.current = null;
    };
  }, [operationId]);
}
