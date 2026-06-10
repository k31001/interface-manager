import { notFound } from "next/navigation";
import { Suspense } from "react";
import { SfrViewer } from "@/components/sfr-viewer";
import { Spinner } from "@/components/ui";
import { getProject } from "@/lib/config";

export const dynamic = "force-dynamic";

export default async function Page({ params }: { params: Promise<{ project: string }> }) {
  const { project } = await params;
  const p = getProject(project);
  if (!p) notFound();
  return (
    <Suspense fallback={<Spinner />}>
      <SfrViewer project={p.id} projectName={p.name} />
    </Suspense>
  );
}
