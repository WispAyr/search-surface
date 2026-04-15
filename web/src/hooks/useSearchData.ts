import { useEffect, useCallback } from "react";
import { search } from "@/lib/api";
import { useSearchStore } from "@/stores/search";
import type { SearchOperation, SearchReport } from "@/types/search";

/** Fetch and populate the operations list */
export function useSearchOperations() {
  const { setOperations, setOperationsLoading } = useSearchStore();

  const refresh = useCallback(async () => {
    setOperationsLoading(true);
    try {
      const data = await search.listOperations();
      setOperations((data as any).operations || []);
    } catch {
      // silent
    } finally {
      setOperationsLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { refresh };
}

/** Fetch and populate a single operation (polling fallback if SSE unavailable) */
export function useSearchOperation(operationId: string | null, pollInterval = 0) {
  const { setActiveOperation, setActiveOperationLoading, setReports, setCommsLog } =
    useSearchStore();

  const fetchOp = useCallback(async () => {
    if (!operationId) return;
    setActiveOperationLoading(true);
    try {
      const op = await search.getOperation(operationId);
      setActiveOperation(op as SearchOperation);
    } catch {
      // silent
    } finally {
      setActiveOperationLoading(false);
    }
  }, [operationId]);

  const fetchReports = useCallback(async () => {
    if (!operationId) return;
    try {
      const data = await search.listReports(operationId);
      setReports((data as any).reports || []);
    } catch {}
  }, [operationId]);

  const fetchComms = useCallback(async () => {
    if (!operationId) return;
    try {
      const data = await search.listComms(operationId);
      setCommsLog((data as any).comms || []);
    } catch {}
  }, [operationId]);

  useEffect(() => {
    fetchOp();
    fetchReports();
    fetchComms();

    if (pollInterval > 0) {
      const iv = setInterval(() => {
        fetchOp();
        fetchReports();
      }, pollInterval);
      return () => clearInterval(iv);
    }
  }, [operationId, pollInterval]);

  return { refresh: fetchOp, refreshReports: fetchReports, refreshComms: fetchComms };
}
