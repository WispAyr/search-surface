import { Suspense } from "react";
import { SearchOperationShell } from "@/components/search/SearchOperationShell";
import { AuthGate } from "@/components/AuthGate";

interface SearchPageProps {
  params: Promise<{ operationId: string }>;
}

export default async function SearchOperationPage({ params }: SearchPageProps) {
  const { operationId } = await params;

  return (
    <AuthGate>
      <Suspense
        fallback={
          <div className="min-h-screen bg-surface-900 flex items-center justify-center text-fg-4 text-sm">
            Loading operation...
          </div>
        }
      >
        <SearchOperationShell operationId={operationId} />
      </Suspense>
    </AuthGate>
  );
}
